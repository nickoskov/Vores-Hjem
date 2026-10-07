const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new' });
  const p = await b.newPage();
  const scripts = [];
  p.on('request', r => { if (r.resourceType()==='script') scripts.push(r.url()); });
  await p.goto('https://www.voreshjem.dk', { waitUntil:'networkidle2', timeout:60000 });
  await new Promise(r=>setTimeout(r,3500));
  const iub = scripts.filter(u=>/iubenda/i.test(u));
  console.log('  scripts i alt: %d', scripts.length);
  console.log('  iubenda-scripts: %d', iub.length);
  iub.forEach(u=>console.log('    '+u));
  const cfg = await p.evaluate(() => {
    if (!window._iub) return null;
    var c = window._iub.csConfiguration || (window._iub[0] && window._iub[0][1]) || null;
    return c ? { siteId: c.siteId, cookiePolicyId: c.cookiePolicyId, lang: c.lang } : 'ingen csConfiguration';
  });
  console.log('  _iub-opsaetning: %s', JSON.stringify(cfg));
  const banner = await p.evaluate(() => !!document.querySelector('#iubenda-cs-banner, .iubenda-cs-container, [id*="cookie"], [class*="cookie"]'));
  console.log('  cookiebanner paa siden: %s', banner);
  await b.close();
})();
