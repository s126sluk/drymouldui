/* mould.drysafe.sydney — booking hand-off for the new page.
 * Ported from the live site's js/main.js (mouldPackages): Google Places address autocomplete,
 * POST to the existing checkout endpoint, redirect to Stripe. PostHog events kept.
 * The page's booking pop-up calls window.dsCheckout(payload, onError) after its own checks pass.
 */
(function () {
  'use strict';
  var CHECKOUT_ENDPOINT = 'https://drysafeapi.vercel.app/api/cp1/mould-landing/checkout';
  // Public Maps JS key from the live site (restricted by HTTP referrer on the key itself).
  var GOOGLE_MAPS_API_KEY = 'AIzaSyDqhBKlcHjRN70Ryj_9BFVwJSHk1ssotqU';

  function track(event, props) {
    try { if (window.posthog && typeof window.posthog.capture === 'function') window.posthog.capture(event, props || {}); } catch (e) {}
  }
  function trackingParams() {
    var out = {};
    try {
      var p = new URLSearchParams(window.location.search);
      ['gclid', 'gbraid', 'wbraid'].forEach(function (k) { var v = p.get(k); if (v) out[k] = v; });
    } catch (e) {}
    return out;
  }

  // ---- address autocomplete (structured components only, AU)
  window.__dsAddr = null;
  function loadMaps(cb) {
    if (window.google && window.google.maps && window.google.maps.places) return cb();
    var s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + GOOGLE_MAPS_API_KEY + '&libraries=places';
    s.async = true; s.onload = cb;
    document.head.appendChild(s);
  }
  function attach(input) {
    if (input.__dsBound) return; input.__dsBound = true;
    loadMaps(function () {
      var ac = new window.google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: 'au' }, fields: ['address_components', 'formatted_address'], types: ['address']
      });
      ac.addListener('place_changed', function () {
        var place = ac.getPlace(); if (!place || !place.address_components) return;
        var c = {};
        place.address_components.forEach(function (x) {
          var t = x.types[0];
          if (t === 'street_number') c.street_number = x.long_name;
          if (t === 'route') c.route = x.long_name;
          if (t === 'locality') c.locality = x.long_name;
          if (t === 'administrative_area_level_1') c.state = x.short_name;
          if (t === 'postal_code') c.postcode = x.long_name;
        });
        window.__dsAddr = c;
      });
      input.addEventListener('input', function () { window.__dsAddr = null; });
    });
  }
  // the pop-up is rendered by the page script; bind as soon as the field exists
  var tries = 0;
  (function wait() {
    var el = document.querySelector('input[name="address"]');
    if (el) return attach(el);
    if (++tries < 200) setTimeout(wait, 150);
  })();

  // ---- checkout
  window.dsCheckout = function (d, onError) {
    var a = window.__dsAddr;
    if (!a || !a.street_number || !a.route || !a.locality || !a.state || !a.postcode) {
      track('booking_checkout_blocked', { reason: 'incomplete_address' });
      return onError('Please select a complete address from the dropdown suggestions.');
    }
    var payload = Object.assign({
      package: d.pkg, rooms: d.rooms, full_name: d.name, phone: d.phone, email: d.email,
      address: { street_number: a.street_number, route: a.route, locality: a.locality, state: a.state, postcode: a.postcode },
      property_type: d.pt === 'apartment' ? 'Apartment' : 'House', terms_accepted: true
    }, trackingParams());
    track('booking_checkout_submitted', { package: d.pkg, rooms: d.rooms, property_type: payload.property_type });
    fetch(CHECKOUT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; }); })
      .then(function (r) {
        if (r.ok && r.data && r.data.checkout_url) { track('booking_checkout_redirect', { package: d.pkg, rooms: d.rooms }); window.location.href = r.data.checkout_url; return; }
        if (r.status === 403) { track('booking_checkout_failed', { reason: 'not_serviceable' }); return onError('Sorry, we do not service your area.'); }
        track('booking_checkout_failed', { reason: 'server_error', status: r.status }); onError('Something went wrong, please try again.');
      })
      .catch(function () { track('booking_checkout_failed', { reason: 'network_error' }); onError('Something went wrong, please try again.'); });
  };
})();
