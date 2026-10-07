# Vores Hjem – web

Alle Vores Hjems sider på Netlify, hentet direkte fra Netlify den 7. oktober 2026.
Hver mappe er præcis det, der ligger live.

| Mappe | Adresse | Netlify-projekt |
|---|---|---|
| `hjemmeside/` | www.voreshjem.dk | `stirring-cactus-7010c5` |
| `download/` | download.voreshjem.dk | `voreshjem-download` |
| `unserzuhause/` | www.unserzuhauseapp.de | `verdant-strudel-af7a88` |
| `unserzuhause-download/` | unserzuhause-download.netlify.app | `unserzuhause-download` |
| `chatbot/` | voreshjem-bot.netlify.app | `voreshjem-bot` |
| `backend/` | backend.voreshjem.dk | `voreshjem-backend` |

## Udgiv

www.voreshjem.dk og www.unserzuhauseapp.de er låst i Netlify, så `netlify deploy --prod` ikke virker.
Udgiv med scriptet fra repoets rod (kræver `netlify login` én gang):

```
node vaerktoej/udgiv.mjs hjemmeside          # testudgave + test
node vaerktoej/udgiv.mjs hjemmeside --live   # live, låst og pushet til GitHub
```

Se også CLAUDE.md. ⚠️ **Udgiv aldrig `chatbot/` eller `backend/` herfra.** Funktionerne ligger kun på Mac'en.

## Mangler

- Kildekoden til backend- og chatbot-funktionerne
- App-koden (iPhone/Android)
- `_redirects` til `hjemmeside/hent_rettelser.js` (scriptet, der henter rettelser fra backend-panelet før udgivelse)

## Værktøjer

- `vaerktoej/udgiv.mjs`: sikker udgivelse (se ovenfor).
- `vaerktoej/vh-blog.js`: vedligehold af blogindlæg (brødkrumme, dateModified, sitemap-lastmod,
  sammenlægning af indlæg). Kør uden `--skriv` først. Fx
  `node ../vaerktoej/vh-blog.js . opdateret post/<slug> --skriv` inde fra `hjemmeside/`.

## Ændringslog

- 2026-10-07: minbolighandel fjernet. GEO-rettelser: modsigelser rettet (svartid, data i EU,
  automatisk fornyelse, private aftaler, kalendervisninger, maks. 200 varer, opsigelse på Android),
  ny side /om-vores-hjem, llms.txt + llms-full.txt, robots.txt, JSON-LD (Organization, app, FAQ,
  brødkrummer), beskrivende H1 på funktionssider, footer-links, viderestillinger, sitemap, IndexNow.
  Ingen konkurrentnavne og ingen "Kort fortalt"-/faktabokse (ejerens ønske).
- 2026-10-07: Live-siderne låst i Netlify; udgivelse kun via vaerktoej/udgiv.mjs. CLAUDE.md med regler.
