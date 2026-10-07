// Bygger de 28 blogindlaeg som rigtige HTML-sider i sidens eget design.
// Rammen, altsaa head, nav og footer, tages fra kontakt.html, saa der
// kun findes ét sted, hvor udseendet er beskrevet.
const fs = require('fs');
const path = require('path');

const SIDE = '/Users/nickoskovgaard/voreshjem-site';
const skal = fs.readFileSync(path.join(SIDE, 'kontakt.html'), 'utf8');

const head   = skal.slice(0, skal.indexOf('</head>'));
const nav    = skal.slice(skal.indexOf('<nav'), skal.indexOf('</nav>') + 6);
// kontakt.html slutter med </footer></body></html>, saa vi klipper de to
// sidste tags af og saetter dem selv paa til sidst
const footer = skal.slice(skal.indexOf('<footer'))
  .replace(/<\/body>[\s\S]*$/i, '').trimEnd();

function esc(t){
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// samme head, men med indlaeggets egen titel, beskrivelse og adresse
function beskriv(d){
  if (d.beskrivelse && d.beskrivelse.trim()) return d.beskrivelse.trim();
  const p = d.dele.find(x => x.t === 'P');
  if (!p) return '';
  let t = p.s.replace(/\s+/g,' ').trim();
  if (t.length > 155) t = t.slice(0,152).replace(/\s+\S*$/,'') + '...';
  return t;
}

function nytHead(d){
  let h = head;
  h = h.replace(/<title>[\s\S]*?<\/title>/, '<title>' + esc(d.titel) + ' | Vores Hjem</title>');
  h = h.replace(/<link rel="canonical"[^>]*>/,
        '<link rel="canonical" href="https://www.voreshjem.dk/post/' + d.slug + '">');
  h = h.replace(/<meta name="description"[^>]*>/,
        '<meta name="description" content="' + esc(beskriv(d)) + '">');
  const ekstra = [
    '<meta property="og:type" content="article">',
    '<meta property="og:title" content="' + esc(d.titel) + '">',
    '<meta property="og:description" content="' + esc(beskriv(d)) + '">',
    '<meta property="og:url" content="https://www.voreshjem.dk/post/' + d.slug + '">',
    d.billede ? '<meta property="og:image" content="' + esc(d.billede) + '">' : '',
    '<script type="application/ld+json">' + JSON.stringify({
      '@context':'https://schema.org', '@type':'BlogPosting',
      headline: d.titel, description: beskriv(d),
      datePublished: d.aendret, dateModified: d.aendret,
      author: { '@type':'Organization', name:'Vores Hjem' },
      publisher: { '@type':'Organization', name:'Vores Hjem' },
      mainEntityOfPage: 'https://www.voreshjem.dk/post/' + d.slug
    }) + '</script>'
  ].filter(Boolean).join('\n  ');
  return h + '\n  ' + ekstra + '\n';
}

function krop(d){
  const ud = d.dele.map(x => {
    if (x.t === 'H2') return '      <h2>' + esc(x.s) + '</h2>';
    if (x.t === 'H3') return '      <h3>' + esc(x.s) + '</h3>';
    if (x.t === 'LI') return '      <li>' + esc(x.s) + '</li>';
    return '      <p>' + esc(x.s) + '</p>';
  }).join('\n');
  const dato = (d.aendret || '').slice(0,10).split('-').reverse().join('.');
  return `
  <article class="indlaeg">
    <div class="container">
      <a class="tilbage" href="/blog.html">&lsaquo; Alle indlæg</a>
      <h1>${esc(d.titel)}</h1>
      <div class="meta">${dato} · ${Math.max(1, Math.round(d.dele.reduce((s,x)=>s+x.s.length,0)/1100))} min læsning</div>
${ud}
      <div class="slutkort">
        <p><strong>Vores Hjem</strong> samler kalender, madplan, indkøbsliste og opgaver
           ét sted, så hele familien kan se det samme.</p>
        <a class="slutknap" href="https://voreshjem-bot.netlify.app/hent/app?src=blog">Prøv 14 dage gratis</a>
      </div>
    </div>
  </article>
`;
}

const STIL = `
<style>
  .indlaeg{ padding:64px 0 88px; background:#fff; }
  .indlaeg .container{ max-width:760px; margin:0 auto; padding:0 24px; }
  .indlaeg .tilbage{ display:inline-block; font-size:14px; font-weight:700;
    color:#6C47FF; text-decoration:none; margin-bottom:22px; }
  .indlaeg .tilbage:hover{ text-decoration:underline; }
  .indlaeg h1{ font-size:clamp(30px,4.4vw,44px); line-height:1.14; letter-spacing:-.03em;
    font-weight:800; color:#1B1633; margin:0 0 12px; }
  .indlaeg .meta{ font-size:14px; font-weight:600; color:#8A8A8E; margin-bottom:34px;
    padding-bottom:22px; border-bottom:1px solid #EFEDF8; }
  .indlaeg h2{ font-size:26px; line-height:1.25; letter-spacing:-.02em; font-weight:800;
    color:#1B1633; margin:44px 0 14px; }
  .indlaeg h3{ font-size:20px; line-height:1.3; font-weight:800; color:#1B1633; margin:32px 0 10px; }
  .indlaeg p{ font-size:17.5px; line-height:1.75; color:#3A3552; margin:0 0 20px; }
  .indlaeg li{ font-size:17.5px; line-height:1.75; color:#3A3552; margin:0 0 10px 20px; }
  .indlaeg .slutkort{ margin-top:52px; padding:28px; border-radius:20px;
    background:#F6F4FF; border:1px solid #E6E3F2; text-align:center; }
  .indlaeg .slutkort p{ font-size:16px; margin:0 0 18px; }
  .indlaeg .slutknap{ display:inline-block; text-decoration:none; color:#fff; font-weight:800;
    font-size:16px; padding:15px 30px; border-radius:99px;
    background:linear-gradient(110deg,#6C47FF,#4F7BFF 58%,#EC4899); }
  @media(max-width:600px){ .indlaeg{ padding:40px 0 64px; } .indlaeg p,.indlaeg li{ font-size:17px; } }
</style>`;

const filer = fs.readdirSync('raa').filter(f => f.endsWith('.json'));
fs.mkdirSync('blog/post', { recursive: true });
let n = 0;
const oversigt = [];

for (const f of filer) {
  const d = JSON.parse(fs.readFileSync('raa/' + f, 'utf8'));
  const html = '<!DOCTYPE html>\n<html lang="da">\n<head>\n'
    + nytHead(d).slice(nytHead(d).indexOf('<head>') + 6)
    + STIL + '\n</head>\n<body>\n' + nav + krop(d) + footer + '\n</body>\n</html>';
  fs.writeFileSync('blog/post/' + d.slug + '.html', html);
  oversigt.push({ slug: d.slug, titel: d.titel, beskrivelse: beskriv(d),
                  dato: (d.aendret||'').slice(0,10),
                  tegn: d.dele.reduce((s,x)=>s+x.s.length,0) });
  n++;
}
fs.writeFileSync('oversigt.json', JSON.stringify(oversigt, null, 1));
console.log('  %d indlæg bygget i blog/post/', n);
