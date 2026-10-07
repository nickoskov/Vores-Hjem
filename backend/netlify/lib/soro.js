'use strict';
/**
 * Henter nye blogindlaeg fra Soros RSS-feed.
 *
 * Soro har ingen webhook, kun et RSS-feed pr. konto (Settings -> Other
 * Platform -> RSS Feed). Adressen ligger i Netlify som SORO_RSS_URL. Feedet
 * laeses en gang i timen (sorovagt) og fra Blog-fanen med "Hent fra Soro".
 * Nye indlaeg lander som kladde. Et indlaeg, der allerede findes, roeres
 * ikke, saa rettelser i panelet ikke bliver overskrevet.
 */
const { sql, opret } = require('./db.js');

const URL_ = () => process.env.SORO_RSS_URL || '';
const opsat = () => !!URL_();

const slugify = s => String(s||'').toLowerCase().trim()
  .replace(/[^\wæøå\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').slice(0,80);

// RSS er XML, og en hel XML-parser er for meget for ét feed. Felterne trakkes
// ud med regulaere udtryk, og CDATA og entiteter pakkes ud bagefter.
const felt = (x, navn) => {
  const m = x.match(new RegExp('<' + navn + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + navn + '>', 'i'));
  if (!m) return '';
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').trim();
};
const attr = (x, tag, navn) => {
  const m = x.match(new RegExp('<' + tag + '[^>]*\\s' + navn + '="([^"]*)"', 'i'));
  return m ? m[1] : '';
};

function laes(xml) {
  const ud = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const x = m[1];
    const titel = felt(x, 'title');
    const brod  = felt(x, 'content:encoded') || felt(x, 'description');
    if (!titel || !brod) continue;
    const link = felt(x, 'link');
    let slug = '';
    try { slug = slugify(decodeURIComponent(new URL(link).pathname.split('/').filter(Boolean).pop() || '')); } catch (e) {}
    ud.push({
      titel, brod, slug: slug || slugify(titel),
      resume: felt(x, 'description').replace(/<[^>]+>/g, '').slice(0, 300),
      billede: attr(x, 'enclosure', 'url') || attr(x, 'media:content', 'url') || attr(x, 'media:thumbnail', 'url') || (brod.match(/<img[^>]+src="([^"]+)"/i) || [])[1] || '',
      dato: felt(x, 'pubDate') || felt(x, 'dc:date'),
    });
  }
  return ud;
}

// De 28 indlaeg fra Wix ligger allerede som faerdige sider paa voreshjem.dk,
// og de ligger ogsaa i Soros feed. De maa ikke hentes ind igen, saa bloggen
// faar dem to gange. Sidens egen liste over indlaeg fortaeller, hvad der findes.
const norm = s => String(s||'').toLowerCase().replace(/[^a-zæøå0-9]+/g,' ').trim();
async function paaSiden() {
  try {
    const r = await fetch((process.env.SITE_URL || 'https://www.voreshjem.dk') + '/blog/indlaeg.json', { headers: { 'User-Agent': 'VoresHjem-backend/1.0' } });
    if (!r.ok) return { titler: new Set(), slugs: new Set() };
    const j = await r.json(); const l = Array.isArray(j) ? j : (j.indlaeg || []);
    return { titler: new Set(l.map(x => norm(x.titel))), slugs: new Set(l.map(x => x.slug)) };
  } catch (e) { return { titler: new Set(), slugs: new Set() }; }
}
const findes = (i, side) => side.titler.has(norm(i.titel)) || side.slugs.has(i.slug)
  || [...side.slugs].some(s => s.startsWith(i.slug + '-') || i.slug.startsWith(s + '-'));

async function hent() {
  if (!opsat()) throw new Error('SORO_RSS_URL mangler i Netlify');
  if (!sql) throw new Error('DATABASE_URL mangler i Netlify');
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
  const r = await fetch(URL_(), { signal: c.signal, headers: { 'User-Agent': 'VoresHjem-backend/1.0', Accept: 'application/rss+xml, application/xml, text/xml' } });
  clearTimeout(t);
  if (!r.ok) throw new Error('Soro svarede ' + r.status);
  const xml = await r.text();
  const alle = laes(xml);
  await opret();
  const side = await paaSiden();
  let nye = 0, kendte = 0;
  const status = process.env.WEBHOOK_AUTOUDGIV === 'ja' ? 'udgivet' : 'kladde';
  for (const i of alle) {
    if (findes(i, side)) { kendte++; continue; }
    const res = await sql`
      INSERT INTO vh_blog (slug, titel, resume, brod, billede, status, kilde, udgivet, opdateret)
      VALUES (${i.slug}, ${i.titel}, ${i.resume}, ${i.brod}, ${i.billede}, ${status}, ${'soro'},
              ${status === 'udgivet' ? new Date().toISOString() : null}, now())
      ON CONFLICT (slug) DO NOTHING RETURNING id`;
    if (res.length) { nye++; try { await sql`INSERT INTO vh_log (hvad, detalje, hvem) VALUES ('indlæg hentet fra Soro', ${i.slug}, 'soro')`; } catch (e) {} }
  }
  return { ifeed: alle.length, nye, kendte, status };
}

module.exports = { opsat, hent, laes };
