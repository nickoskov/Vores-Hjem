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
  send({ u: location.href, r: document.referrer || '', nf: /nicht gefunden/i.test(document.title || '') ? 1 : 0 });
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
        u.searchParams.set('sted', omr0 ? omr0.id : a.closest('nav') ? 'menu' : a.closest('footer') ? 'footer' : '');
        a.href = u.toString();
      } catch (e2) {}
      return;
    }
    var butik = /apps\.apple\.com/.test(h) ? 'appstore' : /play\.google\.com/.test(h) ? 'googleplay' : /showNotLaunched/.test(oc) ? 'app' : '';
    if (!butik) return;
    var omr = a.closest('section[id]');
    var sted = omr ? omr.id : a.closest('nav') ? 'menu' : a.closest('footer') ? 'footer' : '';
    send({ k: 'klik', u: location.href, sted: String(sted).slice(0, 60), butik: butik });
  }, true);
})();
