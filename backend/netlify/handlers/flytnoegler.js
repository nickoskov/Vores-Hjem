'use strict';
/**
 * Engangsjob 8. okt. 2026: kopierer de faelles noegler fra den danske backend til den tyske
 * (unserzuhause-backend), direkte hos Netlify. Netlify udleverer ikke hemmelige vaerdier gennem
 * sit API, saa kun koden, der koerer paa den danske backend, kan laese dem. Ingen vaerdi skrives
 * i loggen eller i et svar, kun navnene.
 *
 * Kopierer kun navnene i LISTE, og kun dem den tyske side ikke allerede har. Overskriver aldrig.
 * DATABASE_URL og SESSION_SECRET er aldrig med: den tyske backend har sin egen database og sit eget login.
 * Koerer hvert 5. minut og goer intet, naar alt er kopieret. Fjernes igen ved naeste udgivelse.
 */
const { log } = require('../lib/db.js');
const profil = require('../lib/side.js');

const LISTE = ['SMTP_PASS', 'GA4_CREDENTIALS', 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_VENDOR_NUMBER', 'ASC_PRIVATE_KEY',
  'PSI_API_KEY', 'ADMIN_PASSWORD', 'BOT_ADMIN_PASSWORD'];
const ALDRIG = new Set(['DATABASE_URL', 'SESSION_SECRET', 'NETLIFY_TOKEN', 'SIDE']);

exports.handler = async () => {
  const TOKEN = process.env.NETLIFY_TOKEN || '';
  if (profil.kode !== 'dk' || !TOKEN) return { statusCode: 200, body: 'intet at goere' };
  const api = async (sti, valg) => {
    const r = await fetch('https://api.netlify.com/api/v1' + sti, { ...(valg || {}),
      headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } });
    if (!r.ok) throw new Error('Netlify ' + r.status + ' ved ' + sti.split('?')[0]);
    return r.status === 204 ? null : r.json();
  };
  try {
    const maal = profil.anden.backendSiteId;
    const konto = (await api('/sites/' + maal)).account_id;
    const har = new Set((await api(`/accounts/${konto}/env?site_id=${maal}`)).map(v => v.key));
    // botten bruger ADMIN_PASSWORD, naar BOT_ADMIN_PASSWORD ikke er sat her
    const vaerdi = k => k === 'BOT_ADMIN_PASSWORD' ? (process.env.BOT_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD) : process.env[k];
    const nye = LISTE.filter(k => !ALDRIG.has(k) && !har.has(k) && vaerdi(k))
      .map(k => ({ key: k, is_secret: true, scopes: ['builds', 'functions', 'runtime'], values: [{ context: 'production', value: String(vaerdi(k)) }] }));
    if (!nye.length) return { statusCode: 200, body: 'alt er kopieret' };
    await api(`/accounts/${konto}/env?site_id=${maal}`, { method: 'POST', body: JSON.stringify(nye) });
    await log('noegler', 'kopieret til ' + profil.anden.navn + ': ' + nye.map(n => n.key).join(', '), 'flytnoegler');
    return { statusCode: 200, body: 'kopieret: ' + nye.map(n => n.key).join(', ') };
  } catch (e) {
    await log('noegler', 'kopiering til ' + profil.anden.navn + ' fejlede: ' + String(e.message).slice(0, 120), 'flytnoegler');
    return { statusCode: 200, body: 'fejl' };
  }
};
