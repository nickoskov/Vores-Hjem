'use strict';
/**
 * Bygger bloggen ud paa voreshjem.dk. Nye indlaeg fra panelet, Soro og Claude
 * bliver til rigtige sider i samme form som de 28 gamle, bloggens forside
 * bygges om, og sitemap'et faar de nye adresser. Alt udgives gennem samme
 * kanal som rettelserne, saa ingen skal aabne en fil.
 */
const { sql, opret } = require('./db.js');
const { udgivFiler, SITE_URL } = require('./udgiv.js');
const MDR = ['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const dansk = d => { if (!d) return ''; const [a,m,dd] = String(d).slice(0,10).split('-'); return Number(dd) + '. ' + MDR[Number(m)-1] + ' ' + a; };
const tekstAf = h => String(h).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const hent = async (sti) => { const r = await fetch(SITE_URL() + sti, { headers:{ 'Cache-Control':'no-cache' } }); if (!r.ok) throw new Error('Kunne ikke hente ' + sti + ': ' + r.status); return r.text(); };


/* Kategori og beslaegtede indlaeg, samme regler som paa de 28 faste indlaeg (16. sept. 2026). */
const KAT = [['madplan',['madplan','aftensmad','mad']],['indkøb',['indkøb','indkoeb']],['kalender',['kalender','aftaler','fritidsaktiviteter','synkron']],
  ['opgaver',['opgave','pligt','point','lommepenge','ansvar','belønning','beloenning']],['apps',['app','sammenligning','anmeldelse','prøveperiode','proeveperiode']],['hverdag',['rutine','mental','hverdag','planlæg','planlaeg']]];
const SIDE = { 'madplan':['/madplan','Se madplanen i Vores Hjem'], 'indkøb':['/indkobsliste','Se indkøbslisten i Vores Hjem'],
  'kalender':['/kalender','Se kalenderen i Vores Hjem'], 'opgaver':['/opgaver','Se opgaver og point i Vores Hjem'], 'apps':['/','Se hvad Vores Hjem kan'], 'hverdag':['/','Se hvad Vores Hjem kan'] };
const NAVN = { 'madplan':'Madplan', 'indkøb':'Indkøb', 'kalender':'Kalender', 'opgaver':'Opgaver og point', 'apps':'Familieapps', 'hverdag':'Hverdag og rutiner' };
function kategori(slug, titel) { const t = (slug + ' ' + titel).toLowerCase(); for (const [k, ord] of KAT) if (ord.some(o => t.includes(o))) return k; return 'hverdag'; }
const STOP = new Set(['familien','familie','hverdag','travl','giver','hjemme','uden','mere','hele','sådan','hvordan']);
const ordI = s => new Set((s.toLowerCase().match(/[a-zæøå]{4,}/g) || []).filter(w => !STOP.has(w)));
function beslaegtede(p, alle) {
  const o = ordI(p.slug + ' ' + p.titel), k = p.kategori || kategori(p.slug, p.titel);
  return alle.filter(q => q.slug !== p.slug).map(q => ({ q, samme: (q.kategori || kategori(q.slug, q.titel)) === k ? 1 : 0, faelles: [...ordI(q.slug + ' ' + q.titel)].filter(w => o.has(w)).length }))
    .sort((a, b) => b.samme - a.samme || b.faelles - a.faelles || (b.q.dato || '').localeCompare(a.q.dato || '')).slice(0, 3).map(x => x.q);
}
function laesOgsaa(p, alle) {
  const k = p.kategori || kategori(p.slug, p.titel), [side, tekst] = SIDE[k];
  return '      <section class="laes-ogsaa">\n        <h2>Læs også</h2>\n        <ul>\n' + beslaegtede(p, alle).map(q => '          <li><a href="/post/' + esc(q.slug) + '">' + esc(q.titel) + '</a></li>\n').join('') +
    '        </ul>\n        <a class="funk" href="' + side + '">' + tekst + ' &rsaquo;</a>\n      </section>\n';
}

/** Én side ud fra et gammelt indlaeg som skabelon. */
function lavSide(skabelon, p, alle) {
  const url = 'https://www.voreshjem.dk/post/' + p.slug;
  const resume = p.resume || tekstAf(p.brod).slice(0, 155);
  const dato = (p.udgivet || new Date().toISOString()).slice(0,10);
  const ord = tekstAf(p.brod).split(' ').length, min = Math.max(2, Math.round(ord/200));
  let s = skabelon;
  s = s.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + esc(p.titel) + ' | Vores Hjem</title>');
  s = s.replace(/(<link rel="canonical" href=")[^"]*(")/i, '$1' + url + '$2');
  s = s.replace(/(<meta name="description" content=")[^"]*(")/i, '$1' + esc(resume) + '$2');
  s = s.replace(/(<meta property="og:title" content=")[^"]*(")/i, '$1' + esc(p.titel) + '$2');
  s = s.replace(/(<meta property="og:description" content=")[^"]*(")/i, '$1' + esc(resume) + '$2');
  s = s.replace(/(<meta property="og:url" content=")[^"]*(")/i, '$1' + url + '$2');
  s = s.replace(/(<meta property="og:image" content=")[^"]*(")/i, '$1' + esc(p.billede || 'https://www.voreshjem.dk/images/og.jpg') + '$2');
  const ld = { '@context':'https://schema.org', '@type':'BlogPosting', headline:p.titel, description:resume, datePublished:dato, dateModified:(p.opdateret||dato).slice(0,10),
    image: p.billede || 'https://www.voreshjem.dk/images/og.jpg', mainEntityOfPage:url, author:{ '@type':'Organization', name:'Vores Hjem' }, publisher:{ '@type':'Organization', name:'Vores Hjem', logo:{ '@type':'ImageObject', url:'https://www.voreshjem.dk/images/logo.png' } } };
  s = s.replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"BlogPosting"[\s\S]*?<\/script>/i, '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>');
  const krop = '<article class="indlaeg">\n    <div class="container">\n      <a class="tilbage" href="/blog.html">&lsaquo; Alle indlæg</a>\n      <h1>' + esc(p.titel) + '</h1>\n      <div class="meta">' + dato.split('-').reverse().join('.') + ' · ' + min + ' min læsning · <a href="/blog">' + NAVN[p.kategori || kategori(p.slug, p.titel)] + '</a></div>\n' +
    (p.billede ? '      <img src="' + esc(p.billede) + '" alt="' + esc(p.titel) + '" style="width:100%;border-radius:16px;margin:8px 0 22px">\n' : '') +
    '      ' + p.brod.trim() + '\n' +
    '      <div class="slutkort">\n        <p><strong>Vores Hjem</strong> samler kalender, madplan, indkøbsliste og opgaver\n           ét sted, så hele familien kan se det samme.</p>\n        <a class="slutknap" href="/hent/" data-sted="blog">Prøv 14 dage gratis</a>\n      </div>\n' + (alle ? laesOgsaa(p, alle) : '') + '    </div>\n  </article>';
  s = s.replace(/<article class="indlaeg">[\s\S]*?<\/article>/i, krop);
  return s;
}

/** Bloggens forside: de faste indlaeg fra manifestet plus de udgivne fra databasen. */
function lavForside(skabelon, alle) {
  const kort = alle.map((p, i) => {
    const doven = i < 6 ? '' : ' loading="lazy" decoding="async"';
    const billede = p.billede ? '<img src="' + esc(p.billede) + '" alt="" class="bk-bil"' + doven + '>' :
      '<div class="bk-bil bk-tom"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3L12 3z"/></svg></div>';
    return '      <a class="bk" href="/post/' + esc(p.slug) + '">\n        <div class="bk-ramme">' + billede + '</div>\n        <div class="bk-ind">\n          <time class="bk-dato" datetime="' + p.dato + '">' + dansk(p.dato) + '</time>\n          <h2 class="bk-titel">' + esc(p.titel) + '</h2>\n          <p class="bk-tekst">' + esc(p.resume) + '</p>\n          <span class="bk-mere">Læs indlægget\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>\n          </span>\n        </div>\n      </a>';
  }).join('\n');
  let s = skabelon.replace(/<div class="bo-net">[\s\S]*?<\/div>\s*<\/div>\s*<\/main>/i, '<div class="bo-net">\n' + kort + '\n    </div>\n  </div>\n</main>');
  s = s.replace(/<div class="bo-antal">\d+ indlæg<\/div>/, '<div class="bo-antal">' + alle.length + ' indlæg</div>');
  const ld = { '@context':'https://schema.org', '@type':'Blog', name:'Vores Hjem, bloggen', url:'https://www.voreshjem.dk/blog',
    blogPost: alle.map(p => ({ '@type':'BlogPosting', headline:p.titel, datePublished:p.dato, url:'https://www.voreshjem.dk/post/' + p.slug })) };
  s = s.replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"Blog"[\s\S]*?<\/script>/i, '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>');
  return s;
}

function lavSitemap(gammelt, nye) {
  let s = gammelt;
  for (const p of nye) {
    const url = 'https://www.voreshjem.dk/post/' + p.slug;
    if (s.includes('<loc>' + url + '</loc>')) continue;
    s = s.replace('</urlset>', '  <url>\n    <loc>' + url + '</loc>\n    <lastmod>' + p.dato + '</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>\n</urlset>');
  }
  return s;
}

/** Bygger og udgiver. Returnerer hvad der blev lavet. */
async function byg() {
  await opret();
  const db = await sql`SELECT slug, titel, resume, brod, billede, udgivet, opdateret FROM vh_blog WHERE status = 'udgivet' ORDER BY udgivet DESC`;
  const faste = JSON.parse(await hent('/blog/indlaeg.json'));
  const skabelonSide = await hent(faste[0].fil);
  const skabelonForside = await hent('/blog.html');
  const gammeltSitemap = await hent('/sitemap.xml');
  const filer = {}, redirects = [];
  const nye = db.filter(p => !faste.some(f => f.slug === p.slug)).map(p => ({ ...p, dato: (p.udgivet || new Date().toISOString()).slice(0,10), resume: p.resume || tekstAf(p.brod).slice(0,155) }));
  nye.forEach(p => { p.kategori = kategori(p.slug, p.titel); });
  const alle = [...faste.map(f => ({ slug:f.slug, titel:f.titel, resume:f.resume, billede:f.billede, dato:f.dato, kategori:f.kategori || kategori(f.slug, f.titel) })), ...nye.map(p => ({ slug:p.slug, titel:p.titel, resume:p.resume, billede:p.billede, dato:p.dato, kategori:p.kategori }))]
    .sort((a,b) => (b.dato||'') < (a.dato||'') ? -1 : 1);
  for (const p of nye) filer['/blog/post/' + p.slug + '.html'] = lavSide(skabelonSide, p, alle);
  filer['/blog.html'] = lavForside(skabelonForside, alle);
  filer['/sitemap.xml'] = lavSitemap(gammeltSitemap, nye);
  // manifestet opdateres, saa naeste bygning kender de nye som faste
  filer['/blog/indlaeg.json'] = JSON.stringify([...faste, ...nye.map(p => ({ slug:p.slug, fil:'/blog/post/' + p.slug + '.html', titel:p.titel, resume:p.resume, billede:p.billede||'', dato:p.dato, kategori:p.kategori }))], null, 1);
  const u = await udgivFiler(filer);
  return { nyeSider: nye.map(p => p.slug), antalIalt: alle.length, ...u };
}
module.exports = { byg, lavSide };
