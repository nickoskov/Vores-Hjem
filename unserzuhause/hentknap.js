/* Svaevende hent-knap til unserzuhauseapp.de, samme knap som paa voreshjem.dk (chatbot/hentknap.js).
   Knappen gaar til backend.unserzuhauseapp.de/hent/app, som sender telefonen til sin butik og en computer
   til download-siden. Den taeller ikke selv: taeller.js haefter siden og stedet (data-sted) paa ved trykket,
   og backenden taeller trykket i den tyske database. Ligger paa siden selv, saa den ikke afhaenger af noget dansk.
   Chatboblen (widget.js fra backend.unserzuhauseapp.de) sidder under knappen, og knappen flytter sig over den.
   Paa lave skaerme (under 500 px hoej) er knappen i stedet en lille rund knap ved siden af chatboblen. */
(function () {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  var a, sidsteBund = 0;
  /* Knappen laegger sig over chatboblen og teaseren ved siden af den, saa intet daekker for noget andet */
  function placer() {
    try {
      if (!a) return;
      /* Paa lave skaerme sidder knappen ved siden af chatboblen og skal ikke loeftes op over den */
      if (window.matchMedia && window.matchMedia('(max-height:500px)').matches) {
        if (sidsteBund) { a.style.removeProperty('bottom'); sidsteBund = 0; }
        return;
      }
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

  /* Knappen er altid synlig (Nicko 10. okt. 2026), men daekker den en App Store- eller Google Play-knap,
     bliver den til en lille rund knap ude ved kanten, indtil butiksknappen er rullet forbi. */
  var fuldBredde = 0;
  function undgaa() {
    try {
      if (!a) return;
      if (window.matchMedia && window.matchMedia('(max-height:500px)').matches) { a.classList.remove('vh-lille'); return; }
      if (!a.classList.contains('vh-lille')) fuldBredde = a.offsetWidth;
      var r = a.getBoundingClientRect();
      var hoejre = r.right, venstre = r.right - (fuldBredde || r.width);
      var knapper = document.querySelectorAll('a[href*="apps.apple.com"], a[href*="play.google.com"]');
      var ram = false;
      for (var i = 0; i < knapper.length && !ram; i++) {
        var k = knapper[i].getBoundingClientRect();
        if (k.width < 20 || k.height < 20) continue;
        ram = k.right > venstre - 8 && k.left < hoejre + 8 && k.bottom > r.top - 8 && k.top < r.bottom + 8;
      }
      if (ram !== a.classList.contains('vh-lille')) a.classList.toggle('vh-lille', ram);
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
        'background:linear-gradient(110deg,#4F32CC,#1D4ED8 58%,#BE185D);',
        'color:#fff; font-weight:800; font-size:15.5px; letter-spacing:-.01em;',
        "font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;",
        'box-shadow:0 14px 34px -10px rgba(108,71,255,.75);',
        'opacity:0; transform:translateY(16px); pointer-events:none;',
        'transition:opacity .3s ease, transform .3s ease, box-shadow .2s ease;',
      '}',
      '#vh-hent.vh-vis{ opacity:1; transform:none; pointer-events:auto; }',
      '#vh-hent:hover{ box-shadow:0 18px 44px -10px rgba(108,71,255,.92); }',
      '#vh-hent svg{ flex:none; }',
      /* Lille rund udgave, mens knappen ellers ville daekke App Store- eller Google Play-knapperne */
      '#vh-hent.vh-lille{ width:52px; height:52px; padding:0; gap:0; justify-content:center; }',
      '#vh-hent.vh-lille span{ display:none; }',
      /* Chatboblen er 62 px hoej og sidder 24 px oppe, saa knappen laegger sig over den */
      '@media (max-width:480px){',
        '#vh-hent{ right:16px; bottom:90px; padding:13px 18px; font-size:14.5px; }',
      '}',
      /* Lave skaerme (telefon paa langs, 200 % zoom): en lille rund knap ved siden af chatboblen,
         saa den ikke ligger midt paa skaermen over overskrifterne. aria-label siger stadig, hvad den er. */
      '@media (max-height:500px){',
        '#vh-hent{ right:96px; bottom:29px; width:52px; height:52px; padding:0; gap:0; justify-content:center; }',
        '#vh-hent span{ display:none; }',
      '}',
      /* paa smalle skaerme sidder chatboblen 16 px fra kanten */
      '@media (max-height:500px) and (max-width:480px){',
        '#vh-hent{ right:88px; bottom:21px; }',
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

    /* Synlig hele tiden, ogsaa oeverst paa siden (Nicko 8. okt. 2026). Klassen saettes i naeste billede,
       saa knappen glider blidt ind i stedet for at springe frem. */
    requestAnimationFrame(function () { a.classList.add('vh-vis'); });

    placer(); undgaa();
    setInterval(function () { placer(); undgaa(); }, 1000);
    window.addEventListener('resize', function () { placer(); undgaa(); }, { passive: true });
    var venter = false;
    window.addEventListener('scroll', function () {
      if (venter) return;
      venter = true;
      requestAnimationFrame(function () { venter = false; undgaa(); });
    }, { passive: true });
  }
})();
