const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const b = await puppeteer.launch({ headless:'new' });
  const p = await b.newPage();
  const hentet = [];
  const fejl = [];
  p.on('request', r => { if (['script','image'].includes(r.resourceType())) hentet.push(r.url()); });
  p.on('console', m => { if (m.type()==='error') fejl.push(m.text().slice(0,80)); });
  p.on('pageerror', e => fejl.push('sidefejl: ' + String(e.message).slice(0,80)));
  await p.goto('file://' + path.resolve('proev_sporing.html'), { waitUntil:'networkidle2', timeout:60000 });
  await new Promise(r=>setTimeout(r,3500));

  const t = await p.evaluate(() => ({
    dataLayer : Array.isArray(window.dataLayer) ? window.dataLayer.length : 'mangler',
    gtag      : typeof window.gtag,
    fbq       : typeof window.fbq,
    oaiq      : typeof window.oaiq,
    iub       : typeof window._iub,
    google_tag_manager : typeof window.google_tag_manager,
    hentknap  : !!document.getElementById('vh-hent'),
    chatboble : !!(document.getElementById('vh-chat-host') || {}).shadowRoot,
    hentknap_synlig : !!document.getElementById('vh-hent')
  }));
  console.log('  === hvad kom i gang');
  Object.entries(t).forEach(([k,v]) => console.log('    %-20s %s', k, v));
  console.log('\n  === hentede scripts (%d)', hentet.length);
  [...new Set(hentet)].filter(u=>!u.startsWith('file:')).forEach(u=>console.log('    ' + u.slice(0,88)));
  console.log('\n  === fejl: %s', fejl.length ? '' : 'ingen');
  fejl.slice(0,6).forEach(f=>console.log('    ' + f));
  await b.close();
})();
