/* mould.drysafe.sydney — Mould Action Plan (MAP) helpers.
 * Used by /action-plan/, /plan/, /call/ and /unsubscribe/. Talks to drysafeapi
 * (server/routes/map.js in the drysafecp1 repo), which builds the plan, so the
 * wording shown here always matches the emailed PDF.
 *
 * Tracking: PostHog events (map_*), and the Meta Pixel Lead event with the plan
 * reference as its eventID. drysafeapi sends the same Lead through the
 * Conversions API with the same id, so Meta counts it once.
 *
 * Nothing here stores personal details in the browser.
 */
(function () {
  'use strict';
  var API = 'https://drysafeapi.vercel.app';
  var TOKEN_RE = /^[a-f0-9]{32}$/;

  function track(event, props) {
    try { if (window.posthog && typeof window.posthog.capture === 'function') window.posthog.capture(event, props || {}); } catch (e) {}
  }
  function search() {
    try { return new URLSearchParams(window.location.search); } catch (e) { return null; }
  }
  function param(name) {
    var p = search();
    return p ? String(p.get(name) || '').trim() : '';
  }
  /** A 32-hex token from the query string, or '' (never anything else). */
  function token(name) {
    var v = param(name).toLowerCase();
    return TOKEN_RE.test(v) ? v : '';
  }
  function cookie(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }
  function utm() {
    var out = {};
    ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (k) {
      var v = param('utm_' + k);
      if (v) out[k] = v.slice(0, 120);
    });
    return out;
  }
  /** Meta's click id cookie, or one built from ?fbclid= the way the Pixel does. */
  function fbc() {
    var c = cookie('_fbc');
    if (c) return c;
    var id = param('fbclid');
    return id ? 'fb.1.' + Date.now() + '.' + id : '';
  }
  /** Random id for one "Send my plan": a repeat tap returns the same plan. */
  function newSubmissionId() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var out = '';
    try {
      var b = new Uint8Array(24);
      window.crypto.getRandomValues(b);
      for (var i = 0; i < b.length; i++) out += chars[b[i] % chars.length];
    } catch (e) {
      for (var j = 0; j < 24; j++) out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }
  function request(method, path, body) {
    var init = { method: method, cache: 'no-store' };
    if (body) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
    return fetch(API + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data || {} };
      });
    }, function () {
      return { ok: false, status: 0, data: {} };
    });
  }
  /** "+61412345678" -> "0412 345 678" */
  function mobileDisplay(v) {
    var m = /^\+61(4\d{2})(\d{3})(\d{3})$/.exec(String(v || ''));
    return m ? '0' + m[1] + ' ' + m[2] + ' ' + m[3] : String(v || '');
  }

  window.dsMap = {
    phone: '0420 141 128',
    phoneHref: 'tel:+61420141128',
    token: token,
    track: track,
    newSubmissionId: newSubmissionId,
    mobileDisplay: mobileDisplay,

    /**
     * POST /api/cp1/map/submit.
     * answers: { sit, signs:[], rooms, surf:[], other, water, wd:[], role }
     * details: { name, email, mobile, postcode, marketing }
     * extra:   { submissionId, leadToken, startedAt (Date), hp }
     */
    submit: function (answers, details, extra) {
      extra = extra || {};
      return request('POST', '/api/cp1/map/submit', {
        answers: answers,
        details: details,
        hp: extra.hp || '',
        meta: {
          submission_id: extra.submissionId,
          lead_token: extra.leadToken || '',
          started_at: extra.startedAt ? new Date(extra.startedAt).toISOString() : '',
          utm: utm(),
          fbclid: param('fbclid'),
          fbp: cookie('_fbp'),
          fbc: fbc(),
          // No query string: it can hold tokens.
          page_url: window.location.origin + window.location.pathname,
        },
      });
    },
    plan: function (t) { return request('GET', '/api/map/plan/' + t); },
    prefill: function (t) { return request('GET', '/api/map/prefill/' + t); },
    call: function (t) { return request('GET', '/api/map/call/' + t); },
    unsubscribe: function (t) { return request('POST', '/api/map/unsubscribe/' + t, {}); },

    /** Meta Pixel Lead, deduplicated with the server's Conversions API event. */
    lead: function (ref) {
      try { if (typeof window.fbq === 'function') window.fbq('track', 'Lead', { content_name: 'Mould Action Plan' }, { eventID: ref }); } catch (e) {}
    },
  };
})();
