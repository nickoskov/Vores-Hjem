const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new' });
  const p = await b.newPage();
  await p.setViewport({width:1280,height:1000});
  try {
    await p.goto('https://www.unserzuhauseapp.de', { waitUntil:'networkidle2', timeout:60000 });
    await new Promise(r=>setTimeout(r,3000));
    const f = p.frames().filter(x=>x!==p.mainFrame()).map(x=>x.url())
      .filter(u=>/netlify|unserzuhause/i.test(u));
    console.log('    iframes: ' + (f.length ? f.join('\n             ') : 'ingen'));
  } catch(e){ console.log('    fejl: '+e.message.slice(0,60)); }
  await b.close();
})();
