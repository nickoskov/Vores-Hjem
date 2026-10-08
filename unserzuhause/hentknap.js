/* Svaevende hent-knap til unserzuhauseapp.de, samme knap som paa voreshjem.dk (chatbot/hentknap.js).
   Knappen gaar til backend.unserzuhauseapp.de/hent/app, som sender telefonen til sin butik og en computer
   til download-siden. Den taeller ikke selv: taeller.js haefter siden og stedet (data-sted) paa ved trykket,
   og backenden taeller trykket i den tyske database. Ligger paa siden selv, saa den ikke afhaenger af noget dansk.
   Chatboblen (widget.js fra backend.unserzuhauseapp.de) sidder under knappen, og knappen flytter sig over den. */
(function () {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  var a, sidsteBund = 0;
  /* Knappen laegger sig over chatboblen og teaseren ved siden af den, saa intet daekker for noget andet */
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
        'opacity:0; transform:translateY(16px); pointer-events:none;',
        'transition:opacity .3s ease, transform .3s ease, box-shadow .2s ease;',
      '}',
      '#vh-hent.vh-vis{ opacity:1; transform:none; pointer-events:auto; }',
      '#vh-hent:hover{ box-shadow:0 18px 44px -10px rgba(108,71,255,.92); }',
      '#vh-hent svg{ flex:none; }',
      /* Chatboblen er 62 px hoej og sidder 24 px oppe, saa knappen laegger sig over den */
      '@media (max-width:480px){',
        '#vh-hent{ right:16px; bottom:90px; padding:13px 18px; font-size:14.5px; }',
      '}'
    ].join('');
    document.head.appendChild(stil);

    a = document.createElement('a');
    a.id = 'vh-hent';
    /* som sidens egne "Kostenlos testen"-knapper: ny fane, saa taeller.js naar at saette siden og stedet paa */
    a.href = 'https://backend.unserzuhauseapp.de/hent/app';
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('data-sted', 'flydeknap');
    a.setAttribute('aria-label', 'Unser Zuhause kostenlos testen');
    a.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>' +
      '<span>Kostenlos testen</span>';
    document.body.appendChild(a);

    /* Kommer foerst frem, naar man er kommet lidt ned, saa den ikke daekker for det foerste indtryk */
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
