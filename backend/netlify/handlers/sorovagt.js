'use strict';
/**
 * Henter nye indlaeg fra Soros RSS-feed en gang i timen (sat i netlify.toml).
 * Er SORO_RSS_URL ikke sat, goer den ingenting. Det samme paa en backend uden blog (side.js, skjul),
 * saa et kopieret SORO_RSS_URL ikke henter de danske indlaeg ind paa den tyske.
 *
 * Hoejst én koersel pr. time (laas i vh_koersel). Fejler hentningen, skrives
 * det i loggen én gang pr. dag, saa det ikke sker i stilhed, men heller ikke
 * fylder loggen hver time.
 */
const soro = require('../lib/soro.js');
const K = require('../lib/koersel.js');
const { log } = require('../lib/db.js');
const profil = require('../lib/side.js');

exports.handler = async () => {
  if (!soro.opsat()) return { statusCode: 200, body: JSON.stringify({ sprunget_over: 'SORO_RSS_URL mangler' }) };
  if (profil.skjul.includes('blog')) return { statusCode: 200, body: JSON.stringify({ sprunget_over: 'ingen blog på backenden til ' + profil.navn }) };
  const nu = K.dansk();
  // dansk dato og time, plus UTC-timen, saa sommertidens dobbelte klokken 2 ikke sluger en koersel
  const noegle = nu.dato + ' ' + nu.time + ' (' + new Date().toISOString().slice(11, 13) + 'Z)';
  if (!(await K.foersteGang('sorovagt', noegle))) return { statusCode: 200, body: JSON.stringify({ sprunget_over: 'allerede hentet i denne time' }) };
  try { const r = await soro.hent(); return { statusCode: 200, body: JSON.stringify(r) }; }
  catch (e) {
    const tekst = String(e.message || e).slice(0, 160);
    if (await K.foersteGang('sorovagt-fejl', nu.dato)) await log('Soro kunne ikke hentes', tekst, 'sorovagt');
    return { statusCode: 200, body: JSON.stringify({ fejl: tekst }) };
  }
};
