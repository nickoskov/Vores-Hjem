'use strict';
/**
 * Oppetidsvagt. Koerer hver time (sat i netlify.toml) og pinger siden (voreshjem.dk eller
 * unserzuhauseapp.de efter SIDE, se lib/side.js).
 * Svarer siden ikke, sendes én mail, og én igen naar den er oppe. Ikke en mail
 * hver time, for saa laeser ingen dem.
 *
 * Maa gerne koere flere gange, men gemmer hoejst ét tjek pr. time (UTC-timen), saa en
 * gentagelse fra Netlify 30-65 sekunder senere ikke giver to raekker og dermed skaeve procenter.
 */
const { sql, opret, log } = require('../lib/db.js');
const mail = require('../lib/mail.js');
const K = require('../lib/koersel.js');
const profil = require('../lib/side.js');
const MAAL = process.env.VAGT_URL || profil.site + '/';

exports.handler = async () => {
  const t0 = Date.now();
  let oppe = false, status = 0, fejl = '';
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 15000);
    const r = await fetch(MAAL, { redirect: 'follow', signal: c.signal,
      headers: { 'User-Agent': 'VoresHjem-vagt/1.0' } });
    clearTimeout(t);
    status = r.status;
    const krop = await r.text();
    // 200 er ikke nok. Siden skal ogsaa indeholde noget vi kender, ellers er
    // det en fejlside fra hosten
    oppe = r.ok && profil.kendetegn.test(krop);
    if (!oppe) fejl = r.ok ? 'siden svarer, men indholdet er forkert' : 'svar ' + r.status;
  } catch (e) { fejl = e.name === 'AbortError' ? 'ingen svar inden 15 sekunder' : String(e.message||e); }
  const ms = Date.now() - t0;

  if (!sql) return { statusCode: 200, body: JSON.stringify({ oppe, ms, gemt: false }) };
  await opret();
  // vagten koerer hver time, og Netlify proever nogle gange igen 30-65 sekunder senere.
  // Noeglen er timen i UTC, saa en gentagelse ikke giver et ekstra tjek, og sommertidens dobbelte klokken 2 ikke sluger et.
  if (!(await K.foersteGang('vagt', new Date(t0).toISOString().slice(0, 13)))) {
    return { statusCode: 200, body: JSON.stringify({ oppe, ms, gemt: false, grund: 'allerede tjekket i denne time' }) };
  }
  const sidste = await sql`SELECT oppe FROM vh_oppetid ORDER BY id DESC LIMIT 1`;
  await sql`INSERT INTO vh_oppetid (oppe, ms, status, fejl) VALUES (${oppe}, ${ms}::int, ${status}::int, ${fejl})`;
  const foer = sidste[0] ? sidste[0].oppe : true;

  if (foer && !oppe) {
    await log('SIDEN ER NEDE', fejl, 'vagt');
    await mail.send(profil.navn + ' svarer ikke',
      `<p><b>${profil.navn} svarer ikke.</b></p><p>Fejl: ${fejl}</p>
       <p>Tjekket ${new Date().toLocaleString('da-DK',{timeZone:'Europe/Copenhagen'})}.
       Vagten tjekker igen om en time og skriver, når siden er oppe igen.</p>`).catch(()=>{});
  } else if (!foer && oppe) {
    await log('siden er oppe igen', ms + ' ms', 'vagt');
    await mail.send(profil.navn + ' er oppe igen',
      `<p><b>${profil.navn} svarer igen.</b> Svartid ${ms} ms.</p>`).catch(()=>{});
  }
  // ryd op: behold 30 dage
  await sql`DELETE FROM vh_oppetid WHERE hvornaar < now() - interval '30 days'`;
  return { statusCode: 200, body: JSON.stringify({ oppe, ms, status }) };
};
