'use strict';
/** Én forbindelse og ét sted, hvor tabellerne oprettes. */
const { neon } = require('@neondatabase/serverless');
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
let klar = false;

async function opret() {
  if (klar || !sql) return;
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
  await sql`CREATE TABLE IF NOT EXISTS vh_seo (
    id SERIAL PRIMARY KEY, score INTEGER NOT NULL, rapport JSONB NOT NULL,
    koert TIMESTAMPTZ NOT NULL DEFAULT now())`;
  klar = true;
}

const log = async (hvad, detalje, hvem) => {
  if (!sql) return;
  try { await opret(); await sql`INSERT INTO vh_log (hvad, detalje, hvem)
    VALUES (${hvad}, ${detalje || ''}, ${hvem || ''})`; } catch (e) {}
};

module.exports = { sql, opret, log };
