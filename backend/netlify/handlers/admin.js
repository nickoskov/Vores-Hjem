'use strict';
/**
 * Backend til voreshjem.dk. Erstatter det, Wix' panel kunne.
 * Alt går gennem én funktion, som deles op efter handling.
 * Samme kode koerer ogsaa som backend til unserzuhauseapp.de med sin egen database (SIDE=de, se lib/side.js).
 */
const G      = require('../lib/google.js');
const soro = require('../lib/soro.js');
const meta   = require('../lib/meta.js');
const gads   = require('../lib/googleads.js');
const asc    = require('../lib/appstore.js');
const gplay  = require('../lib/googleplay.js');
const mail   = require('../lib/mail.js');
const auth   = require('../lib/auth.js');
const { bot, opsat: botOpsat } = require('../lib/bot.js');
const seo = require('../lib/seo.js');
const forfatter = require('../lib/skriv.js');
const udgivelse = require('../lib/udgiv.js');
const blogbyg = require('../lib/blogbyg.js');
// support-mail oversat begge veje (kun den tyske backend): status til Opsaetning. IMAP-testen henter
// lib/imap.js foerst, naar den bruges, saa panelet ikke starter langsommere.
const sager = require('../lib/sager.js');
// levetider: SEK, MINUT, TIME, DOEGN (millisekunder). MIN er standarden, 5 minutter, og bruges ikke til at gange op.
const { husk, glem, SEK, MINUT, TIME, DOEGN, UDGAVE } = require('../lib/cache.js');
const { sql, opret, log, dbStatus } = require('../lib/db.js');
const profil = require('../lib/side.js');

const svar = (k, d) => ({ statusCode: k,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(d) });

/* ── perioder, altid danske kalenderdage ──────────────────────────────────
   Serveren koerer i UTC. Alt her regnes som datoer i dansk tid (Europe/Copenhagen),
   aldrig som UTC-datoer og aldrig som "nu minus 24 timer", som rammer forkert dag
   ved skift til og fra sommertid. Datoer er tekst 'YYYY-MM-DD'. Hjaelperne deles af
   hele filen, se "admin-1" i KONTRAKT.md. */
const DAGE = { '7d':7, '28d':28, '90d':90, '365d':365 };
const TZ = 'Europe/Copenhagen';
const iso = d => d.toISOString().slice(0,10);
const dkDele = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' });
/** Dansk dato, time og klokkeslaet for et tidspunkt (nu, hvis intet gives). ugedag: mandag = 0. */
function dkNu(t) {
  const o = {}; dkDele.formatToParts(t == null ? new Date() : new Date(t)).forEach(x => o[x.type] = x.value);
  const time = o.hour === '24' ? 0 : Number(o.hour);
  return { dato: o.year + '-' + o.month + '-' + o.day, time, minut: Number(o.minute), sekund: Number(o.second),
    klokke: String(time).padStart(2,'0') + ':' + o.minute + ':' + o.second,
    ugedag: (new Date(Date.UTC(+o.year, +o.month - 1, +o.day)).getUTCDay() + 6) % 7 };
}
const dkIdag = () => dkNu().dato;
/** Kalenderdage frem (n > 0) eller tilbage (n < 0) fra en dato. Regnes paa datoen, ikke paa timer. */
function dagPlus(dato, n) { const [y, m, d] = String(dato).split('-').map(Number); return iso(new Date(Date.UTC(y, m - 1, d + (n || 0)))); }
/** Dansk dato for n dage siden (0 = i dag, 1 = i gaar). */
const datoMinus = n => dagPlus(dkIdag(), -n);
/** Antal dage fra og med fra til og med til. */
const dageMellem = (fra, til) => Math.round((Date.parse(til + 'T00:00:00Z') - Date.parse(fra + 'T00:00:00Z')) / 86400000) + 1;
const gyldigDato = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && dagPlus(s, 0) === s;
function alleDatoer(fra, til) { const u = []; for (let d = fra; d <= til && u.length < 800; d = dagPlus(d, 1)) u.push(d); return u; }
/** '2026-09-16' som '16. sep.' */
const dkTekst = dato => !dato ? '' : new Date(dato + 'T00:00:00Z').toLocaleDateString('da-DK', { day:'numeric', month:'short', timeZone:'UTC' });
/** Afslut en saetning med punktum, uden at faa to, naar den slutter paa en forkortelse som 'sep.' */
const punktum = s => /\.$/.test(s) ? s : s + '.';
/** Et tidspunkt som '15. sep. kl. 22.14' i dansk tid */
const dkTid = t => { if (!t) return ''; const n = dkNu(t); return dkTekst(n.dato) + ' kl. ' + n.klokke.slice(0, 5).replace(':', '.'); };
/** Dansk vaegurstid (dato + 'HH:MM:SS') som rigtigt tidspunkt (ISO), ogsaa paa dage med sommertidsskift */
function dkInstant(dato, klokke) {
  const [y, m, d] = dato.split('-').map(Number), [hh, mm, ss] = String(klokke || '00:00:00').split(':').map(Number);
  const vaeg = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0);
  let t = vaeg;
  for (let i = 0; i < 3; i++) { const n = dkNu(t), [a, b, c] = n.dato.split('-').map(Number);
    t += vaeg - Date.UTC(a, b - 1, c, n.time, n.minut, n.sekund); }
  return new Date(t).toISOString();
}
/** Et vindue i dansk vaegurstid: fra midnat paa fra, til midnat efter til, eller kun til klokke paa til.
    Bruges i SQL som  ts >= (a::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (b::timestamp AT TIME ZONE 'Europe/Copenhagen'). */
const vindue = (fra, til, klokke) => ({ a: fra + ' 00:00:00', b: klokke ? til + ' ' + klokke : dagPlus(til, 1) + ' 00:00:00' });

// Gamle navne, rettet: "i gaar" er kalenderdagen foer, ikke nu minus 24 timer.
function graenserIdag(offsetDage, fuldDag) {
  const nu = dkNu(), d = dagPlus(nu.dato, -(offsetDage || 0));
  return { dato: d.replace(/-/g, ''), iso: d, time: fuldDag ? 23 : nu.time };
}
// timerne fra midnat og til g.time, som GA4's dateHour vil have dem
const timerIdag = g => { const u = []; for (let t = 0; t <= g.time; t++) u.push(g.dato + String(t).padStart(2,'0')); return u; };

/**
 * Perioden for en knap i panelet: '24t' (i dag), 'igaar', '7d', '28d', '90d', '365d' eller 'YYYY-MM-DD:YYYY-MM-DD'.
 * fra/til og foerFra/foerTil er danske datoer. nu/foer er faerdige stykker til Google Analytics.
 * I dag: nu er hele dagen til nu (til lister). nuSml og foer er kun de afsluttede timer i dag og
 * de samme timer i gaar, fordi Google kun kan deles i hele timer (bruges til sammenligning).
 * Kl. 00-01 er der ingen afsluttet time, og ga4SmlOk er false. Den egne taeller sammenligner
 * i stedet paa minuttet: i dag til klokke mod i gaar til samme klokke.
 */
function omfang(n) {
  const nu = dkNu(), idag = nu.dato;
  const ga4 = (fra, til) => ({ dateRanges: [{ startDate: fra, endDate: til }] });
  const timeFilter = (dato, timer) => ({ filter: { fieldName: 'dateHour', inListFilter: { values: timer.map(t => dato.replace(/-/g, '') + String(t).padStart(2, '0')) } } });
  const m = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(String(n || ''));
  if (m && gyldigDato(m[1]) && gyldigDato(m[2]) && m[1] <= m[2] && m[1] <= idag) {
    let fra = m[1], til = m[2], note = null;
    // dagen i dag er ikke faerdig og kan ikke sammenlignes med hele dage
    if (til >= idag) { til = dagPlus(idag, -1); note = 'I dag er ikke færdig, så perioden slutter i går.'; }
    if (til >= fra) {
      const d = dageMellem(fra, til), foerTil = dagPlus(fra, -1), foerFra = dagPlus(fra, -d);
      return { type: 'egne', d, timer: false, egne: true, fra, til, foerFra, foerTil, klokke: null, note,
        visning: dkTekst(fra) + ' til ' + dkTekst(til), sammenlign: 'de ' + d + ' dage før',
        nu: ga4(fra, til), nuSml: ga4(fra, til), foer: ga4(foerFra, foerTil), ga4SmlOk: true, kurveDim: 'date' };
    }
    n = '24t';   // kun i dag var valgt
  }
  if (n === '24t') {
    const h = nu.time, igaar = dagPlus(idag, -1), hele = [];
    for (let t = 0; t < h; t++) hele.push(t);
    const tt = hele.length ? hele : [0];
    return { type: 'idag', d: 1, timer: true, egne: false, fra: idag, til: idag, foerFra: igaar, foerTil: igaar,
      klokke: nu.klokke, time: h, visning: 'I dag', sammenlign: 'i går til samme klokkeslæt', egenOffset: 0, egenFuldDag: false,
      nu: ga4(idag, idag),
      nuSml: { ...ga4(idag, idag), dimensionFilter: timeFilter(idag, tt) },
      foer:  { ...ga4(igaar, igaar), dimensionFilter: timeFilter(igaar, tt) },
      ga4SmlOk: hele.length > 0, ga4Til: hele.length ? String(h).padStart(2, '0') + '.00' : null, kurveDim: 'dateHour' };
  }
  if (n === 'igaar') {
    const i = dagPlus(idag, -1), f = dagPlus(idag, -2);
    return { type: 'igaar', d: 1, timer: true, egne: false, fra: i, til: i, foerFra: f, foerTil: f, klokke: null,
      visning: 'I går', sammenlign: 'i forgårs', egenOffset: 1, egenFuldDag: true,
      nu: ga4(i, i), nuSml: ga4(i, i), foer: ga4(f, f), ga4SmlOk: true, kurveDim: 'dateHour' };
  }
  const d = DAGE[n] || 28;
  // gaarsdagen som slutpunkt: dagen i dag er aldrig faerdig
  const til = dagPlus(idag, -1), fra = dagPlus(idag, -d), foerTil = dagPlus(fra, -1), foerFra = dagPlus(fra, -d);
  return { type: 'dage', d, timer: false, egne: false, fra, til, foerFra, foerTil, klokke: null,
    visning: 'Seneste ' + d + ' dage', sammenlign: 'de ' + d + ' dage før',
    nu: ga4(fra, til), nuSml: ga4(fra, til), foer: ga4(foerFra, foerTil), ga4SmlOk: true, kurveDim: 'date' };
}
// et ekstra filter laegges oven paa periodens eget (hvis den har et)
const medFilter = (p, f) => p.nu.dimensionFilter ? { andGroup: { expressions: [p.nu.dimensionFilter, f] } } : f;

/* ── daekning: hvor meget af en periode en kilde har tal for ──────────────
   start = { tid, dato, heleFra, tekst }. Den foerste dag er ikke hel (kilden startede
   midt paa dagen), saa der regnes fra heleFra. Form som i KONTRAKT.md. */
function daekning(fra, til, start) {
  const af = dageMellem(fra, til);
  if (!start) return { fra: null, til: null, dage: 0, af, hel: false, grund: 'Ingen tal endnu.' };
  const cf = fra < start.heleFra ? start.heleFra : fra;
  if (cf > til) return { fra: null, til: null, dage: 0, af, hel: false, grund: start.tekst + ', så perioden har ingen hele dage med tal.' };
  const dage = dageMellem(cf, til), hel = cf === fra;
  return { fra: cf, til, dage, af, hel,
    grund: hel ? null : start.tekst + ', så kun ' + dage + ' af ' + af + (af === 1 ? ' dag' : ' dage') + ' er med (fra ' + dkTekst(cf) + ').' };
}
const ingenSml = d => 'Ingen sammenligning med perioden før.' + (d && d.grund ? ' ' + d.grund : '');

/** Hvor langt tilbage de egne taellere har tal, regnet ud fra data (aeldste raekke), ikke skrevet ind i koden.
    ryd.js sletter besoeg og klik aeldre end RYD_DAGE (90), saa den aeldste raekke er "aeldste gemte", ikke
    "taelleren startede". Derfor siger teksten "har kun tal fra". */
let startHusk = null;
async function taellerStart() {
  if (!sql) return null;
  if (startHusk && startHusk.t > Date.now() - 10 * 60000) return startHusk.v;
  await opret();   // en ny database har ikke taellerens tabeller, foer det foerste besoeg er kommet ind
  const [b, k] = await Promise.allSettled([sql`SELECT min(ts) AS t FROM vh_besoeg`, sql`SELECT min(ts) AS t FROM vh_klik`]);
  if (b.status === 'rejected') throw b.reason;
  const lav = (x, navn) => {
    const t = x.status === 'fulfilled' && x.value[0] && x.value[0].t; if (!t) return null;
    const tid = new Date(t).toISOString(), dato = dkNu(tid).dato;
    return { tid, dato, heleFra: dagPlus(dato, 1), tekst: navn + ' har kun tal fra ' + dkTid(tid) };
  };
  const v = { besoeg: lav(b, 'Egen tæller'), klik: lav(k, 'Klik-tælleren') };
  startHusk = { t: Date.now(), v };
  return v;
}
/** Foerste dag med tal i Google Analytics-ejendommen, slaaet op én gang i doegnet. */
async function ga4Start() {
  const v = await husk('ga4-start', DOEGN, async () => {
    const r = await G.rapport({ dateRanges: [{ startDate: '2015-08-14', endDate: dkIdag() }], dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }], orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 1 });
    const d = (G.raekker(r)[0] || {}).date;
    return { dato: d ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) : null };
  });
  if (!v || !v.dato) return null;
  return { tid: null, dato: v.dato, heleFra: dagPlus(v.dato, 1), tekst: 'Google Analytics startede ' + dkTekst(v.dato) };
}
/** Periodens GA4-stykker (nu, nuSml) klippet til de dage, Google Analytics har hele dage for, saa tallene
    og "kun N af M dage" handler om de samme dage (den halve foerste dag er ikke med). gS = ga4Start().
    ga4Daekning er daekningen, ga4Fra den foerste dag, der spoerges om. Ingen hele dage: ga4Tom = true. */
function ga4Del(p, gS) {
  if (!gS) return p;
  const d = daekning(p.fra, p.til, gS);
  if (d.hel) return { ...p, ga4Daekning: d, ga4Fra: p.fra, ga4Tom: false };
  if (!d.fra) return { ...p, ga4Daekning: d, ga4Fra: null, ga4Tom: true };
  const r = [{ startDate: d.fra, endDate: d.til }];
  return { ...p, nu: { ...p.nu, dateRanges: r }, nuSml: { ...p.nuSml, dateRanges: r }, ga4Daekning: d, ga4Fra: d.fra, ga4Tom: false };
}

/* ── fejl fra en kilde, i den faelles form { kilde, tekst, raa } ────────── */
const KILDENAVN = { ga4: 'Google Analytics', gsc: 'Search Console', meta: 'Meta', googleads: 'Google Ads', play: 'Google Play',
  appstore: 'App Store', egen: 'Den egne tæller', db: 'Databasen', bot: 'Chatbotten', psi: 'PageSpeed', oppetid: 'Oppetidsvagten' };
/** Én fejl. tekst er kort dansk og naevner den rigtige kilde, raa er den raa besked. */
function fejlObj(kilde, e, tekst) {
  const raa = String((e && e.message) || e || '').slice(0, 300), navn = KILDENAVN[kilde] || kilde;
  // "Meta: API access blocked." bliver til "Meta svarede ikke: API access blocked."
  const kort = raa.replace(/^(Google Analytics|Google Analytics, live|Search Console|Meta|Google Play|App Store|Google Ads|PageSpeed|Botten):\s*/, '');
  return { kilde, tekst: tekst || (navn + ' svarede ikke' + (kort ? ': ' + kort.slice(0, 160) : '')), raa };
}
/** Et svars fejl i den faelles form, uanset om de er tekster, objekter eller et opslag { meta:'...' }. */
function fejlListe(f) {
  if (!f) return [];
  const navn = { analytics: 'ga4', google: 'googleads', apple: 'appstore', muligheder: 'gsc', ai: 'ga4' };
  if (Array.isArray(f)) return f.map(x => typeof x === 'string'
    ? fejlObj(/Search Console/.test(x) ? 'gsc' : /Google Analytics/.test(x) ? 'ga4' : /Google Play/.test(x) ? 'play' : /App Store/.test(x) ? 'appstore' : /^Meta/.test(x) ? 'meta' : 'ukendt', x)
    : x).filter(x => x && x.kilde);
  if (typeof f === 'object') return Object.entries(f).filter(([, v]) => v).map(([k, v]) => fejlObj(navn[k] || k, v));
  return [];
}
/** Skriver kildefejl i loggen som hvad='FEJL', hoejst én pr. kilde pr. 10 minutter, saa "Fejl i panelet" og dagvagten ser dem. */
async function logFejl(f) {
  const liste = fejlListe(f);
  if (!sql || !liste.length) return;
  const set = new Set();
  for (const x of liste) {
    if (set.has(x.kilde)) continue; set.add(x.kilde);
    try { await opret();
      await sql`INSERT INTO vh_log (hvad, detalje, hvem) SELECT 'FEJL', ${('[' + x.kilde + '] ' + x.tekst).slice(0, 300)}::text, 'panel'
        WHERE NOT EXISTS (SELECT 1 FROM vh_log WHERE hvad = 'FEJL' AND detalje LIKE ${'[' + x.kilde + ']%'}::text AND hvornaar > now() - interval '10 minutes')`;
    } catch (e) {}
  }
}
/** Pakker en funktion, saa dens kildefejl logges, foer svaret gemmes. */
const medLog = lav => async () => { const v = await lav(); await logFejl(v && v.fejl); return v; };

/* ── live: hvem har aabnet en side de sidste 30 minutter ─────────────────
   Den egne taeller taeller alle (uden cookies). Google Analytics' realtid ser kun
   dem, der har sagt ja til cookies, og vises derfor kun som et ekstra tal. */
async function live() {
  const ud = { minutter: 30, kilde: null, paaSiden: null, visninger: null, sidst: null, enheder: [], sider: [], tekst: '', egen: null, ga4: null, fejl: [] };
  const egenP = sql ? opret().then(() => Promise.all([
    sql`SELECT count(DISTINCT gaest)::int AS g, count(*)::int AS v FROM vh_besoeg WHERE ts > now() - interval '30 minutes'`,
    sql`SELECT enhed, count(DISTINCT gaest)::int AS g FROM vh_besoeg WHERE ts > now() - interval '30 minutes' GROUP BY enhed ORDER BY g DESC`,
    sql`SELECT sti, count(DISTINCT gaest)::int AS g, count(*)::int AS v FROM vh_besoeg WHERE ts > now() - interval '30 minutes' GROUP BY sti ORDER BY g DESC, v DESC LIMIT 5`,
    sql`SELECT max(ts) AS t FROM vh_besoeg`
  ])).catch(e => { ud.fejl.push(fejlObj('egen', e)); return null; }) : Promise.resolve(null);
  const gP = G.opsat() ? G.alle([
    G.realtid({ dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'activeUsers' }] }),
    G.realtid({ dimensions: [{ name: 'unifiedScreenName' }], metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 8 })
  ]) : Promise.resolve(null);
  const [e, g] = await Promise.all([egenP, gP]);
  if (e) {
    const [t, enh, sider, sidst] = e;
    ud.egen = { kilde: 'egen', besoegende: t[0].g, visninger: t[0].v,
      enheder: enh.map(r => ({ deviceCategory: r.enhed, activeUsers: r.g })),
      sider: sider.map(r => ({ unifiedScreenName: r.sti, sti: r.sti, activeUsers: r.g, visninger: r.v })) };
    ud.sidst = sidst[0] && sidst[0].t ? new Date(sidst[0].t).toISOString() : null;
  }
  if (g) {
    ud.fejl.push(...g.fejlListe);
    ud.ga4 = { kilde: 'ga4', paaSiden: G.samlet(g[0], 'activeUsers'), enheder: G.raekkerEllerNull(g[0]), sider: G.raekkerEllerNull(g[1]),
      tekst: 'Google Analytics, kun dem der har sagt ja til cookies' };
  }
  if (ud.egen) Object.assign(ud, { kilde: 'egen', paaSiden: ud.egen.besoegende, visninger: ud.egen.visninger, enheder: ud.egen.enheder, sider: ud.egen.sider,
    tekst: 'åbnede en side de seneste 30 min, alle besøgende' });
  else if (ud.ga4 && ud.ga4.paaSiden != null) Object.assign(ud, { kilde: 'ga4', paaSiden: ud.ga4.paaSiden, enheder: ud.ga4.enheder || [], sider: ud.ga4.sider || [],
    tekst: 'de seneste 30 min, kun dem der har sagt ja til cookies' });
  return ud;
}

/* ── egen taeller for en periode ─────────────────────────────────────────
   Taeller alle besoegende uden cookies, robotter frasorteret. Gaeste-id'et skifter hvert
   doegn, saa over flere dage er "besoegende" besoegende pr. dag lagt sammen. Kun den del af
   perioden, taelleren daekker, regnes med, og der sammenlignes kun med en periode, den
   daekker helt. I dag sammenlignes med i gaar til samme klokkeslaet, paa minuttet. */
// pr. spand (dag 'YYYYMMDD' eller time 'YYYYMMDDHH24'): forskellige gaester, visninger og besoeg (30 minutters stilhed)
const qKurve = (v, fmt) => sql`SELECT b, count(DISTINCT gaest)::int AS brugere, count(*)::int AS visninger,
    count(*) FILTER (WHERE pause IS NULL OR pause > interval '30 minutes')::int AS besoeg
  FROM (SELECT to_char(ts AT TIME ZONE 'Europe/Copenhagen', ${fmt}::text) AS b, gaest,
          ts - lag(ts) OVER (PARTITION BY gaest ORDER BY ts) AS pause
        FROM vh_besoeg WHERE ts >= (${v.a}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (${v.b}::timestamp AT TIME ZONE 'Europe/Copenhagen')) x
  GROUP BY b ORDER BY b`;
// flest visninger fra én gaest paa én dag (én, der genindlaeser, kan flytte sidevisningerne meget)
const qFlest = v => sql`SELECT coalesce(max(n), 0)::int AS flest FROM (SELECT count(*) AS n FROM vh_besoeg
  WHERE ts >= (${v.a}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (${v.b}::timestamp AT TIME ZONE 'Europe/Copenhagen')
  GROUP BY (ts AT TIME ZONE 'Europe/Copenhagen')::date, gaest) x`;
// hvor de kom fra: kanalen paa hver besoegendes foerste visning den dag, saa klik inde paa siden ikke bliver til "Direkte"
const qKilder = v => sql`SELECT kanal, count(*)::int AS n FROM (
    SELECT DISTINCT ON (dag, gaest) kanal FROM (SELECT (ts AT TIME ZONE 'Europe/Copenhagen')::date AS dag, gaest, ts, kanal FROM vh_besoeg
      WHERE ts >= (${v.a}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (${v.b}::timestamp AT TIME ZONE 'Europe/Copenhagen')) y
    ORDER BY dag, gaest, ts) x
  GROUP BY kanal ORDER BY n DESC LIMIT 10`;
const qSider = v => sql`SELECT sti, count(*)::int AS visninger, count(DISTINCT ((ts AT TIME ZONE 'Europe/Copenhagen')::date::text || gaest))::int AS brugere
  FROM vh_besoeg WHERE ts >= (${v.a}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (${v.b}::timestamp AT TIME ZONE 'Europe/Copenhagen')
  GROUP BY sti ORDER BY visninger DESC LIMIT 15`;
const qLande = v => sql`SELECT land, count(DISTINCT ((ts AT TIME ZONE 'Europe/Copenhagen')::date::text || gaest))::int AS n
  FROM vh_besoeg WHERE ts >= (${v.a}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (${v.b}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND land <> ''
  GROUP BY land ORDER BY n DESC LIMIT 8`;
const qEnheder = v => sql`SELECT enhed, count(DISTINCT ((ts AT TIME ZONE 'Europe/Copenhagen')::date::text || gaest))::int AS n
  FROM vh_besoeg WHERE ts >= (${v.a}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (${v.b}::timestamp AT TIME ZONE 'Europe/Copenhagen')
  GROUP BY enhed ORDER BY n DESC`;
// tryk paa hent-knapperne (vh_klik): alle tryk, tryk der endte i en butik, og gaester pr. dag lagt sammen
const qKlik = v => sql`SELECT coalesce(sum(tryk), 0)::int AS tryk, coalesce(sum(tryk_butik), 0)::int AS tryk_butik,
    coalesce(sum(gaester), 0)::int AS gaester, coalesce(sum(gaester_butik), 0)::int AS gaester_butik
  FROM (SELECT count(*) AS tryk, count(*) FILTER (WHERE butik IN ('appstore','googleplay')) AS tryk_butik,
          count(DISTINCT gaest) AS gaester, count(DISTINCT gaest) FILTER (WHERE butik IN ('appstore','googleplay')) AS gaester_butik
        FROM vh_klik WHERE ts >= (${v.a}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (${v.b}::timestamp AT TIME ZONE 'Europe/Copenhagen')
        GROUP BY (ts AT TIME ZONE 'Europe/Copenhagen')::date) x`;

// spandene en kurve skal have, ogsaa dem uden besoeg, i raekkefoelge
function spande(p, dato) {
  if (!p.timer) return null;
  const sidste = p.type === 'idag' ? p.time : 23, u = [];
  for (let t = 0; t <= sidste; t++) u.push(dato.replace(/-/g, '') + String(t).padStart(2, '0'));
  return u;
}
function fyldKurve(raekker, noegler) {
  const m = new Map((raekker || []).map(r => [r.b, r]));
  return noegler.map(k => { const r = m.get(k) || {};
    const ud = { date: k, activeUsers: r.brugere || 0, sessions: r.besoeg || 0, screenPageViews: r.visninger || 0 };
    if (k.length === 10) ud.dateHour = k;
    return ud; });
}
const lagtSammen = (raekker, f) => (raekker || []).reduce((a, r) => a + (r[f] || 0), 0);

async function egenTaeller(p, start) {
  if (!sql) return null;
  start = start === undefined ? await taellerStart() : start;
  const s = start && start.besoeg;
  const dN = daekning(p.fra, p.til, s), dF = daekning(p.foerFra, p.foerTil, s);
  const vN = dN.fra ? vindue(dN.fra, dN.til, p.klokke) : null;
  const vF = dN.fra && dF.hel ? vindue(p.foerFra, p.foerTil, p.klokke) : null;
  const fmt = p.timer ? 'YYYYMMDDHH24' : 'YYYYMMDD';
  const tom = Promise.resolve(null);
  const [kN, kF, dagN, dagF, flN, flF, kilder, sider, lande, enheder] = await Promise.all([
    vN ? qKurve(vN, fmt) : tom, vF ? qKurve(vF, fmt) : tom,
    vN && p.timer ? qKurve(vN, 'YYYYMMDD') : tom, vF && p.timer ? qKurve(vF, 'YYYYMMDD') : tom,
    vN ? qFlest(vN) : tom, vF ? qFlest(vF) : tom,
    vN ? qKilder(vN) : tom, vN ? qSider(vN) : tom, vN ? qLande(vN) : tom, vN ? qEnheder(vN) : tom
  ]);
  // totaler regnes altid fra dagene: én dag giver forskellige gaester den dag, flere dage giver dagene lagt sammen
  const tN = p.timer ? dagN : kN, tF = p.timer ? dagF : kF;
  // grunden siger foerst, hvis perioden kun er delvist daekket (saa tallet er for faerre dage), og dernaest hvorfor der ingen sammenligning er
  const tal = (f) => ({ nu: vN ? lagtSammen(tN, f) : null, foer: vF ? lagtSammen(tF, f) : null, kilde: 'egen',
    grund: !vN ? dN.grund : !dN.hel ? punktum(dN.grund) + ' Ingen sammenligning med perioden før.' : !vF ? ingenSml(dF) : null });
  const noeglerN = vN ? (spande(p, p.fra) || alleDatoer(dN.fra, dN.til).map(d => d.replace(/-/g, ''))) : [];
  const noeglerF = vF ? (spande(p, p.foerFra) || alleDatoer(p.foerFra, p.foerTil).map(d => d.replace(/-/g, ''))) : [];
  const visninger = tal('visninger');
  visninger.flestFraEnGaest = { nu: flN ? flN[0].flest : null, foer: flF ? flF[0].flest : null };
  return {
    start, daekning: dN, foerDaekning: dF, foerOk: !!vF,
    brugere: tal('brugere'), besoeg: tal('besoeg'), visninger,
    kurve: fyldKurve(kN, noeglerN), kurveFoer: vF ? fyldKurve(kF, noeglerF) : [],
    kilder: kilder ? kilder.map(r => ({ sessionDefaultChannelGroup: r.kanal, besoegende: r.n, activeUsers: r.n })) : null,
    sider: sider ? sider.map(r => ({ pagePath: r.sti, screenPageViews: r.visninger, activeUsers: r.brugere })) : null,
    lande: lande ? lande.map(r => ({ countryId: r.land, activeUsers: r.n })) : null,
    enheder: enheder ? enheder.map(r => ({ deviceCategory: r.enhed, activeUsers: r.n })) : null,
    fraHvornaar: s ? s.tid : null
  };
}

/** Tryk til butik fra hent-knapperne (vh_klik) for perioden og perioden foer, med daekning. */
async function klikTal(p, start) {
  const s = start && start.klik;
  const dN = daekning(p.fra, p.til, s), dF = daekning(p.foerFra, p.foerTil, s);
  const vN = dN.fra ? vindue(dN.fra, dN.til, p.klokke) : null;
  const vF = dN.fra && dF.hel ? vindue(p.foerFra, p.foerTil, p.klokke) : null;
  const [n, f] = await Promise.all([vN ? qKlik(vN) : null, vF ? qKlik(vF) : null]);
  // klik-taelleren startede senere end besoegstaelleren, saa dens egen daekning siges ved tallet
  const grund = !vN ? dN.grund : !dN.hel ? punktum(dN.grund) + ' Ingen sammenligning med perioden før.' : !vF ? ingenSml(dF) : null;
  return {
    nu: n ? n[0].tryk_butik : null, foer: f ? f[0].tryk_butik : null, kilde: 'egen', grund,
    gaester: { nu: n ? n[0].gaester_butik : null, foer: f ? f[0].gaester_butik : null },
    alleTryk: { nu: n ? n[0].tryk : null, foer: f ? f[0].tryk : null },
    daekning: dN, foerDaekning: dF, fra: s ? s.tid : null,
    tekst: 'Tryk på hent-knapperne, der sendte folk til App Store eller Google Play. Egen tæller, uden cookies.'
  };
}

/* Reserve, kun hvis den egne taeller ikke kan bruges: lister og kurve fra Google Analytics,
   tydeligt maerket. Google taeller kun dem, der har sagt ja til cookies.
   q = ga4Del(p, gS): kun de dage, Google har hele dage for. I kurven er dagene foer Googles foerste
   hele dag null (ukendt), ikke 0. I dag er Google nogle timer bagud, saa timerne efter den seneste
   time med tal er ogsaa null. kurveFoer gives kun, naar Google daekker hele perioden foer (foerOk). */
async function ga4Lister(q, foerOk) {
  const p = q, M = [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }];
  const s = await G.alle([
    G.rapport({ ...p.nu, dimensions: [{ name: p.kurveDim }], metrics: M, orderBys: [{ dimension: { dimensionName: p.kurveDim } }], limit: 400 }),
    foerOk ? G.rapport({ ...p.foer, dimensions: [{ name: p.kurveDim }], metrics: M, orderBys: [{ dimension: { dimensionName: p.kurveDim } }], limit: 400 }) : null,
    G.rapport({ ...p.nu, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'totalUsers' }], orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }], limit: 10 }),
    G.rapport({ ...p.nu, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 15 }),
    G.rapport({ ...p.nu, dimensions: [{ name: 'countryId' }], metrics: [{ name: 'totalUsers' }], orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }], limit: 8 }),
    G.rapport({ ...p.nu, dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'totalUsers' }] })
  ]);
  const ukendt = x => { x.activeUsers = null; x.sessions = null; x.screenPageViews = null; return x; };
  // foerste dag med hele GA4-tal: ukendt start (gS mangler) = som foer, ingen hele dage = hele kurven ukendt
  const dataFra = !p.ga4Daekning ? null : (p.ga4Fra || dagPlus(p.til, 1)).replace(/-/g, '');
  const k = (svar, fra, til, antal) => { const r = G.raekkerEllerNull(svar); if (!r) return null;
    let noegler = spande(p, fra) || alleDatoer(fra, til).map(d => d.replace(/-/g, ''));
    if (antal) noegler = noegler.slice(0, antal);   // i gaar kun de hele timer, som Google blev spurgt om
    const kurve = fyldKurve(r.map(x => ({ b: x[p.kurveDim], brugere: x.totalUsers, besoeg: x.sessions, visninger: x.screenPageViews })), noegler);
    if (!antal && dataFra) kurve.forEach(x => { if (x.date.slice(0, 8) < dataFra) ukendt(x); });
    if (!antal && p.type === 'idag') {
      const sidst = r.reduce((a, x) => String(x[p.kurveDim]) > a ? String(x[p.kurveDim]) : a, '');
      kurve.forEach(x => { if (x.date > sidst) ukendt(x); });
    }
    return kurve; };
  const om = (svar, f) => { const r = G.raekkerEllerNull(svar); return r ? r.map(f) : null; };
  return { fejl: s.fejlListe, kurve: k(s[0], p.fra, p.til) || [],
    kurveFoer: foerOk && s[1] ? (k(s[1], p.foerFra, p.foerTil, p.type === 'idag' ? p.time : 0) || []) : [],
    kilder: om(s[2], r => ({ sessionDefaultChannelGroup: r.sessionDefaultChannelGroup, besoegende: r.totalUsers, activeUsers: r.totalUsers })),
    sider: om(s[3], r => ({ pagePath: r.pagePath, screenPageViews: r.screenPageViews, activeUsers: r.totalUsers })),
    lande: om(s[4], r => ({ countryId: r.countryId, activeUsers: r.totalUsers })),
    enheder: om(s[5], r => ({ deviceCategory: r.deviceCategory, activeUsers: r.totalUsers })) };
}

/* ── oversigt ──────────────────────────────────────────────────────────── */
async function oversigt(dage) {
  const p = omfang(dage);
  const fejl = [];
  const ga4Paa = G.opsat();
  // Google bruges kun til det, den egne taeller ikke kan: nye besoegende, engagement, tid pr. besoeg,
  // noeglehaendelser og "Hvad folk goer". Tre kald i stedet for ni.
  const MAAL = ['totalUsers','newUsers','sessions','screenPageViews','engagementRate','averageSessionDuration','keyEvents'].map(name => ({ name }));
  const gStartP = ga4Paa ? ga4Start().catch(e => { fejl.push(fejlObj('ga4', e, 'Google Analytics svarede ikke, da vi spurgte, hvornår tallene starter.')); return undefined; }) : Promise.resolve(null);
  // Google spoerges kun om de dage, den har hele tal for (ga4Del), saa tal og daekning passer sammen.
  // Har perioden ingen hele GA4-dage, spoerges der slet ikke, og tallene er null med en grund.
  const gP = ga4Paa ? gStartP.then(gs => { const q = ga4Del(p, gs);
    return q.ga4Tom ? null : G.alle([
      G.rapport({ ...q.nuSml, metrics: MAAL }),
      // perioden foer hentes kun, naar Google har tal for hele den (ellers spildes et kald af kvoten)
      (gs && p.ga4SmlOk && daekning(p.foerFra, p.foerTil, gs).hel) ? G.rapport({ ...p.foer, metrics: MAAL }) : null,
      G.rapport({ ...q.nu, dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }], limit: 12 })
    ]); }) : Promise.resolve(null);
  const egenP = sql ? taellerStart().then(s => Promise.all([
      egenTaeller(p, s),
      klikTal(p, s).catch(e => { fejl.push(fejlObj('egen', e, 'Klik-tælleren svarede ikke: ' + String(e.message || e).slice(0, 160))); return null; })]))
    .catch(e => { fejl.push(fejlObj('egen', e)); return null; }) : Promise.resolve(null);
  const noterP = (sql && !p.timer) ? opret().then(() => sql`SELECT id, dato::text, tekst FROM vh_noter WHERE dato BETWEEN ${p.fra}::date AND ${p.til}::date ORDER BY dato`)
    .catch(e => { fejl.push(fejlObj('db', e)); return []; }) : Promise.resolve([]);
  const [g, gS, egenK, noter] = await Promise.all([gP, gStartP, egenP, noterP]);
  if (g) fejl.push(...g.fejlListe);
  const [E, K] = egenK || [null, null];

  // Google-tallene: daekning fra ejendommens foerste dag, og kun sammenligning naar perioden foer er daekket
  const gD = gS ? daekning(p.fra, p.til, gS) : null, gDF = gS ? daekning(p.foerFra, p.foerTil, gS) : null;
  const ga4FoerOk = !!(gS && gDF.hel && p.ga4SmlOk);
  const ga4FoerGrund = !p.ga4SmlOk ? 'Google har endnu ingen hel time i dag at sammenligne med.'
    : gS === undefined ? 'Kunne ikke se, hvornår Google-tallene starter.' : !gS ? 'Google Analytics har ingen tal endnu.'
    : (gD && !gD.hel && gD.fra) ? punktum(gD.grund) + ' Ingen sammenligning med perioden før.' : ingenSml(gDF);
  // perioden ligger foer Googles foerste hele dag: der er ikke spurgt, og tallene er ukendte
  const gTom = !!(gD && !gD.fra);
  const gt = navn => {
    if (gTom) return { nu: null, foer: null, kilde: 'ga4', grund: gD.grund };
    if (!g) return { nu: null, foer: null, kilde: 'ga4', grund: ga4Paa ? 'Google Analytics svarede ikke.' : 'Google Analytics er ikke koblet på.' };
    const nu = G.samlet(g[0], navn);
    let foer = null, grund = null;
    if (nu == null) grund = 'Google Analytics svarede ikke.';
    else if (!ga4FoerOk) grund = ga4FoerGrund;
    else if (!g[1] || g[1].fejlet) grund = 'Google Analytics svarede ikke for perioden før.';
    else foer = G.samlet(g[1], navn);
    return { nu, foer, kilde: 'ga4', grund };
  };
  // noeglehaendelser: samme regel som trafik, annoncer og seo (maalStatus). Er der noeglehaendelser
  // i Google Analytics, er periodens 0 et rigtigt 0. Er der ingen sat op, er tallet null med en grund.
  const m = gt('keyEvents');
  let maal = m;
  if (!(m.nu > 0 || m.foer > 0)) {
    const mS = m.nu != null ? await maalStatus(m.nu) : null;
    maal = mS && mS.maales ? m : { nu: null, foer: null, kilde: 'ga4', grund: mS ? mS.grund : m.grund };
  }

  // egen taeller er hovedkilden. Kan den ikke bruges, vises Googles tal, tydeligt maerket.
  let L = E, kildeHoved = 'egen';
  if (!E && ga4Paa && !gTom) { const r = await ga4Lister(ga4Del(p, gS), ga4FoerOk); fejl.push(...r.fejl); L = r; kildeHoved = 'ga4'; }
  const ud = {
    dage: p.d, type: p.type, timer: p.timer, egne: p.egne, fra: p.fra, til: p.til, foerFra: p.foerFra, foerTil: p.foerTil,
    visning: p.visning, sammenlign: p.sammenlign, klokke: p.klokke ? p.klokke.slice(0, 5).replace(':', '.') : null, note: p.note || null,
    egenTaeller: !!E, kilde: E ? 'egen' : (L ? 'ga4' : null), fraHvornaar: E ? E.fraHvornaar : null,
    daekning: E ? E.daekning : (gD || null), foerDaekning: E ? E.foerDaekning : (gDF || null),
    besoegendeDefinition: E ? (p.timer ? 'samme_dag' : 'pr_dag_lagt_sammen') : 'ga4_totalUsers',
    besoegendeTekst: E ? (p.timer ? 'Forskellige besøgende i løbet af dagen' : 'Besøgende pr. dag, lagt sammen. Tælleren kan ikke genkende nogen fra dag til dag, så én, der kommer to dage, tæller to gange.')
      : 'Forskellige besøgende ifølge Google Analytics, kun dem der har sagt ja til cookies',
    brugere: E ? E.brugere : gt('totalUsers'), besoeg: E ? E.besoeg : gt('sessions'), visninger: E ? E.visninger : gt('screenPageViews'),
    klikButik: K || { nu: null, foer: null, kilde: 'egen', grund: sql ? 'Klik-tælleren svarede ikke.' : 'Databasen er ikke sat op.' },
    maal,
    nye: gt('newUsers'), engagement: gt('engagementRate'), laengde: gt('averageSessionDuration'),
    ga4Besoegende: gt('totalUsers'),
    ga4: { koblet: ga4Paa, daekning: gD, foerDaekning: gDF, start: gS ? gS.dato : null,
      til: p.type === 'idag' ? p.ga4Til : null,
      tekst: !ga4Paa ? 'Google Analytics er ikke koblet på.' : 'Google Analytics tæller kun dem, der har sagt ja til cookies.' +
        (p.type === 'idag' ? (p.ga4Til ? ' I dag og i går tælles til kl. ' + p.ga4Til + ', de hele timer.' : ' Der er endnu ingen hel time i dag.') : '') },
    kurve: L ? L.kurve : [], kurveFoer: L ? L.kurveFoer : [],
    kilder: L ? L.kilder : null, sider: L ? L.sider : null, lande: L ? L.lande : null, enheder: L ? L.enheder : null,
    kilderEnhed: 'besoegende',
    kilderTekst: kildeHoved === 'egen' ? 'Besøgende fordelt efter, hvor de kom fra ved første side den dag. Klik inde på siden tæller ikke som Direkte.'
      : 'Besøgende ifølge Google Analytics, kun dem der har sagt ja til cookies.',
    haendelser: g ? G.raekkerEllerNull(g[2]) : null,
    kildeFor: { brugere: kildeHoved, besoeg: kildeHoved, visninger: kildeHoved, kurve: kildeHoved, kilder: kildeHoved, sider: kildeHoved,
      lande: kildeHoved, enheder: kildeHoved, klikButik: 'egen', maal: 'ga4', nye: 'ga4', engagement: 'ga4', laengde: 'ga4',
      ga4Besoegende: 'ga4', haendelser: 'ga4' },
    noter, fejl
  };
  if (!E && !L) ud.grund = (sql ? 'Den egne tæller svarede ikke' : 'Databasen er ikke sat op') +
    (gTom ? ', og Google Analytics har ingen hele dage med tal i perioden.' : ', og Google Analytics er ikke koblet på.');
  return ud;
}

/* ── noeglehaendelser (konverteringer) i Google Analytics ──────────────────
   keyEvents er kun et tal, naar der er sat noeglehaendelser op i Analytics. Ellers er 0 et
   falsk tal, og der vises "–" med en grund. Har perioden selv noeglehaendelser, er de sat op.
   Ellers spoerges der hoejst hver 6. time, om der har vaeret nogen de seneste 90 dage. */
async function ga4Maal() {
  return husk('ga4-maal', 6 * TIME, async () => {
    const r = await G.rapport({ dateRanges: [{ startDate: dagPlus(dkIdag(), -90), endDate: dkIdag() }], metrics: [{ name: 'keyEvents' }] });
    const n = G.samlet(r, 'keyEvents');
    return { opsat: n > 0, n90: n };
  });
}
/** Maales konverteringer? sum = periodens samlede keyEvents (null, hvis ukendt). */
async function maalStatus(sum) {
  if (sum > 0) return { maales: true, grund: null };
  try {
    const m = await ga4Maal();
    return m.opsat ? { maales: true, grund: null }
      : { maales: false, grund: 'Ikke målt. Der er ingen nøglehændelser sat op i Google Analytics.' };
  } catch (e) { return { maales: false, grund: 'Kunne ikke se, om der er nøglehændelser i Google Analytics.' }; }
}

/* Googles egne "ukendt"-vaerdier ('', '(not set)', '(data not available)') laegges sammen i
   én raekke 'Ukendt' (ukendt:true), saa der ikke staar raa engelske og dobbelte raekker.
   Antal laegges sammen, andele (fx afvisning) vaegtes med besoeg. */
const erUkendt = v => { const s = String(v == null ? '' : v).trim();
  return !s || /^\((not set|data not available)\)( \/ \((not set|data not available)\))?$/.test(s); };
const ANDELE = new Set(['bounceRate', 'engagementRate', 'averageSessionDuration']);
function samlUkendt(raekker, dim, maal) {
  if (!raekker) return null;
  const kendte = raekker.filter(r => !erUkendt(r[dim])), u = raekker.filter(r => erUkendt(r[dim]));
  if (u.length) {
    const vaegt = u.some(r => typeof r.sessions === 'number') ? 'sessions' : maal;
    const ud = { [dim]: 'Ukendt', ukendt: true };
    Object.keys(u[0]).forEach(k => {
      if (k === dim || typeof u[0][k] !== 'number') return;
      if (ANDELE.has(k)) { const w = u.reduce((a, r) => a + (r[vaegt] || 0), 0);
        ud[k] = w ? u.reduce((a, r) => a + (r[k] || 0) * (r[vaegt] || 0), 0) / w : null; }
      else ud[k] = u.reduce((a, r) => a + (r[k] || 0), 0);
    });
    kendte.push(ud);
  }
  return kendte.sort((a, b) => (b[maal] || 0) - (a[maal] || 0));
}
// alle timer i raekkefoelge, 0 hvor ingen kom (Google udelader tomme timer). medTalTil: den seneste time,
// Google har tal for (I dag er Google nogle timer bagud). Timerne efter den er null (ukendt), ikke 0.
const alleTimer = (raekker, sidste, medTalTil) => !raekker ? null : Array.from({ length: sidste + 1 }, (_, h) => {
  if (medTalTil != null && h > medTalTil) return { hour: String(h), sessions: null };
  const r = raekker.find(x => Number(x.hour) === h); return { hour: String(h), sessions: r ? r.sessions : 0 }; });
// den seneste time med tal i en timerapport (-1 hvis ingen)
const sidsteTime = raekker => (raekker || []).reduce((a, x) => Math.max(a, Number(x.hour)), -1);
// ugedagene mandag til soendag (Google: 0 = soendag), med hvor mange af hver dag perioden har
function alleUgedage(raekker, fra, til) {
  if (!raekker) return null;
  const antal = {};
  alleDatoer(fra, til).forEach(d => { const u = String(new Date(d + 'T00:00:00Z').getUTCDay()); antal[u] = (antal[u] || 0) + 1; });
  return ['1', '2', '3', '4', '5', '6', '0'].filter(u => antal[u]).map(u => {
    const r = raekker.find(x => String(x.dayOfWeek) === u); return { dayOfWeek: u, sessions: r ? r.sessions : 0, dage: antal[u] }; });
}
const foersteTal = (...x) => { const t = x.find(v => v != null); return t === undefined ? null : t; };

/* Doede adresser fra den egne taeller: 404-siden melder sig selv (vh_besoeg.ikkefundet), saa
   alle besoegende kommer med. null, hvis taelleren ikke kan se dem endnu (kolonnen mangler,
   eller der er aldrig registreret én), saa Google Analytics bruges i stedet. */
async function doedeEgen(p) {
  if (!sql) return null;
  const kol = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'vh_besoeg' AND column_name = 'ikkefundet'`;
  if (!kol.length) return null;
  const f = await sql`SELECT min(ts) AS t FROM vh_besoeg WHERE ikkefundet`;
  if (!f[0] || !f[0].t) return null;
  const v = vindue(p.fra, p.til, p.klokke);
  // listen er de 25 stoerste; ialt er hele periodens antal (til "% af alle"), ogsaa det der ikke staar i listen
  const [r, t] = await Promise.all([
    sql`SELECT sti, kilde, (kanal = 'Intern') AS intern, count(*)::int AS n, count(DISTINCT gaest)::int AS g
      FROM vh_besoeg WHERE ikkefundet AND ts >= (${v.a}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (${v.b}::timestamp AT TIME ZONE 'Europe/Copenhagen')
      GROUP BY 1, 2, 3 ORDER BY n DESC LIMIT 25`,
    sql`SELECT count(*)::int AS n FROM vh_besoeg
      WHERE ikkefundet AND ts >= (${v.a}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (${v.b}::timestamp AT TIME ZONE 'Europe/Copenhagen')`
  ]);
  return { fra: new Date(f[0].t).toISOString(), ialt: t[0] ? t[0].n : null,
    raekker: r.map(x => ({ pagePath: x.sti, pageReferrer: x.intern ? 'jeres egen side' : (x.kilde || ''), intern: !!x.intern,
      screenPageViews: x.n, besoegende: x.g })) };
}

/* ── trafik ────────────────────────────────────────────────────────────────
   Google Analytics, som kun taeller dem, der har sagt ja til cookies. Hver liste er null, hvis
   Googles rapport fejlede (aldrig en tom liste, der ligner "ingen"). ialt er det rigtige samlede
   tal for hele perioden, saa "% af alle" regnes af alle og ikke kun af de viste raekker.
   Doede links tages fra den egne taeller, naar den kan se dem. */
async function trafik(dage) {
  const p = omfang(dage), fejl = [];
  const egenP = doedeEgen(p).catch(e => { fejl.push(fejlObj('egen', e, 'Den egne tæller svarede ikke om døde adresser: ' + String(e.message || e).slice(0, 160))); return null; });
  // Google spoerges kun om de dage, den har hele tal for, saa tallene passer med daekningen
  const gS = await ga4Start().catch(e => { fejl.push(fejlObj('ga4', e, 'Google Analytics svarede ikke, da vi spurgte, hvornår tallene starter.')); return undefined; });
  const q = ga4Del(p, gS);
  const r = (dimensions, metrics, limit) => G.rapport({ ...q.nu, dimensions, metrics,
    orderBys:[{metric:{metricName: metrics[0].name}, desc:true}], limit });
  const tsvar = await G.alle([
    r([{name:'landingPage'}], [{name:'sessions'},{name:'bounceRate'},{name:'keyEvents'}], 25),
    r([{name:'browser'}], [{name:'activeUsers'}], 10),
    r([{name:'operatingSystem'}], [{name:'activeUsers'}], 10),
    r([{name:'city'}], [{name:'activeUsers'}], 15),
    // timer og ugedage sorteret som tal (uden orderType sorterer Google dem som tekst: 0, 1, 10, 11 ...)
    G.rapport({ ...q.nu, dimensions:[{name:'hour'}], metrics:[{name:'sessions'}],
      orderBys:[{dimension:{dimensionName:'hour', orderType:'NUMERIC'}}], limit:24 }),
    G.rapport({ ...q.nu, dimensions:[{name:'dayOfWeek'}], metrics:[{name:'sessions'}],
      orderBys:[{dimension:{dimensionName:'dayOfWeek', orderType:'NUMERIC'}}], limit:7 }),
    r([{name:'sessionSourceMedium'}], [{name:'sessions'},{name:'keyEvents'}], 20),
    // doede links: sider hvor titlen er 404-sidens. Hver raekke er en adresse
    // nogen har proevet, som ikke findes. Ofte et gammelt link et sted.
    G.rapport({ ...q.nu, dimensions:[{name:'pagePath'},{name:'pageReferrer'}], metrics:[{name:'screenPageViews'}],
      dimensionFilter: medFilter(q, { filter:{ fieldName:'pageTitle', stringFilter:{ matchType:'CONTAINS', value:'ikke fundet', caseSensitive:false } } }),
      orderBys:[{metric:{metricName:'screenPageViews'}, desc:true}], limit:25 })
  ]);
  const egenD = await egenP;
  fejl.push(...tsvar.fejlListe);
  const [landingS, browserS, osS, byerS, timeS, ugedagS, kildeS, doedeS] = tsvar;
  const L = s => G.raekkerEllerNull(s);
  const gD = gS ? daekning(p.fra, p.til, gS) : null;
  // I dag er Google nogle timer bagud: timerne efter den seneste time med tal er ukendte (null), ikke 0.
  // timeTil null = ingen timer mangler (Google har tal til timen nu).
  const timeSidst = p.type === 'idag' && L(timeS) ? sidsteTime(L(timeS)) : null;
  const timeTil = timeSidst != null && timeSidst < p.time ? timeSidst : null;
  const landing = samlUkendt(L(landingS), 'landingPage', 'sessions'), kilder = samlUkendt(L(kildeS), 'sessionSourceMedium', 'sessions');
  // konverteringer: kun et tal, naar Analytics har noeglehaendelser sat op
  const mS = (landing || kilder) ? await maalStatus(foersteTal(G.samlet(landingS, 'keyEvents'), G.samlet(kildeS, 'keyEvents')))
    : { maales: false, grund: 'Google Analytics svarede ikke.' };
  if (!mS.maales) [landing, kilder].forEach(l => (l || []).forEach(x => { x.keyEvents = null; }));
  // ugedagene i den del af perioden, Google blev spurgt om (fra dens foerste hele dag)
  const ugFra = q.ga4Fra || p.fra;
  // doede adresser: egen taeller (alle) naar den kan se dem, ellers Google (kun cookie-ja)
  const doedeGa4 = L(doedeS);
  // den egne taeller bruges kun, naar perioden naar ind i den tid, den har kunnet se doede adresser
  const egenDato = egenD ? dkNu(egenD.fra).dato : null;
  const egenDoede = !!egenD && egenDato <= p.til;
  const doede = egenDoede ? egenD.raekker : doedeGa4;
  const ialt = {
    besoeg: foersteTal(G.samlet(landingS, 'sessions'), G.samlet(kildeS, 'sessions'), G.samlet(timeS, 'sessions')),
    besoegende: foersteTal(G.samlet(browserS, 'activeUsers'), G.samlet(osS, 'activeUsers'), G.samlet(byerS, 'activeUsers')),
    landing: G.samlet(landingS, 'sessions'), kilder: G.samlet(kildeS, 'sessions'), time: G.samlet(timeS, 'sessions'), ugedag: G.samlet(ugedagS, 'sessions'),
    browser: G.samlet(browserS, 'activeUsers'), os: G.samlet(osS, 'activeUsers'), byer: G.samlet(byerS, 'activeUsers'),
    // egen taeller: hele periodens antal fra en separat optaelling, ikke summen af de 25 i listen
    doede: egenDoede ? egenD.ialt : G.samlet(doedeS, 'screenPageViews')
  };
  return {
    kilde: 'ga4', kildeTekst: 'Google Analytics. Tæller kun besøgende, der har sagt ja til cookies, så tallene er lavere end den egne tæller på Oversigt.',
    type: p.type, visning: p.visning, fra: p.fra, til: p.til,
    note: p.type === 'idag' ? 'Google Analytics er nogle timer bagud, så de seneste timer kan mangle. Oversigt viser den egne tæller, som tæller alle.' : (p.note || null),
    daekning: gD, ga4Start: gS ? gS.dato : null,
    landing, browser: samlUkendt(L(browserS), 'browser', 'activeUsers'), os: samlUkendt(L(osS), 'operatingSystem', 'activeUsers'),
    byer: samlUkendt(L(byerS), 'city', 'activeUsers'),
    time: alleTimer(L(timeS), p.type === 'idag' ? p.time : 23, timeTil), timeTil, ugedag: alleUgedage(L(ugedagS), ugFra, p.til),
    kilder,
    doede, doedeKilde: egenDoede ? 'egen' : 'ga4', doedeFra: egenDoede ? egenD.fra : null,
    doedeTekst: egenDoede ? punktum('Egen tæller, alle besøgende. Den har kun tal for døde adresser fra ' + dkTekst(egenDato)) +
        (p.fra < egenDato ? ' Dagene før er ikke med.' : '')
      : 'Google Analytics, kun besøgende der har sagt ja til cookies.',
    doedeTomTekst: egenDoede ? 'Ingen døde adresser i perioden.' : 'Ingen døde adresser blandt besøgende, der sagde ja til cookies.',
    doedeGa4: egenDoede ? doedeGa4 : null,
    ialt, ialtTekst: 'Hele periodens samlede tal, også rækker der ikke står i listen. Brug det til "% af alle".',
    konverteringer: { maales: mS.maales, kilde: 'ga4', grund: mS.grund },
    noter: { landing: 'Ukendt betyder, at Google ikke kender den første side, ofte fordi besøget startede, før der blev svaret på cookies.',
      time: p.type !== 'idag' ? null : timeTil == null ? 'Timerne frem til nu.'
        : timeTil < 0 ? 'Google Analytics har endnu ingen tal for i dag. Timerne står som –, ikke 0.'
        : 'Google Analytics er nogle timer bagud. Den seneste time med tal er kl. ' + String(timeTil).padStart(2, '0') + '-' + String(timeTil + 1).padStart(2, '0') + '. Senere timer står som –, ikke 0.',
      ugedag: 'dage er, hvor mange af hver ugedag perioden har.' },
    kildeFor: { landing: 'ga4', browser: 'ga4', os: 'ga4', byer: 'ga4', time: 'ga4', ugedag: 'ga4', kilder: 'ga4', doede: egenDoede ? 'egen' : 'ga4' },
    fejl
  };
}

/* ── annoncer ──────────────────────────────────────────────────────────────
   Besoeg og konverteringer fra Google Analytics (kun cookie-ja). Forbrug fra de annoncekonti,
   der er koblet paa (lige nu kun Meta). Svarer en konto ikke, er forbruget ukendt (null), aldrig
   0 kr. Metas kampagner hedder et ID i Analytics (utm_campaign={{campaign.id}}). Derfor samles
   Analytics' raekker foerst pr. kampagne (fb og ig er samme kampagne), og forbruget kobles paa
   ID eller navn, saa det kun staar én gang pr. kampagne. */
// Analytics' egne vaerdier, som ikke er kampagner
const IKKE_KAMPAGNE = { '(referral)': 'Henvisninger fra andre sider, ikke en kampagne', '(organic)': 'Gratis søgning, ikke en kampagne',
  '(direct)': 'Direkte besøg, ikke en kampagne', '(not set)': 'Ukendt', '': 'Ukendt',
  '(cross-network)': 'Google-annoncer på tværs af netværk. Analytics kender ikke kampagnens navn.',
  'domain_click': 'Link fra en anden side (fx Trustpilot), ikke en kampagne' };
const erKampagne = navn => !!navn && !Object.prototype.hasOwnProperty.call(IKKE_KAMPAGNE, navn) && !/^\(.*\)$/.test(navn);
const BETALT = /paid|cpc|ppc|cpm|cpv|annonce/i;
async function annoncer(dage) {
  const p = omfang(dage), fejl = [];
  // forbrug fra de koblede konti, samtidig med Google Analytics (forbruget gaelder hele perioden)
  const konti = [{ lib: meta, kilde: 'meta' }, { lib: gads, kilde: 'googleads' }].filter(k => k.lib.opsat());
  const forbrugP = Promise.allSettled(konti.map(k => k.lib.forbrug(p.fra, p.til)));
  // Google spoerges kun om de dage, den har hele tal for, saa tallene passer med daekningen
  const gS = await ga4Start().catch(e => { fejl.push(fejlObj('ga4', e, 'Google Analytics svarede ikke, da vi spurgte, hvornår tallene starter.')); return undefined; });
  const q = ga4Del(p, gS);
  const asvar = await G.alle([
    G.rapport({ ...q.nu, dimensions:[{name:'sessionCampaignName'},{name:'sessionSource'},{name:'sessionMedium'}],
      metrics:[{name:'sessions'},{name:'activeUsers'},{name:'keyEvents'},{name:'engagementRate'},{name:'averageSessionDuration'}],
      orderBys:[{metric:{metricName:'sessions'}, desc:true}], limit:100 }),
    G.rapport({ ...q.nu, dimensions:[{name:'sessionManualAdContent'}], metrics:[{name:'sessions'},{name:'keyEvents'}],
      orderBys:[{metric:{metricName:'sessions'}, desc:true}], limit:15 }),
    G.rapport({ ...q.nu, dimensions:[{name:'sessionCampaignName'},{name:'landingPage'}], metrics:[{name:'sessions'}],
      orderBys:[{metric:{metricName:'sessions'}, desc:true}], limit:30 }),
    G.rapport({ ...q.nu, dimensions:[{name:'eventName'}], metrics:[{name:'eventCount'},{name:'totalUsers'}],
      orderBys:[{metric:{metricName:'eventCount'}, desc:true}], limit:20 })
  ]);
  const fRes = await forbrugP;
  fejl.push(...asvar.fejlListe);
  const [kampagnerS, indholdS, landingS, maalS] = asvar;

  // forbruget. En konto der fejler, giver ukendt forbrug, og fejlen staar i fejl.
  const forbrug = [], kontoFejl = {};
  konti.forEach((k, i) => { const x = fRes[i];
    if (x.status === 'fulfilled') forbrug.push(...(x.value || []));
    else { const e = x.reason || {}; kontoFejl[k.kilde] = true; fejl.push(fejlObj(k.kilde, e.raa || e, e.tekst)); } });
  const sumAf = kilde => forbrug.filter(x => x.kilde === kilde).reduce((a, x) => a + (x.forbrug || 0), 0);
  const forbrugKilder = [meta.status(), gads.status()].map(s => ({ ...s,
    ok: s.koblet ? !kontoFejl[s.kilde] : null, forbrug: s.koblet && !kontoFejl[s.kilde] ? sumAf(s.kilde) : null }));
  const koblede = forbrugKilder.filter(s => s.koblet), fejlede = koblede.filter(s => !s.ok);
  const samletForbrug = !koblede.length || fejlede.length ? null : forbrug.reduce((a, k) => a + (k.forbrug || 0), 0);
  const forbrugGrund = samletForbrug != null ? null : !koblede.length ? 'Ingen annoncekonto er koblet på.'
    : fejlede.map(s => s.navn).join(' og ') + ' svarede ikke, så forbruget er ukendt.';
  const ikkeKoblede = forbrugKilder.filter(s => !s.koblet).map(s => s.navn);
  const forbrugTekst = !koblede.length ? 'Ingen annoncekonto er koblet på.'
    : 'Kun ' + koblede.map(s => s.navn).join(' og ') + '.' + (ikkeKoblede.length ? ' ' + ikkeKoblede.join(' og ') + ' er ikke koblet på, så de annoncer er ikke med.' : '');

  // konverteringer: kun et tal, naar Analytics har noeglehaendelser sat op
  const mS = kampagnerS.fejlet ? { maales: false, grund: 'Google Analytics svarede ikke.' } : await maalStatus(G.samlet(kampagnerS, 'keyEvents'));
  const nrm = s => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
  const raa = G.raekkerEllerNull(kampagnerS);
  let kampagner = null, ikkeKampagner = null;
  if (raa) {
    const grp = new Map(), ikke = new Map();
    raa.forEach(r => {
      const navn = r.sessionCampaignName;
      if (!erKampagne(navn)) {
        const x = ikke.get(navn) || { sessionCampaignName: navn, tekst: IKKE_KAMPAGNE[navn] || 'Ikke en kampagne', sessions: 0 };
        x.sessions += r.sessions; ikke.set(navn, x); return;
      }
      const g = grp.get(navn) || { navn, kilder: [], sessions: 0, keyEvents: 0, eng: 0, tid: 0, brugere: [] };
      g.kilder.push({ sessionSource: r.sessionSource, sessionMedium: r.sessionMedium, sessions: r.sessions, keyEvents: mS.maales ? r.keyEvents : null });
      g.sessions += r.sessions; g.keyEvents += r.keyEvents || 0;
      g.eng += (r.engagementRate || 0) * r.sessions; g.tid += (r.averageSessionDuration || 0) * r.sessions; g.brugere.push(r.activeUsers);
      grp.set(navn, g);
    });
    ikkeKampagner = [...ikke.values()].sort((a, b) => b.sessions - a.sessions);
    kampagner = [...grp.values()].map(g => {
      const kilder = g.kilder.sort((a, b) => b.sessions - a.sessions);
      const betalt = kilder.some(x => BETALT.test(x.sessionMedium || ''));
      const f = forbrug.find(x => x.kampagneId && x.kampagneId === g.navn) || forbrug.find(x => nrm(x.kampagne) === nrm(g.navn));
      // hvilken konto kampagnen burde vaere i: Google-kilder hos Google Ads, ellers Meta
      const platform = f ? f.kilde : (/google/i.test(kilder.map(x => x.sessionSource).join(' ')) ? 'googleads' : 'meta');
      const st = forbrugKilder.find(s => s.kilde === platform);
      const forbrugGrundR = f ? (f.forbrug == null ? st.navn + ' sendte intet forbrug.' : null)
        : !betalt ? 'Ikke en betalt kampagne.'
        : !st.koblet ? st.navn + ' er ikke koblet på.'
        : !st.ok ? st.navn + ' svarede ikke, så prisen er ukendt.'
        : 'Ikke fundet hos ' + st.navn + ' i perioden. Kobles på kampagne-ID eller navn.';
      return {
        sessionCampaignName: g.navn, navn: f && f.kampagne ? f.kampagne : g.navn,
        kampagneId: /^\d{6,}$/.test(g.navn) ? g.navn : (f && f.kampagneId) || null,
        sessionSource: [...new Set(kilder.map(x => x.sessionSource))].join(', '),
        sessionMedium: [...new Set(kilder.map(x => x.sessionMedium))].join(', '),
        kilder, betalt, sessions: g.sessions,
        // forskellige besoegende kan ikke laegges sammen paa tvaers af kilder
        activeUsers: kilder.length === 1 ? g.brugere[0] : null,
        keyEvents: mS.maales ? g.keyEvents : null,
        engagementRate: g.sessions ? g.eng / g.sessions : null, averageSessionDuration: g.sessions ? g.tid / g.sessions : null,
        forbrug: f ? f.forbrug : null, forbrugKilde: f ? f.kilde : null, forbrugGrund: forbrugGrundR,
        visningerAnnonce: f ? f.visninger : null, klikAnnonce: f ? f.klikAlle : null, linkKlikAnnonce: f ? f.linkKlik : null,
        installsAnnonce: f ? f.installs : null,
        prisPrKonv: f && f.forbrug != null && mS.maales && g.keyEvents > 0 && !(q.ga4Daekning && !q.ga4Daekning.hel) ? f.forbrug / g.keyEvents : null,
        prisPrLinkKlik: f && f.forbrug != null && f.linkKlik ? f.forbrug / f.linkKlik : null
      };
    }).sort((a, b) => b.sessions - a.sessions);
  }
  // konverteringer fra betalte kampagner, og hvad én kostede
  const konvNu = kampagner && mS.maales ? kampagner.filter(k => k.betalt).reduce((a, k) => a + (k.keyEvents || 0), 0) : null;
  const konverteringer = { nu: konvNu, kilde: 'ga4', grund: kampagner ? mS.grund : 'Google Analytics svarede ikke.',
    tekst: 'Fra Google Analytics, kun betalte kampagner og kun besøgende der har sagt ja til cookies.' };
  // forbruget gaelder hele perioden, konverteringerne kun de dage, Google har tal for. Saa deles der ikke.
  const delvis = !!(q.ga4Daekning && !q.ga4Daekning.hel);
  const prisPrKonvertering = { nu: !delvis && samletForbrug != null && konvNu > 0 ? samletForbrug / konvNu : null,
    grund: samletForbrug == null ? forbrugGrund : konvNu == null ? konverteringer.grund : konvNu === 0 ? 'Ingen konverteringer i perioden.'
      : delvis ? 'Forbruget gælder hele perioden, men Google Analytics har kun tal for en del af den.' : null };
  const indhold = G.raekkerEllerNull(indholdS);
  if (indhold && !mS.maales) indhold.forEach(x => { x.keyEvents = null; });
  const landing = G.raekkerEllerNull(landingS);
  return {
    kilde: 'ga4', kildeTekst: 'Besøg og konverteringer fra Google Analytics, kun besøgende der har sagt ja til cookies. Forbrug fra annoncekontoen.',
    type: p.type, visning: p.visning, fra: p.fra, til: p.til, note: p.note || null,
    daekning: gS ? daekning(p.fra, p.til, gS) : null,
    kampagner, ikkeKampagner, indhold,
    landing: landing ? landing.filter(x => erKampagne(x.sessionCampaignName)) : null,
    maal: G.raekkerEllerNull(maalS),
    forbrug: koblede.length && fejlede.length === koblede.length ? null : forbrug,
    samletForbrug, forbrugGrund, forbrugTekst, forbrugKilder,
    valuta: (forbrug.find(x => x.valuta) || {}).valuta || null,
    harForbrug: meta.opsat() || gads.opsat(),
    konverteringer, prisPrKonvertering,
    klikTekst: 'Klik (alle) er Metas tal for alle klik, også reaktioner, profilklik og "se mere". Linkklik er dem, der gik videre til siden.',
    kildeFor: { kampagner: 'ga4', indhold: 'ga4', landing: 'ga4', maal: 'ga4', konverteringer: 'ga4', forbrug: koblede.map(s => s.kilde) },
    fejl
  };
}

/* ── downloads fra butikkerne ──────────────────────────────────────────── */
// hvilke dage i perioden en butik har tal for. En dag uden raekke er ukendt, ikke 0.
function daekningRaekker(datoer, raekker, navn, sidste) {
  const har = new Set((raekker || []).map(r => r.dato)), med = datoer.filter(d => har.has(d)), af = datoer.length;
  if (!med.length) return { fra: null, til: null, dage: 0, af, hel: false, sidsteMedTal: sidste || null,
    grund: navn + ' har ingen tal for perioden endnu.' + (sidste ? ' Seneste tal er fra ' + punktum(dkTekst(sidste)) : '') };
  const hel = med.length === af;
  return { fra: med[0], til: med[med.length - 1], dage: med.length, af, hel, sidsteMedTal: sidste || med[med.length - 1],
    grund: hel ? null : navn + ' har kun tal for ' + med.length + ' af ' + af + ' dage, til og med ' + punktum(dkTekst(med[med.length - 1])) };
}
async function downloads(dage) {
  // I dag og i gaar vises som de er. Butikkerne har sjaeldent tal saa nye, og det siges, i stedet for at vise 7 dage.
  const p = omfang(dage), datoer = alleDatoer(p.fra, p.til), af = datoer.length;
  const ud = { fra: p.fra, til: p.til, type: p.type, timer: p.timer, visning: p.visning, kilde: 'play',
    appleKoblet: asc.opsat(), googleKoblet: gplay.opsat(), apple: null, google: null,
    ialt: { apple: null, google: null, samlet: null, samletKilder: [], samletTekst: '' },
    daekning: null, daekningApple: null, googleTil: null, googleFiler: [], googleNote: null, kurve: [], fejl: [] };
  const ingen = grund => ({ fra: null, til: null, dage: 0, af, hel: false, grund });
  if (ud.googleKoblet) {
    try {
      const g = await gplay.hent(p.fra, p.til);
      ud.google = g.raekker.length ? g.raekker : null;
      ud.googleTil = g.sidsteDato; ud.googleFiler = g.filer;
      // maanedsfiler efter den nyeste fil med tal, som ikke findes, naevnes, saa man kan se, hvor tallene stopper (ingen gaet paa hvorfor)
      const sidsteFil = g.filer.filter(f => f.status === 200).map(f => f.maaned).sort().pop() || '';
      const mangler = g.filer.filter(f => f.status === 404 && !f.ekstra && f.maaned > sidsteFil);
      if (mangler.length) ud.googleNote = mangler.map(f => f.note).join(' ');
      ud.daekning = daekningRaekker(datoer, g.raekker, 'Google Play', g.sidsteDato);
    } catch (e) { ud.fejl.push(fejlObj('play', e)); ud.daekning = ingen('Google Play svarede ikke.'); }
  } else ud.daekning = ingen('Google Play er ikke koblet på.');
  if (ud.appleKoblet) {
    try {
      const a = await asc.periode(p.fra, p.til);
      const ok = a.filter(r => r.downloads != null);
      ud.apple = ok.length ? ok : null;
      const f = a.find(r => r.fejl); if (f) ud.fejl.push(fejlObj('appstore', f.fejl));
      ud.daekningApple = daekningRaekker(datoer, ok, 'App Store', ok.length ? ok[ok.length - 1].dato : null);
    } catch (e) { ud.fejl.push(fejlObj('appstore', e)); ud.daekningApple = ingen('App Store svarede ikke.'); }
  } else ud.daekningApple = ingen('App Store er ikke koblet på.');
  const sum = l => l ? l.reduce((s, r) => s + (r.downloads || 0), 0) : null;
  ud.ialt.google = sum(ud.google); ud.ialt.apple = sum(ud.apple);
  const med = []; if (ud.ialt.apple != null) med.push('App Store'); if (ud.ialt.google != null) med.push('Google Play');
  ud.ialt.samletKilder = med;
  ud.ialt.samlet = med.length ? (ud.ialt.apple || 0) + (ud.ialt.google || 0) : null;
  // "App Store og Google Play" kun naar begge er koblet paa og har tal
  ud.ialt.samletTekst = med.length === 2 ? 'App Store og Google Play'
    : med[0] === 'Google Play' ? 'Kun Google Play. ' + (ud.appleKoblet ? 'App Store har ingen tal for perioden.' : 'App Store er ikke koblet på.')
    : med[0] === 'App Store' ? 'Kun App Store. ' + (ud.googleKoblet ? 'Google Play har ingen tal for perioden.' : 'Google Play er ikke koblet på.')
    : 'Ingen butik har tal for perioden.';
  const gM = new Map((ud.google || []).map(r => [r.dato, r.downloads])), aM = new Map((ud.apple || []).map(r => [r.dato, r.downloads]));
  ud.kurve = datoer.map(d => ({ dato: d, apple: aM.has(d) ? aM.get(d) : null, google: gM.has(d) ? gM.get(d) : null }));
  return ud;
}

/* ── tragten ───────────────────────────────────────────────────────────────
   Alle trin er fra den egne taeller og fra de samme dage, saa de kan deles med
   hinanden: besoegende paa siden, dem der trykkede paa en hent-knap, og dem der kom
   videre til en butik. Telefoner springer hent-siden over, saa den er et sidetal, ikke
   et trin. Installationer fra Google Play er heller ikke et trin: de kommer ogsaa fra
   soegning i butikken og annoncer, og de vises for sig med deres egen daekning. */
const STED = { hero:'Toppen af forsiden', hent:'Hent-siden', side:'Hent-siden', download:'Hent-siden', familiekode:'Efter familiekoden',
  opgaver:'Efter opgaverne', madplan:'Efter madplanen', sammenlign:'Efter sammenligningen', cta:'Bunden af siden', flydeknap:'Svævende knap',
  footer:'Footer', nav:'Menuen', header:'Menuen', 'main-nav':'Menuen', baand:'Bånd mellem afsnit', blog:'Blogindlæg',
  'kal-demo-sektion':'Kalender-afsnittet', 'opg-demo-sektion':'Opgave-afsnittet', 'ind-demo-sektion':'Indkøbs-afsnittet', 'mad-demo-sektion':'Madplan-afsnittet',
  lommepenge:'Lommepenge-afsnittet', vagter:'Vagt-afsnittet', features:'Funktioner', comparison:'Sammenligningen', faq:'Spørgsmål og svar',
  founder:'Om os', chat:'Chatten' };
const stedNavn = (sted, sti) => /^\/hent\/?$/.test(sti || '') ? 'Hent-siden' : (STED[sted] || sted || 'Ukendt');
// besoegende pr. dag lagt sammen: alle, paa forsiden og paa hent-siden
const qTragtBesoeg = v => sql`SELECT coalesce(sum(alle), 0)::int AS alle, coalesce(sum(forside), 0)::int AS forside, coalesce(sum(hent), 0)::int AS hent
  FROM (SELECT count(DISTINCT gaest) AS alle, count(DISTINCT gaest) FILTER (WHERE sti = '/') AS forside,
          count(DISTINCT gaest) FILTER (WHERE sti IN ('/hent/','/hent')) AS hent
        FROM vh_besoeg WHERE ts >= (${v.a}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (${v.b}::timestamp AT TIME ZONE 'Europe/Copenhagen')
        GROUP BY (ts AT TIME ZONE 'Europe/Copenhagen')::date) x`;
// hvor paa siden der blev trykket. Tryk til en butik taeller hver gang, ogsaa de gamle 'app'-tryk fra
// telefoner (ukendt butik), saa appstore, googleplay og ukendt er samme enhed (tryk) i donutten. Tryk, der kun
// aabner hent-siden (computer), taeller én gang pr. person pr. dag. Personer er pr. dag, inden for raekken.
const qSteder = v => sql`SELECT sti, sted,
    count(*) FILTER (WHERE butik = 'appstore')::int AS appstore,
    count(*) FILTER (WHERE butik = 'googleplay')::int AS googleplay,
    count(DISTINCT dg) FILTER (WHERE butik = 'hentside' OR (butik = 'app' AND enhed = 'desktop'))::int AS hentside,
    count(*) FILTER (WHERE butik NOT IN ('appstore','googleplay','hentside') AND NOT (butik = 'app' AND enhed = 'desktop'))::int AS ukendt,
    count(*)::int AS tryk, count(DISTINCT dg)::int AS personer
  FROM (SELECT sti, sted, butik, enhed, (ts AT TIME ZONE 'Europe/Copenhagen')::date::text || gaest AS dg FROM vh_klik
        WHERE ts >= (${v.a}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (${v.b}::timestamp AT TIME ZONE 'Europe/Copenhagen')) x
  GROUP BY sti, sted`;

async function tragt(dage, valg) {
  const p = omfang(dage), fejl = [];
  const ud = { fra: p.fra, til: p.til, type: p.type, timer: p.timer, visning: p.visning,
    klokke: p.klokke ? p.klokke.slice(0, 5).replace(':', '.') : null, kilde: 'egen', egenTaeller: true,
    trin: [
      { navn: 'Besøgende på siden', tal: null, kilde: 'egen', note: p.timer ? 'forskellige besøgende i løbet af dagen' : 'besøgende pr. dag, lagt sammen' },
      { navn: 'Trykkede på en hent-knap', tal: null, kilde: 'egen', note: 'besøgende, der trykkede mindst én gang' },
      { navn: 'Kom videre til en butik', tal: null, kilde: 'egen', note: 'sendt til App Store eller Google Play. Computere lander først på hent-siden.' }
    ],
    faellesFra: null, faellesTil: null, daekning: null, konvertering: null,
    tryk: null, klikPersoner: null, forside: null, hentSide: null, butik: null, steder: null, klikFra: null,
    harInstalls: false, installationer: null, fejl };
  if (!sql) ud.daekning = { fra: null, til: null, dage: 0, af: dageMellem(p.fra, p.til), hel: false, grund: 'Databasen er ikke sat op.' };
  else try {
    const s = await taellerStart();
    const b = s && s.besoeg, k = s && s.klik;
    // begge taellere skal have hele dage: den, der startede sidst, bestemmer
    const senest = !b || !k ? null : (b.heleFra >= k.heleFra ? b : k);
    const d = daekning(p.fra, p.til, senest);
    if (b && !k) d.grund = 'Klik-tælleren har ingen tryk endnu.';
    ud.daekning = d; ud.faellesFra = d.fra; ud.faellesTil = d.til; ud.klikFra = k ? k.tid : null;
    if (d.fra) {
      const v = vindue(d.fra, d.til, p.klokke);
      const [bs, kl, st] = await Promise.all([qTragtBesoeg(v), qKlik(v), qSteder(v)]);
      const B = bs[0], T = kl[0];
      ud.trin[0].tal = B.alle; ud.trin[1].tal = T.gaester; ud.trin[2].tal = T.gaester_butik;
      ud.trin[1].note = 'besøgende, der trykkede mindst én gang (' + T.tryk + ' tryk i alt)';
      const andel = (a, n) => (a != null && n) ? a / n : null;
      ud.konvertering = { tilKnap: andel(T.gaester, B.alle), tilButik: andel(T.gaester_butik, T.gaester), samlet: andel(T.gaester_butik, B.alle),
        tekst: punktum('Alle tre trin er fra den egne tæller og fra de samme dage, ' + (d.fra === d.til ? dkTekst(d.fra) : dkTekst(d.fra) + ' til ' + dkTekst(d.til))) };
      ud.tryk = { ialt: T.tryk, tilButik: T.tryk_butik, kilde: 'egen' };
      ud.klikPersoner = T.gaester;
      ud.forside = { besoegende: B.forside, kilde: 'egen' };
      ud.hentSide = { besoegende: B.hent, kilde: 'egen', note: 'Kun computere ser hent-siden. Telefoner sendes direkte til butikken, så hent-siden er ikke et trin.' };
      ud.steder = st.map(x => ({ sti: x.sti, sted: x.sted, navn: stedNavn(x.sted, x.sti),
        klik: x.appstore + x.googleplay + x.hentside + x.ukendt, tryk: x.tryk, personer: x.personer,
        appstore: x.appstore, googleplay: x.googleplay, hentside: x.hentside, ukendt: x.ukendt })).sort((a, z) => z.klik - a.klik);
      ud.butik = ud.steder.reduce((a, x) => ({ appstore: a.appstore + x.appstore, googleplay: a.googleplay + x.googleplay,
        hentside: a.hentside + x.hentside, ukendt: a.ukendt + x.ukendt }), { appstore: 0, googleplay: 0, hentside: 0, ukendt: 0 });
    } else ud.trin.forEach(t => { t.grund = d.grund; });
  } catch (e) { fejl.push(fejlObj('egen', e)); ud.trin.forEach(t => { t.grund = 'Den egne tæller svarede ikke.'; }); }
  // installationer for sig, med butikkens egen daekning
  if (!(valg && valg.udenInstall)) {
    if (!asc.opsat() && !gplay.opsat()) ud.installationer = { google: null, apple: null, samlet: null, kilde: 'play', grund: 'Hverken Google Play eller App Store er koblet på.' };
    else try {
      const dl = await downloads(dage);
      fejl.push(...dl.fejl);
      ud.installationer = { google: dl.ialt.google, apple: dl.ialt.apple, samlet: dl.ialt.samlet, samletTekst: dl.ialt.samletTekst,
        kilde: 'play', daekning: dl.daekning, grund: dl.daekning ? dl.daekning.grund : null, googleTil: dl.googleTil,
        note: 'Alle installationer fra Google Play, også fra søgning i butikken og annoncer. De er ikke et trin i tragten, fordi ikke alle kom via siden.' };
    } catch (e) { fejl.push(fejlObj('play', e)); }
  }
  return ud;
}

/* ── hastighed, mobil og computer, gemt et doegn ───────────────────────────
   Hver enhed maales tre gange hos Google. Tallet er den midterste af de vellykkede, ved to den
   laveste. valgTekst siger, hvilken det blev, og maalinger har dem alle (google.js). */
async function hastighed() {
  const url = process.env.VAGT_URL || profil.site + '/';
  const r = await Promise.allSettled([G.hastighed(url,'mobile'), G.hastighed(url,'desktop')]);
  const ud = x => x.status === 'fulfilled' ? x.value : { fejl: String((x.reason && x.reason.message) || x.reason).slice(0, 300) };
  const mobil = ud(r[0]), computer = ud(r[1]);
  const fejl = [];
  if (mobil.fejl) fejl.push(fejlObj('psi', mobil.fejl, 'PageSpeed kunne ikke måle mobil: ' + String(mobil.fejl).replace(/^PageSpeed:\s*/, '').slice(0, 160)));
  if (computer.fejl) fejl.push(fejlObj('psi', computer.fejl, 'PageSpeed kunne ikke måle computer: ' + String(computer.fejl).replace(/^PageSpeed:\s*/, '').slice(0, 160)));
  return { url, kilde: 'psi', maalt: new Date().toISOString(),
    tekst: 'Googles PageSpeed, målt fra Googles servere. Tallet svinger 20 til 40 point fra gang til gang, så hver enhed måles tre gange.',
    mobil, computer, fejl };
}

/* Panelets boks maaler ikke selv: en maaling hos Google tager 20-40 sekunder, mere end en funktion
   maa bruge. Den viser dagvagtens daglige maaling fra vh_hastighed. "Maal nu" (hastighed-nu) maaler
   live med en tidsgraense og gemmer resultatet et doegn, og saa vises det i stedet. */
async function hastighedGemt() {
  const url = process.env.VAGT_URL || profil.site + '/';
  const tom = { url, kilde: 'psi', fraDagvagt: true, fejl: [], tekst: 'Googles PageSpeed, målt af dagvagten hver morgen.' };
  if (!sql) return { ...tom, mobil: { fejl: 'Databasen er ikke sat op.' }, computer: { fejl: 'Databasen er ikke sat op.' } };
  const r = await sql`SELECT mobil, computer, maalt FROM vh_hastighed ORDER BY maalt DESC LIMIT 1`;
  if (!r.length) return { ...tom, mobil: { fejl: 'Dagvagten har ikke målt endnu. Tryk på Mål nu.' }, computer: { fejl: 'Dagvagten har ikke målt endnu. Tryk på Mål nu.' } };
  const maalt = new Date(r[0].maalt).toISOString();
  const en = v => v == null ? { fejl: 'Dagvagten fik ingen måling den dag.' }
    : { score: Number(v), lcp: null, fcp: null, ttfb: null, cls: null, vaegt: null, maalt,
        valgTekst: 'Dagvagtens måling, midterværdien af tre kørsler. Detaljerne måles kun ved Mål nu' };
  return { ...tom, maalt, mobil: en(r[0].mobil), computer: en(r[0].computer) };
}

/* ── søgeord, fra Google Search Console ─────────────────────────────────────
   Search Console er 2 til 3 dage bagud og har ingen tal for i dag eller i gaar. Den nyeste dag
   med tal slaas op hver gang. 7/28/90/365 dage er praecis saa mange datoer (begge ender med) og
   slutter paa den nyeste dag med tal (forskudt, og det siges). I dag og I gaar giver null med en
   grund, og den nyeste dag med tal staar for sig under seneste. Egne datoer bruges som valgt,
   klippet ved den nyeste dag med tal. Googles dage foelger amerikansk vestkysttid. */
const gscRens = s => (!s || s.fejlet) ? null : (s.rows || []).map(r => ({ navn: (r.keys || []).join(' '), klik: r.clicks, visninger: r.impressions, ctr: r.ctr, plads: r.position }));
async function gscPeriode(fra, til) {
  const q = (dimensions, rowLimit) => G.soegning({ startDate: fra, endDate: til, dimensions, rowLimit });
  // alle soegeord (op til 1.000), saa de skjulte kan regnes ud. Kun de 50 stoerste sendes videre.
  const s = await G.alle([q(['query'], 1000), q(['page'], 25), q(['country'], 10), q(['device'], 3), q([], 1)], 'gsc');
  const ordAlle = gscRens(s[0]), t = s[4].fejlet ? null : ((s[4].rows || [])[0] || {});
  // perioden har tal (den slutter senest paa den nyeste dag), saa ingen visninger er et rigtigt 0
  const ialt = t ? { klik: t.clicks || 0, visninger: t.impressions || 0, ctr: t.impressions ? (t.ctr || 0) : null,
    plads: t.impressions && t.position != null ? t.position : null } : { klik: null, visninger: null, ctr: null, plads: null };
  let skjulte = null;
  if (ordAlle && t) {
    const k = ordAlle.reduce((a, r) => a + (r.klik || 0), 0), v = ordAlle.reduce((a, r) => a + (r.visninger || 0), 0);
    const kl = Math.max(0, ialt.klik - k);
    skjulte = { klik: kl, visninger: Math.max(0, ialt.visninger - v), andel: ialt.klik ? kl / ialt.klik : null, ufuldstaendig: ordAlle.length >= 1000,
      tekst: 'Søgninger, Google ikke viser af hensyn til privatliv. De tæller med i Klik fra Google, men står ikke i listen.' +
        (ordAlle.length >= 1000 ? ' Listen har kun de 1.000 største søgninger, resten tæller også her.' : '') };
  }
  return { ialt, ord: ordAlle ? ordAlle.slice(0, 50).map(r => ({ ...r, brand: seo.erBrand(r.navn) })) : null, antalOrd: ordAlle ? ordAlle.length : null,
    sider: gscRens(s[1]), lande: gscRens(s[2]), enheder: gscRens(s[3]), skjulte,
    fejl: s.fejlListe.map(x => fejlObj('gsc', x.raa)) };
}
async function soegeord(dage) {
  const p = omfang(dage), idag = dkIdag();
  // hvilke dage Google har tal for. Search Console gemmer 16 maaneder, saa der spoerges saa langt
  // tilbage (eller foer perioden, hvis den er aeldre). Saa er foerste den rigtige foerste dag med tal.
  const probeFra = [dagPlus(p.fra, -7), dagPlus(idag, -490)].sort()[0];
  const ud0 = { kilde: 'gsc', kildeTekst: 'Google Search Console. Tallene er 2 til 3 dage bagud, og Googles dage følger amerikansk tid.', type: p.type, visning: p.visning, valgt: { fra: p.fra, til: p.til }, nyeste: null, bagud: null,
    fra: null, til: null, dage: 0, periode: { startDate: null, endDate: null }, forskudt: false, daekning: null, note: p.note || null,
    ialt: { klik: null, visninger: null, ctr: null, plads: null }, ord: null, antalOrd: null, sider: null, lande: null, enheder: null,
    skjulte: null, prDag: null, seneste: null };
  if (!G.opsatGsc()) return { ...ud0, grund: 'Search Console er ikke koblet på.', fejl: [] };
  let dS;
  try { dS = await G.soegning({ startDate: probeFra, endDate: idag, dimensions: ['date'], rowLimit: 1000 }); }
  catch (e) { return { ...ud0, grund: 'Search Console svarede ikke, så tallene er ukendte. Ofte er servicekontoen ikke tilføjet som bruger i Search Console, eller GSC_SITE_URL passer ikke.', fejl: [fejlObj('gsc', e)] }; }
  const prDato = (dS.rows || []).map(r => ({ dato: (r.keys || [])[0], klik: r.clicks, visninger: r.impressions }))
    .filter(r => gyldigDato(r.dato)).sort((a, b) => a.dato < b.dato ? -1 : 1);
  const nyeste = prDato.length ? prDato[prDato.length - 1].dato : null, foerste = prDato.length ? prDato[0].dato : null;
  const bagud = nyeste ? dageMellem(nyeste, idag) - 1 : null;
  // '4. okt. 2025' naar datoen ikke er i aar, ellers '4. okt.'
  const datoT = d => dkTekst(d) + (d && d.slice(0, 4) !== idag.slice(0, 4) ? ' ' + d.slice(0, 4) : '');
  const ud = { ...ud0, nyeste, bagud, grund: null, fejl: [] };
  if (!nyeste) { ud.grund = 'Search Console har ingen tal for siden endnu.'; return ud; }
  const bagudTekst = 'Search Console er ' + bagud + (bagud === 1 ? ' dag' : ' dage') + ' bagud';
  let fra = null, til = null;
  if (p.type === 'idag' || p.type === 'igaar') {
    if (nyeste >= p.til) { fra = p.fra; til = p.til; }
    else ud.grund = punktum(bagudTekst + ' og har ingen tal for ' + (p.type === 'idag' ? 'i dag' : 'i går') + ' endnu. Seneste dag med tal er ' + datoT(nyeste));
  } else if (p.type === 'dage') {
    til = nyeste < p.til ? nyeste : p.til; fra = dagPlus(til, -(p.d - 1));
    if (til !== p.til) { ud.forskudt = true; ud.grund = punktum(bagudTekst + '. Viser de ' + p.d + ' seneste dage med tal, ' + datoT(fra) + ' til ' + datoT(til)); }
  } else {
    fra = p.fra; til = nyeste < p.til ? nyeste : p.til;
    if (til < fra) { fra = til = null; ud.grund = punktum(bagudTekst + ' og har ingen tal for de valgte dage endnu. Seneste dag med tal er ' + datoT(nyeste)); }
    else if (til !== p.til) ud.grund = punktum(bagudTekst + '. Tallene går kun til og med ' + datoT(til) + ', ikke til ' + datoT(p.til));
  }
  if (fra) {
    // starter Googles tal foerst inde i perioden, siges det
    ud.daekning = daekning(fra, til, { heleFra: foerste, tekst: 'Search Console har kun tal fra ' + datoT(foerste) });
    Object.assign(ud, { fra, til, dage: dageMellem(fra, til), periode: { startDate: fra, endDate: til } });
    const r = await gscPeriode(fra, til);
    Object.assign(ud, { ialt: r.ialt, ord: r.ord, antalOrd: r.antalOrd, sider: r.sider, lande: r.lande, enheder: r.enheder, skjulte: r.skjulte });
    ud.fejl.push(...r.fejl);
    // dag for dag. En dag uden raekke har ingen visninger (0), foer Googles foerste dag er den ukendt.
    const m = new Map(prDato.map(x => [x.dato, x]));
    ud.prDag = alleDatoer(fra, til).map(d => { const x = m.get(d);
      return { dato: d, klik: x ? x.klik : (d < foerste ? null : 0), visninger: x ? x.visninger : (d < foerste ? null : 0) }; });
  } else {
    // den nyeste dag med tal, for sig og tydeligt maerket
    const r = await gscPeriode(nyeste, nyeste);
    ud.seneste = { fra: nyeste, til: nyeste, tekst: 'Seneste dag med tal fra Search Console: ' + datoT(nyeste),
      ialt: r.ialt, ord: r.ord, antalOrd: r.antalOrd, sider: r.sider, lande: r.lande, enheder: r.enheder, skjulte: r.skjulte };
    ud.fejl.push(...r.fejl);
  }
  return ud;
}

/* ── chatbotten, samme database ─────────────────────────────────────────────
   Perioden er de samme danske kalenderdage som resten af panelet (I dag, I gaar og egne datoer
   med). Arkiverede samtaler taeller med i periodens tal: botten arkiverer selv laeste samtaler
   efter 14 dage, og arkivet er kun indbakkens tilstand. Ulaeste og "vil tale med et menneske"
   er indbakken lige nu. Dansk og tysk taelles hver for sig og samlet (marked). Tommel op/ned
   gives baade for perioden og for "alle tider", hver tydeligt maerket.
   ryd.js sletter hver nat samtaler (RYD_DAGE efter sidste besked) og tommel (RYD_DAGE efter de blev
   givet). Hurtig-svar og klik (vh_events) slettes aldrig. Samtale- og tommeltal taelles derfor kun paa
   de dage, der med sikkerhed stadig er gemt, og "alle tider" er det, der stadig er gemt. */
const MARKED = { dk: 'Dansk', de: 'Tysk', alle: 'Dansk og tysk' };
const RYD_DAGE = Math.max(7, parseInt(process.env.RYD_DAGE, 10) || 90);
/** Foerste danske dag, hvor samtaler og tommel med sikkerhed stadig er gemt: de seneste RYD_DAGE dage, i dag med. */
const chatGemtFra = () => dagPlus(dkIdag(), -(RYD_DAGE - 1));
const chatTekster = () => ({
  i_perioden: 'Chatsamtaler startet i perioden, også dem der siden er arkiveret.',
  med_mail: 'Chatsamtaler startet i perioden, hvor kunden skrev sin mail. Formularer tælles ikke med.',
  sendt_videre: 'Chatsamtaler startet i perioden, som et menneske har overtaget eller som venter på et.',
  ulaeste: 'Indbakken lige nu, uanset periode.', vil_have_menneske: 'Venter på et menneske lige nu, uanset periode.',
  stemning: 'Stemningen i samtaler startet i perioden.', spoergsmaal: 'Hurtig-svar trykket i perioden.',
  alle_tider: 'Alle samtaler, der stadig er gemt. Samtaler slettes ' + RYD_DAGE + ' dage efter sidste besked.'
});
async function chat(dage, site) {
  // uden bottens tabeller (den tyske backend) kommer tallene fra botten selv
  if (!profil.botTabeller) return chatFraBot(dage, site);
  if (!sql) throw new Error('Databasen er ikke sat op');
  await opret();
  const p = omfang(dage), valgt = (site === 'dk' || site === 'de') ? site : 'alle';
  const gemtFra = chatGemtFra(), sFra = p.fra < gemtFra ? gemtFra : p.fra;
  const [tR, stemR, chipR, fbR, nedR, senR, startR] = await Promise.allSettled([
    sql`SELECT coalesce(site, 'dk') AS s,
          count(*) FILTER (WHERE (created_at AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${p.til}::date)::int AS i_perioden,
          count(*) FILTER (WHERE coalesce(email, '') <> '' AND (created_at AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${p.til}::date)::int AS med_mail,
          count(*) FILTER (WHERE (human OR needs_human) AND (created_at AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${p.til}::date)::int AS sendt_videre,
          count(*) FILTER (WHERE archived IS NOT true)::int AS aabne,
          count(*) FILTER (WHERE archived IS NOT true AND seen IS false)::int AS ulaeste,
          count(*) FILTER (WHERE archived IS NOT true AND needs_human)::int AS vil_have_menneske,
          count(*)::int AS alle_tider
        FROM vh_conversations GROUP BY 1`,
    sql`SELECT coalesce(site, 'dk') AS s, mood, count(*)::int AS n FROM vh_conversations
        WHERE coalesce(mood, '') <> '' AND (created_at AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${p.til}::date
        GROUP BY 1, 2`,
    sql`SELECT coalesce(site, 'dk') AS s, label, count(*)::int AS n FROM vh_events
        WHERE kind = 'chip' AND (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${p.fra}::date AND ${p.til}::date
        GROUP BY 1, 2`,
    sql`SELECT coalesce(site, 'dk') AS s,
          count(*) FILTER (WHERE value = 1 AND (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${p.til}::date)::int AS p_op,
          count(*) FILTER (WHERE value = -1 AND (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${p.til}::date)::int AS p_ned,
          count(*) FILTER (WHERE value = 1)::int AS op, count(*) FILTER (WHERE value = -1)::int AS ned
        FROM vh_feedback GROUP BY 1`,
    sql`SELECT coalesce(site, 'dk') AS s, question AS q, answer AS a, ts FROM vh_feedback
        WHERE value = -1 AND (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${p.til}::date
        ORDER BY id DESC LIMIT 60`,
    sql`SELECT id, email, first_q, n, seen, needs_human, mood, site, updated_at
        FROM vh_conversations WHERE archived IS NOT true ORDER BY updated_at DESC LIMIT 40`,
    sql`SELECT least((SELECT min(created_at) FROM vh_conversations), (SELECT min(ts) FROM vh_events)) AS t`
  ]);
  // uden samtaletallene er der intet at vise
  if (tR.status === 'rejected') throw tR.reason;
  const fejl = [];
  const ok = (x, hvad) => { if (x.status === 'fulfilled') return x.value;
    fejl.push(fejlObj('bot', x.reason, 'Chat: ' + hvad + ' kunne ikke tælles: ' + String((x.reason && x.reason.message) || x.reason).slice(0, 160))); return null; };
  const hvor = s => (s === 'dk' || s === 'de') ? [s, 'alle'] : ['alle'];
  const tom = () => ({ i_perioden: 0, med_mail: 0, sendt_videre: 0, aabne: 0, alle: 0, ulaeste: 0, vil_have_menneske: 0, alle_tider: 0 });
  const marked = { dk: { navn: MARKED.dk, ...tom() }, de: { navn: MARKED.de, ...tom() }, alle: { navn: MARKED.alle, ...tom() } };
  tR.value.forEach(r => hvor(r.s).forEach(k => {
    ['i_perioden', 'med_mail', 'sendt_videre', 'aabne', 'ulaeste', 'vil_have_menneske', 'alle_tider'].forEach(f => { marked[k][f] += r[f] || 0; });
    // alle = indbakken lige nu (ikke-arkiverede), samme betydning som foer
    marked[k].alle = marked[k].aabne; }));
  const samle = (rows, noegle) => { if (!rows) return null; const m = {};
    rows.filter(r => valgt === 'alle' || r.s === valgt).forEach(r => { m[r[noegle]] = (m[r[noegle]] || 0) + r.n; });
    return Object.keys(m).map(k => ({ [noegle]: k, n: m[k] })).sort((a, b) => b.n - a.n); };
  // hvor langt tilbage chatbotten har tal. Foerste data er den aeldste samtale eller haendelse
  // (haendelser slettes aldrig, saa det er bottens rigtige start).
  const st = ok(startR, 'starten');
  const t0 = st && st[0] && st[0].t ? dkNu(st[0].t).dato : null;
  const ingen = grund => ({ fra: null, til: null, dage: 0, af: dageMellem(p.fra, p.til), hel: false, grund });
  const foersteTekst = t0 ? 'Chatbottens første data er fra ' + dkTekst(t0) : '';
  // samtaler og tommel: fra bottens foerste data, men aldrig foer det, der stadig er gemt
  const d = t0 && t0 > gemtFra ? daekning(p.fra, p.til, { heleFra: t0, tekst: foersteTekst })
    : (t0 || !st) ? daekning(p.fra, p.til, { heleFra: gemtFra, tekst: 'Samtaler og tommel slettes efter ' + RYD_DAGE + ' dage' })
    : ingen('Chatbotten har ingen data endnu.');
  // hurtig-svar (haendelser): fra bottens foerste data
  const dH = t0 ? daekning(p.fra, p.til, { heleFra: t0, tekst: foersteTekst })
    : ingen(st ? 'Chatbotten har ingen data endnu.' : 'Kunne ikke se, hvornår chatbotten startede.');
  // ingen gemte dage i perioden: periodens samtale- og tommeltal er ukendte, ikke 0
  const harTal = !!d.fra, harH = !!dH.fra;
  if (!harTal) Object.values(marked).forEach(m => { m.i_perioden = null; m.med_mail = null; m.sendt_videre = null; });
  const stemning = harTal ? samle(ok(stemR, 'stemningen'), 'mood') : null;
  const chips = harH ? samle(ok(chipR, 'hurtig-svarene'), 'label') : null;
  const fb = ok(fbR, 'tommel op og ned');
  let feedback = null;
  if (fb) { const v = fb.filter(r => valgt === 'alle' || r.s === valgt);
    const sum = f => v.reduce((a, r) => a + (r[f] || 0), 0);
    feedback = { periode: harTal ? { up: sum('p_op'), down: sum('p_ned') } : { up: null, down: null }, alleTider: { up: sum('op'), down: sum('ned') }, kilde: 'bot',
      alleTiderNavn: 'seneste ' + RYD_DAGE + ' dage',
      tekst: 'periode er tommel op og ned givet i perioden. alleTider er alt, der stadig er gemt: tommel slettes efter ' + RYD_DAGE + ' dage.' }; }
  const ned = harTal ? ok(nedR, 'svar med tommel ned') : null;
  const sen = ok(senR, 'de seneste samtaler');
  return {
    kilde: 'bot', type: p.type, visning: p.visning, fra: p.fra, til: p.til, klokke: p.klokke ? p.klokke.slice(0, 5).replace(':', '.') : null, note: p.note || null,
    site: valgt, siteNavn: MARKED[valgt], daekning: d, daekningHaendelser: dH,
    gemt: { fra: gemtFra, dage: RYD_DAGE, tekst: 'Samtaler og tommel slettes efter ' + RYD_DAGE + ' dage. "Alle tider" er det, der stadig er gemt.' },
    tal: { ...marked[valgt] }, marked,
    stemning, spoergsmaal: chips ? chips.slice(0, 10) : null,
    feedback, nedPeriode: ned ? ned.filter(r => valgt === 'alle' || r.s === valgt).slice(0, 20).map(r => ({ q: r.q, a: r.a, ts: r.ts, site: r.s })) : null,
    seneste: sen ? sen.filter(r => valgt === 'alle' || (r.site || 'dk') === valgt).slice(0, 12) : null,
    tekster: chatTekster(),
    fejl
  };
}

/* Den tyske backend har ikke bottens tabeller: de ligger i den danske database, som den aldrig
   maa roere (db.js). Tallene hentes i stedet fra bottens egen statistik for de samme danske
   kalenderdage og gives i samme form som chat(). Botten sender null for tal, den ikke har dage
   til, og null som daekning, naar den daekker hele perioden. Tommel ned findes kun pr. sprog,
   saa 'alle' spoerger om begge. */
async function chatFraBot(dage, site) {
  if (!botOpsat()) throw new Error('Panelet kan ikke nå botten. Sæt BOT_ADMIN_PASSWORD i Netlify.');
  const p = omfang(dage), valgt = (site === 'dk' || site === 'de') ? site : 'alle';
  const sider = valgt === 'alle' ? ['dk', 'de'] : [valgt];
  const svarene = await Promise.all(sider.map(s => bot('admin_stats', { site: s, fra: p.fra, til: p.til })));
  const st = svarene[0];
  if (!st.periode || !st.perioden || !st.nu || !st.alleTider) throw new Error('Botten er ikke opdateret endnu, så dens tal følger ikke den valgte periode.');
  const af = dageMellem(p.fra, p.til);
  const daek = d => d ? { fra: d.fra || null, til: d.til || null, dage: d.dage || 0, af, hel: false, grund: d.grund || null }
    : { fra: p.fra, til: p.til, dage: af, af, hel: true, grund: null };
  const gemtDage = (st.gemt && Number(st.gemt.dage)) || RYD_DAGE;
  const tal = k => { const per = st.perioden[k] || {}, nu = st.nu[k] || {}, alle = st.alleTider[k] || {};
    return { navn: MARKED[k], i_perioden: per.samtaler, med_mail: per.medMail, sendt_videre: per.sendtVidere,
      aabne: nu.aabne, alle: nu.aabne, ulaeste: nu.ulaeste, vil_have_menneske: nu.venterPaaMenneske, alle_tider: alle.samtaler }; };
  const per = st.perioden[valgt] || {}, alle = st.alleTider[valgt] || {};
  const harTal = per.samtaler != null;
  const ned = !harTal ? null : [].concat(...svarene.map((x, i) => (x.recentDownsPeriode || []).map(r => ({ q: r.q, a: r.a, ts: r.ts, site: sider[i] }))))
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 20);
  const fb = per.feedback || { up: null, down: null };
  return {
    kilde: 'bot', type: p.type, visning: p.visning, fra: p.fra, til: p.til, klokke: p.klokke ? p.klokke.slice(0, 5).replace(':', '.') : null, note: p.note || null,
    site: valgt, siteNavn: MARKED[valgt], daekning: daek(st.daekning), daekningHaendelser: daek(st.daekningHaendelser),
    gemt: { fra: (st.gemt && st.gemt.fra) || chatGemtFra(), dage: gemtDage, tekst: 'Samtaler og tommel slettes efter ' + gemtDage + ' dage. "Alle tider" er det, der stadig er gemt.' },
    // kun det valgte sprog: den tyske backend faar aldrig de danske tal med i svaret
    tal: tal(valgt), marked: Object.fromEntries([...new Set([valgt].concat(sider))].map(k => [k, tal(k)])),
    stemning: harTal ? (per.stemning || []) : null, spoergsmaal: Array.isArray(per.chips) ? per.chips.slice(0, 10) : null,
    feedback: { periode: { up: fb.up, down: fb.down }, alleTider: alle.feedback || { up: null, down: null }, kilde: 'bot',
      alleTiderNavn: 'seneste ' + gemtDage + ' dage',
      tekst: 'periode er tommel op og ned givet i perioden. alleTider er alt, der stadig er gemt: tommel slettes efter ' + gemtDage + ' dage.' },
    nedPeriode: ned, seneste: null,
    tekster: chatTekster(),
    fejl: []
  };
}

/* ── raad: "Hvad skal vi goere", kun ud fra tal der kan staa alene ─────────
   Tragten bruges kun, naar trinene er fra samme kilde og samme dage. Hastighed tages
   fra dagvagtens maalinger (vh_hastighed), ikke fra om nogen har aabnet Oppetid. */
const procent = x => Math.round(x * 100) + ' %';
async function raad() {
  const ud = [];
  const [t, seoR, op, hastR, hastC, chatR] = await Promise.allSettled([
    tragt('7d', { udenInstall: true }),
    sql ? sql`SELECT score, rapport, koert FROM vh_seo ORDER BY id DESC LIMIT 1` : Promise.resolve([]),
    sql ? oppetid() : Promise.resolve(null),
    // én maaling pr. dansk dag (dagens seneste), de seneste 7 kalenderdage. Gamle dage kan have 2-3 raekker,
    // som ellers ville veje dobbelt.
    sql ? sql`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mobil)::int AS mobil, count(*)::int AS n
              FROM (SELECT DISTINCT ON ((maalt AT TIME ZONE 'Europe/Copenhagen')::date) mobil FROM vh_hastighed
                    WHERE mobil > 0 AND (maalt AT TIME ZONE 'Europe/Copenhagen')::date >= ${dagPlus(dkIdag(), -6)}::date
                    ORDER BY (maalt AT TIME ZONE 'Europe/Copenhagen')::date, maalt DESC) x` : Promise.resolve([]),
    sql ? sql`SELECT vaerdi FROM vh_cache WHERE noegle = ${UDGAVE + 'hastighed'} AND udloeber > now()` : Promise.resolve([]),
    // chatbottens tabeller ligger kun i den danske database. Den tyske backend spoerger botten selv.
    !harChat ? Promise.resolve([{ n: 0 }]) :
    !profil.botTabeller ? (botOpsat() ? bot('admin_stats', { site: profil.chat, days: 1 }).then(st => [{ n: (st.nu && st.nu[profil.chat] || {}).venterPaaMenneske || 0 }]) : Promise.resolve([{ n: 0 }]))
      : sql ? sql`SELECT count(*)::int AS n FROM vh_conversations WHERE needs_human AND NOT archived` : Promise.resolve([{ n: 0 }])
  ]);
  // 1. tragten: hvor mange af de besoegende trykker paa en hent-knap, og hvor mange naar en butik
  if (t.status === 'fulfilled' && t.value.trin) {
    const [a, b, c] = t.value.trin, d = t.value.daekning || {};
    const dage = d.fra ? (d.fra === d.til ? dkTekst(d.fra) : dkTekst(d.fra) + ' til ' + dkTekst(d.til)) : '';
    if (a.tal >= 20 && b.tal != null) {
      ud.push({ grad: 'info', side: 'tragt', tekst: procent(b.tal / a.tal) + ' af de besøgende trykkede på en hent-knap (' + b.tal + ' af ' + a.tal +
        ' besøgende, talt pr. dag, ' + dage + ', egen tæller). Det er det tal, forsiden skal flytte.' });
      if (b.tal >= 10 && c.tal != null && c.tal / b.tal < 0.6)
        ud.push({ grad: 'info', side: 'tragt', tekst: 'Kun ' + procent(c.tal / b.tal) + ' af dem, der trykkede på en hent-knap, kom videre til App Store eller Google Play. De andre sad ved en computer og kom kun til hent-siden.' });
    }
    const st = t.value.steder || [];
    if (st.length && st[0].klik >= 3) {
      const ialt = st.reduce((x, y) => x + y.klik, 0);
      ud.push({ grad: 'godt', side: 'tragt', tekst: 'Flest tryk på hent-knapperne kommer fra "' + st[0].navn + '"' +
        (st[0].sti && st[0].sti !== '/' && !/^\/hent\/?$/.test(st[0].sti) ? ' på ' + st[0].sti : '') +
        ' (' + Math.round(st[0].klik / ialt * 100) + ' % af ' + ialt + ' tryk den seneste uge, også computere, der kun kom til hent-siden). Det afsnit overbeviser folk. Brug det i annoncer og opslag.' });
    }
  }
  // 2. seo
  if (seoR.status === 'fulfilled' && seoR.value[0]) {
    const r = seoR.value[0].rapport || {}; const o = r.opgaver || [];
    const fejl = o.filter(x => x.grad === 'fejl'), advar = o.filter(x => x.grad === 'advar'), info = o.filter(x => x.grad === 'info');
    // samme score som SEO-siden (seoSamlet): gemt med den gamle regel 1 regnes den om efter den nuvaerende
    let sc = null;
    try { sc = Number(r.scoreRegel || 1) === seo.SCORE_REGEL.version ? (seoR.value[0].score != null ? seoR.value[0].score : r.score)
      : (r.sider ? seo.scoreAfSider(r.sider, r.antalSider).score : null); } catch (e) { sc = null; }
    const scoreTekst = sc != null ? ' Score ' + sc + '.' : '';
    if (fejl.length) ud.push({ grad: 'advar', side: 'seo', tekst: fejl.length + ' fejl på siden, som Google ser: ' + fejl[0].hvad + '. Ret dem under SEO og GEO.' });
    else if (advar.length) ud.push({ grad: 'info', side: 'seo', tekst: advar.length + ' ting at forbedre for Google, vigtigst: ' + advar[0].hvad + ' (' + (advar[0].sider||[]).length + ((advar[0].sider||[]).length === 1 ? ' side' : ' sider') + '). Klik på den under SEO og GEO, så foreslår Claude en rettelse.' });
    else if (info.length) ud.push({ grad: 'godt', side: 'seo', tekst: 'Seneste gennemgang fandt ingen fejl eller advarsler, kun ' + info.length + (info.length === 1 ? ' bemærkning' : ' bemærkninger') + '.' + scoreTekst });
    else ud.push({ grad: 'godt', side: 'seo', tekst: 'Seneste gennemgang fandt intet at rette.' + scoreTekst });
  } else ud.push({ grad: 'info', side: 'seo', tekst: 'Der er ikke kørt en SEO-gennemgang endnu. Klik Kør gennemgang under SEO og GEO, det tager et minut.' });
  // 3. oppetid
  if (op.status === 'fulfilled' && op.value && op.value.uge) {
    const u = op.value.uge;
    if (u.nede > 0) ud.push({ grad: 'advar', side: 'oppetid', tekst: 'Siden svarede ikke ' + u.nede + (u.nede === 1 ? ' gang' : ' gange') + ' den seneste uge. Se hvornår under Oppetid.' });
    else if (u.alle > 0) ud.push({ grad: 'godt', side: 'oppetid', tekst: 'Siden har svaret hver gang, vi tjekkede den seneste uge, ' + u.alle + ' tjek, i snit ' + u.ms + ' ms.' });
  }
  // 4. hastighed: midtervaerdien af dagvagtens maalinger den seneste uge (Googles tal svinger meget fra gang til gang)
  if (hastR.status === 'fulfilled' && hastR.value[0] && hastR.value[0].n > 0 && hastR.value[0].mobil != null) {
    const { mobil, n } = hastR.value[0];
    const c = hastC.status === 'fulfilled' && hastC.value[0] ? (hastC.value[0].vaerdi || {}) : {};
    const lcp = c.mobil && c.mobil.lcp;
    const hvor = ' hos Google på mobil den seneste uge (midterværdien af ' + n + (n === 1 ? ' dags måling' : ' dages målinger') + ' fra dagvagten, én pr. dag).';
    if (mobil < 80) ud.push({ grad: 'info', side: 'oppetid', tekst: 'Forsiden scorer ' + mobil + hvor + ' Over 90 er grønt.' +
      (lcp ? ' Ved seneste måling under Oppetid blev det største element vist efter ' + (lcp / 1000).toFixed(1).replace('.', ',') + ' sekunder.' : '') });
    else if (mobil >= 90) ud.push({ grad: 'godt', side: 'oppetid', tekst: 'Forsiden scorer ' + mobil + hvor + ' Det er grønt.' });
  }
  // 5. chatten
  if (chatR.status === 'fulfilled' && chatR.value[0] && chatR.value[0].n > 0) {
    const n = chatR.value[0].n;
    ud.unshift({ grad: 'advar', side: 'chat', tekst: n + (n === 1 ? ' kunde venter' : ' kunder venter') + ' på et menneske i chatten. Svar dem under Chat.' });
  }
  const tv = t.status === 'fulfilled' ? t.value : null;
  return { punkter: ud.slice(0, 6), fra: new Date().toISOString(),
    periode: tv && tv.daekning ? { fra: tv.daekning.fra, til: tv.daekning.til } : null };
}

/* ── uge: denne uge (fra mandag) mod samme stykke af sidste uge, fra egne taellere ──
   Mandag og klokkeslaet regnes i dansk vaegurstid, ogsaa i uger med skift til og fra
   sommertid. Sidste uge slutter samme ugedag og samme klokkeslaet som nu. */
async function uge() {
  if (!sql) throw new Error('Databasen er ikke sat op');
  await opret();
  const nu = dkNu(), mandag = dagPlus(nu.dato, -nu.ugedag), mandagFoer = dagPlus(mandag, -7), dagFoer = dagPlus(nu.dato, -7);
  const vD = vindue(mandag, nu.dato, nu.klokke), vS = vindue(mandagFoer, dagFoer, nu.klokke);
  const fejl = [];
  let start = null; try { start = await taellerStart(); } catch (e) { fejl.push(fejlObj('egen', e)); }
  const tal = async v => {
    const ud = { besoegende: null, visninger: null, flestFraEnGaest: null, klik: null, klikGaester: null, samtaler: null };
    const [b, k, s] = await Promise.allSettled([
      // pr. dag og gaest: antal gaest-dage er besoegende pr. dag lagt sammen
      sql`SELECT count(*)::int AS besoegende, coalesce(sum(n), 0)::int AS visninger, coalesce(max(n), 0)::int AS flest
          FROM (SELECT count(*) AS n FROM vh_besoeg WHERE ts >= (${v.a}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (${v.b}::timestamp AT TIME ZONE 'Europe/Copenhagen')
                GROUP BY (ts AT TIME ZONE 'Europe/Copenhagen')::date, gaest) x`,
      qKlik(v),
      // samtalerne ligger i bottens tabeller, som kun den danske database har
      profil.botTabeller ? sql`SELECT count(*)::int AS n FROM vh_conversations WHERE created_at >= (${v.a}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND created_at < (${v.b}::timestamp AT TIME ZONE 'Europe/Copenhagen')`
        : Promise.resolve(null)
    ]);
    if (b.status === 'fulfilled') Object.assign(ud, { besoegende: b.value[0].besoegende, visninger: b.value[0].visninger, flestFraEnGaest: b.value[0].flest });
    else fejl.push(fejlObj('egen', b.reason));
    if (k.status === 'fulfilled') Object.assign(ud, { klik: k.value[0].tryk_butik, klikGaester: k.value[0].gaester_butik });
    else fejl.push(fejlObj('egen', k.reason, 'Klik-tælleren svarede ikke: ' + String((k.reason || {}).message || k.reason).slice(0, 160)));
    if (s.status === 'fulfilled') ud.samtaler = s.value ? s.value[0].n : null; else fejl.push(fejlObj('bot', s.reason, 'Chatsamtalerne kunne ikke tælles: ' + String((s.reason || {}).message || s.reason).slice(0, 160)));
    return ud;
  };
  const [denne, sidste] = await Promise.all([tal(vD), tal(vS)]);
  // sammenligningen gives kun, naar taellerne daekker hele sidste uges stykke
  const dS = daekning(mandagFoer, dagFoer, start && start.besoeg), kS = daekning(mandagFoer, dagFoer, start && start.klik);
  return { denne, sidste, kilde: 'egen',
    fra: mandag, til: nu.dato, fraFoer: mandagFoer, tilFoer: dagFoer, klokke: nu.klokke.slice(0, 5).replace(':', '.'),
    fraTid: dkInstant(mandag, '00:00:00'), tilTid: new Date().toISOString(),
    fraFoerTid: dkInstant(mandagFoer, '00:00:00'), tilFoerTid: dkInstant(dagFoer, nu.klokke),
    besoegendeDefinition: 'pr_dag_lagt_sammen',
    besoegendeTekst: 'Besøgende pr. dag, lagt sammen. Tælleren kan ikke genkende nogen fra dag til dag, så én, der kommer mandag og tirsdag, tæller to gange.',
    // false: samtalerne kan ikke taelles her (de ligger i bottens tabeller i den danske database), saa raekken vises ikke
    samtalerMed: !!profil.botTabeller,
    foersteUge: !dS.hel, klikFoersteUge: !kS.hel,
    grund: !dS.hel ? ingenSml(dS) : !kS.hel ? 'Klik til butik. ' + ingenSml(kS) : null,
    fejl };
}

/* ── oppetid ────────────────────────────────────────────────────────────────
   Vagten tjekker forsiden hver time. Hvert vindue (doegn, 7 og 30 dage) siger, hvilket stykke
   tid tjekkene faktisk daekker (foerste og sidste tjek, timer), saa "seneste 30 dage" ikke
   paastaas, naar vagten kun har koert i 20 dage. Svartiden er hele hentningen af forsiden fra
   en Netlify-server (med opkobling), ikke den ventetid en besoegende i Danmark oplever. */
async function oppetid() {
  if (!sql) throw new Error('Databasen er ikke sat op');
  await opret();
  const q = iv => sql`SELECT count(*)::int AS alle, count(*) FILTER (WHERE NOT oppe)::int AS nede, avg(ms)::int AS ms,
                        min(hvornaar) AS fra, max(hvornaar) AS til
                      FROM vh_oppetid WHERE hvornaar > now() - ${iv}::interval`;
  const [d, u, m, sidste, haendelser, f] = await Promise.all([ q('1 day'), q('7 days'), q('30 days'),
    sql`SELECT oppe, ms, status, fejl, hvornaar FROM vh_oppetid ORDER BY id DESC LIMIT 1`,
    sql`SELECT oppe, ms, status, fejl, hvornaar FROM vh_oppetid WHERE NOT oppe ORDER BY id DESC LIMIT 20`,
    sql`SELECT min(hvornaar) AS t FROM vh_oppetid` ]);
  const foerste = f[0] && f[0].t ? new Date(f[0].t).toISOString() : null;
  const komma = n => String(n).replace('.', ',');
  const vin = (r, timer, navn) => {
    const x = r[0] || {}, fra = x.fra ? new Date(x.fra).toISOString() : null, til = x.til ? new Date(x.til).toISOString() : null;
    // hele vinduet er daekket, naar vagten koerte allerede ved vinduets start (et tjek i timen)
    const hel = !!foerste && Date.parse(foerste) <= Date.now() - (timer - 1) * 3600000;
    const daekket = fra && til ? Math.round((Date.parse(til) - Date.parse(fra)) / 3600000 * 10) / 10 : 0;
    const dage = Math.round(daekket / 24 * 10) / 10;
    return { alle: x.alle || 0, nede: x.nede || 0, ms: x.ms != null ? x.ms : null, oppetid: x.alle ? (1 - x.nede / x.alle) : null,
      fra, til, timer: daekket, dage, af: timer, hel,
      tekst: hel || !fra ? navn : 'Siden ' + (timer <= 24 ? dkTid(fra) : dkTekst(dkNu(fra).dato)),
      grund: hel ? null : !fra ? 'Ingen tjek endnu.' : punktum('Vagten startede ' + dkTid(foerste) + ', så kun ' + komma(timer <= 24 ? daekket : dage) +
        (timer <= 24 ? ' af ' + timer + ' timer' : ' af ' + Math.round(timer / 24) + ' dage') + ' er med') };
  };
  return { kilde: 'oppetid', foerste,
    dag: vin(d, 24, 'Seneste døgn'), uge: vin(u, 7 * 24, 'Seneste 7 dage'), maaned: vin(m, 30 * 24, 'Seneste 30 dage'),
    sidste: sidste[0] || null, haendelser,
    svartid: { kilde: 'oppetid', dag: d[0] ? d[0].ms : null, uge: u[0] ? u[0].ms : null,
      tekst: 'Tid for at hente hele forsiden fra en Netlify-server (som standard i USA), med opkobling og eventuel omdirigering. Det er ikke den ventetid, en besøgende i Danmark oplever, så brug den til at se udsving. Serverens egen svartid står under Sidehastighed.' } };
}

/* ── seo og geo ─────────────────────────────────────────────────────────────
   Gennemgangen og historikken er jeres egen (vh_seo). Gamle gennemgange (gemt med regel 1, som
   kunne give 100 trods advarsler) regnes om efter regel 2, og historikken har én gennemgang pr.
   dansk dag. Muligheder er Search Console (90 dage, skoen maerket). AI-trafikken foelger den
   valgte periode og er Google Analytics, kun cookie-ja. */
async function seoSamlet(dage) {
  if (!sql) throw new Error('Databasen er ikke sat op');
  await opret();
  const p = omfang(dage), fejl = [];
  const [sidste, hist] = await Promise.all([
    sql`SELECT score, rapport, koert FROM vh_seo ORDER BY id DESC LIMIT 1`,
    // den seneste gennemgang pr. dansk dag, saa en dobbeltkoersel ikke tegner to punkter
    sql`SELECT DISTINCT ON ((koert AT TIME ZONE 'Europe/Copenhagen')::date) score, koert,
          COALESCE((rapport->>'scoreRegel')::int, 1) AS regel, rapport->'sider' AS sider, (rapport->>'antalSider')::int AS antal
        FROM vh_seo ORDER BY (koert AT TIME ZONE 'Europe/Copenhagen')::date DESC, id DESC LIMIT 12`
  ]);
  const nyRegel = seo.SCORE_REGEL.version;
  let g = sidste[0] ? { ...sidste[0].rapport, koert: sidste[0].koert } : null;
  if (g && Number(g.scoreRegel || 1) !== nyRegel) {
    const s = seo.scoreAfSider(g.sider, g.antalSider);
    g = { ...g, scoreGemt: g.score, score: s.score, straf: s.straf, scoreRegel: nyRegel, scoreForklaring: seo.SCORE_REGEL.tekst, scoreGenberegnet: true };
  }
  const historik = seo.historikPrDag(hist.map(h => Number(h.regel) === nyRegel ? h
    : { score: seo.scoreAfSider(h.sider, h.antal).score, koert: h.koert, regel: nyRegel }), 12);
  const ud = { kilde: 'seo', type: p.type, visning: p.visning, fra: p.fra, til: p.til,
    gennemgang: g, historik, historikTekst: 'Én gennemgang pr. dag. Gamle gennemgange er regnet om efter den nye regel.',
    muligheder: null, ai: null,
    kildeFor: { gennemgang: 'seo', historik: 'seo', muligheder: 'gsc', ai: 'ga4' }, fejl };
  const kast = (kilde, e) => fejl.push(fejlObj(kilde, (e && e.raa) || e, e && e.tekst));
  if (G.opsatGsc()) { try { ud.muligheder = await husk('seo-muligheder', 6 * TIME, () => seo.muligheder()); } catch (e) { kast('gsc', e); } }
  if (G.opsat()) {
    try {
      // perioden foer sammenlignes kun, naar Google Analytics har tal for hele den
      const gS = await ga4Start().catch(() => undefined);
      const dF = gS ? daekning(p.foerFra, p.foerTil, gS) : null;
      const foerOk = !!(dF && dF.hel && p.ga4SmlOk);
      // Google spoerges kun om de dage, den har hele tal for (ga4Del). Kurvens dage foer dem er null (ga4Fra).
      const q = ga4Del(p, gS);
      ud.ai = await husk('seo-ai:' + dage + ':' + p.fra + ':' + p.til + ':' + (p.time != null ? p.time : ''), 5 * MINUT, async () => {
        const a = await seo.aiTrafik(dage, foerOk ? q : { ...q, ga4SmlOk: false, nuSml: null });
        const mS = await maalStatus((a.kilder || []).reduce((s, x) => s + (x.keyEvents || 0), 0));
        if (!mS.maales) (a.kilder || []).forEach(x => { x.keyEvents = null; });
        a.konverteringer = { maales: mS.maales, kilde: 'ga4', grund: mS.grund };
        a.daekning = gS ? daekning(p.fra, p.til, gS) : null;
        a.smlGrund = a.sml ? null : !p.ga4SmlOk ? 'Google har endnu ingen hel time i dag at sammenligne med.'
          : gS === undefined ? 'Kunne ikke se, hvornår Google-tallene starter.' : ingenSml(dF);
        return a;
      });
      if (ud.ai && Array.isArray(ud.ai.fejl)) fejl.push(...ud.ai.fejl);
    } catch (e) { ud.ai = null; kast('ga4', e); }
  }
  return ud;
}
async function seoKoer() {
  if (!sql) throw new Error('Databasen er ikke sat op');
  await opret();
  const r = await seo.gennemgang();
  await sql`INSERT INTO vh_seo (score, rapport) VALUES (${r.score}::int, ${JSON.stringify(r)})`;
  await sql`DELETE FROM vh_seo WHERE id NOT IN (SELECT id FROM vh_seo ORDER BY id DESC LIMIT 60)`;
  return r;
}
async function seoUdkast(ord, hint, hvem) {
  const u = await forfatter.udkast(ord, hint);
  const r = await blogGem({ titel:u.titel, slug:u.slug, resume:u.resume, brod:u.brod, status:'kladde', kilde:'claude, ud fra "' + ord + '"' }, hvem);
  return { ...r, titel: u.titel };
}

/* ── blog og links ─────────────────────────────────────────────────────── */
const slugify = s => String(s||'').toLowerCase().trim().replace(/[^\wæøå\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').slice(0,80);
async function blogGem(p, hvem) {
  await opret();
  const slug = slugify(p.slug || p.titel || 'uden-titel');
  const udg = p.status === 'udgivet' ? (p.udgivet || new Date().toISOString()) : null;
  let r;
  if (p.id) r = await sql`UPDATE vh_blog SET slug=${slug}, titel=${p.titel||''}, resume=${p.resume||''}, brod=${p.brod||''},
      billede=${p.billede||''}, status=${p.status||'kladde'}, udgivet=COALESCE(udgivet, ${udg}), opdateret=now()
    WHERE id=${Number(p.id)} RETURNING id, slug, status`;
  else r = await sql`INSERT INTO vh_blog (slug, titel, resume, brod, billede, status, kilde, udgivet, opdateret)
    VALUES (${slug}, ${p.titel||''}, ${p.resume||''}, ${p.brod||''}, ${p.billede||''}, ${p.status||'kladde'}, ${p.kilde||'panel'}, ${udg}, now())
    ON CONFLICT (slug) DO UPDATE SET titel=EXCLUDED.titel, resume=EXCLUDED.resume, brod=EXCLUDED.brod, billede=EXCLUDED.billede,
      status=EXCLUDED.status, udgivet=COALESCE(vh_blog.udgivet, EXCLUDED.udgivet), opdateret=now() RETURNING id, slug, status`;
  await log('blogindlæg gemt', slug, hvem);
  return r[0];
}
function utmLink(p) {
  const u = new URL(p.landing || profil.site + '/');
  const s = (k, v) => { if (v) u.searchParams.set(k, String(v).trim().toLowerCase().replace(/\s+/g,'-')); };
  s('utm_source', p.kilde); s('utm_medium', p.medie); s('utm_campaign', p.kampagne); s('utm_content', p.indhold);
  return u.toString();
}

/* ── sider i panelet, der kun findes paa den danske side ─────────────────
   Profilen (side.js, skjul) skjuler dem i panelet. Her afvises deres handlinger ogsaa, saa den
   tyske backend aldrig udgiver blog eller rettelser paa en side, og intet havner i tomme sider. */
const HANDLING_SIDE = { annoncer: 'annoncer',
  blog: 'blog', 'blog-et': 'blog', 'blog-gem': 'blog', 'blog-slet': 'blog', 'blog-udgiv': 'blog', 'soro-hent': 'blog', 'seo-udkast': 'blog',
  links: 'links', 'links-lav': 'links', 'links-gem': 'links', 'links-slet': 'links',
  indhold: 'indhold', 'indhold-gem': 'indhold', 'indhold-scan': 'indhold', felter: 'indhold', 'felt-gem': 'indhold', 'felt-fortryd': 'indhold',
  rettelser: 'indhold', 'rettelse-gem': 'indhold', 'rettelse-slet': 'indhold', 'rettelser-udgiv': 'indhold', 'seo-forslag': 'indhold', udgiv: 'indhold',
  // chatbotten er den danske sides. Den tyske backend taler slet ikke med den.
  chat: 'chat', 'bot-liste': 'chat', 'bot-hent': 'chat', 'bot-stat': 'chat', 'bot-svar': 'chat', 'bot-tagover': 'chat',
  'bot-slet': 'chat', 'bot-ret': 'chat', 'bot-slet-besked': 'chat' };
const harChat = !profil.skjul.includes('chat');
/* Botten er faelles for begge sider. Den danske backend ser begge sprog, som foer. Den tyske ser
   og roerer kun tyske samtaler (side.js, chat), uanset hvad panelet beder om. */
const chatSite = s => profil.kode === 'dk' ? s : profil.chat;
async function egenSamtale(id) {
  if (profil.kode === 'dk') return;
  const c = await bot('admin_get', { conversationId: id, peek: true });
  if ((c.site || 'dk') !== profil.chat) throw new Error('Samtalen hører ikke til ' + profil.navn + '.');
  return c;
}

/* ── indgang ───────────────────────────────────────────────────────────── */
exports.handler = async (ev) => {
  if (ev.httpMethod === 'OPTIONS') return svar(200, {});
  let k = {}; try { k = ev.body ? JSON.parse(ev.body) : {}; } catch (e) {}
  const d = (ev.queryStringParameters || {}).d || k.d || '';

  // offentlig: profilen (det, der alligevel staar paa siden) og hvad der er sat op. Databasen er
  // false, naar den mangler eller er afvist af ejermaerket (db.js), og databaseFejl siger hvorfor.
  if (d === 'status') { const db = await dbStatus(); return svar(200, { ok:true, side: profil.offentlig(), opsat: {
    kode: auth.harKode(), database: db.ok, databaseFejl: db.fejl, analytics: G.opsat(), soegning: G.opsatGsc(),
    meta: meta.opsat(), googleads: gads.opsat(), appstore: asc.opsat(), googleplay: gplay.opsat(),
    mail: mail.opsat(), udgivelse: !!process.env.NETLIFY_BUILD_HOOK, webhook: !!process.env.WEBHOOK_SECRET, soro: soro.opsat(), bot: botOpsat(), claude: forfatter.opsat(), netlify: udgivelse.opsat(), support: sager.status() } }); }

  const ip = ((ev.headers||{})['x-nf-client-connection-ip'] || (ev.headers||{})['x-forwarded-for'] || '').split(',')[0].trim();
  if (d === 'login') {
    try {
      const b = await auth.logInd(k.navn, k.kode, ip);
      if (!b) return svar(401, { fejl: 'Forkert navn eller adgangskode' });
      // har brugeren to-trins slaaet til, gives kun en halv seddel, indtil koden fra telefonen passer
      if (await auth.totpFor(b.navn)) return svar(200, { toTrins: true, halv: auth.halvSeddel(b.navn, b.rolle) });
      await log('logget ind', k.husk ? 'husk mig i 30 dage' : '', b.navn);
      return svar(200, { seddel: auth.seddel(b.navn, b.rolle, !!k.husk), navn: b.navn, rolle: b.rolle });
    } catch (e) { return svar(500, { fejl: e.message }); }
  }

  if (d === 'login-2') {
    const h = auth.laesHalv(k.halv); if (!h) return svar(401, { fejl: 'Start forfra, der gik for lang tid' });
    const hem = await auth.totpFor(h.navn);
    if (!hem || !auth.totp.passer(hem, k.kode)) { await log('forkert engangskode', '', h.navn); return svar(401, { fejl: 'Koden passer ikke. Prøv den næste fra appen.' }); }
    await log('logget ind med to trin', '', h.navn);
    return svar(200, { seddel: auth.seddel(h.navn, h.rolle, !!k.husk), navn: h.navn, rolle: h.rolle });
  }
  const bruger = await auth.bekraeft(auth.laes(k.seddel || (ev.headers||{})['x-seddel']));
  if (!bruger) return svar(401, { fejl: 'Log ind igen' });
  if (HANDLING_SIDE[d] && profil.skjul.includes(HANDLING_SIDE[d])) return svar(404, { fejl: 'Den del af panelet findes ikke på backenden til ' + profil.navn + '.' });
  const skriv = () => { if (!auth.maa(bruger, 'redigerer')) throw new Error('Du kan kun kigge. Bed ejeren om at give dig adgang til at rette.'); };
  const ejer  = () => { if (!auth.maa(bruger, 'ejer')) throw new Error('Kun ejeren kan gøre det her.'); };
  const dage = k.dage || '28d';
  // svar gemmes kort (I dag 20 s, ellers 5 min). Svar med en kildefejl gemmes hoejst 20 s (cache.js), og fejlen logges.
  const cachet = (navn, lav, liv) => husk(navn + ':' + dage, liv || (dage === '24t' ? 20 * SEK : 5 * MINUT), medLog(lav));

  try {
    switch (d) {
      case 'live':      return svar(200, await husk('live', 30 * SEK, medLog(live)));
      case 'oversigt':  return svar(200, await cachet('oversigt', () => oversigt(dage)));
      case 'trafik':    return svar(200, await cachet('trafik',   () => trafik(dage)));
      case 'annoncer':  return svar(200, await cachet('annoncer', () => annoncer(dage)));
      case 'soegeord':  return svar(200, await cachet('soegeord', () => soegeord(dage)));
      case 'downloads': return svar(200, await cachet('downloads', () => downloads(dage), TIME));
      case 'tragt':     return svar(200, await cachet('tragt',    () => tragt(dage)));
      // chat: site 'dk' | 'de' | udeladt (= dansk og tysk samlet). Kildefejl logges.
      case 'chat':      return svar(200, await medLog(() => chat(dage, chatSite(k.site)))());
      // samtalerne, gennem bottens egen tjeneste
      case 'bot-liste': return svar(200, await bot('admin_list',  { site: chatSite(k.site || 'dk'), archived: !!k.arkiv }));
      case 'bot-hent':  await egenSamtale(k.id); return svar(200, await bot('admin_get', { conversationId: k.id, peek: !!k.kig }));
      // bottens tal for samme danske dage som resten af panelet. Siden sender dage (knappen);
      // den gamle side sendte kun dageTal, som oversaettes tilbage til knappen.
      case 'bot-stat': {
        const valg = k.dage || ({ 1: '24t', 2: 'igaar', 7: '7d', 28: '28d', 90: '90d', 92: '365d', 365: '365d' })[k.dageTal] || '28d';
        const p = omfang(valg);
        const st = await bot('admin_stats', { site: chatSite(k.site === 'de' ? 'de' : 'dk'), fra: p.fra, til: p.til, days: Math.min(p.d, 366) });
        // den gamle bot kender ikke fra/til og taeller 14 dage. Saa er periodetallene ikke til at stole paa.
        return svar(200, { ...st, valgtPeriode: { fra: p.fra, til: p.til, type: p.type, visning: p.visning },
          botOpdateret: !!st.periode, grund: st.periode ? null : 'Botten er ikke opdateret endnu, så dens tal følger ikke den valgte periode.' }); }
      case 'bot-svar':  { skriv(); await egenSamtale(k.id); const r = await bot('admin_reply', { conversationId: k.id, content: k.tekst });
        await log('svarede i chatten', String(k.id).slice(0,12), bruger.navn); return svar(200, r); }
      case 'bot-tagover': skriv(); await egenSamtale(k.id); return svar(200, await bot('admin_takeover', { conversationId: k.id, human: k.menneske !== false }));
      case 'bot-slet':  { skriv(); await egenSamtale(k.id); const r = await bot('admin_delete', { conversationId: k.id });
        await log('slettede en samtale', String(k.id).slice(0,12), bruger.navn); return svar(200, r); }
      case 'bot-ret':   skriv(); await egenSamtale(k.id); return svar(200, await bot('admin_edit_msg', { conversationId: k.id, messageId: k.beskedId, content: k.tekst }));
      case 'bot-slet-besked': skriv(); await egenSamtale(k.id); return svar(200, await bot('admin_delete_msg', { conversationId: k.id, messageId: k.beskedId }));
      case 'oppetid':   return svar(200, await oppetid());
      case 'raad':      return svar(200, await husk('raad', 5 * MINUT, medLog(raad)));
      case 'uge':       return svar(200, await husk('uge', MINUT, medLog(uge)));
      // et doegn (foer stod der 24*60*MIN, som er 5 doegn, fordi MIN er 5 minutter)
      case 'hastighed': { // en frisk maaling fra Maal nu, hvis der er en fra det seneste doegn, ellers dagvagtens
        const c = sql ? await sql`SELECT vaerdi FROM vh_cache WHERE noegle = ${UDGAVE + 'hastighed'} AND udloeber > now()` : [];
        return svar(200, c.length ? c[0].vaerdi : await husk('hastighed-gemt', TIME, medLog(hastighedGemt))); }
      case 'seo':       return svar(200, await medLog(() => seoSamlet(dage))());
      case 'seo-koer':  { ejer(); const r = await seoKoer(); await log('seo-gennemgang koert', 'score ' + r.score, bruger.navn); return svar(200, r); }
      case 'seo-forslag': { if (!k.felt || !k.side) return svar(400, { fejl:'Mangler felt eller side' });
        return svar(200, { forslag: await forfatter.forslag(k.felt === 'titel' ? 'titel' : 'besk', k.side) }); }
      // rettelser: gemmes med noegle "felt|adresse", saa Indhold-fanen og udgivelsen finder dem
      case 'rettelse-gem': { skriv(); await opret();
        if (!k.url || !['titel','besk'].includes(k.felt)) return svar(400, { fejl:'Mangler adresse eller felt' });
        const n = k.felt + '|' + k.url;
        await sql`INSERT INTO vh_indhold (noegle, vaerdi, side, beskrivelse, opdateret) VALUES (${n}, ${String(k.vaerdi||'').slice(0,400)}, ${k.url}, ${k.felt === 'titel' ? 'Titel' : 'Beskrivelse'}, now())
          ON CONFLICT (noegle) DO UPDATE SET vaerdi = EXCLUDED.vaerdi, opdateret = now()`;
        await log('rettelse gemt', k.felt + ' på ' + k.url, bruger.navn); return svar(200, { ok:true }); }
      case 'rettelse-slet': { skriv(); await opret(); await sql`DELETE FROM vh_indhold WHERE noegle = ${k.felt + '|' + k.url}`; return svar(200, { ok:true }); }
      case 'rettelser': { await opret(); const r = await sql`SELECT noegle, vaerdi, side, beskrivelse, opdateret FROM vh_indhold WHERE noegle LIKE 'titel|%' OR noegle LIKE 'besk|%' OR (noegle LIKE 'vh|%' AND beskrivelse LIKE '%ændret%') ORDER BY opdateret DESC`;
        return svar(200, { rettelser: r.map(x => ({ felt: x.noegle.split('|')[0], noegle: x.noegle.split('|').slice(1).join('|'), url: x.side, vaerdi: x.vaerdi, opdateret: x.opdateret })) }); }
      // maerkede felter: hentes fra den side der er live, saa panelet ved hvad der staar nu
      case 'indhold-scan': { ejer(); await opret();
        let urls = []; try { const sm = await (await fetch(udgivelse.SITE_URL() + '/sitemap.xml')).text(); urls = [...sm.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m => { try { const x = new URL(m[1]); return x.pathname; } catch (e) { return null; } }).filter(Boolean); } catch (e) {}
        if (!urls.includes('/')) urls.unshift('/'); if (!urls.includes('/hent/')) urls.push('/hent/');
        let fundet = 0;
        for (const sti of urls.filter(u => !u.startsWith('/post/'))) {
          try { const h = await (await fetch(udgivelse.SITE_URL() + sti)).text();
            for (const f of udgivelse.felterI(h)) { fundet++;
              // gemte aendringer beholdes; kun nye felter og uaendrede faar den live tekst
              await sql`INSERT INTO vh_indhold (noegle, vaerdi, side, beskrivelse, opdateret) VALUES (${'vh|' + f.noegle}, ${f.tekst}, ${sti}, ${'live'}, now())
                ON CONFLICT (noegle) DO UPDATE SET vaerdi = CASE WHEN vh_indhold.beskrivelse LIKE '%ændret%' THEN vh_indhold.vaerdi ELSE EXCLUDED.vaerdi END, side = EXCLUDED.side`; }
          } catch (e) {} }
        await log('felter hentet fra siden', fundet + ' felter', bruger.navn); return svar(200, { fundet }); }
      case 'felter': { await opret(); const r = await sql`SELECT noegle, vaerdi, side, beskrivelse, opdateret FROM vh_indhold WHERE noegle LIKE 'vh|%' ORDER BY side, noegle`;
        return svar(200, { felter: r.map(x => ({ noegle: x.noegle.slice(3), vaerdi: x.vaerdi, side: x.side, aendret: /ændret/.test(x.beskrivelse), opdateret: x.opdateret })) }); }
      case 'felt-gem': { skriv(); await opret(); if (!k.noegle) return svar(400, { fejl:'Mangler felt' });
        await sql`UPDATE vh_indhold SET vaerdi = ${String(k.vaerdi||'').slice(0,600)}, beskrivelse = 'ændret', opdateret = now() WHERE noegle = ${'vh|' + k.noegle}`;
        await log('felt rettet', k.noegle, bruger.navn); return svar(200, { ok:true }); }
      case 'felt-fortryd': { skriv(); await opret(); await sql`UPDATE vh_indhold SET beskrivelse = 'live' WHERE noegle = ${'vh|' + k.noegle}`; return svar(200, { ok:true }); }
      // proever hver forbindelse med et lille kald, saa man ser om noeglen virker
      case 'test': { ejer(); const ud = {};
        const proev = async (navn, fn) => { try { const t0 = Date.now(); const r = await fn(); ud[navn] = { ok:true, ms: Date.now()-t0, note: r || '' }; } catch (e) { ud[navn] = { ok:false, fejl: String(e.message||e).slice(0,140) }; } };
        if (G.opsat()) await proev('analytics', async () => {
          const r = await G.rapport({ dateRanges:[{startDate:'7daysAgo',endDate:'today'}], metrics:[{name:'sessions'}] });
          const nu = await G.realtid({ metrics:[{name:'activeUsers'}] });
          let strm = ''; try { const st = await G.realtid({ dimensions:[{name:'streamName'}], metrics:[{name:'eventCount'}] });
            strm = G.raekker(st).map(x => x.streamName + ' ' + x.eventCount + ' hændelser').join(', '); } catch (e) { strm = 'strøm ukendt'; }
          return 'ejendom ' + process.env.GA4_PROPERTY_ID + ', ' + G.samlet(r,'sessions') + ' besøg seneste uge, ' + G.samlet(nu,'activeUsers') + ' på siden de sidste 30 min' + (strm ? ' (' + strm + ')' : ', ingen hændelser modtaget de sidste 30 min'); }); else ud.analytics = { ok:false, fejl:'ikke sat op' };
        if (G.opsatGsc()) await proev('soegning', async () => { const r = await G.soegning({ startDate: iso(new Date(Date.now()-9*86400000)), endDate: iso(new Date(Date.now()-2*86400000)), dimensions:[], rowLimit:1 }); return ((r.rows||[])[0]||{}).clicks + ' klik seneste uge'; }); else ud.soegning = { ok:false, fejl:'ikke sat op' };
        if (meta.opsat()) await proev('meta', async () => { const r = await meta.forbrug(iso(new Date(Date.now()-8*86400000)), iso(new Date(Date.now()-86400000))); return r.length + ' kampagner'; }); else ud.meta = { ok:false, fejl:'ikke sat op' };
        if (gads.opsat()) await proev('googleads', async () => { const r = await gads.forbrug(iso(new Date(Date.now()-8*86400000)), iso(new Date(Date.now()-86400000))); return r.length + ' kampagner'; }); else ud.googleads = { ok:false, fejl:'ikke sat op' };
        if (asc.opsat()) await proev('appstore', async () => { const r = await asc.periode(iso(new Date(Date.now()-3*86400000)), iso(new Date(Date.now()-2*86400000))); return (r[0]||{}).downloads + ' downloads forleden'; }); else ud.appstore = { ok:false, fejl:'ikke sat op' };
        if (gplay.opsat()) await proev('googleplay', async () => { const r = await gplay.periode(iso(new Date(Date.now()-5*86400000)), iso(new Date(Date.now()-2*86400000))); return r.length + ' dage med tal'; }); else ud.googleplay = { ok:false, fejl:'ikke sat op' };
        if (!harChat) ud.bot = { ok:true, ms:0, note:'ingen chat på ' + profil.navn };
        else if (botOpsat()) await proev('bot', async () => { const r = await bot('admin_stats', { days: 7 }); return r.total + ' samtaler i alt'; }); else ud.bot = { ok:false, fejl:'ikke sat op' };
        if (forfatter.opsat()) await proev('claude', async () => { const r = await forfatter.forslag('titel', { url:'/', titel: profil.brand, besk:'', h1tekst: profil.brand }); return r.length + ' forslag'; }); else ud.claude = { ok:false, fejl:'ikke sat op' };
        if (udgivelse.opsat()) await proev('netlify', async () => { const r = await fetch('https://api.netlify.com/api/v1/sites/' + (process.env.SITE_NETLIFY_ID || profil.netlifySiteId), { headers:{ Authorization:'Bearer ' + process.env.NETLIFY_TOKEN } }); if (!r.ok) throw new Error('Netlify svarede ' + r.status); return (await r.json()).name; }); else ud.netlify = { ok:false, fejl:'ikke sat op' };
        if (mail.opsat()) ud.mail = { ok:true, note:'sender til ' + mail.TIL + ', brug Send prøvemail' }; else ud.mail = { ok:false, fejl:'ikke sat op' };
        // support-postkassen: logger ind over IMAP og taeller indbakken, laeser ingen mails
        { const st = sager.status(); if (st) { if (st.klar) await proev('support', () => require('../lib/imap.js').tjek()); else ud.support = { ok:false, fejl:'ikke sat op' }; } }
        { const db = await dbStatus(); ud.database = db.ok && !db.fejl ? { ok:true } : { ok:false, fejl: db.fejl || 'ikke sat op' }; }
        // Soro har kun et RSS-feed. Her laeses det, og der taelles, hvad der er kommet ind
        if (soro.opsat()) await proev('soro', async () => { const h = await soro.hent();
          const r = await sql`SELECT count(*)::int AS n, max(opdateret) AS sidst FROM vh_blog WHERE kilde = 'soro'`;
          return h.ifeed + ' indlæg i Soros feed, ' + r[0].n + ' hentet ind i alt' + (h.nye ? ', ' + h.nye + ' nye lige nu' : '') + (r[0].sidst ? ', seneste ' + new Date(r[0].sidst).toLocaleString('da-DK', { timeZone:'Europe/Copenhagen', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : ''); });
        else ud.soro = { ok:false, fejl:'ikke sat op' };
        if (sql) await proev('taeller', async () => { const r = await sql`SELECT count(*)::int AS n, count(DISTINCT gaest)::int AS g, max(ts) AS sidst FROM vh_besoeg WHERE ts > now() - interval '24 hours'`;
          return r[0].n + ' sidevisninger fra ' + r[0].g + ' besøgende de sidste 24 timer' + (r[0].sidst ? ', seneste ' + new Date(r[0].sidst).toLocaleTimeString('da-DK', { timeZone:'Europe/Copenhagen', hour:'2-digit', minute:'2-digit' }) : ''); });
        await log('forbindelser testet', Object.entries(ud).filter(([k,v]) => !v.ok && v.fejl !== 'ikke sat op').map(([k]) => k).join(', ') || 'alle ok', bruger.navn);
        return svar(200, ud); }
      case 'rettelser-udgiv': { ejer(); await opret();
        const r = await sql`SELECT noegle, vaerdi, side FROM vh_indhold WHERE noegle LIKE 'titel|%' OR noegle LIKE 'besk|%' OR (noegle LIKE 'vh|%' AND beskrivelse LIKE '%ændret%')`;
        const liste = r.map(x => x.noegle.startsWith('vh|') ? { felt:'vh', url: x.side, vaerdi: { noegle: x.noegle.slice(3), tekst: x.vaerdi } } : { felt: x.noegle.split('|')[0], url: x.side, vaerdi: x.vaerdi });
        if (!liste.length) return svar(400, { fejl:'Der er ingen rettelser at udgive' });
        const u = await udgivelse.udgiv(liste); await log('rettelser udgivet', (u.udgivet ? 'ja, ' : 'intet nyt, ') + liste.length + ' rettelser', bruger.navn);
        await glem('seo'); return svar(200, u); }
      case 'seo-udkast': { skriv(); if (!k.ord) return svar(400, { fejl:'Mangler soegeord' });
        const r = await seoUdkast(String(k.ord).slice(0,120), String(k.hint||'').slice(0,300), bruger.navn);
        await log('udkast skrevet af Claude', k.ord, bruger.navn); return svar(200, r); }
      case 'hastighed-nu': ejer(); await glem('hastighed'); return svar(200, await husk('hastighed', DOEGN, medLog(hastighed)));
      case 'opfrisk':   await glem(''); return svar(200, { ok: true });

      case 'noter':     await opret(); return svar(200, { noter: await sql`SELECT id, dato::text, tekst FROM vh_noter ORDER BY dato DESC LIMIT 200` });
      case 'noter-gem': skriv(); await opret();
        if (!k.dato || !k.tekst) return svar(400, { fejl:'Dato og tekst skal udfyldes' });
        await sql`INSERT INTO vh_noter (dato, tekst) VALUES (${k.dato}, ${String(k.tekst).slice(0,140)})`;
        await log('note tilføjet', k.tekst, bruger.navn); await glem('oversigt'); return svar(200, { ok:true });
      case 'noter-slet': skriv(); await opret(); await sql`DELETE FROM vh_noter WHERE id=${Number(k.id)}`;
        await glem('oversigt'); return svar(200, { ok:true });

      case 'links':     await opret(); return svar(200, { links: await sql`SELECT * FROM vh_links ORDER BY id DESC LIMIT 200` });
      case 'links-lav': return svar(200, { url: utmLink(k) });
      case 'links-gem': { skriv(); await opret();
        const url = utmLink(k);
        const r = await sql`INSERT INTO vh_links (navn, url, kilde, medie, kampagne, indhold)
          VALUES (${k.navn||k.kampagne||'uden navn'}, ${url}, ${k.kilde||''}, ${k.medie||''}, ${k.kampagne||''}, ${k.indhold||''}) RETURNING id`;
        await log('link bygget', k.kampagne || '', bruger.navn); return svar(200, { id: r[0].id, url }); }
      case 'links-slet': skriv(); await opret(); await sql`DELETE FROM vh_links WHERE id=${Number(k.id)}`; return svar(200, { ok:true });

      case 'indhold':   await opret(); return svar(200, { felter: await sql`SELECT noegle, vaerdi, side, beskrivelse, opdateret FROM vh_indhold ORDER BY side, noegle` });
      case 'indhold-gem': skriv(); await opret();
        for (const a of (k.aendringer||[])) if (a && a.noegle) await sql`INSERT INTO vh_indhold (noegle, vaerdi, side, beskrivelse, opdateret)
          VALUES (${a.noegle}, ${a.vaerdi||''}, ${a.side||''}, ${a.beskrivelse||''}, now())
          ON CONFLICT (noegle) DO UPDATE SET vaerdi = EXCLUDED.vaerdi, opdateret = now()`;
        await log('indhold gemt', (k.aendringer||[]).length + ' felter', bruger.navn); return svar(200, { gemt: (k.aendringer||[]).length });

      case 'soro-hent': { skriv(); const r = await soro.hent(); await log('Soro-feed hentet', r.nye + ' nye af ' + r.ifeed, bruger.navn); return svar(200, r); }
      case 'blog':      await opret(); return svar(200, { indlaeg: await sql`SELECT id, slug, titel, resume, billede, status, kilde, udgivet, opdateret FROM vh_blog ORDER BY COALESCE(udgivet, opdateret) DESC LIMIT 200` });
      case 'blog-et':   { await opret(); const r = await sql`SELECT * FROM vh_blog WHERE id=${Number(k.id)}`; return svar(200, { indlaeg: r[0]||null }); }
      case 'blog-gem':  skriv(); return svar(200, await blogGem(k.indlaeg||{}, bruger.navn));
      case 'blog-slet': skriv(); await opret(); await sql`DELETE FROM vh_blog WHERE id=${Number(k.id)}`;
        await log('blogindlæg slettet', String(k.id), bruger.navn); return svar(200, { slettet:true });

      case 'blog-udgiv': { ejer(); const r = await blogbyg.byg();
        await log('bloggen udgivet', (r.nyeSider||[]).length + ' nye sider, ' + r.antalIalt + ' i alt', bruger.navn); await glem('seo'); return svar(200, r); }
      case 'brugere':     ejer(); return svar(200, { brugere: await auth.brugere() });
      case 'bruger-gem':  { ejer(); const r = await auth.gemBruger(k); await log('bruger gemt', k.navn, bruger.navn); return svar(200, r); }
      case 'bruger-slet': ejer(); await auth.sletBruger(k.id); await log('bruger slettet', String(k.id), bruger.navn); return svar(200, { ok:true });

      case 'log': await opret(); return svar(200, { linjer: await sql`SELECT hvad, detalje, hvem, hvornaar FROM vh_log ORDER BY id DESC LIMIT 80` });
      case 'test-mail': { ejer(); const s = await mail.send('Prøve fra backenden til ' + profil.navn, '<p>Mailen virker. Sendt fra ' + profil.backend.replace(/^https?:\/\//, '') + '.</p>');
        await log('prøvemail', s.sendt ? s.til : s.grund, bruger.navn); return svar(s.sendt ? 200 : 400, s); }
      case 'udgiv': { ejer(); const krog = process.env.NETLIFY_BUILD_HOOK;
        if (!krog) return svar(400, { fejl: 'NETLIFY_BUILD_HOOK mangler i Netlify' });
        const r = await fetch(krog, { method:'POST' }); await log('side udgivet', r.ok ? 'ok' : 'fejl ' + r.status, bruger.navn);
        return svar(r.ok ? 200 : 502, { sat_i_gang: r.ok }); }
      case 'min-kode': await auth.skiftKode(bruger.navn, k.gammel, k.ny); await log('skiftede sin adgangskode', '', bruger.navn); return svar(200, { ok:true });
      case 'mig': return svar(200, { navn: bruger.navn, rolle: bruger.rolle, toTrins: !!(await auth.totpFor(bruger.navn)) });
      // to-trins: ny hemmelighed vises som qr, gemmes foerst naar en kode fra appen passer
      case 'totp-start': { const hem = auth.totp.ny(); return svar(200, { hemmelighed: hem, url: auth.totp.url(bruger.navn, hem) }); }
      case 'totp-bekraeft': { if (!auth.totp.passer(k.hemmelighed, k.kode)) return svar(400, { fejl: 'Koden passer ikke. Tjek at uret på telefonen går rigtigt.' });
        await auth.totpSaet(bruger.navn, k.hemmelighed); await log('to-trins slået til', '', bruger.navn); return svar(200, { ok:true }); }
      case 'totp-fjern': { const hem = await auth.totpFor(bruger.navn); if (hem && !auth.totp.passer(hem, k.kode)) return svar(400, { fejl: 'Koden passer ikke' });
        await auth.totpSaet(bruger.navn, ''); await log('to-trins slået fra', '', bruger.navn); return svar(200, { ok:true }); }
      case 'fejl': { await opret(); return svar(200, { fejl: await sql`SELECT hvad, detalje, hvem, hvornaar FROM vh_log WHERE hvad = 'FEJL' ORDER BY id DESC LIMIT 60`,
        antal24: (await sql`SELECT count(*)::int AS n FROM vh_log WHERE hvad = 'FEJL' AND hvornaar > now() - interval '1 day'`)[0].n }); }
      default: return svar(404, { fejl: 'Ukendt handling: ' + d });
    }
  } catch (e) {
    // hver fejl gemmes, saa de kan ses under Opsaetning, og dagvagten kan skrive hvis der kommer mange
    await log('FEJL', d + ': ' + String(e.message || e).slice(0, 300), bruger.navn);
    return svar(500, { fejl: String(e.message || e) }); }
};
