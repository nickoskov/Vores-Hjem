'use strict';
/** To-trins login med engangskoder fra en telefon-app (Google Authenticator, 1Password, Apple Adgangskoder). Standard TOTP, 30 sekunder, 6 cifre. */
const crypto = require('crypto');
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) { let bits = '', ud = ''; for (const b of buf) bits += b.toString(2).padStart(8,'0'); for (let i = 0; i + 5 <= bits.length; i += 5) ud += A[parseInt(bits.slice(i,i+5),2)]; return ud; }
function fraBase32(s) { let bits = ''; for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g,'')) bits += A.indexOf(c).toString(2).padStart(5,'0'); const ud = []; for (let i = 0; i + 8 <= bits.length; i += 8) ud.push(parseInt(bits.slice(i,i+8),2)); return Buffer.from(ud); }
function kode(hemmelighed, t) {
  const trin = Math.floor((t || Date.now()) / 30000);
  const buf = Buffer.alloc(8); buf.writeUInt32BE(Math.floor(trin / 4294967296), 0); buf.writeUInt32BE(trin >>> 0, 4);
  const h = crypto.createHmac('sha1', fraBase32(hemmelighed)).update(buf).digest();
  const o = h[19] & 0xf;
  return String(((h[o] & 0x7f) << 24 | h[o+1] << 16 | h[o+2] << 8 | h[o+3]) % 1000000).padStart(6, '0');
}
/** Tillader et trin til hver side, saa et ur der gaar lidt forkert ikke laaser nogen ude. */
function passer(hemmelighed, givet) {
  const g = String(givet || '').replace(/\D/g, ''); if (g.length !== 6) return false;
  const nu = Date.now();
  return [-1, 0, 1].some(d => { const k = kode(hemmelighed, nu + d*30000); return k.length === g.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(g)); });
}
const ny = () => base32(crypto.randomBytes(20));
const url = (navn, hemmelighed) => 'otpauth://totp/' + encodeURIComponent('Vores Hjem backend:' + navn) + '?secret=' + hemmelighed + '&issuer=' + encodeURIComponent('Vores Hjem') + '&digits=6&period=30';
module.exports = { kode, passer, ny, url };
