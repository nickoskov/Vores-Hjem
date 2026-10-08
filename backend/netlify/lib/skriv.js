'use strict';
/**
 * Skriver et udkast til et blogindlaeg ud fra et soegeord, med Claude.
 * Bruger ANTHROPIC_API_KEY fra Netlify, samme som chatbotten. Udkastet lander
 * som kladde i bloggen og udgives aldrig af sig selv.
 */
const NOEGLE = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const opsat = () => !!NOEGLE;

const STIL = `Du skriver for Vores Hjem, en dansk familieapp der samler kalender, madplan, indkoebsliste og opgaver med point til boernene. 39 kr om maaneden, 14 dage gratis, op til 7 personer.
Skriv på dansk, varmt og konkret, som en ven der har proevet det selv. Korte saetninger. Ingen floskler, ingen udraabstegn i flaeng, ingen emojis, aldrig den lange tankestreg.
Start med et genkendeligt øjeblik fra en familiehverdag. Giv konkrete raad, der virker uden appen. Naevn Vores Hjem naturligt én eller to gange, ikke som reklame.
Skriv så AI-motorer kan citere det: klare afsnit, overskrifter der er spoergsmaal, og et kort direkte svar lige under hvert spoergsmaal. Slut med tre korte spoergsmaal og svar.
Svar KUN med JSON: {"titel":"...","slug":"...","resume":"120 til 155 tegn","brod":"html med <h2>, <p>, <ul>"}`;

async function udkast(ord, hint) {
  if (!NOEGLE) throw new Error('ANTHROPIC_API_KEY mangler i Netlify');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method:'POST',
    headers:{ 'x-api-key': NOEGLE, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, system: STIL,
      messages:[{ role:'user', content:'Skriv et blogindlaeg på 600 til 900 ord, der skal findes på soegningen: "' + ord + '".' + (hint ? ' ' + hint : '') }] }) });
  const d = await r.json();
  if (!r.ok) throw new Error('Claude: ' + ((d.error||{}).message || r.status));
  const t = (d.content||[]).map(c => c.text||'').join('');
  const m = /\{[\s\S]*\}/.exec(t);
  if (!m) throw new Error('Claude svarede ikke med et udkast');
  const u = JSON.parse(m[0]);
  if (!u.titel || !u.brod) throw new Error('Udkastet mangler titel eller tekst');
  return { titel:u.titel, slug:u.slug||'', resume:u.resume||'', brod:u.brod, ord };
}

/** Foreslaar en bedre titel eller beskrivelse til én side. */
async function forslag(felt, side) {
  if (!NOEGLE) throw new Error('ANTHROPIC_API_KEY mangler i Netlify');
  const krav = felt === 'titel'
    ? 'Skriv 3 forslag til en ny <title>. Hver på 35 til 58 tegn inklusive " | Vores Hjem" til sidst. Emnet først, konkret, ingen udråbstegn.'
    : 'Skriv 3 forslag til en ny meta-beskrivelse. Hver på 120 til 155 tegn. Sig hvad siden giver læseren, og hvorfor man skal klikke. Ingen udråbstegn.';
  const kontekst = 'Side: ' + side.url + '\nNuværende titel: ' + (side.titel||'(ingen)') + '\nNuværende beskrivelse: ' + (side.besk||'(ingen)') + '\nOverskrift på siden: ' + (side.h1tekst||'(ingen)');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method:'POST',
    headers:{ 'x-api-key': NOEGLE, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, system: STIL + '\nSvar KUN med JSON: {"forslag":["...","...","..."]}',
      messages:[{ role:'user', content: krav + '\n\n' + kontekst }] }) });
  const d = await r.json();
  if (!r.ok) throw new Error('Claude: ' + ((d.error||{}).message || r.status));
  const t = (d.content||[]).map(c => c.text||'').join('');
  const m = /\{[\s\S]*\}/.exec(t);
  const u = m ? JSON.parse(m[0]) : {};
  return (u.forslag || []).map(x => String(x).trim()).filter(Boolean).slice(0,3);
}
module.exports = { udkast, forslag, opsat };
