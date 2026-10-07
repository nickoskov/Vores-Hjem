const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({headless:'new'});
  const sider = ['/index.html','/blog.html','/kalender.html','/opgaver.html','/madplan.html',
                 '/indkob.html','/indstillinger.html','/synkronisering.html','/slet-konto.html',
                 '/kontakt.html','/hvordan-bruger-jeg-appen.html','/hent/index.html','/404.html'];
  const alle = new Set();
  for (const s of sider) {
    const p = await b.newPage();
    p.on('response', r => { if (r.status()>=400 && r.url().includes('localhost')) alle.add(r.status()+'  '+r.url().replace('http://localhost:8899','')+'   <- '+s); });
    try { await p.goto('http://localhost:8899'+s, {waitUntil:'networkidle2', timeout:60000}); } catch(e){}
    await p.close();
  }
  console.log('  === filer der ikke findes (%d):', alle.size);
  [...alle].forEach(x=>console.log('    '+x));
  await b.close();
})();
