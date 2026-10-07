// Gennemgaar alle links paa den danske side og de 28 blogindlaeg.
const fs = require('fs'), path = require('path');
const SIDE = '/Users/nickoskovgaard/voreshjem-site';
const BLOG = 'blog/post';

const filer = [];
fs.readdirSync(SIDE).filter(f=>f.endsWith('.html')).forEach(f=>filer.push([SIDE, f]));
fs.readdirSync(BLOG).filter(f=>f.endsWith('.html')).forEach(f=>filer.push([BLOG, f]));

const interne = new Map(), eksterne = new Map();
for (const [d, f] of filer) {
  const s = fs.readFileSync(path.join(d, f), 'utf8');
  for (const m of s.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(mailto:|tel:|#|data:|javascript:)/.test(u)) continue;
    if (/^https?:\/\//.test(u)) { (eksterne.get(u) || eksterne.set(u,[]).get(u)).push(f); }
    else { (interne.get(u) || interne.set(u,[]).get(u)).push(f); }
  }
}

console.log('  %d filer gennemgaaet', filer.length);
console.log('  %d interne, %d eksterne adresser\n', interne.size, eksterne.size);

console.log('  === INTERNE DER IKKE FINDES');
let d1 = 0;
for (const [u, brugt] of interne) {
  const ren = u.split('?')[0].split('#')[0];
  const p = ren.startsWith('/') ? path.join(SIDE, ren) : path.join(SIDE, ren);
  if (!fs.existsSync(p)) { console.log('    %-42s brugt i %s', ren.slice(0,42), brugt.slice(0,3).join(', ')); d1++; }
}
if (!d1) console.log('    ingen');
fs.writeFileSync('eksterne.json', JSON.stringify([...eksterne.keys()], null, 1));
console.log('\n  %d eksterne adresser gemt til kontrol', eksterne.size);
