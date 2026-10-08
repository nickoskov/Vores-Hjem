'use strict';
/**
 * Forbindelsen til support-postkassen over IMAP (handlers/postkasse.js og "Test forbindelserne").
 * Samme login som SMTP: SMTP_USER og SMTP_PASS. Vaert og port er Simplys, imap.simply.com og 993
 * med TLS, og kan skiftes med IMAP_HOST og IMAP_PORT. Korte graenser, fordi en planlagt funktion
 * hoejst har 30 sekunder.
 */
const { ImapFlow } = require('imapflow');
const ren = v => String(v || '').trim();

function klient() {
  const port = Number(ren(process.env.IMAP_PORT) || 993);
  return new ImapFlow({ host: ren(process.env.IMAP_HOST) || 'imap.simply.com', port, secure: port !== 143,
    auth: { user: ren(process.env.SMTP_USER), pass: ren(process.env.SMTP_PASS) },
    logger: false, disableAutoIdle: true, connectionTimeout: 7000, greetingTimeout: 5000, socketTimeout: 20000 });
}

/** Logger ud, men venter hoejst 2 sekunder paa serveren, og lukker saa forbindelsen under alle omstaendigheder. */
async function luk(k) {
  try { await Promise.race([k.logout(), new Promise(r => setTimeout(r, 2000))]); } catch (e) {}
  try { k.close(); } catch (e) {}
}

/** Til "Test forbindelserne": logger ind og taeller indbakken. Laeser ingen mails. */
async function tjek() {
  const k = klient();
  await k.connect();
  try {
    const s = await k.status('INBOX', { messages: true, unseen: true });
    return 'logget ind på ' + (ren(process.env.IMAP_HOST) || 'imap.simply.com') + ', indbakken har ' + (s ? s.messages + ' mails, ' + s.unseen + ' ulæste' : 'intet svar');
  } finally { await luk(k); }
}

module.exports = { klient, luk, tjek };
