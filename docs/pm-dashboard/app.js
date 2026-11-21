/* DrySafe field CRM — mould.drysafe.sydney/pm-dashboard/
   Reads GET /api/cp1/pm/dashboard/app (contacts, quotes, snapshots), GET …/contact/:id (a contact's
   page timeline) and writes POST …/log (Log activity). The passcode goes in x-dashboard-code; the
   server decides whether it is right. All view logic lives in model.js. Every value from Notion is
   escaped before it reaches the page. */
import * as M from './model.js?v=2611211';

const API = 'https://drysafeapi.vercel.app/api/cp1/pm/dashboard';
const STORE_KEY = 'drysafe.pm-dashboard.code';        // shared with ./classic/
const AUTHOR_KEY = 'drysafe.pm-dashboard.author';
const NOTION_RE = /^https:\/\/www\.notion\.so\/[0-9a-f]{32}$/;
const STALE_MS = 5 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (name, size, cls) => '<svg aria-hidden="true" width="' + (size || 18) + '" height="' + (size || 18) + '"' + (cls ? ' class="' + cls + '"' : '') + '><use href="#i-' + name + '"></use></svg>';
const store = {
  get(k) { try { return window.localStorage.getItem(k) || ''; } catch (e) { return ''; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  del(k) { try { window.localStorage.removeItem(k); } catch (e) { /* private mode */ } }
};
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const notionHref = (u) => (NOTION_RE.test(String(u || '')) ? u : null);
const mapsSearch = (q) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
const mailto = (e) => 'mailto:' + encodeURIComponent(String(e || '')).replace(/%40/g, '@');
const truncate = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

/* ------------------------------------------------------------------ state */
const S = {
  code: '', feed: null, model: null, loadedAt: 0,
  tab: 'lists', hist: [],
  q: '', stage: 'warm', officeStatus: 'all', officeQuery: '', list: null, contactId: null,
  timelines: new Map(),
  qf: 'open', ms: null, gst: false, orderId: null,
  mapFilter: null, mapQuery: '', area: null, skip: new Set(),
  snap: null,
  sheet: null, sheetPushed: false, ignorePop: false, log: null,
  focus: null
};
const TOP = { lists: 'overview', momentum: 'overview', list: 'overview', board: 'contacts', offices: 'contacts', contact: 'contacts',
  map: 'map', run: 'map', rev: 'revenue', quotes: 'revenue', funnel: 'revenue', monthly: 'revenue', partners: 'revenue', order: 'revenue' };
const LABEL = { lists: 'Overview', momentum: 'Momentum', list: 'List', board: 'Board', offices: 'Offices', contact: 'Contact', map: 'Map', run: 'Run',
  rev: 'Summary', quotes: 'Quotes', funnel: 'Funnel', monthly: 'Monthly', partners: 'Partners', order: 'Order' };
const REV_TABS = [['rev', 'Summary'], ['quotes', 'Quotes'], ['funnel', 'Funnel'], ['monthly', 'Monthly'], ['partners', 'Partners']];

/* ------------------------------------------------------------ navigation */
const here = () => ({ tab: S.tab, contactId: S.contactId, orderId: S.orderId, list: S.list, area: S.area, qf: S.qf, y: window.scrollY });
/** Into a deeper screen: remembered, so Back (and the phone's back gesture) returns here. */
function push(tab, extra) {
  S.hist.push(here());
  if (S.hist.length > 40) S.hist.shift();
  try { history.pushState({ crm: 1 }, ''); } catch (e) { /* file:// */ }
  Object.assign(S, extra || {}, { tab: tab });
  render({ top: true });
}
/** Sideways (segmented tabs) or from the nav bar: no history. */
function swap(tab, extra) { Object.assign(S, extra || {}, { tab: tab }); render({ top: true }); }
function navTo(tab) { S.hist = []; S.q = ''; swap(tab); }
function back() {
  if (S.hist.length) { try { history.back(); return; } catch (e) { /* fall through */ } }
  popLoc();
}
function popLoc() {
  const l = S.hist.pop();
  if (!l) { swap(TOP[S.tab] === 'revenue' ? 'rev' : TOP[S.tab] === 'map' ? 'map' : TOP[S.tab] === 'contacts' ? 'board' : 'lists'); return; }
  Object.assign(S, { tab: l.tab, contactId: l.contactId, orderId: l.orderId, list: l.list, area: l.area, qf: l.qf });
  render({ y: l.y });
}
window.addEventListener('popstate', () => {
  if (S.ignorePop) { S.ignorePop = false; return; }      // our own history.back() after closing a sheet
  if (S.sheet) { closeSheet(true); return; }
  if (S.hist.length) popLoc();
});
const backLabel = () => { const l = S.hist[S.hist.length - 1]; return l ? LABEL[l.tab] || 'Back' : 'Back'; };
const backBtn = (fallback) => '<button class="back" data-act="back">' + ic('back') + esc(S.hist.length ? backLabel() : fallback) + '</button>';

/* ---------------------------------------------------------------- render */
let lastKey = '';
function render(opt) {
  if (!S.model) return;
  const o = opt || {};
  const y = window.scrollY;
  const view = VIEWS[S.tab] || VIEWS.lists;
  $('screen').innerHTML = view();
  $('nav').innerHTML = navHtml();
  const key = [S.tab, S.contactId, S.orderId, S.list, S.area].join('|');
  if (o.y != null) window.scrollTo(0, o.y);
  else if (o.top || key !== lastKey) window.scrollTo(0, 0);
  else window.scrollTo(0, y);
  lastKey = key;
  if (S.focus) {
    const f = $(S.focus);
    if (f) { f.focus(); try { const n = f.value.length; f.setSelectionRange(n, n); } catch (e) { /* type=search */ } }
    S.focus = null;
  }
  if (S.tab === 'contact' && S.contactId && !S.timelines.has(S.contactId)) loadTimeline(S.contactId);
}

function navHtml() {
  const t = TOP[S.tab];
  const b = (key, label, icon, tab) => '<button data-act="nav" data-tab="' + tab + '" aria-current="' + (t === key ? 'page' : 'false') + '">' + ic(icon, 22) + label + '</button>';
  return b('overview', 'Overview', 'grid', 'lists') + b('contacts', 'Contacts', 'users', 'board') +
    '<button class="orb" data-act="log" aria-label="Log activity">' + ic('plus', 26) + '</button>' +
    b('revenue', 'Revenue', 'revenue', 'rev') + b('map', 'Map', 'map', 'map');
}

/* ---------------------------------------------------------- shared bits */
const TONE_OF_STATUS = { lead: 'lead', warm: 'warm', partner: 'partner' };
const LETTER = { partner: 'P', warm: 'W', lead: 'L' };
function letterBadge(c) {
  const k = TONE_OF_STATUS[c.status] || 'unset';
  return '<span class="letter t-' + k + '" aria-label="' + esc(c.status ? cap(c.status) : 'Status not set') + '">' + (LETTER[c.status] || '–') + '</span>';
}
function seg(label, items, cur, act, cls) {
  return '<div class="seg ' + (cls || 'two') + '" role="tablist" aria-label="' + esc(label) + '">' + items.map((i) =>
    '<button role="tab" aria-selected="' + (i[0] === cur) + '"' + (i[0] === cur ? '' : ' data-act="' + act + '" data-tab="' + i[0] + '"') + '>' + esc(i[1]) + '</button>').join('') + '</div>';
}
function syncedLabel() {
  if (!S.feed || !S.feed.syncedAt) return '';
  const mins = Math.round((Date.now() - new Date(S.feed.syncedAt).getTime()) / 60000);
  return mins <= 1 ? 'synced just now' : mins < 60 ? 'synced ' + mins + ' min ago' : 'synced ' + M.fmtTime(S.feed.syncedAt);
}
function leftOutText() {
  const l = S.model.left;
  const parts = [];
  if (l.test) parts.push(M.plural(l.test, 'test row'));
  if (l.duplicate) parts.push(M.plural(l.duplicate, 'duplicate'));
  if (l.blank) parts.push(M.plural(l.blank, 'blank row'));
  return parts.length ? 'Left out of every count: ' + parts.join(', ') + '. They are in Clean-up.' : '';
}
function avatarBtn() {
  const a = store.get(AUTHOR_KEY);
  return '<button class="avatar" data-act="account" aria-label="This phone: name, refresh and lock">' + (a ? esc(M.initials(a)) : ic('lock', 18)) + '</button>';
}
function personRow(c, sub, tag) {
  return '<button class="row" data-act="contact" data-id="' + esc(c.id) + '">' + letterBadge(c) +
    '<span class="grow"><span class="t">' + esc(c.name) + '</span><span class="s">' + esc(sub != null ? sub : c.office) + '</span></span>' +
    (tag || '') + ic('next', 16) + '</button>';
}
function nextLine(c) {
  const st = c.nextStage ? c.nextStage : 'not set';
  let when = '';
  if (c.stage && c.stage.stop) return { t: 'Stopped: do not contact further', alert: false };
  if (c.nextDay != null) when = c.overdue ? ' · ' + M.plural(c.overdue, 'day') + ' overdue' : ' · ' + S.model.D(c.nextDay);
  else if (c.nextStage) when = ' · no date set';
  return { t: 'Next: ' + st + when, alert: !!c.overdue || !c.nextStage };
}
function ageTone(d) { return d == null ? 'unset' : d >= 21 ? 'alert' : d >= 8 ? 'warm' : 'partner'; }
function cadenceHtml(c) {
  const words = { done: 'done', tried: 'at reception', todo: 'to do' };
  const names = ['drop-in', 'email', 'call'];
  const icons = ['drop', 'mail', 'phone'];
  const label = c.cells.map((row, r) => 'Round ' + (r + 1) + ': ' + row.map((s, i) => names[i] + ' ' + words[s]).join(', ')).join('. ');
  return '<div class="cad" role="img" aria-label="' + esc(label) + '">' + c.cells.map((row, r) =>
    '<div class="r"><span class="rl">v' + (r + 1) + '</span>' + row.map((s, i) => '<span class="step ' + s + '">' + ic(icons[i], 13) + '</span>').join('') + '</div>').join('') + '</div>';
}
function contactCard(c, reason) {
  const n = nextLine(c);
  const days = c.sinceEdit == null ? '–' : c.sinceEdit === 0 ? 'Today' : c.sinceEdit + 'd';
  return '<button class="card glass lift" data-act="contact" data-id="' + esc(c.id) + '">' +
    '<div class="row-sb" style="align-items:flex-start"><div style="min-width:0"><h2>' + esc(c.name) + '</h2><p class="small muted" style="margin-top:1px">' + esc(c.office) + '</p></div>' +
    '<span class="badge t-' + ageTone(c.sinceEdit) + '" aria-label="' + esc(c.sinceEdit === 0 ? 'Updated today' : 'Updated ' + days + ' ago') + '">' + days + '</span></div>' +
    cadenceHtml(c) +
    '<p style="font-size:14px;line-height:19px;font-weight:600" class="' + (n.alert ? 'alertfg' : '') + '">' + esc(n.t) + '</p>' +
    (reason ? '<p class="small warnfg">' + esc(reason) + '</p>' : (c.nextSteps ? '<p class="small muted">' + esc(truncate(c.nextSteps, 160)) + '</p>' : '')) +
    '</button>';
}
function issueText(c, dupes) {
  if (c.issue === 'duplicate') return 'Marked DUPLICATE: delete the row in Notion';
  if (c.issue === 'blank') return 'Empty name and details: delete the row';
  if (c.issue === 'note') return 'The name field holds a note: move it to Next Steps';
  if (c.issue === 'handle') return 'The name field holds an inbox, not a person';
  if (!c.agencyKnown) return c.agency ? 'Agency is “unverified”' : 'No agency recorded';
  if (dupes) return 'Same email as another contact';
  return '';
}

/* ================================================================ VIEWS */
const VIEWS = {};

/* ------------------------------------------------------- Overview › Lists */
VIEWS.lists = () => {
  const m = S.model;
  const p = m.pipeline;
  const tot = Math.max(1, p.total);
  const searching = S.q.trim().length >= 2;
  const r = m.revenue;
  const tm = r.thisMonth;
  return '<div class="screen">' +
    '<div class="top"><div><span class="k">DrySafe field CRM</span><h1 class="h1">Overview</h1></div>' + avatarBtn() + '</div>' +
    seg('Overview views', [['lists', 'Lists'], ['momentum', 'Momentum']], 'lists', 'sub') +
    '<div class="search"><label for="find" class="sr">Search people, offices or notes</label>' + ic('search', 20) +
    '<input id="find" type="search" data-input="find" autocomplete="off" enterkeyhint="search" placeholder="' + esc(m.people.length + ' people, ' + m.offices + ' offices, every note') + '" value="' + esc(S.q) + '"></div>' +
    '<div id="find-results">' + (searching ? searchHtml() : '') + '</div>' +
    '<div id="overview-body" class="stack" style="gap:14px"' + (searching ? ' hidden' : '') + '>' +
      '<section class="glass blur lift pipe" aria-label="Pipeline"><div class="grid3">' +
        '<div><div class="n fg-lead">' + p.lead + '</div><div class="small muted">Lead</div></div>' +
        '<div><div class="n fg-warm">' + p.warm + '</div><div class="small muted">Warm</div></div>' +
        '<div><div class="n fg-partner">' + p.partner + '</div><div class="small muted">Partner</div></div></div>' +
        '<div class="flow" aria-hidden="true"><span style="width:' + (p.lead / tot * 100).toFixed(1) + '%;background:#7CC4FF"></span><span style="width:' + (p.warm / tot * 100).toFixed(1) + '%;background:#FFC46B"></span><span style="width:' + (p.partner / tot * 100).toFixed(1) + '%;background:#7EE8A1"></span></div>' +
      '</section>' +
      '<button class="revbtn" data-act="nav" data-tab="rev"><span class="orbicon" aria-hidden="true">' + ic('revenue', 20) + '</span>' +
        '<span style="flex:1;min-width:0;display:flex;flex-direction:column"><span class="small" style="font-weight:700;color:#DDE7F5">Approved revenue · ex GST</span>' +
        '<span style="font-size:20px;line-height:26px;font-weight:800">' + esc(M.money(r.total)) + ' <span class="small" style="font-weight:600;color:#DDE7F5">· ' + esc(M.money0(tm ? tm.total : 0)) + ' this month</span></span></span>' + ic('next') + '</button>' +
      '<div class="sechead"><h2>Smart lists</h2><span class="small dim">Live from Notion · ' + esc(syncedLabel()) + '</span></div>' +
      '<div class="grid2">' + m.lists.map((l) =>
        '<button class="tile" data-act="smart" data-key="' + esc(l.key) + '"><span style="display:flex;align-items:center;gap:8px"><span class="dot ' + l.tone + '" aria-hidden="true"></span><span class="n">' + l.n + '</span></span>' +
        '<span class="l">' + esc(l.label) + '</span><span class="s">' + esc(l.sub) + '</span></button>').join('') + '</div>' +
      '<p class="foot">' + esc(leftOutText()) + '</p>' +
    '</div></div>';
};
function searchHtml() {
  const res = M.search(S.model, S.q);
  if (!res.people.length && !res.offices.length) return '<p class="foot" style="padding:4px 2px">Nothing matches “' + esc(S.q.trim()) + '”.</p>';
  let h = '';
  if (res.people.length) {
    h += '<section class="glass list" aria-label="People"><div class="rows">' + res.people.map((c) => {
      const q = S.q.trim().toLowerCase();
      const inNote = c.nextSteps && c.nextSteps.toLowerCase().includes(q.split(/\s+/)[0]) && !(c.name + ' ' + c.office).toLowerCase().includes(q.split(/\s+/)[0]);
      return personRow(c, inNote ? truncate(c.nextSteps, 90) : (c.role ? c.role + ' · ' : '') + c.office);
    }).join('') + '</div></section>';
  }
  if (res.offices.length) {
    h += '<section class="glass list" aria-label="Offices"><div class="rows">' + res.offices.map((g) =>
      '<button class="row" data-act="office" data-name="' + esc(g.name) + '"><span class="letter t-ink">' + ic('drop', 14) + '</span><span class="grow"><span class="t">' + esc(g.name) + '</span><span class="s">' +
      esc(M.plural(g.people.length, 'person', 'people') + ' · ' + g.area + (g.place ? ' · ' + g.place : '')) + '</span></span>' + ic('next', 16) + '</button>').join('') + '</div></section>';
  }
  return '<div class="stack" style="gap:10px">' + h + '</div>';
}

/* ---------------------------------------------------- Overview › Momentum */
VIEWS.momentum = () => {
  const m = S.model;
  const mo = m.momentum;
  let body = '';
  if (!mo) {
    body = '<section class="panel-info"><h2 class="h4">Momentum needs pipeline_snapshots</h2><p>The drySafe API can’t read the pipeline_snapshots table in Notion yet. In Notion, open pipeline_snapshots, choose ••• → Connections and add the same integration that reads pmleads_db. The chart appears on the next refresh.</p></section>';
  } else if (!mo.rows.length) {
    body = '<section class="panel-info"><h2 class="h4">No snapshots yet</h2><p>pipeline_snapshots has no rows with a date and a total.</p></section>';
  } else {
    body = momentumChart(mo);
  }
  const moves = m.moves.length ? '<ol class="glass list rows">' + m.moves.map((x) =>
    '<li><button class="row" data-act="' + (x.order ? 'order' : 'contact') + '" data-id="' + esc(x.order || x.id || '') + '"' + (x.order || x.id ? '' : ' disabled') + '><span class="grow"><span class="t">' + esc(x.who) + ' <span style="font-weight:500;color:#C9D6EA">· ' + esc(x.org) + '</span></span>' +
    '<span class="s">' + esc(m.D(x.day) + ' · ' + x.what) + '</span></span></button></li>').join('') + '</ol>'
    : '<p class="foot">Nothing new since Monday yet.</p>';
  const cov = '<div class="glass" style="padding:6px 14px">' + m.coverage.map((c) =>
    '<div style="display:grid;grid-template-columns:110px 1fr 28px;align-items:center;gap:8px;min-height:44px"><span style="font-size:13px;font-weight:600">' + esc(c.k) + '</span>' +
    '<span class="bar" aria-hidden="true"><span style="width:' + c.w.toFixed(1) + '%;background:#7CC4FF"></span></span><span style="font-size:13px;font-weight:700;text-align:right">' + c.n + '</span></div>').join('') + '</div>';
  return '<div class="screen">' +
    '<div class="top"><div><span class="k">DrySafe field CRM</span><h1 class="h1">Overview</h1></div>' + avatarBtn() + '</div>' +
    seg('Overview views', [['lists', 'Lists'], ['momentum', 'Momentum']], 'momentum', 'sub') +
    body +
    '<section class="stack" aria-labelledby="h-moves"><h2 id="h-moves" class="h2" style="font-size:17px">This week</h2>' + moves + '</section>' +
    '<section class="stack" aria-labelledby="h-cov"><h2 id="h-cov" class="h2" style="font-size:17px">What’s planned next</h2>' + cov +
    '<p class="foot">Next stage to complete for every lead, warm contact and partner. ' + esc(leftOutText()) + '</p></section>' +
    '</div>';
};
function momentumChart(mo) {
  const rows = mo.rows;
  const last = rows.length - 1;
  const sel = S.snap == null || S.snap > last ? last : S.snap;
  const x0 = rows[0].day, x1 = rows[last].day;
  const X = (d) => 12 + ((d - x0) / Math.max(1, x1 - x0)) * 288;
  const series = [['All contacts', 'total'], ['Warm', 'warm'], ['Partners', 'partners']];
  const firstOf = (k) => rows.find((r) => r[k] != null);
  const tile = (label, k, live, fg) => {
    const f = firstOf(k), l = rows[last];
    return '<div class="stat"><div class="k2">' + label + '</div><div class="v ' + fg + '">' + live + '</div><div class="xs muted">' +
      (f && l[k] != null ? esc(f[k] + ' → ' + l[k] + ' since ' + M.fmtDayShort(f.day)) : 'Not in the snapshots') + '</div></div>';
  };
  const panels = series.map(([title, k]) => {
    const pts = rows.map((r, i) => ({ i, d: r.day, v: r[k] })).filter((p) => p.v != null);
    if (!pts.length) return '';
    let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
    if (hi === lo) { hi += 1; lo = Math.max(0, lo - 1); }
    const Y = (v) => 62 - ((v - lo) / (hi - lo)) * 52;
    const line = pts.map((p) => X(p.d).toFixed(1) + ',' + Y(p.v).toFixed(1)).join(' ');
    const sp = pts.find((p) => p.i === sel);
    const end = pts[pts.length - 1];
    const change = pts[0].v + ' → ' + end.v + ' since ' + M.fmtDayShort(pts[0].d);
    return '<div><div class="row-sb" style="padding:4px 14px 0"><span style="font-size:12px;font-weight:700">' + esc(title) + '</span><span class="xs muted">' + esc(change) + '</span></div>' +
      '<svg role="img" aria-label="' + esc(title + ': ' + pts[0].v + ' on ' + M.fmtDayShort(pts[0].d) + ', ' + end.v + ' on ' + M.fmtDayShort(end.d)) + '" width="100%" viewBox="0 0 358 70" preserveAspectRatio="none" style="display:block;height:70px">' +
      '<line x1="12" x2="300" y1="62" y2="62" stroke="rgba(255,255,255,0.22)" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
      '<line x1="' + X(rows[sel].day).toFixed(1) + '" x2="' + X(rows[sel].day).toFixed(1) + '" y1="6" y2="62" stroke="rgba(255,255,255,0.35)" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
      '<polyline points="' + line + '" fill="none" stroke="#BFE3FF" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
      (sp ? '<circle cx="' + X(sp.d).toFixed(1) + '" cy="' + Y(sp.v).toFixed(1) + '" r="4.5" fill="#BFE3FF" stroke="#13284A" stroke-width="2"/>' : '') +
      '<text x="' + (X(end.d) + 9).toFixed(1) + '" y="' + (Y(end.v) + 4).toFixed(1) + '" font-size="12" font-weight="700" fill="#FFFFFF">' + end.v + '</text></svg></div>';
  }).join('');
  const s = rows[sel];
  const readout = M.fmtDay(s.day) + ' · ' + s.total + ' contacts · ' + (s.warm != null ? s.warm + ' warm' : 'warm not recorded') + ' · ' + (s.partners != null ? s.partners + ' partners' : '');
  const mid = rows[Math.floor(last / 2)];
  return '<div class="grid3">' + tile('WARM', 'warm', mo.live.warm, 'fg-warm') + tile('PARTNERS', 'partners', mo.live.partners, 'fg-partner') + tile('ALL', 'total', mo.live.total, '') + '</div>' +
    '<section aria-label="Contacts by status over time" class="glass blur" style="padding:12px 0 8px;display:flex;flex-direction:column;gap:2px">' +
    '<div class="row-sb" style="padding:0 8px 0 14px"><p aria-live="polite" style="font-size:12px;line-height:17px;font-weight:600">' + esc(readout) + '</p>' +
    '<div style="display:flex;gap:4px;flex-shrink:0"><button class="close" data-act="snap" data-d="-1" aria-label="Previous snapshot" style="border-radius:14px">' + ic('back') + '</button>' +
    '<button class="close" data-act="snap" data-d="1" aria-label="Next snapshot" style="border-radius:14px">' + ic('next') + '</button></div></div>' +
    '<div style="position:relative">' + panels +
    '<button data-act="snappick" aria-label="Tap the chart to pick a snapshot" style="position:absolute;left:3.35%;width:80.45%;top:0;bottom:0;background:transparent"></button></div>' +
    '<div aria-hidden="true" class="xs muted" style="display:flex;justify-content:space-between;width:80.45%;margin-left:3.35%"><span>' + esc(M.fmtDayShort(rows[0].day)) + '</span><span>' + esc(M.fmtDayShort(mid.day)) + '</span><span>' + esc(M.fmtDayShort(rows[last].day)) + '</span></div>' +
    '<details style="margin:4px 14px 0"><summary>Show as a table</summary><table class="tbl"><thead><tr><th scope="col">Snapshot</th><th scope="col">All</th><th scope="col">Warm</th><th scope="col">Partners</th></tr></thead><tbody>' +
    rows.map((r) => '<tr><td>' + esc(M.fmtDay(r.day)) + '</td><td>' + r.total + '</td><td>' + (r.warm != null ? r.warm : '–') + '</td><td>' + (r.partners != null ? r.partners : '–') + '</td></tr>').join('') +
    '</tbody></table></details>' +
    '<p class="xs muted" style="padding:4px 14px 0">Snapshot counts are as recorded in pipeline_snapshots. The tiles above are live and leave out test and duplicate rows.</p></section>';
}

/* --------------------------------------------------------- Smart list */
VIEWS.list = () => {
  const m = S.model;
  const l = m.lists.find((x) => x.key === S.list);
  if (!l || !l.people) return VIEWS.lists();
  const dupes = l.key === 'cleanup';
  return '<div class="screen tight">' + backBtn('Overview') +
    '<div><span class="k">Smart list · ' + l.n + '</span><h1 class="h1 sm">' + esc(l.label) + '</h1><p class="small muted" style="margin-top:3px">' + esc(l.note || l.sub) + '</p></div>' +
    (l.people.length ? l.people.map((c) => contactCard(c, dupes ? issueText(c, true) : '')).join('') : '<p class="foot">Nobody on this list right now.</p>') +
    '</div>';
};

/* ------------------------------------------------------- Contacts › Board */
VIEWS.board = () => {
  const m = S.model;
  const p = m.pipeline;
  const stage = S.stage;
  const cards = m.people.filter((c) => c.status === stage).sort((a, b) => (b.sinceEdit || 0) - (a.sinceEdit || 0));
  const tab = (k, label) => '<button role="tab" class="' + k + '" aria-selected="' + (stage === k) + '" data-act="stage" data-v="' + k + '"><span class="n fg-' + k + '">' + p[k] + '</span><span class="l">' + label + '</span></button>';
  return '<div class="screen" style="gap:12px">' +
    '<div><span class="k">' + p.total + ' contacts · ' + m.offices + ' offices</span><h1 class="h1">Contacts</h1></div>' +
    seg('Contact views', [['board', 'Board'], ['offices', 'Offices']], 'board', 'sub') +
    '<div class="grid3 stagetabs" role="tablist" aria-label="Stage">' + tab('lead', 'Lead') + tab('warm', 'Warm') + tab('partner', 'Partner') + '</div>' +
    '<div class="row-sb small muted" style="flex-wrap:wrap;row-gap:6px"><span>Longest since last update first</span><span class="legend" aria-hidden="true" style="gap:10px">' +
      '<span><span class="step done" style="width:14px;height:14px;border-radius:5px"></span>done</span><span><span class="step tried" style="width:14px;height:14px;border-radius:5px"></span>reception</span>' +
      '<span><span class="step todo" style="width:14px;height:14px;border-radius:5px"></span>to do</span></span></div>' +
    (cards.length ? cards.map((c) => contactCard(c)).join('') : '<p class="foot">No contacts at this stage.</p>') +
    '<p class="foot">“Last update” is when the contact’s Notion page last changed, from a log, an email or a property.</p>' +
    '</div>';
};

/* ----------------------------------------------------- Contacts › Offices */
VIEWS.offices = () => {
  const m = S.model;
  const p = m.pipeline;
  const f = S.officeStatus;
  const btn = (k, label, n, fg) => '<button aria-pressed="' + (f === k) + '" data-act="ostatus" data-v="' + k + '" class="' + (f === k ? '' : fg) + '">' + label + ' ' + n + '</button>';
  return '<div class="screen" style="gap:12px">' +
    '<div><span class="k">A–Z · every group open</span><h1 class="h1">Contacts</h1></div>' +
    seg('Contact views', [['board', 'Board'], ['offices', 'Offices']], 'offices', 'sub') +
    '<div class="grid4 filter4" role="group" aria-label="Status filter">' + btn('all', 'All', m.people.length) + btn('lead', 'Lead', p.lead, 'fg-lead') + btn('warm', 'Warm', p.warm, 'fg-warm') + btn('partner', 'Partner', p.partner, 'fg-partner') + '</div>' +
    '<div class="search small"><label for="ofind" class="sr">Filter offices</label>' + ic('search', 18) + '<input id="ofind" type="search" data-input="office" autocomplete="off" placeholder="Filter offices or people" value="' + esc(S.officeQuery) + '"></div>' +
    '<div id="office-list" class="stack" style="gap:12px">' + officeGroupsHtml() + '</div>' +
    '</div>';
};
function officeGroupsHtml() {
  const m = S.model;
  const f = S.officeStatus;
  const q = S.officeQuery.trim().toLowerCase();
  const groups = m.officeGroups.map((g) => {
    let people = f === 'all' ? g.people : g.people.filter((c) => c.status === f);
    if (q && !g.name.toLowerCase().includes(q)) people = people.filter((c) => (c.name + ' ' + (c.role || '')).toLowerCase().includes(q));
    return { g, people };
  }).filter((x) => x.people.length);
  if (!groups.length) return '<p class="foot">No office matches.</p>';
  return groups.map(({ g, people }) => {
    let rev = '';
    if (g.v || g.openQ) {
      const parts = [];
      if (g.v) parts.push(M.money0(g.v) + ' approved');
      if (g.openQ) parts.push(M.plural(g.openQ, 'quote') + ' open, up to ' + M.money(g.upTo));
      if (g.overdueInv) parts.push('invoice overdue');
      rev = '<button class="grev" data-act="nav" data-tab="partners">' + ic('revenue', 16, 'fg-lead') + '<span style="flex:1">' + esc(parts.join(' · ')) + '</span>' + ic('next', 14) + '</button>';
    }
    return '<section class="glass group"><div class="ghead"><h2>' + esc(g.name) + '</h2><span class="xs muted" style="font-weight:700;flex-shrink:0">' + esc(g.mix) + '</span></div>' + rev +
      '<div class="rows">' + people.map((c) => {
        const issue = issueText(c, false);
        const parts = [];
        if (c.role) parts.push(c.role);
        parts.push(c.nextStage ? c.nextStage + ' next' : 'no next stage');
        if (c.drop) parts.push(c.drop.state === 'met' ? 'met at v' + c.drop.round : 'package at reception');
        const sub = issue || parts.join(' · ');
        const tag = c.quotes.length ? '<span class="pill t-partner">' + esc(M.plural(c.quotes.length, 'request')) + '</span>' : (issue ? '<span class="pill t-warm">Tidy up</span>' : '');
        return '<button class="row" data-act="contact" data-id="' + esc(c.id) + '">' + letterBadge(c) + '<span class="grow"><span class="t">' + esc(c.name) + '</span><span class="s"' + (issue ? ' style="color:#FFD592"' : '') + '>' + esc(sub) + '</span></span>' + tag + '</button>';
      }).join('') + '</div></section>';
  }).join('');
}

/* ------------------------------------------------------------ Contact 360 */
VIEWS.contact = () => {
  const m = S.model;
  const c = m.byId.get(S.contactId);
  if (!c) return '<div class="screen tight">' + backBtn('Board') + '<p class="foot">That contact is no longer in pmleads_db.</p></div>';
  const D = m.D;
  const tone = TONE_OF_STATUS[c.status] || 'unset';
  const tel = c.phone.tel;
  const notion = notionHref(c.url);
  const actions =
    (tel ? '<a class="act primary" href="tel:' + esc(tel) + '">' + ic('phone', 20) + 'Call</a>' : '<span class="act primary" aria-disabled="true">' + ic('phone', 20) + 'No number</span>') +
    (c.phone.kind === 'mobile' ? '<a class="act" href="sms:' + esc(tel) + '">' + ic('msg', 20) + 'Text</a>' : '<span class="act" aria-disabled="true">' + ic('msg', 20) + 'Text</span>') +
    (c.email ? '<a class="act" href="' + esc(mailto(c.email)) + '">' + ic('mail', 20) + 'Email</a>' : '<span class="act" aria-disabled="true">' + ic('mail', 20) + 'No email</span>') +
    (c.agencyKnown ? '<a class="act" href="' + esc(mapsSearch(M.mapsQuery(c.agency))) + '" target="_blank" rel="noopener noreferrer">' + ic('nav', 20) + 'Directions</a>' : '<span class="act" aria-disabled="true">' + ic('nav', 20) + 'Directions</span>');
  const stageTxt = M.stageLabel(c.nextStage);
  const drop = c.drop ? (c.drop.state === 'met' ? 'Met at drop-in v' + c.drop.round : 'Package at reception, v' + c.drop.round) : 'No drop-in yet';
  const glance = [
    ['Status', c.status ? cap(c.status) : 'Not set', c.kitSynced ? 'On the email drip' : 'Not on the email drip'],
    ['Next stage', stageTxt, c.stage && !c.stage.stop ? 'Round ' + c.stage.round : ''],
    ['Drop-in status', c.dropIn || 'Not started', drop],
    ['Requests', c.quotes.length ? M.plural(c.quotes.length, 'request') : 'None yet', c.lastRequest != null ? 'Last ' + D(c.lastRequest) : 'Through the Priority Portal'],
    ['Next Steps date', c.nextDay != null ? D(c.nextDay) : 'No date', c.overdue ? M.plural(c.overdue, 'day') + ' overdue' : (c.nextDay != null ? (c.nextDay === m.today ? 'Today' : 'Coming up') : 'None in the note')],
    ['Added', c.created != null ? D(c.created) : '–', c.kitSyncedOn != null ? 'Drip since ' + M.fmtDayShort(c.kitSyncedOn) : '']
  ];
  const next = c.nextSteps ? '<section class="amber"><h2 class="h4">' + esc(c.overdue ? 'Overdue by ' + M.plural(c.overdue, 'day') : (c.nextDay != null ? 'Next: ' + D(c.nextDay) : 'Next step')) + '</h2><p style="font-size:13px;line-height:18px">' + esc(c.nextSteps) + '</p></section>' : '';
  const stopped = c.stage && c.stage.stop;
  const cad = [0, 1, 2].map((r) => {
    const sum = stopped ? 'stopped' : M.roundSummary(c.cells, r);
    const tones = { complete: 't-partner', 'in progress': 't-warm', 'not started': 't-ink', stopped: 't-unset' };
    const words = { done: 'done', tried: 'at reception', todo: 'to do' };
    const detail = ['Drop-in', 'email', 'call'].map((n, i) => n + ' ' + words[c.cells[r][i]]).join(' · ');
    return '<div class="cadrow"><span class="pill ' + tones[sum] + '">v' + (r + 1) + '</span><div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:13px;font-weight:700">' + esc(cap(sum)) + '</span><span class="small muted">' + esc(detail) + '</span></div></div>';
  }).join('');
  const roundBadge = stopped ? 'Stopped' : (c.stage ? 'v' + c.stage.round + ' in progress' : 'Not set');
  const office = m.officeGroups.find((g) => g.name === c.office);
  const quotes = c.quotes.slice().sort((a, b) => b.reqDay - a.reqDay);
  const qrev = '<section class="glass stack" aria-labelledby="h-qr" style="padding:10px 14px 14px">' +
    '<div class="row-sb"><h2 id="h-qr" class="h4">Quotes &amp; revenue</h2><button class="btn" style="color:#A9DAFF;padding:0 2px 0 10px" data-act="nav" data-tab="rev">Revenue' + ic('next', 16) + '</button></div>' +
    '<div class="grid3"><div class="mini"><div class="k2">Quotes</div><div class="v">' + c.quotes.length + '</div></div><div class="mini"><div class="k2">Approved</div><div class="v">' + esc(M.money0(c.revenue)) + '</div></div>' +
    '<div class="mini"><div class="k2">' + esc(truncate(c.agencyKnown ? c.agency : 'Office', 18)) + '</div><div class="v">' + esc(M.money0(office ? office.v : 0)) + '</div></div></div>' +
    (quotes.length ? '<div class="rows">' + quotes.map((q) => '<button class="row" data-act="' + (q.approved ? 'order' : 'quotes') + '" data-id="' + esc(q.id) + '" data-qf="' + q.state + '"><span class="grow"><span class="t">' + esc(q.approved ? M.optName(q.option) + ' · ' + M.money(q.ex) : M.plural(q.rooms, 'room') + ' · up to ' + M.money(q.upTo)) + '</span><span class="s">' +
      esc(q.ref + ' · ' + (q.suburb || 'suburb not recorded') + ' · ' + (q.approved ? 'approved ' + D(q.apprDay) : q.state === 'open' ? M.plural(q.daysLeft, 'day') + ' left' : 'lapsed ' + D(q.lapsedDay))) + '</span></span>' + ic('next', 16) + '</button>').join('') + '</div>'
      : '<p class="small muted">No portal quotes yet' + (c.status === 'partner' ? '.' : '. Partners’ first orders average ' + M.money0(m.revenue.aov) + ' ex GST so far.') + '</p>') +
    '</section>';
  return '<div class="screen tight">' +
    '<div class="row-sb">' + backBtn('Board') + '<span class="k">Contact 360</span></div>' +
    '<section class="glass blur lift stack" style="border-radius:26px;padding:16px;gap:12px">' +
      '<div style="display:flex;gap:14px;align-items:center"><div class="ring" aria-hidden="true"><div>' + esc(c.initials) + '</div></div>' +
      '<div style="min-width:0"><h1 style="font-size:26px;line-height:31px;font-weight:800;overflow-wrap:anywhere">' + esc(c.name) + '</h1><p class="small muted" style="margin-top:2px;font-size:13px;line-height:18px">' + esc([c.role, c.office].filter(Boolean).join(' · ')) + '</p></div></div>' +
      '<div class="chips" style="gap:6px"><span class="pill t-' + tone + '">' + esc(c.status ? cap(c.status) : 'Status not set') + '</span>' +
      '<span class="pill t-' + ageTone(c.sinceEdit) + '">' + esc(c.sinceEdit === 0 ? 'Updated today' : 'Updated ' + M.ago(c.sinceEdit)) + '</span>' +
      '<span class="pill ' + (c.kitSynced ? 't-lead' : 't-unset') + '">' + (c.kitSynced ? 'Email drip on' : 'No email drip') + '</span>' +
      (c.issue || !c.agencyKnown ? '<span class="pill t-warm">Tidy up</span>' : '') + '</div>' +
      '<div class="grid4">' + actions + '</div>' +
    '</section>' +
    '<div class="grid2" style="gap:8px">' + glance.map((g) => '<div class="glance"><span class="k2">' + esc(g[0]) + '</span><span class="v">' + esc(g[1]) + '</span><span class="s">' + esc(g[2]) + '</span></div>').join('') + '</div>' +
    next +
    '<section class="glass stack" aria-labelledby="h-cad" style="gap:10px"><div class="row-sb"><h2 id="h-cad" class="h4">Cadence</h2><span class="pill ' + (stopped ? 't-unset' : 't-partner') + '">' + esc(roundBadge) + '</span></div>' + cad + '</section>' +
    qrev +
    '<section class="glass" aria-labelledby="h-tl" style="padding:6px 14px"><div class="row-sb" style="margin:8px 0 2px"><h2 id="h-tl" class="h4">Timeline</h2>' +
      '<span class="xs dim">From the Notion page</span></div><ol class="tl">' + timelineHtml(c) + '</ol></section>' +
    detailsHtml(c) +
    '<button class="btn primary big wide" data-act="log" data-id="' + esc(c.id) + '">Log a touch</button>' +
    (notion ? '<a class="btn ghost big wide" href="' + esc(notion) + '" target="_blank" rel="noopener noreferrer">' + ic('notion', 18) + 'Open in Notion</a>' : '') +
    (issueText(c, false) ? '<p class="foot warnfg">' + esc(issueText(c, false)) + '</p>' : '') +
    '</div>';
};
function timelineHtml(c) {
  const m = S.model;
  const tl = S.timelines.get(c.id);
  const items = [];
  for (const q of c.quotes) {
    if (q.reqDay != null) items.push({ day: q.reqDay, t: q.reqT || 0, kind: 'Quote requested', tone: 'partner', text: M.plural(q.rooms, 'room') + ' · ' + (q.suburb || 'suburb not recorded') + ' · ' + q.ref });
    if (q.approved && q.apprDay != null) items.push({ day: q.apprDay, t: q.apprT || 0, kind: 'Approved', tone: 'partner', text: M.optName(q.option) + ' · ' + M.money(q.ex) + ' ex GST' });
  }
  if (tl && tl.state === 'ok') {
    tl.data.entries.forEach((e, i) => {
      const day = M.toDay(e.date);
      if (e.kind === 'email') items.push({ day, t: -i, kind: 'Email' + (e.direction && /^received/i.test(e.direction) ? ' received' : ''), tone: 'lead', text: '“' + (e.subject || 'No subject') + '”' + (e.direction ? ' · ' + e.direction : '') });
      else if (e.kind === 'log') {
        const l = (e.label || '').toLowerCase();
        const tone = /drop/.test(l) ? 'warm' : /call/.test(l) ? 'partner' : /email/.test(l) ? 'lead' : 'ink';
        items.push({ day, t: -i, kind: cap(e.label || 'Note') + (e.author ? ' · ' + e.author : ''), tone, text: (e.lines || []).join(' '), next: e.nextStep });
      } else items.push({ day, t: -i, kind: e.title || 'Note', tone: 'ink', text: (e.lines || []).join(' '), next: e.nextStep });
    });
  }
  items.sort((a, b) => (b.day == null ? -1 : 0) - (a.day == null ? -1 : 0) || (b.day || 0) - (a.day || 0) || b.t - a.t);
  let h = items.map((x) => '<li><span class="dot ' + x.tone + '" aria-hidden="true"></span><div style="min-width:0"><p class="w">' + esc((x.day != null ? m.D(x.day) : 'Undated') + ' · ' + x.kind) + '</p>' +
    (x.text ? '<p class="x">' + esc(truncate(x.text, 600)) + '</p>' : '') + (x.next ? '<p class="nx">Next step: ' + esc(x.next) + '</p>' : '') + '</div></li>').join('');
  if (!tl || tl.state === 'loading') h += '<li aria-busy="true"><div style="flex:1;display:flex;flex-direction:column;gap:8px;padding:4px 0"><span class="skeleton" style="width:40%"></span><span class="skeleton" style="width:85%"></span><span class="skeleton" style="width:65%"></span></div></li>';
  else if (tl.state === 'error') h += '<li><div style="flex:1" class="stack"><p class="small alertfg">' + esc(tl.msg || 'Couldn’t read the Notion page.') + '</p><button class="btn ghost" data-act="tlretry" data-id="' + esc(c.id) + '">' + ic('refresh', 16) + 'Try again</button></div></li>';
  else if (!items.length) h += '<li><p class="small muted">Nothing logged on the page yet.</p></li>';
  return h;
}
function detailsHtml(c) {
  const tl = S.timelines.get(c.id);
  const lines = [];
  if (c.phone.raw) lines.push((c.phone.kind === 'mobile' ? 'Mobile ' : c.phone.kind === 'landline' ? 'Landline (in “mob #”) ' : 'Phone ') + c.phone.raw);
  else lines.push('No phone number in “mob #”');
  lines.push(c.email ? c.email : 'No email address');
  const extra = tl && tl.state === 'ok' ? tl.data.details : [];
  return '<section class="glass" style="padding:12px 14px;font-size:13px;line-height:20px"><h2 class="h4" style="margin-bottom:4px">Details</h2>' +
    lines.map((l) => '<p style="overflow-wrap:anywhere">' + esc(l) + '</p>').join('') +
    extra.map((l) => '<p style="overflow-wrap:anywhere">' + esc(l) + '</p>').join('') +
    '<p class="muted">' + esc((c.created != null ? 'In the CRM since ' + S.model.D(c.created) : '') + (c.kitSyncedOn != null ? ' · Kit drip since ' + M.fmtDayShort(c.kitSyncedOn) : '')) + '</p></section>';
}

/* ----------------------------------------------------------------- Map */
VIEWS.map = () => {
  const m = S.model;
  const known = m.officeGroups.filter((g) => g.known);
  const counts = { none: known.filter((g) => g.dropState === 'none').length, partner: known.filter((g) => g.partner).length, v2: known.filter((g) => g.v2due).length };
  const chip = (k, label) => '<button class="chip" aria-pressed="' + (S.mapFilter === k) + '" data-act="mapfilter" data-v="' + k + '">' + esc(label) + '</button>';
  return '<div class="screen">' +
    '<div><span class="k">Territory · ' + known.length + ' offices</span><h1 class="h1">Map</h1></div>' +
    '<div class="search small"><label for="mfind" class="sr">Search a suburb or office</label>' + ic('search', 18) + '<input id="mfind" type="search" data-input="map" autocomplete="off" placeholder="Search a suburb or office" value="' + esc(S.mapQuery) + '"></div>' +
    '<div class="chips scroll" role="group" aria-label="Map filters">' + chip('none', 'No drop-in yet ' + counts.none) + chip('partner', 'Partner offices ' + counts.partner) + chip('v2', 'V2 due ' + counts.v2) + '</div>' +
    '<div class="legend"><span><span class="drops" aria-hidden="true"><i class="met"></i></span>Met</span><span><span class="drops" aria-hidden="true"><i class="reception"></i></span>Reception only</span>' +
    '<span><span class="drops" aria-hidden="true"><i class="none"></i></span>No drop-in</span><span><span class="drops" aria-hidden="true"><i class="none partner"></i></span>Partner office</span></div>' +
    '<div id="map-list" class="stack" style="gap:12px">' + mapListHtml() + '</div>' +
    '<p class="foot">Areas come from the suburb in each office’s name, or from where its quotes were for. Notion has no office addresses, so Google Maps finds each office by name.</p>' +
    '</div>';
};
function areaOffices(a) {
  const q = S.mapQuery.trim().toLowerCase();
  return a.offices.filter((g) => (S.mapFilter === 'none' ? g.dropState === 'none' : S.mapFilter === 'partner' ? g.partner : S.mapFilter === 'v2' ? g.v2due : true) &&
    (!q || (g.name + ' ' + (g.place || '') + ' ' + a.name).toLowerCase().includes(q)));
}
function mapListHtml() {
  const m = S.model;
  const areas = m.areas.map((a) => ({ a, offices: areaOffices(a) })).filter((x) => x.offices.length);
  if (!areas.length) return '<p class="foot">No office matches.</p>';
  const tiles = '<div class="areatiles">' + areas.map(({ a, offices }) => '<button class="areatile" data-act="areajump" data-area="' + esc(a.name) + '"><span class="nm">' + esc(a.name) + '</span>' +
    '<span class="drops" aria-hidden="true">' + offices.map((g) => '<i class="' + g.dropState + (g.partner ? ' partner' : '') + '"></i>').join('') + '</span>' +
    '<span class="ct">' + esc(M.plural(offices.length, 'office') + ' · ' + offices.filter((g) => g.dropState === 'none').length + ' no drop-in') + '</span></button>').join('') + '</div>';
  return tiles + areas.map(({ a, offices }) => {
    const id = 'area-' + a.name.replace(/[^a-z]/gi, '').toLowerCase();
    const pill = (g) => g.dropState === 'met' ? '<span class="pill t-ink">Met</span>' : g.dropState === 'reception' ? '<span class="pill t-warm">Reception</span>' : '<span class="pill t-warm" style="background:rgba(255,255,255,0.1);color:#FFFFFF">No drop-in</span>';
    return '<section class="glass blur" id="' + id + '" aria-labelledby="' + id + '-h" style="border-radius:26px;display:flex;flex-direction:column;gap:8px">' +
      '<div><h2 id="' + id + '-h" class="h2" style="font-size:17px">' + esc(a.name) + '</h2><p class="small muted" style="margin-top:2px">' +
      esc(M.plural(offices.length, 'office') + ' · ' + offices.filter((g) => g.dropState === 'none').length + ' with no drop-in yet · ' + M.plural(offices.filter((g) => g.partner).length, 'partner office')) + '</p></div>' +
      '<div class="rows">' + offices.map((g) => {
        const sub = [g.place ? g.place + (g.placeFrom === 'quote' ? ' (from a quote)' : '') : 'Suburb not recorded', M.plural(g.people.length, 'person', 'people')];
        if (g.partner) sub.push('partner office');
        return '<button class="row" data-act="office" data-name="' + esc(g.name) + '" style="min-height:48px"><span class="grow"><span class="t" style="font-size:13px">' + esc(g.name) + '</span><span class="s xs">' + esc(sub.join(' · ')) + '</span></span>' + pill(g) + '</button>';
      }).join('') + '</div>' +
      '<button class="btn primary wide" data-act="run" data-area="' + esc(a.name) + '">' + ic('route', 18) + 'Plan a ' + esc(a.name) + ' run</button></section>';
  }).join('');
}

/* ----------------------------------------------------------------- Run */
function runStops() {
  const a = S.model.areas.find((x) => x.name === S.area);
  return a ? areaOffices(a) : [];
}
function whyFor(g) {
  const m = S.model;
  const openQ = g.quotes.find((q) => q.state === 'open');
  if (openQ) return 'Ask ' + openQ.first + ' about the ' + M.plural(openQ.rooms, 'room') + ' quote (expires ' + m.D(openQ.expires) + ')';
  const recent = g.quotes.filter((q) => q.approved && q.apprDay != null && m.today - q.apprDay <= 14).sort((x, y) => y.apprDay - x.apprDay)[0];
  const lapsed = g.quotes.filter((q) => q.state === 'lapsed').sort((x, y) => y.lapsedDay - x.lapsedDay)[0];
  if (recent && lapsed) return 'Thank ' + recent.first + ' for the ' + M.optName(recent.option) + ' job and revive ' + lapsed.first + '’s lapsed quote';
  if (recent) return 'Thank ' + recent.first + ' for the ' + M.optName(recent.option) + ' job';
  if (lapsed) return 'Revive ' + lapsed.first + '’s lapsed ' + M.plural(lapsed.rooms, 'room') + ' quote';
  const due = g.people.filter((c) => c.overdue).sort((x, y) => y.overdue - x.overdue)[0];
  if (due) return truncate(due.first + ': ' + due.nextSteps, 120);
  const firstDrop = g.people.filter((c) => c.stage && c.stage.kind === 'drop-in');
  if (firstDrop.length) return 'Drop-in ' + firstDrop.map((c) => 'v' + c.stage.round).filter((v, i, s) => s.indexOf(v) === i).join(' / ') + ' for ' + firstDrop.map((c) => c.first).slice(0, 3).join(', ');
  const withNote = g.people.find((c) => c.nextSteps);
  if (withNote) return truncate(withNote.first + ': ' + withNote.nextSteps, 120);
  return g.dropState === 'none' ? 'First drop-in: introduce DrySafe and leave the package' : 'Check in and leave the latest rate card';
}
VIEWS.run = () => {
  const m = S.model;
  const stops = runStops();
  if (!S.area || !stops.length) return '<div class="screen tight">' + backBtn('Map') + '<p class="foot">No offices for this run. Clear the map filters and try again.</p></div>';
  const inRun = stops.filter((g) => !S.skip.has(g.name));
  const people = inRun.reduce((s, g) => s + g.people.length, 0);
  const firsts = inRun.filter((g) => g.dropState === 'none').length;
  const route = inRun.slice(0, 10).map((g) => M.mapsQuery(g.name));
  const url = route.length ? 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(route[route.length - 1]) +
    (route.length > 1 ? '&waypoints=' + encodeURIComponent(route.slice(0, -1).join('|')) : '') : '';
  let n = 0;
  const cards = stops.map((g) => {
    const on = !S.skip.has(g.name);
    if (on) n++;
    const chips = [];
    if (g.partner) chips.push('<span class="pill t-partner">Partner</span>');
    if (g.dropState === 'none') chips.push('<span class="pill t-lead">First drop-in</span>');
    if (g.v2due) chips.push('<span class="pill t-warm">Drop-in v2</span>');
    if (!g.place) chips.push('<span class="pill t-alert">Suburb not recorded</span>');
    const who = g.people.map((c) => c.first).filter(Boolean);
    const lastDays = g.last >= 9999 ? null : g.last;
    const target = g.people.find((c) => c.status === 'partner') || g.people[0];
    return '<li class="stop' + (on ? '' : ' off') + '"' + (on ? ' style="border-color:' + (n === 1 ? 'rgba(124,196,255,0.8)' : 'rgba(255,255,255,0.16)') + '"' : '') + '>' +
      '<div style="display:flex;gap:12px;align-items:flex-start"><span class="num' + (g.place ? '' : ' hollow') + '" aria-hidden="true">' + (on ? n : '–') + '</span>' +
      '<div style="flex:1;min-width:0"><h2 style="font-size:15px;line-height:20px;font-weight:700">' + esc(g.name) + '</h2><p class="small muted">' + esc(g.place || 'Suburb not recorded') + '</p></div>' +
      '<button class="chip soft" style="height:36px;padding:0 10px;font-size:12px" aria-pressed="' + on + '" data-act="skip" data-name="' + esc(g.name) + '">' + (on ? 'In the run' : 'Skipped') + '</button></div>' +
      (chips.length ? '<div class="chips" style="gap:6px">' + chips.join('') + '</div>' : '') +
      '<p style="font-size:13px;line-height:18px;font-weight:600">' + esc(whyFor(g)) + '</p>' +
      '<p class="small muted">See ' + esc(truncate(who.join(', '), 80) || 'the team') + (lastDays != null ? ' · last update ' + esc(M.ago(lastDays)) : '') + '</p>' +
      '<div class="grid2" style="gap:8px"><a class="btn ghost" href="' + esc('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(M.mapsQuery(g.name))) + '" target="_blank" rel="noopener noreferrer">Navigate</a>' +
      '<button class="btn primary" data-act="log" data-id="' + esc(target.id) + '" data-kind="dropin">Log the visit</button></div></li>';
  }).join('');
  return '<div class="screen tight">' + backBtn('Map') +
    '<div><h1 class="h1 sm">' + esc(S.area) + ' run</h1><p class="small muted" style="margin-top:3px;font-size:13px">' +
    esc(M.plural(inRun.length, 'office') + ' · ' + M.plural(people, 'person', 'people') + ' · ' + M.plural(firsts, 'first drop-in')) + '</p></div>' +
    '<ol class="stack" style="gap:10px">' + cards + '</ol>' +
    (url ? '<a class="btn primary big wide" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + ic('route', 18) + 'Start in Google Maps</a>' : '<p class="foot">Every stop is skipped.</p>') +
    '<p class="foot">Starts from where you are. Google Maps finds each office by name, so check the pins before you set off' + (inRun.length > 10 ? '. Only the first 10 stops fit in one route.' : '.') + ' On a phone, the Google Maps app keeps every stop; the browser may drop some.</p>' +
    '</div>';
};

/* ------------------------------------------------------------- Revenue */
function revHead() {
  const m = S.model;
  return '<div class="revhead"><div><span class="k">Revenue · Notion · ' + esc(m.D(m.today)) + '</span><h1 class="h1">Revenue</h1></div>' +
    seg('Revenue views', REV_TABS, S.tab, 'sub', 'five') + '</div>';
}
const SER = { basic: '#3987e5', care: '#d95926', assessment: '#199e70', other: '#8A9BB5' };
VIEWS.rev = () => {
  const m = S.model;
  const r = m.revenue;
  const D = m.D;
  const months = r.months.slice(-2).reverse();
  const cash = r.cash;
  const cashRows = [];
  if (cash.overdue.items.length) {
    const o = cash.overdue.items[0];
    cashRows.push({ label: 'Invoice overdue', sub: (cash.overdue.items.length > 1 ? M.plural(cash.overdue.items.length, 'invoice') + ' · ' : '') + o.pm + ' · due ' + D(o.dueDay) + ' · ' + M.plural(o.overdueDays, 'day') + ' late', v: cash.overdue.inc, col: '#FF8A8A', sub2: 'alertfg', act: 'order', id: o.id });
  }
  if (cash.paused.items.length) {
    const x = cash.paused.items[0];
    cashRows.push({ label: 'Waiting on jobs to finish', sub: M.plural(cash.paused.items.length, 'invoice') + ' paused' + (x.days ? ' · ' + x.o.first + '’s for ' + M.plural(x.days, 'day') : ''), v: cash.paused.inc, col: '#FFC46B', act: 'order', id: x.o.id });
  }
  if (cash.sent.items.length) cashRows.push({ label: 'Invoiced, not yet due', sub: M.plural(cash.sent.items.length, 'invoice'), v: cash.sent.inc, col: '#7CC4FF', act: 'order', id: cash.sent.items[0].id });
  cashRows.push({ label: 'Paid (recorded)', sub: cash.paid.items.length ? M.plural(cash.paid.items.length, 'invoice') : 'No payment dates in Notion yet', v: cash.paid.inc, col: '#A9BBD6', act: 'sub', tab: 'funnel' });
  const kpi = (label, value, sub, act, tab, qf) => '<button class="tile" data-act="' + act + '"' + (tab ? ' data-tab="' + tab + '"' : '') + (qf ? ' data-qf="' + qf + '"' : '') + ' style="min-height:100px"><span class="small" style="font-weight:700;color:#C9D6EA">' + esc(label) + '</span><span style="font-size:26px;line-height:32px;font-weight:800">' + esc(value) + '</span><span class="s">' + esc(sub) + '</span></button>';
  return '<div class="screen rev">' + revHead() +
    '<section class="hero" aria-label="Approved revenue"><p class="small" style="font-weight:700;color:#DDE7F5">Approved since the portal went live · ex GST</p>' +
    '<p class="big">' + esc(M.money(r.total)) + '</p><p style="font-size:13px;color:#DDE7F5">' + esc(M.money(r.inc) + ' inc GST · ' + M.plural(r.count, 'order') + ' · ' + M.plural(r.rooms, 'room')) + '</p>' +
    '<div class="grid2" style="gap:8px;margin-top:12px">' + months.map((mo) => '<button data-act="sub" data-tab="monthly" class="stat" style="background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.18);min-height:64px;text-align:left"><span class="k2">' + esc(mo.label) + '</span><span style="font-size:18px;line-height:24px;font-weight:800">' + esc(M.money(mo.total)) + '</span><span class="xs muted">' + esc(M.plural(mo.orders, 'order')) + '</span></button>').join('') + '</div></section>' +
    '<div class="grid2">' +
      kpi('Quotes sent', String(r.n), r.firstDay != null ? 'Portal quotes since ' + D(r.firstDay) : 'Portal quotes', 'quotes', null, 'open') +
      kpi('Win rate', r.winRate != null ? r.winRate + '%' : '–', r.decided ? r.count + ' of ' + r.decided + ' decided · ' + m.open.length + ' still open' : 'No quote decided yet', 'sub', 'funnel') +
      kpi('Average order', M.money0(r.aov), r.aovRemed != null ? M.money0(r.aovRemed) + ' on remediation jobs' : 'Assessments only so far', 'sub', 'monthly') +
      kpi('Time to yes', r.median != null ? M.hoursLabel(r.median) : '–', 'Median' + (r.fast ? ' · ' + r.fast + ' inside an hour' : ''), 'sub', 'funnel') +
    '</div>' +
    (m.open.length ? '<section class="amber" aria-labelledby="r-play"><div class="row-sb" style="align-items:baseline"><h2 id="r-play" class="h3" style="color:#FFE2B0">In play</h2><span style="font-size:14px;font-weight:800;color:#FFE2B0">Up to ' + esc(M.money(r.inPlay)) + '</span></div>' +
      '<p class="small">' + esc(M.plural(m.open.length, 'open quote') + '. ' + m.open[0].first + '’s expires first, on ' + D(m.open[0].expires) + '.') + '</p>' +
      '<ul class="rows amberrows">' + m.open.map((q) => '<li class="row-sb" style="min-height:46px"><div style="min-width:0"><p style="font-size:13px;font-weight:700">' + esc(q.pm + ' · ' + q.agency) + '</p><p class="xs" style="color:#F5E6CC">' + esc(M.plural(q.rooms, 'room') + ' · up to ' + M.money(q.upTo)) + '</p></div>' +
      '<span class="pill" style="background:rgba(255,196,107,0.24);color:#FFE2B0;font-weight:800">' + esc(M.plural(q.daysLeft, 'day')) + '</span></li>').join('') + '</ul>' +
      '<button class="btn amberbtn" data-act="quotes" data-qf="open">See every quote</button></section>' : '') +
    '<section class="glass list" aria-labelledby="r-cash" style="padding:6px 14px 12px"><div class="row-sb" style="margin:8px 0 2px;align-items:baseline"><h2 id="r-cash" class="h3">Cash</h2><span class="xs muted" style="font-weight:700">INVOICES · INC GST</span></div>' +
      '<div class="rows">' + cashRows.map((c) => '<button class="row" data-act="' + c.act + '"' + (c.id ? ' data-id="' + esc(c.id) + '"' : '') + (c.tab ? ' data-tab="' + c.tab + '"' : '') + '><span class="cashdot" aria-hidden="true" style="background:' + c.col + ';box-shadow:0 0 10px ' + c.col + '"></span>' +
      '<span class="grow"><span class="t">' + esc(c.label) + '</span><span class="s ' + (c.sub2 || '') + '">' + esc(c.sub) + '</span></span><span style="font-size:15px;font-weight:800">' + esc(M.money(c.v)) + '</span></button>').join('') + '</div>' +
      '<p class="xs dim" style="margin-top:4px">Paid dates come from Stripe. EFT payments are marked off in Xero first, so check there before chasing.</p></section>' +
    '<section class="glass list" aria-labelledby="r-latest"><h2 id="r-latest" class="h3" style="margin:8px 0 2px">Latest orders</h2><div class="rows">' +
      (m.orders.length ? m.orders.map((o) => '<button class="row" data-act="order" data-id="' + esc(o.id) + '" style="min-height:58px"><span class="sw ' + (o.option || 'other') + '" aria-hidden="true"></span>' +
        '<span class="grow"><span class="t">' + esc(o.pm) + '</span><span class="s">' + esc(o.agency + ' · ' + M.optName(o.option)) + '</span></span><span class="end"><span style="font-size:14px;font-weight:800">' + esc(M.money(o.ex)) + '</span><span class="xs muted">' + esc(D(o.apprDay)) + '</span></span></button>').join('')
        : '<p class="small muted" style="padding:8px 0">No approved orders yet.</p>') + '</div></section>' +
    '<p class="foot">' + esc(M.plural(m.tests, 'test quote') + ' left out. Prices are ex GST unless marked.') + '</p>' +
    '</div>';
};

VIEWS.quotes = () => {
  const m = S.model;
  const D = m.D;
  const qf = S.qf || 'open';
  const lists = { open: m.open, approved: m.orders, lapsed: m.lapsed };
  const tabs = [['open', 'Open', 'fg-warm'], ['approved', 'Approved', 'fg-partner'], ['lapsed', 'Lapsed', 'fg-alert']];
  const sum = {
    open: m.open.length ? 'Up to ' + M.money(m.revenue.inPlay) + ' in play across ' + M.plural(m.open.length, 'quote') + '. ' + m.open[0].first + '’s expires first.' : 'No quote is open right now.',
    approved: M.money(m.revenue.total) + ' ex GST from ' + M.plural(m.orders.length, 'approval') + '. ' + (m.revenue.repeat ? M.plural(m.revenue.repeat, 'agency has', 'agencies have') + ' ordered twice.' : 'No agency has ordered twice yet.'),
    lapsed: m.lapsed.length ? 'Up to ' + M.money(m.revenue.walked) + ' walked away. Each one is worth a revive call.' : 'No quote has lapsed.'
  }[qf];
  const CIRC = 131.95;
  const cards = lists[qf].map((q) => {
    const c = q.contact;
    const tel = c && c.phone.tel;
    let corner = '';
    if (qf === 'open') {
      corner = '<svg role="img" aria-label="' + esc(q.daysLeft + ' of 21 days left') + '" width="54" height="54" viewBox="0 0 54 54" style="flex-shrink:0"><circle cx="27" cy="27" r="21" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="5"/>' +
        '<circle cx="27" cy="27" r="21" fill="none" stroke="#FFD592" stroke-width="5" stroke-linecap="round" stroke-dasharray="' + (Math.max(0, Math.min(21, q.daysLeft)) / 21 * CIRC).toFixed(1) + ' ' + CIRC + '" transform="rotate(-90 27 27)"/>' +
        '<text x="27" y="27" text-anchor="middle" font-size="15" font-weight="800" fill="#FFFFFF">' + q.daysLeft + '</text><text x="27" y="38" text-anchor="middle" font-size="8" font-weight="700" letter-spacing="0.6" fill="#C9D6EA">DAYS</text></svg>';
    } else if (qf === 'approved') corner = '<span class="pill t-partner" style="font-size:15px;font-weight:800;padding:4px 10px">' + esc(M.money(q.ex)) + '</span>';
    else corner = '<span class="pill t-ink">Lapsed ' + esc(D(q.lapsedDay)) + '</span>';
    const line = qf === 'approved' ? M.optName(q.option) + ' · ' + M.plural(q.rooms, 'room') + ' · approved ' + D(q.apprDay)
      : M.plural(q.rooms, 'room') + ' · quote sent ' + D(q.sentDay != null ? q.sentDay : q.reqDay) + (qf === 'open' ? ' · expires ' + D(q.expires) : '');
    const prices = qf === 'approved' ? '' : '<div class="chips" style="gap:6px"><span class="pricechip"><span class="sw assessment" aria-hidden="true"></span>Assessment ' + esc(M.money(q.prices.assessment)) + '</span>' +
      '<span class="pricechip"><span class="sw basic" aria-hidden="true"></span>Basic ' + esc(M.money(q.prices.basic)) + '</span><span class="pricechip"><span class="sw care" aria-hidden="true"></span>Care ' + esc(M.money(q.prices.care)) + '</span></div>';
    const note = qf === 'approved' ? (q.hours != null ? 'Approved ' + M.hoursLabel(q.hours) + ' after the quote' : '') : (q.signs.length ? 'Signs reported: ' + q.signs.join(', ').toLowerCase() + '.' : '');
    return '<article class="glass lift stack" style="gap:10px"><div class="row-sb" style="align-items:flex-start"><div style="min-width:0"><h2 style="font-size:16px;line-height:21px;font-weight:700">' + esc(q.pm) + '</h2><p class="small muted" style="font-size:13px">' + esc(q.agency + ' · ' + (q.suburb || 'suburb not recorded')) + '</p></div>' + corner + '</div>' +
      '<p style="font-size:13px;line-height:18px;font-weight:600">' + esc(line) + '</p>' + prices + (note ? '<p class="small muted">' + esc(note) + '</p>' : '') +
      '<div class="grid2" style="gap:8px">' + (tel ? '<a class="btn ghost" href="tel:' + esc(tel) + '">Call ' + esc(q.first) + '</a>' : '<span class="btn ghost" aria-disabled="true">No number</span>') +
      (qf === 'approved' ? '<button class="btn primary" data-act="order" data-id="' + esc(q.id) + '">Open work order</button>' : (c ? '<button class="btn primary" data-act="contact" data-id="' + esc(c.id) + '">Open contact</button>' : '<span class="btn primary" aria-disabled="true">No contact linked</span>')) +
      '</div></article>';
  }).join('');
  return '<div class="screen rev" style="gap:12px">' + revHead() +
    '<div class="grid3 qtabs" role="tablist" aria-label="Quote status">' + tabs.map((t) => '<button role="tab" aria-selected="' + (qf === t[0]) + '" data-act="qf" data-v="' + t[0] + '"><span class="n ' + t[2] + '">' + lists[t[0]].length + '</span><span class="l">' + t[1] + '</span></button>').join('') + '</div>' +
    '<p style="font-size:13px;line-height:18px;font-weight:600;color:#DDE7F5">' + esc(sum) + '</p>' +
    (cards || '<p class="foot">Nothing here.</p>') +
    (qf !== 'approved' ? '<p class="foot">A quote stays open for ' + (S.feed.quoteValidDays || 21) + ' days. Prices are today’s ex-GST prices for the rooms requested.</p>' : '') +
    '</div>';
};

VIEWS.funnel = () => {
  const m = S.model;
  const r = m.revenue;
  const n = Math.max(1, r.n);
  const head = r.cohorts.length ? (() => {
    const cur = r.cohorts[r.cohorts.length - 1];
    const tot = cur.blocks.length;
    return cur.m + ': ' + cur.approved + ' of ' + tot + ' quotes approved so far' + (cur.open ? ', ' + cur.open + ' still open' : '') + (r.fast ? '. ' + M.plural(r.fast, 'approval') + ' came inside an hour.' : '.');
  })() : 'No quotes yet.';
  return '<div class="screen rev">' + revHead() +
    '<section class="glass" style="background:linear-gradient(135deg, rgba(57,135,229,0.36) 0%, rgba(9,22,46,0.55) 75%);border-color:rgba(255,255,255,0.22);display:flex;gap:12px;align-items:center"><span class="orbicon" aria-hidden="true" style="width:40px;height:40px">' + ic('revenue', 20) + '</span><p style="font-size:14px;line-height:19px;font-weight:700">' + esc(head) + '</p></section>' +
    '<section class="glass deep" aria-labelledby="f-stages"><h2 id="f-stages" class="h3">From quote request to cash</h2><p class="small muted" style="margin-top:2px">' + esc(M.plural(r.n, 'portal quote') + (r.firstDay != null ? ' since ' + m.D(r.firstDay) : '') + ' · ' + M.plural(m.tests, 'test row') + ' left out') + '</p>' +
      '<ol class="stack" style="gap:12px;margin-top:12px">' + r.funnel.map((s) => '<li class="stack" style="gap:5px"><div class="row-sb"><span style="font-size:13px;font-weight:700">' + esc(s.label) + '</span><span style="font-size:13px;font-weight:800;flex-shrink:0">' + esc(s.v) + '</span></div>' +
      '<span class="bar' + (s.dashed ? ' dashed' : '') + '" aria-hidden="true">' + (s.dashed ? '' : '<span class="glow" style="width:' + (s.n / n * 100).toFixed(1) + '%"></span>') + '</span>' +
      (s.sub ? '<span class="xs ' + (s.alert ? 'alertfg' : s.warn ? 'warnfg' : 'muted') + '">' + esc(s.sub) + '</span>' : '') + '</li>').join('') + '</ol></section>' +
    '<section class="glass deep" aria-labelledby="f-coh" style="padding:14px 14px 10px"><h2 id="f-coh" class="h3">Approvals by month requested</h2><p class="small muted" style="margin:2px 0 6px">One block per quote</p>' +
      '<div class="rows">' + r.cohorts.map((c) => {
        const text = c.approved + ' of ' + c.blocks.length + ' approved' + (c.open ? ' so far · ' + c.open + ' still open' : '') + ' · ' + M.pctOf(c.approved, c.blocks.length) + '%';
        return '<div role="img" aria-label="' + esc(c.m + ': ' + text) + '" style="display:grid;grid-template-columns:36px 1fr;gap:10px;align-items:center;padding:8px 0"><span style="font-size:13px;font-weight:800">' + esc(c.m) + '</span>' +
          '<div class="stack" style="gap:5px"><div class="blocks">' + c.blocks.map((b) => '<span class="' + b + '">' + ic(b === 'approved' ? 'check' : b === 'open' ? 'clock' : 'x', 12) + '</span>').join('') + '</div><span class="small muted">' + esc(text) + '</span></div></div>';
      }).join('') + '</div>' +
      '<div class="legend" style="padding-top:8px;border-top:1px solid rgba(255,255,255,0.1)"><span><span class="sw" style="background:#3987e5;width:12px;height:12px;border-radius:4px"></span>Approved</span><span><span class="sw" style="border:1.5px dashed #FFD592;width:12px;height:12px;border-radius:4px"></span>Still open</span><span><span class="sw" style="background:rgba(255,255,255,0.18);width:12px;height:12px;border-radius:4px"></span>Lapsed after 21 days</span></div></section>' +
    (r.speed.length ? '<section class="glass deep" aria-labelledby="f-speed" style="padding:14px 14px 8px"><div class="row-sb" style="align-items:baseline"><h2 id="f-speed" class="h3">Time from quote to yes</h2><span style="font-size:13px;font-weight:800">Median ' + esc(M.hoursLabel(r.median)) + '</span></div>' +
      r.speed.map((s) => '<div style="display:grid;grid-template-columns:104px 1fr 18px;gap:8px;align-items:center;min-height:48px"><span style="font-size:13px;font-weight:600">' + esc(s.k) + '</span><span class="stack" style="gap:3px;min-width:0"><span class="bar" aria-hidden="true"><span style="width:' + (s.n / r.speedMax * 100).toFixed(1) + '%"></span></span><span class="xs muted">' + esc(s.who) + '</span></span><span style="font-size:13px;font-weight:800;text-align:right">' + s.n + '</span></div>').join('') + '</section>' : '') +
    (r.mix.length ? '<section class="glass deep" aria-labelledby="f-mix" style="padding:14px 14px 8px"><h2 id="f-mix" class="h3">What PMs choose</h2>' +
      r.mix.map((x) => '<div style="display:grid;grid-template-columns:122px 1fr 72px;gap:8px;align-items:center;min-height:48px"><span style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600"><span class="sw ' + x.k + '" aria-hidden="true"></span>' + esc(x.name) + '</span>' +
      '<span class="stack" style="gap:3px;min-width:0"><span class="bar" aria-hidden="true"><span style="width:' + (x.v / r.mixMax * 100).toFixed(1) + '%;background:' + SER[x.k] + '"></span></span><span class="xs muted">' + esc(M.plural(x.n, 'job') + ' · ' + (r.total ? (x.v / r.total * 100).toFixed(1) : '0') + '%') + '</span></span>' +
      '<span style="font-size:13px;font-weight:800;text-align:right">' + esc(M.money(x.v)) + '</span></div>').join('') + '</section>' : '') +
    '</div>';
};

VIEWS.monthly = () => {
  const m = S.model;
  const r = m.revenue;
  const gst = S.gst;
  const gf = gst ? M.GST : 1;
  const months = r.months;
  const sel = S.ms == null || S.ms >= months.length ? months.length - 1 : S.ms;
  const max = Math.max(1, ...months.map((x) => x.total * gf));
  const steps = [100, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
  const step = steps.find((s) => max / s <= 3) || 100000;
  const dom = Math.ceil(max / step) * step;
  const PH = 134;
  const grid = [];
  for (let v = 0; v <= dom + 0.001; v += step) grid.push(v);
  const tick = (v) => (v === 0 ? '$0' : v >= 1000 ? '$' + (v / 1000) + 'k' : '$' + v);
  const cols = 'grid-template-columns:repeat(' + months.length + ', minmax(0, 1fr))';
  const sm = months[sel];
  const readout = sm.label + ' · ' + M.money(sm.total * gf) + (gst ? ' inc GST' : ' ex GST') + ' · ' + (sm.orders ? M.plural(sm.orders, 'order') : 'no approvals');
  const readout2 = sm.orders ? M.OPT_KEYS.concat(['other']).filter((k) => sm[k] > 0).map((k) => (k === 'other' ? 'Other' : M.optName(k)) + ' ' + M.money(sm[k] * gf)).join(' · ') : M.plural(sm.quotes, 'quote') + ' requested, none approved in this month.';
  const tog = (on, v, label) => '<button aria-pressed="' + on + '" data-act="gst" data-v="' + v + '" style="height:38px;padding:0 10px;border-radius:10px;font-size:12px;font-weight:800;' + (on ? 'background:rgba(255,255,255,0.92);color:#0A1F3F' : 'color:#DDE7F5') + '">' + label + '</button>';
  const bars = months.map((mo, i) => {
    const keys = ['assessment', 'other', 'care', 'basic'].filter((k) => mo[k] > 0);
    const t = mo.total * gf;
    return '<button class="mbar" aria-label="' + esc(mo.label + ': ' + M.money(t) + (gst ? ' inc GST' : ' ex GST') + ', ' + M.plural(mo.orders, 'order')) + '" aria-pressed="' + (sel === i) + '" data-act="ms" data-v="' + i + '">' +
      '<span class="tot">' + esc(M.money(t, 0)) + '</span>' + keys.map((k, j) => '<span class="seg2' + (j === 0 ? ' top' : '') + '" style="height:' + Math.max(1, (mo[k] * gf) / dom * PH - 2).toFixed(1) + 'px;background:' + SER[k] + '"></span>').join('') + '</button>';
  }).join('');
  return '<div class="screen rev">' + revHead() +
    '<section class="glass deep" aria-label="Approved revenue by month" style="padding:14px 16px 10px">' +
      '<div class="row-sb"><h2 class="h3" style="line-height:20px">Approved revenue by month</h2><div role="group" aria-label="GST" style="display:flex;flex-shrink:0;padding:3px;border-radius:13px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16)">' + tog(!gst, '0', 'Ex GST') + tog(gst, '1', 'Inc GST') + '</div></div>' +
      '<p aria-live="polite" style="margin-top:10px;font-size:14px;line-height:19px;font-weight:800">' + esc(readout) + '</p><p class="small muted" style="margin-top:2px;min-height:34px">' + esc(readout2) + '</p>' +
      '<div class="mchart">' + grid.map((v) => { const y = 150 - (v / dom) * PH; return '<div class="mgrid' + (v === 0 ? ' base' : '') + '" aria-hidden="true" style="top:' + y.toFixed(1) + 'px"></div><span class="mtick" aria-hidden="true" style="top:' + (y - 7).toFixed(1) + 'px">' + tick(v) + '</span>'; }).join('') +
        '<div class="mbars" style="' + cols + '">' + bars + '</div><div class="mlabels" aria-hidden="true" style="' + cols + '">' + months.map((mo) => '<span>' + esc(mo.current ? mo.m + ' (so far)' : mo.m) + '</span>').join('') + '</div></div>' +
      '<div class="legend" style="margin-top:6px">' + M.OPT_KEYS.map((k) => '<span><span class="sw ' + k + '" aria-hidden="true"></span>' + esc(M.optName(k)) + '</span>').join('') + '</div>' +
      '<details style="margin-top:6px"><summary>Show as a table</summary><table class="tbl"><thead><tr><th scope="col">Month</th><th scope="col">Basic</th><th scope="col">Care</th><th scope="col">Assess.</th><th scope="col">Total</th></tr></thead><tbody>' +
      months.map((mo) => '<tr><td>' + esc(mo.m) + '</td><td>' + esc(M.money(mo.basic * gf)) + '</td><td>' + esc(M.money(mo.care * gf)) + '</td><td>' + esc(M.money(mo.assessment * gf)) + '</td><td style="font-weight:800">' + esc(M.money(mo.total * gf)) + '</td></tr>').join('') + '</tbody></table></details>' +
    '</section>' +
    '<div class="grid3">' + months.slice(-3).map((mo) => '<div class="stat" style="gap:3px"><span style="font-size:12px;font-weight:800">' + esc(mo.current ? mo.m + ' so far' : mo.label) + '</span><span class="xs muted">' + esc(M.plural(mo.quotes, 'quote') + ' requested') + '</span><span class="xs muted">' + esc(M.plural(mo.orders, 'order') + ' approved') + '</span><span class="xs muted">' + esc(M.plural(mo.rooms, 'room') + ' booked') + '</span></div>').join('') + '</div>' +
    '<p class="foot">Months follow the approval date, Sydney time. A quote requested late one month and approved early the next counts in the later month.</p>' +
    '</div>';
};

VIEWS.partners = () => {
  const m = S.model;
  const r = m.revenue;
  const top = r.ranked[0];
  const rows = r.ranked.map((a, i) => {
    const flags = [];
    if (a.orders.some((o) => o.overdueDays > 0)) flags.push('invoice overdue');
    const openQ = a.quotes.filter((q) => q.state === 'open');
    if (openQ.length) flags.push(M.plural(openQ.length, 'quote') + ' open, up to ' + M.money(openQ.reduce((s, q) => s + (q.upTo || 0), 0)));
    const quiet = a.quiet != null && a.quiet >= 21;
    const sub = a.people.slice(0, 2).join(', ') + ' · ' + M.plural(a.orders.length, 'order') + (quiet ? ' · quiet for ' + a.quiet + ' days' : '') + (flags.length ? ' · ' + flags.join(' · ') : '');
    const tone = flags.includes('invoice overdue') ? 'alertfg' : (quiet || openQ.length ? 'warnfg' : 'muted');
    return '<li><button class="row" data-act="order" data-id="' + esc(a.orders[0].id) + '" style="min-height:66px;display:grid;grid-template-columns:18px 1fr auto;gap:10px;padding:10px 0"><span style="font-size:13px;font-weight:800;color:#A9BBD6">' + (i + 1) + '</span>' +
      '<span class="stack" style="gap:5px;min-width:0"><span style="font-size:14px;font-weight:700">' + esc(a.name) + '</span><span class="bar" style="height:8px" aria-hidden="true"><span class="glow" style="width:' + (a.v / top.v * 100).toFixed(1) + '%"></span></span><span class="xs ' + tone + '">' + esc(sub) + '</span></span>' +
      '<span style="font-size:15px;font-weight:800">' + esc(M.money(a.v)) + '</span></button></li>';
  }).join('');
  const notYet = r.notYet.map((a) => {
    const open = a.quotes.find((q) => q.state === 'open');
    const st = open ? 'Open · up to ' + M.money(open.upTo) : 'Lapsed ' + M.fmtDayShort(Math.max(...a.quotes.map((q) => q.lapsedDay || 0)));
    const c = (open || a.quotes[0]).contact;
    return '<button class="row" data-act="' + (c ? 'contact' : 'quotes') + '" data-id="' + esc(c ? c.id : '') + '" data-qf="' + (open ? 'open' : 'lapsed') + '" style="min-height:52px"><span class="grow"><span class="t" style="font-size:13px">' + esc(a.name) + '</span><span class="xs muted">' + esc(a.people.join(', ')) + '</span></span>' +
      '<span class="pill ' + (open ? 't-warm' : 't-ink') + '">' + esc(st) + '</span></button>';
  }).join('');
  let lever = '';
  if (r.ranked.length >= 2) {
    const quiet = r.ranked.slice(0, 2).filter((a) => a.quiet != null && a.quiet >= 21);
    lever = '<section class="amber"><h2 class="h4">' + (r.repeat ? 'Keep the repeat orders coming' : 'Repeat orders are the next lever') + '</h2><p style="font-size:13px;line-height:18px">' +
      esc('The top two agencies bring in ' + r.top2share + '% of revenue' + (quiet.length ? ', and ' + quiet.map((a) => a.name + ' has been quiet for ' + a.quiet + ' days').join('; ') + '.' : '.') + (r.repeat ? '' : ' None has ordered twice yet.')) + '</p>' +
      '<button class="btn amberbtn" data-act="nav" data-tab="map">Plan a run in the Map tab</button></section>';
  }
  return '<div class="screen rev">' + revHead() +
    '<section class="glass deep" aria-labelledby="p-rank" style="padding:14px 14px 4px"><h2 id="p-rank" class="h3">Revenue by agency</h2><p class="small muted" style="margin:2px 0 4px">' +
    esc(M.plural(r.ranked.length, 'agency has', 'agencies have') + ' ordered. ' + (r.repeat ? M.plural(r.repeat, 'has', 'have') + ' ordered more than once.' : 'None has ordered twice yet.')) + '</p>' +
    (rows ? '<ol class="rows">' + rows + '</ol>' : '<p class="small muted" style="padding:8px 0 12px">No orders yet.</p>') + '</section>' +
    (notYet ? '<section class="glass list" aria-labelledby="p-not"><h2 id="p-not" class="h3" style="margin:8px 0 2px">Quoted, no order yet</h2><div class="rows">' + notYet + '</div></section>' : '') +
    lever +
    '</div>';
};

VIEWS.order = () => {
  const m = S.model;
  const D = m.D;
  const o = m.orders.find((x) => x.id === S.orderId);
  if (!o) return '<div class="screen tight">' + backBtn('Summary') + '<p class="foot">That order is no longer approved in pmrequests_db.</p></div>';
  const chip = (t, k) => '<span class="pill ' + k + '" style="padding:4px 9px">' + esc(t) + '</span>';
  const chips = [chip('✓ Approved', 'chipdone'), o.hasJob ? chip('✓ Job created', 'chipdone') : chip('◷ No job yet', 'chipwait'),
    o.invoice === 'paused' ? chip('◷ Invoice paused', 'chipwait') : o.invoice ? chip('✓ Invoice ' + o.invoice, 'chipdone') : chip('◷ No invoice yet', 'chipwait'),
    o.paid ? chip('✓ Paid', 'chipdone') : o.overdueDays ? chip('! Not paid: overdue', 't-alert') : chip('◷ Not paid yet', 'chipwait')].join('');
  let alert;
  const pausedDays = o.apprDay != null ? m.today - o.apprDay : 0;
  if (o.overdueDays) alert = ['alert', 'Invoice ' + M.plural(o.overdueDays, 'day') + ' past due', M.money(o.inc) + ' inc GST was due ' + D(o.dueDay) + '. Check Xero for an EFT before chasing ' + o.first + '. If it has landed, mark it paid in Stripe.'];
  else if (o.invoice === 'paused' && pausedDays >= 14) alert = ['warn', 'Invoice paused for ' + M.plural(pausedDays, 'day'), 'The Stripe invoice only sends when the job is marked complete. Check this job in FieldSafe.'];
  else if (o.option === 'assessment') alert = ['info', 'Assessment booked', 'The report can lead to a follow-on remediation quote. Follow-on quotes go out by email, so they are not in pmrequests_db.'];
  else if (o.hours != null && o.hours < 1) alert = ['info', 'Fast yes', 'Approved ' + M.hoursLabel(o.hours) + ' after the quote landed.'];
  else alert = ['info', 'On track', o.invoice === 'paused' ? 'The invoice sends when the job is marked complete.' : 'Nothing needs chasing on this order.'];
  const steps = [
    ['done', 'Quote requested', o.reqT ? D(o.reqDay) + ' · ' + M.fmtTime(new Date(o.reqT).toISOString()) : D(o.reqDay), 'Through the Priority Portal'],
    [o.delivered ? 'done' : 'wait', 'Quote delivered', o.sentT ? D(M.toDay(new Date(o.sentT).toISOString())) + ' · ' + M.fmtTime(new Date(o.sentT).toISOString()) : '—', o.bounced ? 'A bounce was recorded, then delivered' : 'Mould remediation quote by email'],
    ['done', 'Approved: ' + M.optName(o.option), o.apprT ? D(o.apprDay) + ' · ' + M.fmtTime(new Date(o.apprT).toISOString()) : D(o.apprDay), o.hours != null ? M.hoursLabel(o.hours) + ' after the quote' : ''],
    [o.hasJob ? 'done' : 'wait', 'FieldSafe job', o.hasJob ? 'Created' : 'Not yet', o.hasJob ? 'In FieldSafe Home for scheduling' : 'Created when the order goes through'],
    o.invoice === 'paused' ? [pausedDays >= 14 ? 'warn' : 'wait', 'Invoice', 'Paused' + (pausedDays ? ' ' + pausedDays + ' days' : ''), 'Sends when the job is marked complete'] : [o.invoice ? 'done' : 'wait', 'Invoice', o.invoice ? cap(o.invoice) + (o.dueDay != null ? ' · due ' + D(o.dueDay) : '') : 'Not yet', 'Stripe invoice'],
    o.paid ? ['done', 'Paid', o.paidDay != null ? D(o.paidDay) : 'Recorded', 'Stripe'] : [o.overdueDays ? 'alert' : 'wait', 'Paid', 'Not recorded', o.overdueDays ? M.plural(o.overdueDays, 'day') + ' past the due date' : 'Stripe, or EFT marked off in Xero']
  ];
  const SICON = { done: 'check', wait: 'clock', open: 'clock', warn: 'clock', alert: 'alert' };
  const c = o.contact;
  const tel = c && c.phone.tel;
  const notion = notionHref(o.url);
  return '<div class="screen tight">' +
    '<div class="row-sb">' + backBtn('Summary') + '<span class="k">Work order</span></div>' +
    '<section class="hero"><p class="small" style="font-weight:700;letter-spacing:0.04em;color:#C9D6EA">' + esc(o.ref) + '</p>' +
    '<div style="display:flex;align-items:center;gap:8px;margin-top:4px"><span class="sw ' + (o.option || 'other') + '" aria-hidden="true" style="width:14px;height:14px"></span><h1 style="font-size:22px;line-height:28px;font-weight:800">' + esc(M.optName(o.option) + ' · ' + M.plural(o.rooms, 'room')) + '</h1></div>' +
    '<p style="margin-top:2px;font-size:13px;line-height:18px;color:#DDE7F5">' + esc((o.suburb || 'Suburb not recorded') + ' · ' + o.agency + ' · ' + o.pm) + '</p>' +
    '<div style="display:flex;align-items:baseline;gap:8px;margin-top:10px"><span class="ordernum">' + esc(M.money(o.ex)) + '</span><span style="font-size:13px;font-weight:700;color:#DDE7F5">ex GST</span></div>' +
    '<p style="font-size:13px;color:#DDE7F5">' + esc(M.money(o.inc) + ' inc GST') + '</p><div class="chips" style="gap:6px;margin-top:12px">' + chips + '</div></section>' +
    '<section class="panel-' + alert[0] + '"><h2 class="h4">' + esc(alert[1]) + '</h2><p>' + esc(alert[2]) + '</p></section>' +
    '<section class="glass list" aria-labelledby="o-tl"><h2 id="o-tl" class="h4" style="margin:8px 0 2px">Order timeline</h2><ol class="rows">' + steps.map((s) =>
      '<li style="display:flex;gap:12px;padding:10px 0"><span class="sdot ' + s[0] + '" aria-hidden="true">' + ic(SICON[s[0]], 13) + '</span><div style="min-width:0;flex:1"><div class="row-sb"><p style="font-size:14px;font-weight:700">' + esc(s[1]) + '</p><p class="small" style="flex-shrink:0;font-weight:700;color:#C9D6EA">' + esc(s[2]) + '</p></div>' +
      (s[3] ? '<p class="small muted" style="margin-top:2px">' + esc(s[3]) + '</p>' : '') + '</div></li>').join('') + '</ol></section>' +
    '<section class="glass stack"><h2 class="h4">Job details</h2>' + (o.signs.length ? '<div class="chips" style="gap:6px">' + o.signs.map((t) => '<span class="pill" style="background:rgba(255,255,255,0.1);color:#EAF1FA;padding:4px 9px">' + esc(t) + '</span>').join('') + '</div>' : '') +
    '<p style="font-size:13px;line-height:19px">Site contact: ' + esc(o.siteContact === 'Tenant' ? 'Tenant (their details stay in FieldSafe)' : (o.siteContact || 'Not recorded')) + '</p>' +
    '<p style="font-size:13px;line-height:19px" class="muted">' + esc('At this size: Basic ' + M.money(o.prices.basic) + ' · Care ' + M.money(o.prices.care) + ' · Assessment ' + M.money(o.prices.assessment)) + '</p></section>' +
    '<div class="grid2" style="gap:8px">' + (tel ? '<a class="btn ghost big" href="tel:' + esc(tel) + '">Call ' + esc(o.first) + '</a>' : (c ? '<button class="btn ghost big" data-act="contact" data-id="' + esc(c.id) + '">Open ' + esc(o.first) + '</button>' : '<span class="btn ghost big" aria-disabled="true">No contact</span>')) +
    (notion ? '<a class="btn primary big" href="' + esc(notion) + '" target="_blank" rel="noopener noreferrer">Open in Notion</a>' : '') + '</div>' +
    (c ? '<button class="btn ghost wide" data-act="contact" data-id="' + esc(c.id) + '">' + esc(o.pm) + '’s contact page' + ic('next', 16) + '</button>' : '') +
    '</div>';
};

/* ================================================================ sheets */
function openSheet(kind) {
  S.sheet = kind;
  if (!S.sheetPushed) { try { history.pushState({ crmSheet: 1 }, ''); S.sheetPushed = true; } catch (e) { /* ignore */ } }
  document.body.classList.add('locked');
  renderSheet(true);
}
function closeSheet(fromPop) {
  S.sheet = null;
  document.body.classList.remove('locked');
  $('sheet').innerHTML = '';
  if (S.sheetPushed) {
    S.sheetPushed = false;
    if (!fromPop) { S.ignorePop = true; try { history.back(); } catch (e) { S.ignorePop = false; } }
  }
}
function renderSheet(first) {
  const host = $('sheet');
  if (!S.sheet) { host.innerHTML = ''; return; }
  const old = host.querySelector('.sheet');
  const y = old ? old.scrollTop : 0;
  host.innerHTML = '<div class="scrim" data-act="scrim"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">' +
    (S.sheet === 'log' ? logSheetHtml() : accountSheetHtml()) + '</section></div>';
  const sh = host.querySelector('.sheet');
  if (!first) sh.scrollTop = y;
  if (S.focus) {
    const f = $(S.focus);
    if (f) { f.focus(); try { const n = f.value.length; f.setSelectionRange(n, n); } catch (e) { /* ignore */ } }
    S.focus = null;
  } else if (first) {
    const h = $('sheet-h');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
}

/* ----------------------------------------------------------- account */
function accountSheetHtml() {
  const a = store.get(AUTHOR_KEY);
  return '<div class="grab" aria-hidden="true"></div><div class="row-sb" style="align-items:flex-start"><div><h1 id="sheet-h" style="font-size:22px;font-weight:800">This phone</h1><p class="small muted" style="margin-top:2px">' + esc(syncedLabel() ? 'Notion ' + syncedLabel() : '') + '</p></div>' +
    '<button class="close" data-act="close" aria-label="Close">' + ic('x') + '</button></div>' +
    '<label class="stack" style="gap:6px"><span class="legend2" style="margin:0">Your name in logs</span><input class="field" id="acc-author" data-input="author" autocomplete="name" maxlength="40" placeholder="e.g. Saini" value="' + esc(a) + '"></label>' +
    '<p class="xs muted">Shown in each log heading, as in “21 Nov 2026, phone call v1, Saini”. Kept on this phone only.</p>' +
    '<button class="btn ghost big wide" data-act="refresh">' + ic('refresh', 18) + 'Refresh from Notion</button>' +
    '<a class="btn ghost big wide" href="./classic/">Classic dashboard</a>' +
    '<button class="btn big wide" data-act="lock" style="border:1px solid rgba(255,179,179,0.5);background:rgba(255,110,110,0.16);color:#FFD3D3">' + ic('lock', 18) + 'Lock this phone</button>' +
    '<p class="xs muted">Lock forgets the passcode here, so the next visit asks for it again.</p>';
}

/* --------------------------------------------------------- log activity */
const KIND_LABEL = [['call', 'Call'], ['email', 'Email'], ['dropin', 'Drop-in'], ['note', 'Note']];
function openLog(contactId, kind) {
  const m = S.model;
  const c = contactId ? m.byId.get(contactId) : (S.tab === 'contact' ? m.byId.get(S.contactId) : null);
  S.log = { contactId: c ? c.id : null, kind: kind || 'call', round: null, outcome: null, next: null, day: null, note: '', nextText: null, author: store.get(AUTHOR_KEY), pick: '', saving: false, error: '' };
  resetNext();
  openSheet('log');
}
function logContact() { return S.log && S.log.contactId ? S.model.byId.get(S.log.contactId) : null; }
function logRound() { const L = S.log; return L.kind === 'note' ? null : (L.round || M.roundFor(logContact(), L.kind)); }
function resetNext() {
  const L = S.log;
  const c = logContact();
  L.choices = M.nextChoices(c, L.kind, logRound(), L.outcome);
  // Preselect the obvious next step, except for a contact marked "do not contact further".
  L.next = L.choices.length && !(c && c.stage && c.stage.stop) ? L.choices[0].key : null;
  L.nextText = null;
}
function currentPlan() {
  const L = S.log;
  return M.logPlan(logContact(), { kind: L.kind, round: logRound(), outcome: L.outcome, next: L.next, choices: L.choices, day: L.day, author: (L.author || '').trim() }, S.model.today);
}
function logSheetHtml() {
  const L = S.log;
  const m = S.model;
  const c = logContact();
  const head = '<div class="grab" aria-hidden="true"></div><div class="row-sb" style="align-items:flex-start"><div style="min-width:0"><h1 id="sheet-h" style="font-size:22px;font-weight:800">Log activity</h1><p class="small muted" style="margin-top:2px;font-size:13px">' +
    esc(c ? c.name + ' · ' + c.office : 'Pick a contact') + '</p></div><button class="close" data-act="close" aria-label="Close">' + ic('x') + '</button></div>';
  if (!c) {
    const q = L.pick.trim();
    const res = q.length >= 2 ? M.search(m, q).people : m.people.slice().sort((a, b) => (a.sinceEdit == null ? 999 : a.sinceEdit) - (b.sinceEdit == null ? 999 : b.sinceEdit)).slice(0, 8);
    return head + '<div class="search small"><label for="log-pick" class="sr">Search contacts</label>' + ic('search', 18) + '<input id="log-pick" type="search" data-input="logpick" autocomplete="off" placeholder="Search a name or office" value="' + esc(L.pick) + '"></div>' +
      '<p class="legend2" style="margin:0">' + (q.length >= 2 ? 'Matches' : 'Recently updated') + '</p>' +
      '<div class="rows" id="log-pick-list">' + (res.length ? res.map((x) => '<button class="row" data-act="logpick" data-id="' + esc(x.id) + '">' + letterBadge(x) + '<span class="grow"><span class="t">' + esc(x.name) + '</span><span class="s">' + esc(x.office) + '</span></span></button>').join('') : '<p class="small muted" style="padding:8px 0">No contact matches.</p>') + '</div>';
  }
  const plan = currentPlan();
  const round = plan.round;
  const outs = M.OUTCOMES[L.kind];
  const dates = M.dateChoices(m.today);
  const nextTxt = L.nextText != null ? L.nextText : plan.nextStep;
  const props = [];
  if (plan.nextStage && plan.nextStage !== c.nextStage) props.push('Next stage → ' + plan.nextStage);
  if (plan.dropIn && plan.dropIn !== c.dropIn) props.push('Drop-in status → ' + plan.dropIn);
  if (nextTxt.trim()) props.push('Next Steps → Next: ' + nextTxt.trim());
  const bodyTxt = [L.outcome ? L.outcome + '.' : '', L.note.trim()].filter(Boolean).join(' ');
  const author = (L.author || '').trim();
  const ready = !!author && !!(L.outcome || L.note.trim());
  const iso = L.day != null ? (() => { const p = M.dayParts(L.day); return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0'); })() : '';
  return head +
    '<fieldset><legend class="legend2">What happened</legend><div class="grid4">' + KIND_LABEL.map((k) => '<button class="chip" style="justify-content:center;padding:0;border-radius:14px" aria-pressed="' + (L.kind === k[0]) + '" data-act="logkind" data-v="' + k[0] + '">' + k[1] + '</button>').join('') + '</div>' +
    (round ? '<div class="row-sb" style="margin-top:8px"><p class="small muted">Counts as <b style="color:#FFFFFF">' + esc(plan.label) + '</b></p><div role="group" aria-label="Cadence round" style="display:flex;gap:4px">' + [1, 2, 3].map((r) => '<button class="chip soft" style="height:34px;padding:0 10px;font-size:12px" aria-pressed="' + (round === r) + '" data-act="loground" data-v="' + r + '">v' + r + '</button>').join('') + '</div></div>' : '<p class="small muted" style="margin-top:8px">A note is logged without a cadence step.</p>') +
    '</fieldset>' +
    (outs.length ? '<fieldset><legend class="legend2">Outcome</legend><div class="chips">' + outs.map((o) => '<button class="chip soft" aria-pressed="' + (L.outcome === o) + '" data-act="logout" data-v="' + esc(o) + '">' + esc(o) + '</button>').join('') + '</div></fieldset>' : '') +
    '<fieldset><legend class="legend2">Next step</legend><div class="chips">' + L.choices.map((x) => '<button class="chip" aria-pressed="' + (L.next === x.key) + '" data-act="lognext" data-v="' + x.key + '">' + esc(x.label) + '</button>').join('') + '</div>' +
      '<div class="chips" style="margin-top:8px">' + dates.map((d) => '<button class="chip soft" aria-pressed="' + (L.day === d.day) + '" data-act="logday" data-v="' + d.day + '">' + esc(M.fmtDay(d.day)) + '</button>').join('') +
      '<label class="sr" for="log-date">Pick a date</label><input class="field" id="log-date" type="date" data-input="logdate" value="' + esc(iso) + '" style="width:auto;flex:1;min-width:140px"></div>' +
      '<label class="sr" for="log-next">Next step text</label><input class="field" id="log-next" data-input="lognexttext" maxlength="300" placeholder="Next step (optional)" style="margin-top:8px" value="' + esc(nextTxt) + '"></fieldset>' +
    '<div><label class="legend2" for="log-note" style="display:block">Note</label><textarea class="field" id="log-note" data-input="lognote" rows="3" maxlength="1800" placeholder="What was said, who you saw, anything to remember">' + esc(L.note) + '</textarea></div>' +
    (store.get(AUTHOR_KEY) && L.author === store.get(AUTHOR_KEY) && !L.editAuthor ? '<p class="xs muted">Logged by <b style="color:#FFFFFF">' + esc(author) + '</b> · <button data-act="logauthoredit" class="xs" style="color:#A9DAFF;font-weight:700;text-decoration:underline;min-height:32px">change</button></p>'
      : '<div><label class="legend2" for="log-author" style="display:block">Your name, as it appears in the log</label><input class="field" id="log-author" data-input="logauthor" autocomplete="name" maxlength="40" placeholder="e.g. Saini" value="' + esc(L.author || '') + '"></div>') +
    '<div class="preview" id="log-preview">' + previewHtml(plan, bodyTxt, nextTxt, props) + '</div>' +
    (L.error ? '<p class="err" role="alert">' + esc(L.error) + '</p>' : '') +
    '<button class="btn primary big wide" data-act="logsave"' + (ready && !L.saving ? '' : ' disabled') + '>' + (L.saving ? 'Saving to Notion…' : 'Save to Notion') + '</button>';
}
function previewHtml(plan, bodyTxt, nextTxt, props) {
  return '<span class="legend2" style="margin:0">Writes to Notion</span><p style="margin-top:3px"><b>Log:</b> ' + esc(plan.heading) + '. ' + esc(bodyTxt || '…') + (nextTxt.trim() ? ' Next step: ' + esc(nextTxt.trim()) + '.' : '') + '</p>' +
    props.map((p) => '<p class="muted">' + esc(p) + '</p>').join('');
}
function refreshPreview() {
  const L = S.log;
  const c = logContact();
  const el = $('log-preview');
  if (!c || !el) return;
  const plan = currentPlan();
  const nextTxt = L.nextText != null ? L.nextText : plan.nextStep;
  const props = [];
  if (plan.nextStage && plan.nextStage !== c.nextStage) props.push('Next stage → ' + plan.nextStage);
  if (plan.dropIn && plan.dropIn !== c.dropIn) props.push('Drop-in status → ' + plan.dropIn);
  if (nextTxt.trim()) props.push('Next Steps → Next: ' + nextTxt.trim());
  const bodyTxt = [L.outcome ? L.outcome + '.' : '', L.note.trim()].filter(Boolean).join(' ');
  el.innerHTML = previewHtml(plan, bodyTxt, nextTxt, props);
  const save = document.querySelector('[data-act="logsave"]');
  if (save) save.disabled = L.saving || !((L.author || '').trim() && (L.outcome || L.note.trim()));
}
async function saveLog() {
  const L = S.log;
  const c = logContact();
  if (!c || L.saving) return;
  const plan = currentPlan();
  const nextTxt = (L.nextText != null ? L.nextText : plan.nextStep).trim();
  const author = (L.author || '').trim();
  L.saving = true; L.error = '';
  renderSheet();
  try {
    const out = await api('/log', { method: 'POST', body: {
      contactId: c.id, kind: L.kind, round: plan.round, author, outcome: L.outcome || '', note: L.note.trim(),
      nextStep: nextTxt, nextStage: plan.nextStage && plan.nextStage !== c.nextStage ? plan.nextStage : '', dropIn: plan.dropIn && plan.dropIn !== c.dropIn ? plan.dropIn : ''
    } });
    store.set(AUTHOR_KEY, author);
    // Show it straight away; the next refresh reads it back from Notion.
    const fc = S.feed.contacts.find((x) => x.id === c.id);
    if (fc) {
      if (out.set && out.set.nextStage && out.updated) fc.nextStage = out.set.nextStage;
      if (out.set && out.set.dropIn && out.updated) fc.dropIn = out.set.dropIn;
      if (out.set && out.set.nextSteps && out.updated) fc.nextSteps = out.set.nextSteps;
      fc.edited = new Date().toISOString();
    }
    const tl = S.timelines.get(c.id);
    if (tl && tl.state === 'ok') {
      const p = M.dayParts(S.model.today);
      tl.data.entries.unshift({ kind: 'log', date: p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0'),
        label: plan.label, author, lines: out.paragraphs || [bodyText(L)], nextStep: out.nextLine ? out.nextLine.replace(/^Next step:\s*/, '') : (nextTxt || null) });
    }
    S.model = M.buildModel(S.feed, new Date());
    closeSheet();
    render();
    toast(out.propsFailed ? 'Logged. The stage didn’t update: set it in Notion.' : out.position === 'end' ? 'Saved to Notion, at the end of the page.' : 'Saved to Notion.');
  } catch (e) {
    L.saving = false;
    if (e.kind === 'auth') { closeSheet(); lockOut('Your passcode was changed. Enter the new one.'); return; }
    L.error = e.kind === 'invalid' ? 'Notion wouldn’t take that: check ' + ((e.body && e.body.fields) || []).join(', ') + '.'
      : e.kind === 'rate' ? 'Too many saves in a few minutes. Wait a little and try again.'
      : e.kind === 'notfound' ? 'That contact isn’t in pmleads_db any more.'
      : 'Couldn’t confirm the save. Check the contact’s page in Notion before you try again.';
    renderSheet();
  }
}
const bodyText = (L) => [L.outcome ? L.outcome + '.' : '', L.note.trim()].filter(Boolean).join(' ');

/* ================================================================ data */
function err(kind) { const e = new Error(kind); e.kind = kind; return e; }
async function api(path, opt) {
  const o = opt || {};
  let res;
  try {
    res = await fetch(API + path, {
      method: o.method || 'GET',
      headers: Object.assign({ 'x-dashboard-code': S.code }, o.body ? { 'Content-Type': 'application/json' } : {}),
      body: o.body ? JSON.stringify(o.body) : undefined,
      cache: 'no-store', credentials: 'omit'
    });
  } catch (e) { throw err('net'); }
  if (res.status === 401) throw err('auth');
  if (res.status === 429) throw err('rate');
  let json = null;
  try { json = await res.json(); } catch (e) { /* not json */ }
  if (!res.ok) { const x = err(res.status === 404 ? 'notfound' : res.status === 400 ? 'invalid' : 'net'); x.body = json; throw x; }
  if (!json) throw err('net');
  return json;
}
async function loadTimeline(id) {
  S.timelines.set(id, { state: 'loading' });
  try {
    const data = await api('/contact/' + encodeURIComponent(id));
    S.timelines.set(id, { state: 'ok', data });
  } catch (e) {
    if (e.kind === 'auth') { lockOut(GATE_MSG.auth); return; }
    S.timelines.set(id, { state: 'error', msg: e.kind === 'rate' ? 'Too many requests. Wait a minute, then try again.' : e.kind === 'notfound' ? 'This page isn’t a pmleads_db contact any more.' : 'Couldn’t read the Notion page.' });
  }
  if (S.tab === 'contact' && S.contactId === id && !S.sheet) render();
}

/* ------------------------------------------------------------- gate */
const GATE_MSG = {
  auth: 'That passcode isn’t right. Check it and try again.',
  rate: 'Too many attempts. Wait 15 minutes and try again.',
  net: 'Couldn’t reach Notion. Check your connection and try again.',
  notfound: 'The field CRM service isn’t live yet. Use the classic dashboard for now.'
};
function show(which) {
  $('gate').hidden = which !== 'gate';
  $('boot').hidden = which !== 'boot';
  $('app').hidden = which !== 'app';
}
function showGate(msg) {
  show('gate');
  const code = $('code');
  $('gate-err').textContent = msg || '';
  code.classList.toggle('bad', !!msg);
  code.value = '';
  $('gate-go').disabled = true;
}
function lockOut(msg) {
  store.del(STORE_KEY);
  S.code = ''; S.feed = null; S.model = null; S.timelines.clear();
  if (S.sheet) closeSheet();
  showGate(msg || '');
}
async function load(code, opts) {
  const o = opts || {};
  S.code = code;
  const data = await api('/app');
  S.feed = data;
  S.model = M.buildModel(data, new Date());
  S.loadedAt = Date.now();
  store.set(STORE_KEY, code);
  $('banner').hidden = true;
  show('app');
  render(o.keep ? {} : { top: true });
}
function banner(msg) {
  const b = $('banner');
  b.innerHTML = '<span>' + esc(msg) + '</span><button class="btn ghost" style="height:36px;flex-shrink:0" data-act="refresh">' + ic('refresh', 16) + 'Retry</button>';
  b.hidden = false;
}
async function refresh() {
  if (!S.code) return;
  try {
    await load(S.code, { keep: true });
    S.timelines.clear();
    if (S.tab === 'contact' && S.contactId) render();
    toast('Up to date with Notion.');
  } catch (e) {
    if (e.kind === 'auth') { lockOut(GATE_MSG.auth); return; }
    banner(e.kind === 'rate' ? 'Too many requests. Wait a few minutes.' : 'Couldn’t reach Notion. Showing the data ' + (syncedLabel() || 'loaded earlier') + '.');
  }
}
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 3200);
}

/* ============================================================== events */
const ACTS = {
  nav: (d) => navTo(d.tab),
  sub: (d) => swap(d.tab),
  back: () => back(),
  smart: (d) => {
    const k = d.key;
    if (k.indexOf('q:') === 0) return push('quotes', { qf: k.slice(2) });
    if (k === 'cash:overdue') { const items = S.model.revenue.cash.overdue.items; return items.length === 1 ? push('order', { orderId: items[0].id }) : push('rev'); }
    if (k === 'cash:paused') return push('rev');
    push('list', { list: k });
  },
  contact: (d) => { if (d.id) push('contact', { contactId: d.id }); },
  order: (d) => { if (d.id) push('order', { orderId: d.id }); },
  quotes: (d) => push('quotes', { qf: d.qf || 'open' }),
  qf: (d) => swap('quotes', { qf: d.v }),
  office: (d) => push('offices', { officeQuery: d.name, officeStatus: 'all' }),
  stage: (d) => { S.stage = d.v; render(); },
  ostatus: (d) => { S.officeStatus = d.v; render(); },
  ms: (d) => { S.ms = +d.v; render(); },
  gst: (d) => { S.gst = d.v === '1'; render(); },
  snap: (d) => { const n = S.model.momentum ? S.model.momentum.rows.length : 0; const cur = S.snap == null ? n - 1 : S.snap; S.snap = Math.max(0, Math.min(n - 1, cur + (+d.d))); render(); },
  snappick: (d, el, e) => {
    const mo = S.model.momentum;
    if (!mo || !mo.rows.length) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const x0 = mo.rows[0].day, x1 = mo.rows[mo.rows.length - 1].day;
    const day = x0 + f * (x1 - x0);
    let best = 0;
    mo.rows.forEach((row, i) => { if (Math.abs(row.day - day) < Math.abs(mo.rows[best].day - day)) best = i; });
    S.snap = best; render();
  },
  mapfilter: (d) => { S.mapFilter = S.mapFilter === d.v ? null : d.v; render(); },
  areajump: (d) => { const el = $('area-' + d.area.replace(/[^a-z]/gi, '').toLowerCase()); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  run: (d) => { S.skip = new Set(); push('run', { area: d.area }); },
  skip: (d) => { if (S.skip.has(d.name)) S.skip.delete(d.name); else S.skip.add(d.name); render(); },
  tlretry: (d) => { S.timelines.delete(d.id); render(); },
  log: (d) => openLog(d.id || null, d.kind || null),
  account: () => { if (S.sheet) { S.sheet = 'account'; renderSheet(true); } else openSheet('account'); },
  close: () => closeSheet(),
  scrim: (d, el, e) => { if (e.target === el) closeSheet(); },
  refresh: () => { if (S.sheet) closeSheet(); refresh(); },
  lock: () => { lockOut(''); $('code').focus(); },
  logpick: (d) => { S.log.contactId = d.id; S.log.round = null; S.log.outcome = null; resetNext(); renderSheet(); },
  logkind: (d) => { const L = S.log; L.kind = d.v; L.round = null; L.outcome = null; resetNext(); renderSheet(); },
  loground: (d) => { const L = S.log; L.round = +d.v; resetNext(); renderSheet(); },
  logout: (d) => { const L = S.log; L.outcome = L.outcome === d.v ? null : d.v; resetNext(); renderSheet(); },
  lognext: (d) => { const L = S.log; L.next = L.next === d.v ? null : d.v; L.nextText = null; renderSheet(); },
  logday: (d) => { const L = S.log; L.day = L.day === +d.v ? null : +d.v; L.nextText = null; renderSheet(); },
  logauthoredit: () => { S.log.editAuthor = true; S.focus = 'log-author'; renderSheet(); },
  logsave: () => saveLog()
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
  const fn = ACTS[el.dataset.act];
  if (!fn) return;
  if (el.dataset.act === 'scrim' && e.target !== el) return;
  e.preventDefault();
  fn(el.dataset, el, e);
});
document.addEventListener('input', (e) => {
  const el = e.target;
  const k = el.dataset && el.dataset.input;
  if (!k) return;
  const v = el.value;
  if (k === 'find') {
    S.q = v;
    const on = v.trim().length >= 2;
    $('find-results').innerHTML = on ? searchHtml() : '';
    $('overview-body').hidden = on;
  } else if (k === 'office') { S.officeQuery = v; $('office-list').innerHTML = officeGroupsHtml(); }
  else if (k === 'map') { S.mapQuery = v; $('map-list').innerHTML = mapListHtml(); }
  else if (k === 'author') { store.set(AUTHOR_KEY, v.trim()); }
  else if (k === 'logpick') { S.log.pick = v; S.focus = 'log-pick'; renderSheet(); }
  else if (k === 'lognote') { S.log.note = v; refreshPreview(); }
  else if (k === 'lognexttext') { S.log.nextText = v; refreshPreview(); }
  else if (k === 'logauthor') { S.log.author = v; refreshPreview(); }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.input === 'logdate') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(el.value);
    S.log.day = m ? M.dayNum(+m[1], +m[2], +m[3]) : null;
    S.log.nextText = null;
    renderSheet();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.sheet) closeSheet();
  if (e.key === 'Enter' && e.target && e.target.id === 'find') e.target.blur();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.model && !S.sheet && Date.now() - S.loadedAt > STALE_MS) refresh();
});

/* gate form */
const codeEl = $('code');
codeEl.addEventListener('input', () => {
  codeEl.value = codeEl.value.replace(/\D/g, '').slice(0, 6);
  codeEl.classList.remove('bad');
  $('gate-err').textContent = '';
  $('gate-go').disabled = codeEl.value.length !== 6;
});
$('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = codeEl.value;
  if (code.length !== 6) return;
  $('gate-go').disabled = true;
  $('gate-err').textContent = '';
  try {
    await load(code);
  } catch (x) {
    const kind = x.kind || 'net';
    if (kind === 'auth') store.del(STORE_KEY);
    codeEl.classList.add('bad');
    $('gate-err').textContent = GATE_MSG[kind] || GATE_MSG.net;
    codeEl.value = '';
    codeEl.focus();
  }
});

/* first load: a remembered code is tried straight away */
(async function start() {
  const code = store.get(STORE_KEY);
  if (!code) { showGate(''); return; }
  show('boot');
  try {
    await load(code);
  } catch (e) {
    if (e.kind === 'auth') store.del(STORE_KEY);
    showGate(GATE_MSG[e.kind] || GATE_MSG.net);
  }
})();
