const fs = require('fs');
const adr = JSON.parse(fs.readFileSync('eksterne.json','utf8'));
(async () => {
  const daarlige = [];
  let n = 0;
  for (const u of adr) {
    n++;
    try {
      const c = new AbortController();
      const t = setTimeout(()=>c.abort(), 15000);
      let r = await fetch(u, { method:'HEAD', redirect:'follow', signal:c.signal,
        headers:{'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'} });
      if (r.status === 405 || r.status === 403) {
        r = await fetch(u, { method:'GET', redirect:'follow', signal:c.signal,
          headers:{'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'} });
      }
      clearTimeout(t);
      if (r.status >= 400) daarlige.push([r.status, u]);
    } catch (e) {
      daarlige.push(['fejl', u + '  (' + String(e.message).slice(0,30) + ')']);
    }
  }
  console.log('  %d adresser kontrolleret', n);
  if (!daarlige.length) { console.log('  alle svarer'); return; }
  console.log('\n  === SVARER IKKE ELLER GIVER FEJL');
  daarlige.forEach(([s,u]) => console.log('    %-6s %s', s, u.slice(0,96)));
})();
