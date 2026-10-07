const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless:'new' });
  const B = 'https://fabulous-faloodeh-b11dcf.netlify.app';
  const p = await b.newPage(); const fejl = [];
  p.on('pageerror', e => fejl.push(String(e.message).slice(0,70)));
  await p.goto(B + '/', { waitUntil:'networkidle2', timeout:90000 }); await new Promise(r => setTimeout(r, 4000));
  const a = await p.evaluate(() => ({ gtag: typeof gtag==='function', fbq: typeof fbq==='function', oaiq: typeof oaiq==='function', iub: typeof _iub==='object', gtm: typeof google_tag_manager==='object', chat: !!(document.getElementById('vh-chat-host')||{}).shadowRoot, knap: !!document.getElementById('vh-hent') }));
  console.log('  live for sig selv:', JSON.stringify(a), '| fejl:', fejl[0] || 'ingen');
  await p.setContent('<iframe id="r" src="' + B + '/" style="width:1000px;height:800px"></iframe>'); await new Promise(r => setTimeout(r, 5000));
  const f = await (await p.$('#r')).contentFrame();
  const r = await f.evaluate(() => ({ gtag: typeof gtag==='function', fbq: typeof fbq==='function', iub: typeof _iub==='object', chat: !!document.getElementById('vh-chat-host'), knap: !!document.getElementById('vh-hent'), scripts: document.querySelectorAll('script[src*="iubenda"],script[src*="googletagmanager"],script[src*="facebook"]').length }));
  console.log('  live i en ramme:  ', JSON.stringify(r));
  await b.close();
})();
