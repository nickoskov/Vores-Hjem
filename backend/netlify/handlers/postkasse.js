'use strict';
/**
 * Support-postkassen, hvert andet minut (functions/postkasse.mjs). Laeser nye mails i support-postkassen
 * over IMAP og giver dem til lib/sager.js: kundemails sendes til teamet paa dansk, teamets svar sendes
 * til kunden paa tysk, og automatisk mail (autosvar, fejlmeldinger, nyhedsbreve, vores egen) ignoreres.
 *
 * Koerer kun, naar profilen har support (side.js, den tyske) og alt er sat op (sager.mangler()).
 * Ellers goer den ingenting og siger hvorfor, uden at roere databasen.
 *
 * Sikkerhed mod dobbelt arbejde:
 *   - én koersel ad gangen: laas i vh_tilstand, der udloeber efter 45 sekunder
 *   - mail fra foer funktionen blev slaaet til, roeres aldrig (startdato i vh_tilstand)
 *   - hver mail noteres i vh_postkasse med uid og Message-ID, saa samme mail aldrig behandles to gange,
 *     heller ikke hvis \Seen ikke kunne saettes, eller den samme mail ligger der to gange
 * Tid: Netlify stopper en planlagt funktion efter 30 sekunder. Der startes intet nyt efter STOP, og
 * Claude skal vaere faerdig ved SLUT. Det, der ikke naaes, tages ved naeste koersel.
 */
const crypto = require('crypto');
const { simpleParser } = require('mailparser');
const imap = require('../lib/imap.js');
const sager = require('../lib/sager.js');
const { sql, log } = require('../lib/db.js');
const profil = require('../lib/side.js');

const STOP = 10000, SLUT = 22000;           // ms efter start
const MAKS_MAILS = 4, MAKS_VENTENDE = 3;    // pr. koersel
const VINDUE = 30;                          // dage tilbage, der soeges i
const STOR = 3 * 1024 * 1024;               // stoerre mails hentes kun i starten (tekst og headere)

const svar = d => ({ statusCode: 200, body: JSON.stringify(d) });

/** mailparsers resultat som det, sager.js arbejder med */
function normaliser(p, modtaget) {
  const headers = new Map();
  for (const h of p.headerLines || []) {
    const k = String(h.key || '').toLowerCase();
    if (k && !headers.has(k)) headers.set(k, String(h.line || '').replace(/^[^:]*:\s*/, '').replace(/\r?\n[ \t]+/g, ' ').trim());
  }
  const a = x => (x && x.value && x.value[0]) || {};
  const refs = !p.references ? [] : Array.isArray(p.references) ? p.references : String(p.references).split(/\s+/);
  return {
    fra: String(a(p.from).address || '').toLowerCase(), fraNavn: a(p.from).name || '',
    svarTil: String(a(p.replyTo).address || '').toLowerCase(),
    emne: p.subject || '', tekst: p.text || '', messageId: p.messageId || '',
    inReplyTo: p.inReplyTo || '', references: refs.filter(Boolean),
    modtaget: modtaget ? new Date(modtaget) : (p.date || null),
    indholdstype: headers.get('content-type') || '', headers,
    // indlejrede billeder (fx et logo i signaturen) er ikke vedhaeftede filer
    bilag: (p.attachments || []).filter(x => !x.related).map(x => x.filename || 'uden navn')
  };
}

async function laas(id) {
  const r = await sql`INSERT INTO vh_tilstand (noegle, vaerdi, opdateret) VALUES ('postkasse-laas', ${id}, now())
    ON CONFLICT (noegle) DO UPDATE SET vaerdi = EXCLUDED.vaerdi, opdateret = now()
    WHERE vh_tilstand.opdateret < now() - interval '45 seconds' RETURNING vaerdi`;
  return !!(r[0] && r[0].vaerdi === id);
}
const frigiv = id => sql`DELETE FROM vh_tilstand WHERE noegle = 'postkasse-laas' AND vaerdi = ${id}`.catch(() => {});

/** Tidspunktet, funktionen foerst koerte fuldt opsat. Mail fra foer det roeres aldrig. */
async function startTid() {
  await sql`INSERT INTO vh_tilstand (noegle, vaerdi) VALUES ('postkasse-start', ${new Date().toISOString()}) ON CONFLICT (noegle) DO NOTHING`;
  const [r] = await sql`SELECT vaerdi FROM vh_tilstand WHERE noegle = 'postkasse-start'`;
  return new Date(r.vaerdi);
}

const noter = (uv, uid, mid, hvad, sag) => sql`INSERT INTO vh_postkasse (uidvalidity, uid, message_id, hvad, sag)
  VALUES (${uv}, ${uid}, ${mid || ''}, ${hvad}, ${sag || null}) ON CONFLICT DO NOTHING`;

exports.handler = async () => {
  const t0 = Date.now(), brugt = () => Date.now() - t0;
  if (!profil.support) return svar({ sprunget_over: 'ingen support-mail på backenden til ' + profil.navn });
  const mangler = sager.mangler();
  if (mangler.length || !sql) {
    console.log('postkasse: gør ingenting, mangler ' + (mangler.join(', ') || 'DATABASE_URL'));
    return svar({ sprunget_over: 'mangler ' + (mangler.join(', ') || 'DATABASE_URL') });
  }
  const laasId = crypto.randomBytes(8).toString('hex');
  try {
    await sager.tabeller();
    if (!(await laas(laasId))) return svar({ sprunget_over: 'en anden kørsel er i gang' });
  } catch (e) {
    // databasen svarer ikke (eller er afvist af ejermaerket, db.js): intet kan noteres, saa intet roeres
    console.log('postkasse: databasen svarede ikke: ' + String(e && e.message || e).slice(0, 160));
    return svar({ fejl: 'database: ' + String(e && e.message || e).slice(0, 160) });
  }
  const ud = { ventende: 0, mails: 0, gammel: 0, hvad: {} };
  try {
    const start = await startTid();

    // 1. beskeder, der venter paa at komme til teamet (formularen, eller oversaettelsen fejlede sidst)
    for (const id of await sager.ventende(MAKS_VENTENDE)) {
      if (brugt() > STOP) break;
      const r = await sager.videresend(id, { slut: t0 + SLUT });
      if (r && !r.sprunget) ud.ventende++;
    }

    // 2. nye mails
    if (brugt() > STOP) return svar({ ...ud, stoppet: 'tiden' });
    let k;
    try { k = imap.klient(); await k.connect(); }
    catch (e) {
      await sager.logFejl('Support-postkassen kunne ikke åbnes over IMAP: ' + String(e && (e.responseText || e.message) || e).slice(0, 140));
      if (k) await imap.luk(k);
      return svar({ ...ud, fejl: 'IMAP: ' + String(e && e.message || e).slice(0, 140) });
    }
    try {
      const lock = await k.getMailboxLock('INBOX');
      try {
        const uv = String(k.mailbox.uidValidity);
        const fra = new Date(Math.max(start.getTime() - 86400000, Date.now() - VINDUE * 86400000));
        const uids = ((await k.search({ since: fra }, { uid: true })) || []).map(Number).sort((a, b) => a - b);
        if (!uids.length) return svar(ud);
        const kendte = new Set((await sql`SELECT uid FROM vh_postkasse WHERE uidvalidity = ${uv} AND uid >= ${uids[0]}`).map(r => String(r.uid)));
        const nye = uids.filter(u => !kendte.has(String(u))).slice(0, 40);
        if (!nye.length) return svar(ud);
        const meta = await k.fetchAll(nye.join(','), { uid: true, internalDate: true, size: true }, { uid: true });
        const kandidater = [];
        for (const x of meta.sort((a, b) => a.uid - b.uid)) {
          // kom foer funktionen blev slaaet til: noteres, saa den aldrig hentes igen, og roeres ikke
          if (x.internalDate && new Date(x.internalDate) < start) { await noter(uv, x.uid, '', 'gammel', null); ud.gammel++; continue; }
          kandidater.push(x);
        }
        for (const x of kandidater.slice(0, MAKS_MAILS)) {
          if (brugt() > STOP) { ud.stoppet = 'tiden'; break; }
          const f = await k.fetchOne(String(x.uid), { uid: true, internalDate: true, source: (x.size || 0) > STOR ? { maxLength: 1024 * 1024 } : true }, { uid: true });
          if (!f || !f.source) continue;
          const m = normaliser(await simpleParser(f.source, { skipImageLinks: true, skipTextLinks: true, maxHtmlLengthToParse: 1000000 }), f.internalDate || x.internalDate);
          const mid = m.messageId || 'uid:' + uv + ':' + x.uid;
          ud.mails++;
          const [set] = await sql`SELECT hvad FROM vh_postkasse WHERE message_id = ${mid} AND hvad <> 'dublet' LIMIT 1`;
          let r;
          if (set) r = { hvad: 'dublet' };
          else {
            const slags = sager.klassificer(m);
            if (slags === 'kunde') {
              r = await sager.kundeMail({ ...m, messageId: mid });
              // naas det ikke nu, ligger den som ventende til naeste koersel
              if (r.besked && brugt() < STOP + 4000) await sager.videresend(r.besked, { slut: t0 + SLUT });
            } else if (slags === 'team') r = await sager.teamSvar({ ...m, messageId: mid }, { slut: t0 + SLUT });
            else {
              r = { hvad: slags };
              if (slags === 'auto') await log('support', 'Automatisk mail ignoreret (' + sager.erAuto(m) + ')', 'postkasse');
            }
          }
          await noter(uv, x.uid, mid, r.hvad, r.sag);
          ud.hvad[r.hvad] = (ud.hvad[r.hvad] || 0) + 1;
          // markeres som laest, men dobbeltarbejde forhindres af vh_postkasse, ikke af \Seen
          try { await k.messageFlagsAdd(String(x.uid), ['\\Seen'], { uid: true }); } catch (e) {}
        }
        if (kandidater.length > MAKS_MAILS) ud.flere = kandidater.length - MAKS_MAILS;
      } finally { lock.release(); }
    } finally { await imap.luk(k); }
    return svar(ud);
  } catch (e) {
    await sager.logFejl('Postkassen fejlede: ' + String(e && e.message || e).slice(0, 160));
    return svar({ ...ud, fejl: String(e && e.message || e).slice(0, 160) });
  } finally { await frigiv(laasId); }
};

exports.normaliser = normaliser;
