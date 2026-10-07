'use strict';
/**
 * Planlagte funktioner skal kun goere deres arbejde én gang pr. periode.
 *
 * Netlify starter af og til den samme planlagte funktion to-tre gange samme
 * morgen: tager en koersel over 30 sekunder, proever Netlify igen, mens den
 * foerste stadig koerer. Det gav dobbelte mails, dobbelte hastighedsmaalinger
 * (og dermed falske alarmer) og dobbelte SEO-punkter.
 *
 * Her tager den foerste koersel en laas i databasen (job + noegle, fx
 * 'dagvagt' + '2026-10-06'). INSERT ... ON CONFLICT DO NOTHING er atomisk, saa
 * kun én koersel kan faa laasen, ogsaa naar to koerer samtidig.
 *
 * Desuden de danske kalenderhjaelpere, som jobbene deler. Serveren koerer i
 * UTC, men alt, hvad Nicko ser, er dansk tid.
 */
const { sql } = require('./db.js');
const TZ = 'Europe/Copenhagen';

let klar = false;
async function tabel() {
  if (klar || !sql) return;
  await sql`CREATE TABLE IF NOT EXISTS vh_koersel (
    job TEXT NOT NULL, noegle TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (job, noegle))`;
  klar = true;
}

/** true kun for den foerste koersel med denne noegle. Uden database (eller hvis den
    fejler) svares true: hellere en mail for meget end en alarm, der aldrig kommer. */
async function foersteGang(job, noegle) {
  if (!sql) return true;
  try {
    await tabel();
    const r = await sql`INSERT INTO vh_koersel (job, noegle) VALUES (${String(job)}, ${String(noegle)})
      ON CONFLICT (job, noegle) DO NOTHING RETURNING job`;
    return r.length > 0;
  } catch (e) { return true; }
}

/** Giver laasen fri igen, fx naar arbejdet fejlede, saa en senere koersel kan proeve igen. */
async function frigiv(job, noegle) {
  if (!sql) return;
  try { await tabel(); await sql`DELETE FROM vh_koersel WHERE job = ${String(job)} AND noegle = ${String(noegle)}`; } catch (e) {}
}

/* ── danske kalenderdatoer ───────────────────────────────────────────── */
const FMT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Dansk dato og klokkeslaet for et tidspunkt (standard: nu). */
function dansk(t) {
  const p = {};
  FMT.formatToParts(t || new Date()).forEach(x => { p[x.type] = x.value; });
  const dato = p.year + '-' + p.month + '-' + p.day;
  const time = p.hour === '24' ? '00' : p.hour;
  return { dato, time, minut: time + ':' + p.minute, uge: isoUge(dato), ugedag: ugedag(dato) };
}

/** Kalenderregning paa 'YYYY-MM-DD', uden klokkeslaet, saa sommertid ikke kan flytte noget. */
function plusDage(dato, n) {
  const d = new Date(dato + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 1 = mandag ... 7 = soendag */
function ugedag(dato) { return ((new Date(dato + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1; }

/** ISO-uge som '2026-W41'. Ugen tilhoerer det aar, dens torsdag ligger i. */
function isoUge(dato) {
  const tor = plusDage(dato, 4 - ugedag(dato));
  const aar = Number(tor.slice(0, 4));
  const nr = Math.floor((Date.parse(tor + 'T00:00:00Z') - Date.UTC(aar, 0, 1)) / 86400000 / 7) + 1;
  return aar + '-W' + String(nr).padStart(2, '0');
}

const MDR = ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'];
/** '2026-09-28' -> '28. sep.' */
function kortDato(dato) {
  if (!dato) return '';
  const [, m, d] = String(dato).slice(0, 10).split('-');
  return Number(d) + '. ' + MDR[Number(m) - 1];
}

module.exports = { foersteGang, frigiv, dansk, plusDage, ugedag, isoUge, kortDato, TZ };
