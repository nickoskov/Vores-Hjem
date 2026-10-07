// Henter hvert blogindlaeg ved at aabne det i en rigtig browser.
// Teksten staar ikke i sidens kildekode, Wix henter den bagefter med JavaScript.
const fs = require('fs');
const puppeteer = require('puppeteer');

(async () => {
  const liste = JSON.parse(fs.readFileSync('indlaeg.json', 'utf8'));
  const browser = await puppeteer.launch({ headless: 'new' });
  const side = await browser.newPage();
  await side.setViewport({ width: 1280, height: 1000 });

  let hentet = 0, fejl = [];
  for (const post of liste) {
    const fil = 'raa/' + post.slug + '.json';
    if (fs.existsSync(fil)) { post.hentet = true; hentet++; continue; }
    try {
      await side.goto(post.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await side.waitForSelector('main h1, h1', { timeout: 20000 });
      await new Promise(r => setTimeout(r, 1500));

      const data = await side.evaluate(() => {
        const h1 = document.querySelector('h1');
        const meta = n => { const m = document.querySelector(n); return m ? m.content : null; };
        const dele = [...document.querySelectorAll('main p, main h2, main h3, main li')]
          .map(x => ({ t: x.tagName, s: x.innerText.trim() }))
          .filter(x => x.s.length > 1);
        // alt efter "Seneste blogindlaeg" er sidens egne henvisninger, ikke artiklen
        const i = dele.findIndex(x => /^Seneste blogindl/i.test(x.s));
        return {
          titel: h1 ? h1.innerText.trim() : null,
          beskrivelse: meta('meta[name="description"]'),
          billede: meta('meta[property="og:image"]'),
          dele: i > 0 ? dele.slice(0, i) : dele
        };
      });

      data.url = post.url;
      data.slug = post.slug;
      data.aendret = post.aendret;
      fs.writeFileSync(fil, JSON.stringify(data, null, 1));
      const tegn = data.dele.reduce((s, d) => s + d.s.length, 0);
      console.log('  ok    %s  %d afsnit, %d tegn', post.slug.slice(0, 46).padEnd(46), data.dele.length, tegn);
      hentet++;
    } catch (e) {
      console.log('  FEJL  %s  %s', post.slug.slice(0, 46).padEnd(46), e.message.slice(0, 50));
      fejl.push(post.slug);
    }
  }
  await browser.close();
  console.log('\n  %d af %d hentet', hentet, liste.length);
  if (fejl.length) console.log('  fejlede: ' + fejl.join(', '));
})();
