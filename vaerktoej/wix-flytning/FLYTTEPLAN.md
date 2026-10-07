# Flytning af voreshjem.dk fra Wix til Netlify

*Sidst opdateret 8. september 2026. Wix er urørt. Intet er skiftet endnu.*

---

## Hvorfor

Den vigtigste grund er ikke, at Wix er dårlig. Det er, at jeres indhold ligger
i en **iframe**. Google tilskriver indhold i en iframe den adresse, iframen
peger på, ikke siden omkring. Al teksten om kalender, madplan, opgaver, indkøb
og Vagter arbejder derfor for `info.voreshjem.dk` i stedet for `voreshjem.dk`.

Den anden grund er målt, ikke gættet:

| Forsiden hentes | Vægt |
|---|---|
| voreshjem.dk gennem Wix | 2.191 KB |
| jeres egen side direkte | 111 KB |

Wix lægger godt 2 MB oven i, hvoraf 1,5 MB er deres eget JavaScript.

## Hvorfor Netlify og ikke Vercel

Vercels gratis plan må ikke bruges kommercielt. Netlifys må. I har allerede
kontoen og fire sider kørende der.

---

## Reglen der beskytter placeringerne

**Hver eneste adresse bliver præcis som i dag.** Ingen sider skifter navn.
Så skal Google ikke lære noget nyt, og der er ingen omdirigeringer, hvor
noget kan gå galt.

---

## Status

### Klar
- 28 blogindlæg hentet ned og bygget som rigtige sider med artikeldata
- 10 sider findes i forvejen og er dækket
- Adressekort med 14 regler
- Sitemap til efter flytningen, 38 adresser
- Delekort til deling, 1200x630
- Strukturerede data på alle 10 sider
- Alle links kontrolleret: ét dødt, og det er blogoversigten
- **De otte sporingskoder fra Wix er genskabt** i `sporing_head.html` og
  afprøvet i en rigtig browser. Alle otte starter, ingen fejl. Se
  SPORINGSKODER.md
- **Adresser med æ, ø, å og é virker.** 13. september fandt backendens
  SEO-gennemgang, at 19 af 39 adresser gav 404 på Netlify, alle med danske
  bogstaver. Filerne er omdøbt til ascii, og `_redirects` har nu 19 præcise,
  procent-kodede regler, så adresserne udadtil er uændrede. Testet: alle
  svarer 200, både kodet og ukodet
- **llms.txt** ligger klar til AI-motorerne

### Mangler
- **Blogoversigten** paa /blog
- **Soro**, se nedenfor. Vigtigst af alt
- **Sporingsblokken skal klistres ind i de 10 sider.** Filen er klar, men
  den maa foerst ind paa flyttedagen. Goer vi det nu, begynder Meta-pixlen
  at taelle den midlertidige Netlify-adresse med, og tallene bliver rodede

### Venter paa Nicko
- Den svaevende hent-knap ind i Wix under Tilpasset kode

---

## Det der IKKE må glemmes

**Soro skriver og udgiver blogindlæg direkte ind i Wix, hver anden dag.**
Den dag domænet flytter, holder den forbindelse op med at virke, og der
kommer ikke flere indlæg. Ingen får en fejlbesked. Det opdages først,
når nogen kigger efter.

Soro understøtter webhooks. Forbindelsen skal være sat op og afprøvet
**før** skiftet, ikke efter.

---

## Rækkefølgen

| | Hvad | Hvem |
|---|---|---|
| 1 | Soro afklares og forbindelsen bygges | begge |
| 2 | Blogoversigten bygges | Claude |
| 3 | Proevekoersel paa midlertidigt domaene, side for side | begge |
| 4 | DNS-tiden saettes ned til 300 sekunder, en uge foer | Nicko |
| 5 | Selve skiftet, to minutter | Nicko |
| 6 | Sprogforbindelse mellem dansk og tysk saettes op | Claude |
| 7 | Search Console foelges i to til fire uger | begge |

Wix-abonnementet beholdes i mindst en maaned efter skiftet, saa der er
noget at falde tilbage paa.

---

## Ingen maa rette i Wix, mens vi bygger

Retter nogen en tekst i Wix, findes den ikke i den nye side, og
aendringen forsvinder ved skiftet.
