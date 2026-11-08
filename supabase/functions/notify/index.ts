// Branded email notifications for the client portal.
// Modes (called by the scheduler with the shared secret):
//   instant   — every few minutes: new decisions for clients, client actions and messages for the team
//   reminders — daily: decisions coming due, unsigned change orders
//   digest    — Fridays: "Your home this week"
//   morning   — weekday mornings: one summary for team members who chose it, instead of an email per item
// Staff can also call { mode: "preview", project_id } with their own sign-in to see this week's email.
// Emails go out only when RESEND_API_KEY and FROM_EMAIL are set; otherwise they are logged as previews.
// Demo addresses (example.com) are never emailed.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const FROM = Deno.env.get("FROM_EMAIL") || "";
const TZ = "America/New_York";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-notify-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// ---------- small helpers ----------
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number) => (n < 0 ? "−" : "") + "$" + Math.abs(Math.round(+n || 0)).toLocaleString("en-US");
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + "$" + Math.abs(Math.round(+n || 0)).toLocaleString("en-US");
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const today = () => ymd(new Date());
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fd = (iso?: string | null, o: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }) => iso ? new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { ...o, timeZone: "UTC" }) : "";
const first = (n?: string | null) => (n || "").split(" ")[0] || "there";
const isoWeek = () => { const d = new Date(today() + "T12:00:00Z"); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3); const y = d.getUTCFullYear(); const w1 = new Date(Date.UTC(y, 0, 4)); return `${y}-W${String(1 + Math.round(((+d - +w1) / 864e5 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7)).padStart(2, "0")}`; };
const ROM = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV"];

type Profile = { id: string; email: string; full_name: string | null; role: string; builder_id: string; email_updates: boolean; email_digest: boolean; email_mode?: string | null; phone?: string | null; title?: string | null };
type Ctx = { projects: Map<string, any>; builders: Map<string, any>; profiles: Map<string, Profile>; members: Map<string, string[]> };

async function loadCtx(): Promise<Ctx> {
  const [pr, bu, pf, mm] = await Promise.all([
    admin.from("projects").select("*").eq("archived", false),
    admin.from("builders").select("*"),
    admin.from("profiles").select("id,email,full_name,role,builder_id,email_updates,email_digest,email_mode,phone,title"),
    admin.from("project_members").select("project_id,user_id"),
  ]);
  const members = new Map<string, string[]>();
  (mm.data || []).forEach((m) => members.set(m.project_id, [...(members.get(m.project_id) || []), m.user_id]));
  return {
    projects: new Map((pr.data || []).map((p) => [p.id, p])),
    builders: new Map((bu.data || []).map((b) => [b.id, b])),
    profiles: new Map((pf.data || []).map((p) => [p.id, p as Profile])),
    members,
  };
}
const clientsOf = (c: Ctx, pid: string) => (c.members.get(pid) || []).map((id) => c.profiles.get(id)).filter((p): p is Profile => !!p && !!p.email);
function teamFor(c: Ctx, pid: string, area?: string | null): Profile[] {
  const p = c.projects.get(pid); if (!p) return [];
  const assigned = area && p.duties?.[area] && c.profiles.get(p.duties[area]);
  if (assigned) return [assigned];
  const pm = p.pm_id && c.profiles.get(p.pm_id);
  if (pm) return [pm];
  return [...c.profiles.values()].filter((x) => x.builder_id === p.builder_id && x.role === "admin");
}
// Team members to email right now: those who chose a morning summary only hear about urgent items immediately
const teamNow = (c: Ctx, pid: string, area?: string | null, urgent = false) => teamFor(c, pid, area).filter((u) => u.email_updates && (urgent || u.email_mode !== "daily"));
const isClient = (c: Ctx, id: string | null) => !!id && c.profiles.get(id)?.role === "client";
const nameOf = (c: Ctx, id: string | null) => (id && (c.profiles.get(id)?.full_name || c.profiles.get(id)?.email)) || "Your team";

async function signedUrl(path?: string | null) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const { data } = await admin.storage.from("project-files").createSignedUrl(path, 60 * 60 * 24 * 14);
  return data?.signedUrl || null;
}

// ---------- email layout ----------
function layout(b: any, p: any, o: { preheader: string; eyebrow: string; title: string; body: string; cta?: { label: string; url: string }; hero?: string | null; to?: Profile }) {
  const s = b.settings || {}, k = s.colors || {};
  const C = { bg: k.bg || "#F1F0EC", surface: k.surface || "#FFFFFF", ink: k.ink || "#1F2123", muted: k.muted || "#67696B", line: k.line || "#D7D4CC", accent: k.accent || "#7D6744", btn: k.btn || "#2A2D2F", btnInk: k.btnInk || "#F4F1E9" };
  const serif = `'Cormorant Garamond', Georgia, 'Times New Roman', serif`, sans = `Jost, 'Avenir Next', Helvetica, Arial, sans-serif`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;1,500&family=Jost:wght@400;500&display=swap" rel="stylesheet">
<title>${esc(o.title.replace(/<[^>]+>/g, ""))}</title></head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:36px 14px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
<tr><td align="center" style="padding:0 0 28px">${s.logo_url ? `<img src="${esc(s.logo_url)}" width="170" alt="${esc(s.from_name || b.name)}" style="display:block;width:170px;max-width:60%;height:auto;border:0">` : `<div style="font-family:${serif};font-size:26px;letter-spacing:.14em;color:${C.ink}">${esc(b.name)}</div>`}</td></tr>
${o.hero ? `<tr><td style="padding:0;line-height:0"><img src="${esc(o.hero)}" width="600" alt="" style="display:block;width:100%;height:auto;border:0"></td></tr>` : ""}
<tr><td style="background:${C.surface};border:1px solid ${C.line};${o.hero ? "border-top:0;" : ""}padding:40px 40px 38px">
  <div style="font-family:${sans};font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:${C.accent};margin:0 0 14px">${o.eyebrow}</div>
  <h1 style="font-family:${serif};font-weight:500;font-size:32px;line-height:1.15;color:${C.ink};margin:0 0 18px">${o.title}</h1>
  <div style="font-family:${sans};font-size:15.5px;line-height:1.65;color:${C.ink}">${o.body}</div>
  ${o.cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:30px 0 0"><tr><td style="background:${C.btn}"><a href="${esc(o.cta.url)}" style="display:inline-block;padding:15px 30px;font-family:${sans};font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:${C.btnInk};text-decoration:none">${esc(o.cta.label)}</a></td></tr></table>` : ""}
</td></tr>
<tr><td style="padding:26px 10px 0;text-align:center;font-family:${sans};font-size:12px;line-height:1.7;color:${C.muted}">
  <div style="font-family:${serif};font-size:17px;color:${C.ink};margin-bottom:4px">${esc(p.name)}</div>
  ${esc([p.lot, p.address].filter(Boolean).join(" · "))}<br>
  ${esc(s.from_name || b.name)}${s.office ? " · " + esc(s.office) : ""}<br>
  <span style="color:${C.muted}">Emails about your home come from the client portal. You can change which emails you receive under <a href="${esc(s.portal_url || "")}" style="color:${C.muted}">Your details</a>.</span>
</td></tr>
</table></td></tr></table></body></html>`;
}
const P_ = (t: string) => `<p style="margin:0 0 14px">${t}</p>`;
const quote = (t: string, accent = "#7D6744") => `<div style="border-left:2px solid ${accent};padding:4px 0 4px 16px;margin:6px 0 18px;font-family:'Cormorant Garamond',Georgia,serif;font-size:21px;line-height:1.4">${t}</div>`;
const rows = (pairs: [string, string][]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;border-top:1px solid #D7D4CC">${pairs.map(([a, b]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #D7D4CC;color:#67696B;font-size:14px">${a}</td><td align="right" style="padding:10px 0;border-bottom:1px solid #D7D4CC;font-size:14px">${b}</td></tr>`).join("")}</table>`;
const link = (b: any, view: string) => `${(b.settings?.portal_url || "").replace(/#.*$/, "")}#${view}`;

// ---------- sending ----------
const results: Record<string, number> = {};
async function send(c: Ctx, to: Profile, pid: string, kind: string, ref: string, subject: string, html: string, replyTo?: string | null) {
  const { data: row, error } = await admin.from("notifications").insert({ project_id: pid, user_id: to.id, kind, ref_key: ref, to_email: to.email, subject, html }).select("id").maybeSingle();
  if (error) { if (error.code === "23505") return; throw error; }
  let status = "preview", err: string | null = null;
  if (/@example\.(com|org|net)$/i.test(to.email)) { status = "skipped"; err = "Demo address, not emailed"; }
  else if (RESEND && FROM) {
    const b = c.builders.get(c.projects.get(pid)?.builder_id);
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${b?.settings?.from_name || b?.name || "Client portal"} <${FROM}>`, to: [to.email], subject, html, reply_to: replyTo || undefined }) });
    if (r.ok) status = "sent"; else { status = "failed"; err = (await r.text()).slice(0, 500); }
  }
  await admin.from("notifications").update({ status, error: err }).eq("id", row!.id);
  results[status] = (results[status] || 0) + 1;
}

// ---------- instant ----------
async function instant(c: Ctx) {
  const since = new Date(Date.now() - 48 * 3600e3).toISOString();
  const pids = [...c.projects.keys()];
  if (!pids.length) return;
  const q = (t: string) => admin.from(t).select("*").in("project_id", pids);
  const [qs, cos, sels, opts, ups, msgs, evs, notes, threads, warr] = await Promise.all([
    q("questions").or(`created_at.gte.${since},answered_at.gte.${since}`),
    q("change_orders").or(`created_at.gte.${since},signed_at.gte.${since}`),
    q("selections").or(`opened_at.gte.${since},submitted_at.gte.${since}`),
    q("selection_options"),
    q("updates").eq("notify_now", true).gte("created_at", since),
    q("messages").gte("created_at", since).order("created_at"),
    q("events").eq("status", "requested").gte("created_at", since),
    q("notes").gte("created_at", since),
    q("threads"),
    q("warranty_requests").or(`created_at.gte.${since},scheduled_at.gte.${since},resolved_at.gte.${since}`),
  ]);
  const ctxOf = (pid: string) => ({ p: c.projects.get(pid), b: c.builders.get(c.projects.get(pid)?.builder_id) });

  for (const x of qs.data || []) {
    const { p, b } = ctxOf(x.project_id); if (!p || !b) continue;
    const pm = teamFor(c, x.project_id)[0];
    if (x.status === "open" && x.created_at >= since) for (const to of clientsOf(c, x.project_id).filter((u) => u.email_updates))
      await send(c, to, x.project_id, "question", x.id, `${first(nameOf(c, x.asked_by))} needs your answer: ${x.question.split(/[:?]/)[0]}`, layout(b, p, {
        preheader: x.due_date ? `Needed by ${fd(x.due_date)}.` : "A quick decision for your home.", eyebrow: "A decision for you",
        title: `${esc(first(to.full_name))}, we need <em>your answer</em>`,
        body: quote(esc(x.question)) + (x.why ? P_(`<span style="color:#7D6744">${esc(x.why)}</span>`) : "") + (x.due_date ? P_(`Please answer by <b>${fd(x.due_date)}</b>.`) : "") + (x.options?.length ? P_(`You can choose from ${x.options.map((o: string) => `<i>${esc(o)}</i>`).join(", ")}, or write your own answer.`) : ""),
        cta: { label: "Answer now", url: link(b, "questions") } }), pm?.email);
    if (x.status === "answered" && x.answered_at >= since) for (const to of (x.asked_by && !isClient(c, x.asked_by) && c.profiles.get(x.asked_by) ? [c.profiles.get(x.asked_by)!] : teamFor(c, x.project_id)).filter((u) => u.email_updates && u.email_mode !== "daily"))
      await send(c, to, x.project_id, "answered", x.id, `${nameOf(c, x.answered_by)} answered: ${x.question.split(/[:?]/)[0]}`, layout(b, p, {
        preheader: x.answer, eyebrow: p.name, title: `${esc(first(nameOf(c, x.answered_by)))} <em>answered</em>`,
        body: P_(`<span style="color:#67696B">${esc(x.question)}</span>`) + quote(esc(x.answer)), cta: { label: "Open the home", url: link(b, "questions") } }));
  }

  for (const x of cos.data || []) {
    const { p, b } = ctxOf(x.project_id); if (!p || !b) continue;
    const no = `CO-${String(x.number).padStart(2, "0")}`;
    if (x.status === "pending" && x.created_at >= since) for (const to of clientsOf(c, x.project_id).filter((u) => u.email_updates))
      await send(c, to, x.project_id, "co", x.id, `${no} is ready for your signature: ${x.title}`, layout(b, p, {
        preheader: `${signed(x.amount)}${x.days ? ` · ${x.days} days added` : ""}. Nothing changes until you sign.`, eyebrow: `Change order ${no}`, title: esc(x.title),
        body: (x.details ? P_(esc(x.details)) : "") + rows([["Price change", signed(x.amount)], ["Schedule", x.days ? `${x.days} day${x.days > 1 ? "s" : ""} added` : "No change"]]) + P_(`<span style="color:#67696B;font-size:14px">Nothing changes until you review and sign.</span>`),
        cta: { label: "Review and sign", url: link(b, "changes") } }), teamFor(c, x.project_id)[0]?.email);
    if (["approved", "declined"].includes(x.status) && x.signed_at >= since) for (const to of teamNow(c, x.project_id))
      await send(c, to, x.project_id, "co_" + x.status, x.id, `${nameOf(c, x.signed_by)} ${x.status === "approved" ? "signed" : "declined"} ${no}: ${x.title}`, layout(b, p, {
        preheader: x.status === "approved" ? `Signed ${esc(x.signature)}.` : (x.decline_note || "Declined."), eyebrow: p.name,
        title: `${no} <em>${x.status === "approved" ? "signed" : "declined"}</em>`,
        body: P_(esc(x.title)) + rows([["Price change", signed(x.amount)], [x.status === "approved" ? "Signed" : "Declined by", x.status === "approved" ? `${esc(x.signature)} · ${esc(nameOf(c, x.signed_by))}` : esc(nameOf(c, x.signed_by))]]) + (x.decline_note ? quote(esc(x.decline_note)) : ""),
        cta: { label: "Open change orders", url: link(b, "changes") } }));
  }

  for (const x of sels.data || []) {
    const { p, b } = ctxOf(x.project_id); if (!p || !b) continue;
    const os = (opts.data || []).filter((o) => o.selection_id === x.id).sort((a, z) => a.position - z.position);
    if (x.status === "open" && x.opened_at >= since && os.length) for (const to of clientsOf(c, x.project_id).filter((u) => u.email_updates)) {
      const img = await signedUrl(os.find((o) => o.image_path)?.image_path);
      await send(c, to, x.project_id, "selection", x.id + ":" + x.opened_at, `Time to choose: ${x.category}`, layout(b, p, {
        preheader: `${os.length} options${x.due_date ? `, needed by ${fd(x.due_date)}` : ""}.`, eyebrow: b.settings?.labels?.designCenter || "Design Center", title: `Time to choose your <em>${esc(x.category.toLowerCase())}</em>`, hero: img,
        body: P_(`${os.length} options are ready for you${x.area ? ` for the ${esc(x.area.toLowerCase())}` : ""}.`) + rows(os.map((o) => [esc(o.name), +x.allowance ? `${money(o.price)} <span style="color:${+o.price > +x.allowance ? "#9A3A2D" : "#3D6A52"}">${+o.price > +x.allowance ? signed(o.price - x.allowance) + " over" : money(x.allowance - o.price) + " under"}</span>` : (+o.price ? money(o.price) : "Included")])) + (x.due_date ? P_(`Please choose by <b>${fd(x.due_date)}</b> so materials arrive on time.`) : ""),
        cta: { label: "See the options", url: link(b, "selections") } }), teamFor(c, x.project_id)[0]?.email);
    }
    if (x.status === "submitted" && x.submitted_at >= since) {
      const o = os.find((z) => z.id === x.chosen_option_id);
      for (const to of teamNow(c, x.project_id, "selections"))
        await send(c, to, x.project_id, "chosen", x.id + ":" + x.submitted_at, `${nameOf(c, x.submitted_by)} chose ${o?.name || "an option"} for ${x.category}`, layout(b, p, {
          preheader: "Ready for you to confirm and order.", eyebrow: p.name, title: `${esc(x.category)}: <em>${esc(o?.name || "chosen")}</em>`,
          body: P_(`${esc(nameOf(c, x.submitted_by))} submitted a selection.`) + (o && +x.allowance ? rows([["Price", money(o.price)], ["Allowance", money(x.allowance)], ["Difference", signed(o.price - x.allowance)]]) : ""),
          cta: { label: "Confirm and order", url: link(b, "selections") } }));
    }
  }

  for (const x of ups.data || []) {
    const { p, b } = ctxOf(x.project_id); if (!p || !b) continue;
    const { data: ph } = await admin.from("update_photos").select("*").eq("update_id", x.id).order("position");
    const imgs = await Promise.all((ph || []).slice(0, 3).map((z) => signedUrl(z.path)));
    for (const to of clientsOf(c, x.project_id).filter((u) => u.email_updates))
      await send(c, to, x.project_id, "update_now", x.id, `New from the site: ${p.name}`, layout(b, p, {
        preheader: (x.body || "New photographs from your home.").slice(0, 120), eyebrow: "From the site", title: `New photographs of <em>your home</em>`, hero: imgs[0],
        body: (x.body ? quote(esc(x.body)) : "") + (imgs.length > 1 ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${imgs.slice(1).map((u) => `<td style="padding:0 4px 0 0" width="50%"><img src="${esc(u)}" width="100%" style="display:block;width:100%;height:auto" alt=""></td>`).join("")}</tr></table>` : "") + P_(`<span style="color:#67696B;font-size:14px">— ${esc(nameOf(c, x.author_id))}</span>`),
        cta: { label: "See all photographs", url: link(b, "updates") } }));
  }

  for (const x of msgs.data || []) {
    const { p, b } = ctxOf(x.project_id); if (!p || !b) continue;
    const th = (threads.data || []).find((t) => t.id === x.thread_id);
    const recips = (isClient(c, x.author_id) ? teamNow(c, x.project_id, /design/i.test(th?.name || "") ? "selections" : null) : clientsOf(c, x.project_id).filter((u) => u.email_updates)).filter((u) => u.id !== x.author_id);
    for (const to of recips) {
      const { data: recent } = await admin.from("notifications").select("id").eq("user_id", to.id).eq("kind", "message").eq("project_id", x.project_id).gte("created_at", new Date(Date.now() - 15 * 60e3).toISOString()).limit(1);
      if (recent?.length) continue; // they were just emailed about this conversation
      await send(c, to, x.project_id, "message", x.id, `New message from ${nameOf(c, x.author_id)}`, layout(b, p, {
        preheader: x.body.slice(0, 120), eyebrow: th?.name || "Messages", title: `A message from <em>${esc(first(nameOf(c, x.author_id)))}</em>`,
        body: quote(esc(x.body)), cta: { label: "Reply", url: link(b, "messages") } }), isClient(c, x.author_id) ? null : c.profiles.get(x.author_id)?.email);
    }
  }

  for (const x of evs.data || []) {
    const { p, b } = ctxOf(x.project_id); if (!p || !b) continue;
    for (const to of teamNow(c, x.project_id, "visits"))
      await send(c, to, x.project_id, "request", x.id, `${nameOf(c, x.requested_by)} requested a ${x.kind.toLowerCase()}`, layout(b, p, {
        preheader: `${fd(x.starts_on)}${x.time_label ? ", " + x.time_label.toLowerCase() : ""}.`, eyebrow: p.name, title: `${esc(x.kind)} <em>requested</em>`,
        body: rows([["Preferred date", fd(x.starts_on)], ["Time of day", esc(x.time_label || "Any")]]) + (x.note ? quote(esc(x.note)) : ""), cta: { label: "Confirm in the calendar", url: link(b, "calendar") } }));
  }

  for (const x of warr.data || []) {
    const { p, b } = ctxOf(x.project_id); if (!p || !b) continue;
    const no = `W-${String(x.number).padStart(2, "0")}`, img = x.photos?.length ? await signedUrl(x.photos[0]) : undefined;
    if (x.created_at >= since && isClient(c, x.created_by)) for (const to of teamNow(c, x.project_id, "warranty", x.urgency === "urgent"))
      await send(c, to, x.project_id, "warranty", x.id, `${x.urgency === "urgent" ? "Urgent: " : ""}${no} warranty request from ${first(nameOf(c, x.created_by))}: ${x.title}`, layout(b, p, {
        preheader: [x.room, x.details].filter(Boolean).join(" · ").slice(0, 120) || "A new warranty request.", eyebrow: `Warranty ${no}${x.urgency === "urgent" ? " · urgent" : ""}`, title: esc(x.title), hero: img,
        body: rows([["Home", esc(p.name)], ["Where", esc(x.room || "Not given")], ["From", esc(nameOf(c, x.created_by))]]) + (x.details ? quote(esc(x.details)) : "") + (x.photos?.length > 1 ? P_(`${x.photos.length} photos attached.`) : ""),
        cta: { label: "Schedule a visit", url: link(b, "warranty") } }));
    if (x.status === "scheduled" && x.scheduled_at >= since && x.scheduled_for) for (const to of clientsOf(c, x.project_id).filter((u) => u.email_updates))
      await send(c, to, x.project_id, "warranty_scheduled", x.id + ":" + x.scheduled_for, `Your warranty visit is scheduled: ${fd(x.scheduled_for, { weekday: "long", month: "long", day: "numeric" })}`, layout(b, p, {
        preheader: `${x.title}. ${x.scheduled_window || ""}`.trim(), eyebrow: `Warranty ${no}`, title: `We’ll see you <em>${fd(x.scheduled_for, { weekday: "long", month: "long", day: "numeric" })}</em>`,
        body: rows([["Request", esc(x.title)], ["Date", fd(x.scheduled_for, { weekday: "long", month: "long", day: "numeric" })], ["Time", esc(x.scheduled_window || "To be confirmed")]]) + (x.response ? quote(esc(x.response)) : ""),
        cta: { label: "See the details", url: link(b, "warranty") } }), teamFor(c, x.project_id)[0]?.email);
    if (["resolved", "not_covered"].includes(x.status) && x.resolved_at >= since) for (const to of clientsOf(c, x.project_id).filter((u) => u.email_updates))
      await send(c, to, x.project_id, "warranty_" + x.status, x.id, x.status === "resolved" ? `Taken care of: ${x.title}` : `About your request: ${x.title}`, layout(b, p, {
        preheader: (x.response || "").slice(0, 120), eyebrow: `Warranty ${no}`, title: x.status === "resolved" ? `Taken <em>care of</em>` : `About your <em>request</em>`,
        body: P_(esc(x.title)) + (x.response ? quote(esc(x.response)) : "") + P_(`<span style="color:#67696B;font-size:14px">If anything else comes up, you can request service any time from your portal.</span>`),
        cta: { label: "Open your warranty page", url: link(b, "warranty") } }), teamFor(c, x.project_id)[0]?.email);
  }

  for (const x of notes.data || []) {
    if (!isClient(c, x.author_id)) continue;
    const { p, b } = ctxOf(x.project_id); if (!p || !b) continue;
    for (const to of teamNow(c, x.project_id, "notes"))
      await send(c, to, x.project_id, "note", x.id, `New note from ${nameOf(c, x.author_id)}${x.room ? ` · ${x.room}` : ""}`, layout(b, p, {
        preheader: x.body.slice(0, 120), eyebrow: x.room || p.name, title: `A note from <em>${esc(first(nameOf(c, x.author_id)))}</em>`,
        body: quote(esc(x.body)), cta: { label: "Review notes", url: link(b, "walkthrough") } }));
  }
}

// ---------- reminders ----------
async function reminders(c: Ctx) {
  const t = today(), pids = [...c.projects.keys()];
  if (!pids.length) return;
  const [qs, sels, cos] = await Promise.all([
    admin.from("questions").select("*").in("project_id", pids).eq("status", "open").in("due_date", [addDays(t, 1), addDays(t, 3)]),
    admin.from("selections").select("*").in("project_id", pids).eq("status", "open").in("due_date", [addDays(t, 2), addDays(t, 7)]),
    admin.from("change_orders").select("*").in("project_id", pids).eq("status", "pending").lte("created_at", new Date(Date.now() - 4 * 864e5).toISOString()),
  ]);
  for (const x of qs.data || []) {
    const p = c.projects.get(x.project_id), b = c.builders.get(p?.builder_id); if (!p || !b) continue;
    const soon = x.due_date === addDays(t, 1);
    for (const to of clientsOf(c, x.project_id).filter((u) => u.email_updates))
      await send(c, to, x.project_id, soon ? "remind_q1" : "remind_q3", x.id, `Reminder: your answer is needed by ${fd(x.due_date, { weekday: "long" })}`, layout(b, p, {
        preheader: x.question.slice(0, 120), eyebrow: "A gentle reminder", title: `Your answer is needed <em>${soon ? "tomorrow" : "by " + fd(x.due_date, { weekday: "long" })}</em>`,
        body: quote(esc(x.question)) + (x.why ? P_(`<span style="color:#7D6744">${esc(x.why)}</span>`) : ""), cta: { label: "Answer now", url: link(b, "questions") } }), teamFor(c, x.project_id)[0]?.email);
  }
  for (const x of sels.data || []) {
    const p = c.projects.get(x.project_id), b = c.builders.get(p?.builder_id); if (!p || !b) continue;
    const soon = x.due_date === addDays(t, 2);
    for (const to of clientsOf(c, x.project_id).filter((u) => u.email_updates))
      await send(c, to, x.project_id, soon ? "remind_s2" : "remind_s7", x.id, `Reminder: ${x.category} due ${fd(x.due_date, { weekday: "long", month: "short", day: "numeric" })}`, layout(b, p, {
        preheader: "So materials arrive before the craftsmen do.", eyebrow: "A gentle reminder", title: `Your <em>${esc(x.category.toLowerCase())}</em> selection is due ${soon ? "soon" : "next week"}`,
        body: P_(`Please choose by <b>${fd(x.due_date)}</b> so materials arrive on schedule.`), cta: { label: "See the options", url: link(b, "selections") } }), teamFor(c, x.project_id)[0]?.email);
  }
  for (const x of cos.data || []) {
    const p = c.projects.get(x.project_id), b = c.builders.get(p?.builder_id); if (!p || !b) continue;
    const no = `CO-${String(x.number).padStart(2, "0")}`;
    for (const to of clientsOf(c, x.project_id).filter((u) => u.email_updates))
      await send(c, to, x.project_id, "remind_co", x.id, `Reminder: ${no} is waiting for your signature`, layout(b, p, {
        preheader: x.title, eyebrow: "A gentle reminder", title: `${no} is <em>waiting for you</em>`,
        body: P_(esc(x.title)) + rows([["Price change", signed(x.amount)]]), cta: { label: "Review and sign", url: link(b, "changes") } }), teamFor(c, x.project_id)[0]?.email);
  }
}

// ---------- weekly digest ----------
async function digestFor(c: Ctx, pid: string, to: Profile | null, preview = false) {
  const p = c.projects.get(pid), b = c.builders.get(p?.builder_id); if (!p || !b) return null;
  const since = new Date(Date.now() - 7 * 864e5).toISOString(), t = today();
  const [ups, phases, qs, cos, sels, evs] = await Promise.all([
    admin.from("updates").select("*").eq("project_id", pid).gte("created_at", since).order("created_at"),
    admin.from("phases").select("*").eq("project_id", pid).order("position"),
    admin.from("questions").select("*").eq("project_id", pid).eq("status", "open"),
    admin.from("change_orders").select("*").eq("project_id", pid).eq("status", "pending"),
    admin.from("selections").select("*").eq("project_id", pid).eq("status", "open"),
    admin.from("events").select("*").eq("project_id", pid).gte("starts_on", t).lte("starts_on", addDays(t, 14)).neq("status", "requested").order("starts_on"),
  ]);
  let updates = ups.data || [], fallback = false;
  if (!updates.length && preview) { const { data } = await admin.from("updates").select("*").eq("project_id", pid).order("created_at", { ascending: false }).limit(2); updates = (data || []).reverse(); fallback = updates.length > 0; }
  const waiting = [
    ...(qs.data || []).map((x) => [esc(x.question.split(/[:?]/)[0]), x.due_date ? "Answer by " + fd(x.due_date, { month: "short", day: "numeric" }) : "Answer"]),
    ...(cos.data || []).map((x) => [`CO-${String(x.number).padStart(2, "0")} · ${esc(x.title)}`, "Signature"]),
    ...(sels.data || []).map((x) => [esc(x.category), x.due_date ? "Choose by " + fd(x.due_date, { month: "short", day: "numeric" }) : "Choose"]),
  ] as [string, string][];
  if (!updates.length && !waiting.length && !preview) return null;
  const ph = phases.data || [], cur = ph.find((x) => x.status === "current");
  const pct = ph.length ? Math.round((ph.filter((x) => x.status === "done").length + (cur ? 0.4 : 0)) / ph.length * 100) : 0;
  const { data: photos } = updates.length ? await admin.from("update_photos").select("*").in("update_id", updates.map((u) => u.id)).order("position") : { data: [] as any[] };
  const urls = await Promise.all((photos || []).slice(0, 5).map((x) => signedUrl(x.path)));
  const hero = urls[0] || await signedUrl(p.cover_path);
  const days = p.closing_date ? Math.round((+new Date(p.closing_date + "T12:00:00Z") - +new Date(t + "T12:00:00Z")) / 864e5) : null;
  const sans = `Jost, 'Avenir Next', Helvetica, Arial, sans-serif`;
  const label = (s: string) => `<div style="font-family:${sans};font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#7D6744;margin:30px 0 10px">${s}</div>`;
  const body =
    P_(`Good afternoon${to ? ", " + esc(first(to.full_name)) : ""}. Here is where your home stands this week.`) +
    rows([
      ...(cur ? [["Now underway", `<span style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;color:#7D6744">${ROM[ph.indexOf(cur)] || ""}</span> ${esc(cur.name.split(":")[0])}`] as [string, string]] : []),
      ["Progress", `${pct}% complete`],
      ...(days !== null && days >= 0 ? [[b.settings?.labels?.closing || "Closing", `${fd(p.closing_date, { month: "long", day: "numeric" })} · ${days} days`] as [string, string]] : []),
    ]) +
    (updates.length ? label(fallback ? "Latest from the site" : "This week on site") + updates.map((u) => quote(esc(u.body || "New photographs from the site."))).join("") +
      (urls.length > 1 ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${urls.slice(1, 5).map((u) => `<td width="25%" style="padding:0 4px 4px 0"><img src="${esc(u)}" width="100%" style="display:block;width:100%;height:auto" alt=""></td>`).join("")}</tr></table>` : "") : "") +
    (waiting.length ? label("Waiting on you") + rows(waiting) : "") +
    ((evs.data || []).length ? label("In the next two weeks") + rows((evs.data || []).map((e) => [`${esc(e.title)}${e.time_label ? ` · ${esc(e.time_label)}` : ""}`, fd(e.starts_on, { weekday: "short", month: "short", day: "numeric" })])) : "");
  const subject = `Your home this week: ${p.name}`;
  const html = layout(b, p, { preheader: updates[0]?.body?.slice(0, 120) || "Where your home stands this week.", eyebrow: `The week of ${fd(addDays(t, -((new Date(t + "T12:00:00Z").getUTCDay() + 6) % 7)), { month: "long", day: "numeric" })}`,
    title: `Your home <em>this week</em>`, hero, body, cta: { label: "Open your portal", url: link(b, "overview") } });
  return { subject, html, pm: teamFor(c, pid)[0] };
}
async function digest(c: Ctx) {
  const wk = isoWeek();
  for (const pid of c.projects.keys()) {
    const p = c.projects.get(pid);
    if (p?.closing_date && p.closing_date < addDays(today(), -14)) continue; // moved in: no weekly build email
    const tos = clientsOf(c, pid).filter((u) => u.email_digest);
    if (!tos.length) continue;
    for (const to of tos) {
      const d = await digestFor(c, pid, to);
      if (d) await send(c, to, pid, "digest", wk, d.subject, d.html, d.pm?.email);
    }
  }
}

// ---------- morning summary for the team ----------
async function morning(c: Ctx) {
  const day = today(), since = new Date(Date.now() - 26 * 3600e3).toISOString();
  const staff = [...c.profiles.values()].filter((u) => u.role !== "client" && u.email && u.email_updates && u.email_mode === "daily");
  const pids = [...c.projects.keys()]; if (!staff.length || !pids.length) return;
  const q = (t: string) => admin.from(t).select("*").in("project_id", pids);
  const [sels, opts, evs, notes, warr, msgs, threads, qs, cos] = await Promise.all([
    q("selections").eq("status", "submitted"), q("selection_options"), q("events").eq("status", "requested"), q("notes").eq("reviewed", false),
    q("warranty_requests").eq("status", "new"), q("messages").order("created_at", { ascending: false }).limit(500), q("threads"),
    q("questions").eq("status", "answered").gte("answered_at", since), q("change_orders").in("status", ["approved", "declined"]).gte("signed_at", since)]);
  type Item = { pid: string; area: string | null; owner?: string; k: string; t: string; d: string };
  const items: Item[] = [], fyi: Item[] = [];
  const owner = (pid: string, area: string | null) => { const p = c.projects.get(pid); return (area && p?.duties?.[area]) || p?.pm_id; };
  for (const r of warr.data || []) items.push({ pid: r.project_id, area: "warranty", k: r.urgency === "urgent" ? "Urgent warranty" : "Warranty", t: `W-${String(r.number).padStart(2, "0")} · ${r.title}`, d: r.room || "" });
  const last: Record<string, any> = {}; for (const m of msgs.data || []) if (!last[m.thread_id]) last[m.thread_id] = m;
  for (const m of Object.values(last)) if (isClient(c, m.author_id)) { const th = (threads.data || []).find((t) => t.id === m.thread_id);
    items.push({ pid: m.project_id, area: /design/i.test(th?.name || "") ? "selections" : null, k: "Reply", t: m.body.length > 90 ? m.body.slice(0, 90) + "…" : m.body, d: first(nameOf(c, m.author_id)) }); }
  for (const x of sels.data || []) items.push({ pid: x.project_id, area: "selections", k: "Confirm", t: x.category, d: `chose ${(opts.data || []).find((o) => o.id === x.chosen_option_id)?.name || "an option"}` });
  for (const e of evs.data || []) items.push({ pid: e.project_id, area: "visits", k: "Visit request", t: e.title.replace(" (requested)", ""), d: fd(e.starts_on, { weekday: "short", month: "short", day: "numeric" }) });
  for (const n of notes.data || []) if (isClient(c, n.author_id)) items.push({ pid: n.project_id, area: "notes", k: "Note", t: n.body.slice(0, 90), d: n.room || "" });
  for (const x of qs.data || []) fyi.push({ pid: x.project_id, area: null, owner: !isClient(c, x.asked_by) ? x.asked_by : undefined, k: "Answered", t: `${first(nameOf(c, x.answered_by))}: ${x.answer}`, d: x.question.split(/[:?]/)[0] });
  for (const x of cos.data || []) fyi.push({ pid: x.project_id, area: null, k: x.status === "approved" ? "Signed" : "Declined", t: `CO-${String(x.number).padStart(2, "0")} · ${x.title}`, d: first(nameOf(c, x.signed_by)) });
  const sans = `Jost, 'Avenir Next', Helvetica, Arial, sans-serif`;
  const label = (s: string) => `<div style="font-family:${sans};font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#7D6744;margin:26px 0 8px">${s}</div>`;
  for (const to of staff) {
    const mineOf = (xs: Item[]) => xs.filter((i) => c.projects.get(i.pid)?.builder_id === to.builder_id && (i.owner || owner(i.pid, i.area)) === to.id);
    const mine = mineOf(items), news = mineOf(fyi);
    if (!mine.length && !news.length) continue;
    const b = c.builders.get(to.builder_id); if (!b) continue;
    const homes = [...new Set([...mine, ...news].map((i) => i.pid))];
    const body = P_(mine.length ? `${mine.length} thing${mine.length > 1 ? "s" : ""} need${mine.length > 1 ? "" : "s"} you${homes.length > 1 ? ` across ${homes.length} homes` : ""} this morning.` : "Nothing needs you this morning. Here is what happened since yesterday.") +
      homes.map((pid) => { const its = mine.filter((i) => i.pid === pid), ns = news.filter((i) => i.pid === pid);
        return label(esc(c.projects.get(pid)?.name || "")) + rows([...its, ...ns].map((i) => [`<b style="font-weight:500">${esc(i.k)}</b> · ${esc(i.t)}`, esc(i.d)] as [string, string])); }).join("");
    const n = mine.length;
    await send(c, to, homes[0], "morning", day, n ? `Today: ${n} thing${n > 1 ? "s" : ""} need${n > 1 ? "" : "s"} you` : "Today: all caught up", layout(b, { name: b.settings?.from_name || b.name }, {
      preheader: mine.slice(0, 3).map((i) => i.t).join(" · ").slice(0, 120) || "Since yesterday", eyebrow: fd(day), title: `Good morning, <em>${esc(first(to.full_name))}</em>`, body,
      cta: { label: "Open Today", url: link(b, "homes") } }));
  }
}

// ---------- entry ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const secret = req.headers.get("x-notify-secret");
  const { data: okSecret } = secret ? await admin.rpc("check_notify_secret", { s: secret }) : { data: false };

  if (!okSecret) {
    // Signed-in staff may preview this week's email for one of their homes. Nothing is sent.
    if (body.mode !== "preview" || !body.project_id) return json({ error: "Not allowed" }, 401);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Please sign in again." }, 401);
    const { data: me } = await admin.from("profiles").select("role,builder_id").eq("id", user.id).single();
    const { data: proj } = await admin.from("projects").select("builder_id").eq("id", body.project_id).single();
    if (!me || !proj || !["admin", "staff"].includes(me.role) || me.builder_id !== proj.builder_id) return json({ error: "Not allowed" }, 403);
    const c = await loadCtx();
    const d = await digestFor(c, body.project_id, clientsOf(c, body.project_id)[0] || null, true);
    return d ? json({ subject: d.subject, html: d.html }) : json({ error: "Home not found" }, 404);
  }

  const c = await loadCtx();
  const mode = body.mode || "instant";
  for (const k of Object.keys(results)) delete results[k];
  try {
    if (mode === "instant") await instant(c);
    else if (mode === "reminders") await reminders(c);
    else if (mode === "digest") await digest(c);
    else if (mode === "morning") await morning(c);
    else return json({ error: "Unknown mode" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e), results }, 500);
  }
  return json({ ok: true, mode, results, sending: !!(RESEND && FROM) });
});
