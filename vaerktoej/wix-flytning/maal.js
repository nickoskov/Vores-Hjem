const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new' });
  for (const u of ['https://info.voreshjem.dk/', 'https://www.voreshjem.dk/']) {
    const p = await b.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    let bytes = 0; const efterType = {};
    p.on('response', async r => {
      try {
        const l = r.headers()['content-length'];
        const n = l ? parseInt(l) : 0;
        bytes += n;
        const t = (r.request().resourceType() || 'andet');
        efterType[t] = (efterType[t] || 0) + n;
      } catch (e) {}
    });
    const t0 = Date.now();
    await p.goto(u, { waitUntil: 'networkidle2', timeout: 90000 });
    const tid = Date.now() - t0;
    console.log('\n  === ' + u);
    console.log('    hentet i alt : %s KB', Math.round(bytes/1024));
    console.log('    indlæsning   : %s ms', tid);
    Object.entries(efterType).sort((a,b)=>b[1]-a[1]).slice(0,6)
      .forEach(([t,n]) => console.log('      %-12s %s KB', t, Math.round(n/1024)));
    await p.close();
  }
  await b.close();
})();
