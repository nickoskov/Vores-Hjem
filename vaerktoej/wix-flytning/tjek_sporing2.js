const puppeteer = require('puppeteer'); const path = require('path');
(async () => {
  const b = await puppeteer.launch({ headless:'new' });
  const maal = async (url, iRamme) => {
    const p = await b.newPage(); const fejl = [];
    p.on('pageerror', e => fejl.push(String(e.message).slice(0,70)));
    await p.goto('file://' + path.resolve(url), { waitUntil:'networkidle2', timeout:60000 });
    await new Promise(r => setTimeout(r, 3500));
    const ramme = iRamme ? (await p.$('#r')) && await (await p.$('#r')).contentFrame() : p;
    const t = await ramme.evaluate(() => ({
      gtag: typeof window.gtag === 'function', fbq: typeof window.fbq === 'function', oaiq: typeof window.oaiq === 'function',
      iub: typeof window._iub === 'object', gtm: typeof window.google_tag_manager === 'object',
      chat: !!(document.getElementById('vh-chat-host')||{}).shadowRoot, knap: !!document.getElementById('vh-hent'),
      scripts: document.querySelectorAll('script[src]').length }));
    await p.close(); return { ...t, fejl: fejl.length ? fejl[0] : 'ingen' };
  };
  const a = await maal('proev_sporing.html', false), r = await maal('proev_ramme.html', true);
  console.log('  for sig selv:', JSON.stringify(a));
  console.log('  i en ramme:  ', JSON.stringify(r));
  const ok = a.gtag && a.fbq && a.oaiq && a.iub && a.gtm && a.chat && a.knap && !r.gtag && !r.fbq && !r.iub && !r.gtm && !r.chat && !r.knap && r.scripts === 0;
  console.log(ok ? '  RESULTAT: alt starter for sig selv, intet starter i rammen' : '  RESULTAT: FEJL, se ovenfor');
  await b.close();
})();
