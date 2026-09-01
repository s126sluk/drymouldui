/* Lead-gen card wiring — docs/index-call.html only. Self-contained; does not
   import from main.js. Handles every .lead-card__form on the page. */
(function () {
  'use strict';

  var LEAD_ENDPOINT = 'https://drysafeapi.vercel.app/api/cp1/mould-landing/lead';
  var TRACKING_STORAGE_KEY = 'dsLeadTracking';
  var CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'rdt_cid'];

  function safeCall(fn) {
    try { fn(); } catch (e) { /* a blocked/absent tracking lib must never break the form */ }
  }

  function readStoredTracking() {
    try {
      var raw = sessionStorage.getItem(TRACKING_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function captureTracking() {
    var stored = readStoredTracking();
    var params = new URLSearchParams(window.location.search);
    var changed = false;
    CLICK_ID_KEYS.forEach(function (key) {
      var val = params.get(key);
      if (val) {
        stored[key] = val;
        changed = true;
      }
    });
    if (changed) {
      try { sessionStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(stored)); } catch (e) { /* private-browsing storage denial is fine to ignore */ }
    }
    return stored;
  }

  function getTracking() {
    var stored = readStoredTracking();
    var tracking = {};
    CLICK_ID_KEYS.forEach(function (key) { tracking[key] = stored[key] || ''; });
    return tracking;
  }

  // ---- lenient AU phone check — mirrors the server's accept range
  // (mobiles + landlines), not the checkout modal's mobile-only rule. ----
  function isPlausibleAUPhone(raw) {
    var cleaned = String(raw || '').replace(/[\s()-]/g, '');
    return /^(?:\+?61|0)[2-478]\d{8}$/.test(cleaned);
  }

  function setError(field, message) {
    field.classList.toggle('has-error', !!message);
    var err = field.querySelector('.lead-card__err');
    if (err) err.textContent = message || '';
  }

  function validateForm(form) {
    var valid = true;
    var nameField = form.querySelector('[data-field="name"]');
    var phoneField = form.querySelector('[data-field="phone"]');
    var suburbField = form.querySelector('[data-field="suburb"]');

    var name = form.elements.name.value.trim();
    var phone = form.elements.phone.value.trim();
    var suburb = form.elements.suburb.value.trim();

    if (!name) { setError(nameField, 'Enter your full name'); valid = false; }
    else setError(nameField, '');

    if (!isPlausibleAUPhone(phone)) { setError(phoneField, 'Enter a valid Australian phone number'); valid = false; }
    else setError(phoneField, '');

    if (!suburb) { setError(suburbField, 'Enter your suburb'); valid = false; }
    else setError(suburbField, '');

    return valid;
  }

  var formStartedFired = false;
  function fireFormStarted() {
    if (formStartedFired) return;
    formStartedFired = true;
    safeCall(function () { window.posthog.capture('lead_form_started'); });
  }

  function fireLeadConversions() {
    safeCall(function () { window.fbq('track', 'Lead'); });
    safeCall(function () { window.rdt('track', 'Lead'); });
    safeCall(function () { window.posthog.capture('lead_submitted', { page: 'index-call' }); });
    safeCall(function () { window.gtag('event', 'generate_lead'); });
  }

  function showSuccess(card) {
    var form = card.querySelector('.lead-card__form');
    var success = card.querySelector('.lead-card__success');
    var urgency = card.querySelector('.lead-card__urgency');
    if (form) form.hidden = true;
    if (urgency) urgency.hidden = true;
    if (success) success.hidden = false;
  }

  function showFormError(form) {
    var el = form.querySelector('.lead-card__formerr');
    if (!el) return;
    el.textContent = "Something went wrong — call us on 0420 141 128 and we'll sort it out.";
    el.hidden = false;
  }

  function clearFormError(form) {
    var el = form.querySelector('.lead-card__formerr');
    if (el) el.hidden = true;
  }

  function initCard(card) {
    var form = card.querySelector('.lead-card__form');
    if (!form) return;

    var submitBtn = form.querySelector('.lead-card__submit');
    var line1 = form.querySelector('.lead-card__submit-line1');
    var defaultLabel = line1 ? line1.textContent : '';

    form.querySelectorAll('.lead-card__input').forEach(function (input) {
      input.addEventListener('focus', fireFormStarted, { once: false });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearFormError(form);

      if (!validateForm(form)) return;

      // Honeypot — bots that fill every field still get silently no-op'd,
      // matching the server's silent-200 behaviour.
      var hp = form.elements.hp ? form.elements.hp.value : '';

      submitBtn.disabled = true;
      if (line1) line1.textContent = 'Booking…';

      var payload = {
        name: form.elements.name.value.trim(),
        phone: form.elements.phone.value.trim(),
        suburb: form.elements.suburb.value.trim(),
        page: 'index-call',
        hp: hp,
        tracking: getTracking()
      };

      fetch(LEAD_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) {
        if (res.ok) {
          showSuccess(card);
          fireLeadConversions();
        } else {
          submitBtn.disabled = false;
          if (line1) line1.textContent = defaultLabel;
          showFormError(form);
        }
      }).catch(function () {
        submitBtn.disabled = false;
        if (line1) line1.textContent = defaultLabel;
        showFormError(form);
      });
    });
  }

  function init() {
    captureTracking();
    document.querySelectorAll('.lead-card').forEach(initCard);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
