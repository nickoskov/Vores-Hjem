'use strict';
/**
 * Installationer fra Google Play. Play laegger sine rapporter i en Cloud Storage-spand,
 * som den samme servicekonto (GA4_CREDENTIALS) kan laese, hvis den er givet adgang i
 * Play Console. Kraever GPLAY_BUCKET (pubsite_prod_...). Appens pakkenavn er GPLAY_PACKAGE, eller
 * profilens (side.js, playPakke), saa hver backend kun laeser sin egen apps fil.
 *
 * Play skriver én raekke pr. dag, ogsaa dage med 0. En dag uden raekke er derfor
 * ukendt, ikke 0. hent() fortaeller ogsaa, hvilke maanedsfiler der blev laest, og
 * hvilken dato den nyeste raekke har, saa man kan se, hvornaar tallene stoppede.
 */
const crypto = require('crypto');
const profil = require('./side.js');
const E = process.env;
const pakke = () => String(E.GPLAY_PACKAGE || profil.playPakke).trim();
const opsat = () => !!(E.GA4_CREDENTIALS && E.GPLAY_BUCKET && pakke());
let token = null;

function konto() {
  const raa = E.GA4_CREDENTIALS || '';
  const t = raa.trim().startsWith('{') ? raa : Buffer.from(raa, 'base64').toString('utf8');
  return JSON.parse(t);
}
const b64 = o => Buffer.from(typeof o==='string'?o:JSON.stringify(o)).toString('base64')
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function adgang() {
  if (token && token.udloeber > Date.now() + 60000) return token.vaerdi;
  const k = konto(); const nu = Math.floor(Date.now()/1000);
  const krop = b64({alg:'RS256',typ:'JWT'}) + '.' + b64({ iss:k.client_email,
    scope:'https://www.googleapis.com/auth/devstorage.read_only',
    aud:'https://oauth2.googleapis.com/token', iat:nu, exp:nu+3600 });
  const s = crypto.createSign('RSA-SHA256'); s.update(krop); s.end();
  const jwt = krop + '.' + s.sign(k.private_key,'base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const r = await fetch('https://oauth2.googleapis.com/token', { method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion:jwt}) });
  const d = await r.json();
  if (!r.ok) throw new Error('Google Play login: ' + (d.error_description||d.error||r.status));
  token = { vaerdi:d.access_token, udloeber: Date.now() + (d.expires_in||3600)*1000 };
  return token.vaerdi;
}

const MD = ['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
const mdTekst = aarMd => MD[Number(aarMd.slice(4, 6)) - 1] + ' ' + aarMd.slice(0, 4);

/** Én maanedsfil. Findes den ikke (404), siges det, i stedet for at give en tom liste. */
async function maaned(aarMd) {
  const obj = `stats/installs/installs_${pakke()}_${aarMd}_overview.csv`;
  const u = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(E.GPLAY_BUCKET)}/o/${encodeURIComponent(obj)}?alt=media`;
  const r = await fetch(u, { headers:{ Authorization:'Bearer ' + await adgang() } });
  const fil = { maaned: aarMd.slice(0, 4) + '-' + aarMd.slice(4, 6), status: r.status, raekker: 0, foerste: null, sidste: null, note: '' };
  if (r.status === 404) { fil.note = 'Filen for ' + mdTekst(aarMd) + ' findes ikke i Google Plays spand.'; return { fil, raekker: [] }; }
  if (!r.ok) throw new Error('Google Play: ' + r.status + ' for filen ' + fil.maaned);
  // filen er UTF-16 med BOM
  const buf = Buffer.from(await r.arrayBuffer());
  const tekst = (buf[0] === 0xFF && buf[1] === 0xFE) ? buf.slice(2).toString('utf16le') : buf.toString('utf8');
  const linjer = tekst.trim().split(/\r?\n/).map(l => l.split(',').map(x => x.trim().replace(/^"|"$/g, '')));
  const h = linjer[0];
  const iD = h.indexOf('Date'), iI = h.findIndex(x => /Daily Device Installs/i.test(x)),
        iU = h.findIndex(x => /Daily Device Uninstalls/i.test(x));
  if (iD < 0 || iI < 0) throw new Error('Google Play: filen for ' + fil.maaned + ' har ikke de forventede kolonner (' + h.slice(0, 6).join(', ') + ')');
  const raekker = linjer.slice(1).filter(l => /^\d{4}-\d{2}-\d{2}$/.test(l[iD] || ''))
    .map(l => ({ dato: l[iD], downloads: Number(l[iI])||0, afinstalleret: iU < 0 ? null : (Number(l[iU])||0) }))
    .sort((a, b) => a.dato < b.dato ? -1 : 1);
  fil.raekker = raekker.length;
  if (raekker.length) { fil.foerste = raekker[0].dato; fil.sidste = raekker[raekker.length - 1].dato; }
  else fil.note = 'Filen for ' + mdTekst(aarMd) + ' findes, men har ingen dage.';
  return { fil, raekker };
}

// maanederne 'YYYYMM' fra og med fra-datoens maaned til og med til-datoens, regnet paa tekst, ikke paa tidszoner
function maaneder(fra, til) {
  const u = []; let y = Number(fra.slice(0, 4)), m = Number(fra.slice(5, 7));
  const ty = Number(til.slice(0, 4)), tm = Number(til.slice(5, 7));
  while ((y < ty || (y === ty && m <= tm)) && u.length < 40) { u.push(y + String(m).padStart(2, '0')); m++; if (m > 12) { m = 1; y++; } }
  return u;
}
const forrige = aarMd => { let y = Number(aarMd.slice(0, 4)), m = Number(aarMd.slice(4, 6)) - 1; if (m < 1) { m = 12; y--; } return y + String(m).padStart(2, '0'); };

/**
 * Raekkerne fra og med fra til og med til ('YYYY-MM-DD'), plus hvad der blev laest:
 *   { raekker, filer:[{ maaned, status, raekker, foerste, sidste, note, ekstra? }], sidsteDato }
 * sidsteDato er den nyeste dag med en raekke i de laeste filer. Har perioden ingen
 * raekker, kigges op til to maaneder tilbage, saa man kan se, hvor tallene slutter.
 */
async function hent(fra, til) {
  if (!opsat()) throw new Error('GPLAY_BUCKET mangler i Netlify');
  // peger GPLAY_PACKAGE paa den anden sides app, ville tallene blive blandet. Saa hellere ingen tal.
  if (pakke() === profil.anden.playPakke) throw new Error('Google Play: GPLAY_PACKAGE peger på appen til ' + profil.anden.navn + ' (' + pakke() + '). Ret den, eller fjern den.');
  const mdr = maaneder(fra, til);
  const svar = await Promise.all(mdr.map(maaned));
  const filer = svar.map(x => x.fil), alle = [];
  svar.forEach(x => alle.push(...x.raekker));
  let sidsteDato = filer.reduce((m, f) => f.sidste && (!m || f.sidste > m) ? f.sidste : m, null);
  if (!sidsteDato) {
    let m = mdr[0];
    for (let i = 0; i < 2 && !sidsteDato; i++) {
      m = forrige(m);
      const x = await maaned(m);
      filer.unshift({ ...x.fil, ekstra: true });
      if (x.fil.sidste) sidsteDato = x.fil.sidste;
    }
  }
  return { raekker: alle.filter(r => r.dato >= fra && r.dato <= til), filer, sidsteDato };
}

/** Som foer: kun raekkerne i perioden. */
async function periode(fra, til) { return (await hent(fra, til)).raekker; }
module.exports = { periode, hent, opsat };
