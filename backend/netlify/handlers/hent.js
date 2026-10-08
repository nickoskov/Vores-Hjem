'use strict';
/**
 * Hent-knappen: /hent/app sender en telefon til sin butik (iPhone til App Store, Android til
 * Google Play) og en computer til hent-siden. /hent/appstore og /hent/googleplay gaar direkte.
 * Adresserne staar i profilen (side.js, butik), saa hver backend kun sender til sin egen app.
 *
 * Trykket taelles i vh_klik, i backendens egen database, ligesom taelleren goer, uden cookies og
 * med samme gaeste-id. Kun tryk fra sidens egne sider taelles (henvisningen skal vaere profilens),
 * og robotter taelles ikke. Siden kan give ?sted= med (afsnittet, knappen sad i).
 * Viderestillingen sker altid, ogsaa hvis taellingen fejler.
 */
const { sql } = require('../lib/db.js');
const profil = require('../lib/side.js');
const { maerk, tabel } = require('./taeller.js');

const vaert = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };
const videre = url => ({ statusCode: 302, body: '', headers: { Location: url, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

exports.handler = async (ev) => {
  const h = ev.headers || {};
  const q = ev.queryStringParameters || {};
  const m = String(ev.path || '').match(/\/hent\/([a-z]+)/i);
  const hvad = String((m && m[1]) || q.go || 'app').toLowerCase();
  const { ua, robot, enhed, gaest } = maerk(h);
  const butik = hvad === 'appstore' || hvad === 'googleplay' ? hvad
    : /iPhone|iPad|iPod/i.test(ua) ? 'appstore' : /Android/i.test(ua) ? 'googleplay' : 'hentside';
  const maal = profil.butik[butik] || profil.butik.hentside;
  const fra = h.referer || '';
  if (sql && !robot && profil.tilladt.test(vaert(fra))) {
    try {
      await tabel();
      let sti = '/'; try { sti = decodeURIComponent(new URL(fra).pathname || '/').slice(0, 200); } catch (e) {}
      const sted = String(q.sted || '').replace(/[^\wÀ-ſ .:-]/g, '').slice(0, 60);
      await sql`INSERT INTO vh_klik (sti, sted, butik, enhed, gaest) VALUES (${sti}, ${sted}, ${butik}, ${enhed}, ${gaest})`;
    } catch (e) { /* knappen maa aldrig fejle for den besoegende */ }
  }
  return videre(maal);
};
