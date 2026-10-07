'use strict';
/**
 * SEO og GEO. Gennemgaar hele siden som SEOptimer goer, men hver uge og gratis.
 * Og maaler det, SEOptimer ikke kan: hvad Search Console siger I er taet paa,
 * og hvor meget trafik der kommer fra ChatGPT, Perplexity og de andre.
 */
const G = require('./google.js');
const SITE = process.env.SEO_SITE || 'https://www.voreshjem.dk';

/* ── danske kalenderdage (serveren koerer i UTC) ───────────────────────── */
const DK = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
/** Dansk dato og time for et tidspunkt (nu, hvis intet gives). */
function dkNu(t) {
  const o = {}; DK.formatToParts(t == null ? new Date() : new Date(t)).forEach(x => { o[x.type] = x.value; });
  return { dato: o.year + '-' + o.month + '-' + o.day, time: o.hour === '24' ? 0 : Number(o.hour) };
}
/** Kalenderdage frem eller tilbage, regnet paa datoen, saa sommertid ikke flytter noget. */
function plusDage(dato, n) { const [y, m, d] = String(dato).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + (n || 0))).toISOString().slice(0, 10); }
const gyldigDato = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && plusDage(s, 0) === s;
const dageMellem = (fra, til) => Math.round((Date.parse(til + 'T00:00:00Z') - Date.parse(fra + 'T00:00:00Z')) / 86400000) + 1;
const MDR = ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'];
/** '2026-07-05' som '5. jul.' */
const kortDato = d => gyldigDato(d) ? Number(d.slice(8, 10)) + '. ' + MDR[Number(d.slice(5, 7)) - 1] : '';
/** Afslut en saetning med punktum uden at faa to efter en forkortelse som 'okt.' */
const punktum = t => /\.$/.test(t) ? t : t + '.';

/* ── brand-soegninger ─────────────────────────────────────────────────────
   Soegninger paa jeres eget navn er ikke muligheder: dem vinder I allerede, og en
   lav klikrate paa en underside er forventet, fordi forsiden staar over den.
   Fanger 'vores hjem', 'voreshjem', 'vores-hjem', 'voreshjem.dk', 'www.voreshjem.dk',
   'vores hjem app', 'voreshjemapp' og smaa stavefejl som 'vore hjem' og 'vors hjem',
   uanset store og smaa bogstaver. 'vores hjemmeside' er IKKE brand. */
const BRAND = /(^| )vore?s? ?hje?m(app|dk)?(?= )/;
function erBrand(ord) {
  const s = ' ' + String(ord || '').toLowerCase().replace(/[^a-z0-9æøå]+/g, ' ').trim() + ' ';
  return BRAND.test(s);
}

const hent = async (url, ms) => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 15000);
  try { return await fetch(url, { redirect:'follow', signal:c.signal, headers:{ 'User-Agent':'VoresHjem-seo/1.0' } }); }
  finally { clearTimeout(t); }
};
const tekst = (h, re) => { const m = re.exec(h); return m ? m[1].replace(/\s+/g,' ').trim() : ''; };
const alle  = (h, re) => { const ud = []; let m; while ((m = re.exec(h))) ud.push(m[1]); return ud; };

/* ── én side ────────────────────────────────────────────────────────────── */
async function tjekSide(url) {
  const fund = [], r = { url, fund, ok: true };
  let h = '';
  try {
    const t0 = Date.now(); const res = await hent(url); r.status = res.status; r.ms = Date.now() - t0;
    if (!res.ok) { fund.push({ kode:'svar', grad:'fejl', hvad:'Siden svarer ' + res.status, hvordan:'Siden findes ikke eller fejler. Ret linket eller lav en omdirigering.' }); r.ok = false; return r; }
    h = await res.text(); r.kb = Math.round(Buffer.byteLength(h)/1024);
  } catch (e) { fund.push({ kode:'hent', grad:'fejl', hvad:'Kunne ikke hentes', hvordan:String(e.message||e).slice(0,80) }); r.ok = false; return r; }

  const krop = h.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
  const titel = tekst(h, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const besk  = tekst(h, /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) || tekst(h, /<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i);
  const h1    = alle(h, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).map(x => x.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
  const kanon = tekst(h, /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  const ogT   = /property=["']og:title["']/i.test(h), ogB = /property=["']og:image["']/i.test(h);
  const ld    = /application\/ld\+json/i.test(h);
  const faq   = /"@type"\s*:\s*"FAQPage"/i.test(h);
  const img   = alle(h, /<img\b([^>]*)>/gi);
  const udenAlt = img.filter(a => !/\salt=/i.test(a)).length;
  const ord   = krop.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().split(' ').filter(Boolean).length;
  const hreflang = /hreflang=/i.test(h);
  const viewport = /name=["']viewport["']/i.test(h);
  const noindex  = /name=["']robots["'][^>]*noindex/i.test(h);
  const links = alle(h, /<a\b[^>]*href=["']([^"'#]+)["']/gi).filter(x => !/^(mailto|tel|javascript):/.test(x));
  const interne = links.filter(x => x.startsWith('/') || x.startsWith(SITE)).map(x => x.startsWith('/') ? SITE + x : x);
  Object.assign(r, { titel, titelLen: titel.length, besk, beskLen: besk.length, h1: h1.length, h1tekst: h1[0] || '', kanon, ogT, ogB, ld, faq, billeder: img.length, udenAlt, ord, hreflang, viewport, noindex, interne: [...new Set(interne)] });

  if (!titel) fund.push({ kode:'titel-mangler', grad:'fejl', hvad:'Ingen titel', hvordan:'Titlen er det vigtigste for Google. Skriv en på 30 til 60 tegn med sidens emne først.' });
  else if (titel.length > 60) fund.push({ kode:'titel-lang', grad:'advar', hvad:'Titlen er for lang, ' + titel.length + ' tegn', hvordan:'Google klipper efter cirka 60. Kort den ned, emnet først.' });
  else if (titel.length < 25) fund.push({ kode:'titel-kort', grad:'advar', hvad:'Titlen er for kort, ' + titel.length + ' tegn', hvordan:'Der er plads til at sige mere om, hvad siden handler om.' });
  if (!besk) fund.push({ kode:'besk-mangler', grad:'fejl', hvad:'Ingen beskrivelse', hvordan:'Beskrivelsen er teksten under titlen i Google. Uden den vælger Google selv, ofte dårligt. 120 til 155 tegn.' });
  else if (besk.length > 160) fund.push({ kode:'besk-lang', grad:'advar', hvad:'Beskrivelsen er for lang, ' + besk.length + ' tegn', hvordan:'Google klipper efter cirka 155.' });
  else if (besk.length < 70) fund.push({ kode:'besk-kort', grad:'advar', hvad:'Beskrivelsen er for kort', hvordan:'Brug pladsen op til 155 tegn til at sige, hvorfor man skal klikke.' });
  if (h1.length === 0) fund.push({ kode:'h1-mangler', grad:'fejl', hvad:'Ingen H1-overskrift', hvordan:'Hver side skal have præcis én hovedoverskrift.' });
  else if (h1.length > 1) fund.push({ kode:'h1-flere', grad:'advar', hvad:'Flere H1-overskrifter, ' + h1.length, hvordan:'Der maa kun vaere én. Gør de andre til H2.' });
  if (!kanon) fund.push({ kode:'canonical', grad:'advar', hvad:'Ingen canonical', hvordan:'Fortæller Google hvilken adresse der er den rigtige, så www og ikke-www ikke tæller som to sider.' });
  if (!ogT || !ogB) fund.push({ kode:'delekort', grad:'advar', hvad:'Delekort mangler ' + (!ogT && !ogB ? 'titel og billede' : !ogT ? 'titel' : 'billede'), hvordan:'Når nogen deler linket på Facebook eller i en besked, vises et tomt kort.' });
  if (!ld) fund.push({ kode:'ld', grad:'info', hvad:'Ingen strukturerede data', hvordan:'JSON-LD hjælper baade Google og AI-motorer med at forstå, hvad siden er.' });
  if (udenAlt) fund.push({ kode:'alt', grad:'advar', hvad:'Billeder uden alt-tekst, ' + udenAlt + ' billede' + (udenAlt>1?'r':'') + ' uden alt-tekst', hvordan:'Alt-tekst er det, Google og skærmlæsere ser i stedet for billedet.' });
  if (ord < 150 && !noindex) fund.push({ kode:'ord', grad:'info', hvad:'Meget lidt tekst, ' + ord + ' ord', hvordan:'Sider med under 150 ord har svært ved at rangere på noget som helst.' });
  if (!viewport) fund.push({ kode:'viewport', grad:'fejl', hvad:'Ingen viewport', hvordan:'Siden vises forkert på mobil. Google straffer det.' });
  if (r.kb > 300) fund.push({ kode:'vaegt', grad:'info', hvad:'Siden er tung, ' + r.kb + ' KB', hvordan:'Over 300 KB HTML er meget. Tjek om noget kan flyttes ud.' });
  return r;
}

/* ── score ────────────────────────────────────────────────────────────────
   Regel 2, fra 6. okt. 2026. Foer (regel 1) blev alle fund delt ud paa antal sider og
   rundet, saa to advarsler paa 41 sider gav 100 af 100.
   Nu koster hvert forskelligt problem:
     et fast grundbeloeb efter alvor:        fejl 4, advarsel 1, bemaerkning 0,25 point
   + et tillaeg efter andelen af ramte sider: fejl 18, advarsel 6, bemaerkning 1,5 point
     gange (ramte sider / alle sider). Tillaegget er praecis den gamle regel.
   Summen traekkes fra 100 og rundes NED, saa ét eneste fund altid giver under 100. Aldrig under 0.
   Eksempel 5. okt.: to advarsler og en bemaerkning, hver paa 1 af 41 sider:
     1 + 6/41 + 1 + 6/41 + 0,25 + 1,5/41 = 2,58, saa 100 - 2,58 = 97,4, rundet ned til 97.
   Et doedt link paa 1 af 41 sider: 4 + 18/41 = 4,4 point, score 95. */
const SCORE_GRUND = { fejl: 4, advar: 1, info: 0.25 };
const SCORE_VAEGT = { fejl: 6, advar: 2, info: 0.5 };   // gange 3, som i regel 1
const pointFor = (grad, ramte, alle) => (SCORE_GRUND[grad] || 0) + (SCORE_VAEGT[grad] || 0) * 3 * ramte / Math.max(1, alle);
const SCORE_REGEL = { version: 2, tekst: 'Hvert forskelligt problem koster point: et fast beløb efter alvor (fejl 4, advarsel 1, bemærkning 0,25) plus et tillæg efter hvor stor en del af siderne, det rammer (op til 18 for en fejl, 6 for en advarsel og 1,5 for en bemærkning, når alle sider er ramt). Summen trækkes fra 100 og rundes ned, så ét enkelt fund altid giver under 100.' };

/**
 * Scoren efter regel 2 for en GEMT rapport (sider med fund { kode, grad, hvad }). Bruges til
 * gennemgange gemt foer 6. okt. med regel 1, som kunne give 100 trods advarsler (F46).
 * Samler fund paa samme maade som gennemgang(): samme kode er ét problem, doede links og
 * svarfejl ét pr. adresse.
 */
function scoreAfSider(sider, antalSider) {
  const samlet = {};
  (sider || []).forEach(s => (s.fund || []).forEach(f => {
    const k = f.kode + (f.kode === 'doedt-link' || f.kode === 'svar' ? '|' + f.hvad : '');
    samlet[k] = samlet[k] || { grad: f.grad, ramte: 0 }; samlet[k].ramte++; }));
  const antal = Math.max(1, antalSider || (sider || []).length);
  const straf = Math.round(Object.values(samlet).reduce((a, o) => a + pointFor(o.grad, o.ramte, antal), 0) * 1e6) / 1e6;
  return { score: Math.max(0, Math.floor(100 - straf)), straf: Math.round(straf * 10) / 10, scoreRegel: SCORE_REGEL.version };
}

/**
 * F48: SEO-historikken med én gennemgang pr. dansk dag (dagens seneste), aeldste foerst.
 * raekker: [{ score, koert, regel? }] i vilkaarlig raekkefoelge, fx fra vh_seo.
 * Svar: [{ dato:'YYYY-MM-DD', score, koert:ISO, regel }]. regel er scoreRegel (1 = gammel regel, 2 = ny), null hvis ukendt.
 */
function historikPrDag(raekker, max) {
  const prDag = new Map();
  (raekker || []).filter(r => r && r.koert && r.score != null)
    .sort((a, b) => new Date(a.koert) - new Date(b.koert))
    .forEach(r => { const dato = dkNu(r.koert).dato;
      prDag.set(dato, { dato, score: Number(r.score), koert: new Date(r.koert).toISOString(), regel: r.regel != null ? Number(r.regel) : null }); });
  const ud = [...prDag.values()];
  return max ? ud.slice(-max) : ud;
}

/* ── hele siden, ud fra sitemap ────────────────────────────────────────── */
async function gennemgang() {
  const t0 = Date.now();
  let urls = [];
  // sitemap'et siger www.voreshjem.dk, men vi henter altid fra SITE. Saa kan
  // samme gennemgang koeres mod proeveadressen paa netlify, foer domaenet flytter.
  try { const s = await (await hent(SITE + '/sitemap.xml')).text();
    urls = alle(s, /<loc>\s*([^<]+?)\s*<\/loc>/gi).map(u => { try { const x = new URL(u); return SITE + x.pathname + x.search; } catch (e) { return null; } }).filter(Boolean); } catch (e) {}
  if (!urls.length) urls = [SITE + '/'];
  urls = [...new Set(urls)].slice(0, 80);
  // fem ad gangen, saa vi ikke laegger siden ned med vores egen gennemgang
  const sider = []; let i = 0;
  await Promise.all(Array(5).fill(0).map(async () => { while (i < urls.length) { const u = urls[i++]; sider.push(await tjekSide(u)); } }));
  // doede interne links: alle links samlet, tjekket én gang hver
  const kendte = new Set(urls.map(u => u.replace(/\/$/, '')));
  const linkSet = new Set(); sider.forEach(s => (s.interne||[]).forEach(l => linkSet.add(l.split('?')[0].replace(/\/$/, ''))));
  const ukendte = [...linkSet].filter(l => !kendte.has(l)).slice(0, 60);
  const doede = []; let j = 0;
  await Promise.all(Array(5).fill(0).map(async () => { while (j < ukendte.length) { const u = ukendte[j++];
    try { const r = await hent(u, 10000); if (r.status >= 400) doede.push({ url:u, status:r.status }); } catch (e) { doede.push({ url:u, status:0 }); } } }));
  doede.forEach(d => { const fra = sider.filter(s => (s.interne||[]).some(l => l.split('?')[0].replace(/\/$/,'') === d.url)).map(s => s.url);
    fra.forEach(f => { const s = sider.find(x => x.url === f); s && s.fund.push({ kode:'doedt-link', grad:'fejl', hvad:'Dødt link til ' + decodeURIComponent(d.url.replace(SITE,'')), hvordan:'Linket giver ' + (d.status||'intet svar') + '. Ret det eller fjern det.' }); }); });

  // robots og AI-motorer
  const geo = { robots:{}, llms:false, sitemap: urls.length > 1 };
  try { const rb = await (await hent(SITE + '/robots.txt')).text(); geo.robotsFindes = true;
    ['GPTBot','ClaudeBot','PerplexityBot','Google-Extended','CCBot','anthropic-ai','Bytespider'].forEach(b => {
      const blok = new RegExp('User-agent:\\s*' + b + '[\\s\\S]*?(?=User-agent:|$)', 'i').exec(rb);
      geo.robots[b] = blok ? !/Disallow:\s*\/\s*$/m.test(blok[0]) : true; });
  } catch (e) { geo.robotsFindes = false; }
  try { geo.llms = (await hent(SITE + '/llms.txt', 8000)).ok; } catch (e) {}
  geo.faqSider = sider.filter(s => s.faq).length;
  geo.ldSider = sider.filter(s => s.ld).length;

  // fund samlet pr. problem: samme kode paa flere sider er ét problem (doede links og
  // svarfejl dog ét pr. adresse/status)
  const optalt = { fejl:0, advar:0, info:0 };
  sider.forEach(s => s.fund.forEach(f => { optalt[f.grad] = (optalt[f.grad]||0) + 1; }));
  const samlet = {};
  sider.forEach(s => s.fund.forEach(f => { const k = f.kode + (f.kode === 'doedt-link' || f.kode === 'svar' ? '|' + f.hvad : '');
    samlet[k] = samlet[k] || { kode:f.kode, grad:f.grad, hvad:f.hvad.split(', ')[0], hvordan:f.hvordan, sider:[] }; samlet[k].sider.push(decodeURIComponent(s.url.replace(SITE,'')) || '/'); }));
  // score, regel 2 (SCORE_REGEL). Hvert problem koster sine point, og det vigtigste staar foerst.
  const antal = Math.max(1, sider.length);
  const problemer = Object.values(samlet).map(o => ({ ...o, point: pointFor(o.grad, o.sider.length, antal) }));
  const straf = Math.round(problemer.reduce((a, o) => a + o.point, 0) * 1e6) / 1e6;
  const score = Math.max(0, Math.floor(100 - straf));
  const opgaver = problemer.sort((a,b) => b.point - a.point || b.sider.length - a.sider.length)
    .slice(0, 25).map(o => ({ ...o, point: Math.round(o.point * 10) / 10 }));
  return { kilde: 'seo', koert: new Date().toISOString(), sekunder: Math.round((Date.now()-t0)/1000), antalSider: sider.length,
    score, scoreRegel: SCORE_REGEL.version, scoreForklaring: SCORE_REGEL.tekst, straf: Math.round(straf * 10) / 10, optalt, opgaver, geo,
    sider: sider.map(s => ({ url:decodeURIComponent(s.url.replace(SITE,''))||'/', ok:s.ok, ms:s.ms, kb:s.kb, titel:s.titel, titelLen:s.titelLen, besk:s.besk, beskLen:s.beskLen,
      h1:s.h1, h1tekst:(s.h1tekst||''), ord:s.ord, udenAlt:s.udenAlt, ld:s.ld, faq:s.faq, ogB:s.ogB, kanon:!!s.kanon,
      fund:s.fund.map(f => ({ kode:f.kode, grad:f.grad, hvad:f.hvad })), antalFund:s.fund.length, fejl:s.fund.filter(f=>f.grad==='fejl').length })) };
}

/* ── muligheder: ord I er taet paa side 1 med ─────────────────────────── */
// antaget klikrate, hvis man rykker op: plads 4-10 og plads 11-20. Det er et SKOEN, ikke maalt.
const RATE = { side1: 0.12, side2: 0.05 };
const MULIGHED_DAGE = 90;

/** Seneste dag, Search Console har tal for (den er 2-3 dage bagud og regner i Googles egen tidszone). */
async function sidsteGscDag() {
  const idag = dkNu().dato;
  try {
    const r = await G.soegning({ startDate: plusDage(idag, -10), endDate: idag, dimensions: ['date'], rowLimit: 20 });
    const d = (r.rows || []).map(x => x.keys[0]).filter(gyldigDato).sort();
    if (d.length) return { dato: d[d.length - 1], maalt: true };
  } catch (e) { /* fejler Search Console, fejler hovedopslaget nedenfor ogsaa, og fejlen kastes dér */ }
  return { dato: plusDage(idag, -3), maalt: false };
}

async function muligheder() {
  // de seneste 90 dage MED tal, begge ender med (foer: 91 dage, og til var bare "nu minus 2 doegn" i UTC)
  const sidste = await sidsteGscDag();
  const til = sidste.dato, fra = plusDage(til, -(MULIGHED_DAGE - 1)), dage = MULIGHED_DAGE;
  const r = await G.soegning({ startDate: fra, endDate: til, dimensions:['query','page'], rowLimit:500 });
  const rows = (r.rows||[]).map(x => ({ ord:x.keys[0], side:(x.keys[1]||'').replace(SITE,'')||'/', klik:x.clicks, visninger:x.impressions, ctr:x.ctr, plads:x.position }));
  // F54/F45: soegninger paa jeres eget navn er ikke muligheder og staar ikke i nogen af listerne
  const brand = rows.filter(x => erBrand(x.ord)), alm = rows.filter(x => !erBrand(x.ord));
  // taet paa: plads 4 til 20, mindst 20 visninger. gevinst er et SKOEN: visninger gange en
  // antaget klikrate, minus de klik I allerede faar. Én raekke pr. soegning (den side med mest
  // at hente), de andre sider staar i andreSider, saa samme soegning ikke tælles to gange.
  const prOrd = new Map();
  alm.filter(x => x.plads >= 4 && x.plads <= 20 && x.visninger >= 20)
    .map(x => ({ ...x, gevinst: Math.max(0, Math.round(x.visninger * (x.plads <= 10 ? RATE.side1 : RATE.side2) - x.klik)), skoen: true }))
    .filter(x => x.gevinst > 0)
    .sort((a,b) => b.gevinst - a.gevinst || b.visninger - a.visninger)
    .forEach(x => { const k = x.ord.toLowerCase(), f = prOrd.get(k);
      if (f) f.andreSider.push(x.side); else prOrd.set(k, { ...x, andreSider: [] }); });
  const taet = [...prOrd.values()].slice(0, 30);
  // lav klikrate trods god plads: titlen eller beskrivelsen saelger ikke
  const daarligTitel = alm.filter(x => x.plads <= 5 && x.visninger >= 50 && x.ctr < 0.03).sort((a,b) => b.visninger - a.visninger).slice(0, 10);
  // ord uden egen side: ordet rammer forsiden, men fortjener sin egen side
  const udenSide = alm.filter(x => x.side === '/' && x.visninger >= 30 && x.plads > 6).sort((a,b) => b.visninger - a.visninger).slice(0, 10);
  const vindue = kortDato(fra) + ' til ' + kortDato(til);
  return {
    kilde: 'gsc',
    periode: { fra, til, dage, sidsteDagMaalt: sidste.maalt },
    skoen: { felt: 'gevinst', fra, til, dage, kolonne: 'Skøn, ekstra klik på ' + dage + ' dage',
      tekst: 'Skøn, ikke målt: antager ' + Math.round(RATE.side1 * 100) + ' % klikrate på plads 4 til 10 og ' + Math.round(RATE.side2 * 100) +
        ' % på plads 11 til 20, ganget med visningerne og minus de klik, I allerede får. Search Console ' + punktum(vindue) },
    kriterier: {
      taet: punktum('Plads 4 til 20 (nederst på side 1 eller på side 2) og mindst 20 visninger, ' + vindue),
      daarligTitel: punktum('Plads 1 til 5, mindst 50 visninger og under 3 % klikrate, ' + vindue),
      udenSide: punktum('Rammer forsiden, plads over 6 og mindst 30 visninger, ' + vindue) },
    brandUdeladt: { raekker: brand.length, ord: [...new Set(brand.map(x => x.ord.toLowerCase()))].slice(0, 10),
      tekst: 'Søgninger på jeres eget navn (fx "vores hjem") er udeladt. Dem vinder I allerede.' },
    taet, daarligTitel, udenSide, antalOrd: rows.length };
}

/* ── AI-trafik: hvor mange kommer fra ChatGPT og de andre ─────────────── */
const AI = ['chatgpt.com','chat.openai.com','openai.com','perplexity.ai','copilot.microsoft.com','bing.com/chat','gemini.google.com','claude.ai','you.com','poe.com','meta.ai','duckduckgo.com/aichat','chat.deepseek.com','chat.mistral.ai','grok.com'];
const ga4 = (fra, til) => ({ dateRanges: [{ startDate: fra, endDate: til }] });
const timeFilter = (dato, timer) => ({ filter: { fieldName: 'dateHour', inListFilter: { values: timer.map(t => dato.replace(/-/g, '') + String(t).padStart(2, '0')) } } });

/**
 * Perioden for AI-trafikken. p er admin.js omfang(dage), og det er den, der boer sendes
 * (fra, til, foerFra, foerTil, nu, nuSml, foer, ga4SmlOk, kurveDim, visning, sammenlign, note).
 * Uden p regnes samme periode ud her fra knappen: '24t', 'igaar', '7d', '28d', '90d', '365d'
 * eller 'YYYY-MM-DD:YYYY-MM-DD'. Foer (F43, F92) blev alt andet end 7d-365d stille til 28 dage.
 */
function aiPeriode(dage, p) {
  const nu = dkNu(), idag = nu.dato;
  if (p && (p.fra || p.til)) {
    if (!gyldigDato(p.fra) || !gyldigDato(p.til) || p.fra > p.til) throw new Error('AI-trafik: ugyldig periode ' + p.fra + ' til ' + p.til + '.');
    const d = dageMellem(p.fra, p.til);
    const foerFra = gyldigDato(p.foerFra) ? p.foerFra : plusDage(p.fra, -d), foerTil = gyldigDato(p.foerTil) ? p.foerTil : plusDage(p.fra, -1);
    return { fra: p.fra, til: p.til, dage: d, visning: p.visning || (kortDato(p.fra) + (d > 1 ? ' til ' + kortDato(p.til) : '')), note: p.note || null,
      nu: p.nu || ga4(p.fra, p.til),
      // i dag: kun de afsluttede timer i dag og de samme timer i gaar kan sammenlignes
      nuSml: p.nuSml && p.nuSml.dimensionFilter ? p.nuSml : null,
      foer: p.ga4SmlOk === false ? null : (p.foer || ga4(foerFra, foerTil)), foerFra, foerTil,
      smlTekst: p.sammenlign || ('de ' + d + ' dage før'),
      kurveDim: p.kurveDim || (d === 1 ? 'dateHour' : 'date'),
      // admin.js ga4Del: Google spoerges kun fra dens foerste hele dag (ga4Fra). Dagene foer er ukendte i kurven.
      // Har perioden ingen hele GA4-dage (ga4Fra null), er hele kurven ukendt.
      dataFra: p.ga4Daekning ? (gyldigDato(p.ga4Fra) ? p.ga4Fra : plusDage(p.til, 1)) : null };
  }
  const m = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(String(dage || ''));
  if (m && gyldigDato(m[1]) && gyldigDato(m[2]) && m[1] <= m[2] && m[1] <= idag) {
    const fra = m[1], til = m[2] >= idag ? plusDage(idag, -1) : m[2];
    if (til >= fra) return aiPeriode(null, { fra, til, kurveDim: 'date', note: m[2] >= idag ? 'I dag er ikke færdig, så perioden slutter i går.' : null });
    dage = '24t';
  }
  if (dage === '24t') {
    const igaar = plusDage(idag, -1), hele = [];
    for (let t = 0; t < nu.time; t++) hele.push(t);
    return aiPeriode(null, { fra: idag, til: idag, foerFra: igaar, foerTil: igaar, visning: 'I dag', sammenlign: 'i går til samme klokkeslæt', kurveDim: 'dateHour',
      nu: ga4(idag, idag), nuSml: hele.length ? { ...ga4(idag, idag), dimensionFilter: timeFilter(idag, hele) } : null,
      foer: hele.length ? { ...ga4(igaar, igaar), dimensionFilter: timeFilter(igaar, hele) } : null, ga4SmlOk: hele.length > 0 });
  }
  if (dage === 'igaar') {
    const i = plusDage(idag, -1), f = plusDage(idag, -2);
    return aiPeriode(null, { fra: i, til: i, foerFra: f, foerTil: f, visning: 'I går', sammenlign: 'i forgårs', kurveDim: 'dateHour' });
  }
  const d = { '7d': 7, '28d': 28, '90d': 90, '365d': 365 }[dage] || 28;
  return aiPeriode(null, { fra: plusDage(idag, -d), til: plusDage(idag, -1), visning: 'Seneste ' + d + ' dage', kurveDim: 'date' });
}

/**
 * Besoeg fra AI-motorer i den valgte periode. Kun Google Analytics, dvs. kun besoegende med cookie-ja.
 * aiTrafik(dage, p): p = omfang(dage) fra admin.js (anbefalet). Se KONTRAKT.md "libs-forarbejde".
 * Fejler hovedrapporten, kastes en fejl (e.kilde = 'ga4', e.tekst, e.raa), saa tallet vises som ukendt og ikke som 0.
 * Fejler en af de andre, er dens felt null, og fejlen staar i fejl[].
 */
async function aiTrafik(dage, p) {
  const per = aiPeriode(dage, p), idag = dkNu();
  const filt = { orGroup:{ expressions: AI.map(k => ({ filter:{ fieldName:'sessionSource', stringFilter:{ matchType:'CONTAINS', value:k.split('/')[0], caseSensitive:false } } })) } };
  // AI-filteret laegges oven paa periodens eget filter (timerne ved I dag), ligesom medFilter i admin.js
  const stk = s => ({ dateRanges: s.dateRanges, dimensionFilter: s.dimensionFilter ? { andGroup: { expressions: [s.dimensionFilter, filt] } } : filt });
  const efterBesoeg = [{ metric: { metricName: 'sessions' }, desc: true }];
  // I dag er Google nogle timer bagud. Den seneste time, Google har tal for (alle besoeg, uden AI-filter),
  // siger hvor kurven kan staa som 0. Timerne efter den er ukendte (null).
  const timerIdag = per.kurveDim === 'dateHour' && per.til === idag.dato;
  const svar = await G.alle([
    G.rapport({ ...stk(per.nu), dimensions:[{name:'sessionSource'}], metrics:[{name:'sessions'},{name:'activeUsers'},{name:'keyEvents'}], orderBys: efterBesoeg, limit:20 }),
    G.rapport({ ...stk(per.nu), dimensions:[{name:'landingPage'}], metrics:[{name:'sessions'}], orderBys: efterBesoeg, limit:10 }),
    G.rapport({ ...stk(per.nu), dimensions:[{name:per.kurveDim}], metrics:[{name:'sessions'}], orderBys:[{dimension:{dimensionName:per.kurveDim}}], limit:1000 }),
    per.foer  ? G.rapport({ ...stk(per.foer),  metrics:[{name:'sessions'}] }) : Promise.resolve(null),
    per.nuSml ? G.rapport({ ...stk(per.nuSml), metrics:[{name:'sessions'}] }) : Promise.resolve(null),
    timerIdag ? G.rapport({ ...ga4(idag.dato, idag.dato), dimensions:[{name:'dateHour'}], metrics:[{name:'sessions'}],
      orderBys:[{dimension:{dimensionName:'dateHour'}, desc:true}], limit:1 }) : Promise.resolve(null)
  ], 'ga4');
  const [a, pr, kurveSvar, foerSvar, smlSvar, sidstSvar] = svar;
  if (a.fejlet) {
    // samme form som de andre kilder: 'Google Analytics: <kort>', saa admin.js fejlObj kender kilden
    const kort = String(a.fejlTekst || '').replace(/^Google Analytics(, live)?: /, '').replace(/\.?\s*$/, '.').slice(0, 200) + ' Besøg fra AI-motorer er derfor ukendte, ikke 0.';
    const e = new Error('Google Analytics: ' + kort);
    e.kilde = 'ga4'; e.raa = a.fejlTekst || ''; e.tekst = 'Google Analytics svarede ikke: ' + kort; throw e;
  }
  const ialt = G.samlet(a, 'sessions');
  // kurven: én raekke pr. dag (eller time ved én dag). Dage/timer uden besoeg er 0, for rapporten lykkedes.
  // Undtagen: dage foer Googles foerste hele dag (dataFra) og, i dag, timerne efter den seneste time,
  // Google har tal for. De er null (ukendt), ikke 0.
  let kurve = null, kurveTil = null;
  if (!kurveSvar.fejlet) {
    const raekkerK = G.raekker(kurveSvar);
    const fundet = new Map(raekkerK.map(r => [r[per.kurveDim], r.sessions]));
    if (timerIdag) {
      // seneste time med tal: fra rapporten uden AI-filter, ellers den seneste AI-time (forsigtigt)
      const s = sidstSvar && !sidstSvar.fejlet ? G.raekker(sidstSvar).reduce((m, r) => String(r.dateHour) > m ? String(r.dateHour) : m, '') || null : null;
      kurveTil = s || raekkerK.reduce((m, r) => String(r.dateHour) > m ? String(r.dateHour) : m, '') || '';
      // har Google tal til timen nu, mangler der intet
      if (kurveTil >= idag.dato.replace(/-/g, '') + String(idag.time).padStart(2, '0')) kurveTil = null;
    }
    const dataFra = per.dataFra ? per.dataFra.replace(/-/g, '') : null;
    const noegler = [];
    for (let dd = per.fra; dd <= per.til && noegler.length < 2000; dd = plusDage(dd, 1)) {
      const k = dd.replace(/-/g, '');
      if (per.kurveDim === 'dateHour') { for (let t = 0; t < 24 && !(dd === idag.dato && t > idag.time); t++) noegler.push(k + String(t).padStart(2, '0')); }
      else noegler.push(k);
    }
    kurve = noegler.map(k => ({ date: k,
      sessions: (dataFra && k.slice(0, 8) < dataFra) || (kurveTil != null && k.slice(0, 8) === idag.dato.replace(/-/g, '') && k > kurveTil) ? null : (fundet.get(k) || 0) }));
  }
  const foerTal = per.foer ? G.samlet(foerSvar, 'sessions') : null;
  const sml = per.foer ? { nu: per.nuSml ? G.samlet(smlSvar, 'sessions') : ialt, foer: foerTal, fra: per.foerFra, til: per.foerTil, tekst: per.smlTekst } : null;
  return {
    kilde: 'ga4', kildeTekst: 'Google Analytics, kun besøgende der har sagt ja til cookies.',
    dage: per.dage,
    periode: { fra: per.fra, til: per.til, dage: per.dage, visning: per.visning, slutterIdag: per.til === idag.dato, note: per.note },
    ialt, brugere: G.samlet(a, 'activeUsers'),
    // foer kan kun saettes direkte ved siden af ialt, naar de dækker lige meget. I dag gaar ialt
    // til nu, mens sammenligningen kun er de afsluttede timer: brug da sml.nu mod sml.foer.
    foer: per.nuSml ? null : foerTal,
    sml,
    kilder: G.raekker(a),
    sider: pr.fejlet ? null : G.raekker(pr),
    kurve, kurveDim: per.kurveDim,
    // I dag: den seneste time ('YYYYMMDDHH'), Google har tal for. Senere timer i kurven er null. '' = ingen endnu.
    kurveTil: kurveTil, kurveTilTekst: kurveTil == null ? null : kurveTil
      ? 'Google Analytics er nogle timer bagud. Den seneste time med tal er kl. ' + kurveTil.slice(8, 10) + '-' + String(Number(kurveTil.slice(8, 10)) + 1).padStart(2, '0') + '. Senere timer står som –, ikke 0.'
      : 'Google Analytics har endnu ingen tal for i dag. Timerne står som –, ikke 0.',
    fejl: svar.fejlListe || []
  };
}

module.exports = { gennemgang, muligheder, aiTrafik, aiPeriode, erBrand, historikPrDag, scoreAfSider, SCORE_REGEL, SITE };
