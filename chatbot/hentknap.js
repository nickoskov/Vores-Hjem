/* Svaevende hent-knap til voreshjem.dk.
   Saettes ind i Wix med én linje:
     <script src="https://voreshjem-bot.netlify.app/hentknap.js"></script>
   Ligger her, saa knappen kan rettes uden at nogen skal ind i Wix igen. */
/* Svævende hent-knap til voreshjem.dk.
   Sættes ind under Indstillinger, Tilpasset kode, i bunden af body,
   præcis som chatbotten. Så følger den med på alle sider og ligger
   i selve siden, ikke i en iframe. */
(function () {
  /* Medarbejdere taelles ikke med. Aabn voreshjem.dk/?ansat=1 én gang i hver browser,
     saa husker browseren det (localStorage, ingen cookie), og hverken besoeg eller
     klik sendes til backenden fra den browser. /?ansat=0 slaar det fra igen. */
  var ansat = false;
  try {
    var q = new URLSearchParams(location.search).get('ansat');
    if (q === '1') localStorage.setItem('vh-ansat', '1');
    if (q === '0') localStorage.removeItem('vh-ansat');
    ansat = localStorage.getItem('vh-ansat') === '1';
  } catch (e) {}

  /* Klik paa hent-knapper: hvilken side og hvilket sted paa siden, der blev trykket.
     Sendes til backenden uden cookies, foer browseren skifter side. */
  try {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var h = a.href || '';
      /* Hent-knapperne peger nu paa sidens egen /hent/-side, saa Google ser et
         direkte link. Paa telefon sendes man alligevel lige i butikken. */
      var egen = false;
      try { var u0 = new URL(h); egen = u0.hostname === location.hostname && /^\/hent\/?$/.test(u0.pathname); } catch (err) {}
      var butik = /apps\.apple\.com/.test(h) ? 'appstore' : /play\.google\.com/.test(h) ? 'googleplay'
                : /voreshjem-bot\.netlify\.app\/hent\/(app|appstore|googleplay)/.test(h) ? RegExp.$1 : egen ? 'app' : '';
      if (!butik) return;
      /* Paa en computer sender butik.js App Store- og Google Play-knapperne til QR-koden paa /hent/,
         ikke til butikken. Saa taelles trykket som 'app', som backenden skriver som 'hentside',
         og Google Analytics faar klik_hent i stedet for et klik til en butik. */
      if ((butik === 'appstore' || butik === 'googleplay') && document.querySelector('script[src*="butik.js"]')) {
        var mob = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints || 0) > 1;
        if (!mob && !(e.metaKey || e.ctrlKey || e.shiftKey) && window.matchMedia && window.matchMedia('(min-width:820px)').matches) butik = 'app';
      }
      if (egen) {
        var ua = navigator.userAgent || '';
        var direkte = /iPhone|iPad|iPod/.test(ua) ? 'https://apps.apple.com/dk/app/vores-hjem/id6758346281'
                    : /Android/.test(ua) ? 'https://play.google.com/store/apps/details?id=com.voreshjem.app&referrer=utm_source%3Dwebsite' : '';
        if (direkte) { e.preventDefault(); setTimeout(function () { location.href = direkte; }, 0); }
      }
      if (ansat) return;
      var sted = a.getAttribute('data-sted') || '';
      if (!sted) { try { sted = new URL(h).searchParams.get('src') || ''; } catch (err) {} }
      if (!sted) {
        var sek = a.closest('section, footer, nav, header, .hent-band');
        sted = a.closest('.hent-band') ? 'baand' : (sek && (sek.id || sek.tagName.toLowerCase())) || 'side';
        if (sted === 'baand') { var fs = a.closest('section'); if (fs && fs.previousElementSibling && fs.previousElementSibling.id) sted = fs.previousElementSibling.id; }
      }
      var data = JSON.stringify({ k: 'klik', u: location.href, sted: String(sted).slice(0, 60), butik: butik });
      var maal = 'https://backend.voreshjem.dk/t';
      if (navigator.sendBeacon) navigator.sendBeacon(maal, new Blob([data], { type: 'text/plain' }));
      else fetch(maal, { method: 'POST', body: data, keepalive: true, mode: 'no-cors' });

      /* Samme tryk som en rigtig haendelse i Google Analytics, saa den kan markeres som
         noeglehaendelse (konvertering). Backendens tragt bruger den egne taeller, ikke disse; de er til Google Analytics:
           klik_appstore   telefon eller link sendt til App Store
           klik_googleplay telefon eller link sendt til Google Play
           klik_hent       computer sendt til hent-siden (ikke en butik endnu)
         Google sender selv med sendBeacon, saa skiftet til butikken venter ikke paa det.
         Har den besoegende ikke sagt ja til cookies, goer Google selv kun det, samtykket tillader. */
      try {
        if (typeof window.gtag === 'function') {
          var ua2 = navigator.userAgent || '';
          var gb = butik !== 'app' ? butik
                 : /iPhone|iPad|iPod/.test(ua2) ? 'appstore' : /Android/.test(ua2) ? 'googleplay' : 'hentside';
          var navn = gb === 'appstore' ? 'klik_appstore' : gb === 'googleplay' ? 'klik_googleplay' : 'klik_hent';
          window.gtag('event', navn, { butik: gb, sted: String(sted).slice(0, 60) });
        }
      } catch (err) {}
    }, true);
  } catch (e) {}

  /* Egen besøgstæller til backenden. Ét signal pr. sidevisning, ingen cookies,
     intet gemt på enheden. Kun på voreshjem.dk og kun uden for en ramme. */
  try {
    if (!ansat && !window.__vhTalt && window.self === window.top && /(^|\.)voreshjem\.dk$/.test(location.hostname)) {
      window.__vhTalt = true;
      /* nf: siden er 404-siden ("ikke fundet"), saa doede adresser kan findes for alle */
      var data = JSON.stringify({ u: location.href, r: document.referrer || '', nf: /ikke fundet/i.test(document.title || '') ? 1 : 0 });
      var maal = 'https://backend.voreshjem.dk/t';
      if (navigator.sendBeacon) navigator.sendBeacon(maal, new Blob([data], { type: 'text/plain' }));
      else fetch(maal, { method: 'POST', body: data, keepalive: true, mode: 'no-cors' });
      var tSend = function (d) {
        try {
          var b = JSON.stringify(d), mal = 'https://backend.voreshjem.dk/t';
          if (navigator.sendBeacon) navigator.sendBeacon(mal, new Blob([b], { type: 'text/plain' }));
          else fetch(mal, { method: 'POST', body: b, keepalive: true, mode: 'no-cors' });
        } catch (e3) {}
      };

      /* Hvor laenge de bliver, om de ruller, og fejl paa rigtige telefoner (20. okt. 2026).
         Ét lille signal, naar siden har vaeret synlig i 10, 30 og 60 sekunder, naar de har rullet en fjerdedel,
         halvdelen og det meste af siden, og hvis browseren faar en fejl (hoejst fem pr. side). Ingen cookies,
         intet gemt paa enheden, og kun selve fejlbeskeden og filen sendes, aldrig adressefelter. */
      (function () {
        var sendt = {}, fejl = 0, synlig = 0;
        function adf(h, d) {
          if (h !== 'fejl') { if (sendt[h]) return; sendt[h] = 1; }
          tSend({ k: 'adf', h: h, u: location.href, d: d || '' });
        }
        var ur = setInterval(function () {
          if (document.visibilityState && document.visibilityState !== 'visible') return;
          synlig++;
          if (synlig === 10) adf('10s'); else if (synlig === 30) adf('30s'); else if (synlig === 60) { adf('60s'); clearInterval(ur); }
        }, 1000);
        window.addEventListener('scroll', function () {
          var de = document.documentElement, hoej = Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0);
          var y = window.pageYOffset || de.scrollTop || 0;
          if (y <= 0 || hoej <= window.innerHeight + 50) return;
          var p = (y + window.innerHeight) / hoej;
          if (p >= 0.25) adf('rul25');
          if (p >= 0.5) adf('rul50');
          if (p >= 0.9) adf('rul90');
        }, { passive: true });
        function tekst(m, f, l) {
          return String(m || '').slice(0, 160) + (f ? ' @ ' + String(f).replace(/[?#].*$/, '').slice(-90) + (l ? ':' + l : '') : '');
        }
        window.addEventListener('error', function (e) {
          if (!e || fejl >= 5) return;
          var t = e.target, kilde = t && t !== window && (t.currentSrc || t.src || t.href);
      // filer fra andre (cookiebanner, Google, Meta), som en reklameblokker stopper, er ikke en fejl paa siden
      if (kilde && !/(^|\.)(voreshjem\.dk|unserzuhauseapp\.de|voreshjem-bot\.netlify\.app)$/.test((function () { try { return new URL(kilde, location.href).hostname; } catch (e4) { return ''; } })())) return;
      // en fejl i et script fra en anden side kan browseren ikke vise, saa der staar kun "Script error."
      if (!kilde && /^Script error\.?$/.test(e.message || '') && !e.filename) return;
          // et billede, en video eller et script, der ikke kunne hentes, er ogsaa en fejl, de besoegende maerker
          var besked = e.message || (kilde ? 'kunne ikke hente ' + String(t.tagName || '').toLowerCase() + ' ' + String(kilde).replace(/[?#].*$/, '') : '');
          if (!besked) return;
          fejl++; adf('fejl', tekst(besked, e.filename, e.lineno));
        }, true);
        window.addEventListener('unhandledrejection', function (e) {
          if (fejl >= 5) return;
          var r = e && e.reason; fejl++;
          adf('fejl', tekst('promise: ' + (r && (r.message || r)) || 'ukendt'));
        });
      })();
    }
  } catch (e) {}

  // Koden kan lægges baade i Hoved og i Broedtekst. Ligger den i Hoved,
  // findes sidens krop ikke endnu, saa vi venter til den er der.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  var a, sidsteBund = 0;
  function placer() {
    try {
      if (!a) return;
      var vaert = document.getElementById('vh-chat-host');
      var rod = vaert && vaert.shadowRoot;
      var top = window.innerHeight;
      if (rod) {
        var dele = rod.querySelectorAll('.launcher, .nudge');
        for (var i = 0; i < dele.length; i++) {
          var st = getComputedStyle(dele[i]);
          if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.1) continue;
          var r = dele[i].getBoundingClientRect();
          if (r.height > 10 && r.bottom > window.innerHeight - 400 && r.right > window.innerWidth - 400) {
            if (r.top < top) top = r.top;
          }
        }
      }
      var bund = top < window.innerHeight ? Math.round(window.innerHeight - top + 14) : 0;
      if (bund > 0 && bund !== sidsteBund) { a.style.bottom = bund + 'px'; sidsteBund = bund; }
      else if (!bund && sidsteBund) { a.style.removeProperty('bottom'); sidsteBund = 0; }
    } catch (e) {}
  }

  function start() {
  if (document.getElementById('vh-hent')) return;

  /* Den nye voreshjem.dk har sin egen hent-knap (#hent-flyd). Saa laver vi ikke
     en mere, vi flytter bare sidens egen, saa chatten ikke dakker den. */
  var egen = document.getElementById('hent-flyd');
  if (egen) { a = egen; placer(); setInterval(placer, 1000);
    window.addEventListener('resize', placer, { passive: true }); return; }

  var stil = document.createElement('style');
  stil.textContent = [
    '#vh-hent{',
      'position:fixed; right:24px; bottom:104px; z-index:2147482000;',
      'display:inline-flex; align-items:center; gap:10px;',
      'padding:15px 22px; border-radius:99px; text-decoration:none;',
      'background:linear-gradient(110deg,#6C47FF,#4F7BFF 58%,#EC4899);',
      'color:#fff; font-weight:800; font-size:15.5px; letter-spacing:-.01em;',
      "font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;",
      'box-shadow:0 14px 34px -10px rgba(108,71,255,.75);',
      'opacity:0; visibility:hidden; transform:translateY(16px); pointer-events:none;',
      'transition:opacity .3s ease, transform .3s ease, box-shadow .2s ease, visibility 0s linear .3s;',
    '}',
    '#vh-hent.vh-vis{ opacity:1; visibility:visible; transform:none; pointer-events:auto; transition:opacity .3s ease, transform .3s ease, box-shadow .2s ease, visibility 0s; }',
    '#vh-hent:hover{ box-shadow:0 18px 44px -10px rgba(108,71,255,.92); }',
    '#vh-hent svg{ flex:none; }',
    /* Chatboblen er 62 px høj og sidder 24 px oppe, så knappen lægger sig over den */
    '@media (max-width:480px){',
      '#vh-hent{ right:16px; bottom:90px; padding:13px 18px; font-size:14.5px; }',
      '#vh-hent .vh-lang{ display:none; }',
    '}'
  ].join('');
  document.head.appendChild(stil);

  a = document.createElement('a');
  a.id = 'vh-hent';
  a.href = '/hent/';
  a.setAttribute('data-sted', 'flydeknap');
  a.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>' +
    '<span>Hent appen<span class="vh-lang"> nu</span></span>';
  document.body.appendChild(a);

  /* Kommer først frem, når man er kommet lidt ned, så den ikke dækker
     for det første indtryk af forsiden. */
  function tjek() {
    if (window.scrollY > 420) a.classList.add('vh-vis');
    else a.classList.remove('vh-vis');
  }
  window.addEventListener('scroll', tjek, { passive: true });
  tjek();

  placer();
  setInterval(placer, 1000);
  window.addEventListener('resize', placer, { passive: true });
  }
})();
