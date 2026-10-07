// Wix-siderne har ikke altid en h1, og en enkelt fejl maa ikke vaelte resten.
// Derfor sin egen fane pr. side, og ingen krav om bestemte elementer.
const fs = require('fs');
const puppeteer = require('puppeteer');

(async () => {
  const liste = JSON.parse(fs.readFileSync('sider.json', 'utf8'));
  const browser = await puppeteer.launch({ headless: 'new' });
  let ok = 0;

  for (const p of liste) {
    const fil = 'raa_sider/' + p.slug + '.json';
    if (fs.existsSync(fil)) { ok++; continue; }
    let side;
    try {
      side = await browser.newPage();
      await side.setViewport({ width: 1280, height: 1200 });
      await side.goto(p.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 2500));

      const data = await side.evaluate(() => {
        const meta = n => { const m = document.querySelector(n); return m ? m.content : null; };
        const dele = [...document.querySelectorAll('h1, h2, h3, p, li')]
          .map(x => ({ t: x.tagName, s: (x.innerText || '').trim() }))
          .filter(x => x.s.length > 1);
        // fjern gentagelser, Wix laegger ofte samme tekst flere steder
        const set = new Set(), unik = [];
        for (const d of dele) { const n = d.t + '|' + d.s; if (!set.has(n)) { set.add(n); unik.push(d); } }
        return { titel: document.title, beskrivelse: meta('meta[name="description"]'), dele: unik };
      });

      data.url = p.url; data.slug = p.slug;
      fs.writeFileSync(fil, JSON.stringify(data, null, 1));
      const tegn = data.dele.reduce((s, d) => s + d.s.length, 0);
      console.log('  ok    %s  %d afsnit, %d tegn', p.slug.slice(0,34).padEnd(34), data.dele.length, tegn);
      ok++;
    } catch (e) {
      console.log('  FEJL  %s  %s', p.slug.slice(0,34).padEnd(34), String(e.message).slice(0,44));
    } finally {
      if (side) { try { await side.close(); } catch (e) {} }
    }
  }
  await browser.close();
  console.log('\n  %d af %d hentet', ok, liste.length);
})();
