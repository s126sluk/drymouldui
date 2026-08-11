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
    const FUNNEL = 'https://drysafe.vercel.app/get-started';
    const MAX_ROOMS = 8;
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
        rooms: 1
      };

      const money = n => '$' + n.toLocaleString('en-AU');

      const q = sel => modal.querySelector(sel);

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
      })); // Hand-off: funnel deep-link with package + rooms + details prefilled.
      // Funnel-side consumption is a separate CP4 work order.

      modal.querySelector('.mpk-modal__form').addEventListener('submit', e => {
        e.preventDefault();
        const form = e.target;
        if (!form.reportValidity()) return;
        const params = new URLSearchParams({
          service: 'mould',
          package: state.pkg,
          rooms: String(state.rooms),
          name: form.name.value,
          phone: form.phone.value,
          email: form.email.value,
          address: form.address.value
        });
        const dest = `${FUNNEL}?${params.toString()}`;

        if (window.__CP4_PREVIEW) {
          const notice = modal.querySelector('.mpk-modal__notice');
          notice.hidden = false;
          notice.textContent = 'Preview only — in production this continues to the funnel with everything prefilled: ' + dest;
          return;
        }

        window.location.href = dest;
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
