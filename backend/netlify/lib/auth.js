'use strict';
/**
 * Login med flere brugere og roller.
 *   ejer      alt, ogsaa brugere og opsaetning. ADMIN_PASSWORD er altid ejer.
 *   redigerer kan skrive: blog, indhold, noter, links
 *   laeser    kan kun kigge
 */
const crypto = require('crypto');
const totp = require('./totp.js');
const { sql, opret } = require('./db.js');
const KODE = process.env.ADMIN_PASSWORD || '';
const SALT = process.env.SESSION_SECRET || KODE;

const lige = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function hashKode(kode) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(kode), salt, 32).toString('hex');
}
function kodePasser(kode, hash) {
  const [salt, h] = String(hash || '').split(':');
  if (!salt || !h) return false;
  return lige(crypto.scryptSync(String(kode), salt, 32).toString('hex'), h);
}

/** Underskrevet seddel: udloeb.navn.rolle.tegn. Holder et doegn, eller 30 dage med "husk mig". */
function seddel(navn, rolle, husk) {
  const til = Date.now() + (husk ? 30 : 1)*24*3600*1000;
  const krop = [til, encodeURIComponent(navn), rolle].join('.');
  return krop + '.' + crypto.createHmac('sha256', SALT).update(krop).digest('hex');
}
function laes(s) {
  if (!s || !KODE) return null;
  const d = String(s).split('.');
  if (d.length !== 4) return null;
  const [til, navn, rolle, tegn] = d;
  if (Number(til) < Date.now()) return null;
  const vent = crypto.createHmac('sha256', SALT).update([til, navn, rolle].join('.')).digest('hex');
  if (!lige(tegn, vent)) return null;
  return { navn: decodeURIComponent(navn), rolle };
}

/* For mange forkerte forsoeg fra samme adresse laaser i et kvarter. Uden det
   kan en maskine gaette tusindvis af koder i timen. */
async function forMange(ip) {
  if (!sql) return false;
  await opret();
  await sql`CREATE TABLE IF NOT EXISTS vh_login (id SERIAL PRIMARY KEY, ip TEXT NOT NULL,
    ok BOOLEAN NOT NULL, hvornaar TIMESTAMPTZ NOT NULL DEFAULT now())`;
  const r = await sql`SELECT count(*)::int AS n FROM vh_login
    WHERE ip = ${ip} AND NOT ok AND hvornaar > now() - interval '15 minutes'`;
  return r[0].n >= 6;
}
async function notaLogin(ip, ok) {
  if (!sql) return;
  try { await sql`INSERT INTO vh_login (ip, ok) VALUES (${ip}, ${ok})`;
        await sql`DELETE FROM vh_login WHERE hvornaar < now() - interval '1 day'`; } catch (e) {}
}

async function logInd(navn, kode, ip) {
  if (!KODE) throw new Error('ADMIN_PASSWORD er ikke sat i Netlify');
  if (await forMange(ip || '')) throw new Error('For mange forkerte forsøg. Vent et kvarter.');
  // ejeren: intet navn, eller "ejer", med hovedkoden
  if ((!navn || navn.toLowerCase() === 'ejer') && kode) {
    const a = crypto.createHash('sha256').update(String(kode)).digest();
    const b = crypto.createHash('sha256').update(KODE).digest();
    if (crypto.timingSafeEqual(a, b)) { await notaLogin(ip||'', true); return { navn: 'Ejer', rolle: 'ejer' }; }
  }
  if (navn && sql) {
    await opret();
    const r = await sql`SELECT navn, hash, rolle FROM vh_brugere WHERE lower(navn) = ${navn.toLowerCase()}`;
    if (r[0] && kodePasser(kode, r[0].hash)) {
      await sql`UPDATE vh_brugere SET sidst = now() WHERE navn = ${r[0].navn}`;
      await notaLogin(ip||'', true);
      return { navn: r[0].navn, rolle: r[0].rolle };
    }
  }
  await notaLogin(ip||'', false);
  return null;
}

/* Sedlen siger hvem man er, men databasen afgoer hvad man maa. Fjernes en
   bruger, eller saettes hans rolle ned, gaelder det med det samme. Ejeren
   med hovedkoden staar ikke i databasen og slipper for opslaget. */
async function bekraeft(bruger) {
  if (!bruger) return null;
  if (bruger.navn === 'Ejer') return bruger;
  if (!sql) return bruger;
  await opret();
  const r = await sql`SELECT navn, rolle FROM vh_brugere WHERE navn = ${bruger.navn}`;
  return r[0] ? { navn: r[0].navn, rolle: r[0].rolle } : null;
}

const RANG = { laeser: 1, redigerer: 2, ejer: 3 };
const maa = (bruger, rolle) => !!bruger && (RANG[bruger.rolle] || 0) >= (RANG[rolle] || 99);

async function brugere() {
  await opret();
  return await sql`SELECT id, navn, rolle, sidst, oprettet FROM vh_brugere ORDER BY navn`;
}
async function gemBruger(p) {
  await opret();
  const rolle = ['laeser','redigerer','ejer'].includes(p.rolle) ? p.rolle : 'laeser';
  if (!p.navn || !/^[\wæøåÆØÅ .-]{2,40}$/.test(p.navn)) throw new Error('Navnet skal være 2 til 40 tegn');
  if (p.navn.toLowerCase() === 'ejer') throw new Error('"Ejer" er reserveret til hovedkoden');
  if (p.id) {
    if (p.kode) {
      if (String(p.kode).length < 8) throw new Error('Adgangskoden skal være mindst 8 tegn');
      await sql`UPDATE vh_brugere SET navn=${p.navn}, rolle=${rolle}, hash=${hashKode(p.kode)} WHERE id=${Number(p.id)}`;
    } else await sql`UPDATE vh_brugere SET navn=${p.navn}, rolle=${rolle} WHERE id=${Number(p.id)}`;
    return { id: Number(p.id) };
  }
  if (!p.kode || String(p.kode).length < 8) throw new Error('Adgangskoden skal være mindst 8 tegn');
  const r = await sql`INSERT INTO vh_brugere (navn, hash, rolle) VALUES (${p.navn}, ${hashKode(p.kode)}, ${rolle})
    ON CONFLICT (navn) DO UPDATE SET hash = EXCLUDED.hash, rolle = EXCLUDED.rolle RETURNING id`;
  return { id: r[0].id };
}
/* Brugeren skifter selv sin kode. Den gamle skal passe. */
async function skiftKode(navn, gammel, ny) {
  if (!sql) throw new Error('Databasen er ikke sat op');
  if (navn === 'Ejer') throw new Error('Hovedkoden skiftes i Netlify under ADMIN_PASSWORD');
  if (!ny || String(ny).length < 8) throw new Error('Den nye adgangskode skal være mindst 8 tegn');
  await opret();
  const r = await sql`SELECT hash FROM vh_brugere WHERE navn = ${navn}`;
  if (!r[0] || !kodePasser(gammel, r[0].hash)) throw new Error('Din nuværende adgangskode passer ikke');
  await sql`UPDATE vh_brugere SET hash = ${hashKode(ny)} WHERE navn = ${navn}`;
}
async function sletBruger(id) { await opret(); await sql`DELETE FROM vh_brugere WHERE id = ${Number(id)}`; }

/* ── to-trins ── */
async function totpFor(navn) { if (!sql) return ''; await opret(); const r = await sql`SELECT hemmelighed FROM vh_totp WHERE navn = ${navn}`; return r[0] ? r[0].hemmelighed : ''; }
async function totpSaet(navn, hemmelighed) { await opret(); if (!hemmelighed) await sql`DELETE FROM vh_totp WHERE navn = ${navn}`;
  else await sql`INSERT INTO vh_totp (navn, hemmelighed) VALUES (${navn}, ${hemmelighed}) ON CONFLICT (navn) DO UPDATE SET hemmelighed = EXCLUDED.hemmelighed`; }
/* midlertidig seddel efter foerste trin: holder fem minutter og giver ingen adgang */
function halvSeddel(navn, rolle) { const til = Date.now() + 5*60*1000; const krop = ['halv', til, encodeURIComponent(navn), rolle].join('.'); return krop + '.' + crypto.createHmac('sha256', SALT).update(krop).digest('hex'); }
function laesHalv(s) { const d = String(s||'').split('.'); if (d.length !== 5 || d[0] !== 'halv' || Number(d[1]) < Date.now()) return null;
  const vent = crypto.createHmac('sha256', SALT).update(d.slice(0,4).join('.')).digest('hex'); return lige(d[4], vent) ? { navn: decodeURIComponent(d[2]), rolle: d[3] } : null; }
module.exports = { seddel, laes, logInd, bekraeft, maa, brugere, gemBruger, sletBruger, skiftKode, harKode: () => !!KODE, totpFor, totpSaet, halvSeddel, laesHalv, totp };
