'use strict';
/**
 * Udgiver rettelser til selve siden, uden git og uden at nogen skal aabne en
 * fil. Henter den side der er live, retter titel eller beskrivelse i html'en,
 * og laegger en ny udgivelse op hos Netlify med kun de aendrede filer.
 *
 * Kraever NETLIFY_TOKEN (personlig adgangstoken fra Netlify, User settings,
 * Applications) og SITE_NETLIFY_ID (sidens id). Begge kun i Netlify.
 */
const crypto = require('crypto');
const profil = require('./side.js');
const TOKEN = process.env.NETLIFY_TOKEN || '';
const SITE_ID = process.env.SITE_NETLIFY_ID || profil.netlifySiteId;
const SITE_URL = process.env.SEO_SITE || profil.site;
const opsat = () => !!TOKEN;
const api = async (sti, valg) => {
  const r = await fetch('https://api.netlify.com/api/v1' + sti, { ...(valg||{}), headers: { Authorization: 'Bearer ' + TOKEN, ...((valg||{}).headers||{}) } });
  if (!r.ok) throw new Error('Netlify ' + r.status + ' ved ' + sti + ': ' + (await r.text()).slice(0,120));
  return r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
};
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/** Retter ét felt i en html-tekst. Returnerer null hvis intet blev aendret. */
function ret(html, felt, vaerdi) {
  let ny = html, ramt = false;
  if (felt === 'titel') {
    ny = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, m => { ramt = true; return '<title>' + esc(vaerdi) + '</title>'; });
    if (!ramt) ny = html.replace(/<head[^>]*>/i, m => { ramt = true; return m + '\n<title>' + esc(vaerdi) + '</title>'; });
    ny = ny.replace(/(<meta\s+property=["']og:title["']\s+content=["'])[^"']*(["'])/i, '$1' + esc(vaerdi) + '$2');
  } else if (felt === 'vh') {
    // vaerdi er { noegle, tekst }: teksten mellem start- og sluttag paa elementet med data-vh="noegle"
    const re = new RegExp('(<([a-z0-9]+)[^>]*\\sdata-vh="' + vaerdi.noegle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '"[^>]*>)([\\s\\S]*?)(</\\2>)', 'i');
    ny = html.replace(re, (m, a, tag, inder, b) => { ramt = true; return a + esc(vaerdi.tekst) + b; });
  } else if (felt === 'besk') {
    ny = html.replace(/(<meta\s+name=["']description["']\s+content=["'])[^"']*(["'])/i, () => { ramt = true; return '$1' + esc(vaerdi) + '$2'; }).replace('$1', '<meta name="description" content="').replace('$2', '"');
    if (!ramt) ny = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, m => { ramt = true; return m + '\n<meta name="description" content="' + esc(vaerdi) + '">'; });
    ny = ny.replace(/(<meta\s+property=["']og:description["']\s+content=["'])[^"']*(["'])/i, '$1' + esc(vaerdi) + '$2');
  }
  return ramt ? ny : null;
}

/** Finder alle maerkede felter paa en side: [{ noegle, tekst }] */
function felterI(html) {
  const ud = []; const re = /<([a-z0-9]+)[^>]*\sdata-vh="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi; let m;
  while ((m = re.exec(html))) ud.push({ noegle: m[2], tekst: m[3].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim() });
  return ud;
}

/** Finder hvilken fil en adresse serveres fra, ud fra sidens egen _redirects. */
async function filFor(url, redirects) {
  const sti = url.replace(/^https?:\/\/[^/]+/, '') || '/';
  const kodet = encodeURI(sti);
  for (const linje of redirects.split('\n')) {
    const d = linje.trim().split(/\s+/); if (d.length < 2 || d[0].startsWith('#')) continue;
    if (d[0] === sti || d[0] === kodet) return d[1].replace(/^\//, '');
    if (d[0].endsWith('/*') && (sti.startsWith(d[0].slice(0,-1)) )) return d[1].replace(':splat', sti.slice(d[0].length-1)).replace(/^\//, '');
  }
  if (sti === '/') return 'index.html';
  const s = sti.replace(/^\//, '').replace(/\/$/, '');
  return s.endsWith('.html') ? s : (s.includes('.') ? s : s + '.html');
}

/** Udgiver en liste af rettelser {url, felt, vaerdi}. Returnerer hvad der skete. */
async function udgiv(rettelser) {
  if (!TOKEN) throw new Error('NETLIFY_TOKEN mangler i Netlify');
  // filerne i den udgivelse der er live nu, med deres sha
  const site = await api('/sites/' + SITE_ID);
  const deployId = site.published_deploy && site.published_deploy.id;
  if (!deployId) throw new Error('Siden har ingen udgivelse');
  const filer = await api('/deploys/' + deployId + '/files');
  const digest = {}; filer.forEach(f => digest[f.id] = f.sha);
  let redirects = '';
  try { redirects = await (await fetch(SITE_URL + '/_redirects')).text(); } catch (e) {}
  if (!redirects.includes('/')) { try { redirects = await (await fetch(site.ssl_url + '/_redirects')).text(); } catch (e) {} }

  const nye = {}, log = [];
  // flere rettelser paa samme fil samles
  const prFil = {};
  for (const r of rettelser) { const f = '/' + await filFor(r.url, redirects); (prFil[f] = prFil[f] || []).push(r); }
  for (const [fil, liste] of Object.entries(prFil)) {
    const kilde = site.ssl_url + fil;
    const res = await fetch(kilde, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) { log.push({ fil, ok:false, hvorfor:'kunne ikke hente ' + res.status }); continue; }
    let html = await res.text(), aendret = false;
    for (const r of liste) { const ny = ret(html, r.felt, r.vaerdi); if (ny) { html = ny; aendret = true; } else log.push({ fil, felt:r.felt, ok:false, hvorfor:'feltet blev ikke fundet i filen' }); }
    if (!aendret) continue;
    const sha = crypto.createHash('sha1').update(html).digest('hex');
    if (digest[fil] === sha) { log.push({ fil, ok:true, hvorfor:'allerede saadan' }); continue; }
    digest[fil] = sha; nye[fil] = html; log.push({ fil, ok:true, felter: liste.map(r => r.felt) });
  }
  if (!Object.keys(nye).length) return { udgivet:false, log };
  const dep = await api('/sites/' + SITE_ID + '/deploys', { method:'POST', headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ files: digest, draft: false }) });
  for (const [fil, html] of Object.entries(nye)) {
    if (dep.required && !dep.required.includes(digest[fil])) continue;
    await api('/deploys/' + dep.id + '/files' + fil, { method:'PUT', headers:{ 'Content-Type':'application/octet-stream' }, body: Buffer.from(html) });
  }
  return { udgivet:true, deployId: dep.id, log };
}

/** Udgiver et saet filer {"/sti/fil.html": "indhold"} oven paa den udgivelse der er live. */
async function udgivFiler(filer) {
  if (!TOKEN) throw new Error('NETLIFY_TOKEN mangler i Netlify');
  const site = await api('/sites/' + SITE_ID);
  const deployId = site.published_deploy && site.published_deploy.id;
  if (!deployId) throw new Error('Siden har ingen udgivelse');
  const liste = await api('/deploys/' + deployId + '/files');
  const digest = {}; liste.forEach(f => digest[f.id] = f.sha);
  const nye = {};
  for (const [sti, indhold] of Object.entries(filer)) {
    const buf = Buffer.isBuffer(indhold) ? indhold : Buffer.from(String(indhold));
    const sha = crypto.createHash('sha1').update(buf).digest('hex');
    if (digest[sti] === sha) continue;
    digest[sti] = sha; nye[sti] = buf;
  }
  if (!Object.keys(nye).length) return { udgivet:false, aendret:0 };
  const dep = await api('/sites/' + SITE_ID + '/deploys', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ files: digest, draft:false }) });
  for (const [sti, buf] of Object.entries(nye)) {
    if (dep.required && !dep.required.includes(digest[sti])) continue;
    await api('/deploys/' + dep.id + '/files' + sti, { method:'PUT', headers:{ 'Content-Type':'application/octet-stream' }, body: buf });
  }
  return { udgivet:true, aendret:Object.keys(nye).length, deployId: dep.id, filer:Object.keys(nye) };
}
module.exports = { udgiv, udgivFiler, ret, felterI, opsat, SITE_URL: () => SITE_URL };
