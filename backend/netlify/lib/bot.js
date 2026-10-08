'use strict';
/**
 * Samtaler fra chatbotten. Backenden skriver ikke selv i bottens tabeller,
 * men kalder bottens egen admin-tjeneste. Saa bliver oversaettelsen til tysk,
 * bottens hukommelse og alarmerne ved med at virke, selvom panelet flytter.
 *
 * Bruger BOT_ADMIN_PASSWORD, eller ADMIN_PASSWORD hvis de er ens.
 */
const profil = require('./side.js');
const ADRESSE = process.env.BOT_URL || 'https://voreshjem-bot.netlify.app/.netlify/functions/chat-bot';
const KODE = process.env.BOT_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';
const opsat = () => !!KODE;

async function bot(action, felter) {
  if (!KODE) throw new Error('BOT_ADMIN_PASSWORD mangler i Netlify');
  const r = await fetch(ADRESSE, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, password: KODE, site: profil.chat, ...(felter || {}) }) });
  const d = await r.json().catch(() => ({ error: 'uventet svar fra botten' }));
  if (!r.ok || d.error) throw new Error('Botten: ' + (d.message || d.error || r.status));
  return d;
}
module.exports = { bot, opsat };
