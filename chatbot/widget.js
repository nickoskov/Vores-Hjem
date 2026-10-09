(function () {
  if (window.__vhChatLoaded) return;
  window.__vhChatLoaded = true;

  var MIT_SCRIPT = document.currentScript || document.querySelector('script[src*="widget.js"]');
  // Botten og billederne ligger samme sted som scriptet: voreshjem-bot.netlify.app til den danske side,
  // backend.unserzuhauseapp.de til den tyske (dens egen bot). Kendes adressen ikke, er det den danske bot som foer.
  var BASE = (function () {
    try { var u = new URL(MIT_SCRIPT.src); if (/^https?:$/.test(u.protocol)) return u.origin; } catch (e) {}
    return 'https://voreshjem-bot.netlify.app';
  })();
  var ENDPOINT = BASE + '/.netlify/functions/chat-bot';

  // ---------- HVILKET MARKED? ----------
  // Sættes eksplicit med data-site="de" på script-tagget. Glemmer man det,
  // gættes der ud fra domænet, så den tyske side aldrig svarer på dansk.
  var SITE = (function () {
    var el = MIT_SCRIPT;
    var attr = el && el.getAttribute('data-site');
    if (attr && /^(dk|de)$/i.test(attr)) return attr.toLowerCase();
    var h = (location.hostname || '').toLowerCase();
    if (h.indexOf('unserzuhause') >= 0 || h.indexOf('verdant-strudel') >= 0) return 'de';
    return 'dk';
  })();

  var TEKSTER = {
    dk: {
      titel: 'Vores Hjem',
      status: 'Vi svarer typisk med det samme',
      velkomst: 'Hej! Jeg er Vores Hjem-assistenten. Spørg mig om pris, hvordan appen virker, familiemedlemmer, funktioner, hvad som helst.',
      hurtige: ['Hvad koster det?', 'Hvordan kommer jeg i gang?', 'Kan jeg prøve gratis?', 'Kan jeg synkronisere kalenderen?'],
      // Teaser efter hvor langt brugeren er kommet på siden (top / midt / bund)
      teaser: [
        'Spørgsmål om appen? Skriv til os 👋',
        'I tvivl om hvordan hele familien kommer med? Spørg os her 👋',
        'Spørgsmål om prisen? Én pris for hele familien, spørg løs 👋'
      ],
      skriv: 'Skriv din besked…',
      brand: 'Drevet af Vores Hjem',
      banner: 'En fra teamet er med i chatten',
      teamTag: 'Vores Hjem-team',
      nyttigt: 'Nyttigt?', tak: 'Tak for din feedback',
      aabn: 'Åbn chat', luk: 'Luk', send: 'Send', ja: 'Ja', nej: 'Nej',
      mailTitel: 'Skal vi kunne vende tilbage?',
      mailTekst: 'Skriv din email, så kan en fra teamet svare dig, også hvis du lukker chatten.',
      mailFelt: 'din@email.dk',
      mailFejl: 'Skriv venligst en gyldig email.',
      mailGem: 'Gem email',
      mailSpring: 'Nej tak, jeg fortsætter bare',
      mailSmaat: 'Vi bruger kun din email til at svare dig. Se privatlivspolitik på voreshjem.dk.',
      feltNavn: 'Din besked', mailNavn: 'Din email',
      netfejl: 'Beklager, der er forbindelsesproblemer lige nu. Skriv gerne til kontakt@vores-hjem.dk.'
    },
    de: {
      titel: 'Unser Zuhause',
      status: 'KI-Assistent, antwortet sofort',
      velkomst: 'Hallo! Ich bin der KI-Assistent von Unser Zuhause. Frag mich zum Preis, zur Bedienung, zu Familienmitgliedern oder Funktionen. Bei Bedarf übernimmt jemand aus dem Team.',
      hurtige: ['Was kostet es?', 'Wie fange ich an?', 'Kann ich kostenlos testen?', 'Kann ich den Kalender synchronisieren?'],
      teaser: [
        'Fragen zur App? Schreib uns 👋',
        'Unsicher, wie die ganze Familie mitkommt? Frag uns hier 👋',
        'Fragen zum Preis? Ein Preis für die ganze Familie, frag einfach 👋'
      ],
      skriv: 'Schreib deine Nachricht…',
      brand: 'KI-Assistent von Unser Zuhause',
      banner: 'Jemand aus dem Team ist im Chat',
      teamTag: 'Unser Zuhause Team',
      nyttigt: 'Hilfreich?', tak: 'Danke für dein Feedback',
      aabn: 'Chat öffnen', luk: 'Schließen', send: 'Senden', ja: 'Ja', nej: 'Nein',
      mailTitel: 'Sollen wir dich erreichen können?',
      mailTekst: 'Schreib deine E-Mail, dann kann dir jemand aus dem Team antworten, auch wenn du den Chat schließt.',
      mailFelt: 'deine@email.de',
      mailFejl: 'Bitte gib eine gültige E-Mail-Adresse ein.',
      mailGem: 'E-Mail speichern',
      mailSpring: 'Nein danke, ich schreibe einfach weiter',
      feltNavn: 'Deine Nachricht', mailNavn: 'Deine E-Mail-Adresse',
      mailSmaat: 'Wir nutzen deine E-Mail nur, um dir zu antworten. Mehr in der <a href="https://www.unserzuhauseapp.de/datenschutz" target="_blank" rel="noopener">Datenschutzerklärung</a>.',
      netfejl: 'Entschuldige, gerade gibt es Verbindungsprobleme. Schreib gern an support@unserzuhauseapp.de.'
    }
  };
  var T = TEKSTER[SITE] || TEKSTER.dk;
  // Hvert marked sit eget logo, ellers stod der Vores Hjem på den tyske side
  var AVATAR = BASE + '/' + (SITE === 'de' ? 'avatar-de.png' : 'avatar.png');
  var WELCOME = T.velkomst;
  var QUICK = T.hurtige;
  var NUDGES = T.teaser;
  var NUDGE_TEXT = NUDGES[0];
  var feedbackGiven = {}; // beskeds-index -> 1/-1

  // Lagring kan være spærret (fx Safari med "Bloker alle cookies"): så kaster localStorage en fejl, og
  // uden try/catch kom boblen slet ikke frem. Alt går gennem de to her; convId og email i hukommelsen er reserven.
  function hentGemt(n) { try { return window.localStorage.getItem(n); } catch (e) { return null; } }
  function gem(n, v) { try { window.localStorage.setItem(n, v); } catch (e) {} }

  // Identitet pr. browser OG pr. marked. Uden suffikset ville en person der
  // besøger begge sider fortsætte den danske samtale på den tyske side.
  var NØGLE = SITE === 'dk' ? 'vh-conv-id' : 'vh-conv-id-' + SITE;
  var MAILNØGLE = SITE === 'dk' ? 'vh-conv-email' : 'vh-conv-email-' + SITE;
  // Ved sideindlæsning læses kun et id, der allerede findes. Et nyt laves og gemmes først, når den første
  // besked sendes (sikrId), så intet gemmes hos dem, der aldrig bruger chatten.
  var convId = hentGemt(NØGLE) || '';
  function sikrId() {
    if (!convId) {
      convId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('c' + Date.now() + Math.round(Math.random() * 1e9));
      gem(NØGLE, convId);
    }
    return convId;
  }
  var email = hentGemt(MAILNØGLE) || '';

  var serverMsgs = [];
  var human = false;
  var needsHuman = false;
  var emailSkipped = false;
  var SKIPNØGLE = 'vh-mail-skip-' + SITE, TEASERNØGLE = 'vh-nudge-' + SITE;
  try { emailSkipped = sessionStorage.getItem(SKIPNØGLE) === '1'; } catch (e) {}
  var busy = false, pollTimer = null, lastSig = '';

  var host = document.createElement('div');
  host.id = 'vh-chat-host';
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  root.innerHTML = [
    '<style>',
    ':host{ all: initial; }',
    '*{ box-sizing:border-box; margin:0; padding:0; font-family:"Plus Jakarta Sans",-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; }',
    '.grad{ background:linear-gradient(135deg,#6C47FF 0%,#4F7BFF 55%,#FF6FB5 100%); }',
    '.launcher{ position:fixed; right:24px; bottom:24px; width:62px; height:62px; border-radius:50%; border:none; cursor:pointer; z-index:2147483000; box-shadow:0 10px 30px rgba(108,71,255,.45); display:flex; align-items:center; justify-content:center; transition:transform .18s ease, box-shadow .18s ease; }',
    '.launcher:hover{ transform:translateY(-2px) scale(1.04); box-shadow:0 14px 36px rgba(108,71,255,.55); }',
    '.launcher svg{ width:28px; height:28px; fill:#fff; }',
    '.panel{ position:fixed; right:24px; bottom:100px; width:376px; max-width:calc(100vw - 32px); height:560px; max-height:calc(100vh - 130px); background:#fff; border-radius:22px; z-index:2147483000; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 70px rgba(27,22,51,.28); opacity:0; transform:translateY(14px) scale(.98); pointer-events:none; visibility:hidden; transition:opacity .2s ease, transform .2s ease, visibility 0s linear .2s; }',
    '.panel.open{ opacity:1; transform:translateY(0) scale(1); pointer-events:auto; visibility:visible; transition-delay:0s; }',
    '.panel:focus{ outline:none; }',
    '.head{ padding:16px 18px; color:#fff; display:flex; align-items:center; gap:12px; }',
    '.head img{ width:40px; height:40px; border-radius:50%; object-fit:cover; background:#fff; }',
    '.head .ttl{ font-weight:700; font-size:16px; line-height:1.2; }',
    '.head .sub{ font-size:12px; opacity:.9; display:flex; align-items:center; gap:6px; margin-top:2px; }',
    '.dot{ width:7px; height:7px; border-radius:50%; background:#4ade80; box-shadow:0 0 0 3px rgba(74,222,128,.3); }',
    '.head .x{ margin-left:auto; background:transparent; border:none; color:#fff; cursor:pointer; font-size:22px; line-height:1; opacity:.85; padding:4px; }',
    '.head .x:hover{ opacity:1; }',
    '.body{ flex:1; overflow-y:auto; padding:18px 16px; background:#F6F5FB; display:flex; flex-direction:column; gap:10px; }',
    '.banner{ background:#EAF7EE; color:#1B7A3D; font-size:12.5px; font-weight:600; text-align:center; padding:7px 10px; border-radius:10px; }',
    '.row{ display:flex; gap:8px; align-items:flex-end; max-width:100%; }',
    '.row.me{ justify-content:flex-end; }',
    '.av{ width:26px; height:26px; border-radius:50%; flex:0 0 26px; object-fit:cover; }',
    '.stk{ display:flex; flex-direction:column; gap:3px; max-width:78%; }',
    '.tag{ font-size:10.5px; font-weight:700; color:#6C47FF; padding-left:3px; letter-spacing:.02em; }',
    '.bub{ padding:11px 14px; border-radius:16px; font-size:14.5px; line-height:1.5; word-wrap:break-word; }',
    '.bub .p{ margin:0 0 9px; } .bub .p:last-child{ margin-bottom:0; }',
    '.bub .li{ display:flex; gap:7px; margin:0 0 11px; } .bub .li:last-child{ margin-bottom:0; }',
    '.bub .li .n{ flex:0 0 auto; font-weight:600; }',
    '.bub .li .t{ flex:1; }',
    '.bot .bub{ background:#fff; color:#1B1633; border-bottom-left-radius:5px; box-shadow:0 1px 2px rgba(27,22,51,.06); }',
    '.agent .bub{ background:#EFEBFF; color:#1B1633; border-bottom-left-radius:5px; }',
    '.me .bub{ color:#fff; border-bottom-right-radius:5px; }',
    '.bub a{ color:inherit; }',
    '.typing{ display:flex; gap:4px; padding:12px 14px; }',
    '.typing span{ width:7px; height:7px; border-radius:50%; background:#c3bdd8; animation:vhb 1s infinite; }',
    '.typing span:nth-child(2){ animation-delay:.18s; } .typing span:nth-child(3){ animation-delay:.36s; }',
    '@keyframes vhb{ 0%,60%,100%{ transform:translateY(0); opacity:.5 } 30%{ transform:translateY(-5px); opacity:1 } }',
    // Email-gate
    '.gate{ display:flex; flex-direction:column; gap:12px; padding:6px 4px; }',
    '.gate .h{ font-size:16px; font-weight:700; color:#1B1633; }',
    '.gate .d{ font-size:13.5px; line-height:1.5; color:#4a4560; }',
    '.gate input{ border:1px solid #e3e0ef; border-radius:12px; padding:12px 13px; font-size:14.5px; outline:none; color:#1B1633; }',
    '.gate input:focus{ border-color:#6C47FF; }',
    '.gate .err{ color:#d64545; font-size:12.5px; display:none; }',
    '.gate button{ border:none; border-radius:12px; padding:12px; color:#fff; font-size:15px; font-weight:700; cursor:pointer; }',
    '.gate .fine{ font-size:11px; color:#6E6A85; line-height:1.4; }',
    '.gate .fine a{ color:#6C47FF; text-decoration:underline; }',
    '.gate.askmail{ background:#fff; border:1px solid #ece9f7; border-radius:16px; padding:14px; margin-top:6px; gap:9px; box-shadow:0 1px 2px rgba(27,22,51,.05); }',
    '.gate.askmail .h{ font-size:14.5px; }',
    '.gate.askmail .d{ font-size:12.5px; }',
    '.gate button.skip{ background:none; color:#8b86a5; font-size:12.5px; font-weight:600; padding:2px; }',
    '.gate button.skip:hover{ color:#6C47FF; }',
    '.foot{ padding:12px; background:#fff; border-top:1px solid #eee; display:flex; gap:8px; align-items:flex-end; }',
    '.foot textarea{ flex:1; resize:none; border:1px solid #e3e0ef; border-radius:14px; padding:10px 12px; font-size:14.5px; max-height:96px; outline:none; color:#1B1633; }',
    '.foot textarea:focus{ border-color:#6C47FF; }',
    '.send{ width:42px; height:42px; border-radius:12px; border:none; cursor:pointer; flex:0 0 42px; display:flex; align-items:center; justify-content:center; }',
    '.send:disabled{ opacity:.5; cursor:default; }',
    '.send svg{ width:20px; height:20px; fill:#fff; }',
    '.brand{ text-align:center; font-size:11px; color:#6E6A85; padding:6px 0 9px; background:#fff; }',
    // Hurtig-svar-knapper
    '.chips{ display:flex; flex-wrap:wrap; gap:8px; margin:4px 0 0 34px; }',
    '.chip{ background:#fff; border:1px solid #e3e0ef; color:#6C47FF; border-radius:16px; padding:8px 13px; font-size:13px; font-weight:600; cursor:pointer; text-align:left; }',
    '.chip:hover{ background:#f1edff; border-color:#6C47FF; }',
    // Tommel-feedback
    '.fb{ display:flex; gap:5px; align-items:center; margin:4px 0 2px 34px; }',
    '.fb .q{ font-size:11.5px; color:#6E6A85; }',
    '.fb button{ background:none; border:none; cursor:pointer; font-size:14px; opacity:.5; padding:2px 4px; border-radius:6px; line-height:1; }',
    '.fb button:hover{ opacity:1; background:#f1edff; }',
    '.fb .done{ font-size:11.5px; color:#8b86a5; }',
    // Nudge-teaser
    '.nudge{ position:fixed; right:24px; bottom:100px; max-width:230px; background:#fff; color:#1B1633; border-radius:16px; padding:13px 32px 13px 15px; font-size:13.5px; line-height:1.4; box-shadow:0 12px 30px rgba(27,22,51,.22); z-index:2147483000; cursor:pointer; opacity:0; transform:translateY(8px); pointer-events:none; visibility:hidden; transition:opacity .25s ease, transform .25s ease, visibility 0s linear .25s; }',
    '.nudge.show{ opacity:1; transform:translateY(0); pointer-events:auto; visibility:visible; transition-delay:0s; }',
    '.nudge .nx{ position:absolute; top:5px; right:8px; border:none; background:none; font-size:17px; color:#a9a4bd; cursor:pointer; line-height:1; padding:2px; }',
    '@media (max-width:480px){ .launcher{ right:16px; bottom:16px; } .nudge{ right:16px; bottom:88px; } }',
    // Samme regel som FULD nedenfor: her er chatten et modalt vindue i fuld skærm
    '@media (max-width:480px), (max-height:500px){ .panel{ right:0; bottom:0; width:100vw; max-width:100vw; height:100dvh; max-height:100dvh; border-radius:0; } .foot textarea, .gate input{ font-size:16px; } }',
    '</style>',

    '<button class="launcher grad" aria-label="' + T.aabn + '" aria-expanded="false">',
    '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.4 1.3 4.6 3.4 6-.2 1-.8 2.3-1.7 3.3-.2.2 0 .6.3.5 1.9-.4 3.4-1.1 4.4-1.8 1.1.3 2.3.5 3.6.5 5.5 0 10-3.6 10-8s-4.5-8-10-8z"/></svg>',
    '</button>',
    '<div class="nudge"><button class="nx" aria-label="' + T.luk + '">&times;</button><span class="ntxt">' + NUDGE_TEXT + '</span></div>',

    '<div class="panel" role="dialog" aria-label="' + T.titel + '" tabindex="-1">',
      '<div class="head grad">',
        '<img src="' + AVATAR + '" alt="" onerror="this.style.display=\'none\'">',
        '<div><div class="ttl">' + T.titel + '</div><div class="sub"><span class="dot"></span>' + T.status + '</div></div>',
        '<button class="x" aria-label="' + T.luk + '">&times;</button>',
      '</div>',
      '<div class="body"></div>',
      '<div class="foot">',
        '<textarea rows="1" placeholder="' + T.skriv + '" aria-label="' + T.feltNavn + '"></textarea>',
        '<button class="send grad" aria-label="' + T.send + '"><svg viewBox="0 0 24 24"><path d="M3.4 20.4l17.5-7.5c.8-.4.8-1.5 0-1.9L3.4 3.6c-.7-.3-1.4.2-1.4 1L2 9.1c0 .5.4.9.9 1l11.1 1.9L2.9 13.9c-.5.1-.9.5-.9 1l0 4.5c0 .8.7 1.3 1.4 1z"/></svg></button>',
      '</div>',
      '<div class="brand">' + T.brand + '</div>',
    '</div>'
  ].join('');

  var launcher = root.querySelector('.launcher');
  var panel = root.querySelector('.panel');
  var closeBtn = root.querySelector('.x');
  var body = root.querySelector('.body');
  var foot = root.querySelector('.foot');
  var ta = root.querySelector('textarea');
  var sendBtn = root.querySelector('.send');

  // Fuld skærm (samme regel som i CSS'en): så er chatten et modalt vindue, og Tab bliver i den
  var FULD = '(max-width:480px), (max-height:500px)';
  function fuldSkaerm() { try { return window.matchMedia(FULD).matches; } catch (e) { return false; } }
  // Kun med mus får feltet fokus af sig selv. På touch ville tastaturet ellers springe op og dække chatten.
  function harHover() { try { return window.matchMedia('(hover:hover)').matches; } catch (e) { return true; } }

  // ---------- formatering ----------
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function inlineFmt(s) {
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<a href="mailto:$1">$1</a>');
    return s;
  }
  function formatMessage(text) {
    var lines = String(text).replace(/\r/g, '').split('\n');
    var html = '';
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) continue;
      var num = raw.match(/^(\d+)[.)]\s+(.*)$/);
      var bul = raw.match(/^[-•*]\s+(.*)$/);
      if (num) html += '<div class="li"><span class="n">' + num[1] + '.</span><span class="t">' + inlineFmt(num[2]) + '</span></div>';
      else if (bul) html += '<div class="li"><span class="n">•</span><span class="t">' + inlineFmt(bul[1]) + '</span></div>';
      else html += '<div class="p">' + inlineFmt(raw) + '</div>';
    }
    return html || '<div class="p"></div>';
  }

  function rowHTML(role, text) {
    if (role === 'user') {
      return '<div class="row me"><div class="bub grad">' + formatMessage(text) + '</div></div>';
    }
    var av = '<img class="av" src="' + AVATAR + '" alt="" onerror="this.style.display=\'none\'">';
    if (role === 'agent') {
      return '<div class="row agent">' + av + '<div class="stk"><div class="tag">' + T.teamTag + '</div><div class="bub">' + formatMessage(text) + '</div></div></div>';
    }
    return '<div class="row bot">' + av + '<div class="bub">' + formatMessage(text) + '</div></div>';
  }

  // ---------- visning ----------
  function feedbackHTML(i) {
    if (feedbackGiven[i]) return '<div class="fb"><span class="done">' + T.tak + '</span></div>';
    return '<div class="fb"><span class="q">' + T.nyttigt + '</span>' +
      '<button data-fb="up" data-i="' + i + '" aria-label="' + T.ja + '">👍</button>' +
      '<button data-fb="down" data-i="' + i + '" aria-label="' + T.nej + '">👎</button></div>';
  }
  function chipsHTML() {
    var c = '<div class="chips">';
    for (var j = 0; j < QUICK.length; j++) c += '<button class="chip" data-q="' + esc(QUICK[j]) + '">' + esc(QUICK[j]) + '</button>';
    return c + '</div>';
  }
  function lastAssistantIndex() {
    for (var i = serverMsgs.length - 1; i >= 0; i--) if (serverMsgs[i].role === 'assistant') return i;
    return -1;
  }
  function renderChat(extraTyping) {
    var html = '';
    if (human) html += '<div class="banner">' + T.banner + '</div>';
    html += rowHTML('assistant', WELCOME);
    var lastBot = (!human && !extraTyping) ? lastAssistantIndex() : -1;
    for (var i = 0; i < serverMsgs.length; i++) {
      html += rowHTML(serverMsgs[i].role, serverMsgs[i].content);
      if (i === lastBot) html += feedbackHTML(i); // tommel kun under seneste bot-svar
    }
    if (extraTyping) html += '<div class="row bot"><img class="av" src="' + AVATAR + '" alt="" onerror="this.style.display=\'none\'"><div class="bub"><div class="typing"><span></span><span></span><span></span></div></div></div>';
    if (serverMsgs.length === 0 && !human && !extraTyping) html += chipsHTML(); // forslag før samtalen starter
    if (shouldAskEmail(extraTyping)) html += askEmailHTML();
    body.innerHTML = html;
    handleEmailBox();
    body.scrollTop = body.scrollHeight;
  }
  // Spørg om email når et menneske er (på vej) ind i chatten, eller efter 3 beskeder
  function shouldAskEmail(extraTyping) {
    if (email || emailSkipped || extraTyping) return false;
    if (human || needsHuman) return true;
    var userMsgs = 0;
    for (var i = 0; i < serverMsgs.length; i++) if (serverMsgs[i].role === 'user') userMsgs++;
    return userMsgs >= 3;
  }
  function giveFeedback(i, val) {
    if (feedbackGiven[i]) return;
    feedbackGiven[i] = val;
    var question = '';
    for (var k = i - 1; k >= 0; k--) { if (serverMsgs[k].role === 'user') { question = serverMsgs[k].content; break; } }
    var answer = serverMsgs[i] ? serverMsgs[i].content : '';
    try { api({ action: 'feedback', conversationId: convId, value: val, question: question, answer: answer }); } catch (e) {}
    renderChat(false);
  }

  // Email spørges først når den er relevant — ikke som en bom foran chatten
  function askEmailHTML() {
    return '<div class="gate askmail">' +
      '<div class="h">' + T.mailTitel + '</div>' +
      '<div class="d">' + T.mailTekst + '</div>' +
      '<input type="email" placeholder="' + T.mailFelt + '" autocomplete="email" aria-label="' + T.mailNavn + '">' +
      '<div class="err">' + T.mailFejl + '</div>' +
      '<button class="grad">' + T.mailGem + '</button>' +
      '<button class="skip" type="button">' + T.mailSpring + '</button>' +
      '<div class="fine">' + T.mailSmaat + '</div>' +
    '</div>';
  }
  function handleEmailBox() {
    var box = body.querySelector('.askmail');
    if (!box) return;
    var inp = box.querySelector('input');
    var err = box.querySelector('.err');
    var btn = box.querySelector('button.grad');
    var skip = box.querySelector('button.skip');
    function submit() {
      var v = (inp.value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { err.style.display = 'block'; inp.focus(); return; }
      email = v;
      gem(MAILNØGLE, email);
      // uden id er der ingen samtale endnu; mailen sendes så med den første besked
      if (convId) { try { api({ action: 'set_email', conversationId: convId, email: email }); } catch (e) {} }
      renderChat(false);
      setTimeout(function () { if (harHover()) ta.focus(); }, 60);
    }
    btn.addEventListener('click', submit);
    skip.addEventListener('click', function () {
      emailSkipped = true;
      try { sessionStorage.setItem(SKIPNØGLE, '1'); } catch (e) {}
      renderChat(false);
      setTimeout(function () { if (harHover()) ta.focus(); }, 60);
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  }

  function applyState(data) {
    var msgs = (data && data.messages) ? data.messages : [];
    var h = !!(data && data.human);
    // Voks/behold — skrump ALDRIG pga. forsinkede (eventual consistency) læsninger
    if (msgs.length >= serverMsgs.length) serverMsgs = msgs;
    human = h;
    if (data && typeof data.needsHuman !== 'undefined') needsHuman = !!data.needsHuman;
    var sig = JSON.stringify({ n: serverMsgs.length, h: human, nh: needsHuman, mail: !!email || emailSkipped, last: serverMsgs.length ? serverMsgs[serverMsgs.length - 1].content : '' });
    if (sig !== lastSig) { lastSig = sig; renderChat(false); }
  }

  // ---------- netværk ----------
  async function api(payload) {
    payload.site = SITE; // ét sted, så intet kald kan glemme hvilket marked det er
    var res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return res.json();
  }

  async function doPoll() {
    if (!convId) return; // ingen samtale endnu, så intet at hente
    try {
      var data = await api({ action: 'poll', conversationId: convId, have: serverMsgs.length });
      if (data && data.unchanged) {
        var nh = !!data.needsHuman;
        if (!!data.human !== human || nh !== needsHuman) { human = !!data.human; needsHuman = nh; renderChat(false); }
        return;
      }
      applyState(data);
    } catch (e) {}
  }
  function startPolling() {
    stopPolling();
    doPoll();
    pollTimer = setInterval(doPoll, 4000);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  async function send() {
    var text = ta.value.trim();
    if (!text || busy) return;
    ta.value = ''; ta.style.height = 'auto';
    var history = serverMsgs.slice(); // hele den nuværende historik (sendes med til kontekst)
    // optimistisk
    serverMsgs.push({ role: 'user', content: text });
    renderChat(true);
    busy = true; sendBtn.disabled = true;
    try {
      var data = await api({ action: 'send', conversationId: sikrId(), email: email, content: text, history: history });
      lastSig = '';           // tving gen-tegning
      applyState(data);
    } catch (e) {
      renderChat(false);
      body.insertAdjacentHTML('beforeend', rowHTML('assistant', T.netfejl));
      body.scrollTop = body.scrollHeight;
    } finally {
      busy = false; sendBtn.disabled = false; ta.focus();
    }
  }

  // ---------- UI-events ----------
  var nudge = root.querySelector('.nudge');
  var nudgeDone = false;
  try { nudgeDone = sessionStorage.getItem(TEASERNØGLE) === '1'; } catch (e) {}
  function dismissNudge() { nudge.classList.remove('show'); nudgeDone = true; try { sessionStorage.setItem(TEASERNØGLE, '1'); } catch (e) {} }

  function open() {
    panel.classList.add('open');
    launcher.setAttribute('aria-expanded', 'true');
    if (fuldSkaerm()) panel.setAttribute('aria-modal', 'true'); else panel.removeAttribute('aria-modal');
    dismissNudge();
    // Fri chat: ingen email-gate — man skriver bare løs
    foot.style.display = 'flex';
    renderChat(false);
    startPolling();
    // på touch får selve vinduet fokus i stedet for feltet, så skærmlæsere er i chatten uden at tastaturet åbner
    setTimeout(function () { if (harHover()) ta.focus(); else panel.focus(); }, 200);
  }
  function close() {
    panel.classList.remove('open');
    panel.removeAttribute('aria-modal');
    launcher.setAttribute('aria-expanded', 'false');
    stopPolling();
  }
  // Lukkes chatten fra tastaturet eller krydset, kommer fokus tilbage til boblen
  function lukOgTilbage() { close(); launcher.focus(); }
  // Fokusfælde i fuld skærm: Tab fra det sidste går til det første og omvendt, aldrig ud til siden bagved
  function faelde(e) {
    var ting = Array.prototype.filter.call(panel.querySelectorAll('button, textarea, input, a[href]'), function (el) {
      return !el.disabled && el.getClientRects().length > 0;
    });
    if (!ting.length) return;
    var foerste = ting[0], sidste = ting[ting.length - 1], aktiv = root.activeElement;
    var inde = aktiv && aktiv !== panel && panel.contains(aktiv);
    if (e.shiftKey && (!inde || aktiv === foerste)) { e.preventDefault(); sidste.focus(); }
    else if (!e.shiftKey && (!inde || aktiv === sidste)) { e.preventDefault(); foerste.focus(); }
  }
  root.addEventListener('keydown', function (e) {
    if (!panel.classList.contains('open')) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); lukOgTilbage(); return; }
    if (e.key === 'Tab' && fuldSkaerm()) faelde(e);
  });
  function toggle() { panel.classList.contains('open') ? close() : open(); }

  launcher.addEventListener('click', toggle);
  closeBtn.addEventListener('click', lukOgTilbage);
  ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'; });
  ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  sendBtn.addEventListener('click', send);

  // Klik på hurtig-svar-knap eller tommel (event-delegation, da body gen-tegnes)
  body.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('.chip') : null;
    if (chip) {
      var q = chip.getAttribute('data-q');
      try { api({ action: 'track', kind: 'chip', label: q }); } catch (e2) {} // klik-statistik (fire-and-forget)
      ta.value = q; send(); return;
    }
    var fb = e.target.closest ? e.target.closest('[data-fb]') : null;
    if (fb) { giveFeedback(parseInt(fb.getAttribute('data-i'), 10), fb.getAttribute('data-fb') === 'up' ? 1 : -1); }
  });

  // Nudge-teaser efter 15 sek (kun hvis chatten ikke er åbnet)
  nudge.addEventListener('click', function (e) {
    if (e.target.classList.contains('nx')) { e.stopPropagation(); dismissNudge(); return; }
    open();
  });
  setTimeout(function () {
    if (nudgeDone || panel.classList.contains('open')) return;
    // Vælg teaser efter hvor langt brugeren er scrollet (top = generel, midt = familie, bund = pris)
    try {
      var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      var frac = Math.min(1, Math.max(0, (window.scrollY || 0) / max));
      var msg = frac > 0.65 ? NUDGES[2] : (frac > 0.25 ? NUDGES[1] : NUDGES[0]);
      var t = nudge.querySelector('.ntxt'); if (t) t.textContent = msg;
    } catch (e) {}
    nudge.classList.add('show');
  }, 15000);
})();
