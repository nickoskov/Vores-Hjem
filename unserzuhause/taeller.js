/* Cookiefri besøgstæller for unserzuhauseapp.de (samme som på voreshjem.dk).
   Sender ét signal pr. sidevisning og ét pr. tryk på en download-knap til sin egen backend, backend.unserzuhauseapp.de/t.
   Der gemmes intet på den besøgendes enhed. Medarbejdere kan slå tællingen fra i deres egen browser
   med /?ansat=1 (huskes i localStorage, ingen cookie) og til igen med /?ansat=0. */
(function () {
  var ansat = false;
  try {
    var q = new URLSearchParams(location.search).get('ansat');
    if (q === '1') localStorage.setItem('vh-ansat', '1');
    if (q === '0') localStorage.removeItem('vh-ansat');
    ansat = localStorage.getItem('vh-ansat') === '1';
  } catch (e) {}
  if (ansat) return;
  var MAAL = 'https://backend.unserzuhauseapp.de/t';
  function send(d) {
    try {
      var b = JSON.stringify(d);
      if (navigator.sendBeacon) navigator.sendBeacon(MAAL, new Blob([b], { type: 'text/plain' }));
      else fetch(MAAL, { method: 'POST', body: b, keepalive: true, mode: 'no-cors' });
    } catch (e) {}
  }
  function computer() {
    var mobil = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints || 0) > 1;
    return !mobil && !!window.matchMedia && window.matchMedia('(min-width:820px)').matches;
  }
  send({ u: location.href, r: document.referrer || '', nf: /nicht gefunden/i.test(document.title || '') ? 1 : 0 });

  /* Hvor laenge de bliver, om de ruller, og fejl paa rigtige telefoner (20. okt. 2026).
     Ét lille signal, naar siden har vaeret synlig i 10, 30 og 60 sekunder, naar de har rullet en fjerdedel,
     halvdelen og det meste af siden, og hvis browseren faar en fejl (hoejst fem pr. side). Ingen cookies,
     intet gemt paa enheden, og kun selve fejlbeskeden og filen sendes, aldrig adressefelter. */
  (function () {
    var sendt = {}, fejl = 0, synlig = 0;
    function adf(h, d) {
      if (h !== 'fejl') { if (sendt[h]) return; sendt[h] = 1; }
      send({ k: 'adf', h: h, u: location.href, d: d || '' });
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
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a, button') : null;
    if (!a) return;
    var h = a.getAttribute('href') || '', oc = a.getAttribute('onclick') || '';
    // hent-knapperne taeller selv i backenden. Siden sender kun sit domaene med til en anden adresse,
    // saa siden og afsnittet haeftes paa her, lige foer browseren foelger linket.
    if (/\/hent\//.test(h) && a.href) {
      try {
        var u = new URL(a.href), omr0 = a.closest('section[id]');
        u.searchParams.set('sti', location.pathname);
        // knapper uden for et afsnit (den svaevende i hentknap.js) siger selv, hvad de er
        u.searchParams.set('sted', a.getAttribute('data-sted') || (omr0 ? omr0.id : a.closest('nav') ? 'menu' : a.closest('footer') ? 'footer' : ''));
        // Safari paa iPad udgiver sig for at vaere en Mac, saa backenden ville sende den til download-siden.
        // En iPad kan installere fra App Store, saa den sendes direkte dertil.
        if (/Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) > 1) u.pathname = u.pathname.replace(/\/hent\/app$/, '/hent/appstore');
        a.href = u.toString();
      } catch (e2) {}
      return;
    }
    var butik = /apps\.apple\.com/.test(h) ? 'appstore' : /play\.google\.com/.test(h) ? 'googleplay' : /showNotLaunched/.test(oc) ? 'app' : '';
    if (!butik) return;
    // Paa en computer sender butik.js App Store- og Google Play-knapperne til download-siden (samme test som der).
    // "app" faar backenden til at skrive det ned som hent-siden ud fra enheden.
    if ((butik === 'appstore' || butik === 'googleplay') && !e.metaKey && !e.ctrlKey && !e.shiftKey && computer() && document.querySelector('script[src*="butik.js"]')) butik = 'app';
    var omr = a.closest('section[id]');
    var sted = omr ? omr.id : a.closest('nav') ? 'menu' : a.closest('footer') ? 'footer' : '';
    send({ k: 'klik', u: location.href, sted: String(sted).slice(0, 60), butik: butik });
  }, true);
})();
