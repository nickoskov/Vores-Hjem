'use strict';
/** Sender mail via samme SMTP som bot-panelet. Uden SMTP-variabler sendes intet, og der logges i stedet. */
const nodemailer = require('nodemailer');
const profil = require('./side.js');
// et mellemrum foer eller efter, der kom med ved indsaettelsen i Netlify, faar ellers Simply til at afvise login
const ren = v => String(v || '').trim();
const SMTP_HOST = ren(process.env.SMTP_HOST), SMTP_PORT = ren(process.env.SMTP_PORT), SMTP_USER = ren(process.env.SMTP_USER), SMTP_PASS = ren(process.env.SMTP_PASS);
const FRA = process.env.ALERT_FROM || SMTP_USER || 'backend@' + profil.navn;
const TIL = process.env.ALERT_TO || '';
const opsat = () => !!(SMTP_HOST && SMTP_USER && SMTP_PASS && TIL);

async function send(emne, html, tekst) {
  if (!opsat()) return { sendt: false, grund: 'SMTP eller ALERT_TO mangler' };
  const t = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  await t.sendMail({ from: profil.brand + ' backend <' + FRA + '>', to: TIL, subject: emne, html,
    text: tekst || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
  return { sendt: true, til: TIL };
}

/**
 * Én mail med egen afsender, modtager og headere (support-mailen, lib/sager.js). Kaster ved fejl,
 * saa den, der kalder, selv afgoer, hvad en fejl betyder. b: fra, til, svarTil, emne, tekst, html,
 * headers, messageId, inReplyTo, references.
 */
async function afsted(b) {
  if (!(SMTP_HOST && SMTP_USER && SMTP_PASS)) throw new Error('SMTP_HOST, SMTP_USER eller SMTP_PASS mangler');
  // korte graenser, saa en haengende SMTP-server ikke aeder en planlagt funktions 30 sekunder
  const t = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000 });
  const info = await t.sendMail({ from: b.fra, to: b.til, replyTo: b.svarTil || undefined, subject: b.emne,
    text: b.tekst, html: b.html || undefined, headers: b.headers || {}, messageId: b.messageId || undefined,
    inReplyTo: b.inReplyTo || undefined, references: b.references || undefined });
  return { sendt: true, id: info.messageId || b.messageId || '' };
}

module.exports = { send, afsted, opsat, TIL };
