'use strict';
/**
 * Egen besøgstæller, live og uden cookies. Til voreshjem.dk eller unserzuhauseapp.de efter SIDE
 * (lib/side.js). Hver backend taeller kun sin egen side og skriver i sin egen database.
 *
 * Siden sender ét lille signal pr. sidevisning. Her gemmes kun:
 *   hvilken side, hvor de kom fra (kun domænet, eller utm_source, hvis den ikke er en mailadresse),
 *   mobil eller computer, land, kampagnenavnet fra adressen (utm_campaign, kun bogstaver, tal og bindestreg),
 *   og et gæste-id, der er et hash af IP og browser plus en hemmelighed, som
 *   skifter hvert døgn. IP-adressen gemmes aldrig, og id'et kan ikke føres
 *   tilbage til en person eller følges fra dag til dag.
 * Intet gemmes på den besøgendes enhed. Robotter tælles ikke.
 *
 * Hemmeligheden skifter ved dansk midnat, ikke UTC-midnat, saa én person
 * er ét id hele den danske dag. Derfor kan tælleren ikke genkende den samme
 * person fra dag til dag: "besøgende" over flere dage er dagene lagt sammen.
 */
const crypto = require('crypto');
const { sql } = require('../lib/db.js');
const profil = require('../lib/side.js');
// kanalerne (Organisk søgning, AI-assistenter, E-mail ...) bor i lib/kanal.js, så panelet kan regne gamle rækker om
const { kanal } = require('../lib/kanal.js');

// kun signaler fra sidens egne adresser. Den anden side har sin egen backend og sin egen database.
const TILLADT = profil.tilladt;
// henvisninger herfra er klik inde paa siden. Et link fra den anden side er en rigtig henvisning.
const EGEN = profil.egen;
const ROBOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|curl|wget|python|node|axios|go-http|java\/|headless|lighthouse|pagespeed|google-inspectiontool|apis-google|mediapartners|feedfetcher|monitor|uptime|netlify|chrome-lighthouse|gtmetrix|pingdom/i;

let klar = false;
async function tabel() {
  if (klar) return;
  await sql`CREATE TABLE IF NOT EXISTS vh_besoeg (
    id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    sti TEXT NOT NULL, kilde TEXT NOT NULL DEFAULT '', kanal TEXT NOT NULL DEFAULT 'Direct',
    enhed TEXT NOT NULL DEFAULT 'desktop', land TEXT NOT NULL DEFAULT '', gaest TEXT NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS vh_besoeg_ts ON vh_besoeg (ts)`;
  await sql`CREATE TABLE IF NOT EXISTS vh_klik (
    id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    sti TEXT NOT NULL, sted TEXT NOT NULL DEFAULT '', butik TEXT NOT NULL DEFAULT '',
    enhed TEXT NOT NULL DEFAULT 'desktop', gaest TEXT NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS vh_klik_ts ON vh_klik (ts)`;
  // 404-siden melder sig selv (nf), saa doede adresser kan findes for alle besoegende,
  // ikke kun dem der siger ja til cookies. Kampagnenavnet (utm_campaign) gemmes ved besoeget (fund S64).
  // Kolonnerne tilfoejes kun, hvis de mangler, saa tabellen ikke laases ved hver kold start.
  const kol = (await sql`SELECT column_name AS k FROM information_schema.columns WHERE table_name = 'vh_besoeg' AND column_name IN ('ikkefundet', 'kampagne', 'browser')`).map(r => r.k);
  if (!kol.includes('ikkefundet')) await sql`ALTER TABLE vh_besoeg ADD COLUMN IF NOT EXISTS ikkefundet BOOLEAN NOT NULL DEFAULT false`;
  if (!kol.includes('kampagne')) await sql`ALTER TABLE vh_besoeg ADD COLUMN IF NOT EXISTS kampagne TEXT NOT NULL DEFAULT ''`;
  // browserfamilien (fx "Facebook-app · iOS"), saa man kan se, om besoeg fra en annonce opfoerer sig anderledes (20. okt.)
  if (!kol.includes('browser')) await sql`ALTER TABLE vh_besoeg ADD COLUMN IF NOT EXISTS browser TEXT NOT NULL DEFAULT ''`;
  // Hvor laenge de besoegende bliver, om de ruller, og fejl paa rigtige telefoner (20. okt. 2026).
  // Kun haendelser og browserfamilie, intet om personen. Slettes efter 90 dage som resten (ryd.js).
  await sql`CREATE TABLE IF NOT EXISTS vh_adfaerd (
    id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    sti TEXT NOT NULL, haendelse TEXT NOT NULL, detalje TEXT NOT NULL DEFAULT '',
    browser TEXT NOT NULL DEFAULT '', enhed TEXT NOT NULL DEFAULT 'desktop', gaest TEXT NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS vh_adfaerd_ts ON vh_adfaerd (ts)`;
  klar = true;
}

/* Browserfamilie og styresystem, fx "Facebook-app · iOS". Kun familien gemmes, aldrig hele browserteksten. */
function browserNavn(ua) {
  const u = String(ua || '');
  const os = /iPhone|iPad|iPod/.test(u) ? 'iOS' : /Android/.test(u) ? 'Android' : /Macintosh|Mac OS X/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : 'andet';
  const b = /FBAN|FBAV|FB_IAB|FBIOS/.test(u) ? 'Facebook-app' : /Instagram/.test(u) ? 'Instagram-app' : /musical_ly|BytedanceWebview|TikTok/i.test(u) ? 'TikTok-app'
    : /Snapchat/i.test(u) ? 'Snapchat-app' : /LinkedInApp/i.test(u) ? 'LinkedIn-app' : /Pinterest/i.test(u) ? 'Pinterest-app'
    : /SamsungBrowser/.test(u) ? 'Samsung Internet' : /EdgA?\/|Edg\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera' : /Firefox|FxiOS/.test(u) ? 'Firefox'
    : /CriOS|Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'anden browser';
  return b + ' · ' + os;
}

/* En fejltekst fra en besoegendes browser: kun selve beskeden og filen, uden adressefelter (?...) og uden noget, der ligner en mailadresse. */
function rensFejl(t) {
  return String(t || '').replace(/https?:\/\/[^\s'")]+/g, m => m.replace(/[?#].*$/, '')).replace(/\S+@\S+/g, '[mail]')
    .replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function vaert(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }

/* Kanalen for et besoeg: lib/kanal.js. Samme navne som Google Analytics plus 'AI' (AI-assistenter, fund G12),
   'Intern' (et klik fra én side paa siden til en anden, aldrig en indgang) og 'Paid Other'. */

/* Kampagnenavnet fra adressen (utm_campaign), fx 'trifold' fra brochuren eller et kampagne-ID fra Meta.
   Afkortet og kun bogstaver, tal og bindestreg. Ligner det en mailadresse, gemmes det ikke. */
function kampagneNavn(v) {
  const s = String(v || '').normalize('NFC').toLowerCase();
  if (!s || /@/.test(s)) return '';
  return s.replace(/[\s_+.]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').replace(/-+/g, '-').replace(/^-+/, '').slice(0, 60).replace(/-+$/, '');
}

/* Dansk kalenderdato, 'YYYY-MM-DD'. Bruges til gæste-id'ets daglige hemmelighed. */
const DK_DATO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });
const danskDato = () => { const p = {}; DK_DATO.formatToParts(new Date()).forEach(x => { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day; };

const svar = (kode, oprindelse) => ({ statusCode: kode, body: '', headers: {
  'Access-Control-Allow-Origin': oprindelse || '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' } });

/* Det, der maerker en besoegende uden at gemme noget om dem: enhed og dagens gaeste-id.
   Bruges ogsaa af hent.js, saa et tryk paa en hent-knap faar samme id som besoeget. */
function maerk(h) {
  const ua = String(h['user-agent'] || '');
  const enhed = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop';
  const ip = String(h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim();
  // ny hemmelighed ved dansk midnat, saa id'et passer med de danske datoer i panelet
  const salt = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'vh').update('taeller:' + danskDato()).digest('hex');
  const gaest = crypto.createHash('sha256').update(salt + '|' + ip + '|' + ua).digest('hex').slice(0, 20);
  return { ua, robot: !ua || ROBOT.test(ua), enhed, gaest };
}

exports.handler = async (ev) => {
  const h = ev.headers || {};
  const oprindelse = h.origin || '';
  if (ev.httpMethod === 'OPTIONS') return svar(204, oprindelse);
  if (ev.httpMethod !== 'POST' || !sql) return svar(204, oprindelse);
  try {
    const ua = String(h['user-agent'] || '');
    if (!ua || ROBOT.test(ua)) return svar(204, oprindelse);
    const fra = vaert(oprindelse || h.referer || '');
    if (!TILLADT.test(fra)) return svar(204, oprindelse);

    let k = {}; try { k = JSON.parse(ev.body || '{}'); } catch (e) {}
    let side; try { side = new URL(String(k.u || '')); } catch (e) { return svar(204, oprindelse); }
    if (!TILLADT.test(side.hostname)) return svar(204, oprindelse);
    const sti = profil.sti(side.hostname, decodeURIComponent(side.pathname || '/')).slice(0, 200);
    const utm = { source: side.searchParams.get('utm_source') || '', medium: side.searchParams.get('utm_medium') || '' };
    const kampagne = kampagneNavn(side.searchParams.get('utm_campaign'));
    let kilde = vaert(String(k.r || ''));
    // kom de fra en anden side paa samme site, er det et klik inde paa siden og ikke en kilde.
    // Har adressen utm-felter, er det alligevel en ny indgang (som hos Google), fx en annonce,
    // der sender videre via en af sidens egne adresser.
    const egen = !!kilde && EGEN.test(kilde);
    const intern = egen && !utm.source && !utm.medium;
    if (egen) kilde = '';
    // utm_source gemmes kun, hvis den ikke ligner en mailadresse (samme regel som kampagnen). Kanalen
    // regnes stadig ud fra den, men selve vaerdien gemmes ikke.
    if (!kilde && utm.source && !/@/.test(utm.source)) kilde = utm.source.toLowerCase().slice(0, 60);
    const ikkefundet = k.nf === 1 || k.nf === true;

    const { enhed, gaest } = maerk(h);
    const land = String(h['x-country'] || '').toUpperCase().slice(0, 2);

    await tabel();
    if (k.k === 'adf') {
      // hvor laenge de blev, om de rullede, eller en fejl paa deres telefon (sendes af siden selv, hoejst én gang pr. side og haendelse)
      const h2 = String(k.h || '');
      if (!['10s', '30s', '60s', 'rul25', 'rul50', 'rul90', 'fejl'].includes(h2)) return svar(204, oprindelse);
      const detalje = h2 === 'fejl' ? rensFejl(k.d) : '';
      if (h2 === 'fejl' && !detalje) return svar(204, oprindelse);
      await sql`INSERT INTO vh_adfaerd (sti, haendelse, detalje, browser, enhed, gaest) VALUES (${sti}, ${h2}, ${detalje}, ${browserNavn(ua)}, ${enhed}, ${gaest})`;
      return svar(204, oprindelse);
    }
    if (k.k === 'klik') {
      // et klik paa en hent-knap: hvor paa siden, og hvilken butik
      const sted = String(k.sted || '').replace(/[^\w\u00C0-\u017F .:-]/g, '').slice(0, 60);
      let butik = ['app','appstore','googleplay'].includes(k.butik) ? k.butik : '';
      if (!butik) return svar(204, oprindelse);
      // "app" vaelger selv butik efter enheden. Skriv den butik ned, som enheden faktisk sendes til.
      if (butik === 'app') butik = /iPhone|iPad|iPod/i.test(ua) ? 'appstore' : /Android/i.test(ua) ? 'googleplay' : 'hentside';
      await sql`INSERT INTO vh_klik (sti, sted, butik, enhed, gaest) VALUES (${sti}, ${sted}, ${butik}, ${enhed}, ${gaest})`;
      return svar(204, oprindelse);
    }
    await sql`INSERT INTO vh_besoeg (sti, kilde, kanal, enhed, land, gaest, ikkefundet, kampagne, browser)
      VALUES (${sti}, ${kilde}, ${kanal(kilde, utm, intern)}, ${enhed}, ${land}, ${gaest}, ${ikkefundet}, ${kampagne}, ${browserNavn(ua)})`;
  } catch (e) { /* tælleren må aldrig give fejl på siden */ }
  return svar(204, oprindelse);
};

exports.maerk = maerk;
exports.tabel = tabel;
exports.kampagneNavn = kampagneNavn;
exports.browserNavn = browserNavn;
exports.rensFejl = rensFejl;
