'use strict';
/**
 * Henter titler og beskrivelser, der er rettet i backend-panelet, og laegger
 * dem ind i html-filerne her. Koer den FOER "netlify deploy", ellers
 * overskriver udgivelsen det, der er rettet i panelet.
 *
 *   ADMIN_PASSWORD=... node hent_rettelser.js
 */
const fs = require('fs'), path = require('path');
const BACKEND = process.env.BACKEND_URL || 'https://voreshjem-backend.netlify.app';
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function filFor(url) {
  const sti = url.replace(/^https?:\/\/[^/]+/, '') || '/';
  const r = fs.readFileSync(path.join(__dirname, '_redirects'), 'utf8');
  for (const linje of r.split('\n')) {
    const d = linje.trim().split(/\s+/); if (d.length < 2 || d[0].startsWith('#')) continue;
    try { if (decodeURIComponent(d[0]) === sti) return d[1].replace(/^\//, ''); } catch (e) {}
    if (d[0].endsWith('/*') && sti.startsWith(d[0].slice(0,-1))) return d[1].replace(':splat', sti.slice(d[0].length-1)).replace(/^\//, '');
  }
  if (sti === '/') return 'index.html';
  const s = sti.replace(/^\//, '').replace(/\/$/, '');
  return s.endsWith('.html') ? s : s + '.html';
}
(async () => {
  const kode = process.env.ADMIN_PASSWORD; let seddel = process.env.BACKEND_SEDDEL;
  if (!seddel) {
    if (!kode) { console.log('Saet ADMIN_PASSWORD eller BACKEND_SEDDEL'); process.exit(1); }
    const r = await fetch(BACKEND + '/api?d=login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ kode }) });
    const d = await r.json(); if (!d.seddel) { console.log('Login fejlede:', d.fejl); process.exit(1); } seddel = d.seddel;
  }
  const r = await fetch(BACKEND + '/api?d=rettelser', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ seddel }) });
  const d = await r.json(); const liste = d.rettelser || [];
  if (!liste.length) { console.log('Ingen rettelser i panelet'); return; }
  let n = 0;
  for (const x of liste) {
    const fil = path.join(__dirname, filFor(x.url));
    if (!fs.existsSync(fil)) { console.log('  springer over, filen findes ikke:', x.url); continue; }
    let h = fs.readFileSync(fil, 'utf8'), ramt = false;
    if (x.felt === 'vh') {
      // maerket felt: teksten mellem start- og sluttag paa elementet med data-vh="noegle"
      const re = new RegExp('(<([a-z0-9]+)[^>]*\\sdata-vh="' + x.noegle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '"[^>]*>)([\\s\\S]*?)(</\\2>)', 'i');
      h = h.replace(re, (m, a, tag, inder, b) => { ramt = true; return a + esc(x.vaerdi) + b; });
    } else if (x.felt === 'titel') { h = h.replace(/<title[^>]*>[\s\S]*?<\/title>/i, () => { ramt = true; return '<title>' + esc(x.vaerdi) + '</title>'; })
                                 .replace(/(<meta\s+property=["']og:title["']\s+content=["'])[^"']*(["'])/i, '$1' + esc(x.vaerdi) + '$2'); }
    else { h = h.replace(/(<meta\s+name=["']description["']\s+content=["'])[^"']*(["'])/i, (m, a, b) => { ramt = true; return a + esc(x.vaerdi) + b; })
               .replace(/(<meta\s+property=["']og:description["']\s+content=["'])[^"']*(["'])/i, '$1' + esc(x.vaerdi) + '$2'); }
    if (ramt) { fs.writeFileSync(fil, h); n++; console.log('  rettet', x.felt, 'i', path.relative(__dirname, fil)); }
    else console.log('  feltet blev ikke fundet i', path.relative(__dirname, fil));
  }
  console.log(n + ' af ' + liste.length + ' rettelser lagt ind. Nu kan du udgive.');
})();
