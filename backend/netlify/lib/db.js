'use strict';
/**
 * Én forbindelse og ét sted, hvor tabellerne oprettes.
 *
 * Ejermaerke: tabellen vh_side siger, hvilken backend (dk eller de, se side.js) databasen tilhoerer,
 * saa den tyske backend aldrig skriver i den danske database, heller ikke hvis DATABASE_URL er
 * sat forkert. Foer den foerste forespoergsel efter en kold start tjekkes maerket én gang:
 *   maerket passer med profilen     ok
 *   maerket er en anden profils     afvist
 *   intet maerke                    dk maa tage den (den danske database havde data foer maerket),
 *                                   de kun en database helt uden vh_-tabeller
 * Afvist betyder, at ingen forespoergsel koerer, og alle kald fejler med en tydelig dansk besked.
 * Tjekket sidder i sql selv, saa alle veje ind er daekket: opret(), taellerens egen tabel(), og
 * handlere, der spoerger uden opret(). sql bruges som tagged template eller, hvor tabelnavnet skal kunne
 * skiftes (lib/sessioner.js), som sql(tekst, parametre), som Neon ogsaa tager imod. Svaret er et
 * almindeligt promise, saa alle steder virker uaendret.
 */
const { neon } = require('@neondatabase/serverless');
const profil = require('./side.js');
const raa = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

let tjek = null;     // promise: maerket er i orden (huskes, til funktionen er kold igen)
let afvist = null;   // fejlen, naar databasen ikke maa bruges. Huskes ogsaa.
function afvis(tekst) { const e = new Error(tekst); e.code = 'VH_SIDE'; afvist = e; return e; }

async function ejermaerke() {
  if (profil.ugyldig) throw afvis(profil.ugyldig);
  // koerer funktionen paa den anden backends Netlify-site, er SIDE glemt eller forkert
  const vaert = profil.netlifySite();
  if (vaert && vaert === profil.anden.backendSiteId) throw afvis('Denne backend kører på Netlify-sitet til ' + profil.anden.navn +
    ', men SIDE står til ' + profil.kode + '. Sæt SIDE=' + profil.anden.kode + ' i Netlify og udgiv igen. Databasen bruges ikke imens.');
  const tabeller = (await raa`SELECT table_name AS t FROM information_schema.tables
    WHERE left(table_name, 3) = 'vh_' AND table_schema NOT IN ('pg_catalog', 'information_schema')`).map(r => r.t);
  const koder = async () => [...new Set((await raa`SELECT kode FROM vh_side`).map(r => r.kode))];
  let k = tabeller.includes('vh_side') ? await koder() : [];
  if (!k.length) {
    if (!profil.overtagData && tabeller.some(t => t !== 'vh_side')) throw afvis('Databasen har allerede tabeller fra en anden backend, men intet ejermærke. ' +
      'Den ' + profil.ental + ' backend tager kun en tom database i brug. Ret DATABASE_URL på det ' + profil.ental + ' site.');
    // én raekke, aldrig to: det unikke indeks paa en konstant goer, at kun den foerste kan saette maerket
    await raa`CREATE TABLE IF NOT EXISTS vh_side (kode TEXT NOT NULL)`;
    await raa`CREATE UNIQUE INDEX IF NOT EXISTS vh_side_en ON vh_side ((true))`;
    await raa`INSERT INTO vh_side (kode) VALUES (${profil.kode}) ON CONFLICT DO NOTHING`;
    k = await koder();
  }
  if (k.length === 1 && k[0] === profil.kode) return true;
  if (k.length === 1 && k[0] === profil.anden.kode) throw afvis('Databasen tilhører den ' + profil.anden.ental + ' backend. Ret DATABASE_URL på det ' + profil.ental + ' site.');
  throw afvis('Databasen er mærket "' + k.join(', ').slice(0, 40) + '", som ikke passer med denne backend (' + profil.kode + '). Ret DATABASE_URL på det ' + profil.ental + ' site.');
}
/** Venter paa ejermaerket. En fejl paa vejen (fx netvaerket) huskes ikke, saa naeste kald proever igen. */
function klar() {
  if (afvist) return Promise.reject(afvist);
  if (!tjek) tjek = ejermaerke().catch(e => { tjek = null; throw e; });
  return tjek;
}
const sql = raa ? (strenge, ...v) => klar().then(() => raa(strenge, ...v)) : null;

/** Til status: ok er false, naar databasen mangler eller er afvist. fejl er en kort dansk tekst uden hemmeligheder. */
async function dbStatus() {
  if (!raa) return { ok: false, fejl: null };
  try { await klar(); return { ok: true, fejl: null }; }
  catch (e) { return e.code === 'VH_SIDE' ? { ok: false, fejl: e.message } : { ok: true, fejl: 'Databasen svarede ikke, da panelet spurgte. Prøv igen om lidt.' }; }
}
let klarTabeller = false;

async function opret() {
  if (klarTabeller || !sql) return;
  await sql`CREATE TABLE IF NOT EXISTS vh_indhold (
    noegle TEXT PRIMARY KEY, vaerdi TEXT NOT NULL DEFAULT '',
    side TEXT NOT NULL DEFAULT '', beskrivelse TEXT NOT NULL DEFAULT '',
    opdateret TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS vh_blog (
    id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, titel TEXT NOT NULL DEFAULT '',
    resume TEXT NOT NULL DEFAULT '', brod TEXT NOT NULL DEFAULT '',
    billede TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'kladde',
    kilde TEXT NOT NULL DEFAULT 'panel', udgivet TIMESTAMPTZ,
    oprettet TIMESTAMPTZ NOT NULL DEFAULT now(), opdateret TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`CREATE INDEX IF NOT EXISTS vh_blog_status_idx ON vh_blog (status, udgivet DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS vh_log (
    id SERIAL PRIMARY KEY, hvad TEXT NOT NULL, detalje TEXT NOT NULL DEFAULT '',
    hvem TEXT NOT NULL DEFAULT '', hvornaar TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`ALTER TABLE vh_log ADD COLUMN IF NOT EXISTS hvem TEXT NOT NULL DEFAULT ''`;
  // noter paa kurven: "flyer uddelt", "reklame startet"
  await sql`CREATE TABLE IF NOT EXISTS vh_noter (
    id SERIAL PRIMARY KEY, dato DATE NOT NULL, tekst TEXT NOT NULL,
    oprettet TIMESTAMPTZ NOT NULL DEFAULT now())`;
  // links bygget i panelet, saa kampagner altid hedder det samme
  await sql`CREATE TABLE IF NOT EXISTS vh_links (
    id SERIAL PRIMARY KEY, navn TEXT NOT NULL, url TEXT NOT NULL,
    kilde TEXT NOT NULL DEFAULT '', medie TEXT NOT NULL DEFAULT '', kampagne TEXT NOT NULL DEFAULT '',
    indhold TEXT NOT NULL DEFAULT '', oprettet TIMESTAMPTZ NOT NULL DEFAULT now())`;
  // flere brugere med hver deres kode og rolle
  await sql`CREATE TABLE IF NOT EXISTS vh_brugere (
    id SERIAL PRIMARY KEY, navn TEXT UNIQUE NOT NULL, hash TEXT NOT NULL,
    rolle TEXT NOT NULL DEFAULT 'laeser', sidst TIMESTAMPTZ,
    oprettet TIMESTAMPTZ NOT NULL DEFAULT now())`;
  // oppetid: hvert tjek gemmes, saa man kan se historikken
  await sql`CREATE TABLE IF NOT EXISTS vh_oppetid (
    id SERIAL PRIMARY KEY, oppe BOOLEAN NOT NULL, ms INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 0, fejl TEXT NOT NULL DEFAULT '',
    hvornaar TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`CREATE INDEX IF NOT EXISTS vh_oppetid_tid_idx ON vh_oppetid (hvornaar DESC)`;
  // svar fra eksterne tjenester gemmes kort, saa panelet aabner med det samme
  await sql`CREATE TABLE IF NOT EXISTS vh_cache (
    noegle TEXT PRIMARY KEY, vaerdi JSONB NOT NULL, udloeber TIMESTAMPTZ NOT NULL)`;
  // ugens seo-gennemgang gemmes, saa panelet kan vise udviklingen
  await sql`ALTER TABLE vh_brugere ADD COLUMN IF NOT EXISTS totp TEXT NOT NULL DEFAULT ''`;
  // ejerens to-trins-hemmelighed gemmes ogsaa her, under navnet "Ejer"
  await sql`CREATE TABLE IF NOT EXISTS vh_totp (navn TEXT PRIMARY KEY, hemmelighed TEXT NOT NULL, oprettet TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS vh_hastighed (id SERIAL PRIMARY KEY, mobil INTEGER, computer INTEGER, maalt TIMESTAMPTZ NOT NULL DEFAULT now())`;
  // den egne taellers tabeller (taeller.js og hent.js opretter dem ogsaa). Her, saa en ny database ikke
  // giver fejl i panelet, foer det foerste besoeg er kommet ind.
  await sql`CREATE TABLE IF NOT EXISTS vh_besoeg (
    id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    sti TEXT NOT NULL, kilde TEXT NOT NULL DEFAULT '', kanal TEXT NOT NULL DEFAULT 'Direct',
    enhed TEXT NOT NULL DEFAULT 'desktop', land TEXT NOT NULL DEFAULT '', gaest TEXT NOT NULL,
    ikkefundet BOOLEAN NOT NULL DEFAULT false, kampagne TEXT NOT NULL DEFAULT '')`;
  await sql`CREATE INDEX IF NOT EXISTS vh_besoeg_ts ON vh_besoeg (ts)`;
  // kampagnenavnet (utm_campaign) ved besoeget, fund S64, 16. okt. 2026. Kolonnen tilfoejes kun, hvis den
  // mangler, saa tabellen, som taelleren skriver i hele tiden, ikke laases ved hver kold start.
  const kampKol = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'vh_besoeg' AND column_name = 'kampagne'`;
  if (!kampKol.length) await sql`ALTER TABLE vh_besoeg ADD COLUMN IF NOT EXISTS kampagne TEXT NOT NULL DEFAULT ''`;
  await sql`CREATE TABLE IF NOT EXISTS vh_klik (
    id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    sti TEXT NOT NULL, sted TEXT NOT NULL DEFAULT '', butik TEXT NOT NULL DEFAULT '',
    enhed TEXT NOT NULL DEFAULT 'desktop', gaest TEXT NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS vh_klik_ts ON vh_klik (ts)`;
  // den daglige opsummering af taelleren (lib/dagtal.js, fund S19). Kun optalte tal, intet gaeste-id, saa den
  // gemmes uden tidsgraense. side er profilens kode (side.js); panelet laeser kun sin egen.
  await sql`CREATE TABLE IF NOT EXISTS vh_dagtal (
    side TEXT NOT NULL, dag DATE NOT NULL, kanal TEXT NOT NULL, kilde TEXT NOT NULL DEFAULT '',
    kampagne TEXT NOT NULL DEFAULT '', landing TEXT NOT NULL DEFAULT '', enhed TEXT NOT NULL DEFAULT '',
    besoeg INTEGER NOT NULL DEFAULT 0, visninger INTEGER NOT NULL DEFAULT 0,
    tryk INTEGER NOT NULL DEFAULT 0, hent INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (side, dag, kanal, kilde, kampagne, landing, enhed))`;
  await sql`CREATE TABLE IF NOT EXISTS vh_dagtal_klik (
    side TEXT NOT NULL, dag DATE NOT NULL, sti TEXT NOT NULL DEFAULT '', sted TEXT NOT NULL DEFAULT '',
    butik TEXT NOT NULL DEFAULT '', enhed TEXT NOT NULL DEFAULT '',
    tryk INTEGER NOT NULL DEFAULT 0, personer INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (side, dag, sti, sted, butik, enhed))`;
  await sql`CREATE TABLE IF NOT EXISTS vh_dagtal_dage (
    side TEXT NOT NULL, dag DATE NOT NULL, hel BOOLEAN NOT NULL DEFAULT true, klik_hel BOOLEAN NOT NULL DEFAULT true,
    besoegende INTEGER NOT NULL DEFAULT 0, visninger INTEGER NOT NULL DEFAULT 0, besoeg INTEGER NOT NULL DEFAULT 0,
    tryk INTEGER NOT NULL DEFAULT 0, hent INTEGER NOT NULL DEFAULT 0,
    tryk_butik INTEGER NOT NULL DEFAULT 0, tryk_alle INTEGER NOT NULL DEFAULT 0, gaester_butik INTEGER NOT NULL DEFAULT 0,
    raekker INTEGER NOT NULL DEFAULT 0, lavet TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (side, dag))`;
  await sql`CREATE TABLE IF NOT EXISTS vh_seo (
    id SERIAL PRIMARY KEY, score INTEGER NOT NULL, rapport JSONB NOT NULL,
    koert TIMESTAMPTZ NOT NULL DEFAULT now())`;
  // chatbottens tabeller, kun paa en backend med sin egen bot (side.js, botEgen: den tyske). Botten opretter
  // dem ogsaa selv (ensureSchema i chatbot/netlify/functions/chat-bot.js), og de skal vaere ens. Her, saa
  // panelets Chat, Oversigt og ryd.js ikke fejler paa en ny database, foer den foerste har skrevet i chatten.
  // site faar altid bottens faste marked, saa standardvaerdien bruges aldrig. Den danske backend roeres ikke:
  // dens tabeller laves af den faelles bot.
  if (profil.botEgen) {
    await sql`CREATE TABLE IF NOT EXISTS vh_conversations (
      id TEXT PRIMARY KEY, email TEXT DEFAULT '', human BOOLEAN DEFAULT false,
      needs_human BOOLEAN DEFAULT false, alerted BOOLEAN DEFAULT false, n INT DEFAULT 0,
      seen BOOLEAN DEFAULT true, first_q TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
      mood TEXT DEFAULT '', archived BOOLEAN DEFAULT false, site TEXT DEFAULT 'dk')`;
    await sql`CREATE INDEX IF NOT EXISTS vh_conversations_site_idx ON vh_conversations (site, archived, updated_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS vh_events (
      id BIGSERIAL PRIMARY KEY, kind TEXT, label TEXT, ts TIMESTAMPTZ DEFAULT now(), site TEXT DEFAULT 'dk')`;
    await sql`CREATE TABLE IF NOT EXISTS vh_messages (
      id BIGSERIAL PRIMARY KEY, conv_id TEXT, role TEXT, content TEXT, ts TIMESTAMPTZ DEFAULT now(), da TEXT DEFAULT '')`;
    await sql`CREATE INDEX IF NOT EXISTS vh_messages_conv_idx ON vh_messages (conv_id, id)`;
    await sql`CREATE TABLE IF NOT EXISTS vh_feedback (
      id BIGSERIAL PRIMARY KEY, value INT, question TEXT DEFAULT '', answer TEXT DEFAULT '', ts TIMESTAMPTZ DEFAULT now(), site TEXT DEFAULT 'dk')`;
  }
  klarTabeller = true;
}

const log = async (hvad, detalje, hvem) => {
  if (!sql) return;
  try { await opret(); await sql`INSERT INTO vh_log (hvad, detalje, hvem)
    VALUES (${hvad}, ${detalje || ''}, ${hvem || ''})`; } catch (e) {}
};

module.exports = { sql, opret, log, dbStatus };
