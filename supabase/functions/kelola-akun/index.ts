// Edge Function: kelola akun login (username + PIN 4 digit).
//   create : Pemilik/BM/Admin membuat akun untuk anggota tim  {app_id, username, pin}
//   reset  : Pemilik/BM/Admin mengganti PIN / username anggota {app_id, pin, username?}
//   self   : pengguna mengganti PIN (dan username bila belum ada) miliknya sendiri {pin, username?}
// Service role key hanya ada di server Supabase, tidak pernah di aplikasi.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UNAME = /^[a-z0-9._]{3,20}$/;
const WEAK = new Set(["0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "1234", "4321", "0123", "1212"]);

async function pinHash(appId: string, pin: string) {
  const pepper = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pepper + "|" + appId + "|" + pin));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randPw() { const a = new Uint8Array(24); crypto.getRandomValues(a); return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: who, error: we } = await admin.auth.getUser(token);
    if (we || !who?.user) return json({ error: "Sesi tidak valid" }, 401);
    const { data: me } = await admin.from("profiles").select("app_id,role,aktif,username").eq("user_id", who.user.id).maybeSingle();
    if (!me || !me.aktif) return json({ error: "Akun tidak aktif" }, 403);
    const isMgr = ["approver", "bm", "admin"].includes(me.role);

    const body = await req.json();
    const action = String(body.action || "");
    const appId = action === "self" ? me.app_id : String(body.app_id || "");
    if (action !== "self" && !isMgr) return json({ error: "Hanya Pemilik/BM/Admin" }, 403);
    const { data: prof } = await admin.from("profiles").select("*").eq("app_id", appId).maybeSingle();
    if (!prof) return json({ error: "Anggota tim tidak ditemukan" }, 404);
    if (action !== "self" && prof.role === "approver" && me.role !== "approver") return json({ error: "Akun Pemilik hanya bisa diubah Pemilik" }, 403);

    const pin = String(body.pin || "");
    if (!/^\d{4}$/.test(pin)) return json({ error: "PIN harus 4 digit angka" }, 400);
    if (WEAK.has(pin)) return json({ error: "PIN terlalu mudah ditebak. Hindari 0000, 1234, dan sejenisnya." }, 400);
    let username = body.username != null ? String(body.username).trim().toLowerCase() : "";
    if (username) {
      if (!UNAME.test(username)) return json({ error: "Username 3–20 karakter: huruf kecil, angka, titik, garis bawah" }, 400);
      if (action === "self" && prof.username && prof.username !== username) return json({ error: "Username hanya bisa diubah BM/Admin" }, 403);
      const { data: dup } = await admin.from("profiles").select("app_id").eq("username", username).neq("app_id", appId).maybeSingle();
      if (dup) return json({ error: "Username sudah dipakai" }, 409);
    } else username = prof.username || "";
    if (!username) return json({ error: "Username wajib diisi" }, 400);

    if (action === "create") {
      if (prof.user_id) return json({ error: "Anggota ini sudah punya akun" }, 409);
      // Email internal (tidak pernah dipakai mengirim email)
      const tag = appId.replace(/[^a-z0-9]/gi, "").toLowerCase() || "user";
      const domains = ["akun.archi-field.local", "users.archi-field.app"];
      let created = null, lastErr = "";
      for (const d of domains) {
        const email = `${tag}.${randPw().slice(0, 6)}@${d}`;
        const { data, error } = await admin.auth.admin.createUser({ email, password: randPw(), email_confirm: true });
        if (!error && data?.user) { created = { id: data.user.id, email }; break; }
        lastErr = error?.message || "gagal";
      }
      if (!created) return json({ error: "Gagal membuat akun: " + lastErr }, 400);
      const { error: pe } = await admin.from("profiles").update({ user_id: created.id, email: created.email, username }).eq("app_id", appId);
      if (pe) return json({ error: pe.message }, 400);
    } else if (action === "reset" || action === "self") {
      if (!prof.user_id) return json({ error: "Belum ada akun" }, 404);
      if (username !== prof.username) {
        const { error: pe } = await admin.from("profiles").update({ username }).eq("app_id", appId);
        if (pe) return json({ error: pe.message }, 400);
      }
    } else return json({ error: "Aksi tidak dikenal" }, 400);

    const { error: ke } = await admin.from("akun_pin").upsert({ app_id: appId, pin_hash: await pinHash(appId, pin), fail: 0, locked_until: null, updated_at: new Date().toISOString() });
    if (ke) return json({ error: ke.message }, 400);
    return json({ ok: true, username });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
