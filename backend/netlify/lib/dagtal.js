'use strict';
/**
 * Daglig opsummering af den egne taeller, som gemmes uden tidsgraense. Fund S19, 16. okt. 2026.
 *
 * ryd.js sletter de raa besoeg og tryk efter 90 dage (persondata: gaeste-id). Uden en opsummering forsvinder
 * udviklingen over tid, og februar kan ikke sammenlignes med september. Derfor skriver den natlige oprydning
 * foerst, foer den sletter noget, én raekke pr. dag og gruppe med optalte tal:
 *   vh_dagtal       besoeg pr. dag, kanal, kildedomaene, kampagne, landingsside og enhed: antal besoeg,
 *                   sidevisninger, besoeg med tryk til butik og besoeg, der aabnede hent-siden (lib/sessioner.js)
 *   vh_dagtal_klik  tryk pr. dag, side, sted paa siden, butik og enhed: antal tryk og antal forskellige personer
 *   vh_dagtal_dage  én raekke pr. opsummeret dag med dagens totaler, og om dagen er hel (hel, klik_hel)
 * Kun tal. Intet gaeste-id, ingen IP-adresse, ingen browser og intet land, saa det er ikke persondata.
 *
 * Hver koersel tager de dage foer i dag, som endnu ikke er opsummeret (ogsaa dagene, der laa der, foer
 * opsummeringen kom til), aeldste foerst og hoejst MAKS_DAGE ad gangen, saa en koersel altid bliver
 * faerdig, og oprydningen i ryd.js altid kommer til. En stor bunke indhentes over et par naetter. Det er
 * ufarligt, fordi de aeldste dage, som oprydningen sletter foerst, ogsaa er dem, der opsummeres foerst.
 * En dag opsummeres én gang. Det sker i én SQL-saetning, saa en dag enten kommer helt med eller slet ikke.
 * Alle dage fra den foerste dag med tal til i gaar faar en raekke i vh_dagtal_dage, ogsaa en dag uden et
 * eneste besoeg (med nul), saa en maaned med en stille dag stadig kan vaere hel. Den foerste dag med tal er
 * ikke hel (taelleren startede midt paa dagen, eller oprydningen har allerede slettet dens foerste timer),
 * og den markeres som ikke hel.
 *
 * Persondata kommer ikke med: kilden er et domaene eller en utm_source, og en vaerdi med @ (en mailadresse,
 * som nogen selv har skrevet i adressen) gemmes som tom. Det samme gaelder kampagnen, landingssiden og
 * siden for et tryk. taeller.js gemmer heller ikke en kilde med @, men aeldre raa raekker kan have den.
 *
 * side er profilens kode (side.js). Den danske database har ogsaa de tyske besoeg fra foer 8. okt. 2026
 * (vh_besoeg_de, vh_klik_de, slettes i januar 2027). De opsummeres med side 'de', saa de ikke blandes med de
 * danske, og panelet viser kun raekker med sin egen sides kode.
 */
const { sql, opret } = require('./db.js');
const profil = require('./side.js');
const K = require('./koersel.js');
const S = require('./sessioner.js');

// hoejst saa mange dage pr. koersel og tabel. Med dagens maengder tager det under et sekund.
const MAKS_DAGE = 14;
// en tekst med @ kan vaere en mailadresse og gemmes ikke i opsummeringen, som ikke har nogen tidsgraense
const uden = (kol, erstat) => `CASE WHEN ${kol} ~ '@' THEN '${erstat}' ELSE ${kol} END`;

/** Opsummerer de dage foer idag ('YYYY-MM-DD', dansk), der mangler, fra tabellerne t, aeldste foerst og hoejst
    MAKS_DAGE. gammel: tabellerne faar ikke flere raekker, saa de slutter ved deres sidste dag med tal, og den
    sidste dag er heller ikke hel. Giver de nye dage som [{ dag, raekker }]. */
async function opsummerTabel(t, side, idag, gammel) {
  const p = S.parametre();
  const graense = p(idag + ' 00:00:00'), s = p(side), maks = p(MAKS_DAGE);
  // sidste dag i raekken: i gaar, eller for de gamle tabeller deres sidste dag med tal
  const til = gammel ? 'sidste' : `${p(idag)}::date - 1`;
  const iDage = `ts >= (SELECT a FROM spaend) AND ts < (SELECT b FROM spaend) AND (ts AT TIME ZONE 'Europe/Copenhagen')::date IN (SELECT dag FROM dage)`;
  const tekst = `WITH alleB AS (SELECT DISTINCT (ts AT TIME ZONE 'Europe/Copenhagen')::date AS dag FROM ${t.besoeg}
        WHERE ts < (${graense}::timestamp AT TIME ZONE 'Europe/Copenhagen')),
      alleK AS (SELECT DISTINCT (ts AT TIME ZONE 'Europe/Copenhagen')::date AS dag FROM ${t.klik}
        WHERE ts < (${graense}::timestamp AT TIME ZONE 'Europe/Copenhagen')),
      yder AS (SELECT (SELECT min(dag) FROM alleB) AS foerste, (SELECT min(dag) FROM alleK) AS foersteKlik,
        (SELECT max(dag) FROM (SELECT dag FROM alleB UNION SELECT dag FROM alleK) x) AS sidste),
      -- hver dag fra den foerste dag med tal til i gaar (de gamle tabeller: til deres sidste dag med tal),
      -- ogsaa dage uden besoeg. Datoregning med heltal, saa sommertid ikke spiller ind.
      raekke AS (SELECT least(foerste, foersteKlik) AS fra, ${til} AS til FROM yder),
      alle AS (SELECT fra + i AS dag FROM raekke, generate_series(0, til - fra) AS i WHERE fra IS NOT NULL AND til >= fra),
      dage AS (SELECT dag FROM (SELECT dag FROM alle EXCEPT SELECT dag FROM vh_dagtal_dage WHERE side = ${s}) x
        ORDER BY dag LIMIT ${maks}::int),
      spaend AS (SELECT (min(dag)::timestamp AT TIME ZONE 'Europe/Copenhagen') AS a,
        ((max(dag) + 1)::timestamp AT TIME ZONE 'Europe/Copenhagen') AS b FROM dage),
      ${S.sessionCte(t, p, iDage)},
      ren AS (SELECT dag, kanal, ${uden('kilde', '')} AS kilde, ${uden('kampagne', '')} AS kampagne,
          ${uden('landing', '(skjult)')} AS landing, enhed, sider, konv, hent FROM k),
      ind AS (INSERT INTO vh_dagtal (side, dag, kanal, kilde, kampagne, landing, enhed, besoeg, visninger, tryk, hent)
        SELECT ${s}, dag, kanal, kilde, kampagne, landing, enhed, count(*)::int, sum(sider)::int,
          (count(*) FILTER (WHERE konv))::int, (count(*) FILTER (WHERE hent))::int
        FROM ren GROUP BY dag, kanal, kilde, kampagne, landing, enhed
        ON CONFLICT DO NOTHING RETURNING dag),
      indKlik AS (INSERT INTO vh_dagtal_klik (side, dag, sti, sted, butik, enhed, tryk, personer)
        SELECT ${s}, (ts AT TIME ZONE 'Europe/Copenhagen')::date, ${uden('sti', '(skjult)')}, ${uden('sted', '')}, butik, enhed,
          count(*)::int, count(DISTINCT gaest)::int
        FROM ${t.klik} WHERE ${iDage}
        GROUP BY 2, 3, 4, 5, 6
        ON CONFLICT DO NOTHING RETURNING dag),
      tot AS (SELECT (ts AT TIME ZONE 'Europe/Copenhagen')::date AS dag, count(DISTINCT gaest)::int AS besoegende, count(*)::int AS visninger
        FROM r GROUP BY 1),
      ses AS (SELECT dag, count(*)::int AS besoeg, (count(*) FILTER (WHERE konv))::int AS tryk, (count(*) FILTER (WHERE hent))::int AS hent
        FROM k GROUP BY dag),
      kt AS (SELECT (ts AT TIME ZONE 'Europe/Copenhagen')::date AS dag,
          (count(*) FILTER (WHERE butik IN ('appstore','googleplay')))::int AS tryk_butik, count(*)::int AS tryk_alle,
          (count(DISTINCT gaest) FILTER (WHERE butik IN ('appstore','googleplay')))::int AS gaester_butik
        FROM ${t.klik} WHERE ${iDage} GROUP BY 1),
      antal AS (SELECT dag, count(*)::int AS n FROM ind GROUP BY dag),
      antalKlik AS (SELECT dag, count(*)::int AS n FROM indKlik GROUP BY dag)
    INSERT INTO vh_dagtal_dage (side, dag, hel, klik_hel, besoegende, visninger, besoeg, tryk, hent, tryk_butik, tryk_alle, gaester_butik, raekker)
    SELECT ${s}, d.dag,
      (y.foerste IS NOT NULL AND d.dag > y.foerste${gammel ? ' AND d.dag < y.sidste' : ''}),
      (y.foersteKlik IS NOT NULL AND d.dag > y.foersteKlik${gammel ? ' AND d.dag < y.sidste' : ''}),
      coalesce(tot.besoegende, 0), coalesce(tot.visninger, 0), coalesce(ses.besoeg, 0), coalesce(ses.tryk, 0), coalesce(ses.hent, 0),
      coalesce(kt.tryk_butik, 0), coalesce(kt.tryk_alle, 0), coalesce(kt.gaester_butik, 0),
      coalesce(antal.n, 0) + coalesce(antalKlik.n, 0)
    FROM dage d CROSS JOIN yder y
      LEFT JOIN tot ON tot.dag = d.dag LEFT JOIN ses ON ses.dag = d.dag LEFT JOIN kt ON kt.dag = d.dag
      LEFT JOIN antal ON antal.dag = d.dag LEFT JOIN antalKlik ON antalKlik.dag = d.dag
    ON CONFLICT DO NOTHING RETURNING dag::text AS dag, raekker`;
  return sql(tekst, p.liste);
}

/**
 * Opsummerer de dage, der mangler, for backendens egne tabeller og (kun paa den danske) de gamle tyske.
 * idag: dansk dato, standard i dag. Giver { egen: { dage, raekker, fra, til, mangler }, tyskFoer: ... }.
 * mangler: true, naar der var flere dage end MAKS_DAGE, saa naeste nat fortsaetter.
 * Kaster ved fejl i de egne tabeller. Fejl i de gamle tyske staar i tyskFoerFejl (ryd.js skriver den i loggen).
 * De gamle tyske raekker vises ikke i noget panel: det danske viser kun 'dk', og det tyske har sin egen
 * database. De gemmes som et arkiv over den tyske sides foerste uger (16. sept. til 8. okt. 2026).
 */
async function opsummer(idag) {
  if (!sql) return { egen: null, grund: 'ingen database' };
  await opret();
  idag = idag || K.dansk().dato;
  const sammen = l => ({ dage: l.length, raekker: l.reduce((a, x) => a + (Number(x.raekker) || 0), 0),
    fra: l.length ? l.map(x => x.dag).sort()[0] : null, til: l.length ? l.map(x => x.dag).sort().pop() : null,
    mangler: l.length >= MAKS_DAGE });
  const ud = { egen: sammen(await opsummerTabel(S.TABELLER.egen, profil.kode, idag, false)) };
  if (profil.kode === 'dk') {
    try {
      const f = await sql`SELECT to_regclass('vh_besoeg_de') IS NOT NULL AND to_regclass('vh_klik_de') IS NOT NULL AS ok`;
      if (f[0] && f[0].ok) ud.tyskFoer = sammen(await opsummerTabel(S.TABELLER.tyskFoer, 'de', idag, true));
    } catch (e) { ud.tyskFoerFejl = String(e.message || e).slice(0, 160); }
  }
  return ud;
}

module.exports = { opsummer, MAKS_DAGE };
