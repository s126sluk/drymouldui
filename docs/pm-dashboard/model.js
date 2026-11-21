/* DrySafe field CRM — the view model.
   Pure functions only: no DOM, no network, no clock reads beyond the `now` passed in.
   Input is the feed from GET /api/cp1/pm/dashboard/app; output is everything the screens show.
   Tested in node by test/pm-dashboard/model.test.mjs. */

export const TZ = 'Australia/Sydney';
export const GST = 1.1;
const DAY = 864e5;

/* ------------------------------------------------------------------ dates */
// Everything is a Sydney calendar day number (days since 1970-01-01 of that calendar date).
const PARTS = new Intl.DateTimeFormat('en-AU', {
  timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
});
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function sydParts(date) {
  const o = {};
  for (const p of PARTS.formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: (+o.hour) % 24, min: +o.minute };
}
export const dayNum = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / DAY);
export function dayParts(n) {
  const dt = new Date(n * DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
}
/** A Notion date ("2026-11-19") or timestamp → Sydney day number, or null. */
export function toDay(v) {
  if (!v) return null;
  const s = String(v);
  const only = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (only) return dayNum(+only[1], +only[2], +only[3]);
  const t = new Date(s);
  if (isNaN(t.getTime())) return null;
  const p = sydParts(t);
  return dayNum(p.y, p.m, p.d);
}
export function toTime(v) {
  if (!v) return null;
  const t = new Date(String(v));
  return isNaN(t.getTime()) ? null : t.getTime();
}
/** "Thu 19 Nov" (adds the year when it is not `thisYear`). */
export function fmtDay(n, thisYear) {
  if (n == null) return '';
  const p = dayParts(n);
  return WD[p.wd] + ' ' + p.d + ' ' + MON[p.m - 1] + (thisYear && p.y !== thisYear ? ' ' + p.y : '');
}
export const fmtDayShort = (n) => { if (n == null) return ''; const p = dayParts(n); return p.d + ' ' + MON[p.m - 1]; };
export function fmtTime(v) {
  const t = toTime(v);
  if (t == null) return '';
  const p = sydParts(new Date(t));
  return String(p.h).padStart(2, '0') + ':' + String(p.min).padStart(2, '0');
}
const monthKey = (n) => { const p = dayParts(n); return p.y * 12 + (p.m - 1); };
const monthOf = (k) => ({ y: Math.floor(k / 12), m: (k % 12) + 1 });
/** Monday of the week containing day n. */
export const weekStart = (n) => n - ((dayParts(n).wd + 6) % 7);

/* -------------------------------------------------------------- formatting */
export function money(v, dp) {
  if (v == null || !isFinite(v)) return '';
  const d = dp == null ? 2 : dp;
  const s = (Math.round(v * 100) / 100).toFixed(d);
  const p = s.split('.');
  return '$' + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (p[1] ? '.' + p[1] : '');
}
/** $2,122.20 → "$2,122"; keeps cents only when they matter ($424.44 → "$424"). */
export const money0 = (v) => money(Math.round(v || 0), 0);
export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
export const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const r2 = (v) => Math.round(v * 100) / 100;
const sum = (a, f) => r2(a.reduce((s, x) => s + (f ? f(x) : x), 0));
export function hoursLabel(h) {
  if (h == null) return '';
  if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min';
  if (h < 48) return (Math.round(h * 10) / 10) + ' h';
  return (Math.round((h / 24) * 10) / 10) + ' days';
}
export function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
export function ago(days) {
  if (days == null) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days + ' days ago';
}

/* ------------------------------------------------------------ contact name */
const HANDLES = new Set(['info', 'sales', 'reception', 'pm', 'admin', 'accounts', 'rentals', 'leasing', 'office',
  'property management', 'property management team', 'enquiries', 'team']);

/** "Nick Ikon - Forsyth (Director of …)" → { display: 'Nick Ikon', role: 'Director of …', issue: null }. */
export function parseTitle(raw, agency) {
  const title = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!title) return { display: '', role: null, issue: 'blank' };
  if (/^duplicate\b/i.test(title)) {
    const m = /\(([^)]*)\)/.exec(title);
    const who = m ? m[1].replace(/,?\s*see\b.*$/i, '').trim() : '';
    return { display: who || title, role: null, issue: 'duplicate' };
  }
  let name = title;
  let role = null;
  const dash = title.indexOf(' - ');
  if (dash > 0) {
    name = title.slice(0, dash).trim();
    let rest = title.slice(dash + 3).trim();
    if (agency && rest.toLowerCase().indexOf(agency.toLowerCase()) === 0) rest = rest.slice(agency.length).trim();
    rest = rest.replace(/^\((.*)\)$/, '$1').trim();
    if (rest) role = rest;
  } else {
    const comma = title.indexOf(', ');
    if (comma > 0 && comma <= 40) { name = title.slice(0, comma).trim(); role = title.slice(comma + 2).trim() || null; }
  }
  let issue = null;
  if (name.length > 40 || /\.\s/.test(name)) {
    issue = 'note';
    name = name.split(/\s*[(.]/)[0].trim() || name.slice(0, 40);
  } else if (HANDLES.has(name.toLowerCase()) || /@/.test(name) || (!/\s/.test(name) && name === name.toLowerCase())) {
    issue = 'handle';
  }
  return { display: name, role, issue };
}
export function initials(name) {
  const w = String(name || '').replace(/\(.*?\)/g, ' ').split(/\s+/).filter((x) => /^[A-Za-z]/.test(x));
  if (!w.length) return '•';
  return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}
export const firstName = (name) => (String(name || '').split(/\s+/)[0] || '').replace(/[^\p{L}'’-]/gu, '') || String(name || '');

/* ------------------------------------------------------------------ phones */
export function phoneInfo(raw) {
  const s = String(raw || '').trim();
  if (!s) return { raw: '', tel: '', kind: 'none' };
  const digits = s.replace(/[^\d+]/g, '');
  const local = digits.replace(/^\+?61/, '0');
  const kind = /^04\d{8}$/.test(local) ? 'mobile' : (/^0[2378]\d{8}$/.test(local) ? 'landline' : 'other');
  return { raw: s, tel: digits, kind };
}

/* -------------------------------------------------------- next-steps dates */
const MONTH_IDX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DATE_RE = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?(?:,?\s+(\d{4}))?/gi;

/**
 * Every date written in a Next Steps note ("call back Mon 23 Nov", "by around 26 Nov 2026").
 * A date with no year takes the year that puts it closest to `ref` (the day the note was last
 * edited), so "5 Jan" written in December means next January.
 */
export function datesIn(text, ref) {
  const out = [];
  if (!text) return out;
  const refY = dayParts(ref).y;
  DATE_RE.lastIndex = 0;
  let m;
  while ((m = DATE_RE.exec(String(text)))) {
    const d = +m[1];
    const mo = MONTH_IDX[m[2].slice(0, 3).toLowerCase()];
    if (!mo || d < 1 || d > 31) continue;
    if (m[3]) { out.push(dayNum(+m[3], mo, d)); continue; }
    let best = null;
    for (const y of [refY - 1, refY, refY + 1]) {
      const n = dayNum(y, mo, d);
      if (best == null || Math.abs(n - ref) < Math.abs(best - ref)) best = n;
    }
    out.push(best);
  }
  return out;
}

/* ----------------------------------------------------------------- cadence */
export const STAGE_KINDS = ['drop-in', 'email', 'call'];
/** "drop-in v2" → { kind: 'drop-in', step: 0, round: 2 }; "do not contact further" → { stop: true }. */
export function parseStage(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t || t === 'select') return null;
  if (t === 'do not contact further') return { stop: true };
  const m = /^(drop-in|email|call) v([123])$/.exec(t);
  return m ? { kind: m[1], step: STAGE_KINDS.indexOf(m[1]), round: +m[2] } : null;
}
/** "package @ reception v1" → { state: 'reception', round: 1 }; "delivered to contact v2" → { state: 'met', round: 2 }. */
export function parseDropIn(s) {
  const t = String(s || '').trim().toLowerCase();
  const m = /^(package @ reception|delivered to contact) v([123])$/.exec(t);
  if (!m) return null;
  return { state: m[1] === 'delivered to contact' ? 'met' : 'reception', round: +m[2] };
}
/**
 * The 3 rounds × (drop-in, email, call) grid: 'done' | 'tried' | 'todo'.
 * The next stage to complete says everything before it is done; the drop-in status then says
 * whether each round's drop-in met the contact ('done') or only reached reception ('tried').
 */
export function cadenceCells(stage, drop) {
  const cells = [0, 1, 2].map(() => ['todo', 'todo', 'todo']);
  if (stage && !stage.stop) {
    const upto = (stage.round - 1) * 3 + stage.step;
    for (let i = 0; i < upto; i++) cells[Math.floor(i / 3)][i % 3] = 'done';
  }
  if (drop) {
    for (let r = 0; r < drop.round - 1; r++) if (cells[r][0] === 'todo') cells[r][0] = 'done';
    cells[drop.round - 1][0] = drop.state === 'met' ? 'done' : 'tried';
  }
  return cells;
}
export function roundSummary(cells, r) {
  const row = cells[r];
  if (row.every((c) => c === 'done')) return 'complete';
  if (row.every((c) => c === 'todo')) return 'not started';
  return 'in progress';
}
const STAGE_LABEL = (s) => s.replace('drop-in', 'Drop-in').replace(/^email/, 'Email').replace(/^call/, 'Call');
export function stageLabel(s) {
  const p = parseStage(s);
  if (!p) return 'Not set';
  if (p.stop) return 'Do not contact';
  return STAGE_LABEL(p.kind + ' v' + p.round);
}

/* ------------------------------------------------------------------ regions */
// Area comes from words in the office name. Offices without one sit under "Area not recorded".
// Each list runs in a sensible driving order (south to north, east to west), which is also the
// order a run visits them in.
const AREAS = [
  ['Northern Beaches', ['manly', 'balgowlah', 'freshwater', 'curl curl', 'dee why', 'brookvale', 'frenchs forest', 'collaroy', 'narrabeen', 'warriewood', 'mona vale', 'newport', 'avalon', 'northern beaches']],
  ['North Shore', ['north sydney', 'neutral bay', 'crows nest', 'mosman', 'artarmon', 'lane cove', 'willoughby', 'north willoughby', 'chatswood', 'roseville', 'lindfield', 'killara', 'gordon', 'pymble', 'turramurra', 'st ives', 'wahroonga', 'hornsby', 'upper north shore', 'north shore']],
  ['Ryde & Macquarie Park', ['gladesville', 'ryde', 'macquarie park', 'eastwood', 'epping']],
  ['City & East', ['haymarket', 'sydney city', 'pyrmont', 'surry hills', 'redfern', 'zetland', 'mascot', 'paddington', 'double bay', 'bondi', 'randwick', 'kensington', 'coogee', 'maroubra']],
  ['Hills & West', ['lidcombe', 'auburn', 'merrylands', 'parramatta', 'westmead', 'wentworthville', 'toongabbie', 'seven hills', 'baulkham hills', 'castle hill', 'kellyville', 'rouse hill', 'blacktown', 'marayong', 'quakers hill', 'doonside', 'rooty hill', 'mount druitt', 'penrith']],
  ['Central Coast', ['gosford', 'erina', 'terrigal', 'bateau bay', 'the entrance', 'tuggerah', 'wyong']],
  ['Hunter', ['newcastle', 'maitland', 'raymond terrace']]
];
export const AREA_ORDER = AREAS.map((a) => a[0]).concat(['Area not recorded']);
const REGION_WORDS = new Set(['northern beaches', 'north shore', 'upper north shore', 'sydney city']);
// Longest first, so "north willoughby" wins over "willoughby" and "upper north shore" over "north shore".
const MATCHERS = AREAS.flatMap(([area, words]) => words.map((w, rank) => ({ area, w, rank, re: new RegExp('(^|[^a-z])' + w.replace(/ /g, '\\s+') + '([^a-z]|$)') })))
  .sort((a, b) => b.w.length - a.w.length);
export function areaOf(office) {
  const n = String(office || '').toLowerCase();
  for (const x of MATCHERS) {
    if (x.re.test(n)) {
      const place = x.w.replace(/\b[a-z]/g, (c) => c.toUpperCase());
      return { area: x.area, place: REGION_WORDS.has(x.w) ? null : place, rank: REGION_WORDS.has(x.w) ? 999 : x.rank };
    }
  }
  return { area: 'Area not recorded', place: null, rank: 999 };
}
/** The text handed to Google Maps for an office. */
export function mapsQuery(office) {
  const n = String(office || '').trim();
  const known = /real estate|realty|propert|agency|group|rental|advocacy|housing|ray white|belle|harcourts|mcgrath|century 21|laing|richardson|wrench|schwarz|novak/i.test(n);
  return n + (known ? '' : ' real estate') + ', NSW';
}

/* ================================================================== model */
export const NO_AGENCY = 'No agency recorded';
const ACTIVE = { lead: 1, warm: 1, partner: 1 };

export function buildModel(feed, now) {
  const nowT = (now || new Date()).getTime();
  const tp = sydParts(new Date(nowT));
  const today = dayNum(tp.y, tp.m, tp.d);
  const thisYear = tp.y;
  const validDays = feed.quoteValidDays || 21;
  const D = (n) => fmtDay(n, thisYear);

  /* ---------- contacts ---------- */
  const all = (feed.contacts || []).map((c) => {
    const t = parseTitle(c.name, c.agency);
    const stage = parseStage(c.nextStage);
    const drop = parseDropIn(c.dropIn);
    const edited = toDay(c.edited);
    const created = toDay(c.created);
    const dates = datesIn(c.nextSteps, edited != null ? edited : today);
    const nextDay = dates.length ? Math.max.apply(null, dates) : null;
    const phone = phoneInfo(c.mobile);
    const agencyKnown = !!c.agency && c.agency.toLowerCase() !== 'unverified';
    return {
      id: c.id, url: c.url, title: c.name || '', name: t.display || 'Untitled row', role: t.role, issue: t.issue,
      initials: initials(t.display), first: firstName(t.display),
      agency: c.agency || null, office: agencyKnown ? c.agency : NO_AGENCY, agencyKnown,
      status: ACTIVE[c.status] ? c.status : null,
      email: c.email || null, phone, nextStage: c.nextStage && c.nextStage !== 'select' ? c.nextStage : null,
      stage, drop, dropIn: c.dropIn || null, cells: cadenceCells(stage, drop),
      nextSteps: c.nextSteps || null, nextDay, overdue: nextDay != null && nextDay < today ? today - nextDay : 0,
      kitSynced: !!c.kitSynced, kitSyncedOn: toDay(c.kitSyncedOn), created, createdT: toTime(c.created), edited,
      sinceEdit: edited != null ? Math.max(0, today - edited) : null,
      requestIds: c.requestIds || [], test: !!c.test,
      quotes: [], orders: [], revenue: 0, lastRequest: null
    };
  });
  const byId = new Map(all.map((c) => [c.id, c]));
  const left = { test: 0, duplicate: 0, blank: 0 };
  for (const c of all) {
    if (c.test) left.test++;
    else if (c.issue === 'duplicate') left.duplicate++;
    else if (c.issue === 'blank') left.blank++;
  }
  // The people the app works with: real, named, not a duplicate awaiting deletion.
  const people = all.filter((c) => !c.test && c.issue !== 'duplicate' && c.issue !== 'blank');

  /* ---------- quotes (pmrequests_db) ---------- */
  const reqs = feed.requests || [];
  const tests = reqs.filter((r) => r.test).length;
  const quotes = reqs.filter((r) => !r.test).map((r) => {
    const reqDay = toDay(r.date) != null ? toDay(r.date) : toDay(r.created);
    const contact = (r.contactIds || []).map((id) => byId.get(id)).find(Boolean) || null;
    const approved = r.status === 'approved';
    const expires = reqDay != null ? reqDay + validDays : null;
    const daysLeft = expires != null ? expires - today : null;
    const state = approved ? 'approved' : (daysLeft != null && daysLeft > 0 ? 'open' : 'lapsed');
    const opt = r.option || null;
    const prices = r.prices || {};
    const ex = approved ? (r.price != null ? r.price : (opt && prices[opt] != null ? prices[opt] : 0)) : null;
    const sentT = toTime(r.reportSent) || toTime(r.created);
    const apprT = toTime(r.approvedAt);
    const apprDay = toDay(r.approvedAt) != null ? toDay(r.approvedAt) : (approved ? reqDay : null);
    const paid = !!r.paidAt || r.invoiceStatus === 'paid';
    const dueDay = toDay(r.invoiceDue);
    const overdueDays = approved && !paid && r.invoiceStatus === 'sent' && dueDay != null && dueDay < today ? today - dueDay : 0;
    const pmName = contact ? contact.name : (r.pmName || 'Unknown PM');
    return {
      id: r.id, ref: r.ref, url: r.url, state, approved, option: opt, rooms: r.rooms || 1, prices,
      ex, inc: ex != null ? r2(ex * GST) : null, upTo: prices.care != null ? prices.care : null,
      reqDay, reqT: toTime(r.created), sentT, sentDay: toDay(r.reportSent), deliveredDay: toDay(r.reportDelivered),
      delivered: !!(r.reportDelivered || (r.reportSent && !r.reportBounced)), bounced: !!r.reportBounced,
      opened: !!r.reportOpened, clicked: !!r.reportClicked,
      apprT, apprDay, hours: apprT && sentT ? Math.max(0, (apprT - sentT) / 36e5) : null,
      expires, daysLeft: state === 'open' ? daysLeft : null, lapsedDay: state === 'lapsed' ? expires : null,
      suburb: r.suburb || null, signs: r.signs || [], siteContact: r.siteContact || null,
      invoice: r.invoiceStatus || (r.hasInvoice ? 'sent' : null), dueDay, paid, paidDay: toDay(r.paidAt), overdueDays,
      hasJob: !!r.hasJob, contact, contactId: contact ? contact.id : null, pm: pmName, first: firstName(pmName),
      agency: contact && contact.agencyKnown ? contact.agency : NO_AGENCY
    };
  });
  for (const q of quotes) {
    if (!q.contact) continue;
    q.contact.quotes.push(q);
    if (q.approved) { q.contact.orders.push(q); q.contact.revenue = r2(q.contact.revenue + q.ex); }
    if (q.reqDay != null && (q.contact.lastRequest == null || q.reqDay > q.contact.lastRequest)) q.contact.lastRequest = q.reqDay;
  }
  const orders = quotes.filter((q) => q.approved).sort((a, b) => (b.apprT || 0) - (a.apprT || 0) || (b.apprDay || 0) - (a.apprDay || 0));
  const open = quotes.filter((q) => q.state === 'open').sort((a, b) => a.daysLeft - b.daysLeft);
  const lapsed = quotes.filter((q) => q.state === 'lapsed').sort((a, b) => b.lapsedDay - a.lapsedDay);

  /* ---------- pipeline ---------- */
  const pipeline = { lead: 0, warm: 0, partner: 0 };
  for (const c of people) if (c.status) pipeline[c.status]++;
  pipeline.total = pipeline.lead + pipeline.warm + pipeline.partner;
  const offices = new Set(people.filter((c) => c.agencyKnown).map((c) => c.agency));

  /* ---------- revenue ---------- */
  const revenue = buildRevenue({ quotes, orders, open, lapsed, today, thisYear, D });

  /* ---------- smart lists ---------- */
  const active = people.filter((c) => c.status && !(c.stage && c.stage.stop));
  const byOverdue = (a, b) => b.overdue - a.overdue;
  const bySince = (a, b) => (b.sinceEdit || 0) - (a.sinceEdit || 0);
  const overdueL = active.filter((c) => c.overdue > 0).sort(byOverdue);
  const dropped = people.filter((c) => c.drop);
  const reception = people.filter((c) => c.drop && c.drop.state === 'reception').sort(bySince);
  const met = people.filter((c) => c.drop && c.drop.state === 'met').sort(bySince);
  const quiet = people.filter((c) => c.status === 'partner' && (c.lastRequest == null || today - c.lastRequest >= 21))
    .sort((a, b) => (a.lastRequest || 0) - (b.lastRequest || 0));
  const noNext = people.filter((c) => (c.status === 'lead' || c.status === 'warm') && !c.nextStage && !c.nextSteps).sort(bySince);
  const missing = people.filter((c) => c.phone.kind !== 'mobile' || !c.email);
  const landlines = missing.filter((c) => c.phone.kind === 'landline').length;
  const dupes = duplicateEmails(people);
  const cleanup = all.filter((c) => !c.test && (c.issue === 'duplicate' || c.issue === 'blank' || c.issue === 'note' || c.issue === 'handle' || !c.agencyKnown || dupes.has(c.id)));
  const unverified = people.filter((c) => !c.agencyKnown).length;
  const firstExpiry = open.length ? open[0] : null;
  const overdueInv = revenue.cash.overdue.items;
  const paused = revenue.cash.paused;

  const lists = [
    { key: 'overdue', n: overdueL.length, label: 'Overdue follow-ups', sub: 'Next Steps date has passed', tone: 'alert', ids: overdueL.map((c) => c.id),
      note: 'Contacts whose Next Steps note mentions a date that has gone by. Most overdue first.' },
    { key: 'dropin', n: dropped.length, label: 'Drop-in recorded', sub: 'At ' + plural(new Set(dropped.map((c) => c.office)).size, 'office'), tone: 'lead', ids: dropped.sort(bySince).map((c) => c.id),
      note: 'Anyone with a drop-in status: a package at reception or delivered in person. Notion keeps no visit dates, so this is not limited to a time window.' },
    { key: 'reception', n: reception.length, label: 'Package at reception', sub: 'Not met yet: call next', tone: 'warm', ids: reception.map((c) => c.id),
      note: 'The package reached reception but not the contact. A call is the next touch.' },
    { key: 'met', n: met.length, label: 'Met in person', sub: 'Delivered to them at a drop-in', tone: 'partner', ids: met.map((c) => c.id),
      note: 'The package was handed to the contact in person.' },
    { key: 'q:open', n: open.length, label: 'Quotes open', sub: open.length ? 'Up to ' + money0(sum(open, (q) => q.upTo)) + ' · first expires ' + D(firstExpiry.expires) : 'None open right now', tone: 'partner' },
    { key: 'q:lapsed', n: lapsed.length, label: 'Lapsed quotes', sub: lapsed.length ? 'Up to ' + money0(sum(lapsed, (q) => q.upTo)) + ' walked away: revive' : 'None lapsed', tone: 'warm' },
    { key: 'cash:overdue', n: overdueInv.length, label: 'Invoice overdue', sub: overdueInv.length ? money(sum(overdueInv, (q) => q.inc)) + ' · ' + overdueInv[0].first + ', ' + plural(overdueInv[0].overdueDays, 'day') + ' late' : 'Nothing overdue', tone: 'alert' },
    { key: 'cash:paused', n: paused.items.length, label: 'Invoices paused', sub: paused.items.length ? money(paused.inc) + ' · waiting on the jobs' : 'None paused', tone: 'lead' },
    { key: 'quiet', n: quiet.length, label: 'Quiet partners', sub: 'No request in 21+ days', tone: 'lead', ids: quiet.map((c) => c.id),
      note: 'Partners whose last portal request was 21 or more days ago, or who have not sent one yet.' },
    { key: 'nonext', n: noNext.length, label: 'No next step', sub: 'Lead or warm, nothing planned', tone: 'alert', ids: noNext.map((c) => c.id),
      note: 'Leads and warm contacts with no next stage set and no Next Steps note.' },
    { key: 'missing', n: missing.length, label: 'Missing mobile or email', sub: landlines ? 'Incl. ' + plural(landlines, 'landline') + ' in “mob #”' : 'Fill these in Notion', tone: 'ink', ids: missing.map((c) => c.id),
      note: 'No mobile number or no email address on the contact. A landline in the “mob #” field counts as missing a mobile.' },
    { key: 'cleanup', n: cleanup.length, label: 'Clean-up', sub: cleanupSub(left, dupes.size, unverified, all), tone: 'ink', ids: cleanup.map((c) => c.id),
      note: 'Rows to tidy in Notion: duplicates, blank rows, a note or an inbox handle in the name field, and contacts with no verified agency.' }
  ];
  for (const l of lists) if (l.ids) l.people = l.ids.map((id) => byId.get(id));

  /* ---------- office groups (Contacts › Offices) ---------- */
  const officeGroups = buildOffices(people, quotes);

  /* ---------- areas (Map) ---------- */
  const areas = buildAreas(officeGroups);

  /* ---------- this week / coverage / momentum ---------- */
  const wk = weekStart(today);
  const moves = [];
  for (const c of people) if (c.created != null && c.created >= wk) moves.push({ day: c.created, t: c.createdT || 0, who: c.name, org: c.office, what: 'added to the CRM as ' + (c.status || 'no status'), id: c.id });
  for (const q of quotes) {
    if (q.reqDay != null && q.reqDay >= wk) moves.push({ day: q.reqDay, t: q.reqT || 0, who: q.pm, org: q.agency, what: 'quote requested · ' + plural(q.rooms, 'room') + ', ' + (q.suburb || 'suburb not recorded'), id: q.contactId });
    if (q.approved && q.apprDay != null && q.apprDay >= wk) moves.push({ day: q.apprDay, t: q.apprT || 0, who: q.pm, org: q.agency, what: 'approved ' + optName(q.option) + ' · ' + money(q.ex), id: q.contactId, order: q.id });
  }
  moves.sort((a, b) => b.day - a.day || b.t - a.t);

  const cov = new Map();
  for (const c of people) if (c.status) { const k = stageLabel(c.nextStage); cov.set(k, (cov.get(k) || 0) + 1); }
  const covOrder = ['Not set', 'Drop-in v1', 'Email v1', 'Call v1', 'Drop-in v2', 'Email v2', 'Call v2', 'Drop-in v3', 'Email v3', 'Call v3', 'Do not contact'];
  const covMax = Math.max(1, ...cov.values());
  const coverage = covOrder.filter((k) => cov.has(k)).map((k) => ({ k, n: cov.get(k), w: (cov.get(k) / covMax) * 100 }));

  return {
    today, thisYear, syncedAt: feed.syncedAt || null, D,
    all, people, byId, left, pipeline, offices: offices.size, lists, officeGroups, areas,
    quotes, orders, open, lapsed, tests, revenue,
    moves: moves.slice(0, 10), coverage, momentum: buildMomentum(feed.snapshots, pipeline, D)
  };
}

function cleanupSub(left, dupeEmails, unverified, all) {
  const parts = [];
  const d = left.duplicate + dupeEmails;
  if (d) parts.push(plural(d, 'duplicate'));
  if (left.blank) parts.push(left.blank + ' blank');
  const notes = all.filter((c) => !c.test && (c.issue === 'note' || c.issue === 'handle')).length;
  if (notes) parts.push(notes + ' name ' + (notes === 1 ? 'fix' : 'fixes'));
  if (unverified) parts.push(unverified + ' no agency');
  return parts.join(' · ') || 'Nothing to tidy';
}
function duplicateEmails(people) {
  const seen = new Map();
  const dup = new Set();
  for (const c of people) {
    const e = (c.email || '').trim().toLowerCase();
    if (!e) continue;
    if (seen.has(e)) { dup.add(c.id); dup.add(seen.get(e)); } else seen.set(e, c.id);
  }
  return dup;
}

export const OPT_NAME = { basic: 'Basic Savings', care: 'DrySafe Care', assessment: 'Assessment Only' };
export const optName = (k) => OPT_NAME[k] || 'Option not recorded';
export const OPT_KEYS = ['basic', 'care', 'assessment'];

function buildRevenue({ quotes, orders, open, lapsed, today, thisYear, D }) {
  const total = sum(orders, (o) => o.ex);
  const rooms = orders.reduce((s, o) => s + (o.rooms || 0), 0);
  const remed = orders.filter((o) => o.option !== 'assessment');
  const decided = orders.length + lapsed.length;
  const hrs = orders.map((o) => o.hours).filter((h) => h != null);
  const med = median(hrs);
  const firstDay = quotes.reduce((m, q) => (q.reqDay != null && (m == null || q.reqDay < m) ? q.reqDay : m), null);

  /* months, by approval date (Sydney) */
  const nowKey = monthKey(today);
  const startKey = firstDay != null ? Math.max(monthKey(firstDay), nowKey - 5) : nowKey;
  const months = [];
  for (let k = startKey; k <= nowKey; k++) {
    const { y, m } = monthOf(k);
    const row = { key: k, m: MON[m - 1], label: k === nowKey ? MONTH_LONG[m - 1] + ' to date' : MONTH_LONG[m - 1] + (y !== thisYear ? ' ' + y : ''), current: k === nowKey,
      basic: 0, care: 0, assessment: 0, other: 0, orders: 0, quotes: 0, rooms: 0 };
    months.push(row);
  }
  const mIdx = new Map(months.map((r, i) => [r.key, i]));
  for (const o of orders) {
    const i = mIdx.get(monthKey(o.apprDay != null ? o.apprDay : o.reqDay));
    if (i == null) continue;
    const row = months[i];
    row[OPT_KEYS.includes(o.option) ? o.option : 'other'] = r2(row[OPT_KEYS.includes(o.option) ? o.option : 'other'] + o.ex);
    row.orders++; row.rooms += o.rooms || 0;
  }
  for (const q of quotes) { const i = mIdx.get(monthKey(q.reqDay)); if (i != null) months[i].quotes++; }
  for (const row of months) row.total = r2(row.basic + row.care + row.assessment + row.other);
  const thisMonth = months.length ? months[months.length - 1] : null;

  /* cohorts by month requested */
  const cohorts = [];
  const cMap = new Map();
  for (const q of quotes.filter((x) => x.reqDay != null).sort((a, b) => a.reqDay - b.reqDay)) {
    const k = monthKey(q.reqDay);
    if (!cMap.has(k)) { const row = { key: k, m: MON[monthOf(k).m - 1], blocks: [], approved: 0, open: 0, lapsed: 0 }; cMap.set(k, row); cohorts.push(row); }
    const row = cMap.get(k);
    row.blocks.push(q.state);
    row[q.state]++;
  }

  /* option mix */
  const mix = OPT_KEYS.map((k) => {
    const os = orders.filter((o) => o.option === k);
    return { k, name: optName(k), n: os.length, v: sum(os, (o) => o.ex) };
  }).filter((x) => x.n);
  const mixMax = Math.max(1, ...mix.map((x) => x.v));

  /* speed */
  const speedDefs = [['Inside an hour', (h) => h < 1], ['Within a day', (h) => h >= 1 && h < 24], ['1 to 2 days', (h) => h >= 24 && h < 48], ['2 days or more', (h) => h >= 48]];
  const speed = speedDefs.map(([k, f]) => {
    const os = orders.filter((o) => o.hours != null && f(o.hours)).sort((a, b) => a.hours - b.hours);
    return { k, n: os.length, who: os.map((o) => o.first + ' ' + hoursLabel(o.hours)).join(' · ') };
  }).filter((s) => s.n);
  const speedMax = Math.max(1, ...speed.map((s) => s.n));

  /* cash */
  const overdue = orders.filter((o) => o.overdueDays > 0).sort((a, b) => b.overdueDays - a.overdueDays);
  const pausedItems = orders.filter((o) => !o.paid && o.invoice === 'paused').map((o) => ({ o, days: o.apprDay != null ? today - o.apprDay : null }))
    .sort((a, b) => (b.days || 0) - (a.days || 0));
  const paidItems = orders.filter((o) => o.paid);
  const sentNotDue = orders.filter((o) => !o.paid && o.invoice === 'sent' && !o.overdueDays);

  /* agencies */
  const agMap = new Map();
  for (const q of quotes) {
    const a = agMap.get(q.agency) || { name: q.agency, quotes: [], orders: [], v: 0, people: new Set(), last: null };
    a.quotes.push(q);
    a.people.add(q.pm);
    if (q.approved) { a.orders.push(q); a.v = r2(a.v + q.ex); }
    if (q.reqDay != null && (a.last == null || q.reqDay > a.last)) a.last = q.reqDay;
    agMap.set(q.agency, a);
  }
  const agencies = [...agMap.values()].map((a) => Object.assign(a, { people: [...a.people], quiet: a.last != null ? today - a.last : null }));
  const ranked = agencies.filter((a) => a.orders.length).sort((a, b) => b.v - a.v || b.orders.length - a.orders.length);
  const notYet = agencies.filter((a) => !a.orders.length).sort((a, b) => (b.last || 0) - (a.last || 0));
  const repeat = ranked.filter((a) => a.orders.length > 1).length;

  /* funnel */
  const n = quotes.length;
  const delivered = quotes.filter((q) => q.delivered).length;
  const bounced = quotes.filter((q) => q.bounced).length;
  const openedN = quotes.filter((q) => q.opened).length;
  const jobs = orders.filter((o) => o.hasJob).length;
  const invSent = orders.filter((o) => o.invoice && o.invoice !== 'paused').length;
  const pausedN = orders.filter((o) => o.invoice === 'paused').length;
  const paidN = paidItems.length;
  const funnel = [
    { label: 'Quote requested', n, v: String(n) },
    { label: 'Quote delivered by email', n: delivered, v: delivered + ' · ' + pctOf(delivered, n) + '%', sub: bounced ? plural(bounced, 'bounce') + ' recorded' : '' },
    openedN ? { label: 'Quote opened', n: openedN, v: openedN + ' · ' + pctOf(openedN, n) + '%' }
      : { label: 'Quote opened', n: 0, v: 'Not tracked', dashed: true, sub: 'The opened and clicked fields are empty. Tracking opens would show who to call first.', warn: true },
    { label: 'Approved by the PM', n: orders.length, v: orders.length + ' · ' + pctOf(orders.length, n) + '%', sub: [lapsed.length ? lapsed.length + ' lapsed after 21 days' : '', open.length ? open.length + ' still open' : ''].filter(Boolean).join(' · ') },
    { label: 'FieldSafe job created', n: jobs, v: jobs + ' · ' + pctOf(jobs, n) + '%' },
    { label: 'Invoice sent', n: invSent, v: invSent + ' · ' + pctOf(invSent, n) + '%', sub: pausedN ? pausedN + ' paused until the job is marked complete' : '' },
    { label: 'Paid (recorded)', n: paidN, v: String(paidN), sub: overdue.length ? overdue[0].first + '’s invoice is ' + plural(overdue[0].overdueDays, 'day') + ' past due' : (paidN ? '' : 'No paid dates in Notion yet'), alert: overdue.length > 0 }
  ];

  return {
    total, inc: r2(total * GST), rooms, count: orders.length, aov: orders.length ? total / orders.length : 0,
    aovRemed: remed.length ? sum(remed, (o) => o.ex) / remed.length : null,
    winRate: decided ? pctOf(orders.length, decided) : null, decided, median: med, fast: hrs.filter((h) => h < 1).length,
    firstDay, months, thisMonth, cohorts, mix, mixMax, speed, speedMax, funnel, n,
    inPlay: sum(open, (q) => q.upTo), walked: sum(lapsed, (q) => q.upTo),
    cash: {
      overdue: { items: overdue, inc: sum(overdue, (o) => o.inc) },
      paused: { items: pausedItems, inc: sum(pausedItems, (x) => x.o.inc) },
      sent: { items: sentNotDue, inc: sum(sentNotDue, (o) => o.inc) },
      paid: { items: paidItems, inc: sum(paidItems, (o) => o.inc) }
    },
    agencies, ranked, notYet, repeat,
    top2share: total && ranked.length >= 2 ? pctOf(ranked[0].v + ranked[1].v, total) : null
  };
}

function buildOffices(people, quotes) {
  const map = new Map();
  for (const c of people) {
    const g = map.get(c.office) || { name: c.office, known: c.office !== NO_AGENCY, people: [], quotes: [], v: 0, openQ: 0, upTo: 0, overdueInv: 0 };
    g.people.push(c);
    map.set(c.office, g);
  }
  for (const q of quotes) {
    const g = map.get(q.agency);
    if (!g) continue;
    g.quotes.push(q);
    if (q.approved) g.v = r2(g.v + q.ex);
    if (q.state === 'open') { g.openQ++; g.upTo = r2(g.upTo + (q.upTo || 0)); }
    if (q.overdueDays > 0) g.overdueInv++;
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.people.sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) || a.name.localeCompare(b.name));
    const n = { partner: 0, warm: 0, lead: 0, none: 0 };
    for (const c of g.people) n[c.status || 'none']++;
    g.mix = [n.partner ? n.partner + 'P' : '', n.warm ? n.warm + 'W' : '', n.lead ? n.lead + 'L' : '', n.none ? n.none + ' not set' : ''].filter(Boolean).join(' · ');
    g.partner = n.partner > 0;
    g.met = g.people.some((c) => c.drop && c.drop.state === 'met');
    g.reception = !g.met && g.people.some((c) => c.drop && c.drop.state === 'reception');
    g.dropState = g.met ? 'met' : (g.reception ? 'reception' : 'none');
    g.v2due = g.people.some((c) => c.stage && c.stage.kind === 'drop-in' && c.stage.round >= 2);
    g.last = Math.min(...g.people.map((c) => (c.sinceEdit == null ? 9999 : c.sinceEdit)));
    let a = areaOf(g.known ? g.name : '');
    g.placeFrom = a.place ? 'name' : null;
    if (g.known && !a.place) {
      // No suburb in the office name: fall back to where their quotes were for, and say so.
      const sub = g.quotes.map((q) => q.suburb).find((x) => x && areaOf(x).area !== 'Area not recorded' && (a.area === 'Area not recorded' || areaOf(x).area === a.area));
      if (sub) { const b = areaOf(sub); a = { area: b.area, place: sub, rank: b.rank }; g.placeFrom = 'quote'; }
    }
    g.area = g.known ? a.area : 'Area not recorded';
    g.place = g.known ? a.place : null;
    g.rank = g.known && a.place ? a.rank : 999;
  }
  return groups.sort((a, b) => (a.known === b.known ? a.name.localeCompare(b.name) : (a.known ? -1 : 1)));
}
const STATUS_RANK = { partner: 0, warm: 1, lead: 2 };

function buildAreas(groups) {
  const m = new Map(AREA_ORDER.map((a) => [a, []]));
  for (const g of groups) if (g.known) m.get(g.area).push(g);
  return AREA_ORDER.map((name) => {
    // Route order: known suburbs along the area's driving order, offices with no suburb last.
    const offices = m.get(name).sort((a, b) => a.rank - b.rank || (a.place || '').localeCompare(b.place || '') || a.name.localeCompare(b.name));
    return {
      name, offices,
      people: offices.reduce((s, g) => s + g.people.length, 0),
      noDrop: offices.filter((g) => g.dropState === 'none').length,
      partners: offices.filter((g) => g.partner).length,
      v2: offices.filter((g) => g.v2due).length
    };
  }).filter((a) => a.offices.length);
}

function buildMomentum(snaps, pipeline, D) {
  if (!Array.isArray(snaps)) return null;
  const rows = snaps.map((s) => ({ day: toDay(s.date), total: s.total, warm: s.warm, partners: s.partners }))
    .filter((s) => s.day != null && s.total != null).sort((a, b) => a.day - b.day);
  if (!rows.length) return { rows: [], empty: true };
  return { rows: rows.map((r) => Object.assign(r, { label: D(r.day) })), first: rows[0], last: rows[rows.length - 1], live: { total: pipeline.total, warm: pipeline.warm, partners: pipeline.partner } };
}

/* --------------------------------------------------------- log activity */
export const KIND_WORD = { call: 'phone call', email: 'email', dropin: 'drop-in', note: 'note' };
const KIND_STAGE = { call: 'call', email: 'email', dropin: 'drop-in' };
export const OUTCOMES = {
  call: ['Spoke with them', 'Voicemail', 'No answer', 'Spoke to reception'],
  email: ['Sent', 'They replied', 'Bounced'],
  dropin: ['Met them in person', 'Left at reception', 'Office closed'],
  note: []
};

/** The cadence round a touch of this kind counts towards, for this contact. */
export function roundFor(c, kind) {
  if (!c || kind === 'note') return null;
  const s = c.stage;
  if (s && !s.stop) {
    // The step that was due, or one already passed in this round → this round.
    // A step this round has not reached yet → a repeat of the previous round's step.
    return STAGE_KINDS.indexOf(KIND_STAGE[kind]) <= s.step ? s.round : Math.max(1, s.round - 1);
  }
  if (c.drop) return c.drop.round;
  return 1;
}

/** The stage after `kind vRound` in the cadence: drop-in → email → call → next round's drop-in. */
export function stageAfter(kind, round) {
  const i = STAGE_KINDS.indexOf(KIND_STAGE[kind]);
  if (i < 0 || !round) return null;
  if (i < 2) return STAGE_KINDS[i + 1] + ' v' + round;
  return round < 3 ? 'drop-in v' + (round + 1) : null;
}

/**
 * Next-step chips for the log sheet: [{ key, label, stage }] — `stage` is what next stage to
 * complete becomes; a chip whose stage equals the current one leaves the cadence where it is.
 * Only finishing the step that was due moves the cadence on, so an extra call never drags a
 * contact back to an earlier stage.
 */
export function nextChoices(c, kind, roundIn, outcome) {
  const kw = KIND_STAGE[kind];
  const round = roundIn || 1;
  const retry = kind !== 'note' && /no answer|voicemail|closed|bounced/i.test(outcome || '');
  const cur = c && c.nextStage ? c.nextStage : null;
  const stopped = !!(c && c.stage && c.stage.stop);
  const st = c && c.stage && !c.stage.stop ? c.stage : null;
  const isDue = !!(kw && st && st.kind === kw && st.round === round);
  const sameKind = !!(kw && st && st.kind === kw);
  const out = [];
  const add = (key, label, stage) => { if (stage && !out.some((x) => x.label === label)) out.push({ key, label, stage }); };
  const keep = () => { if (cur && !stopped) add('keep', STAGE_LABEL(cur), cur); };
  const here = cur && !stopped ? cur : (kw ? kw + ' v' + round : null);
  if (kw && retry) {
    add('again', kind === 'dropin' ? 'Drop in again' : (kind === 'email' ? 'Email again' : 'Call again'), sameKind ? kw + ' v' + round : here);
    if (!sameKind) keep();
  } else if (kw) {
    if (isDue || !st) { const after = stageAfter(kind, round); if (after) add('after', STAGE_LABEL(after), after); } else keep();
    if (kind === 'call') add('again', 'Call again', isDue ? kw + ' v' + round : here);
  } else keep();
  add('stop', 'Stop contacting', 'do not contact further');
  return out;
}

/** Date chips: tomorrow, next Monday (or the one after if today is Sunday), in a week. */
export function dateChoices(today) {
  const wd = dayParts(today).wd;
  const toMon = ((8 - wd) % 7) || 7;
  const list = [{ key: 'tomorrow', day: today + 1 }, { key: 'monday', day: today + toMon }, { key: 'week', day: today + 7 }];
  const seen = new Set();
  return list.filter((x) => (seen.has(x.day) ? false : seen.add(x.day)));
}

/** What the Notion write will be, for the preview and the POST body. */
export function logPlan(c, f, today) {
  const kind = f.kind;
  const round = kind === 'note' ? null : (f.round || roundFor(c, kind));
  const choice = (f.choices || []).find((x) => x.key === f.next) || null;
  const dayTxt = f.day != null ? fmtDay(f.day) : '';
  const nextStep = [choice ? choice.label.toLowerCase() : '', dayTxt].filter(Boolean).join(' ').trim();
  let dropIn = null;
  if (kind === 'dropin' && round) {
    if (/met them/i.test(f.outcome || '')) dropIn = 'delivered to contact v' + round;
    else if (/reception/i.test(f.outcome || '')) dropIn = 'package @ reception v' + round;
  }
  const label = KIND_WORD[kind] + (round ? ' v' + round : '');
  return {
    round, label, nextStep, nextStage: choice ? choice.stage : null, dropIn,
    heading: (today != null ? fmtDayShortYear(today) : '') + ', ' + label + ', ' + (f.author || 'your name')
  };
}
function fmtDayShortYear(n) { const p = dayParts(n); return p.d + ' ' + MON[p.m - 1] + ' ' + p.y; }

/* ------------------------------------------------------------- search */
export function search(model, q) {
  const s = String(q || '').trim().toLowerCase();
  if (s.length < 2) return { people: [], offices: [] };
  const words = s.split(/\s+/);
  const hit = (txt) => { const t = String(txt || '').toLowerCase(); return words.every((w) => t.includes(w)); };
  const people = model.people.filter((c) => hit([c.name, c.title, c.role, c.agency, c.nextSteps, c.email].join(' '))).slice(0, 30);
  const offices = model.officeGroups.filter((g) => g.known && hit(g.name + ' ' + (g.place || '') + ' ' + g.area)).slice(0, 10);
  return { people, offices };
}
