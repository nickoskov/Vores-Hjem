const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({headless:'new'});
  const sider = ['/index.html','/blog.html','/kalender.html','/opgaver.html','/madplan.html',
                 '/indkob.html','/kontakt.html','/hent/index.html',
                 '/blog/post/anmeldelse-af-danske-familieapps-hvad-virker.html'];
  console.log('  side                          spor  chat  knap  fejl');
  for (const s of sider) {
    const p = await b.newPage();
    const fejl=[];
    p.on('pageerror', e=>fejl.push(String(e.message).slice(0,50)));
    p.on('console', m=>{ if(m.type()==='error' && !/favicon|net::ERR/.test(m.text())) fejl.push(m.text().slice(0,50)); });
    try {
      await p.goto('http://localhost:8899'+s, {waitUntil:'networkidle2', timeout:60000});
      await new Promise(r=>setTimeout(r,2500));
      const t = await p.evaluate(()=>({
        spor : typeof window.gtag==='function' && typeof window.fbq==='function'
               && typeof window.oaiq==='function' && typeof window._iub==='object',
        chat : !!(document.getElementById('vh-chat-host')||{}).shadowRoot,
        knap : !!document.getElementById('vh-hent')
      }));
      console.log('  %s %s %s %s %s',
        s.padEnd(28), t.spor?'ja  ':'NEJ ', t.chat?'ja  ':'NEJ ', t.knap?'ja  ':'NEJ ',
        fejl.length? fejl[0] : 'ingen');
    } catch(e){ console.log('  %s  KUNNE IKKE HENTES %s', s.padEnd(28), String(e.message).slice(0,40)); }
    await p.close();
  }
  await b.close();
})();
