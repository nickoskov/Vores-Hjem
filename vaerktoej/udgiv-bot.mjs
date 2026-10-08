#!/usr/bin/env node
// Udgiver den danske chatbot (voreshjem-bot.netlify.app) fra repoets chatbot/.
//
//   node vaerktoej/udgiv-bot.mjs --tjek    kun tjek og lokal prøve, intet sendes til Netlify
//   node vaerktoej/udgiv-bot.mjs           prøveudgave + test (intet går live)
//   node vaerktoej/udgiv-bot.mjs --live    prøveudgave + test, og kun hvis den består: live + test
//
// Valg, der kun skal bruges med vilje:
//   --godkend-aendringer   chatbot/ er ændret siden gennemgangen (VERIFICERET). Kør alligevel.
//   --godkend-live         det, der ligger live, er ikke udgivet fra repoet. Overskriv alligevel.
//
// Sikkerhed, i den rækkefølge scriptet tjekker:
//  1. Repoet skal være rent i chatbot/ og lig med GitHub (intet bagud, intet upushet), så det udgivne altid
//     findes på GitHub. Udgivelsen får commit-nummeret som titel i Netlify.
//  2. chatbot/ skal være præcis den udgave, der er gennemgået (VERIFICERET nedenfor, se
//     "Vores Hjem (Claude)/chatbot_udgivelse_2026-10-09.md"). Er den ændret siden, stopper scriptet og viser hvad.
//     Når ændringerne er gennemgået: kør med --godkend-aendringer, og ret VERIFICERET bagefter.
//  3. Det, der ligger live, skal være enten den kendte udgave fra den gamle mappe (KENDT_LIVE) eller en
//     udgivelse fra dette script fra en commit, repoet kender. Ellers har nogen udgivet uden om repoet
//     (fx fra ~/voreshjem-bot), og scriptet stopper, så det ikke overskriver noget, ingen har set.
//  4. Funktionen indlæses lokalt uden nøgler og skal svare, før noget sendes til Netlify.
//  5. Prøveudgaven testes. Først når den består, lægges samme kode live (kun med --live), og live testes igen.
//
// Bygning: som den kørende udgave. Funktionen er i det gamle Lambda-format (exports.handler) og bundtes af
// netlify-cli med esbuild (node_bundler i chatbot/netlify.toml.fra-mac). Den kørende funktion er byte for byte
// det, netlify-cli bygger af chatbot/ (tjekket 9. okt. 2026), så der bundtes ikke selv som i udgiv-backend.mjs.
// chatbot/netlify.toml er Netlifys udfoldede kopi med stier fra Mac'en og bruges ikke.
//
// VIGTIGT: prøveudgaven får de samme hemmelige nøgler som live (DATABASE_URL, ANTHROPIC_API_KEY, SMTP_PASS),
// altså den rigtige database, den rigtige Claude-konto og den rigtige alarm-mail. Testene her læser kun.
// Skriv ikke i chatten på prøveudgaven, og brug ikke dens admin.html, medmindre det skal ramme de rigtige data.
//
// chatbot/ bruges også af den tyske backend (udgiv-backend.mjs --de). En rettelse her rammer den tyske bot,
// næste gang den tyske backend udgives.
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROD = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARG = process.argv.slice(2);
const LIVE = ARG.includes('--live');
const TJEK = ARG.includes('--tjek');
const GODKEND_AENDRINGER = ARG.includes('--godkend-aendringer');
const GODKEND_LIVE = ARG.includes('--godkend-live');

const SITE = { navn: 'voreshjem-bot', id: '1bfbc454-43f3-4117-b90d-6b824193e79e', url: 'https://voreshjem-bot.netlify.app' };
// Samme netlify-cli som ved gennemgangen. Dens esbuild gav byte for byte den kørende funktion.
const CLI = 'netlify-cli@27.12.0';

// chatbot/ som gennemgået 9. okt. 2026: træet fra commit a9e32ad (tysk bot via brug(), widget.js finder sin adresse).
const VERIFICERET = { commit: 'a9e32ad718dc97c5fd628ea99eafcf11abd92438', trae: '278ee6f37d5a4b132ee2c14a6544707a832f93b3' };
// Live, da scriptet blev skrevet: udgivet 6. okt. 2026 fra ~/voreshjem-bot. De statiske filer er dem i commit
// 9bbd261, og funktionen er byte for byte bygget af chatbot/netlify/functions/chat-bot.js fra samme commit.
const KENDT_LIVE = { deploy: '6ac50c1fd252f300becee5a8', kilde: '9bbd2613593aef62dd8497636c05b0a5db44a7e4' };
const TITEL = 'Udgivet fra repoet (chatbot) ';

// De filer, der ligger live, og dem der kun er kode og opsætning. Alt andet i chatbot/ stopper scriptet.
const STATISK = ['admin.html', 'avatar.png', 'avatar-de.png', 'hentknap.js', 'index.html', 'manifest.json', 'sw.js', 'widget.js'];
const KODE = ['netlify', 'netlify.toml', 'netlify.toml.fra-mac', 'package.json', 'package-lock.json'];
const NO_CACHE = ['admin.html', 'sw.js', 'widget.js']; // fra netlify.toml.fra-mac
// Klik-tælleren. "bot" i navnet gør, at botten ikke tæller testens kald som rigtige klik.
const UA = 'Mozilla/5.0 (compatible; vh-udgiv-bot-test; bot)';
const HENT_STIER = ['/hent/appstore', '/hent/googleplay', '/hent/website', '/hent/hentside', '/hent/app',
  '/hent/appstore?src=download', '/hent/appstore-de', '/hent/googleplay?site=de'];

const sh = (c, o = {}) => execSync(c, { cwd: ROD, stdio: 'pipe', encoding: 'utf8', ...o }).trimEnd();
let MIDL = null;
function stop(msg) {
  console.error('\nSTOP: ' + msg);
  if (MIDL) rmSync(MIDL, { recursive: true, force: true });
  process.exit(1);
}
const vent = (ms) => new Promise((r) => setTimeout(r, ms));
// Filerne tages fra commit'en, ikke fra mappen, så det udgivne er præcis det, der ligger på GitHub
// (også på Windows, hvor git kan have lavet linjeskift om i mappen).
const fraGit = (f) => execSync('git show HEAD:chatbot/' + f, { cwd: ROD, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const sha1 = (b) => createHash('sha1').update(b).digest('hex');

const kendteValg = new Set(['--tjek', '--live', '--godkend-aendringer', '--godkend-live']);
for (const a of ARG) if (!kendteValg.has(a)) stop('Ukendt valg: ' + a + '. Brug --tjek, --live, --godkend-aendringer eller --godkend-live.');
if (TJEK && LIVE) stop('--tjek og --live kan ikke bruges sammen.');
console.log('Den danske chatbot, ' + SITE.url + ' (Netlify: ' + SITE.navn + ')' + (TJEK ? ', kun tjek' : LIVE ? ', LIVE efter prøveudgaven' : ', kun prøveudgave'));

function token() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
  const steder = [
    process.env.APPDATA && join(process.env.APPDATA, 'netlify', 'Config', 'config.json'),
    join(homedir(), 'Library', 'Preferences', 'netlify', 'config.json'),
    join(homedir(), '.config', 'netlify', 'config.json'),
    join(homedir(), '.netlify', 'config.json'),
  ].filter(Boolean);
  for (const f of steder) {
    try { const c = JSON.parse(readFileSync(f, 'utf8')); const t = c.users?.[c.userId]?.auth?.token; if (t) return t; } catch {}
  }
  stop('Fandt ingen Netlify-login. Kør "npx netlify-cli login" først.');
}
const TOKEN = token();
async function api(p) {
  const r = await fetch('https://api.netlify.com/api/v1' + p, { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (!r.ok) stop('Netlify svarede ' + r.status + ' på ' + p);
  return r.json();
}
async function hent(url, opt = {}) {
  for (let i = 0; ; i++) {
    try { return await fetch(url, { redirect: 'manual', ...opt, headers: { 'user-agent': UA, ...(opt.headers || {}) } }); }
    catch (e) { if (i >= 2) return { status: 0, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' }; await vent(2000); }
  }
}

// ---------- 1. Repoet: rent og lig med GitHub ----------
try { sh('git fetch -q origin'); } catch { stop('Kunne ikke hente fra GitHub (git fetch). Er der net?'); }
try { sh('git rev-parse --abbrev-ref --symbolic-full-name @{u}'); } catch { stop('Grenen har ingen gren på GitHub at sammenligne med. Udgiv fra main.'); }
if (sh('git status --porcelain -- chatbot vaerktoej/udgiv-bot.mjs')) stop('chatbot/ eller udgiv-bot.mjs har ændringer, der ikke er committet.');
const bagud = Number(sh('git rev-list --count HEAD..@{u}'));
if (bagud) stop('Repoet mangler ' + bagud + ' ændring(er) fra GitHub. Kør "git pull" først.');
const foran = Number(sh('git rev-list --count @{u}..HEAD'));
if (foran) stop('Repoet har ' + foran + ' commit(s), der ikke er på GitHub. Kør "git push" først, så det udgivne findes på GitHub.');
const HEAD = sh('git rev-parse HEAD');

// ---------- 2. chatbot/ er den gennemgåede udgave ----------
const filer = sh('git ls-tree --name-only HEAD chatbot/').split('\n').map((f) => f.replace(/^chatbot\//, '')).filter(Boolean);
const alleFiler = sh('git ls-tree -r --name-only HEAD chatbot/').split('\n').map((f) => f.replace(/^chatbot\//, '')).filter(Boolean);
const ukendte = filer.filter((f) => !STATISK.includes(f) && !KODE.includes(f));
if (ukendte.length) stop('Ukendte filer i chatbot/: ' + ukendte.join(', ') + '. Skal de udgives, så skriv dem i STATISK i scriptet.');
const mangler = STATISK.filter((f) => !filer.includes(f));
if (mangler.length) stop('Mangler i chatbot/: ' + mangler.join(', ') + '. De ligger live og ville blive slettet.');
if (!alleFiler.includes('netlify/functions/chat-bot.js')) stop('chatbot/netlify/functions/chat-bot.js mangler.');
const trae = sh('git rev-parse HEAD:chatbot');
if (trae !== VERIFICERET.trae) {
  const hvad = sh('git diff --stat ' + VERIFICERET.commit + ' HEAD -- chatbot');
  if (!GODKEND_AENDRINGER) {
    stop('chatbot/ er ændret siden den gennemgåede udgave (commit ' + VERIFICERET.commit.slice(0, 7) + '):\n' + hvad +
      '\n\nSe ændringerne med: git diff ' + VERIFICERET.commit.slice(0, 7) + ' HEAD -- chatbot' +
      '\nNår de er gennemgået, så kør igen med --godkend-aendringer, og ret VERIFICERET i scriptet til den nye udgave.');
  }
  console.log('OBS: chatbot/ er ændret siden gennemgangen. Kører alligevel (--godkend-aendringer):\n' + hvad);
}

// ---------- 3. Live er udgivet fra repoet (eller den kendte udgave fra før) ----------
const site = await api('/sites/' + SITE.id);
const pd = site.published_deploy || {};
const FORRIGE = pd.id;
let liveKilde = null;
if (pd.id === KENDT_LIVE.deploy) {
  liveKilde = KENDT_LIVE.kilde;
  console.log('Live nu: udgaven fra 6. okt. 2026 (fra den gamle mappe), deploy ' + pd.id + '.');
} else if (String(pd.title || '').startsWith(TITEL)) {
  const c = String(pd.title).slice(TITEL.length).trim();
  if (/^[0-9a-f]{40}$/.test(c)) { try { sh('git merge-base --is-ancestor ' + c + ' HEAD'); liveKilde = c; } catch {} }
  if (liveKilde) console.log('Live nu: udgivet fra repoet, commit ' + c.slice(0, 7) + ', deploy ' + pd.id + '.');
}
// Filerne, der ligger live, holdes op mod repoet. Netlifys sha er sha1 af filens indhold.
const liveFiler = await api('/deploys/' + pd.id + '/files');
const liveSha = Object.fromEntries(liveFiler.map((f) => [String(f.path).replace(/^\//, ''), f.sha]));
const ekstra = Object.keys(liveSha).filter((f) => f !== 'netlify.toml' && !STATISK.includes(f));
const lokalSha = Object.fromEntries(STATISK.map((f) => [f, sha1(fraGit(f))]));
const aendres = STATISK.filter((f) => liveSha[f] !== lokalSha[f]);
let afvigelse = '';
if (!liveKilde) afvigelse = 'Det, der ligger live (deploy ' + pd.id + ', ' + pd.published_at + ', titel "' + (pd.title || 'ingen') + '"), er ikke udgivet fra repoet.';
else if (ekstra.length) afvigelse = 'Live har filer, som repoet ikke har: ' + ekstra.join(', ') + '. De ville blive slettet.';
if (afvigelse) {
  const msg = afvigelse + ' Nogen har udgivet uden om repoet, fx fra den gamle mappe ~/voreshjem-bot. Hent det ind i repoet først.';
  if (!GODKEND_LIVE) stop(msg + '\nSkal det overskrives alligevel: kør med --godkend-live.');
  console.log('OBS: ' + msg + ' Overskriver alligevel (--godkend-live).');
}
console.log('Statiske filer, der ændres: ' + (aendres.length ? aendres.join(', ') : 'ingen'));
if (liveKilde) {
  const kode = sh('git diff --stat ' + liveKilde + ' HEAD -- chatbot/netlify chatbot/package.json chatbot/package-lock.json chatbot/netlify.toml.fra-mac');
  console.log('Funktionen og opsætningen i forhold til live: ' + (kode ? '\n' + kode : 'uændret'));
}

// Sådan svarer live nu på klik-adresserne. Prøveudgaven og bagefter live skal svare præcis ens.
const FOER = {};
for (const s of HENT_STIER) {
  const r = await hent(SITE.url + s);
  FOER[s] = r.status + ' ' + (r.headers.get('location') || '');
  if (!r.status) stop(SITE.url + s + ' svarede ikke. Prøv igen, når botten svarer.');
}

// ---------- 4. Saml en midlertidig mappe og prøv funktionen lokalt ----------
MIDL = mkdtempSync(join(tmpdir(), 'vh-bot-'));
const U = MIDL;
const skriv = (til, f) => { mkdirSync(dirname(til), { recursive: true }); writeFileSync(til, fraGit(f)); };
for (const f of STATISK) skriv(join(U, 'public', f), f);
for (const f of alleFiler.filter((f) => f.startsWith('netlify/'))) skriv(join(U, f), f);
for (const f of ['package.json', 'package-lock.json']) skriv(join(U, f), f);
const toml = fraGit('netlify.toml.fra-mac').toString('utf8');
if (!/node_bundler\s*=\s*"esbuild"/.test(toml) || !/from\s*=\s*"\/hent\/\*"/.test(toml)) stop('chatbot/netlify.toml.fra-mac ser ikke ud som forventet (esbuild og /hent/*).');
writeFileSync(join(U, 'netlify.toml'), toml);
console.log('installerer afhængigheder ...');
try { sh('npm ci --silent --no-audit --no-fund', { cwd: U }); } catch (e) { stop('npm ci fejlede:\n' + (e.stderr || e.message)); }

// Uden nøgler: ingen database, ingen Claude, ingen mail. Kun at koden kan indlæses og svarer.
writeFileSync(join(U, 'lokal-proeve.cjs'), `
const h = require('./netlify/functions/chat-bot.js').handler;
(async () => {
  const a = await h({ httpMethod: 'GET', path: '/.netlify/functions/chat-bot', queryStringParameters: {}, headers: {} });
  const b = await h({ httpMethod: 'GET', path: '/hent/appstore', queryStringParameters: { go: 'appstore' }, headers: { 'user-agent': 'test bot' } });
  console.log(JSON.stringify({ a: a.statusCode, service: JSON.parse(a.body).service, b: b.statusCode, til: b.headers && b.headers.Location }));
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
`);
const renMiljoe = Object.fromEntries(['PATH', 'HOME', 'SystemRoot', 'TEMP', 'TMP'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
const lp = spawnSync(process.execPath, ['lokal-proeve.cjs'], { cwd: U, encoding: 'utf8', env: renMiljoe });
let lokal = null; try { lokal = JSON.parse(lp.stdout.trim().split('\n').pop()); } catch {}
if (lp.status !== 0 || !lokal || lokal.a !== 200 || lokal.service !== 'voreshjem chat' || lokal.b !== 302 || !/apps\.apple\.com\/dk\//.test(lokal.til || '')) {
  stop('Funktionen svarer ikke rigtigt lokalt:\n' + lp.stdout + lp.stderr);
}
rmSync(join(U, 'lokal-proeve.cjs'));
console.log('lokal prøve: funktionen indlæses og svarer (status og /hent/appstore).');
if (TJEK) {
  rmSync(U, { recursive: true, force: true });
  console.log('\nAlle tjek OK. Intet er sendt til Netlify. Kør uden --tjek for at lave en prøveudgave.');
  process.exit(0);
}

// ---------- 5. Udgiv og test ----------
function udgiv(prod) {
  const cmd = 'npx -y ' + CLI + ' deploy --no-build --skip-functions-cache --dir public --functions netlify/functions' +
    ' --site ' + SITE.id + ' --message "' + TITEL + HEAD + '" --json' + (prod ? ' --prod' : '');
  const r = spawnSync(cmd, { cwd: U, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  const ud = r.stdout || '';
  let j = null;
  try { j = JSON.parse(ud.slice(ud.indexOf('{'), ud.lastIndexOf('}') + 1)); } catch {}
  if (r.status !== 0 || !j || !j.deploy_id) stop((prod ? 'Live-udgivelsen' : 'Prøveudgaven') + ' fejlede:\n' + ud.slice(-3000) + '\n' + (r.stderr || '').slice(-3000));
  return j;
}

async function test(base, deployId, erLive) {
  const fejl = [], adv = [];
  // statiske filer: samme indhold som i repoet og de rigtige headere
  for (const f of STATISK) {
    const r = await hent(base + '/' + f);
    if (r.status !== 200) { fejl.push('/' + f + ': ' + r.status); continue; }
    const b = Buffer.from(await r.arrayBuffer());
    if (sha1(b) !== lokalSha[f]) fejl.push('/' + f + ': indholdet er ikke det samme som i repoet');
    if (!/noindex/i.test(r.headers.get('x-robots-tag') || '')) fejl.push('/' + f + ': mangler X-Robots-Tag noindex');
    if (NO_CACHE.includes(f) && !/no-cache/i.test(r.headers.get('cache-control') || '')) fejl.push('/' + f + ': mangler Cache-Control no-cache');
  }
  const forside = await hent(base + '/');
  if (forside.status !== 200) fejl.push('/: ' + forside.status);
  // funktionen. Lige efter en udgivelse kan den være et øjeblik om at svare.
  const FN = base + '/.netlify/functions/chat-bot';
  let st = null;
  for (let i = 0; i < 10 && !st; i++) {
    const r = await hent(FN);
    if (r.status === 200) { try { st = JSON.parse(await r.text()); } catch {} }
    if (!st) await vent(3000);
  }
  let medDb = false;
  if (!st || !st.ok || st.service !== 'voreshjem chat') fejl.push('funktionen svarer ikke som den danske bot: ' + JSON.stringify(st));
  else {
    const k = st.configured || {};
    const uden = ['anthropic', 'admin', 'smtp', 'database'].filter((x) => !k[x]);
    medDb = !!k.database;
    if (uden.length) (erLive ? fejl : adv).push('nøgler mangler for: ' + uden.join(', '));
  }
  const opt = await hent(FN, { method: 'OPTIONS' });
  if (opt.status !== 204) fejl.push('OPTIONS: ' + opt.status + ' (widgetten kan ikke kalde botten fra voreshjem.dk)');
  // klik-adresserne skal svare som live gjorde før udgivelsen
  for (const s of HENT_STIER) {
    const r = await hent(base + s);
    const nu = r.status + ' ' + (r.headers.get('location') || '');
    if (nu !== FOER[s]) (GODKEND_AENDRINGER ? adv : fejl).push(s + ': var "' + FOER[s] + '", nu "' + nu + '"');
  }
  // læser kun: en samtale, der ikke findes, giver en tom liste (og databasen svarer)
  if (medDb) {
    const r = await hent(FN, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'poll', conversationId: 'udgivtest' + randomBytes(8).toString('hex'), site: 'dk' }) });
    let d = null; try { d = await r.json(); } catch {}
    if (r.status !== 200 || !d || !Array.isArray(d.messages) || d.messages.length !== 0) fejl.push('poll: ' + r.status + ' ' + JSON.stringify(d));
  } else adv.push('databasen er ikke testet (ingen DATABASE_URL på denne udgave)');
  // admin uden adgangskode skal afvises
  const adm = await hent(FN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'admin_list', site: 'dk' }) });
  if (adm.status !== 401) fejl.push('admin uden adgangskode gav ' + adm.status + ', ikke 401');
  // Netlify skal have funktionen med
  const d = await api('/deploys/' + deployId);
  const fn = (d.available_functions || []).find((f) => f.n === 'chat-bot');
  if (!fn) fejl.push('Netlify har ingen chat-bot-funktion i udgivelsen');
  else console.log('funktion: chat-bot, ' + Math.round(fn.s / 1024) + ' KB, ' + fn.r + ', format ' + (fn.bd && fn.bd.runtimeAPIVersion));
  if (erLive) {
    const s2 = await api('/sites/' + SITE.id);
    if ((s2.published_deploy || {}).id !== deployId) fejl.push('live er ikke den nye udgivelse (' + (s2.published_deploy || {}).id + ')');
  }
  for (const a of adv) console.log('  OBS: ' + a);
  return fejl;
}

console.log('laver prøveudgave ...');
const kladde = udgiv(false);
const kladdeUrl = 'https://' + kladde.deploy_id + '--' + SITE.navn + '.netlify.app';
const fejlK = await test(kladdeUrl, kladde.deploy_id, false);
console.log('Prøveudgave: ' + kladdeUrl + ' (' + (fejlK.length ? fejlK.length + ' fejl' : 'alle test OK') + ')');
if (fejlK.length) stop('Prøveudgaven har fejl, intet er lagt live:\n  ' + fejlK.join('\n  '));
if (!LIVE) {
  console.log('\nIntet er lagt live. Kør igen med --live for at lægge samme kode live.');
  console.log('(Prøveudgaven bruger den rigtige database og mail. Skriv ikke i chatten på den.)');
  rmSync(U, { recursive: true, force: true });
  process.exit(0);
}

console.log('lægger live ...');
const ny = udgiv(true);
const fejlL = await test(SITE.url, ny.deploy_id, true);
rmSync(U, { recursive: true, force: true }); MIDL = null;
console.log('LIVE: ' + SITE.url + ' (deploy ' + ny.deploy_id + ', commit ' + HEAD.slice(0, 7) + ')');
console.log('Fortryd: åbn https://app.netlify.com/projects/' + SITE.navn + '/deploys/' + FORRIGE + ' og tryk "Publish deploy".');
console.log('Husk: chatbot/ bruges også af den tyske bot. Den får ændringerne ved node vaerktoej/udgiv-backend.mjs --de --live.');
if (fejlL.length) {
  console.log('\nFEJL på live (' + fejlL.length + '):\n  ' + fejlL.join('\n  '));
  console.log('Ret fejlen, eller fortryd med linket ovenfor.');
  process.exitCode = 1;
} else console.log('Alle test OK på live.');
