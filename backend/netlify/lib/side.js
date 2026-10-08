'use strict';
/**
 * Hvilken side denne backend hoerer til. Samme kode udgives to gange og vaelges med SIDE:
 *   SIDE=dk (eller ingen)  backend.voreshjem.dk til www.voreshjem.dk
 *   SIDE=de                backend.unserzuhauseapp.de til www.unserzuhauseapp.de
 * Hver har sin egen database, sit eget panel og sit eget login, og data maa aldrig blandes.
 * db.js stempler databasen med profilens kode (vh_side) og naegter en database, der hoerer
 * til den anden.
 *
 * Miljoevariablerne vinder stadig over profilen, der hvor de bruges: SITE_URL, VAGT_URL, SEO_SITE,
 * GSC_SITE_URL, SITE_NETLIFY_ID, BOT_URL, ALERT_FROM, ASC_APP_ID og GPLAY_PACKAGE.
 * Undtagelse: BOT_URL og BOT_ADMIN_PASSWORD bruges ikke paa en backend med sin egen bot (botEgen, se lib/bot.js).
 */
const PROFILER = {
  dk: {
    kode: 'dk', brand: 'Vores Hjem', navn: 'voreshjem.dk',
    site: 'https://www.voreshjem.dk', backend: 'https://backend.voreshjem.dk',
    // selve siden (udgivelse fra panelet) og backenden selv, begge hos Netlify
    netlifySiteId: 'fff8c0f6-c7e6-42c1-889d-8e128f9f070b', backendSiteId: 'd34e1582-bbea-4f03-91a9-f23119ea4a35',
    // hvorfra taelleren og kontaktformularen tager imod
    tilladt: /(^|\.)voreshjem\.dk$|^stirring-cactus-7010c5\.netlify\.app$/i,
    // henvisninger herfra er klik inde paa siden. Botten viser den danske hent-side.
    egen: /(^|\.)voreshjem\.dk$|^stirring-cactus-7010c5\.netlify\.app$|^voreshjem-bot\.netlify\.app$/i,
    chat: 'dk',
    // blokeringsvagten (blokvagt.js) slaar disse op gennem de offentlige sikkerhedsfiltre hver morgen
    vagtAdresser: ['www.voreshjem.dk', 'voreshjem.dk', 'backend.voreshjem.dk', 'download.voreshjem.dk'],
    appStoreId: '6758346281', playPakke: 'com.voreshjem.app',
    // hent-knappen (hent.js): telefonen sendes til sin butik, en computer til hent-siden
    butik: { appstore: 'https://apps.apple.com/dk/app/vores-hjem/id6758346281',
      googleplay: 'https://play.google.com/store/apps/details?id=com.voreshjem.app&referrer=utm_source%3Dwebsite',
      hentside: 'https://www.voreshjem.dk/hent/' },
    // oppetidsvagten: forsiden skal indeholde det her, ellers er det en fejlside fra hosten
    kendetegn: /Vores Hjem/i,
    // soegninger paa eget navn: 'vores hjem', 'voreshjem', 'voreshjem.dk', 'vore hjem' ...
    brandSoeg: /(^| )vore?s? ?hje?m(app|dk)?(?= )/, brandEksempel: 'vores hjem',
    ga4Kode: 'G-ZFW1KE91LV',
    taellerKilde: 'hentknap.js, som voreshjem.dk henter fra voreshjem-bot.netlify.app',
    kontakt: { kilde: 'voreshjem.dk/support', emne: 'support', hvor: '' },
    // chatbottens tabeller (vh_conversations ...) ligger i denne database
    botTabeller: true,
    // botten er den faelles voreshjem-bot.netlify.app (lib/bot.js, BOT_URL), ikke en funktion i denne backend
    botEgen: false,
    // maa tage en database med data, men uden ejermaerke (den danske havde data foer maerket)
    overtagData: true,
    skjul: [],
    ental: 'danske'
  },
  de: {
    kode: 'de', brand: 'Unser Zuhause', navn: 'unserzuhauseapp.de',
    site: 'https://www.unserzuhauseapp.de', backend: 'https://backend.unserzuhauseapp.de',
    netlifySiteId: 'dee37d6a-eb69-4f6c-a2e9-ef20e9076531', backendSiteId: '571ab434-e15f-4851-a728-a3ed7169b3d1',
    // download-siden (unserzuhause-download.netlify.app, hvor bio-links peger hen) taelles med som /download
    tilladt: /(^|\.)unserzuhauseapp\.de$|^verdant-strudel-af7a88\.netlify\.app$|^unserzuhause-download\.netlify\.app$/i,
    egen: /(^|\.)unserzuhauseapp\.de$|^verdant-strudel-af7a88\.netlify\.app$|^unserzuhause-download\.netlify\.app$/i,
    foran: { 'unserzuhause-download.netlify.app': '/download' },
    chat: 'de',
    vagtAdresser: ['www.unserzuhauseapp.de', 'unserzuhauseapp.de', 'backend.unserzuhauseapp.de', 'download.unserzuhauseapp.de', 'unserzuhause-download.netlify.app'],
    appStoreId: '6771931999', playPakke: 'com.unserzuhause.app',
    butik: { appstore: 'https://apps.apple.com/de/app/unser-zuhause/id6771931999',
      googleplay: 'https://play.google.com/store/apps/details?id=com.unserzuhause.app&hl=de&gl=DE&referrer=utm_source%3Dwebsite',
      hentside: 'https://unserzuhause-download.netlify.app/' },
    kendetegn: /Unser Zuhause/i,
    brandSoeg: /(^| )unser ?zuhau?se?(app)?(?= )/, brandEksempel: 'unser zuhause',
    ga4Kode: null,
    taellerKilde: 'taeller.js, som unserzuhauseapp.de henter fra sin egen mappe (unserzuhause/taeller.js i repoet)',
    kontakt: { kilde: 'unserzuhauseapp.de (tysk)', emne: 'Unser Zuhause', hvor: ' på den tyske side' },
    // den tyske side har sin egen chatbot i denne backend: samme kode som den danske bot, men kun tysk,
    // med tabellerne i den tyske database (functions-de/chat-bot.mjs, udgives kun med udgiv-backend.mjs --de).
    // lib/bot.js taler med den og aldrig med den danske bot.
    botTabeller: true,
    botEgen: true,
    overtagData: false,
    // sider i panelet, der kun giver mening for den danske side
    skjul: ['blog', 'links', 'indhold', 'annoncer'],
    ental: 'tyske',
    // support-mail oversat begge veje (lib/sager.js, handlers/postkasse.js). Kunden skriver og faar svar paa
    // tysk fra support-postkassen, teamet laeser og svarer paa dansk. Kun her, saa den danske backend intet goer.
    support: {
      kundeSprog: 'de', teamSprog: 'da', praefiks: 'UZ', afsender: 'Unser Zuhause',
      tidszone: 'Europe/Berlin',
      svarEmne: 'AW: ', udenEmne: '(ohne Betreff)',
      kvittering: {
        emne: 'Danke für deine Nachricht',
        tekst: 'Hallo,\n\ndanke für deine Nachricht an Unser Zuhause. Wir haben sie erhalten und antworten dir innerhalb von 1 bis 2 Werktagen.\n\n' +
          'Viele Antworten findest du schon jetzt auf unserer Hilfeseite: https://www.unserzuhauseapp.de/support\n\nViele Grüße\ndein Team von Unser Zuhause'
      },
      // citatlinjen over kundens egen besked i svaret: 'Am 8. Oktober 2026 um 18:02 schrieb Max <max@...>:'
      citat: (dato, hvem) => 'Am ' + dato + ' schrieb ' + hvem + ':',
      datoSprog: 'de-DE'
    }
  }
};

const raa = String(process.env.SIDE || 'dk').trim().toLowerCase();
const kode = PROFILER[raa] ? raa : 'dk';
const profil = PROFILER[kode];

module.exports = {
  ...profil,
  support: profil.support || null,
  anden: PROFILER[kode === 'dk' ? 'de' : 'dk'],
  // en SIDE, ingen profil kender: databasen bruges slet ikke (db.js), saa intet havner forkert
  ugyldig: PROFILER[raa] ? null : 'SIDE=' + String(process.env.SIDE).slice(0, 20) + ' kendes ikke. Brug dk eller de.',
  // det Netlify-site, funktionen koerer paa, hvis Netlify fortaeller det (v2.mjs gemmer det fra context.site)
  netlifySite: () => process.env.VH_NETLIFY_SITE || process.env.SITE_ID || '',
  // det panelet maa se (status er offentlig, saa kun det, der alligevel staar paa siden)
  // stien, som den gemmes: en side paa en anden vaert end selve siden (fx download-siden) faar sit
  // eget stykke foran, saa dens forside ikke blandes med sidens forside
  sti: (vaert, sti) => { const f = (profil.foran || {})[String(vaert || '').toLowerCase().replace(/^www\./, '')];
    return f ? f + (sti === '/' ? '' : sti) : sti; },
  offentlig: () => ({ kode: profil.kode, brand: profil.brand, navn: profil.navn, site: profil.site, backend: profil.backend,
    chat: profil.chat, skjul: profil.skjul.slice() })
};
