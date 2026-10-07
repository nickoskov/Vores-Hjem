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
