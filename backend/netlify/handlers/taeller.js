'use strict';
/**
 * Egen besøgstæller til voreshjem.dk. Live, uden cookies.
 *
 * Siden sender ét lille signal pr. sidevisning. Her gemmes kun:
 *   hvilken side, hvor de kom fra (kun domænet), mobil eller computer, land,
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

const TILLADT = /(^|\.)voreshjem\.dk$|^stirring-cactus-7010c5\.netlify\.app$|(^|\.)unserzuhauseapp\.de$|^verdant-strudel-af7a88\.netlify\.app$/i;
// Den tyske side (unserzuhauseapp.de) gemmes i egne tabeller (vh_besoeg_de, vh_klik_de), saa tallene
// aldrig blandes med de danske.
const TYSK = /(^|\.)unserzuhauseapp\.de$|^verdant-strudel-af7a88\.netlify\.app$/i;
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
  // ikke kun dem der siger ja til cookies. Kolonnen tilfoejes kun, hvis den mangler,
  // saa tabellen ikke laases ved hver kold start.
  const kol = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'vh_besoeg' AND column_name = 'ikkefundet'`;
  if (!kol.length) await sql`ALTER TABLE vh_besoeg ADD COLUMN IF NOT EXISTS ikkefundet BOOLEAN NOT NULL DEFAULT false`;
  // samme tabeller for den tyske side
  await sql`CREATE TABLE IF NOT EXISTS vh_besoeg_de (
    id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    sti TEXT NOT NULL, kilde TEXT NOT NULL DEFAULT '', kanal TEXT NOT NULL DEFAULT 'Direct',
    enhed TEXT NOT NULL DEFAULT 'desktop', land TEXT NOT NULL DEFAULT '', gaest TEXT NOT NULL,
    ikkefundet BOOLEAN NOT NULL DEFAULT false)`;
  await sql`CREATE INDEX IF NOT EXISTS vh_besoeg_de_ts ON vh_besoeg_de (ts)`;
  await sql`CREATE TABLE IF NOT EXISTS vh_klik_de (
    id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    sti TEXT NOT NULL, sted TEXT NOT NULL DEFAULT '', butik TEXT NOT NULL DEFAULT '',
    enhed TEXT NOT NULL DEFAULT 'desktop', gaest TEXT NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS vh_klik_de_ts ON vh_klik_de (ts)`;
  klar = true;
}

function vaert(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }

/* Samme kanalnavne som Google Analytics, så panelet oversætter dem ens. To undtagelser:
   'Intern' er et klik fra én side på voreshjem.dk til en anden. Det er aldrig en indgang
   til siden, så panelet tæller kilder på hver gæsts første visning på dagen.
   'Paid Other' er betalt trafik, hvor vi ikke kan se, hvem der betalte for den. */
const SOCIAL = /facebook|instagram|threads|messenger|tiktok|linkedin|pinterest|reddit|youtube|snapchat|(^|\.)x\.com$|twitter|(^|\.)t\.co$|lnkd/;
// Metas egne korte kildekoder ({{site_source_name}}): fb, ig, an (Audience Network, reklamer i apps),
// msg (Messenger) og th (Threads). De skal matches som hele ord, så fx 'digital' ikke bliver Instagram.
const META_KODE = /(^|[^a-z])(fb|ig|an|msg|th)([^a-z]|$)/;
const erSocial = s => !!s && (SOCIAL.test(s) || /meta/.test(s) || META_KODE.test(s));
const erSoegemaskine = s => /google|bing|adwords|microsoft|yahoo|duckduckgo|ecosia/.test(s || '');

function kanal(kilde, utm, intern) {
  if (intern) return 'Intern';
  const src = (utm.source || '').toLowerCase(), med = (utm.medium || '').toLowerCase();
  if (/cpc|cpm|ppc|paid|annonce|retargeting/.test(med)) {
    // utm_source vinder. Mangler den, bruges den side, de kom fra.
    const hvem = src || kilde;
    if (erSocial(hvem)) return 'Paid Social';
    if (erSoegemaskine(hvem)) return 'Paid Search';
    return 'Paid Other';
  }
  if (/e-?mail|newsletter|nyhedsbrev/.test(med + ' ' + src)) return 'Email';
  if (/^social|social-?media|^sm$/.test(med)) return 'Organic Social';
  const k = kilde || src;
  if (!k) return 'Direct';
  if (/google\.|bing\.|duckduckgo|yahoo\.|ecosia|startpage|search\./.test(k)) return 'Organic Search';
  // kilde er utm_source, naar der ingen henvisning var. En kode uden punktum (fb, ig, an) er Meta.
  if (SOCIAL.test(k) || (!/\./.test(k) && META_KODE.test(k))) return 'Organic Social';
  if (/chatgpt|openai|perplexity|claude\.ai|gemini|copilot/.test(k)) return 'Referral';
  if (/mail\.|outlook|gmail/.test(k)) return 'Email';
  return 'Referral';
}

/* Dansk kalenderdato, 'YYYY-MM-DD'. Bruges til gæste-id'ets daglige hemmelighed. */
const DK_DATO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });
const danskDato = () => { const p = {}; DK_DATO.formatToParts(new Date()).forEach(x => { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day; };

const svar = (kode, oprindelse) => ({ statusCode: kode, body: '', headers: {
  'Access-Control-Allow-Origin': oprindelse || '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' } });

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
    const sti = decodeURIComponent(side.pathname || '/').slice(0, 200);
    const utm = { source: side.searchParams.get('utm_source') || '', medium: side.searchParams.get('utm_medium') || '' };
    let kilde = vaert(String(k.r || ''));
    // kom de fra en anden side paa voreshjem.dk, er det et klik inde paa siden og ikke en kilde.
    // Har adressen utm-felter, er det alligevel en ny indgang (som hos Google), fx en annonce,
    // der sender videre via en af sidens egne adresser.
    const tysk = TYSK.test(side.hostname);
    // egen side = samme site; et link fra voreshjem.dk til den tyske side er en rigtig henvisning
    const egen = !!kilde && (tysk ? TYSK.test(kilde) : (TILLADT.test(kilde) && !TYSK.test(kilde)) || kilde === 'voreshjem-bot.netlify.app');
    const intern = egen && !utm.source && !utm.medium;
    if (egen) kilde = '';
    if (!kilde && utm.source) kilde = utm.source.toLowerCase().slice(0, 60);
    const ikkefundet = k.nf === 1 || k.nf === true;

    const enhed = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop';
    const land = String(h['x-country'] || '').toUpperCase().slice(0, 2);
    const ip = String(h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim();
    // ny hemmelighed ved dansk midnat, saa id'et passer med de danske datoer i panelet
    const dag = danskDato();
    const salt = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'vh').update('taeller:' + dag).digest('hex');
    const gaest = crypto.createHash('sha256').update(salt + '|' + ip + '|' + ua).digest('hex').slice(0, 20);

    await tabel();
    if (k.k === 'klik') {
      // et klik paa en hent-knap: hvor paa siden, og hvilken butik
      const sted = String(k.sted || '').replace(/[^\w\u00C0-\u017F .:-]/g, '').slice(0, 60);
      let butik = ['app','appstore','googleplay'].includes(k.butik) ? k.butik : '';
      if (!butik) return svar(204, oprindelse);
      // "app" vaelger selv butik efter enheden. Skriv den butik ned, som enheden faktisk sendes til.
      if (butik === 'app') butik = /iPhone|iPad|iPod/i.test(ua) ? 'appstore' : /Android/i.test(ua) ? 'googleplay' : 'hentside';
      if (tysk) await sql`INSERT INTO vh_klik_de (sti, sted, butik, enhed, gaest) VALUES (${sti}, ${sted}, ${butik}, ${enhed}, ${gaest})`;
      else await sql`INSERT INTO vh_klik (sti, sted, butik, enhed, gaest) VALUES (${sti}, ${sted}, ${butik}, ${enhed}, ${gaest})`;
      return svar(204, oprindelse);
    }
    if (tysk) await sql`INSERT INTO vh_besoeg_de (sti, kilde, kanal, enhed, land, gaest, ikkefundet)
      VALUES (${sti}, ${kilde}, ${kanal(kilde, utm, intern)}, ${enhed}, ${land}, ${gaest}, ${ikkefundet})`;
    else await sql`INSERT INTO vh_besoeg (sti, kilde, kanal, enhed, land, gaest, ikkefundet)
      VALUES (${sti}, ${kilde}, ${kanal(kilde, utm, intern)}, ${enhed}, ${land}, ${gaest}, ${ikkefundet})`;
  } catch (e) { /* tælleren må aldrig give fejl på siden */ }
  return svar(204, oprindelse);
};
