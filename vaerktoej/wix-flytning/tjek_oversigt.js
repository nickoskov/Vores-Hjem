const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const b = await puppeteer.launch({ headless:'new' });
  const p = await b.newPage();
  await p.setViewport({width:1280, height:1000});
  const fejl=[], doede=[];
  p.on('pageerror', e => fejl.push(String(e.message).slice(0,90)));
  p.on('response', r => { if (r.status()>=400) doede.push(r.status()+' '+r.url().slice(0,70)); });
  await p.goto('file://'+path.resolve('blog/index.html'), {waitUntil:'networkidle2', timeout:90000});
  const t = await p.evaluate(() => ({
    kort      : document.querySelectorAll('.bk').length,
    billeder  : document.querySelectorAll('.bk-bil').length,
    tomme     : document.querySelectorAll('.bk-tom').length,
    uden_tekst: [...document.querySelectorAll('.bk-tekst')].filter(e=>!e.textContent.trim()).length,
    uden_dato : [...document.querySelectorAll('.bk-dato')].filter(e=>!e.textContent.trim()).length,
    links     : [...document.querySelectorAll('.bk')].map(a=>a.getAttribute('href')),
    h1        : document.querySelector('h1')?.innerText,
    ld        : document.querySelectorAll('script[type="application/ld+json"]').length
  }));
  console.log('  kort: %d   billeder: %d   uden billede: %d', t.kort, t.billeder, t.tomme);
  console.log('  uden tekst: %d   uden dato: %d   strukturerede data: %d', t.uden_tekst, t.uden_dato, t.ld);
  console.log('  overskrift: %s', t.h1);
  // findes hvert link som en rigtig fil
  const fs = require('fs');
  const mangler = t.links.filter(h => !fs.existsSync(path.resolve('blog'+h+'.html')));
  console.log('  links der ikke findes: %s', mangler.length ? mangler.join(', ') : 'ingen');
  console.log('  billeder der ikke kunne hentes: %s', doede.length ? doede.slice(0,3).join(' | ') : 'ingen');
  console.log('  fejl: %s', fejl.length ? fejl.join(' | ') : 'ingen');
  await p.screenshot({path:'oversigt.png', fullPage:false});
  await p.setViewport({width:390,height:844}); await new Promise(r=>setTimeout(r,600));
  await p.screenshot({path:'oversigt_mobil.png'});
  await b.close();
})();
