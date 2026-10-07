const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new' });
  for (const u of ['https://www.voreshjem.dk/opgaver-informationsside',
                   'https://www.voreshjem.dk']) {
    const p = await b.newPage();
    await p.setViewport({width:1280,height:1200});
    try {
      await p.goto(u, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 3000));
      console.log('\n  === ' + u);
      const rammer = p.frames().filter(f => f !== p.mainFrame());
      console.log('    iframes: ' + rammer.length);
      for (const f of rammer) {
        const url = f.url();
        if (!/voreshjem|netlify/i.test(url)) continue;
        let info = {};
        try {
          info = await f.evaluate(() => ({
            vagter: !!document.getElementById('vagter'),
            hentknap: !!document.getElementById('hent-flyd'),
            titel: document.title
          }));
        } catch (e) { info = { fejl: e.message.slice(0,40) }; }
        console.log('      ' + url.slice(0,72));
        console.log('        ' + JSON.stringify(info));
      }
    } catch (e) { console.log('  FEJL ' + u + ' ' + e.message.slice(0,50)); }
    await p.close();
  }
  await b.close();
})();
