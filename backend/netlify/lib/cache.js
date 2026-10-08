'use strict';
/**
 * Svar fra Google, Meta og butikkerne gemmes i fem minutter. Panelet aabner
 * saa med det samme, og vi rammer ikke kvoterne, selvom nogen klikker rundt.
 * Foerst i hukommelsen (varm funktion), dernaest i databasen (kold funktion).
 */
const { sql, opret } = require('./db.js');
const mem = new Map();
// levetider i millisekunder. Brug disse, naar noget skal gemmes i timer eller doegn.
const SEK = 1000, MINUT = 60 * SEK, TIME = 60 * MINUT, DOEGN = 24 * TIME;
// MIN er standardlevetiden, FEM minutter (ikke ét). 6 * 60 * MIN er altsaa 30 timer, ikke 6. Skriv 6 * TIME.
const MIN = 5 * MINUT;
// et svar, hvor en kilde fejlede, gemmes hoejst saa laenge, saa fejlen ikke staar fast som 0 eller "ingen data"
const FEJL_LEVETID = 20 * 1000;

/* Flere kopier af funktionen koerer paa samme tid. Hukommelsen i den enkelte
   kopi kan derfor ikke ryddes af "Hent friske", som kun rammer én af dem.
   Er databasen der, er den den eneste sandhed. Hukommelsen bruges kun uden database.
   UDGAVE skiftes, naar et svar aendrer form, saa gamle gemte svar ikke vises.
   u4: 6. okt. 2026, oversigt, tragt, downloads, live og uge fik ny form.
   u5: 8. okt. 2026, App Store taeller kun profilens app (side.js), og uge og chat fik nye felter. */
const UDGAVE = 'u5:';

/** Har svaret en fejl fra en kilde? Forstaar baade en liste ([...]) og et opslag ({ meta:'...' }). */
function harFejl(v) {
  if (!v || typeof v !== 'object' || !v.fejl) return false;
  if (Array.isArray(v.fejl)) return v.fejl.length > 0;
  if (typeof v.fejl === 'object') return Object.values(v.fejl).some(Boolean);
  return !!v.fejl;
}

async function husk(noegle, levetid, lav) {
  const nu = Date.now(), n = UDGAVE + noegle;
  if (sql) {
    try {
      await opret();
      const r = await sql`SELECT vaerdi FROM vh_cache WHERE noegle = ${n} AND udloeber > now()`;
      if (r[0]) return r[0].vaerdi;
    } catch (e) {}
  } else {
    const m = mem.get(n);
    if (m && m.udloeber > nu) return m.vaerdi;
  }
  const vaerdi = await lav();
  const liv = harFejl(vaerdi) ? Math.min(levetid || MIN, FEJL_LEVETID) : (levetid || MIN);
  // panelet viser hvornaar tallene er fra, saa ingen tror de er helt friske
  if (vaerdi && typeof vaerdi === 'object' && !Array.isArray(vaerdi)) vaerdi._hentet = new Date().toISOString();
  if (sql) {
    try { await sql`INSERT INTO vh_cache (noegle, vaerdi, udloeber)
      VALUES (${n}, ${JSON.stringify(vaerdi)}, ${new Date(nu + liv).toISOString()})
      ON CONFLICT (noegle) DO UPDATE SET vaerdi = EXCLUDED.vaerdi, udloeber = EXCLUDED.udloeber`;
      await sql`DELETE FROM vh_cache WHERE noegle NOT LIKE ${UDGAVE + '%'}`; } catch (e) {}
  } else mem.set(n, { vaerdi, udloeber: nu + liv });
  return vaerdi;
}
async function glem(praefiks) {
  for (const k of [...mem.keys()]) if (!praefiks || k.startsWith(UDGAVE + praefiks)) mem.delete(k);
  if (sql) { try { await sql`DELETE FROM vh_cache WHERE noegle LIKE ${UDGAVE + (praefiks||'') + '%'}`; } catch (e) {} }
}
module.exports = { husk, glem, harFejl, MIN, SEK, MINUT, TIME, DOEGN, UDGAVE, FEJL_LEVETID };
