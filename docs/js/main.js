(function () {
    'use strict';

    function reviews () {
      let reviewsSwiper = new Swiper(".reviews-swiper", {
        slidesPerView: 1,
        spaceBetween: 16,
        loop: true,
        breakpoints: {
          768: {
            slidesPerView: 2
          },
          1200: {
            slidesPerView: 3
          },
          1540: {
            slidesPerView: 4,
            spaceBetween: 24
          }
        },
        navigation: {
          nextEl: ".swiper-button-next",
          prevEl: ".swiper-button-prev"
        }
      });
    }

    function accordion () {
      let accordions = document.querySelectorAll('.accordion');

      for (let a = 0; a < accordions.length; a++) {
        let items = accordions[a].querySelectorAll('.accordion-item');
        let activeItem = accordions[a].querySelector('.accordion-item.active');

        for (let i = 0; i < items.length; i++) {
          items[i].addEventListener('click', function (e) {
            let button = e.currentTarget.querySelector('.accordion-item__btn');

            if (e.currentTarget !== activeItem && !!activeItem) {
              activeItem.classList.remove('active');
              button.setAttribute('aria-expanded', false);
            }

            if (e.currentTarget.classList.contains('active')) {
              e.currentTarget.classList.remove('active');
              button.setAttribute('aria-expanded', false);
            } else {
              e.currentTarget.classList.add('active');
              button.setAttribute('aria-expanded', true);
              activeItem = e.currentTarget;
            }
          });
        }
      }
    }

    function history () {
      const video = document.querySelector(".video");
      const play = document.querySelector(".video__play");
      if (!video || !play) return;
      const videoId = video.dataset.id;
      const vimeoHash = "7e4b7653d3"; // статический hash

      play.addEventListener("click", () => {
        video.innerHTML = `
      <iframe
        src="https://player.vimeo.com/video/${videoId}?h=${vimeoHash}&autoplay=1&muted=1"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        loading="lazy"
      ></iframe>
    `;
      });
    }

    function gallery () {
      let gallerySwiper = new Swiper(".gallery-swiper", {
        slidesPerView: 1,
        spaceBetween: 16,
        loop: true,
        navigation: {
          nextEl: ".swiper-button-next",
          prevEl: ".swiper-button-prev"
        }
      });
    }

    function notification () {
      // ── Refresh counter (legacy — currently no counter elements in DOM) ──
      const counters = document.querySelectorAll(".notification__refresh span");

      if (counters.length) {
        let timeLeft = 59;

        const updateCounters = () => {
          counters.forEach(counter => {
            counter.textContent = timeLeft;
          });
        };

        updateCounters();
        setInterval(() => {
          timeLeft--;

          if (timeLeft < 1) {
            timeLeft = 59;
          }

          updateCounters();
        }, 1000);
      } // ── Sticky header scroll shadow ──


      const siteHeader = document.querySelector('.site-header');

      if (siteHeader) {
        const onScroll = () => {
          if (window.scrollY > 10) {
            siteHeader.classList.add('is-scrolled');
          } else {
            siteHeader.classList.remove('is-scrolled');
          }
        };

        window.addEventListener('scroll', onScroll, {
          passive: true
        });
        onScroll(); // initial check
      }
    }

    // Hop 0 of the gclid attribution spine + WCR numerator.
    //
    // Google auto-tagging lands visitors on this page with ?gclid=… (or
    // ?gbraid=/?wbraid= for iOS/Safari traffic). The funnel (drysafecp1) reads
    // these on its entry route, but only if they survive the cross-domain hop.
    // So on load we copy any present click ids onto every CTA that points at the
    // funnel, turning .../  into .../?gclid=…
    //
    // We also fire the WCR numerator (`cta_clickthrough`) on the SAME click that
    // forwards to the funnel — one atomic action with the gclid that was appended.
    // WCR = cta_clickthrough ÷ landing_pageview, both captured on drysafe.sydney.
    //
    // Forwards ONLY gclid/gbraid/wbraid — that's all the funnel reads.
    const CLICK_PARAMS = ['gclid', 'gbraid', 'wbraid'];
    function clickforward () {
      let incoming;

      try {
        incoming = new URLSearchParams(window.location.search);
      } catch (e) {
        incoming = new URLSearchParams();
      } // Collect only present, non-empty click ids (paid traffic). Organic = none.


      const present = [];

      for (const name of CLICK_PARAMS) {
        const value = (incoming.get(name) || '').trim();
        if (value) present.push([name, value]);
      }

      const links = document.querySelectorAll('a[href*="drysafe.vercel.app"]');
      links.forEach(function (link) {
        // Append click ids to the href so they survive the cross-domain hop.
        if (present.length > 0) {
          try {
            const url = new URL(link.href);

            for (const [name, value] of present) {
              url.searchParams.set(name, value);
            }

            link.href = url.toString();
          } catch (e) {
            /* malformed href — skip the append, still wire the event below */
          }
        } // WCR numerator: fire on the click that forwards to the funnel. Fired
        // for EVERY funnel CTA click (organic included) so the ratio is honest;
        // click ids are null for organic. Guarded so a missing/slow PostHog
        // never blocks navigation.


        link.addEventListener('click', function () {
          try {
            if (window.posthog && typeof window.posthog.capture === 'function') {
              window.posthog.capture('cta_clickthrough', {
                destination: link.href,
                gclid: incoming.get('gclid') || null,
                gbraid: incoming.get('gbraid') || null,
                wbraid: incoming.get('wbraid') || null
              });
            }
          } catch (e) {
            /* never let analytics break the click-through */
          }
        });
      });
    }

    // SMS fallback tracking — `sms_deeplink_tap`.
    //
    // The SMS panel's action chip is an sms: deeplink, so the tap leaves the page
    // for the Messages app and we never see a pageview for it. This is the only
    // signal that the fallback path is being used at all, and which of the three
    // placements (hero / mid / final) is earning it.
    //
    // Deliberately separate from clickforward.js: that module owns the
    // a[href*="drysafe.vercel.app"] selector and the cta_clickthrough WCR
    // numerator, and nothing here touches either. Different selector
    // (a.sms-chip[data-sms-placement]), different event, no overlap — an sms:
    // href can never match clickforward's substring selector.
    //
    // `placement` comes from data-sms-placement, set at each +smsPanel() call site.
    function smsdeeplink () {
      const chips = document.querySelectorAll('a.sms-chip[data-sms-placement]');
      chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
          try {
            if (window.posthog && typeof window.posthog.capture === 'function') {
              window.posthog.capture('sms_deeplink_tap', {
                placement: chip.getAttribute('data-sms-placement')
              });
            }
          } catch (e) {
            /* never let analytics block the deeplink */
          }
        });
      });
    }

    // [CP4 v5-spec, 11 Aug] Package picker + shared order modal.
    // Locked behaviours (cp4_handoff_2026-08-11_landing-modal-v5-spec):
    //  1. Any picker Select opens the modal showing BOTH packages, the clicked one
    //     highlighted; the customer can switch inside the modal.
    //  2. The header Book Now ([data-mpk-open]) is a pure modal trigger with
    //     drySafe Care preselected.
    //  3. Rooms stepper reinstated; COUNT derives the tier (room-SIZE stays dead):
    //     1 room = single rate · 2–3 rooms = per-room 2–3 rate · 4+ = per-room 4+.
    // Hand-off adds rooms=<N> to the funnel deep-link. Upsells stay post-payment
    // in the funnel — never on the landing page. Guarded: inert on water pages.
    //
    // RATES: approved master-sheet mould tab, ex GST, per room — swappable
    // constants pending the post-refinement price confirmation (Care composition
    // changed 10 Aug). SRL is dropped for mould per the spec default.
    const RATES = {
      basic: {
        single: 425,
        two_three: 387,
        four_plus: 445
      },
      care: {
        single: 590,
        two_three: 552,
        four_plus: 610
      }
    };
    const MAX_ROOMS = 6; // spec 2026-08-14 §6: rooms 1-6
    // Maps Platform API key — public by design for client-side Maps JS,
    // access is scoped via HTTP referrer restriction on the key itself, not secrecy.
    const GOOGLE_MAPS_API_KEY = 'AIzaSyDqhBKlcHjRN70Ryj_9BFVwJSHk1ssotqU';
    const MAPS_SRC_MATCH = 'maps.googleapis.com/maps/api/js';

    function ensureMapsScript(onReady, onError) {
      if (window.google && window.google.maps && window.google.maps.places) {
        onReady();
        return;
      }
      const existing = Array.from(document.querySelectorAll('script')).find(s => s.src && s.src.includes(MAPS_SRC_MATCH));
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          onReady();
          return;
        }
        existing.addEventListener('load', onReady, {
          once: true
        });
        existing.addEventListener('error', onError, {
          once: true
        });
        return;
      }
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        onReady();
      });
      script.addEventListener('error', onError);
      document.head.appendChild(script);
    }

    function trackingParams() {
      const params = new URLSearchParams(window.location.search);
      const out = {};
      ['gclid', 'gbraid', 'wbraid'].forEach(key => {
        const val = params.get(key);
        if (val) out[key] = val;
      });
      return out;
    }

    function rateFor(pkg, rooms) {
      const t = RATES[pkg];
      if (rooms <= 1) return t.single;
      if (rooms <= 3) return t.two_three;
      return t.four_plus;
    }
    function mouldPackages() {
      const roots = Array.from(document.querySelectorAll('[data-mpk-picker]'));
      const modal = document.querySelector('.mpk-modal');
      if (!roots.length || !modal) return;
      const state = {
        pkg: 'care',
        rooms: 1,
        propertyType: null,
        address: null, // { street_number, route, locality, state, postcode, formatted_address }
        tracking: trackingParams()
      };

      const money = n => '$' + n.toLocaleString('en-AU');

      const q = sel => modal.querySelector(sel);

      function showNotice(text) {
        const notice = q('.mpk-modal__notice');
        if (!notice) return;
        notice.hidden = false;
        notice.textContent = text;
      }

      function hideNotice() {
        const notice = q('.mpk-modal__notice');
        if (notice) notice.hidden = true;
      }

      function paintModal() {
        modal.querySelectorAll('[data-pkg]').forEach(b => {
          const on = b.dataset.pkg === state.pkg;
          b.classList.toggle('is-selected', on);
          b.setAttribute('aria-pressed', String(on));
        });
        q('[data-modal="count"]').textContent = state.rooms;
        const rate = rateFor(state.pkg, state.rooms);
        const total = rate * state.rooms;
        q('[data-modal="mathline"]').textContent = `${state.rooms} room${state.rooms === 1 ? '' : 's'} × ${money(rate)} = ${money(total)} + GST`;
        q('[data-modal="total"]').textContent = money(total) + ' + GST';
      }

      function openModal(pkg) {
        state.pkg = pkg;
        paintModal();
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
      } // 1. Picker Select buttons → modal, clicked package highlighted


      roots.forEach(root => root.querySelectorAll('[data-select]').forEach(btn => btn.addEventListener('click', () => openModal(btn.dataset.select)))); // 2. Header Book Now → modal, Care preselected (anchor fallback without JS)

      document.querySelectorAll('[data-mpk-open]').forEach(el => el.addEventListener('click', e => {
        e.preventDefault();
        openModal(el.dataset.mpkOpen || 'care');
      })); // Switch package inside the modal

      modal.querySelectorAll('[data-pkg]').forEach(btn => btn.addEventListener('click', () => {
        state.pkg = btn.dataset.pkg;
        paintModal();
      })); // 3. Rooms stepper — count drives the tier

      modal.querySelectorAll('[data-step]').forEach(btn => btn.addEventListener('click', () => {
        state.rooms = Math.min(MAX_ROOMS, Math.max(1, state.rooms + Number(btn.dataset.step)));
        paintModal();
      }));
      modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => {
        modal.hidden = true;
        document.body.style.overflow = '';
      })); // 4. Property type selector — required, House/Apartment (exact strings)

      modal.querySelectorAll('[data-proptype]').forEach(btn => btn.addEventListener('click', () => {
        state.propertyType = btn.dataset.proptype;
        modal.querySelectorAll('[data-proptype]').forEach(b => {
          const on = b === btn;
          b.classList.toggle('is-selected', on);
          b.setAttribute('aria-pressed', String(on));
        });
      })); // 5. Google Places autocomplete on the address field — structured
      // components only, postcode from the postal_code component, never
      // regexed off the formatted string (spec §1, matches water's AddressCapture).

      function paintAddressFields() {
        const a = state.address || {};
        ['street_number', 'route', 'locality', 'state', 'postcode'].forEach(key => {
          const field = q(`[name="${key}"]`);
          if (field) field.value = a[key] || '';
        });
      }

      function initAddressAutocomplete() {
        const input = q('[name="address"]');
        if (!input) return;
        ensureMapsScript(() => {
          const autocomplete = new window.google.maps.places.Autocomplete(input, {
            componentRestrictions: {
              country: 'au'
            },
            fields: ['address_components', 'formatted_address'],
            types: ['address']
          });
          autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (!place.address_components) return;
            const components = {};
            place.address_components.forEach(c => {
              const type = c.types[0];
              if (type === 'street_number') components.street_number = c.long_name;
              if (type === 'route') components.route = c.long_name;
              if (type === 'locality') components.locality = c.long_name;
              if (type === 'administrative_area_level_1') components.state = c.short_name;
              if (type === 'postal_code') components.postcode = c.long_name;
            });
            state.address = Object.assign({
              formatted_address: place.formatted_address
            }, components);
            paintAddressFields();
            hideNotice(); // A new address selection lifts any prior out-of-area block —
            // the customer may legitimately be retrying with a serviceable address.

            q('.mpk-modal__pay').disabled = false;
          }); // Manual re-typing invalidates the previously selected place —
          // force re-selection from the dropdown before the gate can pass.

          input.addEventListener('input', () => {
            state.address = null;
            paintAddressFields();
          });
        }, () => showNotice('Failed to load Google Maps. Please check your connection and try again.'));
      }

      initAddressAutocomplete(); // 6. Full scrollable T&C box — replicates water's ScrollableTerms UX
      // (drysafecp1/src/components/terms/ScrollableTerms.jsx): scroll-to-
      // bottom (within 50px) unlocks the single checkbox; skip button jumps
      // to bottom and hides once scrolled-to-bottom or already accepted.

      function initTerms() {
        const box = q('[data-modal="termsbox"]');
        const hint = q('[data-modal="scrollhint"]');
        const skipBtn = q('[data-modal="skipbtn"]');
        const checkbox = q('[data-modal="termscheck"]');
        if (!box || !checkbox) return;
        let scrolledToBottom = false;

        function paintTerms() {
          if (hint) hint.hidden = scrolledToBottom;
          if (skipBtn) skipBtn.hidden = scrolledToBottom || checkbox.checked;
          checkbox.disabled = !scrolledToBottom;
        }

        box.addEventListener('scroll', () => {
          const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 50;
          if (nearBottom && !scrolledToBottom) {
            scrolledToBottom = true;
            paintTerms();
          }
        });
        if (skipBtn) {
          skipBtn.addEventListener('click', () => {
            box.scrollTo({
              top: box.scrollHeight,
              behavior: 'smooth'
            });
          });
        }
        checkbox.addEventListener('change', paintTerms);
        paintTerms();
      }

      initTerms(); // Hand-off: was a funnel deep-link (service/package/rooms/details as
      // query params to /get-started). Killed per SS88 design requirement,
      // 14 Aug — landing collects everything and goes straight to Stripe.
      // On 200: window.location.href = checkout_url, nothing else — upsell/
      // tracking is handled server-side, past the form's job.

      const CHECKOUT_ENDPOINT = 'https://drysafeapi.vercel.app/api/cp1/mould-landing/checkout';

      modal.querySelector('.mpk-modal__form').addEventListener('submit', e => {
        e.preventDefault();
        const form = e.target;
        if (!form.reportValidity()) return;
        hideNotice();

        if (!state.propertyType) {
          showNotice('Please select a property type.');
          return;
        }

        const addr = state.address;
        if (!addr || !addr.street_number || !addr.route || !addr.locality || !addr.state || !addr.postcode) {
          showNotice('Please select a complete address from the dropdown suggestions.');
          return;
        }

        const payload = Object.assign({
          package: state.pkg,
          rooms: state.rooms,
          full_name: form.name.value,
          phone: form.phone.value,
          email: form.email.value,
          address: {
            street_number: addr.street_number,
            route: addr.route,
            locality: addr.locality,
            state: addr.state,
            postcode: addr.postcode
          },
          property_type: state.propertyType,
          terms_accepted: true
        }, state.tracking);

        const payBtn = modal.querySelector('.mpk-modal__pay');
        payBtn.disabled = true;

        fetch(CHECKOUT_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }).then(res => res.json().then(data => ({
          ok: res.ok,
          status: res.status,
          data: data
        }))).then(({
          ok,
          status,
          data
        }) => {
          if (ok && data.checkout_url) {
            window.location.href = data.checkout_url;
            return;
          }
          if (status === 403) {
            // Hard gate: server backstop rejected the postcode. Left disabled —
            // only a fresh address selection (place_changed) lifts this.
            showNotice('Sorry, we do not service your area.');
            return;
          }
          showNotice('Something went wrong, please try again.');
          payBtn.disabled = false;
        }).catch(() => {
          showNotice('Something went wrong, please try again.');
          payBtn.disabled = false;
        });
      });
      paintModal();
    }

    // import header from './modules/header'
    document.addEventListener('DOMContentLoaded', function () {
      // header()
      reviews();
      accordion();
      history();
      gallery();
      notification();
      clickforward();
      smsdeeplink();
      mouldPackages(); // AOS.init({
      // 	offset: 80,
      // 	duration: 200,
      // 	easing: 'ease-in',
      // 	once: true,
      // });
    });

}());
