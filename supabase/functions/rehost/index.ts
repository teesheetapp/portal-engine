// One-time maintenance: copy images that are linked from another website into the portal's
// own storage, so they keep working if that site changes and can be used in share cards.
// Called by the database scheduler secret only (same secret as the notify function).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BUCKET = "project-files";

Deno.serve(async (req) => {
  const secret = req.headers.get("x-notify-secret") || "";
  const { data: ok } = await sb.rpc("check_notify_secret", { s: secret });
  if (!ok) return new Response("unauthorized", { status: 401 });

  const done: Record<string, string> = {};       // remote url -> storage path
  const out = { copied: 0, rows: 0, failed: [] as string[] };

  async function copy(url: string, projectId: string) {
    const key = projectId + "|" + url;
    if (done[key]) return done[key];
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    const type = r.headers.get("content-type") || "image/jpeg";
    const name = url.split("/").pop()!.split("?")[0].replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${projectId}/gallery/${name}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, new Uint8Array(await r.arrayBuffer()), { contentType: type, upsert: true });
    if (error) throw error;
    out.copied++; done[key] = path; return path;
  }
  const tables: [string, string][] = [["update_photos", "path"], ["selection_options", "image_path"], ["home_items", "photo_path"], ["wall_photos", "path"], ["projects", "cover_path"]];
  for (const [table, col] of tables) {
    const pidCol = table === "projects" ? "id" : "project_id";
    const { data, error } = await sb.from(table).select(`id, ${pidCol}, ${col}`).like(col, "http%");
    if (error) { out.failed.push(`${table}: ${error.message}`); continue; }
    for (const row of data as Record<string, string>[]) {
      try {
        const path = await copy(row[col], row[pidCol]);
        const { error: e } = await sb.from(table).update({ [col]: path }).eq("id", row.id);
        if (e) throw e; out.rows++;
      } catch (e) { out.failed.push(`${table} ${row.id}: ${(e as Error).message}`); }
    }
  }
  return Response.json(out);
});
