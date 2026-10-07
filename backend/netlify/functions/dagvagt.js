'use strict';
/**
 * Dagvagt. Koerer hver morgen og tjekker, om der overhovedet blev maalt noget
 * i gaar. Nul sidevisninger paa en hel dag betyder naesten altid, at
 * maalingen er roeget, fx fordi koden forsvandt ved en udgivelse. Det
 * opdager ingen ellers, foer nogen undrer sig over tallene uger senere.
 *
 * Der er to maalinger, og de ser forskellige ting:
 *   egen taeller (vh_besoeg)  alle besoegende, uden cookies. Den vigtigste.
 *   Google Analytics          kun dem, der siger ja til cookies (typisk hver
 *                             tredje til tiende), og gaarsdagens tal er
 *                             foreloebige klokken ni om morgenen.
 * En dag med 0 i Google kan derfor godt vaere en dag, hvor ingen sagde ja.
 * Google-alarmen kraever to dage i traek med 0, mens egen taeller saa mindst 20.
 *
 * Netlify starter af og til vagten to-tre gange samme morgen. Laasen i
 * vh_koersel goer, at kun den foerste koersel maaler og skriver.
 */
const G = require('../lib/google.js');
const mail = require('../lib/mail.js');
const K = require('../lib/koersel.js');
const { sql, opret, log } = require('../lib/db.js');

/* egen taeller for to danske kalenderdage */
async function egenTal(igaar, forgaars) {
  if (!sql) return { fejl: 'ingen database' };
  try {
    const r = await sql`SELECT ((ts AT TIME ZONE 'Europe/Copenhagen')::date)::text AS dato, count(*)::int AS visninger, count(DISTINCT gaest)::int AS besoegende
      FROM vh_besoeg WHERE (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${forgaars}::date AND ${igaar}::date GROUP BY 1`;
    const dag = d => r.find(x => x.dato === d) || { visninger: 0, besoegende: 0 };
    return { igaar: dag(igaar), forgaars: dag(forgaars) };
  } catch (e) { return { fejl: String(e.message || e).slice(0, 160) }; }
}

/* Google Analytics for de samme to dage. Google udelader dage uden data, de er 0. */
async function gaTal(igaar, forgaars) {
  if (!G.opsat()) return { ikkeOpsat: true };
  try {
    const r = await G.rapport({ dateRanges: [{ startDate: forgaars, endDate: igaar }], dimensions: [{ name: 'date' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }] });
    const raekker = G.raekker(r);
    const dag = d => { const x = raekker.find(y => y.date === d.replace(/-/g, '')) || {};
      return { visninger: x.screenPageViews || 0, besoegende: x.activeUsers || 0 }; };
    return { igaar: dag(igaar), forgaars: dag(forgaars) };
  } catch (e) { return { fejl: String(e.message || e).slice(0, 200) }; }
}

/* Sidehastighed. Mobil og computer maales samtidig, saa vagten holder sig under Netlifys
   30 sekunder. Hver enhed maales tre gange hos Google, og vi gemmer den midterste af de
   vellykkede (ved to: den laveste, ikke den hoejeste). En koersel uden score er en fejl, ikke 0. */
const midt = v => {
  if (!v) return null;
  const l = (Array.isArray(v.maalinger) && v.maalinger.length ? v.maalinger : [v.score])
    .map(Number).filter(x => x > 0).sort((a, b) => a - b);
  return l.length ? l[Math.floor((l.length - 1) / 2)] : null;
};
async function maalHastighed() {
  const url = process.env.VAGT_URL || 'https://www.voreshjem.dk/';
  const r = await Promise.allSettled([G.hastighed(url, 'mobile'), G.hastighed(url, 'desktop')]);
  const v = x => x.status === 'fulfilled' ? x.value : null;
  const grund = x => x.status === 'rejected' ? String((x.reason || {}).message || x.reason).slice(0, 120) : 'ingen score';
  const m = v(r[0]), c = v(r[1]);
  return { mobil: midt(m), computer: midt(c), lcp: m ? m.lcp : null,
           fejl: midt(m) == null ? 'mobil: ' + grund(r[0]) : '' };
}

const median = l => { const s = l.slice().sort((a, b) => a - b); const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const tal = n => (Number(n) || 0).toLocaleString('da-DK');

exports.handler = async () => {
  const nu = K.dansk();
  if (!(await K.foersteGang('dagvagt', nu.dato))) {
    return { statusCode: 200, body: 'dagvagten har allerede koert i dag (' + nu.dato + ')' };
  }
  if (sql) { try { await opret(); } catch (e) {} }
  const igaar = K.plusDage(nu.dato, -1), forgaars = K.plusDage(nu.dato, -2);

  // hastigheden tager 15-25 sekunder og startes foerst, men alarmen om maalingen skrives uden at vente paa den
  const hastP = Promise.race([maalHastighed(),
    new Promise(ok => setTimeout(() => ok({ mobil: null, computer: null, lcp: null, fejl: 'PageSpeed svarede ikke inden 25 sekunder' }), 25000))]);
  const [egen, ga] = await Promise.all([egenTal(igaar, forgaars), gaTal(igaar, forgaars)]);

  /* ── 1. maaler vi overhovedet noget ──────────────────────────────────── */
  const gaTekst = ga.ikkeOpsat ? 'Google Analytics er ikke sat op'
    : ga.fejl ? 'Google Analytics svarede ikke'
    : 'Google Analytics (foreløbigt, kun cookie-ja): ' + tal(ga.igaar.visninger) + ' sidevisninger, ' + tal(ga.igaar.besoegende) + ' besøgende';
  const egenTekst = egen.fejl ? 'egen tæller kunne ikke læses (' + egen.fejl + ')'
    : 'egen tæller: ' + tal(egen.igaar.visninger) + ' sidevisninger, ' + tal(egen.igaar.besoegende) + ' besøgende';
  let alarm = false;

  if (!egen.fejl && egen.igaar.visninger === 0) {
    alarm = true;
    await log('EGEN TÆLLER MÅLTE INTET', K.kortDato(igaar) + ': ' + gaTekst, 'dagvagt');
    await mail.send('voreshjem.dk: egen tæller målte ingenting i går',
      `<p><b>Den egne besøgstæller registrerede nul sidevisninger på voreshjem.dk i går (${K.kortDato(igaar)}).</b></p>
       <p>${gaTekst}.</p>
       <p>Tælleren sidder i hentknap.js, som voreshjem.dk henter fra voreshjem-bot.netlify.app. Tjek at siden stadig henter den,
       og at backend.voreshjem.dk/t svarer. Er siden selv nede, har oppetidsvagten skrevet for sig.</p>`).catch(() => {});
  }

  if (egen.fejl) {
    alarm = true;
    await log('dagvagt: egen tæller kunne ikke læses', egen.fejl, 'dagvagt');
  }

  if (ga.fejl) {
    alarm = true;
    await log('dagvagt: kunne ikke spørge Google', ga.fejl, 'dagvagt');
    await mail.send('Backenden kan ikke læse Google Analytics',
      `<p>Dagvagten kunne ikke hente gårsdagens tal fra Google Analytics.</p><p>Fejl: ${ga.fejl}</p>
       <p>Typisk er nøglen udløbet, eller servicekontoen har mistet adgang. Den egne tæller virker uafhængigt af det (${egenTekst}).</p>`).catch(() => {});
  } else if (!ga.ikkeOpsat && !egen.fejl && ga.igaar.visninger === 0 && ga.forgaars.visninger === 0
             && egen.igaar.visninger + egen.forgaars.visninger >= 20) {
    // to dage med 0 hos Google, mens egen taeller saa mange, kan ikke forklares med cookie-nej alene
    alarm = true;
    const n = egen.igaar.visninger + egen.forgaars.visninger;
    await log('GOOGLE ANALYTICS MÅLTE INTET', 'to dage med 0 hos Google, egen tæller så ' + n + ' sidevisninger', 'dagvagt');
    await mail.send('Google Analytics har ikke målt noget i to dage',
      `<p><b>Google Analytics registrerede nul sidevisninger på voreshjem.dk ${K.kortDato(forgaars)} og ${K.kortDato(igaar)}, men den egne tæller så ${tal(n)}.</b></p>
       <p>Google ser kun dem, der siger ja til cookies, men så mange besøg helt uden ét ja er usandsynligt.
       Typisk er Google-koden (G-ZFW1KE91LV) forsvundet fra sidens head ved en udgivelse, eller cookiebanneret melder ikke ja videre.</p>`).catch(() => {});
  }
  if (!alarm) await log('dagvagt ok', K.kortDato(igaar) + ', ' + egenTekst + '. ' + gaTekst, 'dagvagt');

  /* ── 2. sidehastighed: én maaling om dagen, alarm kun ved et bekraeftet fald ── */
  const hast = await hastP;
  let hastSvar = null;
  if (sql) { try {
    if (hast.mobil == null) {
      await log('dagvagt: hastighed kunne ikke måles', hast.fejl, 'dagvagt');
    } else {
      await sql`INSERT INTO vh_hastighed (mobil, computer) VALUES (${hast.mobil}::int, ${hast.computer}::int)`;
      hastSvar = { mobil: hast.mobil, computer: hast.computer };
      // Google-tallet svinger 20-40 point fra gang til gang, saa én maaling siger intet.
      // Midterværdien af de sidste 3 dage sammenlignes med de 7 dage foer. Gamle dage kan have
      // flere raekker (fra dobbeltkoersler), derfor foerst én vaerdi pr. dansk dag.
      const dage = await sql`SELECT dato::text AS dato, percentile_cont(0.5) WITHIN GROUP (ORDER BY mobil)::float AS mobil
        FROM (SELECT (maalt AT TIME ZONE 'Europe/Copenhagen')::date AS dato, mobil FROM vh_hastighed
              WHERE mobil > 0 AND maalt > now() - interval '30 days') x
        GROUP BY dato ORDER BY dato DESC LIMIT 10`;
      const nye = dage.slice(0, 3).map(x => x.mobil), gamle = dage.slice(3, 10).map(x => x.mobil);
      if (dage.length && dage[0].dato === nu.dato && nye.length === 3 && gamle.length >= 5) {
        const mNy = median(nye), mGl = median(gamle);
        hastSvar.sammenligning = { sidste3: mNy, foer7: mGl };
        const sendt = await sql`SELECT 1 FROM vh_log WHERE hvad = 'HASTIGHEDEN ER FALDET' AND hvornaar > now() - interval '7 days' LIMIT 1`;
        if (mGl - mNy >= 10 && !sendt.length) {
          const r1 = x => Math.round(x);
          await log('HASTIGHEDEN ER FALDET', 'mobil, midterværdi ' + r1(mGl) + ' (7 dage før) til ' + r1(mNy) + ' (sidste 3 dage)', 'dagvagt');
          await mail.send('voreshjem.dk er blevet langsommere', `<p><b>Mobil-scoren hos Google er faldet fra ${r1(mGl)} til ${r1(mNy)}.</b></p>
            <p>${r1(mNy)} er midterværdien af de sidste tre dages målinger, ${r1(mGl)} af de syv dage før. Google-tallet svinger meget fra måling til måling,
            så der skrives kun, når faldet holder over flere dage.</p>
            ${hast.lcp ? `<p>I dagens måling vises det største element efter ${(Math.round(hast.lcp / 100) / 10).toLocaleString('da-DK')} sekunder. ` : '<p>'}Typisk er et nyt billede eller en ny video for tung. Se Oppetid i panelet.</p>`).catch(() => {});
        }
      }
    }
    await sql`DELETE FROM vh_hastighed WHERE maalt < now() - interval '180 days'`;
  } catch (e) { await log('dagvagt: hastighed kunne ikke gemmes', String(e.message || e).slice(0, 120), 'dagvagt'); } }

  /* ── 3. mange fejl i panelet det seneste doegn ───────────────────────── */
  if (sql) { try {
    const r = await sql`SELECT count(*)::int AS n FROM vh_log WHERE hvad = 'FEJL' AND hvornaar > now() - interval '1 day'`;
    if (r[0].n >= 10) await mail.send('Backenden har fejlet ' + r[0].n + ' gange det seneste døgn',
      `<p><b>${r[0].n} fejl i panelet siden i går.</b> Se listen under Opsætning i panelet. Typisk er en nøgle udløbet, eller en tjeneste svarer ikke.</p>`).catch(() => {});
  } catch (e) {} }

  return { statusCode: 200, body: JSON.stringify({ dato: nu.dato, egen, ga, hast: hastSvar, hastFejl: hast.fejl || '' }) };
};
