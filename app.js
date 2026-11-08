/* Builder client portal engine
   One engine for every builder. Each builder's site loads its own settings.js (window.PORTAL),
   an optional theme.css, and optional extra pages; nothing about other builders is ever shipped. */
(() => {
'use strict';

/* ================= setup ================= */
const CFG = window.PORTAL;
const params = new URLSearchParams(location.search);
// Current shape: PORTAL.builder = one builder's settings. (Older multi-builder shape still works for local testing.)
const B = CFG.builder || CFG.builders[params.get('builder') || (CFG.hosts || {})[location.hostname] || CFG.defaultBuilder] || CFG.builders[CFG.defaultBuilder];
// Feature switches: every section is on unless the builder's settings turn it off
const FEAT = { questions: true, selections: true, changes: true, messages: true, diary: true, walls: true, manual: true, warranty: true,
  calendar: true, budget: true, documents: true, walkthrough: true, glossary: true, moments: true, ...(B.features || {}) };
const on = v => FEAT[v] !== false;
// Builder-only pages: { id, label, where: 'more' | 'primary', who: 'all' | 'client' | 'staff', eyebrow, title, intro, html or render(Portal) }
const EXTRA = [...(B.pages || []), ...(CFG.pages || [])].filter(x => x && x.id && x.label);
const L = B.labels;
const AUTH_FLOW = (/type=(invite|recovery|signup|magiclink)/.exec(location.hash) || [])[1] || null;
const BUCKET = 'project-files';

const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, detectSessionInUrl: true } });

const S = {
  me: null, builder: null, projects: [], homeStats: {}, pid: null, d: null,
  view: 'overview', urls: {}, draft: [], ui: { openPhase: null, openSel: null, thread: null, docFolder: 'All', docQ: '' },
  profiles: {}, lastSeen: null, poll: null
};

/* ================= brand ================= */
function applyBrand() {
  const c = B.colors, map = { bg:'--bg', surface:'--surface', surface2:'--surface-2', ink:'--ink', muted:'--muted', line:'--line',
    hero:'--navy', hero2:'--navy-2', heroInk:'--navy-ink', heroMuted:'--navy-muted', accent:'--brass', accentBright:'--brass-bright',
    accentSoft:'--brass-soft', btn:'--btn', btnInk:'--btn-ink' };
  const decl = o => Object.entries(map).map(([k,v]) => o[k] ? `${v}:${o[k]};` : '').join('');
  const st = document.createElement('style');
  st.textContent = `:root{${decl(c.light)}--f-display:${B.fonts.display};--f-body:${B.fonts.body};}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${decl(c.dark)}color-scheme:dark}}
:root[data-theme="dark"]{${decl(c.dark)}color-scheme:dark}`;
  document.head.appendChild(st);
  if (B.fonts.href) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = B.fonts.href; document.head.appendChild(l); }
  const th = B.theme || {}, root = document.documentElement;
  ['corners', 'hero', 'density', 'headings', 'texture'].forEach(k => { if (th[k]) root.dataset[k] = th[k]; });
  document.title = `${B.fullName} · ${L.client} portal`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c.light.hero);
}
const logoImg = (cls = '') => `<span class="logo ${cls}"><img class="lg-d" src="${esc(B.logo.onLight)}" alt="${esc(B.fullName)}"><img class="lg-l" src="${esc(B.logo.onDark)}" alt="" aria-hidden="true"></span>`;
const wordmark = () => B.logo
  ? `<a class="wordmark" href="#overview">${logoImg()}</a>`
  : `<a class="wordmark" href="#overview"><b>${esc(B.name)}</b><span>${esc(B.wordmarkSub)}</span></a>`;

/* ================= helpers ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Plain-English glossary: escape text and turn the first mention of each known term into a tappable word
const GLOSS = (B.glossary || []).map((g, i) => ({ ...g, i }));
const GLOSS_RE = (() => {
  const words = GLOSS.flatMap(g => [g.term, ...(g.also || [])].map(w => [w, g.i])).sort((a, b) => b[0].length - a[0].length);
  if (!words.length) return null;
  const map = {}; words.forEach(([w, i]) => { map[w.toLowerCase()] = i; });
  return { re: new RegExp('\\b(' + words.map(([w]) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'gi'), map };
})();
const gloss = text => {
  const h = esc(text); if (!GLOSS_RE || !on('glossary')) return h;
  const seen = new Set();
  return h.replace(GLOSS_RE.re, m => { const i = GLOSS_RE.map[m.toLowerCase()]; if (i == null || seen.has(i)) return m; seen.add(i);
    return `<button type="button" class="term" data-act="term" data-k="${i}" aria-label="${esc(m)}: what this means">${m}</button>`; });
};
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const isoToday = () => { const t = today(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`; };
const D = iso => { if (!iso) return null; const [y,m,d] = iso.slice(0,10).split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (iso, n) => { const d = D(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const fd = (iso, o = {month:'short', day:'numeric'}) => iso ? D(iso).toLocaleDateString('en-US', o) : '';
const fdL = iso => fd(iso, {month:'long', day:'numeric', year:'numeric'});
const ft = ts => { if (!ts) return ''; const d = new Date(ts), t = today(), diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - t) / 864e5);
  return diff === 0 ? 'Today · ' + d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'}) : diff === -1 ? 'Yesterday' : d.toLocaleDateString('en-US', {month:'short', day:'numeric'}); };
const daysTo = iso => iso ? Math.round((D(iso) - today()) / 864e5) : null;
const dueText = iso => { const d = daysTo(iso); if (d === null) return 'no date set'; return d < 0 ? `${-d} days past due` : d === 0 ? 'due today' : d === 1 ? 'due tomorrow' : `due in ${d} days`; };
const money = n => (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(+n || 0)).toLocaleString('en-US');
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + '$' + Math.abs(Math.round(+n || 0)).toLocaleString('en-US');
const ini = n => (n || '?').split(/\s+/).map(w => w[0]).join('').slice(0,2).toUpperCase();
const ROM = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];
const rom = i => ROM[i] || String(i + 1);
const short = n => (n || '').split(':')[0];
const val = id => ($('#' + id)?.value ?? '').trim();
const must = r => { if (r.error) throw r.error; return r.data; };
const isStaff = () => S.me && ['admin','staff'].includes(S.me.role);
const isAdmin = () => S.me?.role === 'admin';
const nameOf = id => S.profiles[id]?.full_name || S.profiles[id]?.email || (id === S.me?.id ? (S.me.full_name || 'You') : 'Team member');
const firstName = id => nameOf(id).split(' ')[0];
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

let tT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(tT); tT = setTimeout(() => el.hidden = true, 3200); }
function modal(html, wide) { document.querySelectorAll('.pop').forEach(x => x.hidden = true); const m = $('#modal'); m.innerHTML = `<div class="scrim" data-act="modal-close"></div><div class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; m.querySelector('input,textarea,select')?.focus(); }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; S.draft = []; }

async function compress(file, max = 2000, q = 0.84) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', q));
  } catch { return file; }
}
async function upload(path, blob, contentType) {
  must(await sb.storage.from(BUCKET).upload(path, blob, { contentType: contentType || blob.type || 'application/octet-stream', upsert: false }));
  return path;
}
async function signPaths(paths) {
  paths.filter(p => p && /^https?:\/\//.test(p)).forEach(p => { S.urls[p] = p; }); // images linked by web address are used as-is
  const need = [...new Set(paths.filter(p => p && !S.urls[p]))];
  if (!need.length) return;
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(need, 60 * 60 * 6);
  (data || []).forEach(x => { if (x.signedUrl) S.urls[x.path] = x.signedUrl; });
}
async function log(body, view) { if (S.pid) await sb.from('activity').insert({ project_id: S.pid, body, view }); }

/* ================= auth screens ================= */
// Sign-in page: builders can add their own photograph, headline, and words (settings.signin)
function authShell(inner) {
  const si = B.signin || {};
  $('#app').innerHTML = si.photo
    ? `<div class="auth split"><div class="auth-photo" style="background-image:url('${esc(si.photo)}')">${si.caption ? `<div class="auth-cap"><span class="eyebrow">${esc(si.captionEyebrow || B.fullName)}</span><p>${si.caption}</p></div>` : ''}</div>
        <div class="auth-side"><div class="auth-card">${wordmark()}${inner}</div>${si.footer ? `<p class="auth-foot small muted">${si.footer}</p>` : ''}</div></div>`
    : `<div class="wrap auth"><div class="auth-card">${wordmark()}${inner}</div></div>`;
}
function renderLogin(msg) {
  authShell(`
    <h1>${(B.signin || {}).headline || 'Welcome <span class="ital">home</span>'}</h1>
    <p class="lead">${(B.signin || {}).text || 'Sign in to follow your home from first drawings to the day you receive your keys.'}</p>
    <form id="login-form">
      <div class="field"><label for="li-email">Email</label><input id="li-email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="li-pass">Password</label><input id="li-pass" type="password" autocomplete="current-password" required></div>
      ${msg ? `<p class="inline-err">${esc(msg)}</p>` : ''}
      <button class="btn primary" type="submit">Sign in</button>
    </form>
    <p class="auth-foot"><button class="linkbtn" data-act="forgot">Forgot your password?</button></p>
    <p class="auth-foot">Access is by invitation from ${esc(B.fullName)}.</p>`);
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Signing in';
    const { error } = await sb.auth.signInWithPassword({ email: val('li-email'), password: $('#li-pass').value });
    if (error) return renderLogin(error.message === 'Invalid login credentials' ? 'That email and password don’t match. Try again or reset your password.' : error.message);
    start();
  });
}
function renderSetPassword(reason) {
  authShell(`
    <h1>${reason === 'invite' ? 'Welcome. <span class="ital">Choose a password.</span>' : 'Choose a <span class="ital">new password</span>'}</h1>
    <p class="lead">${reason === 'invite' ? `${esc(B.fullName)} has invited you to your home’s private portal.` : 'Enter a new password for your account.'}</p>
    <form id="pw-form">
      <div class="field"><label for="pw1">Password (at least 8 characters)</label><input id="pw1" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="field"><label for="pw2">Confirm password</label><input id="pw2" type="password" autocomplete="new-password" minlength="8" required></div>
      <p class="inline-err" id="pw-err" hidden></p>
      <button class="btn primary" type="submit">Save and continue</button>
    </form>`);
  $('#pw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const a = $('#pw1').value, b = $('#pw2').value, err = $('#pw-err');
    if (a.length < 8) { err.textContent = 'Use at least 8 characters.'; err.hidden = false; return; }
    if (a !== b) { err.textContent = 'The two passwords don’t match.'; err.hidden = false; return; }
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { err.textContent = error.message; err.hidden = false; return; }
    history.replaceState(null, '', location.pathname + location.search);
    toast('Password saved'); start(true);
  });
}
function renderWrongPortal(other) {
  const url = other.settings?.portal_url;
  authShell(`<h1>This is the ${esc(B.name)} <span class="ital">portal</span></h1>
    <p class="lead">Your account is with ${esc(other.settings?.from_name || other.name)}.${url ? ` Your home is at <a href="${esc(url)}">${esc(url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>.` : ''}</p>
    <button class="btn" data-act="signout">Sign out</button>`);
}
function renderNoAccess() {
  authShell(`<h1>Almost <span class="ital">there</span></h1>
    <p class="lead">Your account isn’t connected to a home yet. Your ${esc(B.name)} ${esc(L.projectLead.toLowerCase())} will add you shortly.</p>
    <button class="btn" data-act="signout">Sign out</button>`);
}

/* ================= boot ================= */
async function start(skipFlow) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderLogin();
  if (!skipFlow && (AUTH_FLOW === 'invite' || AUTH_FLOW === 'recovery')) return renderSetPassword(AUTH_FLOW);

  const me = (await sb.from('profiles').select('*').eq('id', session.user.id).single()).data;
  if (!me || !me.builder_id) return renderNoAccess();
  S.me = me;
  S.builder = (await sb.from('builders').select('*').eq('id', me.builder_id).single()).data;
  if (B.slug && S.builder?.slug && S.builder.slug !== B.slug) return renderWrongPortal(S.builder);
  await loadProjects();

  if (!S.projects.length && !isStaff()) return renderNoAccess();
  const remembered = store.get('portal.pid');
  const hash = location.hash.slice(1);
  if (S.projects.some(p => p.id === remembered)) S.pid = remembered;
  else if (!isStaff() || S.projects.length === 1) S.pid = S.projects[0]?.id || null;

  if (isStaff() && (!S.pid || hash === 'homes')) S.view = 'homes';
  else S.view = resolveView(hash);
  if (S.pid && S.view !== 'homes') await loadProject(S.pid);
  render();
  if (!S.me.welcomed_at && (S.d || isStaff())) showTour(isStaff() ? 'staff' : 'client', true);
  clearInterval(S.poll);
  S.poll = setInterval(() => { if (document.visibilityState === 'visible' && S.pid && S.view === 'messages') refresh(['messages']); }, 20000);
}

async function loadProjects() {
  S.projects = must(await sb.from('projects').select('*').eq('archived', false).order('created_at', { ascending: false }));
  if (isStaff() && S.projects.length) {
    const ids = S.projects.map(p => p.id);
    const [ph, qs, co] = await Promise.all([
      sb.from('phases').select('project_id,status,name,position').in('project_id', ids),
      sb.from('questions').select('project_id').eq('status', 'open').in('project_id', ids),
      sb.from('change_orders').select('project_id').eq('status', 'pending').in('project_id', ids)]);
    S.homeStats = {};
    ids.forEach(id => {
      const phases = (ph.data || []).filter(x => x.project_id === id).sort((a,b) => a.position - b.position);
      S.homeStats[id] = { progress: progressOf(phases), current: phases.find(x => x.status === 'current'),
        open: (qs.data || []).filter(x => x.project_id === id).length + (co.data || []).filter(x => x.project_id === id).length };
    });
    if (!S.profiles || !Object.keys(S.profiles).length) S.profiles = Object.fromEntries(must(await sb.from('profiles').select('id,full_name,title,phone,email,role,builder_id')).map(p => [p.id, p]));
    S.ui.tdAll = store.get('portal.td.all') === '1';
    await loadToday().catch(e => { console.error(e); S.today = null; });
  }
}

const TABLES = {
  phases: q => q.order('position'),
  updates: q => q.order('created_at', { ascending: false }),
  update_photos: q => q.order('position'),
  update_comments: q => q.order('created_at'),
  update_thanks: q => q,
  questions: q => q.order('created_at', { ascending: false }),
  selections: q => q.order('due_date', { ascending: true, nullsFirst: false }),
  selection_options: q => q.order('position'),
  selection_favorites: q => q,
  wall_photos: q => q.order('created_at'),
  home_items: q => q.order('position').order('created_at'),
  warranty_requests: q => q.order('number', { ascending: false }),
  change_orders: q => q.order('number', { ascending: false }),
  draws: q => q.order('position'),
  events: q => q.order('starts_on'),
  documents: q => q.order('created_at', { ascending: false }),
  notes: q => q.order('created_at', { ascending: false }),
  threads: q => q.order('position'),
  messages: q => q.order('created_at'),
  activity: q => q.order('created_at', { ascending: false }).limit(40),
  project_members: q => q,
  notifications: q => q,
};
async function loadProject(pid, only) {
  const keys = (only || Object.keys(TABLES)).filter(k => TABLES[k]);
  const res = await Promise.all(keys.map(t => t === 'notifications'
    ? (isStaff() ? sb.from('notifications').select('id,kind,subject,to_email,status,error,created_at').eq('project_id', pid).order('created_at', { ascending: false }).limit(25) : Promise.resolve({ data: [] }))
    : TABLES[t](sb.from(t).select('*').eq('project_id', pid))));
  if (!only || !S.d) S.d = {};
  keys.forEach((t, i) => { if (res[i].error) throw res[i].error; S.d[t] = res[i].data; });
  if (!only || only.includes('project')) S.d.project = must(await sb.from('projects').select('*').eq('id', pid).single());
  const profs = must(await sb.from('profiles').select('id,full_name,title,phone,email,role,builder_id'));
  S.profiles = Object.fromEntries(profs.map(p => [p.id, p]));
  await signPaths([...(S.d.update_photos || []).map(p => p.path), ...(S.d.wall_photos || []).map(p => p.path), ...(S.d.home_items || []).map(i => i.photo_path), ...(S.d.warranty_requests || []).flatMap(r => r.photos), ...(S.d.selection_options || []).map(o => o.image_path), S.d.project?.cover_path]);
  if (!only) {
    S.lastSeen = isStaff() ? store.get('portal.seen.' + pid) : S.d.project_members.find(m => m.user_id === S.me.id)?.last_seen_at;
    if (!S.ui.thread && S.d.threads[0]) S.ui.thread = S.d.threads[0].id;
  }
}
async function refresh(keys) { await loadProject(S.pid, keys); render(true); }

/* ================= derived ================= */
function progressOf(phases) {
  if (!phases.length) return 0;
  const done = phases.filter(p => p.status === 'done').length, cur = phases.some(p => p.status === 'current') ? 0.4 : 0;
  return Math.round((done + cur) / phases.length * 100);
}
const P = () => S.d.project;
const curPhase = () => S.d.phases.find(p => p.status === 'current') || S.d.phases.find(p => p.status === 'upcoming') || S.d.phases[S.d.phases.length - 1];
const phaseById = id => S.d.phases.find(p => p.id === id);
const openQs = () => S.d.questions.filter(q => q.status === 'open');
const pendingCOs = () => S.d.change_orders.filter(c => c.status === 'pending');
const optionsOf = sid => S.d.selection_options.filter(o => o.selection_id === sid);
const chosen = s => S.d.selection_options.find(o => o.id === s.chosen_option_id);
const selDueSoon = () => S.d.selections.filter(s => s.status === 'open' && (daysTo(s.due_date) ?? 999) <= 30);
const approvedCOTotal = () => S.d.change_orders.filter(c => c.status === 'approved').reduce((a,c) => a + +c.amount, 0);
const allowanceVar = st => S.d.selections.filter(s => s.status === st && +s.allowance > 0 && chosen(s)).reduce((a,s) => a + +chosen(s).price - +s.allowance, 0);
const unseen = () => S.d.activity.filter(a => a.actor_id !== S.me.id && (!S.lastSeen || new Date(a.created_at) > new Date(S.lastSeen)));
const DUTIES = () => B.duties || [];
// Who handles an area on this home: the assigned teammate, otherwise the project manager
const ownerId = area => (P().duties || {})[area] || P().pm_id || pm()?.id;
const dutiesOf = uid => DUTIES().filter(([k]) => ((P().duties || {})[k] || P().pm_id) === uid).map(([, l]) => l);
const pm = () => P().pm_id ? S.profiles[P().pm_id] : Object.values(S.profiles).find(p => p.role !== 'client' && p.builder_id === S.me.builder_id);
const clients = () => S.d.project_members.map(m => S.profiles[m.user_id]).filter(Boolean);
const clientFirst = () => { const c = clients(); return c.length ? c.map(x => (x.full_name || x.email).split(' ')[0]).join(' & ') : 'the clients'; };

function actionItems() {
  const items = [];
  openQs().forEach(q => items.push({ sort: q.due_date || '2999-01-01', k: 'Decision', go: 'questions', t: q.question.split(/[:?]/)[0], d: `${dueText(q.due_date)} · from ${firstName(q.asked_by)}` }));
  pendingCOs().forEach(c => items.push({ sort: c.created_at.slice(0,10), k: 'Signature', go: 'changes', t: `CO-${String(c.number).padStart(2,'0')} · ${c.title}`, d: `${signed(c.amount)}${c.days ? ` · ${c.days} days added` : ''} · sent ${ft(c.created_at)}` }));
  selDueSoon().forEach(s => items.push({ sort: s.due_date, k: 'Selection', go: 'selections', t: s.category, d: `${dueText(s.due_date)} · ${fd(s.due_date)}` }));
  if (isStaff()) {
    S.d.selections.filter(s => s.status === 'submitted').forEach(s => items.push({ area: 'selections', sort: s.due_date || '2999-01-01', k: 'Confirm', go: 'selections', t: s.category, d: `${clientFirst()} chose ${chosen(s)?.name || 'an option'}`, mine: true }));
    S.d.events.filter(e => e.status === 'requested').forEach(e => items.push({ area: 'visits', sort: e.starts_on, k: 'Request', go: 'calendar', t: e.title.replace(' (requested)', ''), d: `${fd(e.starts_on)}${e.time_label ? ' · ' + e.time_label : ''}`, mine: true }));
    openReqs().forEach(r => items.push({ area: 'warranty', sort: r.urgency === 'urgent' ? '1900-01-01' : r.created_at.slice(0,10), k: r.urgency === 'urgent' ? 'Urgent' : 'Warranty', go: 'warranty', t: `${wNo(r)} · ${r.title}`, d: `${r.room ? r.room + ' · ' : ''}from ${firstName(r.created_by)} · ${ft(r.created_at)}`, mine: true }));
    S.d.notes.filter(n => !n.reviewed).forEach(n => items.push({ area: 'notes', sort: n.created_at.slice(0,10), k: 'Note', go: 'walkthrough', t: n.body.slice(0, 70), d: `${n.room || 'General'} · ${ft(n.created_at)}`, mine: true }));
  }
  return items.filter(i => on(i.go)).sort((a,b) => D(a.sort) - D(b.sort));
}

/* ================= chrome ================= */
const NAV_LABELS = { ...(B.navLabels || {}) }; // a builder can rename any section, e.g. { walkthrough: 'Punch list' }
const nl = ([v, l]) => [v, NAV_LABELS[v] || l];
const DEC = [['questions','Questions'],['selections','Selections'],['changes','Change orders']].filter(([v]) => on(v)).map(nl);
const forMe = x => !x.who || x.who === 'all' || (x.who === 'staff') === isStaff();
const PRIMARY = [['overview','Overview'],['timeline','Timeline'],['updates','From the site'],...(DEC.length ? [['decisions','Decisions']] : []),...(on('messages') ? [['messages','Messages']] : [])].map(nl);
const MORE_ALL = [['diary','Photo diary'],['walls','Behind the walls'],['manual','Home manual'],['warranty','Warranty'],['calendar','Calendar'],['budget','Financials'],['documents','Documents'],['walkthrough','Notes & aftercare'],['glossary','Glossary'],['team','Your team']].filter(([v]) => v === 'team' || on(v)).map(nl);
// Extra pages slot in before "Your team" (or into the main menu with where: 'primary')
let MORE = MORE_ALL;
const navFor = () => {
  const ex = EXTRA.filter(forMe);
  MORE = [...MORE_ALL.slice(0, -1), ...ex.filter(x => x.where !== 'primary').map(x => [x.id, x.label]), MORE_ALL[MORE_ALL.length - 1]];
  return [...PRIMARY, ...ex.filter(x => x.where === 'primary').map(x => [x.id, x.label])];
};
const isDec = v => DEC.some(d => d[0] === v);
const ICONS = {
  overview: '<path d="M4 11l8-6 8 6"/><path d="M6 10v9h12v-9"/>',
  updates: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  decisions: '<path d="M5 12l4 4 10-10"/>',
  messages: '<path d="M4 5h16v11H9l-5 4z"/>',
  timeline: '<path d="M4 12h16"/><circle cx="7" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="17" cy="12" r="1.6"/>',
  more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
};
const icon = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;
function badgeFor(v) {
  if (!S.d) return 0;
  if (v === 'questions') return openQs().length;
  if (v === 'changes') return pendingCOs().length;
  if (v === 'selections') return isStaff() ? S.d.selections.filter(s => s.status === 'submitted').length : selDueSoon().length;
  if (v === 'decisions') return DEC.reduce((a, d) => a + badgeFor(d[0]), 0);
  if (v === 'walkthrough' && isStaff()) return S.d.notes.filter(n => !n.reviewed).length;
  if (v === 'warranty' && isStaff()) return openReqs().length;
  if (v === 'calendar' && isStaff()) return S.d.events.filter(e => e.status === 'requested').length;
  if (v === 'more') return MORE.reduce((a, m) => a + badgeFor(m[0]), 0);
  return 0;
}
// Which page a link opens. "decisions" lands on the tab that needs attention first.
function resolveView(h) {
  if (h === 'decisions') return DEC.length ? (DEC.find(d => badgeFor(d[0]))?.[0] || DEC[0][0]) : 'overview';
  const ex = EXTRA.find(x => x.id === h);
  if (ex) return S.me && !forMe(ex) ? 'overview' : h;
  return VIEWS[h] && FEAT[h] !== false ? h : 'overview';
}
const isCur = v => v === S.view || (v === 'decisions' && isDec(S.view));
function chrome() {
  const primary = navFor();
  const inHome = S.view !== 'homes' && S.d;
  const moreCur = MORE.find(m => m[0] === S.view);
  const link = ([v, l]) => { const b = badgeFor(v); return `<a href="#${v}" ${isCur(v) ? 'aria-current="page"' : ''}>${l}${b ? `<sup>${b}</sup>` : ''}</a>`; };
  const moreBadge = badgeFor('more');
  const nav = inHome ? `${isStaff() ? link(['homes','Today']) : ''}${primary.map(link).join('')}
      <span class="more"><button class="more-btn" data-act="more" aria-haspopup="true" ${moreCur ? 'aria-current="page"' : ''}>${moreCur ? esc(moreCur[1]) : 'More'}${moreBadge ? `<sup>${moreBadge}</sup>` : ''}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></button>
      <div class="pop more-pop" id="more-pop" hidden>${MORE.map(([v, l]) => { const b = badgeFor(v); return `<a href="#${v}" class="pop-item">${l}${b ? `<sup>${b}</sup>` : ''}</a>`; }).join('')}</div></span>`
    : (isStaff() ? link(['homes','Today']) : '');
  const tab = (v, l) => { const b = badgeFor(v); return `<a href="#${v}" ${isCur(v) ? 'aria-current="page"' : ''}>${icon(v)}<span>${l}</span>${b ? `<i class="tb-badge">${b}</i>` : ''}</a>`; };
  return `
  <header class="mast"><div class="wrap">
    <div class="mast-row">
      ${wordmark()}
      <div class="mast-right">
        ${inHome ? `<div style="position:relative"><button class="iconbtn" data-act="bell" aria-label="Notifications" id="bell"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>${unseen().length ? '<span class="dot"></span>' : ''}</button><div class="pop" id="pop" hidden></div></div>` : ''}
        <div class="acct"><button class="acct-btn" data-act="acct" aria-label="Your account"><span class="av ${isStaff() ? '' : 'owner'}">${ini(S.me.full_name || S.me.email)}</span></button><div class="pop" id="acct-pop" hidden></div></div>
      </div>
    </div>
    ${nav ? `<div class="navrow"><nav class="nav" aria-label="Sections">${nav}</nav></div>` : ''}
  </div></header>
  ${inHome ? `<nav class="tabbar" aria-label="Sections">${tab('overview','Home')}${tab('updates','Updates')}${DEC.length ? tab('decisions','Decisions') : tab('timeline','Timeline')}${on('messages') ? tab('messages','Messages') : ''}
    <button data-act="more-sheet" ${moreCur || S.view === 'timeline' ? 'aria-current="page"' : ''}>${icon('more')}<span>More</span>${moreBadge ? `<i class="tb-badge">${moreBadge}</i>` : ''}</button></nav>` : ''}`;
}
function pageHead(eyebrow, title, intro, aside = '') {
  if (S.embed) return aside ? `<div class="subhead"><span></span><div>${aside}</div></div>` : '';
  return `<div class="page-h"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1>${intro ? `<p>${intro}</p>` : ''}</div>${aside ? `<div>${aside}</div>` : ''}</div>`;
}
function vDecisions() {
  const waiting = badgeFor('decisions');
  const head = isStaff()
    ? pageHead('Decisions', `Waiting on <span class="ital">${esc(clientFirst())}</span>`, 'Questions, selections, and change orders for this home, in one place.')
    : pageHead('Decisions', waiting ? `${waiting === 1 ? 'One thing' : (['Two','Three','Four','Five','Six','Seven','Eight','Nine'][waiting - 2] || waiting) + ' things'} <span class="ital">${waiting === 1 ? 'needs' : 'need'} you</span>` : 'All caught <span class="ital">up</span>',
      'Every choice we need from you, with when it’s needed and why. Your answers are kept here as a permanent record.');
  const tabs = `<div class="dtabs" role="tablist">${DEC.map(([v, l]) => { const b = badgeFor(v); return `<a href="#${v}" role="tab" aria-selected="${S.view === v}" ${S.view === v ? 'aria-current="page"' : ''}>${l}${b ? `<sup>${b}</sup>` : ''}</a>`; }).join('')}</div>`;
  S.embed = true; let body; try { body = VIEWS[S.view](); } finally { S.embed = false; }
  return head + tabs + body;
}
const editBtn = (act, id, label = 'Edit') => isStaff() ? `<button class="edit-link" data-act="${act}" ${id ? `data-id="${id}"` : ''}>${label}</button>` : '';

function render(keepScroll) {
  const y = window.scrollY;
  const ex = EXTRA.find(x => x.id === S.view);
  const v = S.view === 'homes' ? vHomes() : !S.d ? '' : ex ? vExtra(ex) : isDec(S.view) ? vDecisions() : VIEWS[S.view]();
  $('#app').innerHTML = chrome() + `<main class="wrap" id="view">${v}</main>` +
    (isStaff() && S.d && S.view !== 'homes' ? `<button class="fab" data-act="post-open" aria-label="Post an update"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span>Post update</span></button>` : '');
  if (keepScroll) window.scrollTo(0, y);
  const m = $('#msgs'); if (m) m.scrollTop = m.scrollHeight;
  $('#nav [aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ================= helper kit for builder-only pages ================= */
window.Portal = {
  get settings() { return B; }, get labels() { return L; }, get me() { return S.me; }, get home() { return S.d ? P() : null; }, get data() { return S.d; },
  isStaff: () => isStaff(), pm: () => (S.d ? pm() : null), clientFirst: () => (S.d ? clientFirst() : ''),
  esc, gloss, fd, fdL, money, daysTo, photoUrl: p => S.urls[p] || (/^https?:/.test(p || '') ? p : ''), toast, go: v => { location.hash = '#' + v; },
};

/* ================= builder-only pages ================= */
// Simple pages are written in settings as html; {{client}}, {{home}}, {{pm}}, {{builder}} are filled in.
// Pages that need logic provide render(Portal), where Portal is the small helper kit below.
function vExtra(x) {
  const fill = t => String(t || '').replace(/\{\{(client|home|pm|builder)\}\}/g, (_, k) => esc({ client: S.d ? clientFirst() : '', home: S.d ? P().name : '', pm: (pm()?.full_name || L.projectLead), builder: B.fullName }[k]));
  let body = '';
  try { body = x.render ? x.render(window.Portal) : fill(x.html); } catch (e) { console.error(e); body = '<div class="empty">This page couldn’t load.</div>'; }
  return pageHead(esc(x.eyebrow || B.fullName), x.title ? fill(x.title) : esc(x.label), x.intro ? fill(x.intro) : '') + `<div class="extra-page">${body}</div>`;
}

/* ================= shared bits ================= */
function photoBtn(p) {
  const url = S.urls[p.path];
  return `<button class="ph" data-act="ph-open" data-id="${p.id}" aria-label="Open photo${p.caption ? ': ' + esc(p.caption) : ''}">${url ? `<img src="${esc(url)}" alt="${esc(p.caption)}" loading="lazy">` : ''}${p.caption ? `<span class="cap">${esc(p.caption)}</span>` : ''}</button>`;
}
function mosaic(photos) {
  const ps = photos.slice(0, 3);
  if (!ps.length) return '';
  return `<div class="mosaic ${ps.length === 1 ? 'one' : ps.length === 2 ? 'two' : ''}">${ps.map(photoBtn).join('')}</div>`;
}
const photosOf = uid => S.d.update_photos.filter(p => p.update_id === uid);
const ELEV = `<svg class="elev" viewBox="0 0 960 270" role="img" aria-label="Front elevation drawing">
  <line class="t" x1="0" y1="226" x2="960" y2="226"/><circle class="t" cx="56" cy="168" r="40"/><circle class="t" cx="92" cy="186" r="28"/><line class="t" x1="62" y1="208" x2="62" y2="226"/>
  <rect class="s" x="130" y="146" width="190" height="80"/><polyline class="s" points="122,146 225,98 328,146"/>
  <rect class="s" x="150" y="170" width="44" height="56"/><rect class="s" x="204" y="170" width="44" height="56"/><rect class="s" x="258" y="170" width="44" height="56"/>
  <line class="t" x1="150" y1="184" x2="194" y2="184"/><line class="t" x1="204" y1="184" x2="248" y2="184"/><line class="t" x1="258" y1="184" x2="302" y2="184"/><rect class="s" x="212" y="114" width="26" height="22"/>
  <rect class="s" x="320" y="160" width="60" height="66"/><rect class="s" x="334" y="176" width="32" height="38"/>
  <rect class="s" x="380" y="96" width="300" height="130"/><polyline class="s" points="366,96 530,22 694,96"/><rect class="s" x="602" y="34" width="28" height="56"/><line class="s" x1="598" y1="34" x2="634" y2="34"/>
  <circle class="s" cx="530" cy="66" r="13"/><line class="t" x1="530" y1="53" x2="530" y2="79"/><line class="t" x1="517" y1="66" x2="543" y2="66"/>
  <rect class="s" x="404" y="114" width="34" height="46"/><rect class="s" x="458" y="114" width="34" height="46"/><rect class="s" x="568" y="114" width="34" height="46"/><rect class="s" x="622" y="114" width="34" height="46"/>
  <line class="t" x1="421" y1="114" x2="421" y2="160"/><line class="t" x1="475" y1="114" x2="475" y2="160"/><line class="t" x1="585" y1="114" x2="585" y2="160"/><line class="t" x1="639" y1="114" x2="639" y2="160"/>
  <path class="s" d="M508 226 V186 a22 22 0 0 1 44 0 V226"/><line class="t" x1="530" y1="164" x2="530" y2="226"/><polyline class="s" points="494,164 530,140 566,164"/><line class="s" x1="494" y1="164" x2="566" y2="164"/>
  <rect class="s" x="404" y="176" width="34" height="50"/><rect class="s" x="458" y="176" width="34" height="50"/><rect class="s" x="568" y="176" width="34" height="50"/><rect class="s" x="622" y="176" width="34" height="50"/>
  <rect class="s" x="680" y="132" width="170" height="94"/><line class="s" x1="672" y1="132" x2="858" y2="132"/>
  <line class="t" x1="708" y1="132" x2="708" y2="226"/><line class="t" x1="736" y1="132" x2="736" y2="226"/><line class="t" x1="765" y1="132" x2="765" y2="226"/><line class="t" x1="794" y1="132" x2="794" y2="226"/><line class="t" x1="822" y1="132" x2="822" y2="226"/>
  <circle class="t" cx="908" cy="160" r="44"/><line class="t" x1="908" y1="204" x2="908" y2="226"/></svg>`;

/* ================= views ================= */
function vHomes() { return vToday(); }
function homesGrid() {
  return (S.projects.length ? `<div class="homes">${S.projects.map(p => { const st = S.homeStats[p.id] || {}; return `
    <button class="home-card" data-act="home-open" data-id="${p.id}">
      <span class="eyebrow">${esc(p.lot || p.address || 'New home')}</span>
      <h3>${esc(p.name)}</h3>
      <span class="small muted">${esc(p.client_names || 'No clients invited yet')}</span>
      <div class="meter" style="margin:6px 0 0"><i style="width:${st.progress || 0}%;background:var(--brass)"></i></div>
      <div class="spread small"><span>${st.current ? esc(short(st.current.name)) : 'Not started'}</span><span class="num muted">${st.progress || 0}%</span></div>
      <div class="spread small muted"><span>${p.closing_date ? 'Closing ' + fd(p.closing_date, {month:'short', day:'numeric', year:'numeric'}) : 'Closing date not set'}</span>${st.open ? `<span class="tag brass">${st.open} waiting</span>` : ''}</div>
    </button>`; }).join('')}</div>`
  : `<div class="empty">No homes yet. Add your first one to get started.</div>`);
}

function vOverview() {
  const p = P(), cp = curPhase(), dm = daysTo(p.closing_date);
  const items = actionItems().filter(i => isStaff() || !i.mine);
  const latest = S.d.updates[0];
  const upcoming = S.d.events.filter(e => (daysTo(e.starts_on) ?? -1) >= 0 && e.status !== 'done').slice(0, 4);
  const h = new Date().getHours(), firstN = (S.me.full_name || '').split(' ')[0];
  const greet = isStaff() ? [B.fullName, p.client_names].filter(Boolean).map(esc).join(' · ') : `Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}${firstN ? ', ' + esc(firstN) : ''}`;
  const nameParts = p.name.split(' '), last = nameParts.pop();
  const lead = pm();
  return `
  <section class="hero">
    <div class="hero-top">
      <div><span class="eyebrow">${greet}</span>
        <h1>${esc(nameParts.join(' '))} <em>${esc(last)}</em></h1>
        <p class="sub">${[p.lot || p.address, p.summary].filter(Boolean).map(esc).join(' · ')}</p>
        ${isStaff() ? `<div class="row" style="margin-top:14px;gap:18px">${editBtn('home-edit', null, 'Edit details')}<label class="edit-link" for="cover-up">${p.cover_path ? 'Replace rendering' : 'Add a rendering'}<input type="file" id="cover-up" accept="image/*" hidden></label></div>` : ''}</div>
      ${dm !== null ? `<div class="count"><div class="n num">${Math.max(dm, 0)}</div><div class="l">${esc(L.daysUntil)}</div><div class="d">${fdL(p.closing_date)}</div></div>` : ''}
    </div>
    ${p.cover_path && S.urls[p.cover_path] ? `<img class="cover-img" src="${esc(S.urls[p.cover_path])}" alt="Rendering of ${esc(p.name)}">` : ELEV}
    <div class="rail" style="grid-template-columns:repeat(${S.d.phases.length || 1},minmax(0,1fr))" aria-label="Build progress by phase">${S.d.phases.map(ph => `<div class="${ph.status === 'current' ? 'cur' : ph.status}" title="${esc(ph.name)}"><i></i></div>`).join('')}</div>
    <div class="rail-foot"><span>${cp ? `<span class="ital now">${rom(S.d.phases.indexOf(cp))}</span> ${esc(short(cp.name))}${cp.end_date ? ` <span class="muted-h">· through ${fd(cp.end_date)}</span>` : ''}` : 'Schedule to be set'}</span><a href="#timeline" class="rail-link"><b class="num">${progressOf(S.d.phases)}%</b> complete →</a></div>
  </section>
  ${pmNote()}${on('moments') ? momentBanner() : ''}${on('warranty') ? warrantyCard() : ''}
  <div class="grid2">
    <section>
      <div class="sec-h"><h2>${isStaff() ? 'Needs attention' : 'Awaiting your attention'}</h2><span class="aside">${items.length} item${items.length === 1 ? '' : 's'}</span></div>
      ${items.length ? `<div class="todo">${items.map(i => `<a href="#${i.go}"><span class="k">${i.k}</span><span><span class="t">${esc(i.t)}</span><div class="d">${esc(i.d)}</div></span><span class="go" aria-hidden="true">→</span></a>`).join('')}</div>` : `<div class="empty">Nothing is waiting right now.</div>`}
    </section>
    ${!isStaff() ? `
    <aside class="concierge">
      <span class="eyebrow">Your ${esc(L.projectLead.toLowerCase())}</span>
      ${lead ? `<div class="who"><span class="av">${ini(lead.full_name)}</span><div><h3>${esc(lead.full_name || lead.email)}</h3><div class="small muted">${esc(lead.title || L.projectLead)}</div></div></div>` : ''}
      ${on('calendar') && (B.requestKinds || []).length ? `<p class="small muted">${esc((B.concierge || {}).text || `Arrange a private visit or a ${L.designCenter} session. We’ll take care of the details.`)}</p>` : ''}
      <div class="btns">${on('calendar') ? (B.requestKinds || []).map((k, i) => `<button class="btn ${i ? '' : 'primary'}" data-act="request" data-k="${esc(k)}">Request a ${esc(k.toLowerCase())}</button>`).join('') : ''}${on('messages') ? `<a class="btn ${on('calendar') && (B.requestKinds || []).length ? 'ghost' : 'primary'}" href="#messages">Send a message</a>` : ''}${lead?.phone ? `<a class="btn ghost" href="tel:${esc(lead.phone.replace(/[^\d+]/g, ''))}">Call ${esc((lead.full_name || '').split(' ')[0])}</a>` : ''}</div>
    </aside>` : `
    <aside class="concierge">
      <span class="eyebrow">Builder tools</span>
      <div class="btns"><button class="btn primary" data-act="post-open">Post a photo update</button>${on('questions') ? '<a class="btn" href="#questions">Ask for a decision</a>' : ''}${on('changes') ? '<a class="btn" href="#changes">Prepare a change order</a>' : ''}<a class="btn ghost" href="#team">Invite ${esc(L.client.toLowerCase())}s</a></div>
      ${clients().length ? `<p class="small muted">${esc(clients().map(c => c.full_name || c.email).join(', '))} ${clients().length > 1 ? 'have' : 'has'} access to this home.</p>` : `<p class="small" style="color:var(--brass)">No ${esc(L.client.toLowerCase())}s invited yet.</p>`}
    </aside>`}
  </div>

  ${latest ? `<section style="margin-top:64px">
    <div class="sec-h"><h2>From the site</h2><a href="#updates">All updates →</a></div>
    <div class="grid2" style="gap:36px">
      ${mosaic(photosOf(latest.id)) || '<div></div>'}
      <div class="stack" style="gap:14px">
        <span class="eyebrow">${ft(latest.created_at)}${phaseById(latest.phase_id) ? ' · ' + esc(short(phaseById(latest.phase_id).name)) : ''}</span>
        <p style="font-family:var(--f-display);font-size:22px;line-height:1.45">${esc(latest.body)}</p>
        <span class="small muted">${esc(nameOf(latest.author_id))}</span>
      </div>
    </div></section>` : ''}

  <div class="grid2" style="margin-top:64px">
    <section>
      <div class="sec-h"><h2>In the weeks ahead</h2><a href="#calendar">Calendar →</a></div>
      ${upcoming.length ? `<div class="month">${upcoming.map(e => eventRow(e, true)).join('')}</div>` : '<div class="empty">Nothing scheduled yet.</div>'}
    </section>
    ${cp ? `<section class="card" style="background:var(--surface-2);border-color:transparent">
      <span class="eyebrow">This phase, explained</span>
      <h3 style="font-size:26px;margin:10px 0 14px">${esc(cp.name)}</h3>
      ${cp.what ? `<p style="margin-bottom:12px">${gloss(cp.what)}</p>` : ''}
      ${cp.decisions ? `<p class="small"><span class="eyebrow" style="letter-spacing:.16em">Your decisions</span><br>${gloss(cp.decisions)}</p>` : ''}
      <a href="#timeline" class="small" style="display:inline-block;margin-top:16px">Every phase, explained</a>
    </section>` : ''}
  </div>`;
}

function vTimeline() {
  return pageHead('The build', `${S.d.phases.length} phases, <span class="ital">from drawings to keys</span>`, 'Open any phase to see what happens, what to look for when you visit, and the decisions that belong to it.', `<span class="big-figure num">${progressOf(S.d.phases)}%</span><div class="small muted">complete</div>`) +
  `<div>${S.d.phases.map((ph, i) => {
    const open = S.ui.openPhase === ph.id, ups = S.d.updates.filter(u => u.phase_id === ph.id);
    const tag = ph.status === 'done' ? '<span class="tag good">Complete</span>' : ph.status === 'current' ? '<span class="tag solid">Underway</span>' : '<span class="tag">Ahead</span>';
    const pics = ups.flatMap(u => photosOf(u.id)).slice(0, 6);
    return `<div class="phase ${ph.status === 'current' ? 'cur' : ph.status}"><div class="numr">${rom(i)}</div><div class="body">
      <button class="phase-head" data-act="ph-toggle" data-id="${ph.id}" aria-expanded="${open}"><span><h3>${esc(ph.name)}</h3><span class="dates">${ph.start_date ? fd(ph.start_date) + ' – ' + fd(ph.end_date) : 'Dates to be scheduled'}${ups.length ? ` · ${ups.length} update${ups.length > 1 ? 's' : ''}` : ''}</span></span>${tag}</button>
      ${open ? `<div class="phase-detail">
        <div class="explain"><div><span class="eyebrow">What happens</span>${gloss(ph.what || '—')}</div><div><span class="eyebrow">When you visit</span>${gloss(ph.look || '—')}</div><div><span class="eyebrow">Your decisions</span>${gloss(ph.decisions || '—')}</div></div>
        ${pics.length ? `<div class="photos">${pics.map(photoBtn).join('')}</div>` : ''}
        ${ph.status === 'done' && on('moments') ? `<div class="row" style="margin-bottom:10px"><button class="btn sm" data-act="moment" data-id="${ph.id}">Share this moment</button></div>` : ''}
        ${isStaff() ? `<div class="row">${ph.status === 'current' ? `<button class="btn primary sm" data-act="ph-complete" data-id="${ph.id}">Mark complete & start next</button>` : ph.status === 'upcoming' ? `<button class="btn sm" data-act="ph-start" data-id="${ph.id}">Start this phase</button>` : ''}<button class="btn sm ghost" data-act="ph-edit" data-id="${ph.id}">Edit phase</button></div>` : ''}
      </div>` : ''}
    </div></div>`; }).join('')}</div>`;
}

function vUpdates() {
  return pageHead('From the site', 'The house, <span class="ital">week by week</span>', 'Every update from the site, photographed and written by your project team.', `<span class="small muted num">${S.d.updates.length} updates · ${S.d.update_photos.length} photographs</span>${isStaff() ? `<div style="margin-top:12px"><button class="btn primary" data-act="post-open">Post update</button></div>` : ''}`) +
  `<div style="max-width:900px"><div class="stack" style="gap:40px">
  ${S.d.updates.length ? S.d.updates.map(u => {
    const ph = photosOf(u.id), cm = S.d.update_comments.filter(c => c.update_id === u.id), th = S.d.update_thanks.filter(t => t.update_id === u.id), mine = th.some(t => t.user_id === S.me.id);
    return `<article class="post">
      <div class="post-h"><span class="av">${ini(nameOf(u.author_id))}</span><div class="who"><b>${esc(nameOf(u.author_id))}</b><span class="meta">${ft(u.created_at)}</span></div>${phaseById(u.phase_id) ? `<span class="tag">${esc(short(phaseById(u.phase_id).name))}</span>` : ''}</div>
      ${u.body ? `<p class="text">${gloss(u.body)}</p>` : ''}
      ${mosaic(ph)}
      ${ph.length > 3 ? `<div class="photos">${ph.slice(3).map(photoBtn).join('')}</div>` : ''}
      <div class="post-f"><button class="btn sm ${mine ? 'primary' : 'ghost'}" data-act="thanks" data-id="${u.id}">${mine ? 'Thanked' : 'Thank the team'}${th.length ? ` · ${th.length}` : ''}</button><span>${cm.length} comment${cm.length === 1 ? '' : 's'}</span>${isStaff() ? `<span style="flex:1"></span><button class="edit-link" data-act="up-del" data-id="${u.id}">Delete</button>` : ''}</div>
      <div class="comments">${cm.map(c => `<div class="comment"><span class="av ${S.profiles[c.author_id]?.role === 'client' ? 'owner' : ''}">${ini(nameOf(c.author_id))}</span><div><b>${esc(nameOf(c.author_id))}</b>${esc(c.body)}</div></div>`).join('')}
        <div class="inline-form"><input class="input" id="c-${u.id}" placeholder="Add a comment" aria-label="Add a comment"><button class="btn sm" data-act="c-send" data-id="${u.id}">Send</button></div></div>
    </article>`; }).join('') : `<div class="empty">${isStaff() ? 'No updates yet. Tap Post update to share the first photographs.' : 'Your first update from the site will appear here.'}</div>`}
  </div></div>`;
}

function vQuestions() {
  const open = openQs(), done = S.d.questions.filter(q => q.status === 'answered');
  const form = isStaff() ? `
    <section class="card composer"><span class="eyebrow">Ask ${esc(clientFirst())} for a decision</span>
      <div class="field"><label for="nq-text">Question</label><textarea id="nq-text" placeholder="Library: would you like a concealed outlet inside the bar cabinet?"></textarea></div>
      <div class="row" style="align-items:flex-end"><div class="field"><label for="nq-opts">Suggested answers, separated by commas</label><input id="nq-opts" placeholder="Yes, No, Let's discuss on site"></div>
        <div class="field" style="flex:0 1 190px"><label for="nq-due">Needed by</label><input type="date" id="nq-due" value="${addDays(isoToday(), 7)}"></div></div>
      <div class="field"><label for="nq-why">Why it matters</label><input id="nq-why" placeholder="Needed before insulation"></div>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" data-act="q-new">Send</button></div></section>` : '';
  return pageHead('Decisions', 'Questions <span class="ital">for you</span>', 'Each decision your team needs, when it’s needed, and why. Answers are kept here as a permanent record.') +
  `<div class="stack" style="max-width:900px;gap:28px">${form}
    <div class="sec-h" style="margin:0"><h2>Open</h2><span class="aside">${open.length}</span></div>
    ${open.length ? open.map(q => `
      <article class="card q">
        <div class="spread"><span class="small muted">${esc(nameOf(q.asked_by))} · ${ft(q.created_at)}</span><span class="tag ${(daysTo(q.due_date) ?? 99) <= 3 ? 'brass' : ''}">Answer ${dueText(q.due_date)}</span></div>
        <p class="qtext">${gloss(q.question)}</p>
        ${q.why ? `<div class="blocker">${gloss(q.why)}</div>` : ''}
        ${!isStaff() ? `
          ${q.options?.length ? `<div class="quick">${q.options.map(o => `<button data-act="q-quick" data-id="${q.id}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}
          <div class="field"><label for="qa-${q.id}">Your answer</label><textarea id="qa-${q.id}" placeholder="Choose above or write your own"></textarea></div>
          <div class="row" style="justify-content:flex-end"><button class="btn primary" data-act="q-send" data-id="${q.id}">Send answer</button></div>`
        : `<div class="row"><span class="small muted" style="flex:1">Awaiting an answer</span><button class="edit-link" data-act="q-del" data-id="${q.id}">Withdraw</button></div>`}
      </article>`).join('') : `<div class="empty">No decisions are waiting.</div>`}
    ${done.length ? `<div class="sec-h" style="margin:20px 0 0"><h2>Decided</h2><span class="aside">${done.length}</span></div>
    ${done.map(q => `<article class="q" style="padding-bottom:22px;border-bottom:1px solid var(--line)"><span class="small muted">${esc(nameOf(q.asked_by))} · ${ft(q.created_at)}</span><p class="qtext" style="font-size:19px">${esc(q.question)}</p>
      <div class="answer"><b>${esc(q.answer)}</b><div class="small muted">${esc(nameOf(q.answered_by))} · ${ft(q.answered_at)}</div></div></article>`).join('')}` : ''}
  </div>`;
}

function vMessages() {
  if (!S.d.threads.length) return pageHead('Messages', 'Your <span class="ital">project team</span>', '') + '<div class="empty">No conversations yet.</div>';
  const th = S.d.threads.find(t => t.id === S.ui.thread) || S.d.threads[0];
  const msgs = S.d.messages.filter(m => m.thread_id === th.id);
  const lastOf = t => { const m = S.d.messages.filter(x => x.thread_id === t.id).pop(); return m ? m.body : 'No messages yet'; };
  return pageHead('Messages', 'Your <span class="ital">project team</span>', 'Every conversation about your home in one place, instead of scattered across texts and email.') + `
  <div class="chat">
    <div class="threads">${S.d.threads.map(t => `<button data-act="thread" data-id="${t.id}" aria-pressed="${t.id === th.id}"><b>${esc(t.name)}</b><span>${esc(lastOf(t))}</span></button>`).join('')}</div>
    <div class="convo">
      <div class="convo-h"><b>${esc(th.name)}</b></div>
      <div class="msgs" id="msgs">${msgs.length ? msgs.map(m => `<div class="msg ${m.author_id === S.me.id ? 'me' : ''}"><span class="av ${S.profiles[m.author_id]?.role === 'client' ? 'owner' : ''}">${ini(nameOf(m.author_id))}</span><div class="bub"><div class="meta">${esc(nameOf(m.author_id))} · ${ft(m.created_at)}</div>${esc(m.body)}</div></div>`).join('') : '<div class="empty">Start the conversation.</div>'}</div>
      <div class="convo-f"><input class="input" id="msg-in" placeholder="Write a message" aria-label="Write a message"><button class="btn primary" data-act="msg-send">Send</button></div>
    </div>
  </div>`;
}

const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
const favsOf = oid => (S.d.selection_favorites || []).filter(f => f.option_id === oid);
const isFav = oid => favsOf(oid).some(f => f.user_id === S.me.id);
const favNames = oid => favsOf(oid).map(f => firstName(f.user_id)).join(' & ');
// "You & Jake love this", "Your favorite", "Lauren loves this"; builders see "Lauren & Jake favorited this"
function favLabel(oid) {
  const fs = favsOf(oid); if (!fs.length) return '';
  if (isStaff()) return `${favNames(oid)} favorited this`;
  const mine = fs.some(f => f.user_id === S.me.id), others = fs.filter(f => f.user_id !== S.me.id).map(f => firstName(f.user_id));
  if (mine && !others.length) return 'Your favorite';
  if (mine) return `You & ${others.join(' & ')} love this`;
  return `${others.join(' & ')} ${others.length > 1 ? 'love' : 'loves'} this`;
}
const allowDiff = (s, o) => o ? +o.price - +s.allowance : null;
// What each selection is currently heading toward: the confirmed choice, else a pick in progress, else a favorite.
function heading(s) {
  const c = chosen(s);
  if (c) return { o: c, how: s.status === 'approved' ? 'Approved' : 'Submitted', firm: true };
  const pickId = S.ui.pick?.[s.id]; const pk = pickId && optionsOf(s.id).find(o => o.id === pickId);
  if (pk) return { o: pk, how: 'Selected, not submitted' };
  const fav = optionsOf(s.id).find(o => favsOf(o.id).length);
  if (fav) return { o: fav, how: 'Favorite' };
  return null;
}
function allowanceSummary() {
  const rows = S.d.selections.filter(s => +s.allowance > 0);
  if (!rows.length) return '';
  let firm = 0, proj = 0, total = 0;
  const lines = rows.map(s => { const h = heading(s), d = h ? allowDiff(s, h.o) : null; total += +s.allowance;
    if (d !== null) { proj += d; if (h.firm) firm += d; }
    return `<tr><td><b>${esc(s.category)}</b></td><td class="n">${money(s.allowance)}</td><td>${h ? `${esc(h.o.name)}<div class="small muted">${h.how}</div>` : '<span class="muted">Not chosen yet</span>'}</td><td class="n ${d > 0 ? 'over' : d < 0 ? 'under' : ''}">${d === null ? '—' : signed(d)}</td></tr>`; }).join('');
  return `<details class="allow"${S.ui.allowOpen ? ' open' : ''}>
    <summary data-act="allow-toggle"><span class="eyebrow">Allowance summary</span><span class="allow-sum"><span class="small muted">Projected</span> <b class="num ${proj > 0 ? 'over' : proj < 0 ? 'under' : ''}">${signed(proj)}</b> <span class="small muted">vs. ${money(total)} in allowances</span></span></summary>
    <div class="tablewrap"><table><thead><tr><th>Selection</th><th class="n">Allowance</th><th>Heading toward</th><th class="n">Difference</th></tr></thead><tbody>${lines}</tbody>
      <tfoot><tr><td><b>Confirmed so far</b></td><td></td><td></td><td class="n"><b>${signed(firm)}</b></td></tr><tr><td><b>Projected, including picks and favorites</b></td><td class="n">${money(total)}</td><td></td><td class="n"><b>${signed(proj)}</b></td></tr></tfoot></table></div>
    <p class="small muted" style="margin-top:10px">Differences are settled at ${esc(L.closing.toLowerCase())}. Favorites are only a guide until you submit.</p>
  </details>`;
}
function optCard(s, o) {
  const diff = +s.allowance ? +o.price - +s.allowance : 0, canPick = s.status === 'open' && !isStaff();
  const picked = (S.ui.pick?.[s.id] || s.chosen_option_id) === o.id, img = o.image_path && S.urls[o.image_path];
  const fn = favNames(o.id);
  return `<div class="opt ${picked ? 'picked' : ''}" ${canPick ? `data-act="sel-pick" data-id="${s.id}" data-o="${o.id}" role="button" tabindex="0" aria-pressed="${picked}"` : ''}>
    <div class="sw-wrap">${img ? `<span class="sw"><img src="${esc(img)}" alt="${esc(o.name)}"></span><button class="opt-zoom" data-act="opt-zoom" data-o="${o.id}" aria-label="Enlarge photo of ${esc(o.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>` : `<span class="sw">${(o.swatches.length ? o.swatches : ['#ccc']).map(c => `<i style="background:${esc(c)}"></i>`).join('')}</span>`}
      ${!isStaff() ? `<button class="fav ${isFav(o.id) ? 'on' : ''}" data-act="fav" data-o="${o.id}" aria-pressed="${isFav(o.id)}" aria-label="${isFav(o.id) ? 'Remove from' : 'Add to'} favorites">${HEART}</button>` : ''}
      ${picked ? `<span class="picked-tag">${s.status === 'open' ? 'Your selection' : s.status === 'approved' ? 'Approved' : 'Submitted'}</span>` : ''}</div>
    <b>${esc(o.name)}</b><span class="small muted">${esc(o.detail || '')}</span>
    <span class="price num">${+s.allowance ? `${money(o.price)} · <span class="${diff > 0 ? 'over' : 'under'}">${diff > 0 ? signed(diff) + ' over' : money(-diff) + ' under'}</span>` : (+o.price ? money(o.price) : 'Included')}</span>
    ${fn ? `<span class="fav-line">${HEART} ${esc(favLabel(o.id))}</span>` : ''}
    ${isStaff() ? `<span class="row" style="gap:14px"><button class="edit-link" data-act="opt-edit" data-id="${s.id}" data-o="${o.id}">Edit option</button></span>` : ''}
  </div>`;
}
function compareTable(s) {
  const os = optionsOf(s.id), canPick = s.status === 'open' && !isStaff();
  const cell = fn => os.map(o => `<td>${fn(o)}</td>`).join('');
  return `<div class="tablewrap compare"><table>
    <tr><th></th>${cell(o => o.image_path && S.urls[o.image_path] ? `<img src="${esc(S.urls[o.image_path])}" alt="">` : `<span class="sw">${(o.swatches.length ? o.swatches : ['#ccc']).map(c => `<i style="background:${esc(c)}"></i>`).join('')}</span>`)}</tr>
    <tr><th>Option</th>${cell(o => `<b class="cmp-name">${esc(o.name)}</b>`)}</tr>
    <tr><th>Details</th>${cell(o => `<span class="small">${esc(o.detail || '—')}</span>`)}</tr>
    <tr><th>Price</th>${cell(o => `<span class="num">${+o.price ? money(o.price) : 'Included'}</span>`)}</tr>
    ${+s.allowance ? `<tr><th>vs. allowance</th>${cell(o => { const d = +o.price - +s.allowance; return `<span class="num ${d > 0 ? 'over' : 'under'}">${d > 0 ? signed(d) + ' over' : money(-d) + ' under'}</span>`; })}</tr>` : ''}
    <tr><th>Favorites</th>${cell(o => favsOf(o.id).length ? `<span class="fav-line">${HEART} ${esc(favLabel(o.id))}</span>` : (!isStaff() ? `<button class="edit-link" data-act="fav" data-o="${o.id}">Add to favorites</button>` : '<span class="muted">—</span>'))}</tr>
    ${canPick ? `<tr><th></th>${cell(o => `<button class="btn sm ${(S.ui.pick?.[s.id]) === o.id ? 'primary' : ''}" data-act="sel-pick" data-id="${s.id}" data-o="${o.id}">${(S.ui.pick?.[s.id]) === o.id ? 'Selected' : 'Choose'}</button>`)}</tr>` : ''}
  </table></div>`;
}
function vSelections() {
  const sels = S.d.selections, order = { open: 0, submitted: 1, later: 2, approved: 3 };
  const list = [...sels].sort((a,b) => order[a.status] - order[b.status] || (D(a.due_date) || 0) - (D(b.due_date) || 0));
  const count = st => sels.filter(s => s.status === st).length;
  return pageHead(esc(L.designCenter), 'Selections', 'Each finish, its date, and how it compares to your allowance. Heart the options you love while you decide; dates are set so materials arrive before the craftsmen do.', isStaff() ? `<button class="btn primary" data-act="sel-new">Add a selection</button>` : '') + `
  <div class="summary">
    <div class="stat"><div class="v num">${count('open')}</div><div class="l">To choose</div></div>
    <div class="stat"><div class="v num">${count('submitted')}</div><div class="l">With the ${esc(L.designCenter)}</div></div>
    <div class="stat"><div class="v num">${count('approved')}</div><div class="l">Approved</div></div>
    <div class="stat"><div class="v num" style="font-size:30px">${signed(allowanceVar('approved'))}</div><div class="l">Allowance difference</div></div>
  </div>
  ${allowanceSummary()}
  ${list.length ? `<div>${list.map(s => {
    const isOpen = S.ui.openSel === s.id, pick = chosen(s), opts = optionsOf(s.id), cmp = S.ui.compare?.[s.id] && opts.length > 1;
    const favCount = opts.filter(o => favsOf(o.id).length).length;
    const tag = s.status === 'approved' ? '<span class="tag good">Approved</span>' : s.status === 'submitted' ? `<span class="tag brass">With the ${esc(L.designCenter)}</span>` : s.status === 'later' ? `<span class="tag">Opens later${s.due_date ? ' · ' + fd(s.due_date) : ''}</span>` : `<span class="tag ${(daysTo(s.due_date) ?? 99) <= 14 ? 'solid' : ''}">Due ${s.due_date ? fd(s.due_date) : 'soon'}</span>`;
    return `<section class="sel">
      <button class="sel-head" data-act="sel-toggle" data-id="${s.id}" aria-expanded="${isOpen}">
        <span><h3>${esc(s.category)}</h3><span class="small muted">${esc(s.area || '')}${+s.allowance ? ` · allowance <span class="num">${money(s.allowance)}</span>` : ''}${pick && !isOpen ? ` · <span class="ital">${esc(pick.name)}</span>` : ''}${!pick && favCount && !isOpen ? ` · ${favCount} favorite${favCount > 1 ? 's' : ''}` : ''}</span></span>${tag}</button>
      ${isOpen ? `${s.note ? `<p class="muted" style="margin-top:14px;font-family:var(--f-display);font-style:italic;font-size:17px">${gloss(s.note)}</p>` : ''}
        ${opts.length ? `<div class="sel-tools">${opts.length > 1 ? `<div class="seg" role="group" aria-label="View"><button data-act="sel-view" data-id="${s.id}" data-v="grid" aria-pressed="${!cmp}">Gallery</button><button data-act="sel-view" data-id="${s.id}" data-v="compare" aria-pressed="${!!cmp}">Compare</button></div>` : '<span></span>'}
          ${!isStaff() ? `<button class="edit-link" data-act="sel-ask" data-id="${s.id}">Ask the ${esc(L.designCenter)}</button>` : ''}</div>
          ${cmp ? compareTable(s) : `<div class="opts">${opts.map(o => optCard(s, o)).join('')}</div>`}`
        : `<p class="muted" style="margin-top:14px">${isStaff() ? 'No options yet. Add the first one below.' : 'Options will be posted here.'}</p>`}
        <div class="row" style="margin-top:18px;justify-content:flex-end">
          ${!isStaff() && s.status === 'open' ? `<span class="small muted" style="flex:1">${S.ui.pick?.[s.id] ? 'Ready to submit. You can change your mind until it’s confirmed.' : 'Tap an option to select it.'}</span><button class="btn primary" data-act="sel-submit" data-id="${s.id}" ${S.ui.pick?.[s.id] ? '' : 'disabled'}>Submit selection</button>` : ''}
          ${!isStaff() && s.status === 'submitted' ? `<span class="small muted" style="flex:1">Submitted. The ${esc(L.designCenter)} will confirm pricing and lead time.</span><button class="btn sm ghost" data-act="sel-withdraw" data-id="${s.id}">Change my selection</button>` : ''}
          ${isStaff() ? `<span style="flex:1"></span><button class="edit-link" data-act="opt-new" data-id="${s.id}">Add option</button><button class="edit-link" data-act="sel-edit" data-id="${s.id}">Edit</button>
            ${s.status === 'submitted' ? `<button class="btn sm ghost" data-act="sel-reopen" data-id="${s.id}">Reopen</button><button class="btn primary sm" data-act="sel-confirm" data-id="${s.id}">Confirm & order</button>` : ''}
            ${s.status === 'later' ? `<button class="btn primary sm" data-act="sel-open" data-id="${s.id}">Open for choosing</button>` : ''}` : ''}
          ${!isStaff() && s.status === 'approved' ? `<span class="small muted" style="flex:1">Ordered. Any change from here is handled through a change order.</span>` : ''}
        </div>` : ''}
    </section>`; }).join('')}</div>` : `<div class="empty">${isStaff() ? 'Add the first selection category, such as plumbing fixtures or countertops.' : 'Your selections will appear here.'}</div>`}`;
}

function vChanges() {
  const pend = pendingCOs().reduce((a,c) => a + +c.amount, 0);
  const form = isStaff() ? `
    <section class="card composer" style="margin-bottom:32px"><span class="eyebrow">Prepare a change order</span>
      <div class="field"><label for="co-title">Change</label><input id="co-title" placeholder="Pendant lighting over the island, three fixtures"></div>
      <div class="field"><label for="co-details">Details</label><textarea id="co-details" placeholder="What changes, what's included, and what isn't"></textarea></div>
      <div class="row" style="align-items:flex-end"><div class="field"><label for="co-amount">Price change ($)</label><input id="co-amount" type="number" inputmode="decimal" placeholder="4800"></div>
        <div class="field"><label for="co-days">Days added to schedule</label><input id="co-days" type="number" inputmode="numeric" value="0"></div></div>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" data-act="co-new">Send for signature</button></div></section>` : '';
  return pageHead('Agreements', 'Change orders', 'Every change to the plan, price, or schedule, in writing. Nothing proceeds until it’s signed here.',
    `<div class="small muted">Signed to date</div><span class="big-figure num">${signed(approvedCOTotal())}</span>${pend ? `<div class="small" style="color:var(--brass)">${signed(pend)} awaiting signature</div>` : ''}`) +
  `<div style="max-width:960px">${form}
  ${S.d.change_orders.length ? S.d.change_orders.map(c => `
    <article class="co">
      <div class="stack" style="gap:8px;min-width:0">
        <div class="row" style="gap:10px"><span class="eyebrow" style="color:var(--muted)">CO-${String(c.number).padStart(2,'0')}</span>${c.status === 'approved' ? '<span class="tag good">Signed</span>' : c.status === 'declined' ? '<span class="tag bad">Declined</span>' : '<span class="tag solid">Awaiting signature</span>'}</div>
        <h3>${esc(c.title)}</h3>
        ${c.details ? `<p class="muted" style="max-width:60ch">${gloss(c.details)}</p>` : ''}
        <span class="small muted">Prepared by ${esc(nameOf(c.created_by))} · ${ft(c.created_at)}${c.signature ? ` · signed <span class="ital" style="color:var(--ink);font-size:16px">${esc(c.signature)}</span> by ${esc(nameOf(c.signed_by))}, ${ft(c.signed_at)}` : ''}${c.decline_note ? ` · “${esc(c.decline_note)}”` : ''}</span>
      </div>
      <div class="amt">
        <span class="v num">${signed(c.amount)}</span><span class="small muted">${c.days ? `${c.days} day${c.days > 1 ? 's' : ''} added` : 'No schedule change'}</span>
        ${c.status === 'pending' && !isStaff() ? `<div class="row" style="gap:8px"><button class="btn sm ghost" data-act="co-decline" data-id="${c.id}">Decline</button><button class="btn sm primary" data-act="co-approve" data-id="${c.id}">Review & sign</button></div>` : ''}
        ${c.status === 'pending' && isStaff() ? `<span class="small muted">Awaiting ${esc(clientFirst())}</span><button class="edit-link" data-act="co-del" data-id="${c.id}">Withdraw</button>` : ''}
      </div>
    </article>`).join('') : '<div class="empty">No change orders.</div>'}</div>`;
}

function vBudget() {
  const p = P(), contract = +p.contract_amount, co = approvedCOTotal(), av = allowanceVar('approved'), total = contract + co + av;
  const paid = S.d.draws.filter(d => d.status === 'paid').reduce((a,d) => a + contract * d.percent / 100, 0);
  const next = S.d.draws.find(d => d.status === 'next');
  return pageHead('Financials', 'Your investment, <span class="ital">clearly kept</span>', 'Where the agreement stands today and when each draw is due. Change orders and allowance differences are reconciled at closing.', isStaff() ? editBtn('home-edit', null, 'Edit contract amount') : '') + `
  <div class="grid2">
    <section>
      <div class="sec-h"><h2>Draw schedule</h2><span class="aside num">${money(paid)} of ${money(contract)}</span></div>
      <div class="meter" aria-label="Paid versus remaining"><i style="width:${contract ? paid / contract * 100 : 0}%;background:var(--ink)"></i>${next ? `<i style="width:${next.percent}%;background:var(--brass)"></i>` : ''}</div>
      <div class="row small muted" style="margin:6px 0 18px;gap:20px"><span><i style="display:inline-block;width:14px;height:2px;background:var(--ink);vertical-align:middle"></i> Paid</span><span><i style="display:inline-block;width:14px;height:2px;background:var(--brass);vertical-align:middle"></i> Next draw</span></div>
      <div class="tablewrap"><table><thead><tr><th></th><th>Milestone</th><th class="n">Share</th><th class="n">Amount</th><th class="n">Status</th></tr></thead><tbody>
      ${S.d.draws.map((d,i) => `<tr><td class="ital muted" style="font-size:17px">${rom(i)}</td><td><b>${esc(d.name)}</b><div class="small muted">${d.status === 'paid' ? (d.paid_date ? 'Paid ' + fd(d.paid_date) : 'Paid') : (d.due_date ? 'Anticipated ' + fd(d.due_date) : '')}</div></td><td class="n">${+d.percent}%</td><td class="n">${money(contract * d.percent / 100)}</td>
        <td class="n">${isStaff() ? `<select class="input" style="width:auto;font-size:13px" data-change="draw-status" data-id="${d.id}" aria-label="Status of ${esc(d.name)}">${['scheduled','next','paid'].map(s => `<option value="${s}" ${d.status === s ? 'selected' : ''}>${s === 'scheduled' ? 'Scheduled' : s === 'next' ? 'Next' : 'Paid'}</option>`).join('')}</select>`
          : d.status === 'paid' ? '<span class="tag good">Paid</span>' : d.status === 'next' ? '<span class="tag brass">Next</span>' : '<span class="tag">Scheduled</span>'}</td></tr>`).join('')}
      </tbody></table></div>
    </section>
    <div class="stack" style="gap:28px">
      <section class="card">
        <span class="eyebrow">Agreement today</span>
        <div class="ledger" style="margin-top:12px">
          <div><span>Base agreement</span><span>${money(contract)}</span></div>
          <div><span>Signed change orders</span><span>${signed(co)}</span></div>
          <div><span>Allowance differences</span><span>${signed(av)}</span></div>
          <div class="total"><span>Current total</span><span>${money(total)}</span></div>
        </div>
        ${pendingCOs().length || allowanceVar('submitted') ? `<p class="small muted" style="margin-top:12px">Not yet reflected: ${pendingCOs().length} unsigned change order${pendingCOs().length === 1 ? '' : 's'} (${signed(pendingCOs().reduce((a,c) => a + +c.amount, 0))})${allowanceVar('submitted') ? ` and submitted selections (${signed(allowanceVar('submitted'))})` : ''}.</p>` : ''}
      </section>
      ${next ? `<section class="card" style="background:var(--navy);color:var(--navy-ink);border-color:transparent">
        <span class="eyebrow" style="color:var(--brass-bright)">Next draw</span>
        <div class="big-figure num" style="margin:10px 0 6px">${money(contract * next.percent / 100)}</div>
        <p style="color:var(--navy-muted)">${esc(next.name)}${next.due_date ? `, anticipated ${fdL(next.due_date)}` : ''}.</p>
      </section>` : ''}
    </div>
  </div>`;
}

function eventRow(e, compact) {
  const past = (daysTo(e.starts_on) ?? 0) < 0 || e.status === 'done';
  return `<div class="event ${e.is_key ? 'key' : ''} ${past ? 'past' : ''}">
    <div class="date"><div class="d num">${D(e.starts_on).getDate()}</div><div class="w">${fd(e.starts_on, {month:'short'})} · ${fd(e.starts_on, {weekday:'short'})}</div></div>
    <div style="min-width:0"><div class="row" style="gap:10px"><b>${esc(e.title)}</b>${e.status === 'requested' ? '<span class="tag brass">Requested</span>' : ''}</div>
      <div class="small muted">${[e.kind, e.time_label, e.location].filter(Boolean).map(esc).join(' · ')}</div>${e.note ? `<div class="small" style="margin-top:3px">${esc(e.note)}</div>` : ''}</div>
    ${!compact && isStaff() ? `<div class="act row" style="gap:10px">${e.status === 'requested' ? `<button class="btn sm primary" data-act="ev-confirm" data-id="${e.id}">Confirm</button>` : ''}<button class="edit-link" data-act="ev-edit" data-id="${e.id}">Edit</button></div>` : '<div></div>'}
  </div>`;
}
function vCalendar() {
  const groups = {};
  S.d.events.forEach(e => { const k = fd(e.starts_on, {month:'long', year:'numeric'}); (groups[k] = groups[k] || []).push(e); });
  return pageHead('Calendar', 'Visits, inspections <span class="ital">&amp; dates to hold</span>', 'Private visits, design appointments, inspections, and decision dates. Highlighted dates are the ones not to miss.',
    isStaff() ? `<button class="btn primary" data-act="ev-new">Add a date</button>` : B.requestKinds.map(k => `<button class="btn sm ghost" style="margin:0 0 6px 6px" data-act="request" data-k="${esc(k)}">Request a ${esc(k.toLowerCase())}</button>`).join('')) +
  (S.d.events.length ? `<div class="stack" style="max-width:900px;gap:40px">${Object.entries(groups).map(([m, evs]) => `<section class="month"><span class="eyebrow">${m}</span>${evs.map(e => eventRow(e)).join('')}</section>`).join('')}</div>` : '<div class="empty">No dates scheduled yet.</div>');
}

function docRows() {
  const q = S.ui.docQ.trim().toLowerCase();
  const rows = S.d.documents.filter(d => (S.ui.docFolder === 'All' || d.folder === S.ui.docFolder) && (!q || d.name.toLowerCase().includes(q)));
  if (!rows.length) return `<tr><td colspan="4" class="muted" style="text-align:center;padding:28px">${S.d.documents.length ? `No documents match.` : 'No documents yet.'}</td></tr>`;
  const kb = b => !b ? '' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  return rows.map(d => `<tr><td><div class="file"><span class="ext">${esc((d.name.split('.').pop() || 'file').toUpperCase().slice(0,4))}</span><button data-act="doc-open" data-id="${d.id}">${esc(d.name.replace(/\.[a-z0-9]+$/i, ''))}</button>${(Date.now() - new Date(d.created_at)) < 7 * 864e5 ? '<span class="tag brass">New</span>' : ''}</div></td>
    <td class="muted small">${esc(d.folder)}</td><td class="n small">${ft(d.created_at)}</td><td class="n small muted">${kb(d.size_bytes)}${isStaff() ? ` <button class="edit-link" data-act="doc-del" data-id="${d.id}" style="margin-left:8px">Delete</button>` : ''}</td></tr>`).join('');
}
function vDocuments() {
  const folders = ['All', ...new Set([...B.documentFolders.filter(f => S.d.documents.some(d => d.folder === f)), ...S.d.documents.map(d => d.folder)])];
  return pageHead('Archive', 'Documents', 'Drawings, permits, inspections, agreements, and invoices, kept for you long after closing.',
    isStaff() ? `<div class="row" style="align-items:flex-end"><div class="field"><label for="doc-folder">Folder</label><select id="doc-folder">${B.documentFolders.map(f => `<option>${esc(f)}</option>`).join('')}</select></div><label class="btn primary" for="doc-up">Upload<input type="file" id="doc-up" multiple hidden></label></div>` : '') + `
  <div class="folders">${folders.map(f => `<button data-act="doc-folder" data-f="${esc(f)}" aria-pressed="${S.ui.docFolder === f}">${esc(f)}</button>`).join('')}</div>
  <div class="field" style="max-width:480px;margin-bottom:18px"><input class="input" id="doc-q" type="search" placeholder="Search documents" value="${esc(S.ui.docQ)}" aria-label="Search documents"></div>
  <div class="tablewrap"><table><thead><tr><th>Name</th><th>Folder</th><th class="n">Added</th><th class="n">Size</th></tr></thead><tbody id="doc-rows">${docRows()}</tbody></table></div>`;
}

function vWalkthrough() {
  return pageHead('Notes & aftercare', 'Notice something? <span class="ital">Note it here.</span>', `Anything you’d like adjusted, captured as you visit. Your ${esc(L.projectLead.toLowerCase())} reviews each note, and open notes carry into your ${esc(L.finalTour.toLowerCase())}.`) + `
  <div class="grid2">
    <div class="stack" style="gap:40px">
      <section>
        <div class="sec-h"><h2>${isStaff() ? 'Client notes' : 'My notes'}</h2><span class="aside">${S.d.notes.length}</span></div>
        <div class="row" style="align-items:flex-end;margin-bottom:20px">
          <div class="field" style="flex:0 1 170px"><label for="note-room">Room</label><input id="note-room" placeholder="Library"></div>
          <div class="field" style="flex:1 1 240px"><label for="note-text">${isStaff() ? 'Note' : 'What you noticed'}</label><input id="note-text" placeholder="Shelf spacing for the art books"></div>
          <button class="btn primary" data-act="note-add">Add note</button></div>
        ${S.d.notes.map(n => `<div class="spread" style="padding:16px 0;border-top:1px solid var(--line);flex-wrap:nowrap;align-items:flex-start">
          <div style="min-width:0"><span class="eyebrow">${esc(n.room || 'General')}</span><div style="font-family:var(--f-display);font-size:18px;margin-top:4px">${esc(n.body)}</div><div class="small muted">${esc(nameOf(n.author_id))} · ${ft(n.created_at)}</div></div>
          <div class="row" style="gap:6px;flex-wrap:nowrap">${n.reviewed ? '<span class="tag good">Reviewed</span>' : isStaff() ? `<button class="btn sm" data-act="note-ack" data-id="${n.id}">Mark reviewed</button>` : `<span class="tag">With ${esc(firstName(pm()?.id))}</span>`}
          ${n.author_id === S.me.id ? `<button class="edit-link" data-act="note-del" data-id="${n.id}">Remove</button>` : ''}</div></div>`).join('')}
      </section>
    </div>
    <div class="stack" style="gap:28px">
      <section class="card"><span class="eyebrow">Coverage</span>
        <div class="ledger" style="margin-top:12px">${B.warranty.map(([k,v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div></section>
      <section class="card" style="background:var(--navy);color:var(--navy-ink);border-color:transparent">
        <span class="eyebrow" style="color:var(--brass-bright)">${esc(L.closing)} and after</span>
        <p style="font-family:var(--f-display);font-size:20px;line-height:1.45;margin-top:10px">${esc(B.aftercare)}</p>
        <div class="row" style="margin-top:18px;gap:10px"><a href="#manual" class="btn" style="border-color:var(--brass-bright);color:var(--navy-ink)">Your home manual</a><a href="#diary" class="btn" style="border-color:var(--brass-bright);color:var(--navy-ink)">Your photo diary</a></div>
      </section>
    </div>
  </div>`;
}

function vGlossary() {
  const groups = [...new Set(GLOSS.map(g => g.group || 'More'))];
  return pageHead('Glossary', 'Building terms, <span class="ital">in plain English</span>', 'The words your team uses, explained. Wherever you see a word with a dotted underline in your portal, tap it for the same explanation.') + `
  <div class="gloss-tools">
    <div class="field"><input class="input" id="gloss-q" type="search" placeholder="Look up a word" value="${esc(S.ui.glossQ || '')}" aria-label="Look up a word" autocomplete="off"></div>
    <nav class="gloss-jump" aria-label="Sections">${groups.map((g, i) => `<button type="button" data-act="gloss-jump" data-v="${i}">${esc(g)}</button>`).join('')}</nav>
  </div>
  <div id="gloss-list">${glossList()}</div>`;
}
function glossList() {
  const q = (S.ui.glossQ || '').trim().toLowerCase();
  const groups = [...new Set(GLOSS.map(g => g.group || 'More'))];
  const hits = GLOSS.filter(g => !q || [g.term, ...(g.also || []), g.def].join(' ').toLowerCase().includes(q))
    .sort((a, b) => q ? (+!a.term.toLowerCase().startsWith(q) - +!b.term.toLowerCase().startsWith(q)) : 0);
  if (!hits.length) return `<div class="empty">No match for “${esc(S.ui.glossQ)}”. <a href="#messages">Ask ${esc(firstName(pm()?.id) || 'your team')}</a> and we’ll explain.</div>`;
  return groups.map((grp, gi) => { const items = hits.filter(g => (g.group || 'More') === grp); return items.length ? `<section class="gloss-group" id="gg-${gi}"><span class="eyebrow">${esc(grp)}</span>
    <dl>${items.map(g => `<div class="gloss-item${S.ui.glossFocus === g.i ? ' lit' : ''}" id="term-${g.i}"><dt>${esc(g.term)}</dt><dd>${esc(g.def)}</dd></div>`).join('')}</dl></section>` : ''; }).join('');
}
function showTerm(el) {
  const g = GLOSS[+el.dataset.k]; if (!g) return;
  let p = $('#term-pop');
  if (!p) { p = document.createElement('div'); p.id = 'term-pop'; p.className = 'term-pop'; p.setAttribute('role', 'tooltip'); document.body.appendChild(p); }
  if (!p.hidden && p.dataset.k === el.dataset.k) { p.hidden = true; return; }
  p.dataset.k = el.dataset.k;
  p.innerHTML = `<b>${esc(g.term)}</b><p>${esc(g.def)}</p><a href="#glossary" data-term="${g.i}">All terms</a>`;
  p.hidden = false;
  const r = el.getBoundingClientRect(), w = Math.min(320, innerWidth - 32);
  p.style.width = w + 'px';
  p.style.left = Math.max(16, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 16)) + 'px';
  const h = p.offsetHeight, below = r.bottom + 10;
  p.style.top = (below + h > innerHeight - 16 && r.top - h - 10 > 16 ? r.top - h - 10 : below) + 'px';
}
const hideTerm = () => { const p = $('#term-pop'); if (p) p.hidden = true; };
function focusTerm() {
  const i = S.ui.glossFocus; if (i == null) return;
  const el = $(`#term-${i}`); if (!el) return;
  el.scrollIntoView({ block: 'center' }); setTimeout(() => { S.ui.glossFocus = null; el.classList.remove('lit'); }, 2600);
}

function vTeam() {
  const staff = Object.values(S.profiles).filter(p => p.role !== 'client' && p.builder_id === S.me.builder_id);
  return pageHead('Your team', 'The people <span class="ital">building your home</span>', 'One point of contact for everything, so nothing is lost between conversations.') + `
  <div class="people">${staff.map(p => `<section class="card person"><span class="av">${ini(p.full_name || p.email)}</span><div><h3>${esc(p.full_name || p.email)}</h3><span class="eyebrow">${esc(p.title || (p.role === 'admin' ? 'Principal' : 'Team'))}</span></div>
    ${p.phone ? `<div class="copyline"><span>${esc(p.phone)}</span><button class="btn sm ghost" data-act="copy" data-v="${esc(p.phone)}">Copy</button></div>` : ''}
    ${p.email ? `<div class="copyline small muted"><span>${esc(p.email)}</span></div>` : ''}
    ${(() => { const d = (P().duties ? DUTIES().filter(([k]) => P().duties[k] === p.id).map(([, l]) => l) : []); return d.length ? `<div class="small muted">${p.id === P().pm_id ? 'Also handles' : 'Your contact for'} ${d.map(esc).join(', ').toLowerCase()}</div>` : ''; })()}
    ${p.id === P().pm_id ? `<span class="tag brass" style="align-self:flex-start">${esc(L.projectLead)} for this home</span>` : isStaff() ? `<button class="edit-link" style="align-self:flex-start" data-act="set-pm" data-id="${p.id}">Make ${esc(L.projectLead.toLowerCase())} for this home</button>` : ''}
  </section>`).join('')}</div>
  ${isStaff() && DUTIES().length ? `<section class="duties"><div class="sec-h"><h2>Who handles what</h2><span class="aside">This home</span></div>
    <p class="small muted" style="max-width:62ch;margin:-6px 0 14px">Each area’s requests, reminders, and emails go to the person you choose. Anything left on the default goes to ${esc(pm()?.full_name || 'the ' + L.projectLead.toLowerCase())}.</p>
    <div class="duty-grid">${DUTIES().map(([k, l]) => `<label class="duty"><span>${esc(l)}</span><select class="input" data-change="duty" data-v="${k}">
      <option value="">${esc(L.projectLead)}${pm() ? ' (' + esc((pm().full_name || '').split(' ')[0]) + ')' : ''}</option>${staff.filter(x => x.id !== P().pm_id).map(x => `<option value="${x.id}"${(P().duties || {})[k] === x.id ? ' selected' : ''}>${esc(x.full_name || x.email)}</option>`).join('')}</select></label>`).join('')}</div></section>` : ''}
  <div class="grid2" style="margin-top:56px">
    <section>
      <div class="sec-h"><h2>${isStaff() ? `${esc(L.client)}s on this home` : 'Visiting the site'}</h2></div>
      ${isStaff() ? `${clients().map(c => `<div class="spread" style="padding:12px 0;border-bottom:1px solid var(--line)"><span>${esc(c.full_name || c.email)}</span><span class="small muted">${esc(c.email || '')}</span></div>`).join('') || '<p class="muted">No one yet.</p>'}
        <div class="composer" style="margin-top:22px"><span class="eyebrow">Invite a ${esc(L.client.toLowerCase())}</span>
          <div class="form-grid"><div class="field"><label for="iv-name">Full name</label><input id="iv-name" placeholder="Lauren Morgan"></div><div class="field"><label for="iv-email">Email</label><input id="iv-email" type="email" placeholder="lauren@example.com"></div></div>
          <div class="row" style="justify-content:flex-end"><button class="btn primary" data-act="invite" data-role="client">Send invitation</button></div></div>
        ${isAdmin() ? `<div class="composer" style="margin-top:32px"><span class="eyebrow">Add a team member</span>
          <div class="form-grid"><div class="field"><label for="is-name">Full name</label><input id="is-name"></div><div class="field"><label for="is-email">Email</label><input id="is-email" type="email"></div>
          <div class="field"><label for="is-title">Title</label><input id="is-title" placeholder="${esc(L.projectLead)}"></div><div class="field"><label for="is-phone">Phone</label><input id="is-phone" type="tel"></div></div>
          <div class="row" style="justify-content:flex-end"><button class="btn" data-act="invite" data-role="staff">Invite team member</button></div></div>` : ''}`
      : `<p>${esc(P().site_access || 'You’re welcome during working hours. Please check with your project manager before visiting.')}</p>`}
    </section>
    <section class="card"><span class="eyebrow">${esc(B.fullName)}</span>
      <p style="margin:12px 0 6px">${esc(B.office.address)}</p><p class="small muted">${esc(B.office.hours)}</p>
      ${P().address ? `<div class="copyline" style="margin-top:14px"><span class="muted caps">Site</span><span>${esc(P().address)}</span></div>` : ''}
      ${P().permit ? `<div class="copyline" style="margin-top:14px"><span class="muted caps">Permit</span><span>${esc(P().permit)}</span></div>` : ''}
      ${isStaff() ? `<div style="margin-top:16px">${editBtn('home-edit', null, 'Edit site access & permit')}</div>` : ''}</section>
    ${isStaff() ? emailPanel() : ''}
  </div>`;
}

function vDiary() {
  const p = P(), byDate = (a, b) => new Date(a.created_at) - new Date(b.created_at);
  const chapters = S.d.phases.map((ph, i) => ({ ph, i, ups: S.d.updates.filter(u => u.phase_id === ph.id).sort(byDate) })).filter(c => c.ups.length);
  const loose = S.d.updates.filter(u => !phaseById(u.phase_id)).sort(byDate);
  if (loose.length) chapters.push({ ph: { name: 'Along the way' }, i: null, ups: loose });
  const nPhotos = S.d.update_photos.length;
  const nameParts = p.name.split(' '), last = nameParts.pop();
  const img = ph => S.urls[ph.path] ? `<figure><img src="${esc(S.urls[ph.path])}" alt="${esc(ph.caption || '')}">${ph.caption ? `<figcaption>${esc(ph.caption)}</figcaption>` : ''}</figure>` : '';
  const entry = u => { const ps = photosOf(u.id); return `<article class="entry">
      <span class="eyebrow">${fdL(u.created_at.slice(0, 10))}</span>
      ${u.body ? `<p class="entry-text">${esc(u.body)}</p>` : ''}
      ${ps.length ? `<div class="entry-photos n${Math.min(ps.length, 3)}">${ps.map(img).join('')}</div>` : ''}
    </article>`; };
  return `
  <div class="diary-tools">
    <div><span class="eyebrow">Photo diary</span><p class="muted small" style="margin-top:4px">${S.d.updates.length} entries · ${nPhotos} photograph${nPhotos === 1 ? '' : 's'} · grows with every update from the site</p></div>
    <div class="row"><button class="btn primary" data-act="print">Save as PDF or print</button></div>
  </div>
  <div class="diary">
    <section class="diary-cover">
      ${B.logo ? `<img class="diary-logo" src="${esc(B.logo.onDark)}" alt="${esc(B.fullName)}">` : `<span class="eyebrow">${esc(B.fullName)}</span>`}
      <h1>${esc(nameParts.join(' '))} <em>${esc(last)}</em></h1>
      <p class="sub">${[p.lot, p.address].filter(Boolean).map(esc).join(' · ')}</p>
      ${p.cover_path && S.urls[p.cover_path] ? `<img class="cover-img" src="${esc(S.urls[p.cover_path])}" alt="">` : ELEV}
      <div class="diary-cover-foot"><span class="ital">A photo diary of construction</span><span>${p.start_date ? fd(p.start_date, {month:'long', year:'numeric'}) : ''}${p.closing_date ? ' – ' + fd(p.closing_date, {month:'long', year:'numeric'}) : ''}</span></div>
    </section>
    ${chapters.length ? chapters.map(c => `
    <section class="chapter">
      <header class="ch-head">${c.i !== null ? `<span class="ch-num">${rom(c.i)}</span>` : ''}<div><h2>${esc(c.ph.name)}</h2>${c.ph.start_date ? `<span class="small muted">${fd(c.ph.start_date, {month:'long', day:'numeric'})} – ${fd(c.ph.end_date, {month:'long', day:'numeric', year:'numeric'})}</span>` : ''}</div></header>
      ${c.ph.what ? `<p class="ch-intro">${esc(c.ph.what)}</p>` : ''}
      ${c.ups.map(entry).join('')}
    </section>`).join('') : `<div class="empty" style="margin-top:40px">The diary fills itself as updates are posted from the site.</div>`}
    <section class="diary-end">
      <span class="eyebrow">${esc(L.closing)}</span>
      <h2>Welcome <span class="ital">home</span></h2>
      ${p.closing_date ? `<p class="muted">${fdL(p.closing_date)}</p>` : ''}
      <p class="muted small" style="margin-top:28px">${esc(B.fullName)}${B.tagline ? ' · ' + esc(B.tagline) : ''}</p>
    </section>
  </div>`;
}

function emailPanel() {
  const st = { sent: ['good', 'Sent'], preview: ['', 'Not sent (email not connected)'], skipped: ['', 'Demo address'], failed: ['bad', 'Failed'], pending: ['', 'Sending'] };
  const log = S.d.notifications || [];
  return `<section class="emails">
    <div class="sec-h"><h2>Emails</h2><button class="btn sm" data-act="email-preview">Preview this Friday’s email</button></div>
    <p class="small muted" style="margin-bottom:12px">${esc(clientFirst())} get an email when something needs them, a reminder before it’s due, and “Your home this week” every Friday afternoon. You’re emailed when they act or message.</p>
    ${log.length ? `<div class="email-log">${log.map(n => `<div class="spread" style="padding:10px 0;border-bottom:1px solid var(--line);flex-wrap:nowrap;align-items:flex-start"><div style="min-width:0"><div>${esc(n.subject)}</div><div class="small muted">${esc(n.to_email)} · ${ft(n.created_at)}</div></div><span class="tag ${st[n.status]?.[0] || ''}" style="flex:none">${st[n.status]?.[1] || esc(n.status)}</span></div>`).join('')}</div>` : '<p class="muted small">No emails yet for this home.</p>'}
  </section>`;
}

const SURFACES = ['North wall', 'East wall', 'South wall', 'West wall', 'Ceiling', 'Floor', 'Other'];
const wallSystems = () => B.wallSystems || ['Plumbing', 'Electrical', 'HVAC', 'Low-voltage', 'Blocking'];
// Photos in one room, in the order they appear on screen (by surface), respecting the system filter
function roomPhotos(room) {
  const rank = x => { const i = SURFACES.indexOf(x || 'Other'); return i < 0 ? 99 : i; };
  return (S.d.wall_photos || []).filter(w => w.room === room && (!S.ui.wallSys || w.systems.includes(S.ui.wallSys)))
    .sort((a, b) => rank(a.surface) - rank(b.surface) || String(a.taken_on).localeCompare(String(b.taken_on)) || String(a.created_at).localeCompare(String(b.created_at)));
}
function wallRooms() {
  const ps = (S.d.wall_photos || []).filter(w => !S.ui.wallSys || w.systems.includes(S.ui.wallSys));
  const q = (S.ui.wallQ || '').trim().toLowerCase();
  const by = {};
  ps.forEach(w => { if (!q || w.room.toLowerCase().includes(q)) (by[w.room] = by[w.room] || []).push(w); });
  return Object.entries(by).sort((a, b) => a[0].localeCompare(b[0]));
}
function wallThumb(w) {
  const url = S.urls[w.path];
  return `<button class="ph wall-ph" data-act="wall-open" data-id="${w.id}" aria-label="${esc(w.room)}, ${esc(w.surface || 'photo')}">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : ''}
    <span class="cap">${w.systems.map(t => `<i class="sys">${esc(t)}</i>`).join('')}${w.caption ? `<span>${esc(w.caption)}</span>` : ''}</span></button>`;
}
function vWalls() {
  const all = S.d.wall_photos || [], room = S.ui.wallRoom;
  const head = pageHead('Behind the walls', 'What’s inside <span class="ital">every wall</span>',
    'Before insulation, your team photographed every wall, ceiling, and floor with the plumbing, wiring, ductwork, and blocking in place. Years from now, when you hang art or plan a renovation, look here first.',
    isStaff() ? `<button class="btn primary" data-act="wall-new">Photograph walls</button>` : '');
  if (!all.length) return head + `<div class="empty walls-empty">${isStaff()
    ? `Walk the house before insulation and photograph each wall, ceiling, and floor. Choose the room, the wall, and what’s in it; ${esc(clientFirst())} will have it for as long as they own the home.<div style="margin-top:16px"><button class="btn primary" data-act="wall-new">Photograph walls</button></div>`
    : 'Before insulation, your team photographs every wall so you’ll always know what’s behind it. The photos will appear here, room by room.'}</div>`;
  const filters = `<div class="wall-filters"><div class="folders" style="margin:0">${['All', ...wallSystems()].map(t => `<button data-act="wall-sys" data-v="${esc(t)}" aria-pressed="${(S.ui.wallSys || 'All') === t}">${esc(t)}</button>`).join('')}</div>
    ${!room ? `<div class="field" style="min-width:220px"><input class="input" id="wall-q" type="search" placeholder="Find a room" value="${esc(S.ui.wallQ || '')}" aria-label="Find a room"></div>` : ''}</div>`;
  if (room) {
    const ps = roomPhotos(room);
    const groups = [...SURFACES, ...new Set(ps.map(w => w.surface || 'Other'))].filter((v, i, a) => a.indexOf(v) === i);
    return head + filters + `<div class="wall-room-head"><button class="linkbtn" data-act="wall-room" data-v="">← All rooms</button><h2>${esc(room)}</h2>${isStaff() ? `<button class="btn sm" data-act="wall-new" data-room="${esc(room)}">Add photos</button>` : ''}</div>` +
      (ps.length ? groups.map(g => { const gs = ps.filter(w => (w.surface || 'Other') === g); return gs.length ? `<section class="wall-group"><span class="eyebrow">${esc(g)}</span><div class="photos big">${gs.map(wallThumb).join('')}</div></section>` : ''; }).join('')
        : `<div class="empty">No ${esc((S.ui.wallSys || '').toLowerCase())} photos in this room.</div>`);
  }
  const rooms = wallRooms();
  return head + filters + (rooms.length ? `<div class="wall-rooms">${rooms.map(([r, ps]) => { const sys = [...new Set(ps.flatMap(w => w.systems))]; const url = S.urls[ps[0].path];
    return `<button class="wall-room" data-act="wall-room" data-v="${esc(r)}"><span class="wr-img">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : ''}</span>
      <span class="wr-body"><b>${esc(r)}</b><span class="small muted">${ps.length} photo${ps.length > 1 ? 's' : ''}${sys.length ? ' · ' + sys.map(esc).join(', ') : ''}</span></span></button>`; }).join('')}</div>`
    : `<div class="empty">No rooms match.</div>`);
}
function wallForm(room) {
  const known = [...new Set([...(S.d.wall_photos || []).map(w => w.room), ...(B.wallRooms || [])])];
  const sys = S.wallDraftSys || [], surf = S.wallDraftSurface || '';
  return `<span class="eyebrow">Behind the walls</span><h2>${room ? esc(room) : 'Photograph a wall'}</h2>
    <div class="field"><label for="wf-room">Room</label><input id="wf-room" list="wf-rooms" value="${esc(room || '')}" placeholder="Primary bath" autocomplete="off"><datalist id="wf-rooms">${known.map(r => `<option value="${esc(r)}">`).join('')}</datalist></div>
    <div class="field"><span>Which surface</span><div class="chips">${SURFACES.map(x => `<button type="button" class="chip" data-act="wf-surf" data-v="${x}" aria-pressed="${surf === x}">${x}</button>`).join('')}</div></div>
    <div class="field"><span>What’s in it</span><div class="chips">${wallSystems().map(x => `<button type="button" class="chip" data-act="wf-sys" data-v="${esc(x)}" aria-pressed="${sys.includes(x)}">${esc(x)}</button>`).join('')}</div></div>
    <label class="drop" for="wf-files" style="position:relative">${S.draft.length ? `${S.draft.length} photo${S.draft.length > 1 ? 's' : ''} ready · add more` : 'Take or choose photos'}<input type="file" id="wf-files" accept="image/*" multiple></label>
    ${S.draft.length ? `<div class="thumbs">${S.draft.map(d => `<div class="ph" style="cursor:default"><img src="${d.preview}" alt=""></div>`).join('')}</div>` : ''}
    <div class="field"><label for="wf-cap">Note (optional)</label><input id="wf-cap" value="${esc(S.wallDraftCap || '')}" placeholder="Shower valve at 48 in. to center"></div>
    <p class="inline-err" id="wf-err" hidden></p>
    <div class="row wf-actions"><button class="btn ghost" data-act="modal-close">Done</button><button class="btn" data-act="wf-save" data-next="1">Save &amp; next wall</button><button class="btn primary" data-act="wf-save">Save</button></div>`;
}
const keepWallDraft = () => { S.wallDraftRoom = val('wf-room'); S.wallDraftCap = val('wf-cap'); };

/* ================= home manual ================= */
const WHOLE = 'Whole home';
const manCats = () => B.manualCategories || ['Paint', 'Flooring', 'Tile & stone', 'Countertops', 'Cabinetry', 'Plumbing fixtures', 'Lighting', 'Appliances', 'Hardware', 'Systems', 'Other'];
const manCare = c => (B.manualCare || {})[c] || '';
const catRank = c => { const i = manCats().indexOf(c); return i < 0 ? 99 : i; };
const byCat = (a, b) => catRank(a.category) - catRank(b.category) || a.position - b.position || String(a.created_at).localeCompare(String(b.created_at));
// Guess a manual category from a selection's name ("Kitchen faucet" → Plumbing fixtures)
function guessCat(t) {
  t = (t || '').toLowerCase();
  const rules = [['Paint', /paint|stain|colou?r|eggshell|matte|satin|gloss|emulsion|benjamin moore|sherwin|farrow/], ['Countertops', /counter|quartz|marble|granite|quartzite|slab/], ['Tile & stone', /tile|stone|backsplash|mosaic/],
    ['Flooring', /floor|hardwood|carpet|plank/], ['Cabinetry', /cabinet|vanity|millwork|built-in/], ['Plumbing fixtures', /faucet|plumb|sink|shower|tub|toilet|hose|bib|spigot|fixture/],
    ['Lighting', /light|pendant|chandelier|sconce|fixture/], ['Appliances', /appliance|range|oven|refrigerator|fridge|dishwasher|hood|cooktop|wine/],
    ['Hardware', /hardware|pull|knob|hinge|lever/], ['Windows & doors', /window|door/], ['Exterior', /roof|siding|brick|exterior|gutter/]];
  const hit = rules.find(([, re]) => re.test(t)); return hit && manCats().includes(hit[0]) ? hit[0] : 'Other';
}
const itemMatches = (it, q) => [it.room, it.category, it.name, it.maker, it.product, it.detail].join(' ').toLowerCase().includes(q);
function warrantyTag(it) {
  if (!it.warranty_until) return '';
  return D(it.warranty_until) < new Date() ? `<span class="tag">Warranty ended ${fd(it.warranty_until, { month: 'short', year: 'numeric' })}</span>`
    : `<span class="tag good">Warranty to ${fd(it.warranty_until, { month: 'short', year: 'numeric' })}</span>`;
}
function manItem(it, showRoom) {
  const img = it.photo_path ? (S.urls[it.photo_path] || (/^https?:/.test(it.photo_path) ? it.photo_path : '')) : '';
  const doc = it.document_id && S.d.documents.find(d => d.id === it.document_id);
  const line = [it.maker, it.product].filter(Boolean).map(esc).join(' · ');
  return `<article class="man-item${img ? '' : ' no-img'}">
    ${img ? `<button class="man-img" data-act="man-zoom" data-id="${it.id}" aria-label="Larger photo of ${esc(it.name)}"><img src="${esc(img)}" alt="" loading="lazy"></button>` : ''}
    <div class="man-body">
      <span class="eyebrow">${showRoom ? esc(it.room) + ' · ' : ''}${esc(it.category)}</span>
      <h3>${esc(it.name)}</h3>
      ${line ? `<div class="man-line">${line}</div>` : ''}
      ${it.detail ? `<div class="small muted">${esc(it.detail)}</div>` : ''}
      ${it.care ? `<details class="man-care"><summary>Care</summary><p>${gloss(it.care)}</p></details>` : ''}
      <div class="row man-foot">${warrantyTag(it)}${doc ? `<button class="btn sm ghost" data-act="doc-open" data-id="${doc.id}">Manual</button>` : ''}${!isStaff() && on('warranty') && isClosed() ? `<button class="edit-link" data-act="warr-new" data-item="${it.id}">Request service</button>` : ''}${isStaff() ? `<button class="edit-link" data-act="man-edit" data-id="${it.id}">Edit</button>` : ''}</div>
    </div></article>`;
}
function manRooms() {
  const by = {};
  (S.d.home_items || []).filter(i => i.room !== WHOLE).forEach(i => (by[i.room] = by[i.room] || []).push(i));
  return Object.entries(by).sort((a, b) => a[0].localeCompare(b[0]));
}
const pendingSelections = () => {
  const done = new Set((S.d.home_items || []).map(i => i.selection_id).filter(Boolean));
  return S.d.selections.filter(s => s.chosen_option_id && ['submitted', 'approved'].includes(s.status) && !done.has(s.id));
};
function vManual() {
  const all = S.d.home_items || [], room = S.ui.manRoom, q = (S.ui.manQ || '').trim().toLowerCase();
  const pend = isStaff() ? pendingSelections().length : 0;
  const head = pageHead('Home manual', 'Everything in your home, <span class="ital">room by room</span>',
    `Paint colors, finishes, fixtures, appliances, and where the important things are. It grows as your home is finished and is complete at ${esc(L.closing.toLowerCase().startsWith('the') ? L.closing : 'the ' + L.closing)}.`,
    isStaff() ? `<div class="row" style="justify-content:flex-end">${pend ? `<button class="btn" data-act="man-import">From selections <sup class="count">${pend}</sup></button>` : ''}<button class="btn" data-act="man-sheet">Import spreadsheet</button><button class="btn primary" data-act="man-new">Add to manual</button></div>`
      : all.length ? `<button class="btn" data-act="man-print">Print or save as PDF</button>` : '');
  if (S.ui.manPrint) return manPrint();
  if (!all.length) return head + `<div class="empty walls-empty">${isStaff()
    ? `Record what goes into ${esc(clientFirst())}’s home as it’s installed: paint colors, tile, fixtures, appliances, and where the shut-offs and panel are. Chosen selections can be added in one step.<div class="row" style="justify-content:center;margin-top:16px">${pend ? `<button class="btn" data-act="man-import">Add ${pend} chosen selection${pend > 1 ? 's' : ''}</button>` : ''}<button class="btn" data-act="man-sheet">Import a spreadsheet</button><button class="btn primary" data-act="man-new">Add to manual</button></div>`
    : 'As your home is finished, your team records every paint color, finish, fixture, and appliance here, room by room, along with where the shut-offs and panel are. It’s yours for as long as you own the home.'}</div>`;
  const search = `<div class="man-search field"><input class="input" id="man-q" type="search" placeholder="Find a color, fixture, or room" value="${esc(S.ui.manQ || '')}" aria-label="Search your home manual" autocomplete="off"></div>`;
  if (q) {
    const hits = all.filter(i => itemMatches(i, q)).sort((a, b) => a.room.localeCompare(b.room) || byCat(a, b));
    return head + search + `<div id="man-results">${hits.length ? `<div class="man-list">${hits.map(i => manItem(i, true)).join('')}</div>` : `<div class="empty">Nothing matches “${esc(S.ui.manQ)}”. <a href="#messages">Ask your team</a>.</div>`}</div>`;
  }
  if (room) {
    const items = all.filter(i => i.room === room).sort(byCat), walls = (S.d.wall_photos || []).filter(w => w.room === room).length;
    return head + `<div class="wall-room-head"><button class="linkbtn" data-act="man-room" data-v="">← All rooms</button><h2>${esc(room)}</h2>
      ${walls ? `<button class="linkbtn" data-act="man-walls" data-v="${esc(room)}">Behind the walls (${walls})</button>` : ''}${isStaff() ? `<button class="btn sm" data-act="man-new" data-room="${esc(room)}">Add</button>` : ''}</div>
      <div class="man-list">${items.map(i => manItem(i)).join('') || '<div class="empty">Nothing recorded in this room yet.</div>'}</div>`;
  }
  const ess = all.filter(i => i.room === WHOLE).sort(byCat), rooms = manRooms();
  return head + search +
    (ess.length ? `<section class="man-ess"><div class="sec-h"><h2>Where things are</h2><button class="linkbtn" data-act="man-room" data-v="${WHOLE}">All ${ess.length} →</button></div>
      <div class="man-ess-grid">${ess.slice(0, 6).map(i => `<button class="man-ess-card" data-act="man-room" data-v="${WHOLE}"><span class="eyebrow">${esc(i.name)}</span><span>${esc(i.detail || [i.maker, i.product].filter(Boolean).join(' · ') || '—')}</span></button>`).join('')}</div></section>` : '') +
    (rooms.length ? `<section><div class="sec-h"><h2>Rooms</h2><span class="aside">${rooms.length}</span></div><div class="man-rooms">${rooms.map(([r, its]) => {
      const cats = [...new Set(its.sort(byCat).map(i => i.category))], paint = its.find(i => i.category === 'Paint');
      return `<button class="man-room" data-act="man-room" data-v="${esc(r)}"><b>${esc(r)}</b><span class="small muted">${its.length} item${its.length > 1 ? 's' : ''} · ${cats.slice(0, 3).map(esc).join(', ')}${cats.length > 3 ? '…' : ''}</span>${paint ? `<span class="man-paint">${esc([paint.maker, paint.product].filter(Boolean).join(' '))}</span>` : ''}</button>`; }).join('')}</div></section>` : '');
}
function manPrint() {
  const all = S.d.home_items || [], ess = all.filter(i => i.room === WHOLE).sort(byCat), rooms = manRooms();
  const row = i => `<tr><td>${esc(i.category)}</td><td><b>${esc(i.name)}</b>${i.detail ? `<div>${esc(i.detail)}</div>` : ''}</td><td>${esc([i.maker, i.product].filter(Boolean).join(' · '))}</td><td>${i.warranty_until ? fd(i.warranty_until, { month: 'short', year: 'numeric' }) : ''}</td></tr>`;
  const table = items => `<table class="man-table"><thead><tr><th>Category</th><th>Item</th><th>Maker & product</th><th>Warranty to</th></tr></thead><tbody>${items.map(row).join('')}</tbody></table>`;
  return `<div class="man-print"><div class="man-print-head">${logoImg('man-logo')}<span class="eyebrow">Home manual</span><h1>${esc(P().name)}</h1><p class="muted">${esc(P().address || '')}</p></div>
    ${ess.length ? `<section><h2>Where things are</h2>${table(ess)}</section>` : ''}
    ${rooms.map(([r, its]) => `<section><h2>${esc(r)}</h2>${table(its.sort(byCat))}</section>`).join('')}
    <p class="small muted" style="margin-top:24px">Care instructions, manuals, and photos for each item are in your portal. Prepared by ${esc(B.fullName)}, ${fdL(new Date().toISOString())}.</p></div>`;
}
function manForm(it) {
  const d = S.manDraft, rooms = [...new Set([WHOLE, ...(S.d.home_items || []).map(i => i.room), ...(S.d.wall_photos || []).map(w => w.room), ...(B.wallRooms || [])])];
  const isWhole = d.room === WHOLE, prev = S.manPhoto?.preview || (d.photo_path ? (S.urls[d.photo_path] || (/^https?:/.test(d.photo_path) ? d.photo_path : '')) : '');
  return `<span class="eyebrow">Home manual</span><h2>${it ? 'Edit item' : d.room ? esc(d.room) : 'Add to the manual'}</h2>
    <div class="form-grid">
      <div class="field"><label for="mf-room">Room</label><input id="mf-room" list="mf-rooms" value="${esc(d.room || '')}" placeholder="Kitchen" autocomplete="off"><datalist id="mf-rooms">${rooms.map(r => `<option value="${esc(r)}">`).join('')}</datalist></div>
      <div class="field"><label for="mf-cat">Category</label><select id="mf-cat">${manCats().map(c => `<option${c === d.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field full"><label for="mf-name">What it is</label><input id="mf-name" list="mf-names" value="${esc(d.name || '')}" placeholder="${isWhole ? 'Main water shut-off' : 'Walls, Range, Shower fixtures'}" autocomplete="off"><datalist id="mf-names">${(B.manualEssentials || []).map(r => `<option value="${esc(r)}">`).join('')}</datalist></div>
      <div class="field"><label for="mf-maker">Brand or maker</label><input id="mf-maker" value="${esc(d.maker || '')}" placeholder="Benjamin Moore"></div>
      <div class="field"><label for="mf-product">Color, model, or style</label><input id="mf-product" value="${esc(d.product || '')}" placeholder="Chantilly Lace OC-65"></div>
      <div class="field full"><label for="mf-detail">Finish, size, serial, or location</label><input id="mf-detail" value="${esc(d.detail || '')}" placeholder="${isWhole ? 'Mechanical room, left of the water heater' : 'Eggshell, walls and ceiling'}"></div>
      <div class="field full"><label for="mf-care">Care</label><textarea id="mf-care" rows="3">${esc(d.care ?? manCare(d.category))}</textarea></div>
      <div class="field"><label for="mf-war">Warranty until (optional)</label><input id="mf-war" type="date" value="${esc(d.warranty_until || '')}"></div>
      <div class="field"><label for="mf-doc">Manual or spec sheet</label><select id="mf-doc"><option value="">None</option>${S.d.documents.map(x => `<option value="${x.id}"${x.id === d.document_id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    </div>
    <div class="man-photo-row">${prev ? `<img id="mf-prev" src="${esc(prev)}" alt="">` : '<span id="mf-prev"></span>'}<label class="btn sm" for="mf-photo" style="position:relative">${prev ? 'Replace photo' : 'Add a photo'}<input type="file" id="mf-photo" accept="image/*" class="sr-file"></label></div>
    <p class="inline-err" id="mf-err" hidden></p>
    <div class="row wf-actions">${it ? `<button class="edit-link" data-act="man-del" data-id="${it.id}" style="margin-right:auto">Remove</button>` : `<button class="btn ghost" data-act="modal-close">Done</button>`}${it ? '<button class="btn ghost" data-act="modal-close">Cancel</button>' : '<button class="btn" data-act="man-save" data-next="1">Save &amp; add another</button>'}<button class="btn primary" data-act="man-save" data-id="${it ? it.id : ''}">Save</button></div>`;
}
const readManForm = () => Object.assign(S.manDraft, { room: val('mf-room'), category: $('#mf-cat').value, name: val('mf-name'), maker: val('mf-maker'), product: val('mf-product'),
  detail: val('mf-detail'), care: $('#mf-care').value.trim(), warranty_until: $('#mf-war').value || null, document_id: $('#mf-doc').value || null });
function importSheet() {
  const list = pendingSelections();
  return `<span class="eyebrow">Home manual</span><h2>Add chosen selections</h2>
    <p class="small muted">Each chosen finish becomes a manual entry with its photo and a care note. Check the room for each; you can add serial numbers and manuals later.</p>
    <div class="imp-list">${list.map(s => { const o = S.d.selection_options.find(x => x.id === s.chosen_option_id);
      return `<label class="imp-row"><input type="checkbox" data-imp="${s.id}" checked><span class="imp-main"><b>${esc(s.category)}</b><span class="small muted">${esc(o?.name || '')}</span></span>
        <input class="input imp-room" data-imp-room="${s.id}" value="${esc(s.area || '')}" placeholder="Room" aria-label="Room for ${esc(s.category)}" list="mf-rooms"></label>`; }).join('')}</div>
    <datalist id="mf-rooms">${[...new Set([WHOLE, ...(S.d.home_items || []).map(i => i.room), ...(B.wallRooms || [])])].map(r => `<option value="${esc(r)}">`).join('')}</datalist>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="man-import-save">Add to manual</button></div>`;
}
/* ================= milestone moments ================= */
const momentLine = ph => (B.phases.find(x => x.name === ph.name) || {}).moment || `${short(ph.name)} is complete`;
const recentMoment = () => S.d.phases.filter(p => p.status === 'done' && p.completed_at && (Date.now() - new Date(p.completed_at)) < 21 * 864e5)
  .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))[0];
// Photos to choose from: this phase's site photos first, then the rest, newest first
function momentPhotos(ph) {
  const mine = S.d.updates.filter(u => u.phase_id === ph.id).flatMap(u => photosOf(u.id)).map(p => p.path);
  const rest = S.d.updates.filter(u => u.phase_id !== ph.id).flatMap(u => photosOf(u.id)).map(p => p.path);
  return [...new Set([...mine, ...(S.d.project.cover_path ? [S.d.project.cover_path] : []), ...rest])].filter(p => S.urls[p]).slice(0, 10);
}
function loadImg(src) { return new Promise((ok, no) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = no; i.src = src; }); }
async function drawMoment(ph, photoPath, showName, useLogo = true) {
  const W = 1080, H = 1350, PANEL = 900, PAD = 80, c = B.colors.light;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  await Promise.all([document.fonts.load(`500 96px ${B.fonts.display}`), document.fonts.load(`500 26px ${B.fonts.body}`), document.fonts.load(`400 28px ${B.fonts.body}`)]).catch(() => {});
  g.fillStyle = c.hero; g.fillRect(0, 0, W, H);
  const i = S.d.phases.findIndex(p => p.id === ph.id), n = S.d.phases.length;
  let img = null; if (photoPath) img = await loadImg(S.urls[photoPath]).catch(() => null);
  if (img) {
    const s = Math.max(W / img.width, PANEL / img.height), w = img.width * s, h = img.height * s;
    g.drawImage(img, (W - w) / 2, (PANEL - h) / 2, w, h);
    const gr = g.createLinearGradient(0, PANEL - 260, 0, PANEL); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, c.hero); g.fillStyle = gr; g.fillRect(0, PANEL - 260, W, 260);
  } else {
    g.fillStyle = c.hero2; g.fillRect(0, 0, W, PANEL);
    g.fillStyle = c.accentBright; g.globalAlpha = .14; g.font = `italic 500 620px ${B.fonts.display}`; g.textAlign = 'center'; g.fillText(rom(i), W / 2, 700); g.globalAlpha = 1; g.textAlign = 'left';
  }
  // eyebrow
  const ls = (t, x, y, sp) => { for (const ch of t) { g.fillText(ch, x, y); x += g.measureText(ch).width + sp; } return x; };
  g.fillStyle = c.accentBright; g.font = `500 24px ${B.fonts.body}`;
  ls((showName ? P().name : 'Our new home').toUpperCase(), PAD, 975, 5);
  // headline: shrink to fit, then wrap
  const line = momentLine(ph) + (/[.!?]$/.test(momentLine(ph)) ? '' : '.');
  let size = 104; g.fillStyle = c.heroInk;
  do { g.font = `500 ${size}px ${B.fonts.display}`; size -= 6; } while (g.measureText(line).width > W - PAD * 2 && size > 72);
  if (g.measureText(line).width > W - PAD * 2) { const words = line.split(' '), half = Math.ceil(words.length / 2); g.fillText(words.slice(0, half).join(' '), PAD, 1060); g.fillText(words.slice(half).join(' '), PAD, 1060 + size); }
  else g.fillText(line, PAD, 1075);
  // date + phase
  g.fillStyle = c.heroMuted; g.font = `400 28px ${B.fonts.body}`;
  g.fillText(`${short(ph.name)} · ${fdL(ph.completed_at || new Date().toISOString())}`, PAD, 1160);
  // progress
  g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(PAD, 1200, W - PAD * 2, 3);
  g.fillStyle = c.accentBright; g.fillRect(PAD, 1200, (W - PAD * 2) * (i + 1) / n, 3);
  g.fillStyle = c.heroMuted; g.font = `500 21px ${B.fonts.body}`; ls(`PHASE ${rom(i)} OF ${rom(n - 1)}`, PAD, 1270, 4);
  // builder mark
  let logo = null; if (useLogo && B.logo) logo = await loadImg(B.logo.onDark).catch(() => null);
  if (logo) { const h = 66, w = logo.width * h / logo.height; g.drawImage(logo, W - PAD - w, 1226, w, h); }
  else { g.fillStyle = c.heroInk; g.font = `500 34px ${B.fonts.display}`; g.textAlign = 'right'; g.fillText(B.fullName, W - PAD, 1272); g.textAlign = 'left'; }
  try { return await new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error('blank')), 'image/jpeg', .9)); }
  catch (e) { if (useLogo) return drawMoment(ph, photoPath, showName, false); if (photoPath) return drawMoment(ph, null, showName, false); throw e; }
}
function momentCaption(ph) {
  const l = momentLine(ph).replace(/[.!?]$/, '');
  return /welcome home/i.test(l) ? `Welcome home! Our new home by ${B.fullName} is complete.` : `${l}! Our home with ${B.fullName} is coming together.`;
}
async function openMoment(id) {
  const ph = S.d.phases.find(p => p.id === id), photos = momentPhotos(ph);
  S.moment = { id, photo: S.moment?.id === id ? S.moment.photo : (photos[0] || null), showName: S.moment?.id === id ? S.moment.showName : true, caption: S.moment?.id === id ? S.moment.caption : momentCaption(ph) };
  modal(`<div class="moment-sheet">
    <div class="moment-preview"><div class="moment-img" id="mo-img"><span class="small muted">Preparing…</span></div></div>
    <div class="moment-side">
      <span class="eyebrow">Share the moment</span><h2>${esc(momentLine(ph))}</h2>
      <p class="small muted">A card for family and friends, or for your own record. ${isStaff() ? `${esc(clientFirst())} sees the same card in their portal.` : ''}</p>
      ${photos.length > 1 ? `<div class="field"><span>Photo</span><div class="mo-photos">${photos.map(p => `<button class="mo-ph" data-act="moment-photo" data-v="${esc(p)}" aria-pressed="${p === S.moment.photo}"><img src="${esc(S.urls[p])}" alt=""></button>`).join('')}<button class="mo-ph mo-none" data-act="moment-photo" data-v="" aria-pressed="${!S.moment.photo}">No photo</button></div></div>` : ''}
      <label class="switch"><input type="checkbox" id="mo-name" ${S.moment.showName ? 'checked' : ''}> <span>Show “${esc(P().name)}”<br><span class="small muted">Turn off to keep the card anonymous.</span></span></label>
      <div class="field"><label for="mo-cap">Caption</label><textarea id="mo-cap" rows="3">${esc(S.moment.caption)}</textarea></div>
      <div class="row mo-actions"><button class="btn primary" data-act="moment-share" id="mo-share" disabled>${navigator.canShare ? 'Share' : 'Download'}</button><button class="btn" data-act="moment-copy">Copy caption</button><button class="btn ghost" data-act="modal-close">Close</button></div>
    </div></div>`, true);
  await paintMoment();
}
async function paintMoment() {
  const ph = S.d.phases.find(p => p.id === S.moment.id), mine = S.moment;
  const blob = await drawMoment(ph, mine.photo, mine.showName);
  if (S.moment !== mine || !$('#mo-img')) return;
  if (mine.url) URL.revokeObjectURL(mine.url);
  mine.url = URL.createObjectURL(blob);
  mine.file = new File([blob], `${(B.slug || 'home')}-${short(ph.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`, { type: 'image/jpeg' });
  $('#mo-img').innerHTML = `<img src="${mine.url}" alt="${esc(momentLine(ph))}">`;
  const b = $('#mo-share'); if (b) { b.disabled = false; b.textContent = navigator.canShare?.({ files: [mine.file] }) ? 'Share' : 'Download'; }
}
function momentBanner() {
  const ph = recentMoment(); if (!ph) return '';
  const thumb = momentPhotos(ph)[0];
  return `<section class="moment-banner">${thumb ? `<img src="${esc(S.urls[thumb])}" alt="">` : ''}<div class="mb-text"><span class="eyebrow">Milestone · ${fd(ph.completed_at)}</span><h3>${esc(momentLine(ph))}${/[.!?]$/.test(momentLine(ph)) ? '' : '.'}</h3>
    <p class="small">${isStaff() ? `${esc(clientFirst())} can share a card of this moment with family and friends.` : `${esc(short(ph.name))} is complete. Share the moment with family and friends.`}</p></div>
    <button class="btn" data-act="moment" data-id="${ph.id}">${isStaff() ? 'See their card' : 'Share the moment'}</button></section>`;
}
/* ================= warranty ================= */
const WST = { new: ['Received', 'solid'], scheduled: ['Visit scheduled', 'brass'], resolved: ['Resolved', 'good'], not_covered: ['Closed', ''] };
const wNo = r => `W-${String(r.number).padStart(2, '0')}`;
// The home is "closed" once the closing date has passed or the last phase is done
const isClosed = () => { const p = P(), last = S.d.phases[S.d.phases.length - 1]; return (p.closing_date && daysTo(p.closing_date) <= 0) || last?.status === 'done'; };
const closedOn = () => { const p = P(), last = S.d.phases[S.d.phases.length - 1]; return (p.closing_date && daysTo(p.closing_date) <= 0) ? p.closing_date : (last?.completed_at || '').slice(0, 10) || p.closing_date; };
const addMonths = (iso, m) => { const d = D(iso); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); };
const termMonths = t => { const m = String(t).match(/(\d+)\s*(year|month)/i); return m ? (+m[1]) * (/year/i.test(m[2]) ? 12 : 1) : null; };
const W = () => B.warrantyService || {};
const openReqs = () => (S.d.warranty_requests || []).filter(r => r.status === 'new');
const urgentPhone = () => W().phone || pm()?.phone || '';
function warrantyCard() {
  if (isStaff() || !isClosed()) return '';
  const first = B.warranty[0], end = first && termMonths(first[1]) ? addMonths(closedOn(), termMonths(first[1])) : null;
  const open = (S.d.warranty_requests || []).filter(r => ['new', 'scheduled'].includes(r.status));
  return `<section class="moment-banner warranty-banner"><div class="mb-text"><span class="eyebrow">Warranty</span><h3>We’re still here for you.</h3>
    <p class="small">${open.length ? `${open.length} request${open.length > 1 ? 's' : ''} open with your team.` : end ? `${esc(first[0])} covered through ${fdL(end)}.` : 'Your home is under warranty.'} Something not right? Tell us and we’ll take care of it.</p></div>
    <button class="btn" data-act="warr-new">Request service</button></section>`;
}
function reqCard(r) {
  const [label, cls] = WST[r.status] || [r.status, ''];
  const it = r.home_item_id && (S.d.home_items || []).find(i => i.id === r.home_item_id);
  const steps = [['Requested', r.created_at && fd(r.created_at)], ['Scheduled', r.scheduled_for && `${fd(r.scheduled_for)}${r.scheduled_window ? ', ' + r.scheduled_window.toLowerCase() : ''}`], [r.status === 'not_covered' ? 'Closed' : 'Resolved', r.resolved_at && fd(r.resolved_at)]];
  return `<article class="wreq${r.urgency === 'urgent' && r.status === 'new' ? ' urgent' : ''}">
    <div class="spread" style="gap:10px"><div class="row" style="gap:10px"><span class="eyebrow" style="color:var(--muted)">${wNo(r)}</span><span class="tag ${cls}">${label}</span>${r.urgency === 'urgent' ? '<span class="tag bad">Urgent</span>' : ''}</div>
      <span class="small muted">${esc(nameOf(r.created_by))} · ${ft(r.created_at)}</span></div>
    <h3>${esc(r.title)}</h3>
    <div class="small muted">${[r.room, it && `${it.name}${it.maker ? ' · ' + it.maker : ''}`].filter(Boolean).map(esc).join(' · ')}</div>
    ${r.details ? `<p class="wreq-details">${esc(r.details)}</p>` : ''}
    ${r.photos.length ? `<div class="wreq-photos">${r.photos.map((p, i) => S.urls[p] ? `<button class="ph" data-act="warr-photo" data-id="${r.id}" data-v="${i}" aria-label="Photo ${i + 1}"><img src="${esc(S.urls[p])}" alt="" loading="lazy"></button>` : '').join('')}</div>` : ''}
    <ol class="wsteps">${steps.map(([k, v]) => `<li class="${v ? 'on' : ''}"><span>${k}</span><b>${v || '—'}</b></li>`).join('')}</ol>
    ${r.response ? `<blockquote class="wreq-resp">${esc(r.response)}<span class="small muted">${esc(firstName(pm()?.id) || 'Your team')}</span></blockquote>` : ''}
    ${isStaff() && ['new', 'scheduled'].includes(r.status) ? `<div class="row" style="gap:8px;margin-top:12px"><button class="btn sm primary" data-act="warr-sched" data-id="${r.id}">${r.status === 'scheduled' ? 'Reschedule' : 'Schedule a visit'}</button><button class="btn sm" data-act="warr-resolve" data-id="${r.id}">Mark resolved</button><button class="btn sm ghost" data-act="warr-nc" data-id="${r.id}">Not covered</button></div>` : ''}
  </article>`;
}
function vWarranty() {
  const closed = isClosed(), on = closedOn(), reqs = S.d.warranty_requests || [];
  const open = reqs.filter(r => ['new', 'scheduled'].includes(r.status)).sort((a, b) => (a.status === 'new' ? 0 : 1) - (b.status === 'new' ? 0 : 1) || (b.urgency === 'urgent') - (a.urgency === 'urgent') || b.number - a.number);
  const done = reqs.filter(r => !['new', 'scheduled'].includes(r.status)).sort((a, b) => b.number - a.number);
  const visit = W().visit, vm = W().visitMonths || 11;
  const cover = `<div class="wcover">${B.warranty.map(([k, v]) => { const m = termMonths(v), end = closed && on && m ? addMonths(on, m) : null, live = end && daysTo(end) > 0;
      return `<div class="wcov${end && !live ? ' ended' : ''}"><span class="eyebrow">${esc(v)}</span><b>${esc(k)}</b><span class="small muted">${end ? (live ? `Through ${fdL(end)}` : `Ended ${fdL(end)}`) : `Begins at ${esc(L.closing.toLowerCase().startsWith('the') ? L.closing.replace(/^The/, 'the') : L.closing)}`}</span></div>`; }).join('')}
    ${visit ? `<div class="wcov visit"><span class="eyebrow">${esc(visit)}</span><b>${closed && on ? fd(addMonths(on, vm), { month: 'long', year: 'numeric' }) : `${vm} months after closing`}</b><span class="small muted">We walk the house with you and take care of anything that’s settled in. We’ll reach out to schedule.</span></div>` : ''}</div>`;
  const urgent = `<aside class="wurgent"><span class="eyebrow">Something urgent?</span><p>${esc(W().urgent || 'For an active water leak, no heat or cooling in extreme weather, or an electrical problem, call us right away.')}${urgentPhone() ? ` <a href="tel:${esc(urgentPhone().replace(/[^\d+]/g, ''))}">${esc(urgentPhone())}</a>` : ''}</p>${W().emergency ? `<p class="small muted">${esc(W().emergency)}</p>` : ''}</aside>`;
  const head = pageHead('Warranty', closed ? 'We’re still <span class="ital">here for you</span>' : 'Covered <span class="ital">from day one</span>',
    closed ? `Something not right? Tell us what you’re seeing, add a photo, and ${esc(firstName(pm()?.id) || 'your team')} will ${esc(W().response || 'reply within one business day')}.` : `Your warranty begins at ${esc(L.closing.toLowerCase().startsWith('the') ? L.closing.replace(/^The/, 'the') : L.closing)}${P().closing_date ? `, ${fdL(P().closing_date)}` : ''}. After you move in, this is where you’ll request service.`,
    isStaff() ? `<button class="btn primary" data-act="warr-new">Log a request</button>` : closed ? `<button class="btn primary" data-act="warr-new">Request service</button>` : '');
  return head + cover + (closed || isStaff() ? urgent : '') +
    `<section style="margin-top:48px"><div class="sec-h"><h2>${isStaff() ? 'Requests' : 'Your requests'}</h2><span class="aside">${open.length} open</span></div>
      ${open.length ? `<div class="wreqs">${open.map(reqCard).join('')}</div>` : `<div class="empty">${closed ? 'No open requests. If anything needs attention, we’re a tap away.' : 'Requests open after you move in.'}</div>`}</section>
    ${done.length ? `<section style="margin-top:40px"><div class="sec-h"><h2>Resolved</h2><span class="aside">${done.length}</span></div><div class="wreqs">${done.map(reqCard).join('')}</div></section>` : ''}`;
}
function warrForm() {
  const d = S.warrDraft, items = (S.d.home_items || []).filter(i => !d.room || i.room === d.room || i.room === WHOLE);
  const rooms = [...new Set([...(S.d.home_items || []).map(i => i.room).filter(r => r !== WHOLE), ...(B.wallRooms || []), 'Exterior', 'Whole home'])];
  return `<span class="eyebrow">${isStaff() ? 'Log a warranty request' : 'Request service'}</span><h2>What’s happening?</h2>
    <div class="field"><label for="wr-title">In a few words</label><input id="wr-title" value="${esc(d.title || '')}" placeholder="Pantry door sticks at the top" maxlength="120"></div>
    <div class="form-grid">
      <div class="field"><label for="wr-room">Where</label><input id="wr-room" list="wr-rooms" value="${esc(d.room || '')}" placeholder="Kitchen" autocomplete="off"><datalist id="wr-rooms">${rooms.map(r => `<option value="${esc(r)}">`).join('')}</datalist></div>
      <div class="field"><label for="wr-item">Related item (optional)</label><select id="wr-item"><option value="">Not sure / none</option>${items.map(i => `<option value="${i.id}"${i.id === d.home_item_id ? ' selected' : ''}>${esc(i.room === d.room ? i.name : `${i.room} · ${i.name}`)}${i.maker ? ' · ' + esc(i.maker) : ''}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label for="wr-details">Tell us more</label><textarea id="wr-details" rows="4" placeholder="When did you notice it? Does it happen all the time or only sometimes?">${esc(d.details || '')}</textarea></div>
    <div class="field"><span>How soon</span><div class="chips"><button type="button" class="chip" data-act="wr-urg" data-v="routine" aria-pressed="${d.urgency !== 'urgent'}">It can wait for a visit</button><button type="button" class="chip" data-act="wr-urg" data-v="urgent" aria-pressed="${d.urgency === 'urgent'}">It’s urgent</button></div></div>
    ${d.urgency === 'urgent' ? `<div class="wurgent compact"><p>${esc(W().urgent || 'For an active water leak, no heat or cooling in extreme weather, or an electrical problem, call us right away.')}${urgentPhone() ? ` <a href="tel:${esc(urgentPhone().replace(/[^\d+]/g, ''))}">${esc(urgentPhone())}</a>` : ''}</p></div>` : ''}
    <label class="drop" for="wr-files" style="position:relative">${S.draft.length ? `${S.draft.length} photo${S.draft.length > 1 ? 's' : ''} added · add more` : 'Add photos (they help us bring the right part)'}<input type="file" id="wr-files" accept="image/*" multiple></label>
    ${S.draft.length ? `<div class="thumbs">${S.draft.map(x => `<div class="ph" style="cursor:default"><img src="${x.preview}" alt=""></div>`).join('')}</div>` : ''}
    <p class="inline-err" id="wr-err" hidden></p>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="warr-send">${isStaff() ? 'Log request' : 'Send request'}</button></div>`;
}
const keepWarr = () => { if (!$('#wr-title')) return; Object.assign(S.warrDraft, { title: val('wr-title'), room: val('wr-room'), home_item_id: $('#wr-item').value || null, details: $('#wr-details').value.trim() }); };

/* ================= Today: everything that needs the team, across all homes ================= */
async function loadToday() {
  const ids = S.projects.map(p => p.id); S.today = null; if (!ids.length) return;
  const q = (t, cols, f = x => x) => f(sb.from(t).select(cols).in('project_id', ids));
  const [sels, opts, evs, notes, warr, msgs, threads, qs, cos, ph, ups] = await Promise.all([
    q('selections', 'id,project_id,category,status,due_date,chosen_option_id,submitted_by,submitted_at'),
    q('selection_options', 'id,name'),
    q('events', 'id,project_id,title,starts_on,time_label,status,requested_by,created_at', x => x.eq('status', 'requested')),
    q('notes', 'id,project_id,author_id,room,body,reviewed,created_at', x => x.eq('reviewed', false)),
    q('warranty_requests', 'id,project_id,number,title,room,urgency,status,created_by,created_at', x => x.eq('status', 'new')),
    q('messages', 'id,project_id,thread_id,author_id,body,created_at', x => x.order('created_at', { ascending: false }).limit(400)),
    q('threads', 'id,project_id,name'),
    q('questions', 'id,project_id,question,status,due_date,answer,answered_by,answered_at,asked_by,created_at'),
    q('change_orders', 'id,project_id,number,title,status,amount,signed_by,signed_at,created_at'),
    q('phases', 'id,project_id,name,status,end_date,position'),
    q('updates', 'id,project_id,created_at', x => x.order('created_at', { ascending: false }).limit(200)),
  ]);
  const d = r => r.data || [], now = Date.now(), ago = iso => (now - new Date(iso)) / 864e5, today = isoToday();
  const proj = id => S.projects.find(p => p.id === id), isClientId = uid => S.profiles[uid]?.role === 'client';
  const owner = (pid, area) => { const p = proj(pid); return (area && (p.duties || {})[area]) || p.pm_id; };
  const first = uid => (S.profiles[uid]?.full_name || 'Client').split(' ')[0];
  const items = [], waiting = [], fyi = [];
  d(warr).forEach(r => items.push({ id: 'w' + r.id, pid: r.project_id, area: 'warranty', pri: r.urgency === 'urgent' ? 0 : 1, at: r.created_at, k: r.urgency === 'urgent' ? 'Urgent' : 'Warranty',
    t: `W-${String(r.number).padStart(2, '0')} · ${r.title}`, d: `${r.room ? r.room + ' · ' : ''}from ${first(r.created_by)}`, acts: [['Open', 'td-open', r.project_id, 'warranty']] }));
  const lastByThread = {}; d(msgs).forEach(m => { if (!lastByThread[m.thread_id]) lastByThread[m.thread_id] = m; });
  Object.values(lastByThread).filter(m => isClientId(m.author_id)).forEach(m => { const th = d(threads).find(t => t.id === m.thread_id);
    items.push({ id: 'm' + m.thread_id, pid: m.project_id, area: /design/i.test(th?.name || '') ? 'selections' : null, pri: 1, at: m.created_at, k: 'Reply', t: m.body.length > 110 ? m.body.slice(0, 110) + '…' : m.body,
      d: `${first(m.author_id)}${th ? ' · ' + th.name : ''}`, thread: m.thread_id, acts: [['Reply', 'td-reply', m.thread_id]] }); });
  d(sels).filter(s => s.status === 'submitted').forEach(s => items.push({ id: 's' + s.id, pid: s.project_id, area: 'selections', pri: 1, at: s.submitted_at || s.due_date, k: 'Confirm',
    t: s.category, d: `${first(s.submitted_by)} chose ${d(opts).find(o => o.id === s.chosen_option_id)?.name || 'an option'}`, acts: [['Confirm', 'td-sel', s.id], ['Open', 'td-open', s.project_id, 'selections']] }));
  d(evs).forEach(e => items.push({ id: 'e' + e.id, pid: e.project_id, area: 'visits', pri: 1, at: e.created_at, k: 'Visit', t: e.title.replace(' (requested)', ''),
    d: `${fd(e.starts_on, { weekday: 'short', month: 'short', day: 'numeric' })}${e.time_label ? ' · ' + e.time_label : ''}`, acts: [['Confirm', 'td-ev', e.id], ['Open', 'td-open', e.project_id, 'calendar']] }));
  d(notes).filter(n => isClientId(n.author_id)).forEach(n => items.push({ id: 'n' + n.id, pid: n.project_id, area: 'notes', pri: 2, at: n.created_at, k: 'Note', t: n.body,
    d: `${n.room || 'General'} · ${first(n.author_id)}`, acts: [['Reviewed', 'td-note', n.id]] }));
  d(ph).filter(p => p.status === 'current' && p.end_date && p.end_date < today).forEach(p => items.push({ id: 'p' + p.id, pid: p.project_id, area: null, pri: 2, at: p.end_date, k: 'Schedule',
    t: `${short(p.name)} was due to finish ${fd(p.end_date)}`, d: 'Mark it complete or adjust the dates so the timeline stays accurate', acts: [['Open', 'td-open', p.project_id, 'timeline']] }));
  S.projects.forEach(p => { const last = d(ups).find(u => u.project_id === p.id), cur = d(ph).find(x => x.project_id === p.id && x.status === 'current');
    if (cur && (!last || ago(last.created_at) > 10)) items.push({ id: 'u' + p.id, pid: p.id, area: null, pri: 3, at: last?.created_at || p.created_at, k: 'Post',
      t: last ? `No site photos in ${Math.floor(ago(last.created_at))} days` : 'No site photos yet', d: 'A few photos and a sentence keeps the Friday email full', acts: [['Post', 'td-post', p.id]] }); });
  d(qs).filter(x => x.status === 'open' && x.due_date && x.due_date < today).forEach(x => waiting.push({ id: 'q' + x.id, pid: x.project_id, k: 'Question', t: x.question, d: `Was due ${fd(x.due_date)} · reminders sent automatically`, acts: [['Open', 'td-open', x.project_id, 'questions']] }));
  d(sels).filter(s => s.status === 'open' && s.due_date && s.due_date < today).forEach(s => waiting.push({ id: 'so' + s.id, pid: s.project_id, k: 'Selection', t: s.category, d: `Was due ${fd(s.due_date)}`, acts: [['Open', 'td-open', s.project_id, 'selections']] }));
  d(cos).filter(c => c.status === 'pending' && ago(c.created_at) > 4).forEach(c => waiting.push({ id: 'c' + c.id, pid: c.project_id, k: 'Signature', t: `CO-${String(c.number).padStart(2, '0')} · ${c.title}`, d: `Sent ${ft(c.created_at)}`, acts: [['Open', 'td-open', c.project_id, 'changes']] }));
  d(qs).filter(x => x.status === 'answered' && x.answered_at && ago(x.answered_at) < 3).forEach(x => fyi.push({ id: 'qa' + x.id, pid: x.project_id, owner: x.asked_by, at: x.answered_at, t: `${first(x.answered_by)} answered: ${x.answer}`, d: x.question }));
  d(cos).filter(c => ['approved', 'declined'].includes(c.status) && c.signed_at && ago(c.signed_at) < 3).forEach(c => fyi.push({ id: 'cs' + c.id, pid: c.project_id, at: c.signed_at, t: `${first(c.signed_by)} ${c.status === 'approved' ? 'signed' : 'declined'} CO-${String(c.number).padStart(2, '0')}`, d: c.title }));
  const VIEW_OF = { Urgent: 'warranty', Warranty: 'warranty', Reply: 'messages', Confirm: 'selections', Visit: 'calendar', Note: 'walkthrough', Question: 'questions', Selection: 'selections', Signature: 'changes' };
  const keep = i => on(VIEW_OF[i.k] || 'overview');
  [items, waiting].forEach(a => { const k = a.filter(keep); a.length = 0; a.push(...k); });
  items.forEach(i => { i.owner = owner(i.pid, i.area); }); fyi.forEach(i => { i.owner = i.owner || owner(i.pid, null); }); waiting.forEach(i => { i.owner = owner(i.pid, null); });
  S.today = { items: items.sort((a, b) => a.pri - b.pri || new Date(b.at) - new Date(a.at)), waiting, fyi: fyi.sort((a, b) => new Date(b.at) - new Date(a.at)) };
}
function tdRow(i) {
  const p = S.projects.find(x => x.id === i.pid), mine = i.owner === S.me.id;
  const who = !mine && i.owner ? `<span class="td-who">${esc((S.profiles[i.owner]?.full_name || '').split(' ')[0])}</span>` : '';
  return `<article class="td-item${i.pri === 0 ? ' urgent' : ''}"><span class="td-k">${esc(i.k)}</span>
    <div class="td-main"><b>${esc(i.t)}</b><span class="small muted">${esc(p?.name || '')}${i.d ? ' · ' + esc(i.d) : ''}${i.at ? ' · ' + ft(i.at) : ''}</span>${who}
      ${i.thread && S.ui.tdReply === i.thread ? `<div class="td-reply"><textarea id="td-r" rows="2" placeholder="Reply to ${esc(p?.client_names || 'the client')}"></textarea><div class="row" style="gap:8px;justify-content:flex-end"><button class="btn sm ghost" data-act="td-reply" data-id="">Cancel</button><button class="btn sm primary" data-act="td-send" data-id="${i.thread}" data-v="${i.pid}">Send</button></div></div>` : ''}</div>
    <div class="td-acts">${i.thread && S.ui.tdReply === i.thread ? '' : (i.acts || []).map(([l, a, id, v], n) => `<button class="btn sm ${n ? 'ghost' : ''}" data-act="${a}" data-id="${id}"${v ? ` data-v="${v}"` : ''}>${l}</button>`).join('')}</div></article>`;
}
function vToday() {
  const T = S.today || { items: [], waiting: [], fyi: [] }, all = S.ui.tdAll, me = S.me.id;
  const pick = xs => all ? xs : xs.filter(i => i.owner === me);
  const items = pick(T.items), waiting = pick(T.waiting), fyi = pick(T.fyi), others = T.items.length - pick(T.items).length;
  const h = new Date().getHours(), firstN = (S.me.full_name || '').split(' ')[0];
  const homes = new Set(items.map(i => i.pid)).size;
  const sum = items.length ? `${items.length} thing${items.length > 1 ? 's' : ''} need${items.length > 1 ? '' : 's'} ${all ? 'the team' : 'you'}${homes > 1 ? ` across ${homes} homes` : ''}.` : `Nothing needs ${all ? 'the team' : 'you'} right now.`;
  return pageHead(esc(B.fullName), `Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}${firstN ? `, <span class="ital">${esc(firstN)}</span>` : ''}`,
    `${sum}${waiting.length ? ` ${waiting.length} waiting on clients, with reminders going out automatically.` : ''}`,
    `<div class="seg" role="group" aria-label="Show"><button data-act="td-scope" data-v="me" aria-pressed="${!all}">Mine</button><button data-act="td-scope" data-v="all" aria-pressed="${!!all}">Everyone</button></div>`) +
  `<section class="today">
    ${items.length ? `<div class="td-list">${items.map(tdRow).join('')}</div>` : `<div class="empty td-empty">${all ? 'The whole team is caught up.' : 'You’re caught up.'}${!all && others ? ` <button class="linkbtn" data-act="td-scope" data-v="all">${others} with teammates</button>` : ''}</div>`}
    ${fyi.length ? `<details class="td-more" open><summary>Since yesterday <span class="aside">${fyi.length}</span></summary><div class="td-fyi">${fyi.map(i => `<div><b>${esc(i.t)}</b><span class="small muted">${esc(S.projects.find(p => p.id === i.pid)?.name || '')} · ${esc(i.d || '')} · ${ft(i.at)}</span></div>`).join('')}</div></details>` : ''}
    ${waiting.length ? `<details class="td-more"><summary>Waiting on clients <span class="aside">${waiting.length}</span></summary><div class="td-list quiet">${waiting.map(tdRow).join('')}</div></details>` : ''}
  </section>
  <div class="sec-h" style="margin-top:56px"><h2>Homes</h2><button class="btn sm" data-act="home-new">New home</button></div>` + homesGrid();
}

/* ================= home manual: import from a spreadsheet ================= */
const IMP_FIELDS = [
  ['room', 'Room', /^(room|area|location|space)$/i, true], ['name', 'Item', /^(item|name|what|description|fixture|product type|element)$/i, true],
  ['category', 'Category', /^(category|type|trade|division)$/i], ['maker', 'Brand', /^(brand|maker|manufacturer|mfr|vendor|supplier)$/i],
  ['product', 'Color, model, or style', /^(color|colour|model|style|product|sku|selection|model ?#|model number)$/i],
  ['detail', 'Finish, size, serial, or location', /^(finish|size|detail|details|notes?|serial|sheen|spec)$/i],
  ['care', 'Care', /^(care|maintenance|care instructions)$/i], ['warranty_until', 'Warranty until', /^(warranty|warranty (until|end|expires?)|expires?)$/i]];
function parseCSV(t) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}
async function readSheet(file) {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return parseCSV(await file.text());
  if (!window.XLSX) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('Could not open Excel files right now. Save it as CSV and try again.')); document.head.appendChild(s); });
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' }).filter(r => r.some(c => String(c).trim()));
}
function toISODate(v) {
  if (!v) return null; v = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (/^\d{5}$/.test(v)) { const d = new Date(Date.UTC(1899, 11, 30) + (+v) * 864e5); return d.toISOString().slice(0, 10); }
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
function importRows() {
  const I = S.imp, head = I.rows[0], body = I.rows.slice(1);
  return body.map(r => { const get = k => I.map[k] === '' || I.map[k] == null ? '' : String(r[+I.map[k]] ?? '').trim();
    const name = get('name'), room = get('room') || I.room || '';
    if (!name) return null;
    const raw = get('category'), named = manCats().find(c => c.toLowerCase() === raw.toLowerCase()), byName = guessCat(`${raw} ${name}`),
      cat = named || (byName !== 'Other' ? byName : guessCat(`${raw} ${name} ${get('maker')} ${get('product')} ${get('detail')}`));
    return { room, category: cat, name, maker: get('maker') || null, product: get('product') || null, detail: get('detail') || null, care: get('care') || manCare(cat) || null, warranty_until: toISODate(get('warranty_until')) };
  }).filter(Boolean);
}
function importSheetForm() {
  const I = S.imp;
  if (!I) return `<span class="eyebrow">Home manual</span><h2>Import from a spreadsheet</h2>
    <p class="small muted">Already keep a finish schedule or appliance list? Upload it as Excel or CSV and we’ll match the columns. One row per item: room, item, brand, color or model, and so on.</p>
    <label class="drop" for="imp-file" style="position:relative">Choose an Excel or CSV file<input type="file" id="imp-file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"></label>
    <p class="small" style="margin-top:12px"><button class="linkbtn" data-act="imp-template">Download a template</button></p>
    <p class="inline-err" id="imp-err" hidden></p>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="modal-close">Cancel</button></div>`;
  const head = I.rows[0], rows = importRows(), missingRoom = rows.filter(r => !r.room).length;
  return `<span class="eyebrow">Home manual · ${esc(I.file)}</span><h2>Match the columns</h2>
    <p class="small muted">We matched what we could. Check each field, then import.</p>
    <div class="imp-map">${IMP_FIELDS.map(([k, l, , req]) => `<label class="duty"><span>${l}${req ? '' : ' (optional)'}</span><select class="input" data-change="imp-map" data-v="${k}"><option value="">${k === 'room' ? 'Same room for every row' : 'Not in this file'}</option>${head.map((h, i) => `<option value="${i}"${String(I.map[k]) === String(i) ? ' selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('')}</select></label>`).join('')}</div>
    ${I.map.room === '' || I.map.room == null || missingRoom ? `<div class="field" style="max-width:320px"><label for="imp-room">${I.map.room === '' || I.map.room == null ? 'Room for every row' : 'Room for rows that don’t list one'}</label><input id="imp-room" list="mf-rooms" value="${esc(I.room || '')}" placeholder="Choose or type a room"><datalist id="mf-rooms">${[WHOLE, ...(B.wallRooms || [])].map(r => `<option value="${esc(r)}">`).join('')}</datalist></div>` : ''}
    <div class="imp-preview"><table class="man-table"><thead><tr><th>Room</th><th>Item</th><th>Maker & product</th><th>Category</th></tr></thead><tbody>${rows.slice(0, 6).map(r => `<tr><td>${esc(r.room || '—')}</td><td><b>${esc(r.name)}</b>${r.detail ? `<div>${esc(r.detail)}</div>` : ''}</td><td>${esc([r.maker, r.product].filter(Boolean).join(' · '))}</td><td>${esc(r.category)}</td></tr>`).join('')}</tbody></table>
      ${rows.length > 6 ? `<p class="small muted">and ${rows.length - 6} more</p>` : ''}</div>
    <p class="inline-err" id="imp-err" hidden></p>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="imp-reset">Choose another file</button><button class="btn primary" data-act="imp-save">Import ${rows.length} item${rows.length === 1 ? '' : 's'}</button></div>`;
}

const VIEWS = { warranty: vWarranty, manual: vManual, glossary: vGlossary, walls: vWalls, diary: vDiary, overview: vOverview, timeline: vTimeline, updates: vUpdates, questions: vQuestions, messages: vMessages, selections: vSelections, changes: vChanges, budget: vBudget, calendar: vCalendar, documents: vDocuments, walkthrough: vWalkthrough, team: vTeam };

/* ================= note from the project manager ================= */
function pmNote() {
  // Settings: nudgeDays (0 = never remind the PM), hideAfterDays (clients stop seeing a stale note; 0 = never hide)
  const cfg = { nudgeDays: 0, hideAfterDays: 45, ...(B.pmNote || {}) };
  const p = P(), by = S.profiles[p.pm_note_by] || pm(), age = p.pm_note_at ? Math.floor((Date.now() - new Date(p.pm_note_at)) / 864e5) : null;
  const who = by ? (by.full_name || by.email) : L.projectLead, stale = cfg.hideAfterDays && age >= cfg.hideAfterDays;
  if (!p.pm_note || (stale && !isStaff())) return isStaff() && !p.pm_note
    ? (cfg.nudgeDays ? `<section class="pm-note empty-note"><div><span class="eyebrow">A note from you</span><p class="muted">A sentence or two at the top of ${esc(clientFirst())}’s home: what’s happening this week, and anything they should know.</p></div><button class="btn" data-act="note-pm">Write a note</button></section>`
      : `<div class="pm-note-add"><button class="edit-link" data-act="note-pm">Add a personal note for ${esc(clientFirst())} (optional)</button></div>`) : '';
  return `<section class="pm-note">
    <div class="pm-note-head"><span class="av">${ini(who)}</span><div><span class="eyebrow">A note from ${esc(who.split(' ')[0])}</span><div class="small muted">${esc(by?.title || L.projectLead)} · ${ft(p.pm_note_at)}</div></div>
      ${isStaff() ? `<button class="edit-link" data-act="note-pm">Update note</button>` : ''}</div>
    <p class="pm-note-text">${gloss(p.pm_note)}</p>
    ${isStaff() && stale ? `<p class="small" style="color:var(--brass)">Hidden from ${esc(clientFirst())} because it’s ${age} days old. Update it or remove it.</p>`
      : isStaff() && cfg.nudgeDays && age >= cfg.nudgeDays ? `<p class="small" style="color:var(--brass)">This note is ${age} days old. A quick update keeps ${esc(clientFirst())} in the loop.</p>` : ''}
  </section>`;
}

/* ================= welcome tour ================= */
const ART = {
  home: '<polyline points="14,40 60,10 106,40"/><rect x="22" y="38" width="76" height="36"/><path d="M52 74V58a8 8 0 0 1 16 0v16"/><rect x="30" y="46" width="12" height="12"/><rect x="78" y="46" width="12" height="12"/><line x1="4" y1="74" x2="116" y2="74" class="t"/>',
  photos: '<rect x="30" y="14" width="64" height="46" class="t"/><rect x="22" y="22" width="64" height="46"/><polyline points="26,62 44,44 56,54 66,46 82,62"/><circle cx="72" cy="34" r="5"/>',
  decide: '<rect x="34" y="8" width="52" height="66"/><line x1="44" y1="22" x2="76" y2="22" class="t"/><line x1="44" y1="30" x2="76" y2="30" class="t"/><line x1="44" y1="38" x2="66" y2="38" class="t"/><polyline points="46,52 54,60 72,44"/><path d="M42 68c6-6 10 2 16-3s8 3 14-1" class="t"/>',
  team: '<path d="M14 16h56v32H36l-12 10V48H14z"/><path d="M50 34h56v32H96v10L84 66H50z" class="t"/><line x1="24" y1="28" x2="58" y2="28" class="t"/><line x1="24" y1="36" x2="48" y2="36" class="t"/>',
  homes: '<polyline points="8,40 24,28 40,40"/><rect x="12" y="38" width="24" height="22"/><polyline points="44,34 60,20 76,34"/><rect x="48" y="32" width="24" height="28"/><polyline points="80,40 96,28 112,40"/><rect x="84" y="38" width="24" height="22"/><line x1="4" y1="60" x2="116" y2="60" class="t"/>',
};
function tourSteps(role) {
  const custom = (B.tour || {})[role === 'staff' ? 'staff' : 'client'];
  const steps = tourDefault(role).filter(x => !x.need || x.need());
  // A builder's own tour wording replaces the default text step by step (art and buttons stay)
  if (Array.isArray(custom)) custom.forEach((c, i) => { if (steps[i] && c) Object.assign(steps[i], c); });
  return steps;
}
function tourDefault(role) {
  const me = (S.me.full_name || '').split(' ')[0];
  if (role === 'staff') return [
    { art: 'home', eyebrow: B.fullName, title: `Welcome${me ? ', ' + esc(me) : ''}`, text: `This is your client portal. Clients see a calm, branded view of their home; you see the tools that keep it current.` },
    { art: 'photos', eyebrow: 'From the site', title: 'Post in a few <span class="ital">taps</span>', text: `Tap <b>Post update</b> on any screen, take a few photos, and add a sentence. It goes into Friday’s email automatically, or you can email clients right away.` },
    { need: () => DEC.length, art: 'decide', eyebrow: 'Decisions', title: 'Ask, and they <span class="ital">answer</span>', text: `Questions, selections, and change orders live under Decisions. Clients are emailed when you send one and reminded before it’s due. You’re emailed when they respond.` },
    { art: 'homes', eyebrow: 'Today', title: 'Every build in <span class="ital">one place</span>', text: `Today lists only what needs you across every home, urgent first, and lets you reply, confirm, or mark things reviewed right there. Decide who handles what on each home from Your team.`, done: 'Get started' },
  ];
  const home = S.d ? esc(P().name) : 'your home', lead = S.d ? pm() : null;
  return [
    { art: 'home', eyebrow: 'Welcome', title: `Welcome home${me ? ', ' + esc(me) : ''}`, text: `This is your private window into <b>${home}</b>. Everything about your build lives here, from first drawings to the day you receive your keys.`,
      extra: lead ? `<div class="tour-lead"><span class="av">${ini(lead.full_name || lead.email)}</span><div><b>${esc(lead.full_name || lead.email)}</b><div class="small muted">${esc(lead.title || L.projectLead)}, your point of contact</div></div></div>` : '' },
    { art: 'photos', eyebrow: 'From the site', title: 'Watch it come <span class="ital">together</span>', text: `Your team shares photographs and notes from the site as work happens. Each Friday we’ll email you a short summary of the week, and every photo is gathered into your photo diary, a keepsake for ${esc(L.closing.toLowerCase())}.` },
    { need: () => DEC.length, art: 'decide', eyebrow: 'Decisions', title: 'When we need you, <span class="ital">it’s here</span>', text: `${DEC.map(d => d[1].toLowerCase()).join(', ').replace(/, ([^,]*)$/, ', and $1').replace(/^./, c => c.toUpperCase())} live under <b>Decisions</b>, each with the date it’s needed and why. We’ll remind you before anything is due${on('changes') ? ', and nothing in your agreement changes until you sign' : ''}.${on('glossary') ? ' New to a building term? Tap any word with a dotted underline.' : ''}` },
    { art: 'team', eyebrow: 'Your team', title: 'We’re a tap <span class="ital">away</span>', text: [on('messages') && 'Message your team anytime', on('calendar') && (B.requestKinds || []).length && `request a ${esc((B.requestKinds || []).map(k => k.toLowerCase()).join(' or '))}`, on('walkthrough') && `note anything you notice for your ${esc(L.finalTour.toLowerCase())}`].filter(Boolean).join(', ').replace(/^./, c => c.toUpperCase()) + '.',
      extra: `<p class="tour-tip"><b>Keep it handy:</b> on iPhone, tap Share, then Add to Home Screen. It opens like an app.</p>`, done: 'Enter your home' },
  ];
}
function showTour(role, firstTime) {
  S.tour = { role, i: 0 };
  drawTour();
  if (firstTime) { S.me.welcomed_at = new Date().toISOString(); sb.from('profiles').update({ welcomed_at: S.me.welcomed_at }).eq('id', S.me.id).then(() => {}); }
}
function drawTour() {
  const st = tourSteps(S.tour.role), i = S.tour.i, s = st[i], last = i === st.length - 1;
  modal(`<div class="tour-art"><svg viewBox="0 0 120 80" aria-hidden="true">${ART[s.art]}</svg></div>
    <div class="tour-body"><span class="eyebrow">${s.eyebrow}</span><h2>${s.title}</h2><p>${s.text}</p>${s.extra || ''}</div>
    <div class="tour-foot"><div class="tour-dots" aria-label="Step ${i + 1} of ${st.length}">${st.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="row">${i ? `<button class="btn ghost sm" data-act="tour-back">Back</button>` : `<button class="linkbtn" data-act="modal-close">Skip</button>`}
      <button class="btn primary" data-act="${last ? 'modal-close' : 'tour-next'}" id="tour-go">${last ? s.done : 'Next'}</button></div></div>`);
  $('#modal .dialog').classList.add('tour');
}

/* ================= forms in modals ================= */
function homeForm(p = {}) {
  const f = (id, label, v, type = 'text', cls = '') => `<div class="field ${cls}"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(v ?? '')}"></div>`;
  return `<span class="eyebrow">${p.id ? 'Home details' : 'New home'}</span><h2>${p.id ? esc(p.name) : 'Add a home'}</h2>
    <div class="form-grid">
      ${f('h-name', 'Name', p.name || '', 'text', 'full')}
      ${f('h-clients', `${L.client} names`, p.client_names)}${f('h-lot', 'Lot or community', p.lot)}
      ${f('h-address', 'Address', p.address, 'text', 'full')}
      ${f('h-summary', 'Summary (size, bedrooms, features)', p.summary, 'text', 'full')}
      ${f('h-start', 'Start date', p.start_date, 'date')}${f('h-closing', `${L.closing} date`, p.closing_date, 'date')}
      ${f('h-contract', 'Contract amount ($)', p.contract_amount ? +p.contract_amount : '', 'number')}${f('h-permit', 'Permit number', p.permit)}
      ${f('h-access', 'Site access instructions', p.site_access, 'text', 'full')}
    </div>
    ${p.id ? '' : `<p class="small muted">The ${B.phases.length} ${esc(B.name)} build phases, the draw schedule, and message threads are set up automatically.</p>`}
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="${p.id ? 'home-save' : 'home-create'}">${p.id ? 'Save' : 'Create home'}</button></div>`;
}
const homeVals = () => ({ name: val('h-name'), client_names: val('h-clients') || null, lot: val('h-lot') || null, address: val('h-address') || null, summary: val('h-summary') || null,
  start_date: val('h-start') || null, closing_date: val('h-closing') || null, contract_amount: +val('h-contract') || 0, permit: val('h-permit') || null, site_access: val('h-access') || null });

function postSheet() {
  const cp = curPhase();
  return `<span class="eyebrow">Post an update</span><h2>From the site</h2>
    <label class="drop" for="post-files" style="position:relative">${S.draft.length ? `${S.draft.length} photo${S.draft.length > 1 ? 's' : ''} ready · add more` : 'Take or choose photos'}<input type="file" id="post-files" accept="image/*" multiple></label>
    ${S.draft.length ? `<div class="thumbs">${S.draft.map((d, i) => `<div class="ph" style="cursor:default"><img src="${d.preview}" alt=""><button class="edit-link" data-act="draft-del" data-i="${i}" style="position:absolute;top:4px;right:6px;color:#fff;z-index:2">✕</button></div>`).join('')}</div>` : ''}
    <div class="field"><label for="post-text">What happened</label><textarea id="post-text" placeholder="Short and specific. What got done, what's next.">${esc(S.postText || '')}</textarea></div>
    <div class="field"><label for="post-phase">Phase</label><select id="post-phase">${S.d.phases.map((p, i) => `<option value="${p.id}" ${cp && p.id === cp.id ? 'selected' : ''}>${rom(i)}. ${esc(short(p.name))}</option>`).join('')}</select></div>
    <label class="switch"><input type="checkbox" id="post-now"><span>Also email ${esc(clientFirst())} now <span class="muted">(otherwise it’s in Friday’s email)</span></span></label>
    <p class="inline-err" id="post-err" hidden></p>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="post-send">Post</button></div>`;
}

/* ================= actions ================= */
async function act(a, el) {
  const id = el.dataset.id;
  switch (a) {
    case 'modal-close': closeModal(); break;
    case 'print': window.print(); break;
    case 'wall-room': S.ui.wallRoom = el.dataset.v || null; render(); window.scrollTo(0, 0); break;
    case 'wall-sys': S.ui.wallSys = el.dataset.v === 'All' ? null : el.dataset.v; render(true); break;
    case 'wall-new': S.draft = []; S.wallDraftSys = []; S.wallDraftSurface = ''; S.wallDraftCap = ''; S.wallDraftRoom = el.dataset.room || S.ui.wallRoom || ''; modal(wallForm(S.wallDraftRoom)); break;
    case 'wf-surf': keepWallDraft(); S.wallDraftSurface = S.wallDraftSurface === el.dataset.v ? '' : el.dataset.v; modal(wallForm(S.wallDraftRoom)); break;
    case 'wf-sys': { keepWallDraft(); const v = el.dataset.v, a = S.wallDraftSys; S.wallDraftSys = a.includes(v) ? a.filter(x => x !== v) : [...a, v]; modal(wallForm(S.wallDraftRoom)); break; }
    case 'wf-save': {
      keepWallDraft(); const err = $('#wf-err');
      if (!S.wallDraftRoom) { err.textContent = 'Choose the room first.'; err.hidden = false; break; }
      if (!S.draft.length) { err.textContent = 'Add at least one photo.'; err.hidden = false; break; }
      el.textContent = 'Uploading';
      const rows = [];
      for (const d of S.draft) { const path = `${S.pid}/walls/${crypto.randomUUID()}.jpg`; await upload(path, d.blob, 'image/jpeg');
        rows.push({ project_id: S.pid, room: S.wallDraftRoom, surface: S.wallDraftSurface || null, systems: S.wallDraftSys, path, caption: S.wallDraftCap || null, uploaded_by: S.me.id }); }
      must(await sb.from('wall_photos').insert(rows));
      const n = rows.length, room = S.wallDraftRoom;
      await refresh(['wall_photos']);
      if (el.dataset.next) { S.draft = []; S.wallDraftSurface = ''; S.wallDraftCap = ''; modal(wallForm(room)); toast(`Saved ${n} photo${n > 1 ? 's' : ''}. Next wall in ${room}.`); }
      else { closeModal(); await log(`photographed the walls in the ${room.toLowerCase()}`, 'walls'); await refresh(['activity']); S.ui.wallRoom = room; render(); toast(`Saved to ${room}`); }
      break; }
    case 'wall-open': {
      const w = S.d.wall_photos.find(x => x.id === id), list = roomPhotos(w.room), i = list.findIndex(x => x.id === w.id);
      modal(`<div class="spread"><div><span class="eyebrow">${esc(w.room)}${w.surface ? ' · ' + esc(w.surface) : ''}</span><h3 style="margin-top:6px">${w.caption ? esc(w.caption) : fd(w.taken_on, { month: 'long', day: 'numeric', year: 'numeric' })}</h3></div>
          <div class="row">${i > 0 ? `<button class="btn sm ghost" data-act="wall-open" data-id="${list[i - 1].id}" aria-label="Previous photo">←</button>` : ''}${i < list.length - 1 ? `<button class="btn sm ghost" data-act="wall-open" data-id="${list[i + 1].id}" aria-label="Next photo">→</button>` : ''}<a class="btn sm ghost" href="${esc(S.urls[w.path])}" target="_blank" rel="noopener">Full size</a><button class="btn sm ghost" data-act="modal-close">Close</button></div></div>
        <img src="${esc(S.urls[w.path])}" alt="${esc(w.room)}" style="width:100%;max-height:70vh;object-fit:contain;background:var(--surface-2)">
        <div class="row" style="justify-content:space-between"><div class="row" style="gap:6px">${w.systems.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div><span class="small muted">${list.length > 1 ? `${i + 1} of ${list.length} · ` : ''}Photographed ${fd(w.taken_on, { month: 'long', day: 'numeric', year: 'numeric' })}${isStaff() ? ` · <button class="edit-link" data-act="wall-del" data-id="${w.id}">Delete</button>` : ''}</span></div>`, true); break; }
    case 'term': showTerm(el); break;
    case 'man-sheet': S.imp = null; modal(importSheetForm(), true); break;
    case 'imp-reset': S.imp = null; modal(importSheetForm(), true); break;
    case 'imp-template': {
      const csv = 'Room,Category,Item,Brand,Color or model,Finish / size / location,Warranty until\nKitchen,Paint,Walls,Benjamin Moore,Chantilly Lace OC-65,Eggshell,\nKitchen,Appliances,Range,Wolf,DF48650G/S/P,Serial 18823344,2028-12-01\nWhole home,Systems,Main water shut-off,,,"Mechanical room, left of the water heater",\n';
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'home-manual-template.csv'; document.body.appendChild(a); a.click(); a.remove(); break; }
    case 'imp-save': {
      if ($('#imp-room')) S.imp.room = val('imp-room');
      const rows = importRows(), err = $('#imp-err');
      if (!rows.length) { err.textContent = 'No rows with an item name were found. Check the Item column.'; err.hidden = false; break; }
      if (rows.some(r => !r.room)) { err.textContent = 'Some rows have no room. Choose a room for them above.'; err.hidden = false; $('#imp-room')?.focus(); break; }
      el.textContent = 'Importing';
      const base = (S.d.home_items || []).length;
      for (let i = 0; i < rows.length; i += 200) must(await sb.from('home_items').insert(rows.slice(i, i + 200).map((r, j) => ({ ...r, project_id: S.pid, position: base + i + j }))));
      await log(`imported ${rows.length} items into the home manual`, 'manual'); S.imp = null; closeModal(); await refresh(['home_items', 'activity']); toast(`Imported ${rows.length} item${rows.length === 1 ? '' : 's'}`); break; }
    case 'td-scope': S.ui.tdAll = el.dataset.v === 'all'; store.set('portal.td.all', S.ui.tdAll ? '1' : '0'); render(true); break;
    case 'td-open': S.pid = id; store.set('portal.pid', id); S.ui.thread = null; await loadProject(id); location.hash = '#' + (el.dataset.v || 'overview'); S.view = resolveView(el.dataset.v || 'overview'); render(); window.scrollTo(0, 0); break;
    case 'td-post': S.pid = id; store.set('portal.pid', id); await loadProject(id); location.hash = '#overview'; S.view = 'overview'; render(); S.draft = []; S.postText = ''; modal(postSheet()); break;
    case 'td-reply': S.ui.tdReply = id || null; render(true); $('#td-r')?.focus(); break;
    case 'td-send': {
      const body = $('#td-r').value.trim(); if (!body) { $('#td-r').focus(); break; }
      must(await sb.from('messages').insert({ thread_id: id, project_id: el.dataset.v, body }));
      S.ui.tdReply = null; await loadToday(); render(true); toast('Sent'); break; }
    case 'td-sel': {
      const sel = must(await sb.from('selections').select('project_id').eq('id', id).single());
      must(await sb.from('selections').update({ status: 'approved' }).eq('id', id));
      await sb.from('activity').insert({ project_id: sel.project_id, body: 'confirmed and ordered a selection', view: 'selections' });
      await loadToday(); render(true); toast('Confirmed'); break; }
    case 'td-ev': {
      const e = must(await sb.from('events').select('project_id,title,starts_on').eq('id', id).single()), t = e.title.replace(' (requested)', '');
      must(await sb.from('events').update({ status: 'scheduled', title: t }).eq('id', id));
      await sb.from('activity').insert({ project_id: e.project_id, body: `confirmed: ${t} on ${fd(e.starts_on)}`, view: 'calendar' });
      await loadToday(); render(true); toast('Confirmed'); break; }
    case 'td-note': must(await sb.from('notes').update({ reviewed: true, reviewed_by: S.me.id }).eq('id', id)); await loadToday(); render(true); toast('Marked reviewed'); break;
    case 'warr-new': { const it = el.dataset.item && S.d.home_items.find(x => x.id === el.dataset.item); S.draft = []; S.warrDraft = { urgency: 'routine', home_item_id: it?.id || null, room: it && it.room !== WHOLE ? it.room : '' }; modal(warrForm(), true); break; }
    case 'wr-urg': keepWarr(); S.warrDraft.urgency = el.dataset.v; modal(warrForm(), true); break;
    case 'warr-send': {
      keepWarr(); const d = S.warrDraft, err = $('#wr-err');
      if (!d.title) { err.textContent = 'Tell us in a few words what’s happening.'; err.hidden = false; $('#wr-title').focus(); break; }
      el.textContent = 'Sending';
      const photos = [];
      for (const x of S.draft) { const path = `${S.pid}/warranty/${crypto.randomUUID()}.jpg`; await upload(path, x.blob, 'image/jpeg'); photos.push(path); }
      must(await sb.from('warranty_requests').insert({ project_id: S.pid, title: d.title, room: d.room || null, home_item_id: d.home_item_id, details: d.details || null, urgency: d.urgency || 'routine', photos, created_by: S.me.id }));
      await log(`requested warranty service: ${d.title}`, 'warranty');
      S.draft = []; closeModal(); await refresh(['warranty_requests', 'activity']);
      if (location.hash !== '#warranty') location.hash = 'warranty';
      toast(isStaff() ? 'Request logged' : `Sent. ${firstName(pm()?.id) || 'Your team'} will ${W().response || 'reply within one business day'}.`); break; }
    case 'warr-photo': { const r = S.d.warranty_requests.find(x => x.id === id), u = S.urls[r.photos[+el.dataset.v]];
      modal(`<div class="spread"><div><span class="eyebrow">${wNo(r)}</span><h3 style="margin-top:6px">${esc(r.title)}</h3></div><button class="btn sm ghost" data-act="modal-close">Close</button></div><img src="${esc(u)}" alt="" style="width:100%;max-height:70vh;object-fit:contain;background:var(--surface-2)">`, true); break; }
    case 'warr-sched': { const r = S.d.warranty_requests.find(x => x.id === id), wins = W().windows || ['Morning, 8 to 12', 'Afternoon, 12 to 4', 'All day'];
      modal(`<span class="eyebrow">${wNo(r)} · ${esc(r.title)}</span><h2>Schedule a visit</h2>
        <div class="form-grid"><div class="field"><label for="ws-date">Date</label><input id="ws-date" type="date" value="${esc(r.scheduled_for || '')}"></div>
        <div class="field"><label for="ws-win">Time</label><select id="ws-win">${wins.map(w => `<option${w === r.scheduled_window ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select></div></div>
        <div class="field"><label for="ws-note">Note to ${esc(clientFirst())}</label><textarea id="ws-note" rows="3" placeholder="Our trim carpenter will plane the door and touch up the paint. About an hour.">${esc(r.response || '')}</textarea></div>
        <p class="small muted">${esc(clientFirst())} is emailed the date, and it’s added to the calendar.</p>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="warr-sched-save" data-id="${r.id}">Schedule</button></div>`); break; }
    case 'warr-sched-save': {
      const r = S.d.warranty_requests.find(x => x.id === id), date = $('#ws-date').value, win = $('#ws-win').value;
      if (!date) { toast('Choose a date'); $('#ws-date').focus(); break; }
      must(await sb.from('warranty_requests').update({ status: 'scheduled', scheduled_for: date, scheduled_window: win, response: val('ws-note') || null }).eq('id', id));
      const title = `Warranty visit · ${wNo(r)}`, ev = S.d.events.find(e => e.title === title);
      if (ev) must(await sb.from('events').update({ starts_on: date, time_label: win, note: r.title }).eq('id', ev.id));
      else must(await sb.from('events').insert({ project_id: S.pid, starts_on: date, time_label: win, title, kind: 'Warranty visit', note: r.title, status: 'scheduled' }));
      await log(`scheduled a warranty visit for ${fd(date)}`, 'warranty'); closeModal(); await refresh(['warranty_requests', 'events', 'activity']); toast(`Scheduled. ${clientFirst()} will be emailed.`); break; }
    case 'warr-resolve': case 'warr-nc': { const r = S.d.warranty_requests.find(x => x.id === id), nc = a === 'warr-nc';
      modal(`<span class="eyebrow">${wNo(r)} · ${esc(r.title)}</span><h2>${nc ? 'Not covered' : 'Mark resolved'}</h2>
        <div class="field"><label for="wn-note">${nc ? `Explain to ${esc(clientFirst())} why, and what we suggest` : 'What we did'}</label><textarea id="wn-note" rows="4" placeholder="${nc ? 'Hairline cracks in grout from normal settling are covered once, at your eleven-month walkthrough. We’ll take care of it then.' : 'Planed the top of the door and repainted the edge. It closes smoothly now.'}">${esc(nc ? '' : (r.status === 'scheduled' ? '' : r.response || ''))}</textarea></div>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="warr-close" data-id="${r.id}" data-v="${nc ? 'not_covered' : 'resolved'}">${nc ? 'Close request' : 'Mark resolved'}</button></div>`); break; }
    case 'warr-close': {
      const note = $('#wn-note').value.trim(); if (!note) { toast('Add a sentence for the homeowner'); $('#wn-note').focus(); break; }
      must(await sb.from('warranty_requests').update({ status: el.dataset.v, response: note }).eq('id', id));
      const r = S.d.warranty_requests.find(x => x.id === id), ev = S.d.events.find(e => e.title === `Warranty visit · ${wNo(r)}`);
      if (ev && el.dataset.v === 'resolved') await sb.from('events').update({ status: 'done' }).eq('id', ev.id);
      await log(`${el.dataset.v === 'resolved' ? 'resolved' : 'closed'} warranty request ${wNo(r)}`, 'warranty'); closeModal(); await refresh(['warranty_requests', 'events', 'activity']); toast(el.dataset.v === 'resolved' ? 'Resolved' : 'Closed'); break; }
    case 'moment': S.moment = null; await openMoment(id); break;
    case 'moment-photo': S.moment.photo = el.dataset.v || null; document.querySelectorAll('.mo-ph').forEach(b => b.setAttribute('aria-pressed', b === el)); await paintMoment(); break;
    case 'moment-copy': await navigator.clipboard.writeText(val('mo-cap')).then(() => toast('Caption copied'), () => toast('Select the caption and copy it')); break;
    case 'moment-share': {
      const m = S.moment; if (!m?.file) break; const text = val('mo-cap');
      if (navigator.canShare?.({ files: [m.file] })) { try { await navigator.share({ files: [m.file], text }); } catch (e) { if (e.name !== 'AbortError') throw e; } }
      else { const a = document.createElement('a'); a.href = m.url; a.download = m.file.name; document.body.appendChild(a); a.click(); a.remove(); toast('Saved to your downloads'); }
      break; }
    case 'man-room': S.ui.manRoom = el.dataset.v || null; S.ui.manQ = ''; render(); window.scrollTo(0, 0); break;
    case 'man-walls': S.ui.wallRoom = el.dataset.v; location.hash = 'walls'; break;
    case 'man-print': S.ui.manPrint = true; render(); await new Promise(r => setTimeout(r, 350)); window.print(); S.ui.manPrint = false; render(); break;
    case 'man-zoom': { const it = S.d.home_items.find(x => x.id === id), u = S.urls[it.photo_path] || it.photo_path;
      modal(`<div class="spread"><div><span class="eyebrow">${esc(it.room)} · ${esc(it.category)}</span><h3 style="margin-top:6px">${esc(it.name)}</h3></div><button class="btn sm ghost" data-act="modal-close">Close</button></div>
        <img src="${esc(u)}" alt="${esc(it.name)}" style="width:100%;max-height:70vh;object-fit:contain;background:var(--surface-2)">`, true); break; }
    case 'man-new': S.manDraft = { room: el.dataset.room || S.ui.manRoom || '', category: el.dataset.room === WHOLE || S.ui.manRoom === WHOLE ? 'Systems' : manCats()[0] }; S.manPhoto = null; modal(manForm(null), true); break;
    case 'man-edit': { const it = S.d.home_items.find(x => x.id === id); S.manDraft = { ...it }; S.manPhoto = null; modal(manForm(it), true); break; }
    case 'man-save': {
      readManForm(); const d = S.manDraft, err = $('#mf-err');
      if (!d.room || !d.name) { err.textContent = !d.room ? 'Choose the room.' : 'Say what it is, for example “Walls” or “Range”.'; err.hidden = false; break; }
      el.textContent = 'Saving';
      let photo_path = d.photo_path || null;
      if (S.manPhoto) { photo_path = `${S.pid}/manual/${crypto.randomUUID()}.jpg`; await upload(photo_path, S.manPhoto.blob, 'image/jpeg'); }
      const row = { room: d.room, category: d.category, name: d.name, maker: d.maker || null, product: d.product || null, detail: d.detail || null, care: d.care || null,
        warranty_until: d.warranty_until, document_id: d.document_id, photo_path };
      if (el.dataset.id) must(await sb.from('home_items').update(row).eq('id', el.dataset.id));
      else must(await sb.from('home_items').insert({ ...row, project_id: S.pid, position: (S.d.home_items || []).filter(i => i.room === d.room).length }));
      const room = d.room, cat = d.category, isNew = !el.dataset.id;
      await refresh(['home_items']);
      if (el.dataset.next) { S.manDraft = { room, category: cat }; S.manPhoto = null; modal(manForm(null), true); $('#mf-name')?.focus(); toast(`Saved to ${room}`); }
      else { closeModal(); if (isNew) { await log(`added to the home manual: ${room.toLowerCase()}`, 'manual'); await refresh(['activity']); } S.ui.manRoom = room; render(); toast(isNew ? `Saved to ${room}` : 'Saved'); }
      break; }
    case 'man-del': {
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Tap again to remove'; break; }
      const it = S.d.home_items.find(x => x.id === id);
      if (it.photo_path?.includes('/manual/')) await sb.storage.from(BUCKET).remove([it.photo_path]);
      must(await sb.from('home_items').delete().eq('id', id)); closeModal(); await refresh(['home_items']); toast('Removed'); break; }
    case 'man-import': modal(importSheet(), true); break;
    case 'man-import-save': {
      const ids = [...document.querySelectorAll('[data-imp]:checked')].map(x => x.dataset.imp);
      if (!ids.length) { toast('Check at least one selection'); break; }
      const missing = ids.find(i => !$(`[data-imp-room="${i}"]`).value.trim()); if (missing) { toast('Add a room for each one'); $(`[data-imp-room="${missing}"]`).focus(); break; }
      el.textContent = 'Adding';
      const rows = ids.map((sid, n) => { const sel = S.d.selections.find(x => x.id === sid), o = S.d.selection_options.find(x => x.id === sel.chosen_option_id), cat = guessCat(sel.category + ' ' + (o?.name || ''));
        return { project_id: S.pid, room: $(`[data-imp-room="${sid}"]`).value.trim(), category: cat, name: sel.category, product: o?.name || null, detail: o?.detail || null, care: manCare(cat) || null, photo_path: o?.image_path || null, selection_id: sid, position: 100 + n }; });
      must(await sb.from('home_items').insert(rows)); closeModal();
      await log(`added ${rows.length} selection${rows.length > 1 ? 's' : ''} to the home manual`, 'manual'); await refresh(['home_items', 'activity']); toast(`Added ${rows.length} to the manual`); break; }
    case 'gloss-jump': { const t = $(`#gg-${el.dataset.v}`); if (t) window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - 90, behavior: 'smooth' }); break; }
    case 'wall-del': {
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Tap again to delete'; break; }
      const w = S.d.wall_photos.find(x => x.id === id);
      await sb.storage.from(BUCKET).remove([w.path]); must(await sb.from('wall_photos').delete().eq('id', id));
      closeModal(); await refresh(['wall_photos']); toast('Deleted'); break; }
    case 'note-pm':
      modal(`<span class="eyebrow">Note to ${esc(clientFirst())}</span><h2>What should they know?</h2>
        <p class="small muted">Shown at the top of their overview with today’s date. Keep it to a few sentences: what’s happening, what’s next, anything they should plan for.</p>
        <div class="field"><label for="pmn">Your note</label><textarea id="pmn" rows="5" maxlength="600" placeholder="Drywall starts Monday. The house will be closed to visits that week.">${esc(P().pm_note || '')}</textarea></div>
        <div class="row" style="justify-content:flex-end">${P().pm_note ? `<button class="edit-link" data-act="note-pm-clear" style="margin-right:auto">Remove note</button>` : ''}<button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="note-pm-save">Save note</button></div>`); break;
    case 'note-pm-save': {
      const t = val('pmn'); if (!t) { toast('Write a sentence or two first'); $('#pmn').focus(); break; }
      must(await sb.from('projects').update({ pm_note: t, pm_note_at: new Date().toISOString(), pm_note_by: S.me.id }).eq('id', S.pid));
      await log('left a note on the overview', 'overview'); closeModal(); await refresh(['project', 'activity']); toast(`Note saved. ${clientFirst()} will see it at the top of their home.`); break; }
    case 'note-pm-clear':
      must(await sb.from('projects').update({ pm_note: null, pm_note_at: null, pm_note_by: null }).eq('id', S.pid)); closeModal(); await refresh(['project']); toast('Note removed'); break;
    case 'tour-next': S.tour.i++; drawTour(); break;
    case 'tour-back': S.tour.i--; drawTour(); break;
    case 'tour': showTour(el.dataset.role, false); break;
    case 'email-preview': {
      el.textContent = 'Preparing';
      const { data, error } = await sb.functions.invoke('notify', { body: { mode: 'preview', project_id: S.pid } });
      if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch {} throw new Error(m); }
      modal(`<div class="spread"><div><span class="eyebrow">Preview · not sent</span><h3 style="margin-top:6px">${esc(data.subject)}</h3></div><button class="btn sm ghost" data-act="modal-close">Close</button></div>
        <iframe class="email-frame" title="Email preview" sandbox="allow-popups"></iframe>`, true);
      $('#modal .email-frame').srcdoc = data.html; break; }
    case 'more': { const pop = $('#more-pop'); pop.hidden = !pop.hidden; break; }
    case 'more-sheet': {
      const items = [...(DEC.length ? [nl(['timeline','Timeline'])] : []), ...EXTRA.filter(x => forMe(x) && x.where === 'primary').map(x => [x.id, x.label]), ...MORE, ...(isStaff() ? [['homes','Today']] : [])];
      modal(`<span class="eyebrow">${esc(P().name)}</span><nav class="sheet-list">${items.map(([v, l]) => { const b = badgeFor(v); return `<a href="#${v}" ${isCur(v) ? 'aria-current="page"' : ''}><span>${l}</span>${b ? `<sup>${b}</sup>` : '<span class="go">→</span>'}</a>`; }).join('')}</nav>`);
      $('#modal .dialog').classList.add('sheet'); break; }
    case 'signout': await sb.auth.signOut(); location.hash = ''; location.reload(); break;
    case 'forgot': {
      const email = val('li-email'); if (!email) { toast('Enter your email first'); $('#li-email').focus(); break; }
      await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + location.search });
      toast('If that email has an account, a reset link is on its way.'); break; }
    case 'acct': {
      const pop = $('#acct-pop'); if (!pop.hidden) { pop.hidden = true; break; }
      pop.innerHTML = `<div style="padding:8px"><b>${esc(S.me.full_name || '')}</b><div class="small muted">${esc(S.me.email || '')}</div></div>
        ${!isStaff() && S.projects.length > 1 ? S.projects.map(p => `<button class="pop-item" style="width:100%;border-left:0;border-right:0;border-bottom:0;background:none;cursor:pointer;text-align:left" data-act="home-open" data-id="${p.id}">${esc(p.name)}</button>`).join('') : ''}
        <button class="pop-item" style="width:100%;border-left:0;border-right:0;border-bottom:0;background:none;cursor:pointer;text-align:left" data-act="me-edit">Your details</button>
        ${isStaff() && S.d ? `<button class="pop-item" style="width:100%;border-left:0;border-right:0;border-bottom:0;background:none;cursor:pointer;text-align:left" data-act="tour" data-role="client">Client welcome tour</button>` : ''}
        <button class="pop-item" style="width:100%;border-left:0;border-right:0;border-bottom:0;background:none;cursor:pointer;text-align:left" data-act="tour" data-role="${isStaff() ? 'staff' : 'client'}">${isStaff() ? 'Builder welcome tour' : 'Welcome tour'}</button>
        <button class="pop-item" style="width:100%;border-left:0;border-right:0;border-bottom:0;background:none;cursor:pointer;text-align:left" data-act="signout">Sign out</button>`;
      pop.hidden = false; break; }
    case 'me-edit':
      modal(`<span class="eyebrow">Your details</span><h2>${esc(S.me.full_name || 'Your details')}</h2>
        <div class="field"><label for="me-name">Full name</label><input id="me-name" value="${esc(S.me.full_name || '')}"></div>
        <div class="field"><label for="me-phone">Phone</label><input id="me-phone" type="tel" value="${esc(S.me.phone || '')}"></div>
        ${isStaff() ? `<div class="field"><label for="me-title">Title</label><input id="me-title" value="${esc(S.me.title || '')}"></div>` : ''}
        <div class="field"><span>Email</span>
          <label class="switch"><input type="checkbox" id="me-upd" ${S.me.email_updates !== false ? 'checked' : ''}><span>${isStaff() ? 'Email me when clients answer, sign, choose, request a visit, send a message, or need warranty service' : 'Email me when something needs my attention, and when the team sends a message'}</span></label>
          ${isStaff() ? `<label class="switch"><input type="checkbox" id="me-daily" ${S.me.email_mode === 'daily' ? 'checked' : ''}><span>Bundle them into one email each weekday morning<br><span class="small muted">Urgent warranty requests still arrive right away.</span></span></label>` : ''}
          ${isStaff() ? '' : `<label class="switch"><input type="checkbox" id="me-dig" ${S.me.email_digest !== false ? 'checked' : ''}><span>Send me “Your home this week” every Friday</span></label>`}</div>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="me-save">Save</button></div>`); break;
    case 'me-save': {
      const upd = { full_name: val('me-name') || null, phone: val('me-phone') || null, email_updates: $('#me-upd').checked }; if (isStaff()) { upd.title = val('me-title') || null; upd.email_mode = $('#me-daily').checked ? 'daily' : 'instant'; } else upd.email_digest = $('#me-dig').checked;
      must(await sb.from('profiles').update(upd).eq('id', S.me.id)); Object.assign(S.me, upd); closeModal();
      if (S.pid && S.view !== 'homes') await refresh(['project_members']); else render(); toast('Saved'); break; }
    case 'bell': {
      const pop = $('#pop'); if (!pop.hidden) { pop.hidden = true; break; }
      const items = S.d.activity.filter(x => x.actor_id !== S.me.id).slice(0, 10), fresh = new Set(unseen().map(x => x.id));
      pop.innerHTML = `<div class="spread" style="padding:6px 8px 10px"><span class="eyebrow">Recent activity</span></div>` +
        (items.length ? items.map(n => `<a href="#${esc(n.view || 'overview')}" class="pop-item"><span class="pip" style="${fresh.has(n.id) ? '' : 'opacity:.25'}"></span><span><span>${esc(nameOf(n.actor_id))} ${esc(n.body)}</span><br><span class="when">${ft(n.created_at)}</span></span></a>`).join('') : '<div class="pop-item muted">Nothing yet.</div>');
      pop.hidden = false;
      const now = new Date().toISOString(); S.lastSeen = now;
      if (isStaff()) store.set('portal.seen.' + S.pid, now); else await sb.from('project_members').update({ last_seen_at: now }).eq('project_id', S.pid).eq('user_id', S.me.id);
      $('#bell .dot')?.remove(); break; }
    case 'copy': navigator.clipboard?.writeText(el.dataset.v).then(() => toast('Copied ' + el.dataset.v)).catch(() => toast(el.dataset.v)); break;

    /* homes */
    case 'home-open': S.pid = id; store.set('portal.pid', id); S.ui.thread = null; $('#app').querySelector('main').innerHTML = '<div class="boot">Loading</div>'; await loadProject(id); S.view = 'overview'; location.hash = '#overview'; render(); break;
    case 'home-new': modal(homeForm(), true); break;
    case 'home-create': {
      const v = homeVals(); if (!v.name) { toast('Give the home a name'); $('#h-name').focus(); break; }
      const proj = must(await sb.from('projects').insert({ ...v, builder_id: S.me.builder_id, pm_id: S.me.id }).select().single());
      let d = v.start_date || isoToday();
      const phases = B.phases.map((ph, i) => { const s = d, e = addDays(d, ph.days || 30); d = addDays(e, 1);
        return { project_id: proj.id, position: i, name: ph.name, start_date: v.start_date ? s : null, end_date: v.start_date ? e : null, status: i === 0 ? 'current' : 'upcoming', what: ph.what, look: ph.look, decisions: ph.decisions }; });
      must(await sb.from('phases').insert(phases));
      must(await sb.from('draws').insert(B.draws.map((x, i) => ({ project_id: proj.id, position: i, name: x.name, percent: x.percent, status: i === 0 ? 'next' : 'scheduled' }))));
      must(await sb.from('threads').insert(B.threads.map((n, i) => ({ project_id: proj.id, name: n, position: i }))));
      await sb.from('activity').insert({ project_id: proj.id, body: 'created this home', view: 'overview' });
      closeModal(); await loadProjects(); S.pid = proj.id; store.set('portal.pid', proj.id); S.ui.thread = null; await loadProject(proj.id); S.view = 'team'; location.hash = '#team'; render();
      toast(`${proj.name} created. Invite the ${L.client.toLowerCase()}s next.`); break; }
    case 'home-edit': modal(homeForm(P()), true); break;
    case 'home-save': {
      const v = homeVals(); if (!v.name) { toast('Name is required'); break; }
      must(await sb.from('projects').update(v).eq('id', S.pid)); closeModal(); await refresh(['project']); await loadProjects(); toast('Saved'); break; }

    /* phases */
    case 'ph-toggle': S.ui.openPhase = S.ui.openPhase === id ? null : id; render(true); break;
    case 'ph-complete': {
      const i = S.d.phases.findIndex(p => p.id === id), next = S.d.phases[i + 1];
      must(await sb.from('phases').update({ status: 'done' }).eq('id', id));
      if (next) { must(await sb.from('phases').update({ status: 'current' }).eq('id', next.id)); S.ui.openPhase = next.id; }
      await log(`completed ${short(S.d.phases[i].name)}`, 'timeline'); await refresh(['phases','activity']); toast(`Phase complete. ${clientFirst()} can now share the moment.`); break; }
    case 'ph-start': {
      const i = S.d.phases.findIndex(p => p.id === id);
      for (const [j, p] of S.d.phases.entries()) { const st = j < i ? 'done' : j === i ? 'current' : 'upcoming'; if (p.status !== st) must(await sb.from('phases').update({ status: st }).eq('id', p.id)); }
      await log(`started ${short(S.d.phases[i].name)}`, 'timeline'); await refresh(['phases','activity']); break; }
    case 'ph-edit': {
      const p = S.d.phases.find(x => x.id === id);
      modal(`<span class="eyebrow">Phase</span><h2>${esc(p.name)}</h2>
        <div class="form-grid"><div class="field full"><label for="pe-name">Name</label><input id="pe-name" value="${esc(p.name)}"></div>
        <div class="field"><label for="pe-start">Start</label><input type="date" id="pe-start" value="${p.start_date || ''}"></div><div class="field"><label for="pe-end">End</label><input type="date" id="pe-end" value="${p.end_date || ''}"></div>
        <div class="field full"><label for="pe-what">What happens</label><textarea id="pe-what">${esc(p.what || '')}</textarea></div>
        <div class="field full"><label for="pe-look">When you visit</label><textarea id="pe-look">${esc(p.look || '')}</textarea></div>
        <div class="field full"><label for="pe-dec">Your decisions</label><textarea id="pe-dec">${esc(p.decisions || '')}</textarea></div></div>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="ph-save" data-id="${id}">Save</button></div>`, true); break; }
    case 'ph-save':
      must(await sb.from('phases').update({ name: val('pe-name'), start_date: val('pe-start') || null, end_date: val('pe-end') || null, what: val('pe-what'), look: val('pe-look'), decisions: val('pe-dec') }).eq('id', id));
      closeModal(); await refresh(['phases']); toast('Saved'); break;

    /* updates */
    case 'post-open': S.draft = []; S.postText = ''; modal(postSheet()); break;
    case 'draft-del': S.postText = val('post-text'); S.draft.splice(+el.dataset.i, 1); modal(postSheet()); break;
    case 'post-send': {
      const body = val('post-text'), phase = val('post-phase');
      if (!body && !S.draft.length) { const e = $('#post-err'); e.textContent = 'Add a photo or a few words.'; e.hidden = false; break; }
      el.textContent = S.draft.length ? 'Uploading' : 'Posting';
      const up = must(await sb.from('updates').insert({ project_id: S.pid, phase_id: phase || null, author_id: S.me.id, body: body || null, notify_now: !!$('#post-now')?.checked }).select().single());
      const rows = [];
      for (const [i, d] of S.draft.entries()) { const path = `${S.pid}/photos/${crypto.randomUUID()}.jpg`; await upload(path, d.blob, 'image/jpeg'); rows.push({ update_id: up.id, project_id: S.pid, path, position: i }); }
      if (rows.length) must(await sb.from('update_photos').insert(rows));
      await log(rows.length ? `shared ${rows.length} new photo${rows.length > 1 ? 's' : ''}` : 'posted an update', 'updates');
      const emailed = !!$('#post-now')?.checked; closeModal(); S.view = 'updates'; location.hash = '#updates'; await refresh(['updates','update_photos','activity']); toast(emailed ? `Posted. ${clientFirst()} will be emailed in the next few minutes.` : 'Posted. It will be in Friday’s email.'); break; }
    case 'up-del':
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Tap again to delete'; setTimeout(() => { if (el.isConnected) { el.dataset.confirm = ''; el.textContent = 'Delete'; } }, 3000); break; }
      { const paths = photosOf(id).map(p => p.path); if (paths.length) await sb.storage.from(BUCKET).remove(paths); must(await sb.from('updates').delete().eq('id', id)); await refresh(['updates','update_photos','update_comments','update_thanks']); toast('Deleted'); } break;
    case 'ph-open': {
      const p = S.d.update_photos.find(x => x.id === id); const u = S.d.updates.find(x => x.id === p.update_id);
      modal(`<div class="spread"><div><span class="eyebrow">${ft(u?.created_at)}</span>${p.caption ? `<h3 style="margin-top:6px">${esc(p.caption)}</h3>` : ''}</div><div class="row"><a class="btn sm ghost" href="${esc(S.urls[p.path])}" target="_blank" rel="noopener">Full size</a><button class="btn sm ghost" data-act="modal-close">Close</button></div></div>
        <img src="${esc(S.urls[p.path])}" alt="${esc(p.caption)}" style="width:100%;max-height:75vh;object-fit:contain;background:var(--surface-2)">`, true); break; }
    case 'thanks': {
      const mine = S.d.update_thanks.some(t => t.update_id === id && t.user_id === S.me.id);
      if (mine) must(await sb.from('update_thanks').delete().eq('update_id', id).eq('user_id', S.me.id));
      else { must(await sb.from('update_thanks').insert({ update_id: id, project_id: S.pid })); await log('thanked the team for an update', 'updates'); }
      await refresh(['update_thanks','activity']); break; }
    case 'c-send': {
      const body = val('c-' + id); if (!body) break;
      must(await sb.from('update_comments').insert({ update_id: id, project_id: S.pid, body })); await log('commented on an update', 'updates');
      await refresh(['update_comments','activity']); break; }

    /* questions */
    case 'q-quick': $('#qa-' + id).value = el.dataset.v; break;
    case 'q-send': {
      const v = val('qa-' + id); if (!v) { toast('Choose an answer or write your own'); break; }
      must(await sb.rpc('answer_question', { qid: id, answer_text: v })); await refresh(['questions','activity']); toast('Thank you. Your answer has been sent.'); break; }
    case 'q-new': {
      const q = val('nq-text'); if (!q) { toast('Write the question first'); $('#nq-text').focus(); break; }
      must(await sb.from('questions').insert({ project_id: S.pid, phase_id: curPhase()?.id || null, asked_by: S.me.id, question: q, why: val('nq-why') || null,
        options: val('nq-opts').split(',').map(s => s.trim()).filter(Boolean), due_date: val('nq-due') || null }));
      await log('asked for a decision', 'questions'); await refresh(['questions','activity']); toast(`Sent to ${clientFirst()}`); break; }
    case 'q-del': must(await sb.from('questions').delete().eq('id', id)); await refresh(['questions']); break;

    /* messages */
    case 'thread': S.ui.thread = id; render(true); break;
    case 'msg-send': await sendMsg(); break;

    /* selections */
    case 'sel-toggle': S.ui.openSel = S.ui.openSel === id ? null : id; render(true); break;
    case 'sel-pick': S.ui.pick = { ...(S.ui.pick || {}), [id]: el.dataset.o }; render(true); break;
    case 'sel-submit': {
      const s = S.d.selections.find(x => x.id === id), o = S.ui.pick?.[id]; if (!o) break;
      must(await sb.rpc('choose_selection', { sid: id, oid: o })); delete S.ui.pick[id];
      await refresh(['selections','activity']); toast(`Submitted to the ${L.designCenter}`); break; }
    case 'sel-confirm': must(await sb.from('selections').update({ status: 'approved' }).eq('id', id)); await log('confirmed and ordered a selection', 'selections'); await refresh(['selections','activity']); toast('Confirmed'); break;
    case 'sel-reopen': must(await sb.from('selections').update({ status: 'open', chosen_option_id: null }).eq('id', id)); await refresh(['selections']); break;
    case 'sel-open': must(await sb.from('selections').update({ status: 'open' }).eq('id', id)); await log('opened a selection for choosing', 'selections'); await refresh(['selections','activity']); break;
    case 'sel-new': case 'sel-edit': {
      const s = a === 'sel-edit' ? S.d.selections.find(x => x.id === id) : {};
      modal(`<span class="eyebrow">${esc(L.designCenter)}</span><h2>${s.id ? esc(s.category) : 'Add a selection'}</h2>
        <div class="form-grid"><div class="field full"><label for="se-cat">Category</label><input id="se-cat" value="${esc(s.category || '')}" placeholder="Plumbing fixtures"></div>
        <div class="field full"><label for="se-area">Where</label><input id="se-area" value="${esc(s.area || '')}" placeholder="All baths, kitchen, and bar"></div>
        <div class="field"><label for="se-due">Due</label><input type="date" id="se-due" value="${s.due_date || ''}"></div><div class="field"><label for="se-allow">Allowance ($, 0 if included)</label><input type="number" id="se-allow" value="${s.allowance ? +s.allowance : ''}"></div>
        <div class="field full"><label for="se-note">Note to the ${esc(L.client.toLowerCase())}</label><input id="se-note" value="${esc(s.note || '')}"></div>
        ${s.id ? '' : `<div class="field"><label for="se-status">Status</label><select id="se-status"><option value="open">Open for choosing</option><option value="later">Opens later</option></select></div>`}</div>
        <div class="row" style="justify-content:flex-end">${s.id ? `<button class="edit-link" data-act="sel-del" data-id="${s.id}" style="margin-right:auto">Delete</button>` : ''}<button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="sel-save" data-id="${s.id || ''}">Save</button></div>`, true); break; }
    case 'sel-save': {
      const v = { category: val('se-cat'), area: val('se-area') || null, due_date: val('se-due') || null, allowance: +val('se-allow') || 0, note: val('se-note') || null };
      if (!v.category) { toast('Category is required'); break; }
      if (id) must(await sb.from('selections').update(v).eq('id', id));
      else { const r = must(await sb.from('selections').insert({ ...v, project_id: S.pid, status: val('se-status') || 'open' }).select().single()); S.ui.openSel = r.id; }
      closeModal(); await refresh(['selections']); toast('Saved'); break; }
    case 'sel-del': must(await sb.from('selections').delete().eq('id', id)); closeModal(); await refresh(['selections','selection_options']); break;
    case 'opt-new': case 'opt-edit': {
      const o = a === 'opt-edit' ? S.d.selection_options.find(x => x.id === el.dataset.o) : {};
      modal(`<span class="eyebrow">${o.id ? 'Edit option' : 'Add an option'}</span><h2>${esc(S.d.selections.find(x => x.id === id).category)}</h2>
        <div class="form-grid"><div class="field full"><label for="op-name">Name</label><input id="op-name" value="${esc(o.name || '')}" placeholder="Unlacquered brass"></div>
        <div class="field full"><label for="op-detail">Detail</label><input id="op-detail" value="${esc(o.detail || '')}" placeholder="Develops a living patina over time"></div>
        <div class="field"><label for="op-price">Price ($)</label><input type="number" id="op-price" value="${o.price != null ? +o.price : ''}"></div><div class="field"><label for="op-sw">Swatch colors (optional)</label><input id="op-sw" value="${esc((o.swatches || []).join(', '))}" placeholder="#B48A4E, #8E6A36"></div>
        <div class="field full"><span>Photo (optional)</span><label class="drop" for="op-img" style="position:relative" id="op-img-l">${o.image_path ? 'Replace the photo' : 'Choose a photo'}<input type="file" id="op-img" accept="image/*"></label></div></div>
        <div class="row" style="justify-content:flex-end">${o.id ? `<button class="edit-link" data-act="opt-del" data-o="${o.id}" style="margin-right:auto">Remove option</button>` : ''}<button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="opt-save" data-id="${id}" data-o="${o.id || ''}">${o.id ? 'Save' : 'Add option'}</button></div>`, true); break; }
    case 'opt-save': {
      const name = val('op-name'); if (!name) { toast('Name is required'); break; }
      const row = { name, detail: val('op-detail') || null, price: +val('op-price') || 0, swatches: val('op-sw').split(',').map(s => s.trim()).filter(s => /^#[0-9a-f]{3,8}$/i.test(s)) };
      const f = $('#op-img').files[0];
      if (f) { row.image_path = `${S.pid}/options/${crypto.randomUUID()}.jpg`; await upload(row.image_path, await compress(f, 1400), 'image/jpeg'); }
      if (el.dataset.o) must(await sb.from('selection_options').update(row).eq('id', el.dataset.o));
      else must(await sb.from('selection_options').insert({ ...row, selection_id: id, project_id: S.pid, position: optionsOf(id).length }));
      closeModal(); await refresh(['selection_options']); toast(el.dataset.o ? 'Option updated' : 'Option added'); break; }
    case 'opt-del': {
      const o = S.d.selection_options.find(x => x.id === el.dataset.o), sel = S.d.selections.find(x => x.id === o.selection_id);
      if (sel.chosen_option_id === o.id) { toast('This option is the current choice. Reopen the selection first.'); break; }
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Tap again to remove'; break; }
      must(await sb.from('selection_options').delete().eq('id', o.id)); closeModal(); await refresh(['selection_options', 'selection_favorites']); toast('Option removed'); break; }
    case 'fav': {
      const oid = el.dataset.o;
      if (isFav(oid)) must(await sb.from('selection_favorites').delete().eq('option_id', oid).eq('user_id', S.me.id));
      else must(await sb.from('selection_favorites').insert({ option_id: oid, project_id: S.pid, user_id: S.me.id }));
      await refresh(['selection_favorites']); break; }
    case 'opt-zoom': {
      const o = S.d.selection_options.find(x => x.id === el.dataset.o);
      modal(`<div class="spread"><div><span class="eyebrow">${esc(S.d.selections.find(x => x.id === o.selection_id)?.category || '')}</span><h3 style="margin-top:6px">${esc(o.name)}</h3></div><button class="btn sm ghost" data-act="modal-close">Close</button></div>
        <img src="${esc(S.urls[o.image_path])}" alt="${esc(o.name)}" style="width:100%;max-height:72vh;object-fit:contain;background:var(--surface-2)">${o.detail ? `<p class="muted">${esc(o.detail)}</p>` : ''}`, true); break; }
    case 'sel-view': S.ui.compare = { ...(S.ui.compare || {}), [id]: el.dataset.v === 'compare' }; render(true); break;
    case 'allow-toggle': S.ui.allowOpen = !S.ui.allowOpen; break;
    case 'sel-withdraw':
      must(await sb.rpc('withdraw_selection', { sid: id })); await refresh(['selections', 'activity']); toast('Reopened. Choose again whenever you’re ready.'); break;
    case 'sel-ask': {
      const sel = S.d.selections.find(x => x.id === id);
      modal(`<span class="eyebrow">${esc(L.designCenter)}</span><h2>${esc(sel.category)}</h2>
        <p class="small muted">Your question goes to the ${esc(L.designCenter)} conversation in Messages, and the team is emailed.</p>
        <div class="field"><label for="ask-q">Your question</label><textarea id="ask-q" rows="4" placeholder="Could we see the Taj Mahal slab in person before choosing?"></textarea></div>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="sel-ask-send" data-id="${id}">Send</button></div>`); break; }
    case 'sel-ask-send': {
      const q = val('ask-q'); if (!q) { toast('Write your question first'); $('#ask-q').focus(); break; }
      const sel = S.d.selections.find(x => x.id === id);
      const th = S.d.threads.find(t => t.name === L.designCenter) || S.d.threads[1] || S.d.threads[0];
      must(await sb.from('messages').insert({ thread_id: th.id, project_id: S.pid, body: `${sel.category}: ${q}` }));
      closeModal(); await refresh(['messages']); toast(`Sent to the ${L.designCenter}. You’ll find the reply in Messages.`); break; }

    /* change orders */
    case 'co-new': {
      const title = val('co-title'), amount = parseFloat(val('co-amount'));
      if (!title || isNaN(amount)) { toast('Add the change and its price'); break; }
      const number = (S.d.change_orders.reduce((m, c) => Math.max(m, c.number), 0)) + 1;
      must(await sb.from('change_orders').insert({ project_id: S.pid, number, title, details: val('co-details') || null, amount, days: parseInt(val('co-days')) || 0, created_by: S.me.id }));
      await log(`sent change order CO-${String(number).padStart(2,'0')} for signature`, 'changes'); await refresh(['change_orders','activity']); toast('Sent for signature'); break; }
    case 'co-del': must(await sb.from('change_orders').delete().eq('id', id)); await refresh(['change_orders']); break;
    case 'co-approve': {
      const c = S.d.change_orders.find(x => x.id === id);
      modal(`<span class="eyebrow">CO-${String(c.number).padStart(2,'0')} · Change order</span><h2>${esc(c.title)}</h2>${c.details ? `<p class="muted">${esc(c.details)}</p>` : ''}
        <div class="ledger"><div><span>Price change</span><span>${signed(c.amount)}</span></div><div><span>Schedule</span><span>${c.days ? `${c.days} days added` : 'No change'}</span></div></div>
        <div class="field"><label for="sig">Initial to sign</label><input id="sig" maxlength="4" autocomplete="off" style="font-family:var(--f-display);font-style:italic;font-size:26px;max-width:160px;text-transform:uppercase"></div>
        <p class="small muted">By initialing, you approve this change to your agreement.</p>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="co-sign" data-id="${c.id}">Sign & approve</button></div>`); break; }
    case 'co-sign': {
      const v = val('sig'); if (!v) { toast('Add your initials to sign'); $('#sig').focus(); break; }
      must(await sb.rpc('sign_change_order', { cid: id, initials: v })); closeModal(); await refresh(['change_orders','activity']); toast('Signed. Thank you.'); break; }
    case 'co-decline':
      modal(`<h2>Decline this change?</h2><div class="field"><label for="dec-note">Note to your team</label><textarea id="dec-note"></textarea></div>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="co-decline-yes" data-id="${id}">Decline</button></div>`); break;
    case 'co-decline-yes': must(await sb.rpc('decline_change_order', { cid: id, note: val('dec-note') })); closeModal(); await refresh(['change_orders','activity']); toast('Declined. Your team has been notified.'); break;

    /* calendar */
    case 'request':
      modal(`<span class="eyebrow">${esc(el.dataset.k)}</span><h2>When would suit you?</h2>
        <div class="row" style="align-items:flex-end"><div class="field" style="flex:1 1 180px"><label for="rq-date">Preferred date</label><input type="date" id="rq-date" value="${addDays(isoToday(), 4)}"></div>
          <div class="field" style="flex:1 1 160px"><label for="rq-time">Time of day</label><select id="rq-time"><option>Morning</option><option selected>Afternoon</option><option>Evening</option></select></div></div>
        <div class="field"><label for="rq-note">Anything we should prepare</label><textarea id="rq-note"></textarea></div>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="request-send" data-k="${esc(el.dataset.k)}">Send request</button></div>`); break;
    case 'request-send':
      must(await sb.rpc('request_visit', { pid: S.pid, kind: el.dataset.k, on_date: val('rq-date') || isoToday(), time_label: val('rq-time'), note: val('rq-note') }));
      closeModal(); await refresh(['events','activity']); toast('Request sent. Your team will confirm shortly.'); break;
    case 'ev-confirm': {
      const e = S.d.events.find(x => x.id === id);
      must(await sb.from('events').update({ status: 'scheduled', title: e.title.replace(' (requested)', '') }).eq('id', id));
      await log(`confirmed: ${e.title.replace(' (requested)', '')} on ${fd(e.starts_on)}`, 'calendar'); await refresh(['events','activity']); toast('Confirmed'); break; }
    case 'ev-new': case 'ev-edit': {
      const e = a === 'ev-edit' ? S.d.events.find(x => x.id === id) : {};
      modal(`<span class="eyebrow">Calendar</span><h2>${e.id ? esc(e.title) : 'Add a date'}</h2>
        <div class="form-grid"><div class="field full"><label for="ev-title">Title</label><input id="ev-title" value="${esc(e.title || '')}" placeholder="Pre-insulation walkthrough"></div>
        <div class="field"><label for="ev-date">Date</label><input type="date" id="ev-date" value="${e.starts_on || ''}"></div><div class="field"><label for="ev-time">Time</label><input id="ev-time" value="${esc(e.time_label || '')}" placeholder="9:00 AM"></div>
        <div class="field"><label for="ev-kind">Type</label><select id="ev-kind">${['Private visit','Inspection','Decision','Design appointment','Milestone'].map(k => `<option ${e.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
        <div class="field"><label for="ev-loc">Where</label><input id="ev-loc" value="${esc(e.location || '')}"></div>
        <div class="field full"><label for="ev-note">Note</label><input id="ev-note" value="${esc(e.note || '')}"></div>
        <label class="row small full" style="gap:8px"><input type="checkbox" id="ev-key" ${e.is_key ? 'checked' : ''}> Highlight as a date not to miss</label></div>
        <div class="row" style="justify-content:flex-end">${e.id ? `<button class="edit-link" data-act="ev-del" data-id="${e.id}" style="margin-right:auto">Delete</button>` : ''}<button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="ev-save" data-id="${e.id || ''}">Save</button></div>`, true); break; }
    case 'ev-save': {
      const v = { title: val('ev-title'), starts_on: val('ev-date'), time_label: val('ev-time') || null, kind: val('ev-kind'), location: val('ev-loc') || null, note: val('ev-note') || null, is_key: $('#ev-key').checked };
      if (!v.title || !v.starts_on) { toast('Title and date are required'); break; }
      if (id) must(await sb.from('events').update(v).eq('id', id)); else { must(await sb.from('events').insert({ ...v, project_id: S.pid })); await log(`added ${v.title} on ${fd(v.starts_on)}`, 'calendar'); }
      closeModal(); await refresh(['events','activity']); toast('Saved'); break; }
    case 'ev-del': must(await sb.from('events').delete().eq('id', id)); closeModal(); await refresh(['events']); break;

    /* documents */
    case 'doc-folder': S.ui.docFolder = el.dataset.f; render(true); break;
    case 'doc-open': {
      const d = S.d.documents.find(x => x.id === id);
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(d.path, 600, { download: d.name });
      if (error) throw error;
      modal(`<span class="eyebrow">${esc(d.folder)}</span><h2>${esc(d.name)}</h2><div class="row"><a class="btn primary" href="${esc(data.signedUrl)}" target="_blank" rel="noopener">Download</a><button class="btn ghost" data-act="modal-close">Close</button></div>`); break; }
    case 'doc-del': {
      const d = S.d.documents.find(x => x.id === id);
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Confirm'; break; }
      await sb.storage.from(BUCKET).remove([d.path]); must(await sb.from('documents').delete().eq('id', id)); await refresh(['documents']); break; }

    /* notes */
    case 'note-add': {
      const body = val('note-text'); if (!body) { toast('Write a note first'); $('#note-text').focus(); break; }
      must(await sb.from('notes').insert({ project_id: S.pid, room: val('note-room') || null, body }));
      await log('added a note', 'walkthrough'); await refresh(['notes','activity']); toast('Noted'); break; }
    case 'note-del': must(await sb.from('notes').delete().eq('id', id)); await refresh(['notes']); break;
    case 'note-ack': must(await sb.from('notes').update({ reviewed: true, reviewed_by: S.me.id }).eq('id', id)); await refresh(['notes']); break;

    /* team */
    case 'set-pm': must(await sb.from('projects').update({ pm_id: id }).eq('id', S.pid)); await refresh(['project']); toast('Updated'); break;
    case 'invite': {
      const staff = el.dataset.role === 'staff', pre = staff ? 'is' : 'iv';
      const body = { email: val(pre + '-email'), full_name: val(pre + '-name'), role: staff ? 'staff' : 'client', project_id: staff ? undefined : S.pid,
        title: staff ? val('is-title') : undefined, phone: staff ? val('is-phone') : undefined, redirect_to: location.origin + location.pathname + location.search };
      if (!body.email) { toast('Enter an email address'); break; }
      el.textContent = 'Sending';
      const { data, error } = await sb.functions.invoke('invite', { body });
      if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch {} throw new Error(msg); }
      if (!staff) await log(`invited ${body.full_name || body.email}`, 'team');
      await refresh(['project_members','activity']);
      toast(data.invited ? `Invitation sent to ${body.email}` : `${body.full_name || body.email} now has access`); break; }
  }
}
async function sendMsg() {
  const body = val('msg-in'); if (!body) return;
  const th = S.ui.thread || S.d.threads[0]?.id;
  must(await sb.from('messages').insert({ thread_id: th, project_id: S.pid, body }));
  await refresh(['messages']); $('#msg-in')?.focus();
}

/* ================= events ================= */
document.addEventListener('click', async e => {
  if (e.target.closest('.sheet-list a')) closeModal();
  const tl = e.target.closest('[data-term]'); if (tl) { S.ui.glossFocus = +tl.dataset.term; S.ui.glossQ = ''; hideTerm(); if (location.hash === '#glossary') { e.preventDefault(); render(); focusTerm(); } }
  if (!e.target.closest('#term-pop') && !e.target.closest('.term')) hideTerm();
  const el = e.target.closest('[data-act]');
  [['#pop','#bell'], ['#acct-pop','.acct-btn'], ['#more-pop','.more-btn']].forEach(([s, t]) => { const p = $(s); if (p && !p.hidden && !e.target.closest(s) && !e.target.closest(t)) p.hidden = true; });
  if (!el || el.disabled || el.dataset.busy) return;
  if (el.tagName === 'A') return;
  el.dataset.busy = '1'; if (el.tagName === 'BUTTON') el.disabled = true;
  const label = el.textContent;
  try { await act(el.dataset.act, el); }
  catch (err) { console.error(err); toast(err.message || 'Something went wrong. Please try again.'); if (el.isConnected) el.textContent = label; }
  finally { if (el.isConnected) { delete el.dataset.busy; el.disabled = false; } }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('#term-pop') && !$('#term-pop').hidden) { hideTerm(); return; } closeModal(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.opt[data-act]')) { e.preventDefault(); e.target.click(); }
  if (S.tour && $('#modal .tour')) { if (e.key === 'ArrowRight' && $('[data-act="tour-next"]')) act('tour-next', {}); if (e.key === 'ArrowLeft' && $('[data-act="tour-back"]')) act('tour-back', {}); }
  if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'msg-in') { e.preventDefault(); sendMsg().catch(err => toast(err.message)); }
  if (e.key === 'Enter' && !e.shiftKey && e.target.id?.startsWith('c-')) { e.preventDefault(); act('c-send', { dataset: { id: e.target.id.slice(2) } }).catch(err => toast(err.message)); }
});
window.addEventListener('scroll', () => hideTerm(), { passive: true });
window.addEventListener('resize', () => hideTerm());
document.addEventListener('input', e => {
  if (e.target.id === 'man-q') { S.ui.manQ = e.target.value; const pos = e.target.selectionStart; render(true); const i = $('#man-q'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
  if (e.target.id === 'mo-cap' && S.moment) S.moment.caption = e.target.value;
  if (e.target.id === 'gloss-q') { S.ui.glossQ = e.target.value; $('#gloss-list').innerHTML = glossList(); }
  if (e.target.id === 'doc-q') { S.ui.docQ = e.target.value; $('#doc-rows').innerHTML = docRows(); }
  if (e.target.id === 'wall-q') { S.ui.wallQ = e.target.value; const pos = e.target.selectionStart; render(true); const i = $('#wall-q'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
});
document.addEventListener('change', async e => {
  const t = e.target;
  try {
    if (t.id === 'mf-photo' && t.files[0]) {
      const blob = await compress(t.files[0], 1600); S.manPhoto = { blob, preview: URL.createObjectURL(blob) };
      const pv = $('#mf-prev'); if (pv) pv.outerHTML = `<img id="mf-prev" src="${S.manPhoto.preview}" alt="">`; const lb = t.closest('label'); if (lb) lb.firstChild.textContent = 'Replace photo';
    }
    if (t.id === 'wr-files') { keepWarr(); for (const f of [...t.files].slice(0, 6)) { const blob = await compress(f, 1800); S.draft.push({ blob, preview: URL.createObjectURL(blob) }); } modal(warrForm(), true); }
    if (t.id === 'wr-room') { keepWarr(); const it = S.d.home_items?.find(i => i.id === S.warrDraft.home_item_id); if (it && it.room !== S.warrDraft.room) S.warrDraft.home_item_id = null; modal(warrForm(), true); $('#wr-details')?.focus(); }
    if (t.id === 'mo-name') { S.moment.showName = t.checked; await paintMoment(); }
    if (t.id === 'mf-cat') {
      const care = $('#mf-care'), old = manCare(S.manDraft.category);
      if (care && (!care.value.trim() || care.value.trim() === old)) care.value = manCare(t.value);
      S.manDraft.category = t.value;
    }
    if (t.id === 'wf-files') {
      keepWallDraft();
      for (const f of [...t.files].slice(0, 20)) { const blob = await compress(f); S.draft.push({ blob, preview: URL.createObjectURL(blob) }); }
      modal(wallForm(S.wallDraftRoom));
    }
    if (t.id === 'post-files') {
      S.postText = val('post-text');
      for (const f of [...t.files].slice(0, 20)) { const blob = await compress(f); S.draft.push({ blob, preview: URL.createObjectURL(blob) }); }
      modal(postSheet());
    }
    if (t.id === 'op-img' && t.files[0]) $('#op-img-l').firstChild.textContent = t.files[0].name;
    if (t.id === 'cover-up' && t.files[0]) {
      toast('Uploading rendering');
      const path = `${S.pid}/cover/${crypto.randomUUID()}.jpg`;
      await upload(path, await compress(t.files[0], 2400, 0.86), 'image/jpeg');
      must(await sb.from('projects').update({ cover_path: path }).eq('id', S.pid));
      await refresh(['project']); toast('Rendering updated');
    }
    if (t.id === 'doc-up') {
      const folder = val('doc-folder') || 'General', files = [...t.files]; toast(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}`);
      for (const f of files) {
        const path = `${S.pid}/docs/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]+/g, '_')}`;
        await upload(path, f, f.type);
        must(await sb.from('documents').insert({ project_id: S.pid, folder, name: f.name, path, size_bytes: f.size, uploaded_by: S.me.id }));
      }
      await log(`added ${files.length} document${files.length > 1 ? 's' : ''} to ${folder}`, 'documents');
      S.ui.docFolder = 'All'; await refresh(['documents','activity']); toast('Uploaded');
    }
    if (t.id === 'imp-file' && t.files[0]) {
      const f = t.files[0]; let rows;
      try { rows = await readSheet(f); } catch (e) { const er = $('#imp-err'); er.textContent = e.message || 'Could not read that file.'; er.hidden = false; return; }
      if (!rows || rows.length < 2) { const er = $('#imp-err'); er.textContent = 'That file looks empty. It needs a header row and at least one item.'; er.hidden = false; return; }
      const head = rows[0].map(h => String(h || '').trim()), map = {};
      IMP_FIELDS.forEach(([k, , re]) => { const i = head.findIndex((h, n) => re.test(h) && !Object.values(map).includes(n)); map[k] = i >= 0 ? i : ''; });
      S.imp = { file: f.name, rows: [head, ...rows.slice(1)], map, room: '' }; modal(importSheetForm(), true);
    }
    if (t.dataset.change === 'imp-map') { if ($('#imp-room')) S.imp.room = val('imp-room'); S.imp.map[t.dataset.v] = t.value; modal(importSheetForm(), true); }
    if (t.id === 'imp-room') { S.imp.room = t.value; modal(importSheetForm(), true); }
    if (t.dataset.change === 'duty') {
      const d = { ...(P().duties || {}) }; if (t.value) d[t.dataset.v] = t.value; else delete d[t.dataset.v];
      must(await sb.from('projects').update({ duties: d }).eq('id', S.pid)); await refresh(['project']);
      const who = t.value ? S.profiles[t.value] : pm(); toast(`${(DUTIES().find(x => x[0] === t.dataset.v) || [, ''])[1]} now goes to ${(who?.full_name || 'the project manager').split(' ')[0]}`);
    }
    if (t.dataset.change === 'draw-status') {
      const upd = { status: t.value }; if (t.value === 'paid') upd.paid_date = isoToday();
      must(await sb.from('draws').update(upd).eq('id', t.dataset.id)); await refresh(['draws']); toast('Updated');
    }
  } catch (err) { console.error(err); toast(err.message || 'Upload failed. Please try again.'); }
});
window.addEventListener('hashchange', async () => {
  const h = location.hash.slice(1);
  if (h.includes('access_token') || !S.me) return;
  if (h === 'homes' && isStaff()) { S.view = 'homes'; await loadProjects(); render(); window.scrollTo(0, 0); return; }
  if (!VIEWS[h] && h !== 'decisions' && !EXTRA.some(x => x.id === h)) return;
  if (!S.d && S.pid) await loadProject(S.pid);
  if (!S.d) return;
  closeModal(); hideTerm(); if (resolveView(h) !== 'walls') S.ui.wallRoom = null; if (resolveView(h) !== 'manual') { S.ui.manRoom = null; S.ui.manQ = ''; } S.view = resolveView(h); render(); window.scrollTo(0, 0); if (S.view === 'glossary') focusTerm();
  if (h === 'messages') refresh(['messages']);
});

/* ================= go ================= */
applyBrand();
if (CFG.supabaseUrl.startsWith('SUPABASE')) {
  $('#app').innerHTML = `<div class="wrap auth"><div class="auth-card">${wordmark()}<p class="lead">Add your Supabase URL and key to config.js to finish setup.</p></div></div>`;
} else {
  start().catch(err => { console.error(err); $('#app').innerHTML = `<div class="wrap auth"><div class="auth-card">${wordmark()}<p class="inline-err">${esc(err.message || 'Could not load the portal.')}</p><button class="btn" data-act="signout">Sign out</button></div></div>`; });
}
})();

