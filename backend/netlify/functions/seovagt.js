'use strict';
/**
 * SEO-hjulet. Koerer hver mandag: gennemgaar hele siden, gemmer score, og
 * skriver ét udkast til et blogindlaeg ud fra det ord, I er taettest paa
 * side 1 med og ikke allerede har skrevet om. Udkastet lander som kladde.
 * Ingen udgiver noget, foer et menneske har laest det.
 *
 * Netlify starter den af og til to gange samme morgen (en koersel med
 * Claude tager over 30 sekunder). Laasen i vh_koersel goer, at kun den
 * foerste koersel i ugen gennemgaar, skriver udkast og sender mail.
 */
const seo = require('../lib/seo.js');
const skriv = require('../lib/skriv.js');
const G = require('../lib/google.js');
const mail = require('../lib/mail.js');
const K = require('../lib/koersel.js');
const { sql, opret, log } = require('../lib/db.js');

exports.handler = async () => {
  if (!sql) return { statusCode: 200, body: 'ingen database' };
  await opret();
  const uge = K.dansk().uge;
  if (!(await K.foersteGang('seovagt', uge))) return { statusCode: 200, body: 'seo-gennemgangen har allerede koert i uge ' + uge };
  let r;
  try { r = await seo.gennemgang(); }
  catch (e) {
    // laasen gives fri, saa en senere koersel kan proeve igen
    await K.frigiv('seovagt', uge);
    await log('seo-gennemgang fejlede', String(e.message || e).slice(0, 160), 'seovagt');
    return { statusCode: 500, body: 'gennemgangen fejlede' };
  }
  // "siden sidst" er den forrige gennemgang, der er mindst en time gammel, saa en
  // dobbeltkoersel aldrig sammenlignes med sig selv. Den kan ogsaa vaere startet fra panelet.
  // sammenlign kun med en gennemgang regnet efter samme pointregel, ellers ligner en ny regel et fald
  const foer = await sql`SELECT score, koert FROM vh_seo WHERE koert < now() - interval '1 hour' AND COALESCE((rapport->>'scoreRegel')::int, 1) = ${r.scoreRegel || 1}::int ORDER BY id DESC LIMIT 1`;
  await sql`INSERT INTO vh_seo (score, rapport) VALUES (${r.score}::int, ${JSON.stringify(r)})`;
  await log('seo-gennemgang', 'score ' + r.score + ', ' + r.antalSider + ' sider, ' + r.optalt.fejl + ' fejl', 'seovagt');

  let udkast = null, ord = '';
  if (G.opsatGsc() && skriv.opsat()) {
    try {
      const m = await seo.muligheder();
      const brugt = (await sql`SELECT kilde FROM vh_blog WHERE kilde LIKE 'claude%'`).map(x => x.kilde.toLowerCase());
      const kand = m.taet.find(x => !brugt.some(b => b.includes(x.ord.toLowerCase())));
      if (kand) { ord = kand.ord; const u = await skriv.udkast(ord, 'I ligger på plads ' + Math.round(kand.plads) + ' med ' + kand.visninger + ' visninger på 90 dage.');
        const slug = (u.slug || u.titel).toLowerCase().replace(/[^\wæøå\s-]/g,'').replace(/\s+/g,'-').slice(0,80);
        const ny = await sql`INSERT INTO vh_blog (slug, titel, resume, brod, status, kilde) VALUES (${slug}, ${u.titel}, ${u.resume}, ${u.brod}, 'kladde', ${'claude, ud fra "' + ord + '"'})
          ON CONFLICT (slug) DO NOTHING RETURNING id`;
        if (ny.length) { udkast = u.titel; await log('udkast skrevet', ord, 'seovagt'); }
        else await log('udkast ikke gemt', 'der findes allerede et indlæg med adressen ' + slug, 'seovagt'); }
    } catch (e) { await log('udkast fejlede', e.message, 'seovagt'); }
  }
  if (mail.opsat()) {
    const d = foer[0] ? r.score - foer[0].score : 0;
    const sidst = foer[0] ? ' siden ' + K.kortDato(K.dansk(new Date(foer[0].koert)).dato) : '';
    await mail.send('SEO-score ' + r.score + (d ? (d > 0 ? ' (op ' + d + ')' : ' (ned ' + (-d) + ')') : ''),
      `<div style="font-family:system-ui,sans-serif;max-width:520px"><h2 style="margin:0 0 6px">SEO-gennemgang, ${r.antalSider} sider</h2>
       <p style="font-size:34px;font-weight:800;margin:0">${r.score}<span style="font-size:14px;color:#9B97B5;font-weight:500"> / 100${foer[0] ? (d ? ', ' + (d>0?'op ':'ned ') + Math.abs(d) : ', uændret') + sidst : ''}</span></p>
       <p style="color:#6B6785">${r.optalt.fejl} fejl, ${r.optalt.advar} advarsler, ${r.optalt.info} bemærkninger</p>
       <h3 style="font-size:13px;color:#9B97B5;text-transform:uppercase;letter-spacing:.05em">Det vigtigste</h3>
       ${r.opgaver.slice(0,5).map(o => '<div style="padding:7px 0;border-bottom:1px solid #F1EFFA"><b>' + o.hvad + '</b> på ' + o.sider.length + ' side' + (o.sider.length>1?'r':'') + '<div style="color:#6B6785;font-size:13px">' + o.hvordan + '</div></div>').join('')}
       ${udkast ? '<p style="margin-top:18px"><b>Nyt udkast i bloggen:</b> ' + udkast + '<br><span style="color:#6B6785;font-size:13px">skrevet ud fra søgningen "' + ord + '". Ligger som kladde, læs det før det udgives.</span></p>' : ''}
       <p style="margin-top:18px;font-size:13px;color:#9B97B5"><a href="https://backend.voreshjem.dk/#seo" style="color:#6C47FF">Se hele gennemgangen</a></p></div>`).catch(()=>{});
  }
  return { statusCode: 200, body: JSON.stringify({ score: r.score, udkast }) };
};
