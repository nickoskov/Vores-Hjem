'use strict';
/**
 * Samtaler fra chatbotten. Backenden skriver ikke selv i bottens tabeller,
 * men kalder bottens egen admin-tjeneste. Saa bliver oversaettelsen til tysk,
 * bottens hukommelse og alarmerne ved med at virke, selvom panelet flytter.
 *
 * Den danske backend taler med den faelles bot paa voreshjem-bot.netlify.app og bruger
 * BOT_ADMIN_PASSWORD, eller ADMIN_PASSWORD hvis de er ens. BOT_URL kan pege et andet sted hen.
 *
 * En backend med sin egen bot (side.js, botEgen: den tyske) taler kun med sin egen funktion,
 * <backend>/.netlify/functions/chat-bot, med sin egen ADMIN_PASSWORD, som botten selv tjekker.
 * BOT_URL og BOT_ADMIN_PASSWORD bruges ikke der: de hoerer til den danske bot (BOT_ADMIN_PASSWORD
 * blev kopieret med over af flytnoegler) og maa aldrig sende den tyske backend til den danske bot.
 */
const profil = require('./side.js');
const EGEN = !!profil.botEgen;
const ADRESSE = EGEN ? profil.backend + '/.netlify/functions/chat-bot'
  : (process.env.BOT_URL || 'https://voreshjem-bot.netlify.app/.netlify/functions/chat-bot');
const KODE = EGEN ? (process.env.ADMIN_PASSWORD || '') : (process.env.BOT_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '');
const opsat = () => !!KODE;

async function bot(action, felter) {
  if (!KODE) throw new Error((EGEN ? 'ADMIN_PASSWORD' : 'BOT_ADMIN_PASSWORD') + ' mangler i Netlify');
  const r = await fetch(ADRESSE, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, password: KODE, site: profil.chat, ...(felter || {}) }) });
  const d = await r.json().catch(() => ({ error: 'uventet svar fra botten' }));
  if (!r.ok || d.error) throw new Error('Botten: ' + (d.message || d.error || r.status));
  return d;
}
module.exports = { bot, opsat };
