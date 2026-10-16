// Udgiv en af Vores Hjems sider sikkert fra repoet (virker på Windows og Mac).
//
//   node vaerktoej/udgiv.mjs <mappe>          laver kun en testudgave og tester den
//   node vaerktoej/udgiv.mjs <mappe> --live   ... og lægger den live, låser og pusher til GitHub
//
// Live-siderne er låst i Netlify, så "netlify deploy --prod" virker ikke. Det er meningen:
// så kan en gammel kopi på en anden computer aldrig overskrive det, der ligger live.
//
// Efter en vellykket --live af hjemmeside eller unserzuhause får Bing og de andre IndexNow-søgemaskiner
// besked om de adresser, der har fået ny dato (lastmod) i sitemappet, eller er fjernet fra det (fund S20).
// Nøglen ligger som <nøgle>.txt i mappens rod. Testudgaver meldes aldrig, og en fejl her giver kun en advarsel.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SIDER = {
  hjemmeside: { site: 'stirring-cactus-7010c5', domæne: 'www.voreshjem.dk', lås: true, indexnow: '1aa67f94de7bfcca67bd0150b9bfd22d' },
  unserzuhause: { site: 'verdant-strudel-af7a88', domæne: 'www.unserzuhauseapp.de', lås: true, indexnow: 'f632067aa17540dc99b30359ed39a594' },
  download: { site: 'voreshjem-download', domæne: 'download.voreshjem.dk', lås: false },
  'unserzuhause-download': { site: 'unserzuhause-download', domæne: 'download.unserzuhauseapp.de', lås: false },
};
const FORBUDT = {
  chatbot: 'chatbot/ udgives med node vaerktoej/udgiv-bot.mjs (den tager funktionen chat-bot med). En udgivelse herfra ville slette den.',
  backend: 'backend/ udgives med node vaerktoej/udgiv-backend.mjs (den bundter funktionerne). En udgivelse herfra ville slette dem.',
};

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [mappeArg, ...flag] = process.argv.slice(2);
const LIVE = flag.includes('--live');
const stop = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const navn = path.basename(path.resolve(REPO, mappeArg || ''));
if (FORBUDT[navn]) stop(FORBUDT[navn]);
const cfg = SIDER[navn];
if (!cfg) stop(`Angiv en af mapperne: ${Object.keys(SIDER).join(', ')}`);
const MAPPE = path.join(REPO, navn);

function token() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
  const steder = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'netlify', 'Config', 'config.json'),
    path.join(os.homedir(), 'Library', 'Preferences', 'netlify', 'config.json'),
    path.join(os.homedir(), '.config', 'netlify', 'config.json'),
    path.join(os.homedir(), '.netlify', 'config.json'),
  ].filter(Boolean);
  for (const f of steder) {
    try { const c = JSON.parse(fs.readFileSync(f, 'utf8')); const t = c.users?.[c.userId]?.auth?.token; if (t) return t; } catch {}
  }
  stop('Fandt ingen Netlify-login. Kør "netlify login" først.');
}
const TOKEN = token();
async function api(p, opt = {}) {
  const r = await fetch('https://api.netlify.com/api/v1' + p, { ...opt, headers: { Authorization: 'Bearer ' + TOKEN, ...(opt.headers || {}) } });
  if (!r.ok) stop(`Netlify svarede ${r.status} på ${p}`);
  return r.json();
}
const hent = async (url) => { try { const r = await fetch(url, { redirect: 'manual' }); return { status: r.status, tekst: r.status === 200 ? await r.text() : '' }; } catch (e) { return { status: 0, tekst: '' }; } };

// Sitemap som { adresse: lastmod }
function læsSitemap(xml) {
  const kort = new Map();
  for (const [, blok] of String(xml || '').matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = (blok.match(/<loc>\s*([^<\s]+)\s*<\/loc>/) || [])[1];
    if (loc) kort.set(loc.replace(/&amp;/g, '&'), (blok.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/) || [])[1] || '');
  }
  return kort;
}

// IndexNow (fund S20): kun adresser med ny lastmod, nye adresser og adresser, der er fjernet fra sitemappet
// (fx ved sammenlægninger, så søgemaskinen ser omdirigeringen). Aldrig hele sitemappet.
async function meldIndexNow(gammelt, nyt) {
  try {
    const førKort = læsSitemap(gammelt && gammelt.status === 200 ? gammelt.tekst : '');
    const efterKort = læsSitemap(nyt && nyt.status === 200 ? nyt.tekst : '');
    if (!førKort.size || !efterKort.size) { console.log('OBS: IndexNow sprunget over, fordi sitemappet før eller efter ikke kunne læses. Udgivelsen er ikke påvirket.'); return; }
    const vært = (u) => { try { return new URL(u).host; } catch { return ''; } };
    const urlList = [...new Set([
      ...[...efterKort].filter(([loc, lastmod]) => førKort.get(loc) !== lastmod).map(([loc]) => loc),
      ...[...førKort.keys()].filter((loc) => !efterKort.has(loc)),
    ])].filter((u) => vært(u) === cfg.domæne).slice(0, 10000);
    if (!urlList.length) { console.log('IndexNow: ingen adresser har fået ny dato i sitemappet, så der er ikke meldt noget.'); return; }
    const keyLocation = `https://${cfg.domæne}/${cfg.indexnow}.txt`;
    const nøgle = await fetch(keyLocation, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
      .then(async (r) => ({ status: r.status, tekst: r.status === 200 ? await r.text() : '' }))
      .catch(() => ({ status: 0, tekst: '' }));
    if (nøgle.status !== 200 || nøgle.tekst.trim() !== cfg.indexnow) { console.log(`OBS: IndexNow sprunget over, fordi nøglefilen ${keyLocation} ikke svarer rigtigt (status ${nøgle.status}). Udgivelsen er ikke påvirket.`); return; }
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: cfg.domæne, key: cfg.indexnow, keyLocation, urlList }),
      signal: AbortSignal.timeout(20000),
    });
    if (r.status === 200 || r.status === 202) console.log(`IndexNow: ${urlList.length} ændrede adresse(r) meldt til Bing m.fl. (svar ${r.status}).`);
    else console.log(`OBS: IndexNow svarede ${r.status}. Udgivelsen er ikke påvirket, og adresserne findes stadig via sitemappet.`);
  } catch (e) {
    console.log(`OBS: IndexNow fejlede (${e && e.message ? e.message : e}). Udgivelsen er ikke påvirket.`);
  }
}

// 1. Repoet skal være opdateret med GitHub, og der må ikke ligge andres ændringer, vi ikke har
try { sh('git fetch -q origin'); } catch { stop('Kunne ikke hente fra GitHub (git fetch). Er der net, og er repoet klonet?'); }
const bagud = Number(sh('git rev-list --count HEAD..@{u}'));
if (bagud > 0) stop(`Repoet mangler ${bagud} ændring(er) fra GitHub. Kør "git pull" først.`);

// 2. Live må ikke være nyere end repoet
const versionFil = path.join(MAPPE, 'vh-version.txt');
const lokal = fs.existsSync(versionFil) ? fs.readFileSync(versionFil, 'utf8').trim() : '';
const live = await hent(`https://${cfg.domæne}/vh-version.txt`);
if (live.status === 200 && lokal < live.tekst.trim()) stop(`${cfg.domæne} har version ${live.tekst.trim()}, men repoet har ${lokal || 'ingen'}. Nogen har udgivet uden om repoet. Hent deres ændringer ind først.`);
// Sitemappet, som det ligger live nu, så IndexNow bagefter kun får de adresser, der er ændret
const gammeltSitemap = LIVE && cfg.indexnow ? await hent(`https://${cfg.domæne}/sitemap.xml`) : null;

// 3. Ny version og testudgave
const nu = new Date();
const ny = `${nu.getFullYear()}${String(nu.getMonth() + 1).padStart(2, '0')}${String(nu.getDate()).padStart(2, '0')}-${String(nu.getHours()).padStart(2, '0')}${String(nu.getMinutes()).padStart(2, '0')}`;
fs.writeFileSync(versionFil, ny + '\n');
const besked = `Udgivet fra repoet, version ${ny}`;
console.log(`Laver testudgave af ${cfg.domæne} (version ${ny}) ...`);
const res = spawnSync(`netlify deploy --no-build --dir "${MAPPE}" --site ${cfg.site} --message "${besked}" --json`, { shell: true, encoding: 'utf8', cwd: MAPPE });
const id = (res.stdout.match(/"deploy_id":\s*"([0-9a-f]+)"/) || [])[1];
if (!id) { fs.writeFileSync(versionFil, lokal ? lokal + '\n' : ''); stop(`Testudgaven fejlede:\n${res.stdout}\n${res.stderr}`); }
const kladde = `https://${id}--${cfg.site}.netlify.app`;

// 4. Test: alle sider i sitemap og forsiden skal svare 200 på testudgaven, hvis de gør det live
const sm = await hent(`${kladde}/sitemap.xml`);
const stier = ['/', ...[...sm.tekst.matchAll(/<loc>https?:\/\/[^/<]+([^<]*)<\/loc>/g)].map((m) => m[1] || '/')];
const fejl = [];
for (const s of [...new Set(stier)]) {
  const [a, b] = await Promise.all([hent(`https://${cfg.domæne}${s}`), hent(`${kladde}${s}`)]);
  if (b.status !== 200 && a.status === 200) fejl.push(`${s}: live ${a.status}, test ${b.status}`);
}
console.log(`Testet ${new Set(stier).size} adresser på testudgaven: ${fejl.length ? fejl.length + ' fejl' : 'alle OK'}`);
if (fejl.length) stop(`Testudgaven har fejl, intet er lagt live:\n  ${fejl.join('\n  ')}\nTestudgave: ${kladde}`);
if (!LIVE) { console.log(`\nTestudgave: ${kladde}\nSe den igennem, og kør igen med --live for at lægge den live.`); process.exit(0); }

// 5. Læg live og hold låsen på
const site = await api(`/sites/${cfg.site}.netlify.app`);
await api(`/sites/${site.id}/deploys/${id}/restore`, { method: 'POST' });
if (cfg.lås) await api(`/deploys/${id}/lock`, { method: 'POST' });
const efter = await hent(`https://${cfg.domæne}/vh-version.txt`);
console.log(`Live på https://${cfg.domæne} (version ${efter.tekst.trim() || ny})${cfg.lås ? ', låst' : ''}.`);

// 6. Gem i GitHub, så den anden computer får det samme
sh(`git add -A "${navn}"`);
if (sh('git diff --cached --name-only')) {
  sh(`git commit -q -m "${besked} (${cfg.domæne})"`);
  try { sh('git push -q'); console.log('Gemt og pushet til GitHub.'); } catch { console.log('OBS: Commit lavet, men push fejlede. Kør "git push".'); }
}

// 7. IndexNow: meld de ændrede adresser til Bing m.fl. Kun efter --live, aldrig for testudgaver.
// Sidst, så et langsomt svar aldrig forsinker commit og push. Alt er pakket ind, så en fejl kun giver en advarsel.
if (cfg.indexnow) await meldIndexNow(gammeltSitemap, sm);
