#!/usr/bin/env node
// Udgiver backend/ fra repoet. Samme kode er to backends, valgt med SIDE i Netlify (backend/netlify/lib/side.js):
// den danske (backend.voreshjem.dk) og med --de den tyske (backend.unserzuhauseapp.de). Hver har sin egen database.
//
//   node vaerktoej/udgiv-backend.mjs               den danske: prøveudgave + test (ikke live)
//   node vaerktoej/udgiv-backend.mjs --live        den danske: live + test
//   node vaerktoej/udgiv-backend.mjs --de          den tyske: prøveudgave + test
//   node vaerktoej/udgiv-backend.mjs --de --live   den tyske: live + test
//
// Den tyske kræver SIDE=de under Environment variables på unserzuhause-backend. Scriptet tjekker bagefter,
// at backenden svarer som den rigtige side, og at databasen er dens egen.
//
// Repoets backend/ har de udgivne filer i roden (index.html, images/ osv.) og koden i netlify/.
// Scriptet samler en midlertidig mappe: public/ med de udgivne filer, og hver funktion bundtet til
// én fil med alle afhængigheder (fn/). Funktionerne bruger Netlifys nye format, fordi det gamle
// højst tillader 4 KB miljøvariabler i alt. Konfigurationen kommer fra backend/netlify.toml.fra-mac.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROD = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.argv.includes('--live');
const DE = process.argv.includes('--de');
const MAAL = DE
  ? { kode: 'de', navn: 'den tyske backend', netlify: 'unserzuhause-backend', site: '571ab434-e15f-4851-a728-a3ed7169b3d1', url: 'https://backend.unserzuhauseapp.de' }
  : { kode: 'dk', navn: 'den danske backend', netlify: 'voreshjem-backend', site: 'd34e1582-bbea-4f03-91a9-f23119ea4a35', url: 'https://backend.voreshjem.dk' };
const SITE = MAAL.site;
console.log('Udgiver ' + MAAL.navn + ', ' + MAAL.url + ' (Netlify: ' + MAAL.netlify + ')' + (LIVE ? ', LIVE' : ', prøveudgave'));
const sh = (c, o = {}) => execSync(c, { stdio: 'pipe', encoding: 'utf8', ...o });

// repoet skal vaere opdateret og rent, saa det udgivne altid findes paa GitHub
sh('git fetch -q', { cwd: ROD });
if (sh('git status --porcelain backend', { cwd: ROD }).trim()) throw new Error('backend/ har ændringer, der ikke er committet.');
if (sh('git rev-list --count HEAD..@{u}', { cwd: ROD }).trim() !== '0') throw new Error('Repoet er bagud for GitHub. Kør git pull.');

const B = join(ROD, 'backend'), U = mkdtempSync(join(tmpdir(), 'vh-backend-'));
const KODE = new Set(['netlify', 'netlify.toml', 'netlify.toml.fra-mac', 'package.json', 'package-lock.json', 'OPSAETNING.md', 'node_modules', '.gitignore']);
mkdirSync(join(U, 'public'));
for (const x of readdirSync(B)) if (!KODE.has(x)) cpSync(join(B, x), join(U, 'public', x), { recursive: true });
cpSync(join(B, 'netlify'), join(U, 'netlify'), { recursive: true });
for (const f of ['package.json', 'package-lock.json']) cpSync(join(B, f), join(U, f));
writeFileSync(join(U, 'netlify.toml'), readFileSync(join(B, 'netlify.toml.fra-mac'), 'utf8').replace('functions = "netlify/functions"', 'functions = "fn"'));
console.log('installerer afhængigheder ...'); sh('npm ci --silent', { cwd: U });
mkdirSync(join(U, 'fn'));
for (const f of readdirSync(join(U, 'netlify', 'functions')).filter(f => f.endsWith('.mjs'))) {
  sh(`npx -y esbuild@0.25 netlify/functions/${f} --bundle --platform=node --format=esm --target=node20 --log-level=warning --outfile=fn/${f} ` +
     `--banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"`, { cwd: U });
}
console.log('bundtet:', readdirSync(join(U, 'fn')).join(', '));

const ud = JSON.parse(sh(`npx -y netlify-cli deploy ${LIVE ? '--prod ' : ''}--dir public --functions fn --site ${SITE} --json`, { cwd: U }));
rmSync(U, { recursive: true, force: true });
// live testes paa backendens eget domaene. Svarer det ikke endnu (fx DNS), bruges udgivelsens egen adresse.
let url = LIVE ? MAAL.url : ud.deploy_url, status;
try { status = await (await fetch(url + '/.netlify/functions/admin?d=status')).json(); }
catch (e) {
  if (!LIVE || !ud.deploy_url) throw e;
  console.log('(' + MAAL.url + ' svarede ikke: ' + e.message + '. Tester på ' + ud.deploy_url + ' i stedet.)');
  url = ud.deploy_url; status = await (await fetch(url + '/.netlify/functions/admin?d=status')).json();
}
const login = (await fetch(url + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"d":"oversigt"}' })).status;
const side = status.side || {}, o = status.opsat || {};
console.log(LIVE ? 'LIVE:' : 'Prøveudgave:', url);
console.log('status:', status.ok ? 'ok' : 'FEJL', '| side:', side.kode ? side.kode + ' (' + side.navn + ')' : 'ukendt', '| login kræves:', login === 401 ? 'ja' : 'NEJ (' + login + ')');
console.log('database:', o.database && !o.databaseFejl ? 'ok' : o.databaseFejl ? 'FEJL, ' + o.databaseFejl : 'ikke sat op');
if (side.kode !== MAAL.kode) {
  console.log('\nADVARSEL: backenden svarer som "' + (side.kode || 'ukendt') + '", men det her er ' + MAAL.navn + '.');
  console.log('Sæt SIDE=' + MAAL.kode + ' under Site configuration, Environment variables på ' + MAAL.netlify + ', og udgiv igen.');
  process.exitCode = 1;
}
if (!LIVE) console.log('(Hemmelige variabler gælder kun live, så de fleste står som false på prøveudgaven.)');
