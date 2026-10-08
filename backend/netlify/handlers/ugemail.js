'use strict';
/**
 * Ugemail. Koerer mandag morgen (sat i netlify.toml) og sender sidste uges tal,
 * mandag til soendag i dansk tid, sammenlignet med ugen foer.
 *
 * Hvert tal har sin kilde skrevet ved:
 *   egen taeller (vh_besoeg, vh_klik)  alle besoegende, uden cookies. Hovedtallene.
 *                                      Gaeste-id'et skifter hver dag, saa "besoegende"
 *                                      er talt pr. dag og lagt sammen.
 *   Google Play                        installationer, kommer ofte flere dage bagud.
 *   Google Analytics                   kun dem, der siger ja til cookies.
 * Mangler et tal, staar der "–" og hvorfor, aldrig et stille 0.
 *
 * Netlify kan starte den to gange. Laasen i vh_koersel goer, at mailen kun sendes én gang pr. uge.
 */
const G = require('../lib/google.js');
const gplay = require('../lib/googleplay.js');
const asc = require('../lib/appstore.js');
const mail = require('../lib/mail.js');
const K = require('../lib/koersel.js');
const profil = require('../lib/side.js');
const { sql, opret, log } = require('../lib/db.js');

const T = n => n == null ? '–' : (Number(n) || 0).toLocaleString('da-DK');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GRAA = 'color:#6B6785', LYS = 'color:#9B97B5';
const KANAL = { 'Organic Search': 'Organisk søgning', 'Direct': 'Direkte', 'Paid Social': 'Betalt social',
  'Organic Social': 'Organisk social', 'Referral': 'Henvisning', 'Paid Search': 'Betalt søgning', 'Email': 'E-mail',
  'Paid Other': 'Betalt, andet', 'Intern': 'Inde fra siden' };

/* pil kun naar begge tal findes, og sammenligningsugen er dækket */
const pil = (nu, foer, ok) => (!ok || nu == null || foer == null || !foer) ? '' :
  (nu >= foer ? ' <span style="color:#10B981">▲ ' : ' <span style="color:#EF4444">▼ ') +
  Math.abs((nu - foer) / foer * 100).toLocaleString('da-DK', { maximumFractionDigits: 0 }) + ' %</span>';
const raekke = (navn, nu, foer, ok, ekstra) => `<tr><td style="padding:7px 0;${GRAA}">${navn}</td>
  <td style="padding:7px 0;text-align:right;font-weight:700">${T(nu)}${pil(nu, foer, ok)}${ekstra ? '<div style="font-weight:400;font-size:12px;' + LYS + '">' + ekstra + '</div>' : ''}</td></tr>`;
const overskrift = (t, kilde) => `<h3 style="margin:24px 0 2px;font-size:14px;${LYS};text-transform:uppercase;letter-spacing:.05em">${t}</h3>` +
  (kilde ? `<p style="margin:0 0 8px;font-size:12.5px;${LYS}">${kilde}</p>` : '');
const liste = l => l.map(x => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #F1EFFA"><span>${esc(x.navn)}</span><b>${T(x.n)}</b></div>`).join('');

/* ── egen taeller for to uger: [fra2..til2] og [fra..til] ─────────────── */
async function egen(fra, til, fra2) {
  if (!sql) return { fejl: 'ingen database' };
  try {
    await opret();
    const [tal, besoeg, klik, sider, kilder, foerstB, foerstK] = await Promise.all([
      // besoegende: pr. dansk dag, lagt sammen. Sidevisninger: alle.
      sql`SELECT CASE WHEN d >= ${fra}::date THEN 'nu' ELSE 'foer' END AS uge, sum(g)::int AS besoegende, sum(v)::int AS visninger
          FROM (SELECT (ts AT TIME ZONE 'Europe/Copenhagen')::date AS d, count(DISTINCT gaest) AS g, count(*) AS v FROM vh_besoeg
                WHERE (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${fra2}::date AND ${til}::date GROUP BY 1) x GROUP BY 1`,
      // et besoeg slutter efter 30 minutters stilhed, som i panelet
      sql`SELECT CASE WHEN d >= ${fra}::date THEN 'nu' ELSE 'foer' END AS uge, count(*)::int AS n
          FROM (SELECT (ts AT TIME ZONE 'Europe/Copenhagen')::date AS d,
                       ts - lag(ts) OVER (PARTITION BY gaest, (ts AT TIME ZONE 'Europe/Copenhagen')::date ORDER BY ts) AS pause
                FROM vh_besoeg WHERE (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${fra2}::date AND ${til}::date) x
          WHERE pause IS NULL OR pause > interval '30 minutes' GROUP BY 1`,
      sql`SELECT CASE WHEN (ts AT TIME ZONE 'Europe/Copenhagen')::date >= ${fra}::date THEN 'nu' ELSE 'foer' END AS uge,
                 count(*) FILTER (WHERE butik = 'appstore')::int AS appstore, count(*) FILTER (WHERE butik = 'googleplay')::int AS googleplay
          FROM vh_klik WHERE butik IN ('appstore','googleplay')
            AND (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${fra2}::date AND ${til}::date GROUP BY 1`,
      sql`SELECT sti, count(*)::int AS n FROM vh_besoeg
          WHERE (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${fra}::date AND ${til}::date GROUP BY sti ORDER BY n DESC LIMIT 5`,
      // hvor de kom fra: hver gaests foerste side paa dagen, saa klik inde paa siden ikke taeller som en kilde
      sql`SELECT kanal, count(*)::int AS n FROM (
            SELECT DISTINCT ON (gaest, (ts AT TIME ZONE 'Europe/Copenhagen')::date) kanal FROM vh_besoeg
            WHERE (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${fra}::date AND ${til}::date
            ORDER BY gaest, (ts AT TIME ZONE 'Europe/Copenhagen')::date, ts) x
          GROUP BY kanal ORDER BY n DESC LIMIT 6`,
      sql`SELECT ((min(ts) AT TIME ZONE 'Europe/Copenhagen')::date)::text AS d FROM vh_besoeg`,
      sql`SELECT ((min(ts) AT TIME ZONE 'Europe/Copenhagen')::date)::text AS d FROM vh_klik WHERE butik IN ('appstore','googleplay')`
    ]);
    const u = (l, h) => l.find(x => x.uge === h) || {};
    const k = h => { const x = u(klik, h); return { appstore: x.appstore || 0, googleplay: x.googleplay || 0, ialt: (x.appstore || 0) + (x.googleplay || 0) }; };
    return {
      nu:   { besoegende: u(tal, 'nu').besoegende || 0,   visninger: u(tal, 'nu').visninger || 0,   besoeg: u(besoeg, 'nu').n || 0,   klik: k('nu') },
      foer: { besoegende: u(tal, 'foer').besoegende || 0, visninger: u(tal, 'foer').visninger || 0, besoeg: u(besoeg, 'foer').n || 0, klik: k('foer') },
      sider: sider.map(x => ({ navn: x.sti, n: x.n })),
      kilder: kilder.map(x => ({ navn: KANAL[x.kanal] || x.kanal, n: x.n })),
      foerstBesoeg: (foerstB[0] || {}).d || null, foerstKlik: (foerstK[0] || {}).d || null
    };
  } catch (e) { return { fejl: String(e.message || e).slice(0, 160) }; }
}

/* ── Google Analytics, kun cookie-ja ─────────────────────────────────── */
async function ga(fra, til, fra2, til2) {
  if (!G.opsat()) return { ikkeOpsat: true };
  try {
    const M = ['totalUsers', 'sessions', 'screenPageViews', 'keyEvents'].map(name => ({ name }));
    const [a, b] = await Promise.all([G.rapport({ dateRanges: [{ startDate: fra, endDate: til }], metrics: M }),
                                      G.rapport({ dateRanges: [{ startDate: fra2, endDate: til2 }], metrics: M })]);
    const t = n => ({ nu: G.samlet(a, n), foer: G.samlet(b, n) });
    return { brugere: t('totalUsers'), besoeg: t('sessions'), visninger: t('screenPageViews'), maal: t('keyEvents') };
  } catch (e) { return { fejl: String(e.message || e).slice(0, 160) }; }
}

/* ── installationer, med hvilke dage der faktisk er tal for ────────────── */
async function play(fra, til, fra2) {
  if (!gplay.opsat()) return { ikkeOpsat: true };
  try {
    // en maaned tilbage, saa vi ogsaa kan se den seneste dag med tal, naar ugen mangler helt
    const alle = await gplay.periode(K.plusDage(fra2, -31), til);
    const sidst = alle.reduce((m, r) => r.dato > m ? r.dato : m, '') || null;
    const uge = (a, b) => { const l = alle.filter(r => r.dato >= a && r.dato <= b);
      return { dage: l.length, sum: l.reduce((s, r) => s + (r.downloads || 0), 0), til: l.reduce((m, r) => r.dato > m ? r.dato : m, '') || null }; };
    return { nu: uge(fra, til), foer: uge(fra2, K.plusDage(fra, -1)), sidst };
  } catch (e) { return { fejl: String(e.message || e).slice(0, 160) }; }
}
async function appstore(fra, til) {
  if (!asc.opsat()) return { ikkeOpsat: true };
  try {
    const l = await asc.periode(fra, til);
    const ok = l.filter(r => !r.fejl && !r.ikkeKlar && r.downloads != null);
    return { dage: ok.length, sum: ok.reduce((s, r) => s + (r.downloads || 0), 0),
             til: ok.reduce((m, r) => r.dato > m ? r.dato : m, '') || null, fejl: (l.find(r => r.fejl) || {}).fejl || '' };
  } catch (e) { return { fejl: String(e.message || e).slice(0, 160) }; }
}

exports.handler = async () => {
  if (!mail.opsat()) return { statusCode: 200, body: 'springer over, mail er ikke sat op' };
  const nu = K.dansk();
  // sidste hele uge, mandag til soendag i dansk tid, og ugen foer den
  const mandag = K.plusDage(nu.dato, 1 - nu.ugedag);
  const fra = K.plusDage(mandag, -7), til = K.plusDage(mandag, -1);
  const fra2 = K.plusDage(fra, -7), til2 = K.plusDage(fra, -1);
  const ugeNoegle = K.isoUge(fra), ugeNr = Number(ugeNoegle.slice(6));

  const [e, g, p, a] = await Promise.all([egen(fra, til, fra2), ga(fra, til, fra2, til2), play(fra, til, fra2), appstore(fra, til)]);

  /* egen taeller: daekker den hele ugen og ugen foer? */
  let egenHtml;
  if (e.fejl) egenHtml = `<p style="${GRAA}">Egen tæller svarede ikke, så ugens tal mangler. Fejl: ${esc(e.fejl)}</p>`;
  else {
    const helUge = !!e.foerstBesoeg && e.foerstBesoeg < fra, helFoer = !!e.foerstBesoeg && e.foerstBesoeg < fra2;
    const klikHel = !!e.foerstKlik && e.foerstKlik < fra2;
    const note = !e.foerstBesoeg ? 'Egen tæller har ingen tal endnu.'
      : !helUge ? `Egen tæller har kun tal fra ${K.kortDato(e.foerstBesoeg)}, så ugen er ikke hel.`
      : !helFoer ? `Ingen sammenligning: egen tæller har kun tal fra ${K.kortDato(e.foerstBesoeg)}, så ugen før er ikke hel.` : '';
    egenHtml = `<table style="width:100%;border-collapse:collapse;font-size:15px">
      ${raekke('Besøgende (talt pr. dag)', e.nu.besoegende, e.foer.besoegende, helFoer)}
      ${raekke('Besøg', e.nu.besoeg, e.foer.besoeg, helFoer)}
      ${raekke('Sidevisninger', e.nu.visninger, e.foer.visninger, helFoer)}
      ${raekke('Klik til butik', e.nu.klik.ialt, e.foer.klik.ialt, helFoer && klikHel, 'App Store ' + T(e.nu.klik.appstore) + ', Google Play ' + T(e.nu.klik.googleplay))}
    </table>${note ? `<p style="font-size:12.5px;${LYS}">${note}</p>` : ''}`;
  }

  /* installationer */
  const dagTekst = (x, navn) => x.dage === 7 ? `${navn}: <b>${T(x.sum)}</b>`
    : x.dage ? `${navn}: <b>${T(x.sum)}</b> (til og med ${K.kortDato(x.til)}, resten af ugen er ikke kommet endnu)`
    : null;
  let playHtml;
  if (p.ikkeOpsat) playHtml = 'Google Play: ikke koblet på.';
  else if (p.fejl) playHtml = 'Google Play: – (svarede ikke: ' + esc(p.fejl) + ')';
  else playHtml = dagTekst(p.nu, 'Google Play') ? dagTekst(p.nu, 'Google Play') + (p.nu.dage === 7 ? pil(p.nu.sum, p.foer.sum, p.foer.dage === 7) : '')
    : 'Google Play: – ugens tal er ikke kommet endnu.' + (p.sidst ? ' Seneste dag med tal: ' + K.kortDato(p.sidst) : '');
  let appHtml;
  if (a.ikkeOpsat) appHtml = 'App Store: ikke koblet på, så installationer fra iPhone mangler her.';
  else if (a.fejl && !a.dage) appHtml = 'App Store: – (svarede ikke: ' + esc(a.fejl) + ')';
  else appHtml = dagTekst(a, 'App Store') || 'App Store: – ugens tal er ikke kommet endnu.';

  /* Google Analytics */
  let gaHtml;
  if (g.ikkeOpsat) gaHtml = `<p style="${GRAA}">Google Analytics er ikke sat op.</p>`;
  else if (g.fejl) gaHtml = `<p style="${GRAA}">Google Analytics svarede ikke: ${esc(g.fejl)}</p>`;
  else gaHtml = `<table style="width:100%;border-collapse:collapse;font-size:15px">
      ${raekke('Besøgende', g.brugere.nu, g.brugere.foer, true)}${raekke('Besøg', g.besoeg.nu, g.besoeg.foer, true)}${raekke('Sidevisninger', g.visninger.nu, g.visninger.foer, true)}
      ${(g.maal.nu || g.maal.foer) ? raekke('Nøglehændelser', g.maal.nu, g.maal.foer, true) : ''}
    </table><p style="font-size:12.5px;${LYS}">Søndagens tal fra Google kan stadig stige lidt.${(g.maal.nu || g.maal.foer) ? '' : ' Der er ingen nøglehændelser sat op i Google Analytics endnu, så konverteringer vises ikke.'}</p>`;

  /* oppetid i samme uge */
  let oppe = '';
  if (sql) { try {
    const o = await sql`SELECT count(*) FILTER (WHERE NOT oppe)::int AS nede, count(*)::int AS alle FROM vh_oppetid
      WHERE (hvornaar AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${fra}::date AND ${til}::date`;
    if (o[0] && o[0].alle) oppe = `<p style="${GRAA}">Oppetid: ${((1 - o[0].nede / o[0].alle) * 100).toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} % (${o[0].nede} fejlede tjek af ${o[0].alle}, ét tjek i timen)</p>`;
  } catch (x) {} }

  const html = `<div style="font-family:system-ui,sans-serif;max-width:540px;color:#14132A">
    <h2 style="margin:0 0 4px">Uge ${ugeNr} på ${profil.navn}</h2>
    <p style="${GRAA};margin:0 0 6px">Mandag ${K.kortDato(fra)} til søndag ${K.kortDato(til)}, sammenlignet med ugen før (${K.kortDato(fra2)} til ${K.kortDato(til2)}).</p>
    ${overskrift('Egen tæller, alle besøgende', 'Tæller alle uden cookies, robotter og jeres egne browsere fraregnet. Den samme person kan ikke genkendes fra dag til dag, så besøgende er talt pr. dag og lagt sammen. Klik til butik er tryk på hent-knapperne, der sendte folk til App Store eller Google Play.')}
    ${egenHtml}
    ${overskrift('Installationer', 'Fra butikkerne selv. Alle installationer, ikke kun dem der kom fra siden. Tallene kommer ofte flere dage bagud.')}
    <p style="margin:4px 0">${playHtml}</p><p style="margin:4px 0">${appHtml}</p>
    ${e.fejl ? '' : overskrift('Mest læste', 'Egen tæller, sidevisninger') + liste(e.sider)}
    ${e.fejl ? '' : overskrift('Hvor de kom fra', 'Egen tæller. Hver besøgendes første side på dagen, så klik inde på siden ikke tæller som en kilde.') + liste(e.kilder)}
    ${overskrift('Google Analytics', 'Kun dem der siger ja til cookies, typisk en lille del af alle. Brug egen tæller ovenfor til at se, hvor mange der kom.')}
    ${gaHtml}
    ${oppe}
    <p style="margin-top:22px;font-size:13px;${LYS}">Hele billedet: <a href="${profil.backend}" style="color:#6C47FF">${profil.backend.replace(/^https?:\/\//, '')}</a></p>
  </div>`;
  const emne = 'Uge ' + ugeNr + ' på ' + profil.navn + (e.fejl ? '' :
    ': ' + T(e.nu.besoegende) + ' besøgende (talt pr. dag), ' + T(e.nu.klik.ialt) + ' klik til butik');

  // laasen tages lige foer afsendelsen, saa en koersel, der fejlede tidligere, kan proeves igen
  if (!(await K.foersteGang('ugemail', ugeNoegle))) {
    return { statusCode: 200, body: 'ugemailen for ' + ugeNoegle + ' er allerede sendt' };
  }
  let s;
  try { s = await mail.send(emne, html); }
  catch (x) { await K.frigiv('ugemail', ugeNoegle); await log('ugemail fejlede', String(x.message || x).slice(0, 160), 'ugemail');
    return { statusCode: 500, body: 'mailen kunne ikke sendes' }; }
  await log('ugemail sendt', 'uge ' + ugeNr + ': ' + (s.til || s.grund), 'ugemail');
  return { statusCode: 200, body: JSON.stringify({ uge: ugeNoegle, sendt: s.sendt, egen: e.fejl ? e : { nu: e.nu, foer: e.foer } }) };
};
