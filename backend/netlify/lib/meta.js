'use strict';
/**
 * Annonceforbrug fra Meta (Facebook og Instagram).
 * Kraever META_ACCESS_TOKEN (systembruger-token med ads_read) og META_AD_ACCOUNT_ID
 * (tallet, med eller uden "act_"). Begge saettes i Netlify og kommer aldrig i chat.
 * META_API_VERSION kan saettes, naar Meta lukker for versionen herunder.
 *
 * Kampagnerne hedder et ID i Google Analytics (utm_campaign={{campaign.id}}), derfor
 * hentes campaign_id med (kampagneId), saa panelet kobler paa ID og ikke kun paa navn.
 * klik = klikAlle er Metas "Klik (alle)": ogsaa reaktioner, profilklik og "se mere".
 * linkKlik er klik ud til siden (inline_link_clicks), som kan sammenlignes med besoeg.
 * Meta regner dagene i annoncekontoens tidszone.
 *
 * Fejler Meta, kastes altid en fejl, aldrig en tom liste, saa forbruget bliver ukendt
 * og ikke 0 kr. Fejlens form: e.message = 'Meta: <kort>' (saa admin.js fejlObj kender
 * kilden), e.tekst = 'Meta svarede ikke: <kort>', e.kilde = 'meta', e.raa = Metas raa
 * besked, og evt. e.kode, e.http og e.ikkeKoblet.
 */
const E = process.env;
const VERSION = E.META_API_VERSION || 'v21.0';
const TOKEN = () => E.META_ACCESS_TOKEN || '';
const KONTO = () => (E.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
const opsat = () => !!(TOKEN() && KONTO());

/** Om Meta er koblet paa, til visning under "Brugt paa annoncer". */
const status = () => opsat()
  ? { kilde: 'meta', navn: 'Meta', koblet: true, tekst: 'Meta er koblet på.' }
  : { kilde: 'meta', navn: 'Meta', koblet: false, tekst: 'Meta er ikke koblet på, så Meta-annoncernes forbrug er ikke med i tallet.' };

const gyldigDato = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const UKENDT = ' Annonceforbruget er derfor ukendt, ikke 0 kr.';
/** kort: det der staar efter 'Meta: ' */
function fejl(kort, raa, ekstra) {
  const e = new Error('Meta: ' + kort);
  e.kilde = 'meta'; e.raa = raa || ''; e.tekst = 'Meta svarede ikke: ' + kort;
  Object.assign(e, ekstra || {});
  return e;
}

/** Henter og laeser JSON med tidsgraense. Kaster en dansk fejl, hvis Meta ikke kan naas. */
async function hentJson(url) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
  let r, krop;
  try { r = await fetch(url, { signal: c.signal }); krop = await r.text(); }
  catch (e) {
    const raa = String((e && e.message) || e).slice(0, 200);
    throw fejl((c.signal.aborted ? 'gav intet svar inden for 20 sekunder.' : 'kunne ikke nås (' + raa + ').') + UKENDT, raa);
  } finally { clearTimeout(t); }
  let d = null; try { d = JSON.parse(krop); } catch (e) {}
  return { r, d, krop: krop || '' };
}

const tal = v => v == null || v === '' ? null : (Number(v) || 0);

/**
 * Forbrug pr. kampagne fra fra til til (danske datoer 'YYYY-MM-DD', begge med).
 * Raekker: { kampagne, kampagneId, forbrug, valuta, visninger, klik, klikAlle, linkKlik,
 *            naaet, installs, kilde:'meta' }. forbrug og linkKlik er null, hvis Meta ikke sendte feltet.
 */
async function forbrug(fra, til) {
  if (!opsat()) throw fejl('ikke koblet på (META_ACCESS_TOKEN eller META_AD_ACCOUNT_ID mangler i Netlify).' + UKENDT, '', { ikkeKoblet: true, tekst: 'Meta er ikke koblet på.' + UKENDT });
  if (!gyldigDato(fra) || !gyldigDato(til) || fra > til) throw fejl('ugyldig periode ' + fra + ' til ' + til + '.', '');
  const u = new URL(`https://graph.facebook.com/${VERSION}/act_${KONTO()}/insights`);
  u.searchParams.set('level', 'campaign');
  u.searchParams.set('fields', 'campaign_id,campaign_name,spend,account_currency,impressions,clicks,inline_link_clicks,reach,actions');
  u.searchParams.set('time_range', JSON.stringify({ since: fra, until: til }));
  u.searchParams.set('limit', '100');
  u.searchParams.set('access_token', TOKEN());
  // flere end 100 kampagner kommer paa flere sider
  const data = [];
  let adr = u.toString();
  for (let side = 0; adr && side < 20; side++) {
    const { r, d, krop } = await hentJson(adr);
    if (!r.ok || !d || d.error) {
      const fe = (d && d.error) || {};
      const raa = String(fe.message || ('HTTP ' + r.status + (krop ? ', ' + krop.replace(/<[^>]+>/g, ' ').slice(0, 120) : ''))).replace(/\s+/g, ' ').trim().slice(0, 300);
      const kode = fe.code != null ? fe.code : null;
      const raad = kode === 2635 ? ' Meta har lukket for API-version ' + VERSION + '. Sæt META_API_VERSION i Netlify til en nyere version.'
        : kode === 190 ? ' Nøglen er udløbet eller ugyldig. Lav en ny META_ACCESS_TOKEN.' : '';
      throw fejl('"' + raa + '"' + (kode != null ? ' (kode ' + kode + ')' : '') + '.' + UKENDT + raad, raa, { kode, http: r.status });
    }
    data.push(...(d.data || []));
    adr = d.paging && d.paging.next ? d.paging.next : null;
  }
  return data.map(k => {
    const inst = (k.actions || []).find(a => /mobile_app_install|app_install/.test(a.action_type));
    const klik = Number(k.clicks) || 0;
    return { kampagne: k.campaign_name || '', kampagneId: k.campaign_id != null ? String(k.campaign_id) : null,
             forbrug: tal(k.spend), valuta: k.account_currency || null,
             visninger: Number(k.impressions) || 0, klik, klikAlle: klik, linkKlik: tal(k.inline_link_clicks),
             naaet: Number(k.reach) || 0, installs: inst ? Number(inst.value) || 0 : null,
             kilde: 'meta' };
  });
}
module.exports = { forbrug, opsat, status };
