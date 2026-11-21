// Field CRM view model (docs/pm-dashboard/model.js). Synthetic data only.
// Run: node --test test/pm-dashboard/model.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../docs/pm-dashboard/model.js';

// Sat 21 Nov 2026, 5 pm in Sydney (AEDT, UTC+11).
const NOW = new Date('2026-11-21T06:00:00Z');
const day = (s) => M.toDay(s);

let n = 0;
const id = () => (++n).toString(16).padStart(32, '0');
const contact = (o = {}) => ({
  id: id(), name: 'Pat Example - Example Realty Dee Why (Property Manager)', status: 'warm', agency: 'Example Realty Dee Why',
  email: 'pat' + n + '@example.test', mobile: '0400 000 00' + (n % 10), nextStage: 'call v1', nextSteps: null,
  dropIn: 'delivered to contact v1', kitSynced: true, kitSyncedOn: '2026-10-01T00:00:00.000Z',
  created: '2026-10-01T00:00:00.000Z', edited: '2026-11-20T00:00:00.000Z', requestIds: [], test: false,
  url: 'https://www.notion.so/' + 'a'.repeat(32), ...o
});
const request = (o = {}) => ({
  id: id(), ref: 'DS-PM-' + n, date: '2026-11-11', created: '2026-11-11T04:00:00.000Z', status: 'submitted', option: null,
  price: null, rooms: 1, prices: { assessment: 99, basic: 377, care: 422 }, suburb: 'Dee Why', contactIds: [], pmName: null,
  signs: ['Visible mould'], siteContact: null, approvedAt: null, reportSent: '2026-11-11T04:00:00.000Z',
  reportDelivered: '2026-11-11T04:00:00.000Z', reportOpened: null, reportClicked: null, reportBounced: false,
  invoiceStatus: null, invoiceDue: null, paidAt: null, hasInvoice: false, hasJob: false, test: false, url: null, ...o
});

/* ------------------------------------------------------------- dates */

test('toDay reads Notion dates as Sydney calendar days', () => {
  assert.equal(M.fmtDay(day('2026-11-21')), 'Sat 21 Nov');
  // 20 Nov 23:30 UTC is already Saturday in Sydney
  assert.equal(M.fmtDay(day('2026-11-20T23:30:00Z')), 'Sat 21 Nov');
  assert.equal(day(null), null);
  assert.equal(day('not a date'), null);
});

test('datesIn finds every written date and picks the year nearest the note', () => {
  const ref = day('2026-11-20');
  assert.deepEqual(M.datesIn('Call between Wed 4 Nov and Thu 5 Nov', ref).map((d) => M.fmtDay(d)), ['Wed 4 Nov', 'Thu 5 Nov']);
  assert.deepEqual(M.datesIn('Follow up call around 22 october', ref).map(M.fmtDayShort), ['22 Oct']);
  assert.deepEqual(M.datesIn('by around 26 Nov 2026', ref).map(M.fmtDayShort), ['26 Nov']);
  assert.deepEqual(M.datesIn('Send email 1A by Mon 9 Nov', ref).map(M.fmtDayShort), ['9 Nov'], '"1A" is not a date');
  const jan = M.datesIn('call back 5 Jan', day('2026-12-20'))[0];
  assert.equal(M.dayParts(jan).y, 2027, 'January written in December means next year');
  assert.deepEqual(M.datesIn('last week of Nov', ref), []);
});

/* ------------------------------------------------------------- names */

test('parseTitle splits name, office and role in the CRM\'s formats', () => {
  assert.deepEqual(M.parseTitle('Nick Ikon - Forsyth (Director of Property Management)', 'Forsyth'), { display: 'Nick Ikon', role: 'Director of Property Management', issue: null });
  assert.deepEqual(M.parseTitle('Elaine Lee - Comfirst', 'Comfirst'), { display: 'Elaine Lee', role: null, issue: null });
  assert.deepEqual(M.parseTitle('Jason Hitchman - Client Services Manager', 'Belle Property Dee Why'), { display: 'Jason Hitchman', role: 'Client Services Manager', issue: null });
  assert.deepEqual(M.parseTitle('Michelle Smart, Property Manager', 'Skyline'), { display: 'Michelle Smart', role: 'Property Manager', issue: null });
  assert.equal(M.parseTitle('DUPLICATE - delete (Nina, see Nina Steel)', 'X').issue, 'duplicate');
  assert.equal(M.parseTitle('DUPLICATE - delete (Nina, see Nina Steel)', 'X').display, 'Nina');
  assert.equal(M.parseTitle('', 'X').issue, 'blank');
  assert.equal(M.parseTitle('info', 'X').issue, 'handle');
  assert.equal(M.parseTitle('someone@agency.test', 'X').issue, 'handle');
  const note = M.parseTitle('Annika Post (key contact) PM related. Contact after the report', 'X');
  assert.equal(note.issue, 'note');
  assert.equal(note.display, 'Annika Post');
  assert.equal(M.initials('Nick Ikon'), 'NI');
  assert.equal(M.initials('Yaqi Zhang (Eric)'), 'YZ');
});

test('phoneInfo tells a mobile from a landline in "mob #"', () => {
  assert.equal(M.phoneInfo('0423 258 057').kind, 'mobile');
  assert.equal(M.phoneInfo('+61 423 258 057').kind, 'mobile');
  assert.equal(M.phoneInfo('(02) 9419 7411').kind, 'landline');
  assert.equal(M.phoneInfo('').kind, 'none');
  assert.equal(M.phoneInfo('0423 258 057').tel, '0423258057');
});

/* ----------------------------------------------------------- cadence */

test('cadence: next stage marks what is done; drop-in status says met or reception', () => {
  const cells = M.cadenceCells(M.parseStage('drop-in v2'), M.parseDropIn('package @ reception v1'));
  assert.deepEqual(cells, [['tried', 'done', 'done'], ['todo', 'todo', 'todo'], ['todo', 'todo', 'todo']]);
  assert.deepEqual(M.cadenceCells(M.parseStage('call v1'), M.parseDropIn('delivered to contact v1'))[0], ['done', 'done', 'todo']);
  assert.deepEqual(M.cadenceCells(null, null)[0], ['todo', 'todo', 'todo']);
  assert.deepEqual(M.parseStage('do not contact further'), { stop: true });
  assert.equal(M.parseStage('select'), null);
  assert.equal(M.stageLabel('drop-in v2'), 'Drop-in v2');
  assert.equal(M.stageLabel(null), 'Not set');
});

test('log sheet: only finishing the due step moves the cadence on', () => {
  const nick = { nextStage: 'drop-in v2', stage: M.parseStage('drop-in v2') };
  assert.equal(M.roundFor(nick, 'call'), 1, 'a call before the v2 drop-in is another v1 call');
  assert.equal(M.roundFor(nick, 'dropin'), 2);
  const extra = M.nextChoices(nick, 'call', 1, 'No answer');
  assert.ok(extra.every((x) => x.stage === 'drop-in v2' || x.stage === 'do not contact further'), 'an extra call never moves the stage back');
  assert.deepEqual(M.nextChoices(nick, 'dropin', 2, 'Met them in person').map((x) => x.stage), ['email v2', 'do not contact further']);
  const due = { nextStage: 'call v1', stage: M.parseStage('call v1') };
  assert.deepEqual(M.nextChoices(due, 'call', 1, 'Spoke with them').map((x) => x.stage), ['drop-in v2', 'call v1', 'do not contact further']);
  assert.deepEqual(M.nextChoices(due, 'call', 1, 'Voicemail').map((x) => x.label), ['Call again', 'Stop contacting']);
  assert.equal(M.stageAfter('call', 3), null, 'nothing after call v3');
});

test('logPlan: heading in the house format, drop-in status from the outcome', () => {
  const c = { nextStage: 'drop-in v2', stage: M.parseStage('drop-in v2') };
  const choices = M.nextChoices(c, 'dropin', 2, 'Left at reception');
  const plan = M.logPlan(c, { kind: 'dropin', round: 2, outcome: 'Left at reception', next: choices[0].key, choices, day: day('2026-11-23'), author: 'Saini' }, day('2026-11-21'));
  assert.equal(plan.heading, '21 Nov 2026, drop-in v2, Saini');
  assert.equal(plan.dropIn, 'package @ reception v2');
  assert.equal(plan.nextStage, 'email v2');
  assert.equal(plan.nextStep, 'email v2 Mon 23 Nov');
  const note = M.logPlan(c, { kind: 'note', outcome: null, next: null, choices: [], day: null, author: 'Saini' }, day('2026-11-21'));
  assert.equal(note.heading, '21 Nov 2026, note, Saini');
  assert.equal(note.nextStage, null);
});

/* --------------------------------------------------------------- areas */

test('areaOf reads the suburb in an office name, longest match first', () => {
  assert.deepEqual(M.areaOf('The Novak Agency (Dee Why)'), { area: 'Northern Beaches', place: 'Dee Why', rank: 4 });
  assert.equal(M.areaOf('Forsyth North Willoughby').place, 'North Willoughby');
  assert.equal(M.areaOf('Belle Property Willoughby').place, 'Willoughby');
  assert.deepEqual(M.areaOf('Ray White - Upper North Shore'), { area: 'North Shore', place: null, rank: 999 });
  assert.equal(M.areaOf('Forsyth').area, 'Area not recorded');
  assert.equal(M.mapsQuery('Forsyth'), 'Forsyth real estate, NSW');
  assert.equal(M.mapsQuery('Ray White Chatswood'), 'Ray White Chatswood, NSW');
});

/* --------------------------------------------------------------- model */

function fixture() {
  n = 0;
  const pat = contact({ nextStage: 'call v1', nextSteps: 'Call between Wed 4 Nov and Thu 5 Nov', edited: '2026-10-30T00:00:00.000Z' });
  const linda = contact({ name: 'Linda Partner', status: 'partner', agency: 'Triple Example Rental', nextStage: 'select', dropIn: 'Not started' });
  const alex = contact({ name: 'Alex Partner', status: 'partner', agency: 'Example & Co (Manly)', nextStage: 'drop-in v2', dropIn: 'Not started' });
  const quiet = contact({ name: 'Quiet Lead', status: 'lead', agency: 'unverified', nextStage: 'select', nextSteps: null, dropIn: 'Not started', mobile: '(02) 9000 0000', email: null });
  const jane = contact({ name: 'Jane PM', status: 'partner', agency: null, test: true });
  const dup = contact({ name: 'DUPLICATE - delete (Pat, see Pat Example)', status: 'lead' });
  const blank = contact({ name: '', status: 'select' });
  const reqs = [
    request({ date: '2026-11-11', created: '2026-11-11T04:00:00Z', rooms: 4, prices: { assessment: 99, basic: 751.4, care: 853.6 }, contactIds: [linda.id], suburb: 'Macquarie Park' }),
    request({ date: '2026-09-28', created: '2026-09-28T03:51:00Z', status: 'approved', option: 'care', price: 588, rooms: 2, contactIds: [alex.id], suburb: 'Freshwater',
      approvedAt: '2026-09-30T23:38:00Z', reportSent: '2026-09-28T22:42:00Z', invoiceStatus: 'sent', invoiceDue: '2026-10-12', hasInvoice: true, hasJob: true }),
    request({ date: '2026-11-19', created: '2026-11-19T03:30:00Z', status: 'approved', option: 'basic', price: 377, contactIds: [alex.id], suburb: 'Manly',
      approvedAt: '2026-11-19T03:33:00Z', reportSent: '2026-11-19T03:30:00Z', invoiceStatus: 'paused', hasJob: true }),
    request({ date: '2026-10-22', created: '2026-10-22T04:00:00Z', contactIds: [pat.id] }),
    request({ date: '2026-10-19', status: 'approved', option: 'basic', price: 377, pmName: 'Test Agent', test: true })
  ];
  return { syncedAt: '2026-11-21T06:00:00Z', quoteValidDays: 21, contacts: [pat, linda, alex, quiet, jane, dup, blank], requests: reqs, snapshots: null, ids: { pat, linda, alex, quiet } };
}

test('buildModel leaves test, duplicate and blank rows out of every count', () => {
  const f = fixture();
  const m = M.buildModel(f, NOW);
  assert.deepEqual(m.left, { test: 1, duplicate: 1, blank: 1 });
  assert.deepEqual(m.pipeline, { lead: 1, warm: 1, partner: 2, total: 4 });
  assert.equal(m.people.length, 4);
  assert.equal(m.tests, 1);
  assert.equal(m.quotes.length, 4, 'the test quote is left out');
  const cleanup = m.lists.find((l) => l.key === 'cleanup');
  assert.ok(cleanup.ids.includes(f.contacts[5].id), 'the duplicate is in Clean-up');
  assert.ok(cleanup.ids.includes(f.contacts[6].id), 'the blank row is in Clean-up');
  assert.ok(cleanup.ids.includes(f.ids.quiet.id), 'an unverified agency is in Clean-up');
  assert.ok(!cleanup.ids.includes(f.contacts[4].id), 'test rows stay out of Clean-up');
});

test('smart lists: overdue, quiet partners, no next step, missing details', () => {
  const f = fixture();
  const m = M.buildModel(f, NOW);
  const list = (k) => m.lists.find((l) => l.key === k);
  assert.deepEqual(list('overdue').ids, [f.ids.pat.id]);
  assert.equal(m.byId.get(f.ids.pat.id).overdue, 16, 'Thu 5 Nov → Sat 21 Nov');
  assert.deepEqual(list('quiet').ids, [], 'both partners requested within 21 days');
  assert.deepEqual(list('nonext').ids, [f.ids.quiet.id]);
  assert.deepEqual(list('missing').ids, [f.ids.quiet.id]);
  assert.match(list('missing').sub, /1 landline/);
});

test('quotes: open, approved and lapsed, with days left from the 21-day window', () => {
  const m = M.buildModel(fixture(), NOW);
  assert.deepEqual(m.open.map((q) => [q.pm, q.daysLeft, q.upTo]), [['Linda Partner', 11, 853.6]]);
  assert.equal(M.fmtDay(m.open[0].expires), 'Wed 2 Dec');
  assert.deepEqual(m.lapsed.map((q) => M.fmtDay(q.lapsedDay)), ['Thu 12 Nov']);
  assert.deepEqual(m.orders.map((o) => o.ex), [377, 588], 'newest approval first');
});

test('revenue: totals, win rate, median time to yes, months by approval date', () => {
  const r = M.buildModel(fixture(), NOW).revenue;
  assert.equal(r.total, 965);
  assert.equal(r.inc, 1061.5);
  assert.equal(r.winRate, 67, '2 approved of 3 decided');
  assert.equal(r.fast, 1);
  assert.equal(Math.round(r.median * 10) / 10, 24.5, 'median of 3 minutes and 48.9 hours');
  const byLabel = Object.fromEntries(r.months.map((x) => [x.m, x.total]));
  assert.deepEqual(byLabel, { Sep: 0, Oct: 588, Nov: 377 }, 'approved 1 Oct Sydney time counts in October');
  assert.equal(r.thisMonth.total, 377);
});

test('cash: overdue invoices by due date, paused invoices waiting on the job', () => {
  const r = M.buildModel(fixture(), NOW).revenue;
  assert.equal(r.cash.overdue.items.length, 1);
  assert.equal(r.cash.overdue.items[0].overdueDays, 40);
  assert.equal(r.cash.overdue.inc, 646.8);
  assert.equal(r.cash.paused.items.length, 1);
  assert.equal(r.cash.paused.inc, 414.7);
  assert.equal(r.cash.paid.items.length, 0);
  const paid = r.funnel.find((s) => s.label === 'Paid (recorded)');
  assert.match(paid.sub, /40 days past due/);
});

test('offices and areas: grouped by agency, placed by name or by a quote suburb', () => {
  const m = M.buildModel(fixture(), NOW);
  const names = m.officeGroups.map((g) => g.name);
  assert.equal(names[names.length - 1], M.NO_AGENCY, 'no-agency group last');
  const triple = m.officeGroups.find((g) => g.name === 'Triple Example Rental');
  assert.equal(triple.area, 'Ryde & Macquarie Park');
  assert.equal(triple.placeFrom, 'quote');
  const manly = m.officeGroups.find((g) => g.name === 'Example & Co (Manly)');
  assert.equal(manly.place, 'Manly');
  assert.equal(manly.v, 965);
  assert.ok(m.areas.every((a) => a.offices.every((g) => g.known)));
});

test('momentum: null when the snapshots table is not shared', () => {
  assert.equal(M.buildModel(fixture(), NOW).momentum, null);
  const f = fixture();
  f.snapshots = [{ date: '2026-10-21', total: 48, warm: 17, partners: 3 }, { date: '2026-11-19', total: 79, warm: null, partners: 7 }];
  const mo = M.buildModel(f, NOW).momentum;
  assert.equal(mo.rows.length, 2);
  assert.equal(mo.last.total, 79);
  assert.equal(mo.live.total, 4);
});

test('search matches names, offices and Next Steps notes', () => {
  const m = M.buildModel(fixture(), NOW);
  assert.deepEqual(M.search(m, 'linda').people.map((c) => c.name), ['Linda Partner']);
  assert.deepEqual(M.search(m, 'between wed').people.map((c) => c.name), ['Pat Example']);
  assert.ok(M.search(m, 'manly').offices.some((g) => g.name === 'Example & Co (Manly)'));
  assert.deepEqual(M.search(m, 'x'), { people: [], offices: [] }, 'one letter is not a search');
});

test('money and labels', () => {
  assert.equal(M.money(2122.2), '$2,122.20');
  assert.equal(M.money(1946.9, 0), '$1,947');
  assert.equal(M.money0(424.44), '$424');
  assert.equal(M.hoursLabel(0.05), '3 min');
  assert.equal(M.hoursLabel(26.52), '26.5 h');
  assert.equal(M.hoursLabel(67.3), '2.8 days');
  assert.equal(M.plural(1, 'office'), '1 office');
  assert.equal(M.plural(2, 'person', 'people'), '2 people');
});
