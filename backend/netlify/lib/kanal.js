'use strict';
/**
 * Kanalerne i den egne taeller, ét sted. taeller.js giver hvert besoeg en kanal, og forespoergslerne i
 * admin.js, ugemail.js og lib/dagtal.js regner gamle raekker om med kanalSql, saa de passer med reglerne her.
 *
 * Samme kanalnavne som Google Analytics, saa panelet oversaetter dem ens, med tre undtagelser:
 *   'AI'          besoeg fra en AI-assistent (ChatGPT, Perplexity, Gemini, Claude, Copilot ...). Fund G12, 16. okt. 2026.
 *   'Intern'      et klik fra én side paa siden til en anden. Aldrig en indgang til siden.
 *   'Paid Other'  betalt trafik, hvor vi ikke kan se, hvem der betalte for den.
 *
 * Raekkefoelgen betyder noget: AI og mail testes foer soegning, ellers bliver gemini.google.com og
 * mail.google.com til Google-soegning. Copilot inde paa bing.com kan ikke skelnes fra Bing-soegning og
 * forbliver soegning.
 */

// AI-assistenter. Samme liste som seo.js (AI), som domaener eller som utm_source uden punktum (ChatGPT
// saetter selv utm_source=chatgpt.com). Bruges ogsaa som regulaert udtryk i Postgres, saa kun syntaks,
// der virker begge steder: ingen lookbehind, ingen flag.
const AI = /chatgpt|openai|perplexity|(^|\.)claude\.ai$|^claude$|gemini\.google|bard\.google|^gemini$|copilot|deepseek|mistral\.ai$|^mistral$|(^|\.)grok\.com$|^grok$|(^|\.)meta\.ai$|(^|\.)you\.com$|(^|\.)poe\.com$/;
// webmail og mail-apps. Gmail-appen paa Android sender sig selv som henvisning (com.google.android.gm).
const MAIL = /mail\.|outlook|gmail|com\.google\.android\.gm$/;
// Googles tjenester, der ikke er soegning. Et link herfra er en henvisning.
const TJENESTE = /^(docs|drive|sites|classroom|groups|calendar|meet|keep|chat|photos)\.google\./;
const SOEG = /google\.|bing\.|duckduckgo|yahoo\.|ecosia|startpage|search\./;

const SOCIAL = /facebook|instagram|threads|messenger|tiktok|linkedin|pinterest|reddit|youtube|snapchat|(^|\.)x\.com$|twitter|(^|\.)t\.co$|lnkd/;
// Metas egne korte kildekoder ({{site_source_name}}): fb, ig, an (Audience Network, reklamer i apps),
// msg (Messenger) og th (Threads). De skal matches som hele ord, saa fx 'digital' ikke bliver Instagram.
const META_KODE = /(^|[^a-z])(fb|ig|an|msg|th)([^a-z]|$)/;
const erSocial = s => !!s && (SOCIAL.test(s) || /meta/.test(s) || META_KODE.test(s));
const erSoegemaskine = s => /google|bing|adwords|microsoft|yahoo|duckduckgo|ecosia/.test(s || '');

/** Kanalen for et besoeg. kilde: henvisningens domaene eller utm_source. utm: { source, medium }. */
function kanal(kilde, utm, intern) {
  if (intern) return 'Intern';
  utm = utm || {};
  const src = (utm.source || '').toLowerCase(), med = (utm.medium || '').toLowerCase();
  if (/cpc|cpm|ppc|paid|annonce|retargeting/.test(med)) {
    // utm_source vinder. Mangler den, bruges den side, de kom fra.
    const hvem = src || kilde;
    if (erSocial(hvem)) return 'Paid Social';
    if (erSoegemaskine(hvem)) return 'Paid Search';
    return 'Paid Other';
  }
  if (/e-?mail|newsletter|nyhedsbrev/.test(med + ' ' + src)) return 'Email';
  if (/^social|social-?media|^sm$/.test(med)) return 'Organic Social';
  const k = kilde || src;
  if (!k) return 'Direct';
  if (AI.test(k)) return 'AI';
  if (MAIL.test(k)) return 'Email';
  if (TJENESTE.test(k)) return 'Referral';
  if (SOEG.test(k)) return 'Organic Search';
  // kilde er utm_source, naar der ingen henvisning var. En kode uden punktum (fb, ig, an) er Meta.
  if (SOCIAL.test(k) || (!/\./.test(k) && META_KODE.test(k))) return 'Organic Social';
  return 'Referral';
}

/**
 * SQL, der regner en gemt kanal om efter reglerne her. Raekker gemt foer 16. okt. 2026 har AI-besoeg som
 * 'Referral' eller 'Organic Search' (Gemini) og mail.google.com som 'Organic Search'. Kun de kanaler roeres,
 * og kun ud fra kildedomaenet, saa betalt trafik og e-mail-kampagner bliver, som de er.
 * p er en parameterfunktion (lib/sessioner.js, parametre): p(vaerdi) giver '$n'. kol og kilde er kolonnenavne.
 */
function kanalSql(kol, kilde, p) {
  return `CASE WHEN ${kol} IN ('Organic Search','Referral') AND ${kilde} ~ ${p(AI.source)} THEN 'AI'
    WHEN ${kol} = 'Organic Search' AND ${kilde} ~ ${p(MAIL.source)} THEN 'Email'
    WHEN ${kol} = 'Organic Search' AND ${kilde} ~ ${p(TJENESTE.source)} THEN 'Referral'
    ELSE ${kol} END`;
}

module.exports = { kanal, kanalSql, AI, MAIL, TJENESTE, SOEG, SOCIAL, META_KODE, erSocial, erSoegemaskine };
