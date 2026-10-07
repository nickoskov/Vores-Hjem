# Vores Hjem – hjemmeside

Hjemmesiden til [www.voreshjem.dk](https://www.voreshjem.dk), hostet på Netlify.

## Om denne kopi

Hentet direkte fra den live side den 7. oktober 2026, fordi kildekoden kun lå på én PC.
Filerne er præcis det, Netlify serverer, så siden kan genudgives herfra som den er.

Mangler (kan ikke hentes udefra – ligger i Netlify eller på den anden PC):

- `_redirects` / `_headers` / `netlify.toml` (fx viderestilling af gamle Wix-adresser)
- Eventuelle build-scripts, der genererer blogindlæg og billeder
- App-koden (iPhone/Android) og backend (`backend.voreshjem.dk`)
- Chatbotten (`voreshjem-bot.netlify.app`)

## Struktur

- `index.html` – forsiden
- `kalender.html`, `madplan.html`, `opgaver.html`, `indkobsliste.html`, `synkronisering.html`, `indstillinger.html` – funktionssider
- `blog.html` + `post/` – blog (28 indlæg)
- `hent/`, `presse/`, `support.html`, `hvordan-*.html` – øvrige sider
- `images/`, `fonts/`, `video/` – filer
- `sitemap.xml`, `robots.txt`, `llms.txt` – til søgemaskiner og AI

Netlify viser `kalender.html` på adressen `/kalender` automatisk.
