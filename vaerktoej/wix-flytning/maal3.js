const puppeteer = require('puppeteer');
// almindelig mobilforbindelse: 4G med lidt modstand (som Chrome's "Fast 4G"), og en telefonprocessor
async function maal(navn, ip) {
  const b = await puppeteer.launch({ headless:'new', args: ['--ignore-certificate-errors', `--host-resolver-rules=MAP www.voreshjem.dk ${ip}, MAP voreshjem.dk ${ip}`] });
  const p = await b.newPage(); await p.setCacheEnabled(false);
  await p.emulate(puppeteer.KnownDevices['iPhone 13']);
  const c = await p.createCDPSession();
  await c.send('Network.emulateNetworkConditions', { offline:false, latency:70, downloadThroughput: 4*1024*1024/8, uploadThroughput: 1024*1024/8 });
  await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.evaluateOnNewDocument(() => { window.__lcp = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type:'largest-contentful-paint', buffered:true }); });
  const t0 = Date.now();
  await p.goto('https://www.voreshjem.dk/', { waitUntil:'networkidle2', timeout:120000 });
  const ro = Date.now() - t0;
  await new Promise(r => setTimeout(r, 2000));
  const t = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0];
    return { ttfb: Math.round(n.responseStart), fcp: Math.round((performance.getEntriesByName('first-contentful-paint')[0]||{}).startTime||0), lcp: Math.round(window.__lcp), loadEv: Math.round(n.loadEventEnd),
      kb: Math.round(performance.getEntriesByType('resource').reduce((s,r)=>s+(r.transferSize||0),0)/1024 + (n.transferSize||0)/1024), antal: performance.getEntriesByType('resource').length + 1 }; });
  await b.close(); return { navn, ro, ...t };
}
(async () => {
  const w = await maal('Wix', '185.230.63.186'), n = await maal('Ny side', '75.2.60.5');
  const r = a => `${a.navn.padEnd(8)} ${String(a.kb).padStart(5)} KB, ${String(a.antal).padStart(3)} filer | foerste tegn paa skaermen ${a.fcp} ms | stoerste element ${a.lcp} ms | siden faerdig ${a.loadEv} ms | helt i ro ${a.ro} ms`;
  console.log('  MOBIL, 4G, telefonprocessor:'); console.log('  ' + r(w)); console.log('  ' + r(n));
  const g = k => (w[k]/Math.max(1,n[k])).toFixed(1);
  console.log(`  Wix/ny: data ${g('kb')}x | foerste tegn ${g('fcp')}x | stoerste element ${g('lcp')}x | faerdig ${g('loadEv')}x | i ro ${g('ro')}x`);
})().catch(e => console.log('  FEJL', e.message));
