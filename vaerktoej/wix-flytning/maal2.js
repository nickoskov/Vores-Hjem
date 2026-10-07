const puppeteer = require('puppeteer');
async function maal(navn, url, ekstra) {
  const b = await puppeteer.launch({ headless:'new', args: ['--ignore-certificate-errors', ...(ekstra||[])] });
  const p = await b.newPage();
  await p.setCacheEnabled(false);
  let bytes = 0, antal = 0;
  p.on('response', async r => { antal++; try { const h = r.headers()['content-length']; if (h) bytes += Number(h); else { const buf = await r.buffer().catch(()=>null); if (buf) bytes += buf.length; } } catch (e) {} });
  await p.evaluateOnNewDocument(() => { window.__lcp = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type:'largest-contentful-paint', buffered:true }); });
  const t0 = Date.now();
  await p.goto(url, { waitUntil:'load', timeout:90000 });
  const load = Date.now() - t0;
  await new Promise(r => setTimeout(r, 3000));
  const t = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), loadEv: Math.round(n.loadEventEnd), lcp: Math.round(window.__lcp), res: performance.getEntriesByType('resource').length }; });
  await b.close();
  return { navn, kb: Math.round(bytes/1024), antal, ...t, load };
}
(async () => {
  const wix = await maal('Wix', 'https://www.voreshjem.dk/', ['--host-resolver-rules=MAP www.voreshjem.dk 185.230.63.186, MAP voreshjem.dk 185.230.63.186']);
  const ny  = await maal('Ny side', 'https://www.voreshjem.dk/', ['--host-resolver-rules=MAP www.voreshjem.dk 75.2.60.5, MAP voreshjem.dk 75.2.60.5']);
  const r = (a) => `${a.navn.padEnd(8)} hentet ${String(a.kb).padStart(5)} KB i ${String(a.antal).padStart(3)} filer | foerste svar ${a.ttfb} ms | tekst klar ${a.dcl} ms | stoerste element ${a.lcp} ms | alt indlaest ${a.loadEv} ms`;
  console.log('  ' + r(wix)); console.log('  ' + r(ny));
  const g = (k) => (wix[k] / Math.max(1, ny[k])).toFixed(1);
  console.log(`  forhold: vaegt ${g('kb')}x | filer ${g('antal')}x | foerste svar ${g('ttfb')}x | tekst klar ${g('dcl')}x | stoerste element ${g('lcp')}x | alt indlaest ${g('loadEv')}x`);
})().catch(e => console.log('  FEJL', e.message));
