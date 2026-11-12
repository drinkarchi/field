// Edge Function: buat akun login & reset password anggota tim (hanya Pemilik/BM/Admin).
// Service role key hanya ada di server Supabase, tidak pernah di aplikasi.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: who, error: we } = await admin.auth.getUser(token);
    if (we || !who?.user) return json({ error: "Sesi tidak valid" }, 401);
    const { data: me } = await admin.from("profiles").select("app_id,role,aktif").eq("user_id", who.user.id).maybeSingle();
    if (!me || !me.aktif || !["approver", "bm", "admin"].includes(me.role)) return json({ error: "Hanya Pemilik/BM/Admin" }, 403);

    const body = await req.json();
    const appId = String(body.app_id || "");
    const { data: prof } = await admin.from("profiles").select("*").eq("app_id", appId).maybeSingle();
    if (!prof) return json({ error: "Anggota tim tidak ditemukan" }, 404);
    if (prof.role === "approver" && me.role !== "approver") return json({ error: "Akun Pemilik hanya bisa diubah Pemilik" }, 403);
    const pw = String(body.password || "");
    if (pw.length < 8) return json({ error: "Password minimal 8 karakter" }, 400);

    if (body.action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Email tidak valid" }, 400);
      if (prof.user_id) return json({ error: "Anggota ini sudah punya akun" }, 409);
      await admin.from("profiles").update({ email }).eq("app_id", appId);
      const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ user_id: data.user.id, email }).eq("app_id", appId);
      return json({ ok: true });
    }
    if (body.action === "reset") {
      if (!prof.user_id) return json({ error: "Belum ada akun" }, 404);
      const { error } = await admin.auth.admin.updateUserById(prof.user_id, { password: pw });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    return json({ error: "Aksi tidak dikenal" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
