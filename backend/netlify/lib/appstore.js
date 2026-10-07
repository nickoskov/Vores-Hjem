'use strict';
/**
 * Downloads fra App Store Connect. Kraever en API-noegle fra Apple:
 *   ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY (hele .p8-filen), ASC_VENDOR_NUMBER
 * Apples rapporter er et doegn bagud og kommer som gzip-pakket tekst.
 * En dag, der ikke kunne hentes, eller hvis rapport ikke er klar, har downloads: null,
 * aldrig 0. Kun "ingen salg den dag" er et rigtigt 0.
 */
const crypto = require('crypto');
const zlib = require('zlib');
const E = process.env;
const opsat = () => !!(E.ASC_ISSUER_ID && E.ASC_KEY_ID && E.ASC_PRIVATE_KEY && E.ASC_VENDOR_NUMBER);
const b64 = o => Buffer.from(typeof o==='string'?o:JSON.stringify(o)).toString('base64')
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

function jwt() {
  const nu = Math.floor(Date.now()/1000);
  const krop = b64({alg:'ES256', kid:E.ASC_KEY_ID, typ:'JWT'}) + '.' +
               b64({iss:E.ASC_ISSUER_ID, iat:nu, exp:nu+1100, aud:'appstoreconnect-v1'});
  const noegle = E.ASC_PRIVATE_KEY.includes('BEGIN') ? E.ASC_PRIVATE_KEY : Buffer.from(E.ASC_PRIVATE_KEY,'base64').toString();
  const s = crypto.createSign('SHA256'); s.update(krop); s.end();
  const der = s.sign({ key: noegle, dsaEncoding: 'ieee-p1363' });
  return krop + '.' + der.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

/** Én dags salgsrapport. Returnerer { dato, downloads, opdateringer, koeb } */
async function dag(dato) {
  const u = new URL('https://api.appstoreconnect.apple.com/v1/salesReports');
  u.searchParams.set('filter[frequency]', 'DAILY');
  u.searchParams.set('filter[reportType]', 'SALES');
  u.searchParams.set('filter[reportSubType]', 'SUMMARY');
  u.searchParams.set('filter[vendorNumber]', E.ASC_VENDOR_NUMBER);
  u.searchParams.set('filter[reportDate]', dato);
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + jwt(), Accept: 'application/a-gzip' } });
  if (r.status === 404) {
    // Apple svarer 404 baade naar der intet salg var (et rigtigt 0), og naar rapporten
    // ikke er klar endnu (typisk i gaar foer om eftermiddagen). Det sidste er ukendt.
    const t = await r.text().catch(() => '');
    if (/no sales/i.test(t)) return { dato, downloads: 0, opdateringer: 0, koeb: 0, tom: true };
    return { dato, downloads: null, opdateringer: null, koeb: null, ikkeKlar: true,
      note: /not available/i.test(t) ? 'Apple har ikke rapporten klar endnu' : 'Apple svarede 404: ' + t.slice(0, 120) };
  }
  if (!r.ok) { const t = await r.text(); throw new Error('App Store: ' + r.status + ' ' + t.slice(0,120)); }
  const tekst = zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8');
  const linjer = tekst.trim().split('\n').map(l => l.split('\t'));
  const h = linjer[0]; const ci = n => h.indexOf(n);
  const iU = ci('Units'), iT = ci('Product Type Identifier');
  let downloads = 0, opdateringer = 0, koeb = 0;
  linjer.slice(1).forEach(l => {
    const u = Number(l[iU])||0, t = l[iT] || '';
    // 1 og 1F er foerste download (iPhone, universal), 7 og 7F er opdatering, IA er koeb i app
    if (/^(1|1F|1T|1E|F1)$/.test(t)) downloads += u;
    else if (/^(7|7F|7T|F7)$/.test(t)) opdateringer += u;
    else if (/^IA/.test(t)) koeb += u;
  });
  return { dato, downloads, opdateringer, koeb };
}

// kalenderdage regnet paa datoen 'YYYY-MM-DD', uafhaengigt af serverens tidszone
function dagPlus(dato, n) { const [y, m, d] = dato.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }

async function periode(fra, til) {
  if (!opsat()) throw new Error('App Store Connect-variablerne mangler i Netlify');
  const ud = [];
  for (let d = fra; d <= til && ud.length < 400; d = dagPlus(d, 1)) {
    // en dag, der fejler, er ukendt og ikke 0
    try { ud.push(await dag(d)); } catch (e) { ud.push({ dato: d, downloads: null, fejl: e.message }); }
  }
  return ud;
}
module.exports = { periode, opsat };
