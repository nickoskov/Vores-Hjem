'use strict';
/**
 * Fælles adgang til Googles tjenester: Analytics og Search Console.
 *
 * Begge bruger samme servicekonto, som Nicko opretter i Google Cloud og
 * indsætter i Netlify som GA4_CREDENTIALS. Nøglen findes kun der. Den
 * passerer aldrig gennem panelet, gennem browseren eller gennem en chat.
 */
const crypto = require('crypto');

const OMRAADER = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly'
].join(' ');

let token = null;   // gemmes mellem kald, så vi ikke beder Google om et nyt hver gang

function konto() {
  const raa = process.env.GA4_CREDENTIALS || '';
  if (!raa) return null;
  try {
    // feltet tåler både ren JSON og base64, alt efter hvordan det blev indsat
    const t = raa.trim().startsWith('{') ? raa : Buffer.from(raa, 'base64').toString('utf8');
    const k = JSON.parse(t);
    return (k.client_email && k.private_key) ? k : null;
  } catch (e) { return null; }
}

const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))
  .toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

async function adgang() {
  if (token && token.udloeber > Date.now() + 60000) return token.vaerdi;
  const k = konto();
  if (!k) throw new Error('GA4_CREDENTIALS mangler i Netlify');

  const nu = Math.floor(Date.now() / 1000);
  const krav = b64({alg:'RS256', typ:'JWT'}) + '.' + b64({
    iss: k.client_email, scope: OMRAADER,
    aud: 'https://oauth2.googleapis.com/token', iat: nu, exp: nu + 3600 });
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(krav); sign.end();
  const jwt = krav + '.' + sign.sign(k.private_key, 'base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
  const d = await r.json();
  if (!r.ok) throw new Error('Google afviste nøglen: ' + (d.error_description || d.error || r.status));
  token = { vaerdi: d.access_token, udloeber: Date.now() + (d.expires_in || 3600) * 1000 };
  return token.vaerdi;
}

/* Google tillader kun ca. 10 samtidige Analytics-kald pr. ejendom, og flere kopier af
   funktionen deler den graense. Derfor koerer hoejst fire kald ad gangen fra én kopi,
   og et kald der rammer graensen, proeves én gang til lidt efter. */
const SAMTIDIGE = 4;
let koerer = 0; const koe = [];
async function plads() {
  if (koerer >= SAMTIDIGE) await new Promise(r => koe.push(r));
  koerer++;
}
function frigiv() { koerer--; const n = koe.shift(); if (n) n(); }
const vent = ms => new Promise(r => setTimeout(r, ms));

async function post(url, krop, hvem) {
  await plads();
  try {
    for (let forsoeg = 0; ; forsoeg++) {
      const r = await fetch(url, {
        method:'POST',
        headers:{ Authorization: 'Bearer ' + await adgang(), 'Content-Type':'application/json' },
        body: JSON.stringify(krop) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) return d;
      const besked = String((d.error||{}).message || r.status);
      if (forsoeg === 0 && (r.status === 429 || /concurrent|exhausted|rate limit/i.test(besked))) { await vent(800 + Math.random()*700); continue; }
      throw new Error(hvem + ': ' + besked);
    }
  } finally { frigiv(); }
}

/* ── Analytics ─────────────────────────────────────────────────────────── */
const ejendom = () => (process.env.GA4_PROPERTY_ID || '').replace(/\D/g, '');

/* Google sender kun en total, naar man beder om den. Uden den blev alle samlede tal 0. */
const medTotal = krop => krop.metricAggregations ? krop : { ...krop, metricAggregations: ['TOTAL'] };

async function rapport(krop) {
  const id = ejendom();
  if (!id) throw new Error('GA4_PROPERTY_ID mangler i Netlify');
  return post(`https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`,
              medTotal(krop), 'Google Analytics');
}
async function realtid(krop) {
  const id = ejendom();
  if (!id) throw new Error('GA4_PROPERTY_ID mangler i Netlify');
  return post(`https://analyticsdata.googleapis.com/v1beta/properties/${id}:runRealtimeReport`,
              medTotal(krop), 'Google Analytics, live');
}

/** Laver Googles svar om til almindelige rækker, så panelet slipper for formen. */
function raekker(svar) {
  const dim = (svar.dimensionHeaders || []).map(h => h.name);
  const maa = (svar.metricHeaders   || []).map(h => h.name);
  return (svar.rows || []).map(r => {
    const o = {};
    dim.forEach((n,i) => o[n] = ((r.dimensionValues||[])[i]||{}).value || '');
    maa.forEach((n,i) => o[n] = Number(((r.metricValues||[])[i]||{}).value || 0));
    return o;
  });
}
/** Som raekker(), men null for en rapport der fejlede, saa "ingen data" og "kunne ikke hentes" kan skilles ad. */
const raekkerEllerNull = svar => (!svar || svar.fejlet) ? null : raekker(svar);
/** Samlet tal for én maaling. null, hvis rapporten fejlede (aldrig et stille 0). */
function samlet(svar, navn) {
  if (!svar || svar.fejlet) return null;
  const maa = (svar.metricHeaders || []).map(h => h.name);
  const i = maa.indexOf(navn);
  if (i < 0) return 0;
  const vaerdi = x => Number((((x && x.metricValues) || [])[i] || {}).value || 0);
  // Google sender en tom total uden vaerdier, naar der ingen data er
  const t = (svar.totals || [])[0];
  if (t && t.metricValues) return vaerdi(t);
  // uden total: en rapport uden dimensioner har svaret i den ene raekke
  const r = svar.rows || [];
  if (r.length === 1) return vaerdi(r[0]);
  return r.reduce((a, x) => a + vaerdi(x), 0);
}

/* ── Search Console ────────────────────────────────────────────────────── */
// Hvilke ord folk faktisk søger på, før de klikker ind. Det er den del af
// Wix' panel, der havde mest værdi for SEO, og den har intet med Analytics
// at gøre, det er en helt anden tjeneste.
async function soegning(krop) {
  const side = process.env.GSC_SITE_URL || 'https://www.voreshjem.dk/';
  return post('https://searchconsole.googleapis.com/webmasters/v3/sites/' +
              encodeURIComponent(side) + '/searchAnalytics/query', krop, 'Search Console');
}

/** Koerer flere rapporter og lader de andre overleve, hvis én fejler.
    En fejlet rapport faar fejlet:true, saa samlet() giver null og ikke et falsk 0.
    svar.fejl er de korte tekster (som foer). svar.fejlListe er den faelles form
    { kilde, tekst, raa } fra KONTRAKT.md, én pr. forskellig fejl. */
async function alle(kald, kilde) {
  const r = await Promise.allSettled(kald);
  const fejl = [], fejlListe = [], set = new Set();
  const k = kilde || 'ga4', navn = k === 'gsc' ? 'Search Console' : 'Google Analytics';
  const svar = r.map(x => {
    if (x.status === 'fulfilled') return x.value;
    const raa = String((x.reason||{}).message || x.reason).slice(0, 300);
    fejl.push(raa.slice(0, 160));
    if (!set.has(raa)) { set.add(raa); fejlListe.push({ kilde: k, tekst: navn + ' svarede ikke: ' + raa.replace(/^Google Analytics(, live)?: /, '').slice(0, 160), raa }); }
    return { rows: [], totals: [], dimensionHeaders: [], metricHeaders: [], fejlet: true, fejlTekst: raa };
  });
  svar.fejl = fejl;
  svar.fejlListe = fejlListe;
  return svar;
}

/** Sidehastighed fra Googles PageSpeed. Ingen noegle noedvendig ved lav brug. */
/* Google maaler fra én tilfaeldig server, og tallet svinger 20 til 40 point fra gang til gang.
   Derfor koeres tre maalinger. Svaret er den midterste af de vellykkede. Lykkes kun to, er det
   den laveste af dem (den hoejeste ville smigre), og lykkes kun én, er det den. valg og valgTekst
   siger hvilken, og maalinger har alle de vellykkede. En koersel uden score er en fejl, aldrig 0.
   Tre kald pr. enhed pr. doegn er langt under kvoten. */
async function hastighed(url, strategi) {
  const r = await Promise.allSettled([hastighedEn(url, strategi), hastighedEn(url, strategi), hastighedEn(url, strategi)]);
  const ok = r.filter(x => x.status === 'fulfilled').map(x => x.value);
  if (!ok.length) throw r[0].reason;
  ok.sort((a, b) => a.score - b.score);
  // ved et lige antal den laveste af de to midterste
  const valgt = ok[Math.floor((ok.length - 1) / 2)];
  const fejlede = r.length - ok.length;
  const valg = ok.length === 1 ? 'eneste' : ok.length % 2 ? 'midterste' : 'laveste';
  const valgTekst = ok.length === 1 ? 'Kun én af ' + r.length + ' kørsler gav et tal'
    : ok.length % 2 ? 'Midterværdien af ' + ok.length + ' kørsler'
    : 'Den laveste af ' + ok.length + ' kørsler' + (fejlede ? ', ' + fejlede + ' fejlede' : '');
  return { ...valgt, maalinger: ok.map(x => x.score), koersler: r.length, fejlede, valg, valgTekst,
    spredning: ok.length > 1 ? ok[ok.length-1].score - ok[0].score : 0 };
}
async function hastighedEn(url, strategi) {
  const u = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  u.searchParams.set('url', url); u.searchParams.set('strategy', strategi || 'mobile');
  u.searchParams.append('category', 'performance');
  if (process.env.PSI_API_KEY) u.searchParams.set('key', process.env.PSI_API_KEY);
  // en funktion maa hoejst koere ca. 26 sekunder, saa en maaling der haenger opgives efter 22
  let r;
  try { r = await fetch(u, { signal: AbortSignal.timeout(22000) }); }
  catch (e) { throw new Error('PageSpeed: ' + (e.name === 'TimeoutError' || e.name === 'AbortError' ? 'Google svarede ikke inden 22 sekunder' : (e.message || e))); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('PageSpeed: ' + ((d.error||{}).message || r.status));
  const L = d.lighthouseResult || {}, a = L.audits || {};
  // en koersel, hvor Lighthouse ikke kunne maale (runtimeError), har ingen score. Den er en fejl, ikke 0.
  const s = ((L.categories || {}).performance || {}).score;
  if (s == null || !isFinite(s)) throw new Error('PageSpeed gav ingen score' + (L.runtimeError && L.runtimeError.message ? ': ' + L.runtimeError.message : ''));
  const ms = k => a[k] && a[k].numericValue != null ? Math.round(a[k].numericValue) : null;
  const cls = a['cumulative-layout-shift'] && a['cumulative-layout-shift'].numericValue != null ? Number(a['cumulative-layout-shift'].numericValue.toFixed(3)) : null;
  return { score: Math.round(s * 100),
    lcp: ms('largest-contentful-paint'), cls,
    tbt: ms('total-blocking-time'), fcp: ms('first-contentful-paint'), ttfb: ms('server-response-time'),
    vaegt: a['total-byte-weight'] ? Math.round(a['total-byte-weight'].numericValue/1024) : null,
    strategi: strategi || 'mobile', maalt: new Date().toISOString() };
}

const opsat    = () => !!(konto() && ejendom());
const opsatGsc = () => !!konto();

module.exports = { rapport, realtid, raekker, raekkerEllerNull, samlet, soegning, alle, hastighed, opsat, opsatGsc };
