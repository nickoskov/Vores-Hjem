// vh-blog.js – vedligehold af blogindlæg på voreshjem.dk (statiske HTML-filer)
// Kør uden --skriv først: så vises kun, hvad der VILLE blive ændret.
//
//   node vh-blog.js <site-mappe> saml                     [--skriv]
//   node vh-blog.js <site-mappe> opdateret <sti> [<sti>…] [--dato=ÅÅÅÅ-MM-DD] [--skriv]
//   node vh-blog.js <site-mappe> ryd-li                   [--skriv]
//   node vh-blog.js <site-mappe> css                      [--skriv]
//   node vh-blog.js <site-mappe> faktaboks                [--skriv]
//   node vh-blog.js <site-mappe> brodkrumme               [--skriv]
//
// <sti> er URL-stien uden skråstreg foran, fx  post/hvordan-laver-man-en-madplan-for-familien  eller  kalender
const fs = require("fs");
const path = require("path");

const BASE = "https://www.voreshjem.dk";
const [, , rodArg, kommando, ...rest] = process.argv;
const ROD = path.resolve(rodArg || ".");
const SKRIV = rest.includes("--skriv");
const args = rest.filter((a) => !a.startsWith("--"));
const datoArg = (rest.find((a) => a.startsWith("--dato=")) || "").slice(7);
const DATO = datoArg || new Date().toISOString().slice(0, 10);

// Gammel slug -> slug der overlever (samme liste som _redirects)
const SAML = {
  "delt-kalender-familie-giver-ro-i-hverdagen": "faelles-familiekalender-giver-ro-i-hverdagen",
  "familiekalender-for-travle-foraeldre-med-overblik": "faelles-familiekalender-giver-ro-i-hverdagen",
  "app-til-at-samle-familiens-aftaler-et-sted": "faelles-familiekalender-giver-ro-i-hverdagen",
  "familieapp-sammenligning-for-en-roligere-hverdag": "anmeldelse-af-danske-familieapps-hvad-virker",
  "familie-app-til-mere-ro-i-en-travl-hverdag": "bedste-apps-til-familielogistik-i-en-travl-hverdag",
  "boernepoint-til-daglige-opgaver-med-god-mening": "hvordan-fungerer-familiepoint-i-hverdagen",
  "boerneopgaver-og-beloenning-i-en-travl-hverdag": "hvordan-fungerer-familiepoint-i-hverdagen",
  "del-ansvar-mellem-foraeldre-uden-flere-paamindelser": "saadan-kan-familien-mindske-mental-load-hjemme",
  "faelles-indkoebsliste-app-til-en-lettere-hverdag": "saadan-deler-du-indkoebsliste-med-familien",
  "ugentlig-madplan-til-boernefamilie-med-mindre-boevl": "hvordan-laver-man-en-madplan-for-familien",
};

// Nye "Læs også"-lister (bruges kun i indlæg, hvor listen efter sammenlægningen linker til sig selv eller har dubletter)
const LÆS_OGSÅ = {
  "faelles-familiekalender-giver-ro-i-hverdagen": ["koordinere-boernenes-fritidsaktiviteter-uden-kaos", "alternativ-til-papir-familiekalender-for-familien", "hvordan-laver-man-en-madplan-for-familien"],
  "alternativ-til-papir-familiekalender-for-familien": ["faelles-familiekalender-giver-ro-i-hverdagen", "koordinere-boernenes-fritidsaktiviteter-uden-kaos", "begynderguide-til-digital-husstandsplanlaegning"],
  "koordinere-boernenes-fritidsaktiviteter-uden-kaos": ["faelles-familiekalender-giver-ro-i-hverdagen", "alternativ-til-papir-familiekalender-for-familien", "organiser-familiens-hverdagsrutiner"],
  "anmeldelse-af-danske-familieapps-hvad-virker": ["bedste-apps-til-familielogistik-i-en-travl-hverdag", "familieapp-med-gratis-proeveperiode-i-14-dage", "saadan-kan-familien-mindske-mental-load-hjemme"],
  "bedste-apps-til-familielogistik-i-en-travl-hverdag": ["anmeldelse-af-danske-familieapps-hvad-virker", "familieapp-med-gratis-proeveperiode-i-14-dage", "begynderguide-til-digital-husstandsplanlaegning"],
  "familieapp-med-gratis-proeveperiode-i-14-dage": ["anmeldelse-af-danske-familieapps-hvad-virker", "bedste-apps-til-familielogistik-i-en-travl-hverdag", "faelles-familiekalender-giver-ro-i-hverdagen"],
  "saadan-deler-du-indkoebsliste-med-familien": ["saadan-undgaar-familien-glemte-indkoeb-hjemme", "hvordan-laver-man-en-madplan-for-familien", "madplan-app-til-familie-giver-ro-om-aftensmaden"],
  "saadan-undgaar-familien-glemte-indkoeb-hjemme": ["saadan-deler-du-indkoebsliste-med-familien", "madplan-app-til-familie-giver-ro-om-aftensmaden", "hvordan-laver-man-en-madplan-for-familien"],
  "hvordan-laver-man-en-madplan-for-familien": ["madplan-app-til-familie-giver-ro-om-aftensmaden", "saadan-deler-du-indkoebsliste-med-familien", "saadan-undgaar-familien-glemte-indkoeb-hjemme"],
  "madplan-app-til-familie-giver-ro-om-aftensmaden": ["hvordan-laver-man-en-madplan-for-familien", "saadan-deler-du-indkoebsliste-med-familien", "faelles-familiekalender-giver-ro-i-hverdagen"],
};

// CSS til Kort fortalt, faktaboks, forfatter og brødkrumme (indsættes af kommandoen "css")
const CSS = `.kort-fortalt{margin:0 0 34px;padding:20px 24px;border-radius:16px;background:#F6F4FF;border:1px solid #E6E3F2;border-left:4px solid #6C47FF}
.hero-left .kort-fortalt{max-width:560px;margin:18px 0 24px}
.kort-fortalt p,.indlaeg .kort-fortalt p{font-size:16.5px;line-height:1.65;color:#2A2540;margin:0}
.kort-fortalt .kf-titel,.indlaeg .kort-fortalt .kf-titel{font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#4F32CC;margin:0 0 6px}
.fakta-vh{margin:40px 0 0;padding:22px 24px;border-radius:16px;background:#FAFAFF;border:1.5px solid #E6E4F2}
.fakta-vh .fv-titel,.indlaeg .fakta-vh .fv-titel{font-size:15px;font-weight:800;color:#1B1633;margin:0 0 10px}
.fakta-vh ul{margin:0;padding:0 0 0 18px}
.fakta-vh li,.indlaeg .fakta-vh li{font-size:15.5px;line-height:1.6;margin:0 0 6px}
.fakta-vh a{color:#4F32CC;font-weight:700}
.forfatter{margin:40px 0 0;padding:18px 0 0;border-top:1px solid #EFEDF8}
.forfatter p,.indlaeg .forfatter p{font-size:15.5px;line-height:1.6;color:#5E5A7A;margin:0}
.brodkrumme{margin:0 0 22px}
.brodkrumme ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.brodkrumme li,.indlaeg .brodkrumme li{font-size:14px;font-weight:700;line-height:1.4;margin:0;color:#5E5A7A}
.brodkrumme li+li::before{content:"\\203A";margin-right:6px;color:#C9C4E8}
.brodkrumme a{color:#6C47FF;text-decoration:none}
.brodkrumme a:hover{text-decoration:underline}`;

const læs = (f) => fs.readFileSync(f, "utf8");
const gem = (f, s) => { if (SKRIV) fs.writeFileSync(f, s, "utf8"); };
const rel = (f) => path.relative(ROD, f).replace(/\\/g, "/");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// URL-sti -> fil i deploy-mappen (sitet bruger rewrites i netlify.toml, fx /support -> kontakt.html)
const FIL = { indkobsliste: "indkob", support: "kontakt", "hvordan-sletter-man-sin-konto": "slet-konto" };
function fil(sti) {
  sti = sti.replace(/^\/+|\/+$/g, "");
  const m = sti.match(/^post\/(.+)$/);
  const kandidater = m ? [path.join(ROD, "blog", "post", m[1] + ".html")]
    : [path.join(ROD, (FIL[sti] || sti) + ".html"), path.join(ROD, sti, "index.html")];
  return kandidater.find((p) => fs.existsSync(p));
}

function htmlFiler(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return ["fonts", "images", "video", "node_modules", ".git"].includes(d.name) ? [] : htmlFiler(p);
    return d.name.endsWith(".html") ? [p] : [];
  });
}

function retLdJson(html, fn) {
  // Kalder fn(obj) for hver JSON-LD-blok; fn returnerer true, hvis blokken er ændret.
  let ændret = false;
  const ud = html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, (hel, a, json, b) => {
    let obj;
    try { obj = JSON.parse(json); } catch { return hel; }
    if (!fn(obj)) return hel;
    ændret = true;
    return a + JSON.stringify(obj) + b;
  });
  return { html: ud, ændret };
}

function saml() {
  const sammenlagteFiler = new Set(Object.keys(SAML).map((s) => path.join(ROD, "blog", "post", s + ".html")));
  for (const f of htmlFiler(ROD)) {
    if (sammenlagteFiler.has(f)) continue; // flyttes/slettes efter indholdet er flyttet
    let html = læs(f);
    const før = html;
    const noter = [];
    if (rel(f) === "blog.html") {
      for (const gammel of Object.keys(SAML)) {
        const kort = new RegExp(`\\s*<a class="bk" href="/post/${esc(gammel)}">[\\s\\S]*?</a>`);
        if (kort.test(html)) { html = html.replace(kort, ""); noter.push(`fjernet kort: ${gammel}`); }
      }
      html = retLdJson(html, (o) => {
        if (o["@type"] !== "Blog" || !Array.isArray(o.blogPost)) return false;
        const n = o.blogPost.length;
        o.blogPost = o.blogPost.filter((p) => !Object.keys(SAML).some((g) => p.url === `${BASE}/post/${g}`));
        if (o.blogPost.length !== n) noter.push(`fjernet ${n - o.blogPost.length} fra Blog-JSON-LD`);
        return o.blogPost.length !== n;
      }).html;
    } else {
      for (const [gammel, ny] of Object.entries(SAML)) {
        const re = new RegExp(`href=(["'])(?:${esc(BASE)})?/post/${esc(gammel)}(?:/|\\.html)?\\1`, "g");
        const antal = (html.match(re) || []).length;
        if (antal) { html = html.replace(re, `href=$1/post/${ny}$1`); noter.push(`${antal}× ${gammel} -> ${ny}`); }
      }
      // "Læs også" må ikke linke til indlægget selv eller have samme link to gange efter omskrivningen
      const m = rel(f).match(/^blog\/post\/(.+)\.html$/);
      const boks = html.match(/<section class="laes-ogsaa">[\s\S]*?<\/section>/);
      if (m && boks) {
        const hrefs = [...boks[0].matchAll(/<li><a href="\/post\/([^"]+)"/g)].map((x) => x[1]);
        const fejl = hrefs.includes(m[1]) || new Set(hrefs).size !== hrefs.length;
        if (fejl && LÆS_OGSÅ[m[1]]) {
          const li = LÆS_OGSÅ[m[1]].map((s) => {
            const h1 = (læs(path.join(ROD, "blog", "post", s + ".html")).match(/<h1>([\s\S]*?)<\/h1>/) || [, s])[1].trim();
            return `          <li><a href="/post/${s}">${h1}</a></li>`;
          });
          const nyBoks = boks[0].replace(/<ul>[\s\S]*?<\/ul>/, `<ul>\n${li.join("\n")}\n        </ul>`);
          html = html.replace(boks[0], nyBoks);
          noter.push(`"Læs også" erstattet: ${LÆS_OGSÅ[m[1]].join(", ")}`);
        } else if (fejl) {
          noter.push(`OBS: "Læs også" linker til sig selv eller har dubletter – ret i hånden`);
        }
      }
    }
    if (html !== før) { gem(f, html); }
    if (noter.length) console.log(`${rel(f)}\n  - ${noter.join("\n  - ")}`);
  }
  const sm = path.join(ROD, "sitemap.xml");
  if (fs.existsSync(sm)) {
    let x = læs(sm);
    let n = 0;
    for (const gammel of Object.keys(SAML)) {
      const re = new RegExp(`\\s*<url>\\s*<loc>${esc(BASE)}/post/${esc(gammel)}</loc>[\\s\\S]*?</url>`);
      if (re.test(x)) { x = x.replace(re, ""); n++; }
    }
    if (n) { gem(sm, x); console.log(`sitemap.xml\n  - fjernet ${n} URL'er`); }
  }
}

function opdateret() {
  if (!args.length) { console.log("Angiv mindst én sti, fx post/hvordan-laver-man-en-madplan-for-familien"); process.exit(1); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(DATO)) { console.log("--dato skal være ÅÅÅÅ-MM-DD"); process.exit(1); }
  const [å, mm, dd] = DATO.split("-");
  const sm = path.join(ROD, "sitemap.xml");
  let x = fs.existsSync(sm) ? læs(sm) : null;
  for (const sti of args.map((a) => a.replace(/^\/+|\/+$/g, ""))) {
    const f = fil(sti);
    if (!f) { console.log(`${sti}: fil ikke fundet`); continue; }
    const noter = [];
    let { html, ændret } = retLdJson(læs(f), (o) => {
      const knuder = Array.isArray(o["@graph"]) ? o["@graph"] : [o];
      const k = knuder.find((n) => ["BlogPosting", "Article", "WebPage"].includes(n["@type"]));
      if (!k) return false;
      k.dateModified = DATO;
      return true;
    });
    if (ændret) noter.push(`dateModified = ${DATO}`);
    else noter.push(`OBS: ingen BlogPosting/WebPage i JSON-LD – tilføj "dateModified" i hånden`);
    const metaRe = /(<div class="meta">\s*)(\d{2}\.\d{2}\.\d{4})(?: · Opdateret \d{2}\.\d{2}\.\d{4})?/;
    if (metaRe.test(html)) {
      html = html.replace(metaRe, `$1$2 · Opdateret ${dd}.${mm}.${å}`);
      noter.push(`synlig dato: Opdateret ${dd}.${mm}.${å}`);
    }
    gem(f, html);
    if (x !== null) {
      const loc = `${BASE}/${sti}`;
      const medLm = new RegExp(`(<loc>${esc(loc)}/?</loc>\\s*<lastmod>)[^<]*(</lastmod>)`);
      const udenLm = new RegExp(`(<loc>${esc(loc)}/?</loc>)(?!\\s*<lastmod>)`);
      if (medLm.test(x)) { x = x.replace(medLm, `$1${DATO}$2`); noter.push("sitemap lastmod opdateret"); }
      else if (udenLm.test(x)) { x = x.replace(udenLm, `$1\n    <lastmod>${DATO}</lastmod>`); noter.push("sitemap lastmod tilføjet"); }
      else noter.push(`OBS: ${loc} findes ikke i sitemap.xml`);
    }
    console.log(`${rel(f)}\n  - ${noter.join("\n  - ")}`);
  }
  if (x !== null) gem(sm, x);
}

function rydLi() {
  // Fjerner det løse <li>14. aug.</li>, der står lige efter metalinjen i de fleste indlæg
  const re = /(<div class="meta">[\s\S]*?<\/div>)\s*<li>\d{1,2}\. [a-zæøå]+\.?<\/li>/;
  const mappe = path.join(ROD, "blog", "post");
  for (const f of fs.readdirSync(mappe).filter((n) => n.endsWith(".html")).map((n) => path.join(mappe, n))) {
    const html = læs(f);
    if (re.test(html)) { gem(f, html.replace(re, "$1")); console.log(`${rel(f)}: løst <li> fjernet`); }
  }
}

function css() {
  // Indsætter <style id="geo-bokse"> før </head> i alle indlæg og de fem funktionssider (springer over, hvis den findes)
  const sider = ["kalender", "madplan", "indkobsliste", "opgaver", "synkronisering"].map((s) => fil(s));
  const indlæg = fs.readdirSync(path.join(ROD, "blog", "post")).filter((n) => n.endsWith(".html")).map((n) => path.join(ROD, "blog", "post", n));
  for (const f of [...indlæg, ...sider].filter((p) => fs.existsSync(p))) {
    const html = læs(f);
    if (html.includes('id="geo-bokse"') || !html.includes("</head>")) continue;
    gem(f, html.replace("</head>", `<style id="geo-bokse">\n${CSS}\n</style>\n</head>`));
    console.log(`${rel(f)}: CSS indsat`);
  }
}

const FAKTA = `<div class="fakta-vh">
        <p class="fv-titel">Fakta om Vores Hjem</p>
        <ul>
          <li>Dansk familieapp fra Vores Hjem I/S (CVR 45804445) i Middelfart.</li>
          <li>Fælles kalender med synkronisering fra telefonens kalender og Google, madplan der hænger sammen med indkøbslisten, delt indkøbsliste, opgaver, point og lommepenge til børn samt vagtplan med lønberegning.</li>
          <li>39 kr. pr. måned eller 199 kr. pr. halvår. Ét abonnement dækker op til 7 personer.</li>
          <li>14 dages gratis prøveperiode uden binding. Ingen reklamer.</li>
          <li>Børn kan logge ind med en familiekode uden e-mail.</li>
          <li>Til <a href="https://apps.apple.com/dk/app/vores-hjem/id6758346281">iPhone</a> og <a href="https://play.google.com/store/apps/details?id=com.voreshjem.app">Android</a>.</li>
        </ul>
      </div>
      `;

function faktaboks() {
  // Indsætter faktaboksen lige før slutkortet i alle indlæg (springer over, hvis den findes)
  const mappe = path.join(ROD, "blog", "post");
  for (const f of fs.readdirSync(mappe).filter((n) => n.endsWith(".html")).map((n) => path.join(mappe, n))) {
    const html = læs(f);
    if (Object.keys(SAML).some((s) => path.basename(f) === s + ".html")) continue; // skal væk
    if (html.includes('class="fakta-vh"') || !html.includes('<div class="slutkort">')) continue;
    gem(f, html.replace('<div class="slutkort">', FAKTA + '<div class="slutkort">'));
    console.log(`${rel(f)}: faktaboks indsat`);
  }
}

// Undersider -> navn i brødkrummen (URL-sti som i canonical)
const SIDER = {
  kalender: "Kalender", madplan: "Madplan", indkobsliste: "Indkøbsliste", opgaver: "Opgaver",
  synkronisering: "Kalender-synkronisering", support: "Support", indstillinger: "Indstillinger",
  "hvordan-bruger-jeg-appen": "Sådan bruger du appen", "hvordan-sletter-man-sin-konto": "Slet din konto",
  "presse/": "Presse", "hent/": "Hent appen", blog: "Blog",
};

function brodkrumme() {
  // Tilføjer BreadcrumbList-JSON-LD (alle indlæg + undersider) og synlig brødkrumme i indlæg (erstatter "‹ Alle indlæg")
  const ld = (punkter) => `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: punkter.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })),
  })}</script>\n`;
  const ren = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const opgaver = [];
  for (const n of fs.readdirSync(path.join(ROD, "blog", "post")).filter((n) => n.endsWith(".html"))) {
    const slug = n.slice(0, -5);
    if (SAML[slug]) continue; // skal væk
    opgaver.push({ f: path.join(ROD, "blog", "post", n), sti: `post/${slug}`, indlæg: true });
  }
  for (const sti of Object.keys(SIDER).filter((s) => s !== "blog")) {
    const f = [path.join(ROD, sti.replace(/\/$/, "") + ".html"), path.join(ROD, sti, "index.html")].find((p) => fs.existsSync(p));
    if (f) opgaver.push({ f, sti, indlæg: false });
  }
  for (const { f, sti, indlæg } of opgaver) {
    let html = læs(f);
    const noter = [];
    const titel = indlæg ? ren((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, sti])[1]) : SIDER[sti];
    const punkter = [["Forside", `${BASE}/`], ...(indlæg ? [["Blog", `${BASE}/blog`]] : []), [titel, `${BASE}/${sti}`]];
    if (!html.includes('"BreadcrumbList"') && html.includes("</head>")) {
      html = html.replace("</head>", ld(punkter) + "</head>");
      noter.push("BreadcrumbList-JSON-LD tilføjet");
    }
    const tilbage = /<a class=['"]tilbage['"] href=['"]\/blog['"]>[\s\S]*?<\/a>/;
    if (indlæg && tilbage.test(html)) {
      html = html.replace(tilbage, `<nav class="brodkrumme" aria-label="Brødkrumme">
        <ol>
          <li><a href="/">Forside</a></li>
          <li><a href="/blog">Blog</a></li>
          <li aria-current="page">${titel.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>
        </ol>
      </nav>`);
      noter.push("synlig brødkrumme indsat");
    }
    if (noter.length) { gem(f, html); console.log(`${rel(f)}: ${noter.join(", ")}`); }
  }
  // /blog har allerede en BreadcrumbList, men med "Forsiden" og "https://www.voreshjem.dk" (uden /).
  // Ret første led, så alle sider bruger samme form: "Forside" og "https://www.voreshjem.dk/".
  const blogF = path.join(ROD, "blog.html");
  if (fs.existsSync(blogF)) {
    const { html, ændret } = retLdJson(læs(blogF), (o) => {
      let rettet = false;
      for (const k of (Array.isArray(o["@graph"]) ? o["@graph"] : [o])) {
        if (k["@type"] !== "BreadcrumbList" || !Array.isArray(k.itemListElement)) continue;
        const e = k.itemListElement.find((x) => x.position === 1);
        if (e && [BASE, `${BASE}/`].includes(e.item) && (e.name !== "Forside" || e.item !== `${BASE}/`)) {
          e.name = "Forside"; e.item = `${BASE}/`; rettet = true;
        }
      }
      return rettet;
    });
    if (ændret) { gem(blogF, html); console.log(`blog.html: første led i BreadcrumbList rettet til "Forside" og ${BASE}/`); }
  }
}

const kommandoer = { saml, opdateret, "ryd-li": rydLi, css, faktaboks, brodkrumme };
if (!kommandoer[kommando]) { console.log("Kommandoer: saml | opdateret <sti…> | ryd-li | css | faktaboks | brodkrumme   (tilføj --skriv for at gemme)"); process.exit(1); }
kommandoer[kommando]();
console.log(SKRIV ? "\nGemt." : "\nTør-kørsel: intet er gemt. Kør igen med --skriv.");
