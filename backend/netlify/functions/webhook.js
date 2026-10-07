'use strict';
/**
 * Tager imod blogindlæg udefra, i første række fra Soro.
 *
 * Soro skriver i dag direkte ind i Wix. Den forbindelse dør med flytningen,
 * og Soro siger ikke fra, den holder bare op med at udgive. Herefter peger
 * Soro i stedet på denne adresse:
 *
 *   https://<panelet>/webhook/soro?noegle=<WEBHOOK_SECRET>
 *
 * Nøglen sættes i Netlify som WEBHOOK_SECRET. Uden den tages intet imod,
 * ellers kunne hvem som helst lægge indhold på siden.
 */
const crypto = require('crypto');
const { sql, opret } = require('../lib/db.js');
const svar = (k, d) => ({ statusCode: k,
  headers: {'Content-Type':'application/json; charset=utf-8'}, body: JSON.stringify(d) });

function noegleOk(givet) {
  const vent = process.env.WEBHOOK_SECRET || '';
  if (!vent || !givet) return false;
  const a = crypto.createHash('sha256').update(String(givet)).digest();
  const b = crypto.createHash('sha256').update(vent).digest();
  return crypto.timingSafeEqual(a, b);
}

const slugify = s => String(s||'').toLowerCase().trim()
  .replace(/[^\wæøå\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').slice(0,80);

// Vi ved ikke præcis, hvad Soro kalder sine felter, og andre tjenester kalder
// dem noget tredje. Derfor ledes der efter det første navn, der findes.
const tag = (o, ...navne) => {
  for (const n of navne) {
    const v = n.split('.').reduce((a,d) => (a == null ? a : a[d]), o);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
};

// Kommer teksten som HTML, beholdes den. Kommer den som markdown eller ren
// tekst, laves afsnittene om til afsnit, så siden ser rigtig ud.
function tilHtml(t) {
  if (/<(p|h[1-6]|ul|ol|div|section)\b/i.test(t)) return t;
  return t.split(/\n{2,}/).map(a => {
    const l = a.trim();
    if (!l) return '';
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) return `<h${h[1].length + 1}>${h[2]}</h${h[1].length + 1}>`;
    return '<p>' + l.replace(/\n/g, '<br>') + '</p>';
  }).filter(Boolean).join('\n');
}

exports.handler = async (ev) => {
  if (ev.httpMethod !== 'POST') return svar(405, { fejl: 'brug POST' });
  const q = ev.queryStringParameters || {};
  const h = ev.headers || {};
  if (!noegleOk(q.noegle || h['x-webhook-noegle'] || h['x-webhook-key']))
    return svar(401, { fejl: 'forkert eller manglende nøgle' });
  if (!sql) return svar(500, { fejl: 'DATABASE_URL mangler i Netlify' });

  let k;
  try { k = JSON.parse(ev.body || '{}'); }
  catch (e) { return svar(400, { fejl: 'kroppen er ikke gyldig JSON' }); }

  const titel = tag(k, 'titel','title','headline','post.title','data.title');
  const brod  = tag(k, 'brod','html','content','body','post.content','data.content','markdown','text');
  if (!titel || !brod) return svar(400, {
    fejl: 'mangler titel eller indhold', saa_felter: Object.keys(k).slice(0, 20) });

  const slug = slugify(tag(k,'slug','post.slug','data.slug') || titel);
  const res  = tag(k, 'resume','excerpt','description','summary','post.excerpt').slice(0, 300);
  const bil  = tag(k, 'billede','image','featured_image','cover','thumbnail','post.image');
  // Kladde som udgangspunkt. Ingen udefra skal kunne lægge noget direkte på
  // siden uden at et menneske har set det. Sæt WEBHOOK_AUTOUDGIV=ja for at
  // udgive med det samme.
  const status = process.env.WEBHOOK_AUTOUDGIV === 'ja' ? 'udgivet' : 'kladde';

  await opret();

  const kilde = (ev.path || '').split('/').filter(Boolean).pop() || 'webhook';
  const r = await sql`
    INSERT INTO vh_blog (slug, titel, resume, brod, billede, status, kilde, udgivet, opdateret)
    VALUES (${slug}, ${titel}, ${res}, ${tilHtml(brod)}, ${bil}, ${status}, ${kilde},
            ${status === 'udgivet' ? new Date().toISOString() : null}, now())
    ON CONFLICT (slug) DO UPDATE SET
      titel=EXCLUDED.titel, resume=EXCLUDED.resume, brod=EXCLUDED.brod,
      billede=EXCLUDED.billede, opdateret=now()
    RETURNING id, slug, status`;

  try { await sql`INSERT INTO vh_log (hvad, detalje)
                  VALUES (${'indlæg modtaget fra ' + kilde}, ${slug})`; } catch (e) {}
  return svar(200, { modtaget: true, slug: r[0].slug, status: r[0].status });
};
