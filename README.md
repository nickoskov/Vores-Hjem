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

Fra mappen der skal udgives (kræver `netlify login` én gang):

```
netlify deploy --no-build --dir . --site <netlify-projekt>          # testudgave
netlify deploy --no-build --dir . --site <netlify-projekt> --prod   # live
```

`netlify.toml` i hver mappe indeholder viderestillinger og headers og skal med.

⚠️ **Udgiv aldrig `chatbot/` eller `backend/` herfra.** De mapper har kun de statiske filer.
Funktionerne (chat-bot, admin, vagt, ugemail, webhook m.fl.) kan ikke hentes fra Netlify
og ligger kun på Mac'en. En udgivelse herfra ville slette dem.

## Mangler

- Kildekoden til backend- og chatbot-funktionerne
- App-koden (iPhone/Android)
- `_redirects` til `hjemmeside/hent_rettelser.js` (scriptet, der henter rettelser fra backend-panelet før udgivelse)

## Før hver udgivelse

Backend-panelet kan rette titler og beskrivelser direkte på live-sitet. Tjek derfor, at live
ikke er ændret siden sidste udgivelse fra repoet, ellers overskrives rettelserne.
Udgiv altid en testudgave først, og læg den live, når den er tjekket.

## Værktøjer

- `vaerktoej/vh-blog.js`: vedligehold af blogindlæg (brødkrumme, dateModified, sitemap-lastmod,
  sammenlægning af indlæg). Kør uden `--skriv` først. Fx
  `node ../vaerktoej/vh-blog.js . opdateret post/<slug> --skriv` inde fra `hjemmeside/`.

## Ændringslog

- 2026-10-07: minbolighandel fjernet. GEO-rettelser: modsigelser rettet (svartid, data i EU,
  automatisk fornyelse, private aftaler, kalendervisninger, maks. 200 varer, opsigelse på Android),
  ny side /om-vores-hjem, llms.txt + llms-full.txt, robots.txt, JSON-LD (Organization, app, FAQ,
  brødkrummer), beskrivende H1 på funktionssider, footer-links, viderestillinger, sitemap, IndexNow.
  Ingen konkurrentnavne og ingen "Kort fortalt"-/faktabokse (ejerens ønske).
