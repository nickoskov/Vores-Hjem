'use strict';
/**
 * Besoeg (sessioner) regnet ud fra den egne taellers raa raekker, ét sted, saa Trafik, AI-boksen og den
 * daglige opsummering (lib/dagtal.js) taeller ens. Fund S18, S19, S62 og G12, 16. okt. 2026.
 *
 * Et besoeg er sidevisninger fra samme gaest uden 30 minutters stilhed imellem (som hos Google). Gaeste-id'et
 * skifter ved dansk midnat, saa et besoeg slutter senest der. Landingssiden, kanalen, kilden, kampagnen,
 * enheden og landet er dem ved besoegets foerste side. Kanalen regnes om for gamle raekker (lib/kanal.js).
 *   konv  tryk til butik: et tryk paa en hent-knap, der sendte videre til App Store eller Google Play, fra
 *         samme gaest, mens besoeget varede eller op til 30 minutter efter.
 *   hent  aabnede hent-siden: besoeget saa hent-siden (/hent/) eller download-siden (/download, side.js foran),
 *         eller trykkede paa en knap, der sendte en computer til hent-siden. Paa computer sker installationen
 *         via QR-koden fra en telefon med et andet id, saa det er det taetteste, et computerbesoeg kommer paa
 *         en installation (fund S62).
 *
 * Bruges med sql som almindelig funktion, sql(tekst, parametre), som Neon ogsaa tager imod, fordi tabelnavnet
 * skal kunne skiftes (den danske databases gamle vh_besoeg_de). Tabelnavnene kommer kun fra TABELLER her, aldrig
 * udefra, og alle vaerdier gaar som parametre ($1, $2 ...).
 */
const K = require('./kanal.js');

// egen: backendens egne tabeller. tyskFoer: de tyske besoeg fra foer 8. okt. 2026, da den tyske side fik sin
// egen backend. De ligger kun i den danske database og har ingen kampagne-kolonne.
const TABELLER = {
  egen: { besoeg: 'vh_besoeg', klik: 'vh_klik', kampagne: true },
  tyskFoer: { besoeg: 'vh_besoeg_de', klik: 'vh_klik_de', kampagne: false }
};
// stierne, der er hent-siden eller download-siden
const HENT_STI = '^/(hent|download)(/|$)';
// tryk, der sendte en computer til hent-siden (gamle 'app'-tryk fra en computer gjorde det samme)
const TIL_HENTSIDE = "(c.butik = 'hentside' OR (c.butik = 'app' AND c.enhed = 'desktop'))";

/** En ny parameterliste. p(v) laegger v til og giver '$n'. p.liste er vaerdierne i raekkefoelge. */
function parametre() {
  const liste = [];
  const p = v => { liste.push(v); return '$' + liste.length; };
  p.liste = liste;
  return p;
}

/** Betingelse for et vindue i dansk vaegurstid. v = { a, b } som 'YYYY-MM-DD HH:MM:SS' (admin.js vindue). */
const vindueSql = (v, p) => `ts >= (${p(v.a)}::timestamp AT TIME ZONE 'Europe/Copenhagen') AND ts < (${p(v.b)}::timestamp AT TIME ZONE 'Europe/Copenhagen')`;

/**
 * CTE'erne r, n, b og k (uden WITH foran). k har én raekke pr. besoeg med: gaest, start, slut, sider, landing,
 * kanal, kilde, kampagne, enhed, land, dag (dansk dato), time, ugedag, konv og hent.
 * t: en af TABELLER. hvor: SQL-betingelse paa de raa raekker, bygget med p.
 */
function sessionCte(t, p, hvor) {
  if (!Object.values(TABELLER).includes(t)) throw new Error('sessioner: ukendt tabel');
  return `r AS (
    SELECT id, ts, sti, kilde, enhed, land, gaest, ${t.kampagne ? 'kampagne' : "''::text AS kampagne"},
      ${K.kanalSql('kanal', 'kilde', p)} AS kanal,
      CASE WHEN lag(ts) OVER w IS NULL OR ts - lag(ts) OVER w > interval '30 minutes' THEN 1 ELSE 0 END AS ny
    FROM ${t.besoeg} WHERE ${hvor}
    WINDOW w AS (PARTITION BY gaest ORDER BY ts, id)),
  n AS (SELECT *, sum(ny) OVER (PARTITION BY gaest ORDER BY ts, id) AS nr FROM r),
  b AS (SELECT gaest, nr, min(ts) AS start, max(ts) AS slut, count(*)::int AS sider,
      (array_agg(sti ORDER BY ts, id))[1] AS landing, (array_agg(kanal ORDER BY ts, id))[1] AS kanal,
      (array_agg(kilde ORDER BY ts, id))[1] AS kilde, (array_agg(kampagne ORDER BY ts, id))[1] AS kampagne,
      (array_agg(enhed ORDER BY ts, id))[1] AS enhed, (array_agg(land ORDER BY ts, id))[1] AS land,
      bool_or(sti ~ '${HENT_STI}') AS hentsti
    FROM n GROUP BY gaest, nr),
  k AS (SELECT b.*, (start AT TIME ZONE 'Europe/Copenhagen')::date AS dag,
      extract(hour FROM start AT TIME ZONE 'Europe/Copenhagen')::int AS time,
      extract(dow FROM start AT TIME ZONE 'Europe/Copenhagen')::int AS ugedag,
      EXISTS (SELECT 1 FROM ${t.klik} c WHERE c.gaest = b.gaest AND c.butik IN ('appstore','googleplay')
        AND c.ts >= b.start AND c.ts < b.slut + interval '30 minutes') AS konv,
      (hentsti OR EXISTS (SELECT 1 FROM ${t.klik} c WHERE c.gaest = b.gaest AND ${TIL_HENTSIDE}
        AND c.ts >= b.start AND c.ts < b.slut + interval '30 minutes')) AS hent
    FROM b)`;
}

module.exports = { TABELLER, HENT_STI, parametre, vindueSql, sessionCte };
