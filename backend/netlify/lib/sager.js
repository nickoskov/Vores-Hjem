'use strict';
/**
 * Support-mail oversat begge veje. Kun paa en backend, hvis profil har support (side.js), altsaa den tyske.
 *
 * Kunden skriver paa tysk til support-postkassen (SMTP_USER), eller via kontaktformularen. Det bliver en
 * sag med et nummer, [UZ-12], og teamet (SUPPORT_TEAM) faar en dansk oversaettelse fra support-postkassen
 * med Reply-To tilbage til den. Teamet svarer paa dansk, svaret kommer ind i postkassen
 * (handlers/postkasse.js), oversaettes til tysk og sendes til kunden fra support-postkassen. Teamet faar
 * en kvittering med den tyske tekst. Kunden ser aldrig dansk og aldrig Vores Hjem.
 *
 * Mod sloejfer: alt, vi sender, har headeren X-UZ-Sag og kommer fra postkassen selv, og den slags mail
 * ignoreres, naar den kommer ind igen. Mails til teamet har Auto-Submitted: auto-generated, saa et
 * ordentligt autosvar slet ikke svarer. Autosvar, der svarer alligevel, fanges paa headere, emne og
 * paa, at et menneske ikke kan svare faa sekunder efter, vi har skrevet (HURTIG).
 *
 * Tabeller (oprettes her, i backendens egen database med ejermaerket fra db.js):
 *   vh_sager          én raekke pr. sag. id er nummeret i [UZ-id]. sidst styrer oprydningen (ryd.js).
 *   vh_sag_beskeder   hver besked ind (fra kunden) og ud (til kunden), original og oversaettelse.
 *                     kilde_id er Message-ID paa den mail, raekken kom fra. Den er unik, saa en mail aldrig
 *                     giver to raekker eller to afsendelser, heller ikke efter en afbrudt koersel.
 *   vh_postkasse      hver mail, postkassen har set (uid og Message-ID), og hvad den var. Ingen indhold.
 *   vh_tilstand       hvornaar postkassen blev slaaet til, og laasen mod to koersler paa én gang.
 */
const crypto = require('crypto');
const { sql, opret, log } = require('./db.js');
const mail = require('./mail.js');
const profil = require('./side.js');
const K = require('./koersel.js');
const { oversaet, MAKS_TEGN } = require('./oversaet.js');

const S = profil.support;
const DAGE = Math.max(7, parseInt(process.env.RYD_DAGE, 10) || 90);
const FORSOEG = 3;          // forsoeg paa at oversaette en kundemail, foer den sendes uoversat
const SMTP_FORSOEG = 6;     // forsoeg paa at sende den til teamet, foer den opgives
const HURTIG = 60 * 1000;   // et "svar" fra teamet saa hurtigt efter vores mail er et autosvar
const STREG = '------------------------------';
// oversaettelsens retning efter profilen: ind er kundens sprog til teamets, ud er tilbage (lib/oversaet.js)
const IND = S ? S.kundeSprog + '-' + S.teamSprog : '', UD = S ? S.teamSprog + '-' + S.kundeSprog : '';

const env = n => String(process.env[n] || '').trim();
const gyldig = s => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(s);
const adresser = v => [...new Set(String(v || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase().replace(/^<|>$/g, '')).filter(gyldig))];
const postkasse = () => env('SMTP_USER').toLowerCase();
const domaene = () => postkasse().split('@')[1] || 'localhost';
/** Dem, der faar kundernes mails. Postkassen selv er aldrig med, ellers fodrer den sig selv. */
const team = () => adresser(env('SUPPORT_TEAM')).filter(a => a !== postkasse());
/** Dem, hvis svar sendes videre til kunden: teamet plus SUPPORT_TEAM_EKSTRA. */
const svarere = () => [...new Set([...team(), ...adresser(env('SUPPORT_TEAM_EKSTRA'))])].filter(a => a !== postkasse());
/** Vores egne afsendere: postkassen og ALERT_FROM (backendens alarmer kan ligge i samme postkasse). */
const egne = () => [postkasse(), ...adresser(env('ALERT_FROM'))].filter(Boolean);

/** Navnene paa det, der mangler, for at funktionen kan koere. Tom liste: klar. */
function mangler() {
  if (!S) return [];
  const m = [];
  if (!process.env.DATABASE_URL) m.push('DATABASE_URL');
  if (!env('ANTHROPIC_API_KEY')) m.push('ANTHROPIC_API_KEY');
  for (const n of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) if (!env(n)) m.push(n);
  if (env('SMTP_USER') && !gyldig(postkasse())) m.push('SMTP_USER (skal være postkassens adresse)');
  if (!team().length) m.push('SUPPORT_TEAM');
  return m;
}
const klar = () => !!(S && sql) && !mangler().length;
/** Til panelets Opsaetning. status er offentlig, saa kun om det er sat op og navnene paa det, der mangler. */
const status = () => S ? { klar: klar(), mangler: mangler() } : null;

/* ── sagsnumre, Message-ID og emner ─────────────────────────────────── */
const TOKEN = S ? new RegExp('\\[' + S.praefiks + '-(\\d{1,9})\\]', 'i') : null;
const TOKEN_ALLE = S ? new RegExp('\\s*\\[' + S.praefiks + '-\\d{1,9}\\]\\s*', 'gi') : null;
const maerke = id => '[' + S.praefiks + '-' + id + ']';
const sagsnavn = id => S.praefiks + '-' + id;
const HEADER = S ? 'X-' + S.praefiks + '-Sag' : '';
function tokenI(tekst) { const m = TOKEN && TOKEN.exec(String(tekst || '')); return m ? Number(m[1]) : null; }
/** Vores egne Message-ID'er baerer sagen: <uz-12.a1b2c3@postkassens-domaene> */
const nyId = id => '<' + S.praefiks.toLowerCase() + '-' + id + '.' + crypto.randomBytes(8).toString('hex') + '@' + domaene() + '>';
function idFraHeadere(m) {
  const r = new RegExp('<' + S.praefiks + '-(\\d{1,9})\\.[0-9a-f]+@' + domaene().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '>', 'i');
  for (const x of [m.inReplyTo, ...(m.references || [])].filter(Boolean).reverse()) { const t = r.exec(String(x)); if (t) return Number(t[1]); }
  return null;
}
/** Emnet uden sagsnummer og uden Re:, AW:, SV:, Fwd: osv. foran. */
function renEmne(s) {
  let e = String(s || '').replace(/\s+/g, ' ').trim();
  if (TOKEN_ALLE) e = e.replace(TOKEN_ALLE, ' ').trim();
  let f;
  do { f = e; e = e.replace(/^(re|aw|sv|vs|fw|fwd|wg|antw|antwort|vb)\s*(\[\d+\])?\s*:\s*/i, '').trim(); } while (e !== f);
  return e;
}
const hvem = (navn, adr) => navn ? navn + ' <' + adr + '>' : adr;

/* ── ny tekst i et svar: uden citat af tidligere mails ──────────────── */
// foerste linje i alle vores mails til teamet. Svarer teamet oven over den, skaeres resten fra her.
const VORES_LINJE = /^[>\s]*(Ny besked i sag|Sendt til kunden i sag|Intet sendt)\b/i;
/** "Den tor. 8. okt. 2026 kl. 18.02 skrev Navn <adr>:" og tilsvarende paa tysk og engelsk, ogsaa over to-tre linjer. */
function citatHoved(l, i) {
  if (!/\d/.test(l[i])) return false;   // datoen staar altid paa foerste linje
  let j = '';
  for (let k = 0; k < 3 && i + k < l.length; k++) {
    if (k && !l[i + k].trim()) return false;
    j = (j + ' ' + l[i + k].trim()).trim();
    if (j.length > 300) return false;
    if (/\b(skrev|wrote|schrieb|a écrit|escribió|schreef)\b/i.test(j) && /:\s*$/.test(j) && /@|\b\d{4}\b|\d{1,2}[:.]\d{2}/.test(j)) return true;
  }
  return false;
}
function nyTekst(t) {
  const l = String(t || '').replace(/\r\n?/g, '\n').split('\n');
  const ud = [];
  for (let i = 0; i < l.length; i++) {
    const s = l[i].trim();
    if (VORES_LINJE.test(l[i])) break;
    if (/^-{2,}\s*(original message|oprindelig (meddelelse|besked)|ursprüngliche nachricht|forwarded message|videresendt (meddelelse|besked)|weitergeleitete nachricht)\s*-{2,}$/i.test(s)) break;
    // Outlooks skillelinje (som tekst fra html bliver den en raekke streger) foer "Fra:"
    if (/^[-_]{8,}$/.test(s) && /^\*?(fra|from|von)\s*:/i.test((l.slice(i + 1).find(x => x.trim()) || '').trim())) break;
    if (/^\*?(fra|from|von)\s*:\*?\s*\S/i.test(s) && l.slice(i + 1, i + 5).some(x => /^\*?(sendt|sent|gesendet|dato|date|datum|til|to|an|emne|subject|betreff)\s*:/i.test(x.trim()))) break;
    if (citatHoved(l, i)) break;
    if (/^--\s?$/.test(l[i])) break;   // signaturskel
    if (/^>/.test(s)) continue;
    if (/^(sendt fra min|sent from my|von meinem .{1,40} gesendet|gesendet (von|mit) )/i.test(s)) continue;
    ud.push(l[i].replace(/\s+$/, ''));
  }
  // en skillelinje til sidst hoerer til citatet, ikke til svaret
  while (ud.length && (!ud[ud.length - 1].trim() || /^\s*[-_=*]{5,}\s*$/.test(ud[ud.length - 1]))) ud.pop();
  return ud.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ── automatisk mail ────────────────────────────────────────────────── */
const AUTO_EMNE = /^\s*(auto(matic|matische|matisk)?[\s_-]*(reply|antwort|svar|response|beantwortung)|autosvar|abwesenheit\w*|out of (the )?office|fravær\w*|ikke til stede|undeliverable|unzustellbar|nicht zustellbar|delivery status notification|mail delivery failed|returned mail)\b[^:]{0,40}:/i;
// fra teamets egne adresser er alt, der ligner et autosvar, et autosvar
const AUTO_TEAM = /\b(tak for din henvendelse|autosvar|automatisk svar|auto[- ]?reply|automatic reply|out of office|fravær|ikke til stede|abwesen|automatische antwort)/i;
/** Grunden til, at en mail er automatisk, eller '' */
function erAuto(m) {
  const h = n => String((m.headers && m.headers.get(n)) || '').trim().toLowerCase();
  const as = h('auto-submitted');
  if (as && as !== 'no') return 'Auto-Submitted: ' + as;
  for (const n of ['x-autoreply', 'x-autorespond', 'x-autoresponder', 'x-autoreply-from', 'x-mail-autoreply']) if (h(n)) return n;
  if (/^(auto_reply|bulk|junk|list)$/.test(h('precedence'))) return 'Precedence: ' + h('precedence');
  if (h('list-id')) return 'List-Id';
  if (m.headers && m.headers.has('return-path') && /^<\s*>$/.test(h('return-path'))) return 'tom Return-Path';
  if (/^(mailer-daemon|postmaster)@/i.test(m.fra || '')) return 'afsender ' + String(m.fra).split('@')[0];
  if (/multipart\/report/i.test(m.indholdstype || '')) return 'leveringsrapport';
  if (AUTO_EMNE.test(m.emne || '')) return 'emnet';
  if (svarere().includes(String(m.fra || '').toLowerCase()) && AUTO_TEAM.test(m.emne || '')) return 'emnet (fra teamet)';
  return '';
}
/** 'egen' (vores egen mail), 'auto', 'team' eller 'kunde' */
function klassificer(m) {
  const fra = String(m.fra || '').toLowerCase();
  if ((m.headers && m.headers.get(HEADER.toLowerCase())) || egne().includes(fra)) return 'egen';
  if (erAuto(m)) return 'auto';
  if (svarere().includes(fra)) return 'team';
  return 'kunde';
}

/* ── tabeller ───────────────────────────────────────────────────────── */
let klarTabeller = false;
async function tabeller() {
  if (klarTabeller || !sql) return;
  await sql`CREATE TABLE IF NOT EXISTS vh_sager (
    id SERIAL PRIMARY KEY, email TEXT NOT NULL, navn TEXT NOT NULL DEFAULT '',
    emne_de TEXT NOT NULL DEFAULT '', emne_da TEXT NOT NULL DEFAULT '', kilde TEXT NOT NULL DEFAULT 'mail',
    kvitteret TIMESTAMPTZ, til_team TIMESTAMPTZ,
    oprettet TIMESTAMPTZ NOT NULL DEFAULT now(), sidst TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`CREATE INDEX IF NOT EXISTS vh_sager_email ON vh_sager (lower(email))`;
  await sql`CREATE INDEX IF NOT EXISTS vh_sager_sidst ON vh_sager (sidst)`;
  await sql`CREATE TABLE IF NOT EXISTS vh_sag_beskeder (
    id SERIAL PRIMARY KEY, sag INTEGER NOT NULL REFERENCES vh_sager (id) ON DELETE CASCADE,
    retning TEXT NOT NULL, fra TEXT NOT NULL DEFAULT '', emne TEXT NOT NULL DEFAULT '',
    tekst TEXT NOT NULL DEFAULT '', oversat TEXT NOT NULL DEFAULT '', bilag TEXT NOT NULL DEFAULT '',
    kilde_id TEXT NOT NULL DEFAULT '', sendt_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'venter', forsoeg INTEGER NOT NULL DEFAULT 0, fejl TEXT NOT NULL DEFAULT '',
    ts TIMESTAMPTZ NOT NULL DEFAULT now(), opdateret TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS vh_sag_beskeder_kilde ON vh_sag_beskeder (kilde_id) WHERE kilde_id <> ''`;
  await sql`CREATE INDEX IF NOT EXISTS vh_sag_beskeder_sag ON vh_sag_beskeder (sag, id)`;
  await sql`CREATE TABLE IF NOT EXISTS vh_postkasse (
    uidvalidity TEXT NOT NULL, uid BIGINT NOT NULL, message_id TEXT NOT NULL DEFAULT '',
    hvad TEXT NOT NULL DEFAULT '', sag INTEGER, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (uidvalidity, uid))`;
  // samme Message-ID kan kun behandles én gang. En gentagelse gemmes som 'dublet', saa dens uid ikke hentes igen.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS vh_postkasse_mid ON vh_postkasse (message_id) WHERE message_id <> '' AND hvad <> 'dublet'`;
  await sql`CREATE TABLE IF NOT EXISTS vh_tilstand (noegle TEXT PRIMARY KEY, vaerdi TEXT NOT NULL DEFAULT '',
    opdateret TIMESTAMPTZ NOT NULL DEFAULT now())`;
  klarTabeller = true;
}

/** Fejl til "Fejl i panelet" og dagvagten. Uden adresser (loggen gemmes laengere end sagerne), og den samme hoejst én gang i timen. */
async function logFejl(tekst) {
  if (!sql) return;
  const d = ('[support] ' + String(tekst || '')).replace(/[^\s<>@"]+@[^\s<>@"]+/g, '[adresse]').slice(0, 300);
  try { await opret(); await sql`INSERT INTO vh_log (hvad, detalje, hvem) SELECT 'FEJL', ${d}::text, 'postkasse'
    WHERE NOT EXISTS (SELECT 1 FROM vh_log WHERE hvad = 'FEJL' AND detalje = ${d}::text AND hvornaar > now() - interval '1 hour')`; } catch (e) {}
}
const fejltekst = e => String(e && e.message || e).replace(/[^\s<>@"]+@[^\s<>@"]+/g, '[adresse]').slice(0, 200);

/* ── afsendelse ─────────────────────────────────────────────────────── */
const tilKunde = () => ({ name: S.afsender, address: postkasse() });
const tilTeam = () => ({ name: S.afsender + ' support', address: postkasse() });
/** Mails til teamet: et ordentligt autosvar svarer ikke paa Auto-Submitted, og X-UZ-Sag goer dem genkendelige. */
const teamHeadere = id => ({ [HEADER]: String(id || 0), 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' });
async function sendTeam(sag, til, emne, tekst) {
  const r = await mail.afsted({ fra: tilTeam(), til, svarTil: postkasse(), emne, tekst, headers: teamHeadere(sag && sag.id), messageId: nyId(sag ? sag.id : 0) });
  if (sag) await sql`UPDATE vh_sager SET til_team = now() WHERE id = ${sag.id}`;
  return r;
}

/* ── sager ──────────────────────────────────────────────────────────── */
async function hentSag(id) { return id ? (await sql`SELECT * FROM vh_sager WHERE id = ${id}`)[0] || null : null; }

async function gemInd(sag, b) {
  const r = await sql`INSERT INTO vh_sag_beskeder (sag, retning, fra, emne, tekst, bilag, kilde_id)
    VALUES (${sag.id}, 'ind', ${b.fra || ''}, ${b.emne || ''}, ${b.tekst || ''}, ${b.bilag || ''}, ${b.kildeId || ''})
    ON CONFLICT DO NOTHING RETURNING *`;
  await sql`UPDATE vh_sager SET sidst = now() WHERE id = ${sag.id}`;
  return r[0] || null;
}

/** Kvittering til kunden paa en ny sag: aldrig til teamet eller os selv, og hoejst én pr. adresse pr. doegn. */
async function kvitter(sag, b) {
  const til = String(sag.email || '').toLowerCase();
  if (!gyldig(til) || svarere().includes(til) || egne().includes(til)) return { sendt: false, grund: 'teamets eller vores egen adresse' };
  // kravet tages i databasen foer afsendelsen, saa to koersler aldrig kvitterer to gange
  const r = await sql`UPDATE vh_sager SET kvitteret = now() WHERE id = ${sag.id} AND kvitteret IS NULL
    AND NOT EXISTS (SELECT 1 FROM vh_sager s WHERE lower(s.email) = ${til} AND s.kvitteret > now() - interval '24 hours') RETURNING id`;
  if (!r.length) return { sendt: false, grund: 'allerede kvitteret inden for et døgn' };
  await mail.afsted({ fra: tilKunde(), til: sag.email, emne: S.kvittering.emne + ' ' + maerke(sag.id), tekst: S.kvittering.tekst,
    headers: { [HEADER]: String(sag.id), 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' },
    messageId: nyId(sag.id), inReplyTo: b && b.kilde_id || undefined, references: b && b.kilde_id || undefined });
  return { sendt: true };
}

/**
 * Sender én kundebesked til teamet paa dansk. Kan kaldes igen: kun den, der tager raekken (venter, eller
 * haengt i over 3 minutter), goer noget. Foerste besked i en ny sag giver ogsaa kunden en kvittering.
 * Fejler oversaettelsen, proeves igen ved naeste koersel; tredje gang sendes den uoversat med grunden.
 * o.slut: tidspunkt (ms), hvor oversaettelsen senest skal vaere faerdig.
 */
async function videresend(id, o) {
  o = o || {};
  const [b] = await sql`UPDATE vh_sag_beskeder SET status = 'i gang', forsoeg = forsoeg + 1, opdateret = now()
    WHERE id = ${id} AND retning = 'ind' AND (status = 'venter' OR (status = 'i gang' AND opdateret < now() - interval '3 minutes'))
    RETURNING *`;
  if (!b) return { sprunget: true };
  const sag = await hentSag(b.sag);
  const [{ foerste }] = await sql`SELECT min(id) AS foerste FROM vh_sag_beskeder WHERE sag = ${b.sag} AND retning = 'ind'`;
  const ny = Number(foerste) === Number(b.id);
  if (ny && !sag.kvitteret) {
    try { await kvitter(sag, b); } catch (e) { await logFejl('Kvitteringen til kunden i sag ' + sagsnavn(sag.id) + ' kunne ikke sendes: ' + fejltekst(e)); }
  }

  const frist = Math.max(2500, (o.slut || Date.now() + 15000) - Date.now());
  const lang = b.tekst.length > MAKS_TEGN;
  const emneDe = renEmne(sag.emne_de);
  let da = '', emneDa = sag.emne_da || '', grund = '';
  try {
    const [t, e] = await Promise.all([
      oversaet(lang ? b.tekst.slice(0, MAKS_TEGN) : b.tekst, IND, { frist }),
      !emneDa && emneDe ? oversaet(emneDe, IND, { frist, emne: true }) : Promise.resolve(emneDa)]);
    da = t; emneDa = e || '';
  } catch (e) {
    grund = fejltekst(e);
    if (b.forsoeg < FORSOEG) {
      await sql`UPDATE vh_sag_beskeder SET status = 'venter', fejl = ${grund}, opdateret = now() WHERE id = ${b.id}`;
      return { udsat: true, grund };
    }
    emneDa = '';
  }

  const tidligere = await sql`SELECT sendt_id FROM vh_sag_beskeder WHERE sag = ${sag.id} AND retning = 'ind' AND sendt_id <> '' AND id <> ${b.id} ORDER BY id`;
  const tidl = tidligere.map(x => x.sendt_id).slice(-10);
  const kilde = sag.kilde === 'formular' ? 'kontaktformularen på ' + profil.navn : 'mail til ' + postkasse();
  const bilag = b.bilag ? '\nKunden har vedhæftet: ' + b.bilag + '. Filerne er ikke sendt med her; de ligger i support-postkassen.\n' : '';
  const tekst = 'Ny besked i sag ' + sagsnavn(sag.id) + ' fra ' + hvem(sag.navn, sag.email) + '\n' +
    (ny ? 'Ny sag, kom via ' + kilde + '.' : 'Opfølgning i en sag, der startede ' + new Date(sag.oprettet).toLocaleDateString('da-DK', { timeZone: K.TZ, day: 'numeric', month: 'short' }) + '.') + '\n\n' +
    (grund ? 'OVERSÆTTELSEN FEJLEDE ' + FORSOEG + ' GANGE (' + grund + '). Her er kun den tyske original.\n'
      : 'Oversat til dansk' + (emneDa ? ' (emne: ' + emneDa + ')' : '') + ':\n\n' + (da || '(ingen tekst)') + '\n' +
        (lang ? '\n(Beskeden er lang, så kun de første ' + MAKS_TEGN + ' tegn er oversat. Hele originalen står nedenfor.)\n' : '')) +
    '\n' + STREG + '\nOriginal på tysk\nEmne: ' + (b.emne || '(intet emne)') + '\n\n' + (b.tekst || '(ingen tekst)') + '\n' + STREG + '\n' + bilag +
    '\nSvar på dansk på denne mail, så får kunden dit svar oversat til tysk fra ' + postkasse() + '. Lad ' + maerke(sag.id) + ' stå i emnet.\n';
  const emne = maerke(sag.id) + ' ' + (grund ? '(ikke oversat) ' + (emneDe || '(intet emne)') : (emneDa || emneDe || '(intet emne)'));
  const relay = nyId(sag.id);
  try {
    await mail.afsted({ fra: tilTeam(), til: team(), svarTil: postkasse(), emne, tekst, headers: teamHeadere(sag.id), messageId: relay,
      inReplyTo: tidl[tidl.length - 1] || undefined, references: tidl.length ? tidl : undefined });
  } catch (e) {
    const s = b.forsoeg < SMTP_FORSOEG ? 'venter' : 'fejl';
    await sql`UPDATE vh_sag_beskeder SET status = ${s}, fejl = ${fejltekst(e)}, opdateret = now() WHERE id = ${b.id}`;
    await logFejl('Sag ' + sagsnavn(sag.id) + ' kunne ikke sendes til teamet' + (s === 'fejl' ? ', opgivet efter ' + SMTP_FORSOEG + ' forsøg' : '') + ': ' + fejltekst(e));
    return { fejl: fejltekst(e) };
  }
  await sql`UPDATE vh_sag_beskeder SET status = 'sendt', oversat = ${da}, sendt_id = ${relay}, fejl = ${grund}, opdateret = now() WHERE id = ${b.id}`;
  await sql`UPDATE vh_sager SET til_team = now(), sidst = now(), emne_da = CASE WHEN emne_da = '' THEN ${emneDa} ELSE emne_da END WHERE id = ${sag.id}`;
  if (grund) await logFejl('Sag ' + sagsnavn(sag.id) + ' blev sendt til teamet uden oversættelse: ' + grund);
  await log('support', 'Sag ' + sagsnavn(sag.id) + ': ' + (ny ? 'ny sag' : 'ny besked fra kunden') + ' sendt til teamet' + (grund ? ', uoversat' : ''), 'postkasse');
  return { sendt: true, sag: sag.id };
}

/** Beskeder, der venter paa at komme til teamet (fra formularen, eller oversaettelsen fejlede sidst). */
async function ventende(n) {
  return (await sql`SELECT id FROM vh_sag_beskeder WHERE retning = 'ind'
    AND (status = 'venter' OR (status = 'i gang' AND opdateret < now() - interval '3 minutes')) ORDER BY id LIMIT ${n || 3}`).map(r => r.id);
}

/**
 * En mail fra en kunde: finder sagen (nummeret i emnet, eller In-Reply-To/References), med samme
 * kundeadresse, ellers en ny sag. Gemmer beskeden. Selve videresendelsen er videresend().
 */
async function kundeMail(m) {
  if (m.messageId) {
    const [g] = await sql`SELECT id, sag FROM vh_sag_beskeder WHERE kilde_id = ${m.messageId}`;
    if (g) return { hvad: 'kunde', sag: g.sag, besked: g.id, ny: false };
  }
  const adr = String(m.svarTil || m.fra || '').toLowerCase();
  const mine = [m.fra, m.svarTil].filter(Boolean).map(x => String(x).toLowerCase());
  const passer = s => s && mine.includes(String(s.email).toLowerCase());
  let sag = null;
  const nr = tokenI(m.emne) || idFraHeadere(m);
  if (nr) { const s = await hentSag(nr); if (passer(s)) sag = s; }
  if (!sag) for (const ref of [m.inReplyTo, ...(m.references || [])].filter(Boolean).slice(-10).reverse()) {
    const [s] = await sql`SELECT s.* FROM vh_sag_beskeder b JOIN vh_sager s ON s.id = b.sag WHERE b.kilde_id = ${ref} OR b.sendt_id = ${ref} LIMIT 1`;
    if (passer(s)) { sag = s; break; }
  }
  const ny = !sag;
  if (!sag) [sag] = await sql`INSERT INTO vh_sager (email, navn, emne_de, kilde) VALUES (${adr}, ${String(m.fraNavn || '').slice(0, 120)}, ${renEmne(m.emne).slice(0, 300)}, 'mail') RETURNING *`;
  const b = await gemInd(sag, { fra: String(m.fra || '').toLowerCase(), emne: String(m.emne || '').slice(0, 300),
    tekst: (nyTekst(m.tekst) || String(m.tekst || '').trim()).slice(0, 50000), bilag: (m.bilag || []).join(', ').slice(0, 500), kildeId: m.messageId || '' });
  return { hvad: 'kunde', sag: sag.id, besked: b && b.id, ny };
}

/** Kontaktformularen: altid en ny sag. Proever at sende den med det samme; ellers tager postkassen den. */
async function fraFormular(f, o) {
  await tabeller();
  const [sag] = await sql`INSERT INTO vh_sager (email, navn, emne_de, kilde)
    VALUES (${String(f.email).toLowerCase()}, ${f.navn || ''}, ${renEmne(f.emne)}, 'formular') RETURNING *`;
  const b = await gemInd(sag, { fra: String(f.email).toLowerCase(), emne: f.emne || '', tekst: f.besked || '' });
  let r = {};
  try { r = await videresend(b.id, o); }
  catch (e) {
    await sql`UPDATE vh_sag_beskeder SET status = 'venter', opdateret = now() WHERE id = ${b.id} AND status = 'i gang'`.catch(() => {});
    await logFejl('Sag ' + sagsnavn(sag.id) + ' fra formularen venter på postkassen: ' + fejltekst(e));
  }
  return { sag: sag.id, ...r };
}

/* ── teamets svar ───────────────────────────────────────────────────── */
async function vejled(m, slags, sag) {
  const fra = String(m.fra || '').toLowerCase();
  const nu = K.dansk();
  // hoejst én vejledning pr. adresse i timen, saa et autosvar uden headere ikke kan starte en sloejfe
  if (!(await K.foersteGang('postkasse-vejledning', fra + ' ' + nu.dato + ' ' + nu.time))) return;
  const emne = String(m.emne || '').slice(0, 120);
  const grund = slags === 'tom' ? 'fordi vi ikke kunne finde ny tekst i den, kun citater af tidligere mails. Skriv dit svar øverst i mailen.'
    : slags === 'ukendt' ? 'fordi sag ' + sagsnavn(sag) + ' ikke findes. Sager slettes ' + DAGE + ' dage efter sidste besked.'
    : 'fordi den ikke har et sagsnummer som ' + maerke(12) + ' i emnet, så vi kan ikke se, hvilken kunde den skal til.';
  const tekst = 'Intet sendt. Din mail til ' + postkasse() + (emne ? ' med emnet "' + emne + '"' : '') + ' er ikke sendt til nogen kunde, ' + grund + '\n\n' +
    'Svar i stedet direkte på den mail, der kom med kundens besked, og lad sagsnummeret stå i emnet. Så oversættes dit svar til tysk og sendes til kunden.\n';
  const s = slags === 'tom' ? await hentSag(sag) : null;
  try { await sendTeam(s, [fra], (s ? maerke(s.id) + ' ' : '') + 'Intet sendt: ' + (slags === 'tom' ? 'tomt svar' : slags === 'ukendt' ? 'sagen findes ikke' : 'mangler sagsnummer'), tekst); }
  catch (e) { await logFejl('Vejledning til teamet kunne ikke sendes: ' + fejltekst(e)); }
}

async function ikkeSendt(sag, m, ny, grund) {
  const til = [...new Set([...team(), String(m.fra).toLowerCase()])];
  const tekst = 'Intet sendt i sag ' + sagsnavn(sag.id) + '. Kunden (' + hvem(sag.navn, sag.email) + ') har ikke fået dit svar.\n' +
    'Grund: ' + grund + '\n\nRet det, og svar igen på kundens mail med ' + maerke(sag.id) + ' i emnet. Dit svar var:\n\n' + ny + '\n';
  try { await sendTeam(sag, til, maerke(sag.id) + ' IKKE sendt til kunden: ' + (sag.emne_da || renEmne(sag.emne_de) || '(intet emne)'), tekst); }
  catch (e) { await logFejl('Besked om at sag ' + sagsnavn(sag.id) + ' ikke blev sendt, kunne heller ikke sendes: ' + fejltekst(e)); }
  await logFejl('Svar i sag ' + sagsnavn(sag.id) + ' blev ikke sendt til kunden: ' + grund);
}

const datoKunde = t => new Date(t).toLocaleString(S.datoSprog, { timeZone: S.tidszone, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Et svar fra teamet: sagen findes ud fra nummeret i emnet, vores Message-ID i In-Reply-To/References,
 * eller nummeret i teksten. Kun teamets nye tekst oversaettes. Fejler oversaettelse eller afsendelse,
 * faar kunden intet, og teamet faar at vide hvorfor. Lykkes det, faar teamet den tyske tekst.
 */
async function teamSvar(m, o) {
  o = o || {};
  const fra = String(m.fra || '').toLowerCase();
  const nr = tokenI(m.emne) || idFraHeadere(m) || tokenI(m.tekst);
  if (!nr) { await vejled(m, 'uden'); await log('support', 'Mail fra teamet uden sagsnummer, intet sendt', 'postkasse'); return { hvad: 'uden-sag' }; }
  const sag = await hentSag(nr);
  if (!sag) { await vejled(m, 'ukendt', nr); await log('support', 'Svar til sag ' + sagsnavn(nr) + ', som ikke findes, intet sendt', 'postkasse'); return { hvad: 'uden-sag' }; }
  // et autosvar uden headere kommer sekunder efter vores mail. Et menneske kan ikke laese og svare saa hurtigt.
  // Der maales fra den videresendelse, der svares paa, hvis vi kender den, ellers fra vores seneste mail i sagen,
  // saa et svar paa en aeldre mail ikke fanges, fordi en ny lige er sendt.
  let ref = sag.til_team;
  if (m.inReplyTo) { const [x] = await sql`SELECT opdateret FROM vh_sag_beskeder WHERE sendt_id = ${m.inReplyTo} AND retning = 'ind'`; if (x) ref = x.opdateret; }
  if (ref && m.modtaget) {
    const d = new Date(m.modtaget).getTime() - new Date(ref).getTime();
    if (d > -30000 && d < HURTIG) {
      await log('support', 'Sag ' + sagsnavn(sag.id) + ': mail fra teamet ' + Math.round(d / 1000) + ' sek. efter vores mail ignoreret (ligner autosvar)', 'postkasse');
      return { hvad: 'hurtig', sag: sag.id };
    }
  }
  const ny = nyTekst(m.tekst);
  if (!ny) { await vejled(m, 'tom', sag.id); return { hvad: 'team', sag: sag.id, sendt: false }; }

  // raekken tages foer noget sendes. Findes den allerede (en afbrudt koersel), sendes der aldrig to gange.
  const kid = m.messageId || '';
  let [r] = await sql`INSERT INTO vh_sag_beskeder (sag, retning, fra, emne, tekst, kilde_id, status)
    VALUES (${sag.id}, 'ud', ${fra}, ${String(m.emne || '').slice(0, 300)}, ${ny.slice(0, 50000)}, ${kid}, 'oversaetter') ON CONFLICT DO NOTHING RETURNING *`;
  if (!r) {
    const [g] = await sql`SELECT * FROM vh_sag_beskeder WHERE kilde_id = ${kid}`;
    if (!g || g.status !== 'oversaetter') {
      if (g && g.status === 'sender') {
        await sql`UPDATE vh_sag_beskeder SET status = 'uvist', opdateret = now() WHERE id = ${g.id}`;
        await ikkeSendt(sag, m, ny, 'Vi kan ikke se, om svaret nåede ud, fordi afsendelsen blev afbrudt. Tjek support-postkassens sendte post, før du sender igen');
      }
      return { hvad: 'team', sag: sag.id, gentaget: true };
    }
    r = g;
  }

  let de;
  try { de = await oversaet(ny, UD, { frist: Math.max(2500, (o.slut || Date.now() + 15000) - Date.now()) }); }
  catch (e) {
    await sql`UPDATE vh_sag_beskeder SET status = 'fejl', fejl = ${fejltekst(e)}, opdateret = now() WHERE id = ${r.id}`;
    await ikkeSendt(sag, m, ny, fejltekst(e));
    return { hvad: 'team', sag: sag.id, sendt: false };
  }

  const sidste = (await sql`SELECT * FROM vh_sag_beskeder WHERE sag = ${sag.id} AND retning = 'ind' ORDER BY id DESC LIMIT 1`)[0];
  const traad = (await sql`SELECT retning, kilde_id, sendt_id FROM vh_sag_beskeder WHERE sag = ${sag.id} AND status = 'sendt' ORDER BY id`)
    .map(x => x.retning === 'ind' ? x.kilde_id : x.sendt_id).filter(Boolean).slice(-10);
  const citat = sidste ? (nyTekst(sidste.tekst) || sidste.tekst).split('\n').map(x => '> ' + x).join('\n') : '';
  const krop = de + (citat ? '\n\n' + S.citat(datoKunde(sidste.ts), hvem(sag.navn, sag.email)) + '\n' + citat : '') + '\n';
  const emne = S.svarEmne + (renEmne(sag.emne_de) || S.udenEmne) + ' ' + maerke(sag.id);
  const ud = nyId(sag.id);
  await sql`UPDATE vh_sag_beskeder SET status = 'sender', oversat = ${de}, opdateret = now() WHERE id = ${r.id}`;
  try {
    await mail.afsted({ fra: tilKunde(), til: sag.email, emne, tekst: krop, headers: { [HEADER]: String(sag.id) }, messageId: ud,
      inReplyTo: sidste && sidste.kilde_id || undefined, references: traad.length ? traad : undefined });
  } catch (e) {
    await sql`UPDATE vh_sag_beskeder SET status = 'fejl', fejl = ${fejltekst(e)}, opdateret = now() WHERE id = ${r.id}`;
    await ikkeSendt(sag, m, ny, 'Mailen til kunden kunne ikke sendes (' + fejltekst(e) + ')');
    return { hvad: 'team', sag: sag.id, sendt: false };
  }
  await sql`UPDATE vh_sag_beskeder SET status = 'sendt', sendt_id = ${ud}, opdateret = now() WHERE id = ${r.id}`;
  await sql`UPDATE vh_sager SET sidst = now() WHERE id = ${sag.id}`;
  await log('support', 'Sag ' + sagsnavn(sag.id) + ': svar sendt til kunden på tysk', 'postkasse');

  const til = [...new Set([...team(), fra])];
  const bilag = (m.bilag || []).length ? '\nDine vedhæftede filer kom ikke med til kunden. Send dem fra support-postkassen, hvis kunden skal have dem.\n' : '';
  const tekst = 'Sendt til kunden i sag ' + sagsnavn(sag.id) + ': ' + hvem(sag.navn, sag.email) + '\nEmne: ' + emne + '\n\n' +
    'Her er mailen, præcis som kunden fik den:\n\n' + STREG + '\n' + krop + STREG + '\n\nDit svar på dansk:\n\n' + ny + '\n' + bilag;
  try { await sendTeam(sag, til, maerke(sag.id) + ' Sendt til kunden: ' + (sag.emne_da || renEmne(sag.emne_de) || '(intet emne)'), tekst); }
  catch (e) { await logFejl('Kvitteringen til teamet i sag ' + sagsnavn(sag.id) + ' kunne ikke sendes: ' + fejltekst(e)); }
  return { hvad: 'team', sag: sag.id, sendt: true };
}

module.exports = { klar, status, mangler, tabeller, klassificer, erAuto, kundeMail, videresend, ventende, teamSvar, fraFormular,
  nyTekst, renEmne, tokenI, logFejl, team, svarere, postkasse, DAGE };
