// Edge Function: login dengan username + PIN 4 digit.
// - PIN disimpan sebagai hash SHA-256 dengan pepper rahasia (service role key) — tidak bisa ditebak dari luar server.
// - Salah PIN 5x -> akun dikunci 15 menit.
// - Sesi dibuat lewat magic link internal (tidak ada email terkirim, tidak ada password).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const MAX_FAIL = 5, LOCK_MIN = 15;

async function pinHash(appId: string, pin: string) {
  const pepper = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pepper + "|" + appId + "|" + pin));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const username = String(body.username || "").trim().toLowerCase();
    const pin = String(body.pin || "");
    const salah = () => json({ error: "Username atau PIN salah" }, 401);
    if (!/^[a-z0-9._]{3,20}$/.test(username) || !/^\d{4}$/.test(pin)) return salah();

    const { data: prof } = await admin.from("profiles").select("app_id,user_id,aktif").eq("username", username).maybeSingle();
    if (!prof || !prof.user_id) return salah();
    if (!prof.aktif) return json({ error: "Akun ini sudah dinonaktifkan" }, 403);

    const { data: ap } = await admin.from("akun_pin").select("*").eq("app_id", prof.app_id).maybeSingle();
    if (!ap) return json({ error: "PIN belum diatur. Hubungi BM/Admin." }, 401);
    if (ap.locked_until && new Date(ap.locked_until) > new Date()) {
      const m = Math.ceil((new Date(ap.locked_until).getTime() - Date.now()) / 60000);
      return json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${m} menit atau minta BM reset PIN.` }, 423);
    }
    if ((await pinHash(prof.app_id, pin)) !== ap.pin_hash) {
      const fail = (ap.fail || 0) + 1;
      const lock = fail >= MAX_FAIL ? new Date(Date.now() + LOCK_MIN * 60000).toISOString() : null;
      await admin.from("akun_pin").update({ fail: lock ? 0 : fail, locked_until: lock }).eq("app_id", prof.app_id);
      if (lock) return json({ error: `PIN salah ${MAX_FAIL}x. Akun dikunci ${LOCK_MIN} menit.` }, 423);
      return json({ error: `Username atau PIN salah (sisa ${MAX_FAIL - fail} percobaan)` }, 401);
    }
    await admin.from("akun_pin").update({ fail: 0, locked_until: null }).eq("app_id", prof.app_id);

    const { data: u, error: ue } = await admin.auth.admin.getUserById(prof.user_id);
    if (ue || !u?.user?.email) return json({ error: "Akun login tidak ditemukan" }, 500);
    const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
    if (le || !link?.properties?.hashed_token) return json({ error: "Gagal membuat sesi" }, 500);
    const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
    const { data: ses, error: se } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
    if (se || !ses?.session) return json({ error: "Gagal membuat sesi" }, 500);
    return json({ access_token: ses.session.access_token, refresh_token: ses.session.refresh_token });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
