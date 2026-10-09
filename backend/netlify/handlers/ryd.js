'use strict';
/**
 * Oprydning, hver nat. Persondata skal ikke ligge laengere end noedvendigt.
 * Chatsamtaler slettes efter RYD_DAGE (90 som udgangspunkt) regnet fra
 * sidste besked, medmindre nogen stadig venter paa et menneske. Login-forsoeg,
 * udloebet cache og gamle oppetidstjek ryddes ogsaa. Paa en backend med support-mail (side.js) slettes
 * supportsager og deres beskeder RYD_DAGE efter sidste besked.
 *
 * Bemaerk: besoeg og klik fra den egne taeller slettes ogsaa efter RYD_DAGE.
 * Den aeldste raekke er derfor "aeldste gemte", ikke "taelleren startede".
 * Hoejst én koersel pr. dansk dag (laas i vh_koersel).
 * Chatbottens tabeller (side.js, botTabeller) ligger i begge databaser: den danske har den faelles
 * bots samtaler (ogsaa de tyske fra foer den tyske bot), den tyske har sin egen bots. Hver backend
 * rydder sine egne. Bottens IP-loft (vh_bot_ip, saltet hash) ryddes for alt aeldre end en time.
 */
const { sql, opret, log } = require('../lib/db.js');
const K = require('../lib/koersel.js');
const profil = require('../lib/side.js');
const DAGE = Math.max(7, parseInt(process.env.RYD_DAGE, 10) || 90);

exports.handler = async () => {
  if (!sql) return { statusCode: 200, body: 'ingen database' };
  await opret();
  const dato = K.dansk().dato;
  if (!(await K.foersteGang('ryd', dato))) return { statusCode: 200, body: 'oprydningen har allerede koert i dag (' + dato + ')' };
  const ud = {};
  if (profil.botTabeller) try {
    const gamle = await sql`SELECT id FROM vh_conversations WHERE updated_at < now() - make_interval(days => ${DAGE}::int) AND NOT needs_human`;
    if (gamle.length) {
      const ids = gamle.map(g => g.id);
      await sql`DELETE FROM vh_messages WHERE conv_id = ANY(${ids})`;
      await sql`DELETE FROM vh_conversations WHERE id = ANY(${ids})`;
    }
    ud.samtaler = gamle.length;
  } catch (e) { ud.samtalerFejl = e.message; }
  if (profil.botTabeller) try { const r = await sql`DELETE FROM vh_feedback WHERE ts < now() - make_interval(days => ${DAGE}::int) RETURNING id`; ud.feedback = r.length; } catch (e) {}
  // chatbottens IP-loft (saltet hash af adressen) skal kun bruges en time. Botten rydder selv ved nye beskeder,
  // men kommer der ingen, sletter natten resten. try, fordi tabellen foerst findes efter bottens foerste besked.
  if (profil.botTabeller) try { const r = await sql`DELETE FROM vh_bot_ip WHERE ts < now() - interval '1 hour' RETURNING ip`; ud.botIp = r.length; } catch (e) {}
  try { const r = await sql`DELETE FROM vh_login WHERE hvornaar < now() - interval '1 day' RETURNING id`; ud.login = r.length; } catch (e) {}
  try { const r = await sql`DELETE FROM vh_klik WHERE ts < now() - make_interval(days => ${DAGE}::int) RETURNING id`; ud.klik = r.length; } catch (e) {}
  try { const r = await sql`DELETE FROM vh_besoeg WHERE ts < now() - make_interval(days => ${DAGE}::int) RETURNING id`; ud.besoeg = r.length; } catch (e) {}
  // tyske besoeg fra den 8. okt. 2026, foer den tyske side fik sin egen backend, ligger stadig i den
  // danske database og skal udloebe som alt andet. Efter januar 2027 er de vaek, og linjerne kan fjernes.
  if (profil.kode === 'dk') {
    try { await sql`DELETE FROM vh_besoeg_de WHERE ts < now() - make_interval(days => ${DAGE}::int)`; } catch (e) {}
    try { await sql`DELETE FROM vh_klik_de WHERE ts < now() - make_interval(days => ${DAGE}::int)`; } catch (e) {}
  }
  // support-mailens sager (lib/sager.js) er persondata: kundens adresse, navn og mails. De slettes RYD_DAGE
  // efter sidste besked i sagen, beskederne med. Postkassens noter (uid og Message-ID, intet indhold) gemmes
  // mindst 60 dage, fordi postkassen soeger 30 dage tilbage og ellers ville tage gamle mails igen.
  if (profil.support) {
    try {
      await sql`DELETE FROM vh_sag_beskeder WHERE sag IN (SELECT id FROM vh_sager WHERE sidst < now() - make_interval(days => ${DAGE}::int))`;
      const r = await sql`DELETE FROM vh_sager WHERE sidst < now() - make_interval(days => ${DAGE}::int) RETURNING id`; ud.sager = r.length;
    } catch (e) { ud.sagerFejl = e.message; }
    try { await sql`DELETE FROM vh_postkasse WHERE ts < now() - make_interval(days => ${Math.max(DAGE, 60)}::int)`; } catch (e) {}
  }
  // kontaktformularens log (navn, mail og besked) er persondata som alt andet
  try { const r = await sql`DELETE FROM vh_kontakt WHERE ts < now() - make_interval(days => ${DAGE}::int) RETURNING id`; ud.kontakt = r.length; } catch (e) {}
  try { const r = await sql`DELETE FROM vh_cache WHERE udloeber < now() RETURNING noegle`; ud.cache = r.length; } catch (e) {}
  try { const r = await sql`DELETE FROM vh_oppetid WHERE hvornaar < now() - interval '90 days' RETURNING id`; ud.oppetid = r.length; } catch (e) {}
  try { const r = await sql`DELETE FROM vh_log WHERE hvornaar < now() - interval '180 days' RETURNING id`; ud.log = r.length; } catch (e) {}
  // laasene fra de planlagte funktioner skal kun huskes, saa laenge en dobbeltkoersel kan komme
  try { const r = await sql`DELETE FROM vh_koersel WHERE ts < now() - interval '60 days' RETURNING job`; ud.koersel = r.length; } catch (e) {}
  await log('oprydning', 'ældre end ' + DAGE + ' dage: ' + (profil.botTabeller ? 'samtaler ' + (ud.samtaler || 0) + ', ' : '') + 'besøg ' + (ud.besoeg || 0) + ', klik ' + (ud.klik || 0)
    + (profil.support ? ', supportsager ' + (ud.sager || 0) : '')
    + (ud.samtalerFejl ? '. Samtaler fejlede: ' + String(ud.samtalerFejl).slice(0, 80) : '')
    + (ud.sagerFejl && !/does not exist/.test(ud.sagerFejl) ? '. Supportsager fejlede: ' + String(ud.sagerFejl).slice(0, 80) : ''), 'ryd');
  return { statusCode: 200, body: JSON.stringify(ud) };
};
