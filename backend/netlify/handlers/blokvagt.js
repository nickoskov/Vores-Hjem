'use strict';
/**
 * Blokeringsvagt. Hver morgen slaas sidens adresser op gennem DNS-tjenester, der filtrerer farlige sider
 * (dem, som internetudbydere, firmaer og skoler bygger deres filtre paa), og Google Safe Browsing tjekkes.
 * 16. sept. 2026 blokerede YouSee/TDC's filter (Whalebone) hele voreshjem.dk dagen efter flytningen, og
 * det var en kunde, der opdagede det. Nu faar teamet en mail samme morgen, en adresse bliver blokeret et
 * sted, og igen, naar den er fri.
 *
 * Blokeret betyder: filteret svarer "findes ikke" eller "afvist", mens Googles almindelige DNS finder
 * adressen, eller filteret svarer med en adresse, der ikke viser siden (et sinkhul eller filterets egen
 * blokeringsside). En anden IP-adresse end Googles er ikke i sig selv en fejl, fordi Netlify svarer med
 * forskellige adresser alt efter, hvor spoergsmaalet kommer fra. Derfor proeves en ukendt adresse direkte:
 * viser den siden med et gyldigt certifikat, er alt i orden.
 * Internetudbydernes egne filtre (fx Whalebone hos YouSee) kan ikke spoerges udefra, kun de offentlige.
 */
const dns = require('dns');
const https = require('https');
const mail = require('../lib/mail.js');
const K = require('../lib/koersel.js');
const profil = require('../lib/side.js');
const { sql, opret, log } = require('../lib/db.js');

const FILTRE = [
  { navn: 'Quad9', ip: '9.9.9.9' },
  { navn: 'DNS4EU (EU-kommissionens)', ip: '86.54.11.1' },
  { navn: 'Cloudflare, sikker', ip: '1.1.1.2' },
  { navn: 'CleanBrowsing', ip: '185.228.168.9' },
  { navn: 'OpenDNS', ip: '208.67.222.222' },
  { navn: 'Comodo Secure DNS', ip: '8.26.56.26' },
  { navn: 'AdGuard', ip: '94.140.14.14' }
];
const KONTROL = '8.8.8.8';
// svar, der aldrig er den rigtige side: tomme, lokale og private net
const SINKHUL = /^(0\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

function opslag(server, navn) {
  const r = new dns.promises.Resolver({ timeout: 3000, tries: 1 });
  r.setServers([server]);
  return r.resolve4(navn).then(ip => ({ ip }), e => ({ fejl: e.code || String(e.message || e) }));
}

/** Viser denne IP siden med gyldigt certifikat for navnet? */
function viserSiden(ip, navn) {
  return new Promise(ok => {
    const q = https.request({ host: ip, servername: navn, path: '/', method: 'HEAD', timeout: 5000,
      headers: { Host: navn, 'User-Agent': 'VoresHjem-blokvagt/1.0' } }, s => { s.resume(); ok(s.statusCode < 500); });
    q.on('timeout', () => { q.destroy(); ok(false); });
    q.on('error', () => ok(false));
    q.end();
  });
}

async function safeBrowsing(navn) {
  try {
    const r = await fetch('https://transparencyreport.google.com/transparencyreport/api/v3/safebrowsing/status?site=' + encodeURIComponent(navn),
      { signal: AbortSignal.timeout(6000) });
    const t = await r.text();
    const d = JSON.parse(t.slice(t.indexOf('[')));
    const status = d[0][1];
    // 2 = farligt indhold, 3 = nogle sider farlige. 1 = intet fundet, 6 = ikke vurderet endnu
    return { status, blokeret: status === 2 || status === 3 };
  } catch (e) { return { status: null, fejl: 'kunne ikke tjekkes' }; }
}

/** Alle adresser gennem alle filtre. Returnerer fundne blokeringer og hvad der ikke kunne tjekkes. */
async function tjekAlt() {
  const fund = [], usikre = [], sprunget = [], tjekket = [];
  await Promise.all(profil.vagtAdresser.map(async navn => {
    const kontrol = await opslag(KONTROL, navn);
    if (!kontrol.ip) { sprunget.push(navn + ' (findes ikke i almindelig DNS: ' + kontrol.fejl + ')'); return; }
    tjekket.push(navn);
    const svar = await Promise.all(FILTRE.map(f => opslag(f.ip, navn).then(s => ({ f, s }))));
    for (const { f, s } of svar) {
      if (!s.ip) {
        if (s.fejl === 'ENOTFOUND' || s.fejl === 'ENODATA' || s.fejl === 'EREFUSED') fund.push({ navn, filter: f.navn, hvordan: 'svarer at adressen ikke findes (' + s.fejl + ')' });
        else usikre.push(navn + ' hos ' + f.navn + ': ' + s.fejl);
        continue;
      }
      const ukendte = s.ip.filter(ip => !kontrol.ip.includes(ip));
      if (s.ip.some(ip => SINKHUL.test(ip))) { fund.push({ navn, filter: f.navn, hvordan: 'svarer med ' + s.ip.join(', ') + ' i stedet for siden' }); continue; }
      if (ukendte.length && !(await viserSiden(ukendte[0], navn))) fund.push({ navn, filter: f.navn, hvordan: 'sender til ' + ukendte[0] + ', som ikke viser siden' });
    }
    const sb = await safeBrowsing(navn);
    if (sb.blokeret) fund.push({ navn, filter: 'Google Safe Browsing', hvordan: 'markerer siden som farlig (status ' + sb.status + ')' });
    else if (sb.fejl) usikre.push(navn + ' hos Google Safe Browsing: ' + sb.fejl);
  }));
  // i profilens raekkefoelge, ikke i den raekkefoelge opslagene blev faerdige
  return { fund, usikre, sprunget, tjekket: profil.vagtAdresser.filter(n => tjekket.includes(n)) };
}

const noegle = f => f.navn + '|' + f.filter;
const liste = l => '<ul>' + l.map(f => '<li><b>' + f.navn + '</b> hos ' + f.filter + ': ' + f.hvordan + '</li>').join('') + '</ul>';

exports.handler = async () => {
  const r = await tjekAlt();
  if (!sql) return { statusCode: 200, body: JSON.stringify(r) };
  await opret();
  if (!(await K.foersteGang('blokvagt', K.dansk().dato))) return { statusCode: 200, body: 'blokeringsvagten har allerede koert i dag' };
  // sidste koersels blokeringer, saa der kun skrives, naar noget har aendret sig
  let foer = [];
  try { const g = await sql`SELECT vaerdi FROM vh_cache WHERE noegle = 'blokvagt-sidst'`; foer = (g[0] && g[0].vaerdi && g[0].vaerdi.fund) || []; } catch (e) {}
  const nu = new Set(r.fund.map(noegle)), gl = new Set(foer.map(noegle));
  const nye = r.fund.filter(f => !gl.has(noegle(f))), fri = foer.filter(f => !nu.has(noegle(f)));
  // panelets Oppetid viser det gemte: hvornaar, hvad der blev tjekket (filtre og adresser), hvad der blev fundet,
  // og hvad der ikke kunne tjekkes. Noeglen har ingen udgave foran, saa cache.js ikke rydder den som en gammel cache.
  const gem = { fund: r.fund, hvornaar: new Date().toISOString(), filtre: [...FILTRE.map(f => f.navn), 'Google Safe Browsing'],
    adresser: r.tjekket, usikre: r.usikre, sprunget: r.sprunget };
  try {
    await sql`INSERT INTO vh_cache (noegle, vaerdi, udloeber) VALUES ('blokvagt-sidst', ${JSON.stringify(gem)}::jsonb, now() + interval '400 days')
      ON CONFLICT (noegle) DO UPDATE SET vaerdi = EXCLUDED.vaerdi, udloeber = EXCLUDED.udloeber`;
  } catch (e) {}
  if (nye.length) await mail.send(profil.navn + ' er blokeret hos ' + [...new Set(nye.map(f => f.filter))].join(', '),
    '<p><b>Blokeringsvagten har fundet en blokering af ' + profil.navn + '.</b></p>' + liste(nye) +
    '<p>Folk, der bruger det filter (via deres internetudbyder, arbejde, skole eller et sikkerhedsprogram), kan ikke åbne siden. ' +
    'Filteret har typisk taget fejl efter et skift af hosting eller adresser. Skriv til filterets support og bed om at få siden fjernet som falsk positiv: ' +
    'siden tilhører Vores Hjem I/S, CVR 45804445, og appen ligger i App Store og Google Play.</p>' +
    (r.fund.length > nye.length ? '<p>Stadig blokeret fra før:</p>' + liste(r.fund.filter(f => gl.has(noegle(f)))) : '')).catch(() => {});
  if (fri.length) await mail.send(profil.navn + ' er ikke længere blokeret' + (r.fund.length ? ' alle steder' : ''),
    '<p><b>Disse blokeringer er væk:</b></p>' + liste(fri) + (r.fund.length ? '<p>Stadig blokeret:</p>' + liste(r.fund) : '<p>Siden er fri hos alle de filtre, vagten tjekker.</p>')).catch(() => {});
  await log('blokeringsvagt', (r.fund.length ? r.fund.length + ' blokeringer: ' + r.fund.map(noegle).join('; ').slice(0, 300) : 'ingen blokeringer, ' + FILTRE.length + ' filtre og Google Safe Browsing')
    + (r.usikre.length ? '. Kunne ikke tjekkes: ' + r.usikre.length : '') + (r.sprunget.length ? '. Sprunget over: ' + r.sprunget.join('; ').slice(0, 160) : ''), 'blokvagt');
  return { statusCode: 200, body: JSON.stringify({ ...r, nye: nye.length, fri: fri.length }) };
};
