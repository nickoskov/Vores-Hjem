'use strict';
/**
 * Modtager kontaktformularen fra siden (voreshjem.dk/support, eller unserzuhauseapp.de paa den
 * tyske backend, se lib/side.js). Erstatter det gamle
 * Make.com-webhook, hvis adresse stod åbent i sidens kildekode og derfor
 * kunne rammes direkte udenom formularen. Her er tre lag imod spam:
 *   1. Edderkoppefelt: et felt ægte besøgende aldrig udfylder, kun bots gør.
 *   2. Tidsfælde: udfyldt hurtigere end et menneske kan nå, er ikke et menneske.
 *   3. Loft pr. IP: for mange forsøg fra samme sted, uanset hvilken email der bruges.
 * Rammes et loft, svares der pænt, uden at afsløre at der er et loft, saa
 * en, der bare skifter email-adresse, ikke laerer noget af svaret.
 */
const { sql } = require('../lib/db.js');
const mail = require('../lib/mail.js');
const profil = require('../lib/side.js');
const sager = require('../lib/sager.js');

// kun profilens egen side. Den anden side sender til sin egen backend.
const TILLADT = profil.tilladt;
const vaert = u => { try { return new URL(u).hostname.replace(/^www\./,'').toLowerCase(); } catch (e) { return ''; } };

const svar = (kode, oprindelse, krop) => ({ statusCode: kode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': oprindelse || '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type' },
  body: JSON.stringify(krop || {}) });

async function klarTabel() {
  await sql`CREATE TABLE IF NOT EXISTS vh_kontakt (id SERIAL PRIMARY KEY, ip TEXT NOT NULL DEFAULT '',
    navn TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', emne TEXT NOT NULL DEFAULT '',
    besked TEXT NOT NULL DEFAULT '', afvist TEXT NOT NULL DEFAULT '', ts TIMESTAMPTZ NOT NULL DEFAULT now())`;
}

function ip(ev) {
  const h = ev.headers || {};
  return (h['x-nf-client-connection-ip'] || (h['x-forwarded-for']||'').split(',')[0] || '').trim();
}

const gyldigEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s||''));
const rens = (s, maks) => String(s||'').trim().slice(0, maks);
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

exports.handler = async (ev) => {
  const oprindelse = (ev.headers || {}).origin || '';
  if (ev.httpMethod === 'OPTIONS') return svar(204, oprindelse);
  if (ev.httpMethod !== 'POST') return svar(405, oprindelse, { fejl: 'brug POST' });
  // kun rigtige browsere paa vores egne sider, ikke et script der rammer adressen direkte
  if (oprindelse && !TILLADT.test(vaert(oprindelse))) return svar(200, oprindelse, { modtaget: true });

  const q = new URLSearchParams(ev.body || '');
  const adr = ip(ev);

  // 1. edderkoppefelt: usynligt for mennesker, bots udfylder det ofte alligevel
  if (q.get('hjemmeside')) return svar(200, oprindelse, { modtaget: true });

  // 2. tidsfælde: siden sætter et tidsstempel ved indlæsning, under 2,5 sek er ikke et menneske
  const t = Number(q.get('t') || 0);
  // en negativ alder betyder, at den besoegendes ur gaar foran serverens. Det er et menneske, ikke en bot.
  const alder = Date.now() - t;
  if (!t || (alder >= 0 && alder < 2500)) return svar(200, oprindelse, { modtaget: true });

  const navn = rens(q.get('navn'), 100), email = rens(q.get('email'), 200),
        emne = rens(q.get('emne'), 150), besked = rens(q.get('besked'), 4000);
  if (!navn || !gyldigEmail(email) || !besked) return svar(400, oprindelse, { fejl: 'Udfyld navn, en gyldig email og en besked' });

  if (sql) { try {
    await klarTabel();
    // 3. loft pr. IP: maks 3 gennemførte pr. time, maks 8 pr. dag, uanset hvilken email der skrives
    if (adr) {
      const [time, dogn] = await Promise.all([
        sql`SELECT count(*)::int AS n FROM vh_kontakt WHERE ip = ${adr} AND afvist = '' AND ts > now() - interval '1 hour'`,
        sql`SELECT count(*)::int AS n FROM vh_kontakt WHERE ip = ${adr} AND afvist = '' AND ts > now() - interval '1 day'`
      ]);
      if (time[0].n >= 3 || dogn[0].n >= 8) {
        await sql`INSERT INTO vh_kontakt (ip, navn, email, emne, besked, afvist) VALUES (${adr}, ${navn}, ${email}, ${emne}, ${besked}, ${'loft nået'})`;
        return svar(200, oprindelse, { modtaget: true });
      }
    }
    await sql`INSERT INTO vh_kontakt (ip, navn, email, emne, besked) VALUES (${adr}, ${navn}, ${email}, ${emne}, ${besked})`;
  } catch (e) {} }

  // support-mail oversat begge veje (kun paa en backend med support i profilen, se lib/sager.js): henvendelsen
  // bliver en sag, og teamet faar den paa dansk med sagsnummer, saa et svar naar kunden paa kundens sprog.
  // Fejler det, foer sagen findes, sendes den almindelige mail nedenfor, saa intet gaar tabt.
  if (sager.klar()) {
    try { await sager.fraFormular({ navn, email, emne, besked }, { slut: Date.now() + 5000 }); return svar(200, oprindelse, { modtaget: true }); }
    catch (e) { await sager.logFejl('Kontaktformularen kunne ikke lave en sag, sendt som almindelig mail: ' + String(e && e.message || e).slice(0, 120)); }
  }

  // hvor henvendelsen kom fra, og hvad emnet starter med, folger profilen (side.js)
  const { kilde, emne: emneStart, hvor } = profil.kontakt;
  const html = `<p><b>Ny henvendelse fra kontaktformularen${hvor}</b></p>
    <p><b>Navn:</b> ${esc(navn)}<br><b>Email:</b> ${esc(email)}<br><b>Emne:</b> ${esc(emne) || '(ingen)'}</p>
    <p><b>Besked:</b><br>${esc(besked).replace(/\n/g,'<br>')}</p>
    <p style="color:#888;font-size:12px">Sendt via ${kilde}${adr ? ', fra ' + esc(adr) : ''}</p>`;
  try { await mail.send('Ny henvendelse / ' + emneStart + (emne ? ' / ' + emne : ''), html); } catch (e) {}
  return svar(200, oprindelse, { modtaget: true });
};
