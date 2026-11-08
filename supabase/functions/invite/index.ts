// Invite a homeowner (to one home) or a staff member (to the builder).
// Caller must be signed in as builder staff; only admins can invite staff.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: "Please sign in again." }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: me } = await admin.from("profiles").select("builder_id, role").eq("id", user.id).single();
  if (!me?.builder_id || !["admin", "staff"].includes(me.role)) return json({ error: "Only builder staff can send invitations." }, 403);

  let body: { email?: string; full_name?: string; role?: string; title?: string; phone?: string; project_id?: string; redirect_to?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }

  const email = (body.email ?? "").trim().toLowerCase();
  const role = body.role === "staff" || body.role === "admin" ? body.role : "client";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (role !== "client" && me.role !== "admin") return json({ error: "Only an admin can invite team members." }, 403);
  if (role === "client" && !body.project_id) return json({ error: "Choose the home to invite this client to." }, 400);

  if (body.project_id) {
    const { data: project } = await admin.from("projects").select("builder_id").eq("id", body.project_id).single();
    if (!project || project.builder_id !== me.builder_id) return json({ error: "Home not found." }, 404);
  }

  // Find or invite the user
  let userId: string | null = null;
  let invited = false;
  const { data: existing } = await admin.from("profiles").select("id, builder_id, role").eq("email", email).maybeSingle();
  if (existing) {
    if (existing.builder_id && existing.builder_id !== me.builder_id) return json({ error: "That email belongs to another builder's portal." }, 409);
    userId = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: body.full_name ?? null },
      redirectTo: body.redirect_to,
    });
    if (error || !data.user) return json({ error: error?.message ?? "Could not send the invitation." }, 400);
    userId = data.user.id;
    invited = true;
  }

  const keepRole = existing?.role && existing.builder_id === me.builder_id && existing.role !== "client" ? existing.role : role;
  const { error: pErr } = await admin.from("profiles").upsert({
    id: userId, email, builder_id: me.builder_id, role: keepRole,
    full_name: body.full_name || undefined, title: body.title || undefined, phone: body.phone || undefined,
  });
  if (pErr) return json({ error: pErr.message }, 400);

  if (body.project_id && keepRole === "client") {
    const { error: mErr } = await admin.from("project_members").upsert({ project_id: body.project_id, user_id: userId });
    if (mErr) return json({ error: mErr.message }, 400);
  }

  return json({ ok: true, invited, user_id: userId });
});
