#!/usr/bin/env node
// Laver Soros nye indlæg om til blogindlæg på voreshjem.dk, i samme form som de faste indlæg.
//
//   node vaerktoej/soro-til-blog.mjs <soro-rss-adresse>           viser hvad der ville ske
//   node vaerktoej/soro-til-blog.mjs <soro-rss-adresse> --skriv   laver filerne i hjemmeside/
//
// Adressen står i Netlify som SORO_RSS_URL på voreshjem-backend. Den skrives ikke i repoet.
// Bagefter: node vaerktoej/udgiv.mjs hjemmeside (testudgave) og --live.
//
// Springer over: indlæg der allerede findes (samme titel), og indlæg der er lagt sammen med et
// andet (SAML i vaerktoej/vh-blog.js), så sammenlægningen ikke bliver omgjort.
// Links i Soros tekst peger på gamle Wix-adresser; de rettes til den endelige side.
// Billederne hentes og lægges i hjemmeside/images/blog/, som de andre indlægs billeder.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = path.join(REPO, 'hjemmeside');
const BASE = 'https://www.voreshjem.dk';
const [feedUrl, ...flag] = process.argv.slice(2);
const SKRIV = flag.includes('--skriv');
if (!feedUrl || !/^https?:\/\//.test(feedUrl)) { console.error('Angiv Soros RSS-adresse (SORO_RSS_URL).'); process.exit(1); }

const MDR = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dansk = (d) => { const [a, m, dd] = d.split('-'); return Number(dd) + '. ' + MDR[Number(m) - 1] + ' ' + a; };
const tekstAf = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (t) => t.toLowerCase().replace(/[^a-zæøå0-9]/g, '');
const entiteter = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function felt(it, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(it);
  if (!m) return '';
  const v = m[1].trim(), c = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(v);
  return c ? c[1] : entiteter(v);
}

// Samme kategorier og "Læs også"-regler som backendens blogbygger (backend/netlify/lib/blogbyg.js)
const KAT = [['madplan', ['madplan', 'aftensmad', 'mad']], ['indkøb', ['indkøb', 'indkoeb']], ['kalender', ['kalender', 'aftaler', 'fritidsaktiviteter', 'synkron', 'dobbeltbook', 'skole']],
  ['opgaver', ['opgave', 'pligt', 'point', 'lommepenge', 'ansvar', 'belønning', 'beloenning', 'gøremål', 'goeremaal']], ['apps', ['app', 'sammenligning', 'anmeldelse', 'prøveperiode', 'proeveperiode']], ['hverdag', ['rutine', 'mental', 'hverdag', 'planlæg', 'planlaeg']]];
const SIDE = { madplan: ['/madplan', 'Se madplanen i Vores Hjem'], 'indkøb': ['/indkobsliste', 'Se indkøbslisten i Vores Hjem'], kalender: ['/kalender', 'Se kalenderen i Vores Hjem'],
  opgaver: ['/opgaver', 'Se opgaver og point i Vores Hjem'], apps: ['/', 'Se hvad Vores Hjem kan'], hverdag: ['/', 'Se hvad Vores Hjem kan'] };
const NAVN = { madplan: 'Madplan', 'indkøb': 'Indkøb', kalender: 'Kalender', opgaver: 'Opgaver og point', apps: 'Familieapps', hverdag: 'Hverdag og rutiner' };
const kategori = (slug, titel) => { const t = (slug + ' ' + titel).toLowerCase(); for (const [k, ord] of KAT) if (ord.some((o) => t.includes(o))) return k; return 'hverdag'; };
const STOP = new Set(['familien', 'familie', 'hverdag', 'travl', 'giver', 'hjemme', 'uden', 'mere', 'hele', 'sådan', 'hvordan']);
const ordI = (s) => new Set((s.toLowerCase().match(/[a-zæøå]{4,}/g) || []).filter((w) => !STOP.has(w)));
function beslaegtede(p, alle) {
  const o = ordI(p.slug + ' ' + p.titel), k = p.kategori;
  return alle.filter((q) => q.slug !== p.slug).map((q) => ({ q, samme: q.kategori === k ? 1 : 0, faelles: [...ordI(q.slug + ' ' + q.titel)].filter((w) => o.has(w)).length }))
    .sort((a, b) => b.samme - a.samme || b.faelles - a.faelles || (b.q.dato || '').localeCompare(a.q.dato || '')).slice(0, 3).map((x) => x.q);
}

// --- det der findes i repoet ---
const indlaeg = JSON.parse(fs.readFileSync(path.join(H, 'blog/indlaeg.json'), 'utf8'));
const vhb = fs.readFileSync(path.join(REPO, 'vaerktoej/vh-blog.js'), 'utf8');
const SAML = Object.fromEntries([...vhb.split('const SAML')[1].split('};')[0].matchAll(/"([a-z0-9-]+)":\s*"([a-z0-9-]+)"/g)].map((m) => [m[1], m[2]]));
const toml = fs.readFileSync(path.join(H, 'netlify.toml'), 'utf8');
const VIDERE = {};
for (const blok of toml.split('[[redirects]]').slice(1)) {
  const fra = /from\s*=\s*"([^"]+)"/.exec(blok), til = /to\s*=\s*"([^"]+)"/.exec(blok), st = /status\s*=\s*(\d+)/.exec(blok);
  if (fra && til && st && /^30[12]$/.test(st[1]) && fra[1].startsWith('/')) { try { VIDERE[decodeURIComponent(fra[1])] = til[1]; } catch { VIDERE[fra[1]] = til[1]; } }
}
function retLink(href) {
  let u;
  try { u = new URL(href, BASE); } catch { return href; }
  if (!/(^|\.)voreshjem\.dk$/.test(u.hostname)) return href;
  let p = decodeURIComponent(u.pathname).replace(/\/$/, '') || '/';
  for (let i = 0; i < 5 && VIDERE[p]; i++) {
    const t = VIDERE[p]; if (/^https?:/.test(t) && !t.includes('voreshjem.dk')) return t;
    p = decodeURIComponent(t.replace(/^https?:\/\/[^/]+/, '')).replace(/\/$/, '') || '/';
  }
  const m = /^\/post\/(.+)$/.exec(p);
  if (m && SAML[m[1]]) p = '/post/' + SAML[m[1]];
  return p + u.search + u.hash;
}

// --- Soros feed ---
const xml = await (await fetch(feedUrl)).text();
const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
const titler = new Map(indlaeg.map((d) => [norm(d.titel), d.slug]));
const filer = new Set(fs.readdirSync(path.join(H, 'blog/post')).map((f) => f.replace(/\.html$/, '')));
const nye = [], sprunget = [];
for (const it of items) {
  const titel = felt(it, 'title').trim(), slug = felt(it, 'link').replace(/\/$/, '').split('/').pop();
  const eks = titler.get(norm(titel));
  if (eks && SAML[eks]) { sprunget.push(`${titel}: lagt sammen med /post/${SAML[eks]}`); continue; }
  if (eks || filer.has(slug)) { sprunget.push(`${titel}: findes allerede (/post/${eks || slug})`); continue; }
  if (!/^[a-z0-9-]+$/.test(slug)) { sprunget.push(`${titel}: adressen "${slug}" er ikke ren (a-z, 0-9, -)`); continue; }
  const d = new Date(felt(it, 'pubDate'));
  const dato = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(d);
  let brod = felt(it, 'content:encoded') || felt(it, 'description');
  brod = brod.replace(/<h1(\s[^>]*)?>([\s\S]*?)<\/h1>/gi, '<h2>$2</h2>').replace(/href="([^"]+)"/g, (_, h) => `href="${esc(retLink(entiteter(h)))}"`).trim();
  const billede = (/<enclosure[^>]*url="([^"]+)"/.exec(it) || /<media:content[^>]*url="([^"]+)"/.exec(it) || [])[1] || '';
  nye.push({ slug, titel, dato, resume: tekstAf(felt(it, 'description')), brod, kildeBillede: billede, kategori: kategori(slug, titel) });
}

console.log(`Soros feed: ${items.length} indlæg. Nye: ${nye.length}. Sprunget over: ${sprunget.length}.`);
for (const s of sprunget) console.log('  sprunget:', s);
for (const p of nye) {
  const links = [...p.brod.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  console.log(`  NY  /post/${p.slug}  ${p.dato}  ${NAVN[p.kategori]}  ${tekstAf(p.brod).split(' ').length} ord  links: ${links.join(', ')}`);
}
if (!SKRIV) { console.log('\nIntet skrevet. Kør med --skriv for at lave filerne.'); process.exit(0); }

// --- billeder ---
for (const p of nye) {
  if (!p.kildeBillede) continue;
  const navn = 's' + crypto.createHash('sha1').update(p.kildeBillede).digest('hex').slice(0, 10) + '.webp';
  const fil = path.join(H, 'images/blog', navn);
  if (!fs.existsSync(fil)) {
    const r = await fetch(p.kildeBillede);
    if (!r.ok) { console.log('  billede kunne ikke hentes for', p.slug); continue; }
    fs.writeFileSync(fil, Buffer.from(await r.arrayBuffer()));
  }
  p.billede = `${BASE}/images/blog/${navn}`;
}

// --- sider ---
const alle = [...indlaeg.filter((d) => !SAML[d.slug]).map((d) => ({ slug: d.slug, titel: d.titel, dato: d.dato, kategori: d.kategori || kategori(d.slug, d.titel) })), ...nye];
const skabelon = fs.readFileSync(path.join(H, indlaeg[0].fil.replace(/^\//, '')), 'utf8');
for (const p of nye) {
  const url = `${BASE}/post/${p.slug}`, min = Math.max(2, Math.round(tekstAf(p.brod).split(' ').length / 200));
  const [side, sideTekst] = SIDE[p.kategori];
  const ld = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.titel, description: p.resume, datePublished: p.dato, dateModified: p.dato,
    author: { '@type': 'Organization', name: 'Vores Hjem' }, publisher: { '@type': 'Organization', name: 'Vores Hjem' }, mainEntityOfPage: url };
  const sti = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Forside', item: `${BASE}/` }, { '@type': 'ListItem', position: 2, name: 'Blog', item: `${BASE}/blog` },
    { '@type': 'ListItem', position: 3, name: p.titel, item: url }] };
  let s = skabelon
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(p.titel)} | Vores Hjem</title>`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/i, `$1${url}$2`)
    .replace(/(<meta name="description" content=")[^"]*(")/i, `$1${esc(p.resume)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/i, `$1${esc(p.titel)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/i, `$1${esc(p.resume)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/i, `$1${url}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/i, `$1${esc(p.billede || BASE + '/images/og.jpg')}$2`)
    .replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"BlogPosting"[\s\S]*?<\/script>/i, `<script type="application/ld+json">${JSON.stringify(ld)}</script>`)
    .replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"BreadcrumbList"[\s\S]*?<\/script>/i, `<script type="application/ld+json">${JSON.stringify(sti)}</script>`);
  const krop = '<article class="indlaeg">\n    <div class="container">\n      <a class="tilbage" href="/blog.html">&lsaquo; Alle indlæg</a>\n' +
    `      <h1>${esc(p.titel)}</h1>\n      <div class="meta">${p.dato.split('-').reverse().join('.')} · ${min} min læsning · <a href="/blog">${NAVN[p.kategori]}</a></div>\n` +
    '      ' + p.brod + '\n' +
    '      <div class="slutkort">\n        <p><strong>Vores Hjem</strong> samler kalender, madplan, indkøbsliste og opgaver\n           ét sted, så hele familien kan se det samme.</p>\n' +
    '        <a class="slutknap" href="/hent/" data-sted="blog">Prøv 14 dage gratis</a>\n      </div>\n' +
    '      <section class="laes-ogsaa">\n        <h2>Læs også</h2>\n        <ul>\n' +
    beslaegtede(p, alle).map((q) => `          <li><a href="/post/${esc(q.slug)}">${esc(q.titel)}</a></li>\n`).join('') +
    `        </ul>\n        <a class="funk" href="${side}">${sideTekst} &rsaquo;</a>\n      </section>\n    </div>\n  </article>`;
  s = s.replace(/<article class="indlaeg">[\s\S]*?<\/article>/i, krop);
  fs.writeFileSync(path.join(H, 'blog/post', p.slug + '.html'), s);
}

// --- bloggens forside: de nye kort først (nyeste øverst), de gamle kort beholdes som de er ---
let blog = fs.readFileSync(path.join(H, 'blog.html'), 'utf8');
const kort = nye.slice().sort((a, b) => b.dato.localeCompare(a.dato)).map((p, i) => {
  const doven = i < 6 ? '' : ' loading="lazy" decoding="async"';
  const bil = p.billede ? `<img src="${esc(p.billede)}" alt="${esc(p.titel)}" class="bk-bil"${doven}>` :
    '<div class="bk-bil bk-tom"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3L12 3z"/></svg></div>';
  return `      <a class="bk" href="/post/${esc(p.slug)}">\n        <div class="bk-ramme">${bil}</div>\n        <div class="bk-ind">\n` +
    `          <time class="bk-dato" datetime="${p.dato}">${dansk(p.dato)}</time>\n          <h2 class="bk-titel">${esc(p.titel)}</h2>\n` +
    `          <p class="bk-tekst">${esc(p.resume)}</p>\n          <span class="bk-mere">Læs indlægget\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"\n                 stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>\n          </span>\n        </div>\n      </a>`;
}).join('\n');
const start = blog.indexOf('<div class="bo-net">');
if (start < 0) throw new Error('Fandt ikke <div class="bo-net"> i blog.html');
const efterStart = start + '<div class="bo-net">'.length;
// de gamle kort ligger nu længere nede, så deres billeder må gerne vente
let resten = blog.slice(efterStart).replace(/<img ([^>]*class="bk-bil")(?![^>]*loading=)([^>]*)>/g, '<img $1$2 loading="lazy" decoding="async">');
blog = blog.slice(0, efterStart) + '\n' + kort + resten;
const antal = (blog.match(/<a class="bk" href=/g) || []).length;
blog = blog.replace(/<div class="bo-antal">\d+ indlæg<\/div>/, `<div class="bo-antal">${antal} indlæg</div>`);
fs.writeFileSync(path.join(H, 'blog.html'), blog);

// --- manifest og sitemap ---
fs.writeFileSync(path.join(H, 'blog/indlaeg.json'), JSON.stringify([...indlaeg, ...nye.map((p) => ({ slug: p.slug, fil: `/blog/post/${p.slug}.html`, titel: p.titel, resume: p.resume, billede: p.billede || '', dato: p.dato, kategori: p.kategori }))], null, 1));
let sm = fs.readFileSync(path.join(H, 'sitemap.xml'), 'utf8');
for (const p of nye) {
  const loc = `${BASE}/post/${p.slug}`;
  if (!sm.includes(`<loc>${loc}</loc>`)) sm = sm.replace('</urlset>', `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${p.dato}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>\n</urlset>`);
}
fs.writeFileSync(path.join(H, 'sitemap.xml'), sm);
console.log(`\nSkrevet: ${nye.length} sider, ${nye.filter((p) => p.billede).length} billeder, blog.html (${antal} indlæg), indlaeg.json og sitemap.xml.`);
