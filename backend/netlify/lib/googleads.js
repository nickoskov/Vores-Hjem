'use strict';
/**
 * Annonceforbrug fra Google Ads. Googles API kraever fem ting:
 *   GADS_DEVELOPER_TOKEN, GADS_CLIENT_ID, GADS_CLIENT_SECRET, GADS_REFRESH_TOKEN, GADS_CUSTOMER_ID
 * Alle saettes i Netlify. Vejledningen staar i OPSAETNING.md.
 * GADS_API_VERSION kan saettes, naar Google lukker for versionen herunder (Google lukker
 * en version cirka et aar efter, den kom).
 *
 * Lige nu er Google Ads IKKE koblet paa (Google-annoncerne koerer gennem Wix). Saa laenge
 * er forbruget fra Google ukendt, ikke 0 kr.: forbrug() kaster en fejl med e.ikkeKoblet = true,
 * og status() siger det til panelet. Fejler Google, kastes ogsaa en fejl, aldrig en tom liste.
 * Fejlens form: e.message = 'Google Ads: <kort>' (saa admin.js fejlObj kender kilden),
 * e.tekst = 'Google Ads svarede ikke: <kort>', e.kilde = 'googleads', e.raa = Googles raa besked.
 */
const E = process.env;
const VERSION = E.GADS_API_VERSION || 'v18';
const opsat = () => !!(E.GADS_DEVELOPER_TOKEN && E.GADS_CLIENT_ID && E.GADS_CLIENT_SECRET &&
                       E.GADS_REFRESH_TOKEN && E.GADS_CUSTOMER_ID);

/** Om Google Ads er koblet paa, til visning under "Brugt paa annoncer". */
const status = () => opsat()
  ? { kilde: 'googleads', navn: 'Google Ads', koblet: true, tekst: 'Google Ads er koblet på.' }
  : { kilde: 'googleads', navn: 'Google Ads', koblet: false, tekst: 'Google Ads er ikke koblet på, så Google-annoncernes forbrug er ikke med i tallet.' };

const gyldigDato = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const UKENDT = ' Forbruget fra Google-annoncer er derfor ukendt, ikke 0 kr.';
/** kort: det der staar efter 'Google Ads: ' */
function fejl(kort, raa, ekstra) {
  const e = new Error('Google Ads: ' + kort);
  e.kilde = 'googleads'; e.raa = raa || ''; e.tekst = 'Google Ads svarede ikke: ' + kort;
  Object.assign(e, ekstra || {});
  return e;
}

/** Henter og laeser JSON med tidsgraense. Kaster en dansk fejl, hvis Google ikke kan naas. */
async function hentJson(url, valg, hvad) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
  let r, krop;
  try { r = await fetch(url, { ...valg, signal: c.signal }); krop = await r.text(); }
  catch (e) {
    const raa = String((e && e.message) || e).slice(0, 200);
    throw fejl((c.signal.aborted ? hvad + ' gav intet svar inden for 20 sekunder.' : hvad + ' kunne ikke nås (' + raa + ').') + UKENDT, raa);
  } finally { clearTimeout(t); }
  let d = null; try { d = JSON.parse(krop); } catch (e) {}
  return { r, d, krop: krop || '' };
}

let token = null;
async function adgang() {
  if (token && token.udloeber > Date.now() + 60000) return token.vaerdi;
  const { r, d } = await hentJson('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: E.GADS_CLIENT_ID, client_secret: E.GADS_CLIENT_SECRET,
      refresh_token: E.GADS_REFRESH_TOKEN, grant_type: 'refresh_token' }) }, 'Googles login');
  if (!r.ok || !d || !d.access_token) {
    const raa = String((d && (d.error_description || d.error)) || ('HTTP ' + r.status)).slice(0, 200);
    throw fejl('login fejlede, "' + raa + '".' + UKENDT, raa, { http: r.status });
  }
  token = { vaerdi: d.access_token, udloeber: Date.now() + (d.expires_in || 3600) * 1000 };
  return token.vaerdi;
}

/**
 * Forbrug pr. kampagne fra fra til til (datoer 'YYYY-MM-DD', begge med).
 * Raekker: { kampagne, kampagneId, forbrug, visninger, klik, klikAlle, linkKlik:null,
 *            konverteringer, installs:null, kilde:'googleads' }.
 * installs er null: Google Ads' "konverteringer" er det, kontoen selv har sat op, ikke installationer.
 */
async function forbrug(fra, til) {
  if (!opsat()) throw fejl('ikke koblet på (GADS-variablerne mangler i Netlify).' + UKENDT, '', { ikkeKoblet: true, tekst: 'Google Ads er ikke koblet på.' + UKENDT });
  if (!gyldigDato(fra) || !gyldigDato(til) || fra > til) throw fejl('ugyldig periode ' + fra + ' til ' + til + '.', '');
  const kunde = E.GADS_CUSTOMER_ID.replace(/\D/g, '');
  const q = `SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
             FROM campaign WHERE segments.date BETWEEN '${fra}' AND '${til}' AND campaign.status != 'REMOVED'`;
  const { r, d, krop } = await hentJson(`https://googleads.googleapis.com/${VERSION}/customers/${kunde}/googleAds:searchStream`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + await adgang(), 'developer-token': E.GADS_DEVELOPER_TOKEN,
               'Content-Type': 'application/json',
               ...(E.GADS_LOGIN_CUSTOMER_ID ? { 'login-customer-id': E.GADS_LOGIN_CUSTOMER_ID.replace(/\D/g, '') } : {}) },
    body: JSON.stringify({ query: q }) }, 'Google Ads');
  // searchStream svarer med en liste af blokke. En fejl kan staa i svaret selv eller i en af blokkene.
  const blokke = Array.isArray(d) ? d : (d ? [d] : []);
  const fejlBlok = blokke.find(b => b && b.error);
  if (!r.ok || !d || fejlBlok) {
    const raa = String(((fejlBlok || {}).error || {}).message || ('HTTP ' + r.status + (krop ? ', ' + krop.replace(/<[^>]+>/g, ' ').slice(0, 120) : ''))).replace(/\s+/g, ' ').trim().slice(0, 300);
    const lukket = r.status === 404 || /sunset|deprecated|UNIMPLEMENTED|not found/i.test(raa);
    throw fejl('"' + raa + '".' + UKENDT +
      (lukket ? ' Måske har Google lukket for API-version ' + VERSION + '. Sæt GADS_API_VERSION i Netlify til en nyere version.' : ''),
      raa, { http: r.status });
  }
  const sum = {};
  blokke.forEach(b => (b.results || []).forEach(x => {
    const id = String((x.campaign || {}).id || (x.campaign || {}).name || '');
    sum[id] = sum[id] || { kampagne: (x.campaign || {}).name || '', kampagneId: (x.campaign || {}).id != null ? String(x.campaign.id) : null,
      forbrug: 0, visninger: 0, klik: 0, klikAlle: 0, linkKlik: null, konverteringer: 0, installs: null, kilde: 'googleads' };
    const m = x.metrics || {};
    sum[id].forbrug        += Number(m.costMicros || 0) / 1e6;
    sum[id].visninger      += Number(m.impressions || 0);
    sum[id].klik           += Number(m.clicks || 0);
    sum[id].klikAlle       += Number(m.clicks || 0);
    sum[id].konverteringer += Number(m.conversions || 0);
  }));
  return Object.values(sum);
}
module.exports = { forbrug, opsat, status };
