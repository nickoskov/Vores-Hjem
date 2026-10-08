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
    // maa tage en database med data, men uden ejermaerke (den danske havde data foer maerket)
    overtagData: true,
    skjul: [],
    ental: 'danske'
  },
  de: {
    kode: 'de', brand: 'Unser Zuhause', navn: 'unserzuhauseapp.de',
    site: 'https://www.unserzuhauseapp.de', backend: 'https://backend.unserzuhauseapp.de',
    netlifySiteId: 'dee37d6a-eb69-4f6c-a2e9-ef20e9076531', backendSiteId: '571ab434-e15f-4851-a728-a3ed7169b3d1',
    tilladt: /(^|\.)unserzuhauseapp\.de$|^verdant-strudel-af7a88\.netlify\.app$/i,
    egen: /(^|\.)unserzuhauseapp\.de$|^verdant-strudel-af7a88\.netlify\.app$/i,
    chat: 'de',
    appStoreId: '6771931999', playPakke: 'com.unserzuhause.app',
    butik: { appstore: 'https://apps.apple.com/de/app/unser-zuhause/id6771931999',
      googleplay: 'https://play.google.com/store/apps/details?id=com.unserzuhause.app&hl=de&gl=DE&referrer=utm_source%3Dwebsite',
      hentside: 'https://unserzuhause-download.netlify.app/' },
    kendetegn: /Unser Zuhause/i,
    brandSoeg: /(^| )unser ?zuhau?se?(app)?(?= )/, brandEksempel: 'unser zuhause',
    ga4Kode: null,
    taellerKilde: 'taeller.js, som unserzuhauseapp.de henter fra sin egen mappe (unserzuhause/taeller.js i repoet)',
    kontakt: { kilde: 'unserzuhauseapp.de (tysk)', emne: 'Unser Zuhause', hvor: ' på den tyske side' },
    // chatbotten er faelles og har sine tabeller i den danske database. Den tyske backend spoerger botten.
    botTabeller: false,
    overtagData: false,
    // sider i panelet, der kun giver mening for den danske side. Chat: den tyske side har intet
    // chatvindue. Faar den et, skal det have sin egen bot med tabeller i den tyske database.
    skjul: ['blog', 'links', 'indhold', 'annoncer', 'chat'],
    ental: 'tyske'
  }
};

const raa = String(process.env.SIDE || 'dk').trim().toLowerCase();
const kode = PROFILER[raa] ? raa : 'dk';
const profil = PROFILER[kode];

module.exports = {
  ...profil,
  anden: PROFILER[kode === 'dk' ? 'de' : 'dk'],
  // en SIDE, ingen profil kender: databasen bruges slet ikke (db.js), saa intet havner forkert
  ugyldig: PROFILER[raa] ? null : 'SIDE=' + String(process.env.SIDE).slice(0, 20) + ' kendes ikke. Brug dk eller de.',
  // det Netlify-site, funktionen koerer paa, hvis Netlify fortaeller det (v2.mjs gemmer det fra context.site)
  netlifySite: () => process.env.VH_NETLIFY_SITE || process.env.SITE_ID || '',
  // det panelet maa se (status er offentlig, saa kun det, der alligevel staar paa siden)
  offentlig: () => ({ kode: profil.kode, brand: profil.brand, navn: profil.navn, site: profil.site, backend: profil.backend,
    chat: profil.chat, skjul: profil.skjul.slice() })
};
