# Backend til voreshjem.dk

**Adresse:** https://backend.voreshjem.dk (den gamle voreshjem-backend.netlify.app virker stadig)
**Netlify-projekt:** voreshjem-backend

Panelet er låst, indtil `ADMIN_PASSWORD` er sat. Alle variabler sættes i
Netlify under **voreshjem-backend → Site configuration → Environment
variables**, og efter hver ændring trykkes **Trigger deploy**. Ingen af dem
må sendes i en chat, heller ikke til mig.

---

## Trin 1, grundlaget (fem minutter)

| Navn | Hvad | Uden den |
|---|---|---|
| `ADMIN_PASSWORD` | ejerens adgangskode | ingen kan logge ind |
| `SESSION_SECRET` | en tilfældig streng, 40 tegn | virker, men svagere |
| `DATABASE_URL` | **samme** Neon-streng som bot-panelet | ingen noter, links, blog, chat, oppetid |
| `WEBHOOK_SECRET` | en tilfældig streng, 40 tegn | Soro kan ikke aflevere |
| `BOT_ADMIN_PASSWORD` | bot-panelets adgangskode. Udelades den, bruges `ADMIN_PASSWORD` | chatsamtalerne kan ikke læses eller besvares |
| `ANTHROPIC_API_KEY` | samme som chatbotten bruger | Claude kan ikke skrive udkast |
| `NETLIFY_TOKEN` | personlig adgangstoken fra Netlify: User settings → Applications → Personal access tokens | rettelser kan ikke udgives fra panelet |
| `SITE_NETLIFY_ID` | udelades normalt, står til sidens id. Skift kun hvis siden flytter til et andet Netlify-projekt | |
| `RYD_DAGE` | udelades normalt, står til 90. Hvor mange dage chatsamtaler gemmes, før de slettes af sig selv | 90 dage |
| `SEO_SITE` | udelades normalt. Sæt til `https://stirring-cactus-7010c5.netlify.app` indtil domænet er flyttet, så gennemgangen rammer den rigtige side og ikke Wix | gennemgangen kører mod www.voreshjem.dk |

Databasen skal være den samme som bottens. Så ser panelet chatsamtalerne
og klikkene på hent-knapperne uden noget ekstra.

## Trin 2, Google (ti minutter)

| Navn | Hvad |
|---|---|
| `GA4_CREDENTIALS` | hele JSON-filen fra servicekontoen |
| `GA4_PROPERTY_ID` | ejendommens nummer, kun cifre |
| `GSC_SITE_URL` | `https://www.voreshjem.dk/` præcis som i Search Console |

1. console.cloud.google.com → lav et projekt
2. Slå **Google Analytics Data API** og **Search Console API** til
3. Lav en **servicekonto**, hent nøglen som JSON
4. Analytics → Administration → Ejendomsadgang → tilføj servicekontoens
   mail som **Læser**
5. Search Console → Brugere og tilladelser → tilføj samme mail

Giver: Oversigt, Tragt, Trafik, Søgeord, Annoncer, live-tal, ugemail, dagvagt.

**Sidehastighed** kræver én ting til: slå **PageSpeed Insights API** til i
samme projekt, lav en **API-nøgle** (ikke servicekontoen, men Credentials →
API key) og sæt den som `PSI_API_KEY`. Uden den deler panelet en fælles
kvote med hele verden, og den er tom det meste af dagen.

## Trin 3, mail (fem minutter)

| Navn | Hvad |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | samme som bot-panelet |
| `ALERT_TO` | hvem der skal have alarmer og ugemail, fx nst@vores-hjem.dk |

Giver: alarm når siden er nede, og ugemail mandag morgen.

## Trin 4, annonceomkostninger (når I kører annoncer)

**Meta**, det nemme:

| Navn | Hvor |
|---|---|
| `META_ACCESS_TOKEN` | business.facebook.com → Systembrugere → lav en med `ads_read` → generér token |
| `META_AD_ACCOUNT_ID` | nummeret i Ads Manager, med eller uden `act_` |

**Google Ads**, det tunge, tag det til sidst:

| Navn | Hvor |
|---|---|
| `GADS_DEVELOPER_TOKEN` | Google Ads → Værktøjer → API Center |
| `GADS_CLIENT_ID`, `GADS_CLIENT_SECRET` | OAuth-klient i Google Cloud |
| `GADS_REFRESH_TOKEN` | fås ved at logge ind én gang med klienten |
| `GADS_CUSTOMER_ID` | kontonummeret uden bindestreger |

Giver: "Kostede" og "Pris pr. konvertering" ud for hver kampagne. Kampagnen
skal hedde det samme i UTM-koden og hos Meta eller Google, ellers står der
"ikke fundet". Byg links under **Links**, så navnene bliver ens.

## Trin 5, downloads fra butikkerne

**App Store Connect:**

| Navn | Hvor |
|---|---|
| `ASC_ISSUER_ID`, `ASC_KEY_ID` | App Store Connect → Brugere og adgang → Nøgler, rolle **Salg** |
| `ASC_PRIVATE_KEY` | hele .p8-filen, den kan kun hentes én gang |
| `ASC_VENDOR_NUMBER` | under Betalinger og økonomirapporter |

**Google Play:**

| Navn | Hvor |
|---|---|
| `GPLAY_BUCKET` | Play Console → Download rapporter → spandens navn, `pubsite_prod_...` |
| `GPLAY_PACKAGE` | appens pakkenavn, fx `dk.voreshjem.app` |

Servicekontoen fra trin 2 skal gives adgang i Play Console under Brugere.

Giver: Downloads-fanen og fjerde trin i tragten.

Salgsrapporten fra Apple dækker alle apps på kontoen. Backenden tæller kun
sin egen app: Vores Hjem (6758346281) på den danske, Unser Zuhause
(6771931999) på den tyske. `ASC_APP_ID` behøves kun, hvis det skal være en
anden. Google Play bruger på samme måde `com.voreshjem.app` og
`com.unserzuhause.app`, medmindre `GPLAY_PACKAGE` siger andet.

---

## Den tyske backend (backend.unserzuhauseapp.de)

Samme kode, udgivet en gang til på Netlify-projektet **unserzuhause-backend**
med `node vaerktoej/udgiv-backend.mjs --de` (prøveudgave) og `--de --live`.
Variablen `SIDE=de` gør den tysk: navne i panelet og mails, hvilke adresser
tælleren og kontaktformularen tager imod, og hvilken app der tælles. Blog,
Links, Indhold og Annoncer findes kun på den danske.

Den har sin egen database, sit eget panel og sit eget login. Første gang en
backend bruger sin database, stemples den i tabellen `vh_side`. Den tyske
tager kun en helt tom database i brug, og ingen af dem bruger en database,
der er stemplet til den anden. Står `DATABASE_URL` forkert, røres databasen
slet ikke, og panelet og udgivelsesscriptet siger hvorfor.

Alt er adskilt fra den danske: database, login, mail og nøgler til Apple og
Google. Kun selve udviklerkontoen hos Apple og Google er fælles, fordi den
ejer begge apps. Den tyske side har sin egen chatbot i den tyske backend (se
nedenfor), og den tyske backend taler aldrig med den danske chatbot.
Hent-knapperne på den tyske side går til `backend.unserzuhauseapp.de/hent/app`,
som sender telefonen til sin butik og tæller trykket i den tyske database.

| Navn | Værdi |
|---|---|
| `SIDE` | `de` |
| `DATABASE_URL` | en ny, tom Neon-database (Frankfurt). Aldrig den danske |
| `ADMIN_PASSWORD`, `SESSION_SECRET` | nye, kun til det tyske panel. Panelet bruger `ADMIN_PASSWORD` til at tale med sin egen chatbot |
| `SMTP_HOST`, `SMTP_PORT` | `smtp.simply.com`, `587` |
| `SMTP_USER`, `SMTP_PASS` | postkassen `support@unserzuhauseapp.de` hos Simply |
| `ALERT_TO` | `support@unserzuhauseapp.de` (flere adresser adskilles med komma) |
| `GA4_CREDENTIALS` | nøgle (JSON) til en egen servicekonto, fx `unserzuhause-backend`, med adgang til den tyske ejendom i Search Console og den tyske app i Play Console |
| `GPLAY_BUCKET` | samme som på den danske. Det er udviklerkontoens rapportmappe, ikke en nøgle |
| `ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY`, `ASC_VENDOR_NUMBER` | en egen API-nøgle i App Store Connect med rollen Sales. Issuer ID og Vendor Number er kontoens og derfor de samme |
| `GSC_SITE_URL` | `sc-domain:unserzuhauseapp.de` |
| `PSI_API_KEY`, `RYD_DAGE` | kan udelades |
| `ANTHROPIC_API_KEY` | Claude-nøglen. Bruges til at oversætte support-mail og af chatbotten |
| `BOT_MODEL` | kan udelades. Chatbottens Claude-model, står til den samme som den danske bot. `CLAUDE_MODEL` gælder kun backendens egne opgaver |
| `SUPPORT_TEAM` | teamets indbakke, der får kundernes mails på dansk, fx `kontakt@vores-hjem.dk` (flere adresser adskilles med komma). Sættes den, er oversættelsen slået til |
| `SUPPORT_TEAM_EKSTRA` | kan udelades. Flere adresser, hvis svar også sendes videre til kunden, men som ikke får kundernes mails |
| `IMAP_HOST`, `IMAP_PORT` | kan udelades, står til `imap.simply.com` og `993` |

Kopiér ingen nøgler fra den danske. Netlify udleverer heller ikke hemmelige
værdier, så det, der ser ud som en kopi, er kun en pladsholder. `BOT_URL` og
`BOT_ADMIN_PASSWORD` bruges slet ikke på den tyske backend, heller ikke hvis de
står der.

### Chatten på unserzuhauseapp.de

Chatbotten er den samme kode som den danske (`chatbot/netlify/functions/chat-bot.js`).
`udgiv-backend.mjs --de` tager den med som funktionen `chat-bot`
(`backend/netlify/functions-de/chat-bot.mjs`) og lægger `widget.js` og
`avatar-de.png` fra `chatbot/` på `backend.unserzuhauseapp.de`. Den danske
backend får intet af det. Botten kender kun tysk, gemmer samtalerne i den
tyske database og bruger den tyske backends Claude-nøgle, SMTP og `ALERT_TO`.
Vil en kunde tale med et menneske, får `ALERT_TO` en mail med et link til Chat
i det tyske panel. Der svarer teamet på dansk, og kunden får svaret på tysk.
Butikslinks i chatten går til `backend.unserzuhauseapp.de/hent/...` og tælles
som "Chatten". Den svævende knap ligger på siden selv (`unserzuhause/hentknap.js`).
Samtaler slettes 90 dage efter sidste besked som på den danske. Får botten nye
kolonner, køres `https://backend.unserzuhauseapp.de/.netlify/functions/chat-bot?migrate=1`
én gang efter udgivelsen, som på den danske bot.

### Support-mail på tysk, læst og besvaret på dansk

Kunderne skriver på tysk til `support@unserzuhauseapp.de`. Funktionen
`postkasse` læser postkassen hvert andet minut (samme login som SMTP) og
sender hver ny kundemail videre til `SUPPORT_TEAM`, oversat til dansk, med et
sagsnummer som `[UZ-12]` i emnet. Kunden får med det samme en kort tysk
kvittering, højst én pr. adresse pr. døgn. Svarer teamet på dansk på den
mail, oversættes svaret til tysk og sendes til kunden fra
`support@unserzuhauseapp.de`, og teamet får en kopi af den tyske tekst.
Kontaktformularen på unserzuhauseapp.de laver også en sag.

Fejler oversættelsen eller afsendelsen, får kunden intet, og teamet får at
vide hvorfor. Autosvar, fejlmeldinger, nyhedsbreve og vores egne mails
ignoreres, så teamets eget autosvar aldrig når kunden. Mail fra før
funktionen blev slået til, røres ikke. Sagerne slettes 90 dage efter sidste
besked. Slå ikke Simplys eget autosvar til på postkassen: det ville også
svare teamet. Den danske backend gør intet af dette.

---

## Soro

Soro har ingen webhook, kun et RSS-feed (Settings, Other Platform, RSS Feed).
Adressen ligger i Netlify som `SORO_RSS_URL`. Funktionen `sorovagt` læser
feedet ti minutter over hver time, og knappen **Hent fra Soro** under Blog
henter med det samme. Nye indlæg lander som kladde; `WEBHOOK_AUTOUDGIV=ja`
udgiver med det samme. Indlæg, der allerede ligger på voreshjem.dk (sidens
`blog/indlaeg.json`), springes over, så de 28 fra Wix ikke kommer to gange.

`WEBHOOK_SECRET` og `/webhook/soro` er stadig der, hvis Soro en dag får en
webhook, eller en anden tjeneste skal aflevere indlæg.

## Eget domæne til panelet

I dag hedder det voreshjem-backend.netlify.app. Vil I have
**backend.voreshjem.dk**, tager det fem minutter:

1. Netlify → voreshjem-backend → Domain management → Add a domain →
   `backend.voreshjem.dk`
2. Simply → DNS → ny CNAME: navn `backend`, værdi
   `voreshjem-backend.netlify.app`
3. Vent ti minutter. Netlify laver selv certifikatet.

Gør det først efter flytningen, når DNS'en alligevel er hos Simply.

## Sikkerhed

- **To-trins login.** Slås til under Opsætning, pr. bruger. Scan en kode
  med Google Authenticator, 1Password eller Apples Adgangskoder. Derefter
  kræver hvert login også koden fra telefonen. Ejeren bør slå det til først
- Seks forkerte logins fra samme adresse låser i et kvarter
- Fjernes en bruger, eller sættes rollen ned, gælder det med det samme.
  Sedlen i browseren afgør ikke, hvad man må, det gør databasen
- Fejler én af Googles rapporter, vises resten. Der står øverst hvilken

## Brugere

Log ind uden navn, eller som "Ejer", med hovedkoden. Opret andre under
Opsætning med egen kode og rolle: **kigger** ser alt, **retter** kan skrive
blog, noter, links og indhold, **ejer** alt.

---

## Hvad der virker

- **Live** på siden nu, hvert minut
- **Oversigt** med syv nøgletal, sammenligningskurve med hover, og noter på
  kurven ("flyers uddelt"), så man kan se om en handling gav udslag
- **Tragt**: forside → hent-side → klik til butik → installeret, med fald
  pr. trin. Klik tælles af hent-knapperne selv, ikke kun af Google
- **Trafik**: landingssider, døgn, ugedage, kilder, byer, browser, system
- **Søgeord** fra Search Console
- **Annoncer** med forbrug, pris pr. klik og pris pr. konvertering
- **Downloads** fra App Store og Google Play, dag for dag
- **Chat**: hele bot-panelet er flyttet herover. Samtaler på dansk og tysk,
  ulæste, læs og svar, tag over fra botten og giv tilbage, ret eller slet
  egne svar, arkiv, tommel op og ned, og de svar folk gav tommel ned.
  Tyske samtaler oversættes automatisk begge veje som før. Backenden
  kalder bottens egen tjeneste, så intet af bottens logik er flyttet,
  kun skærmen. Det gamle bot-panel virker stadig, men behøves ikke
- **Blog** med skriverude og Soro-modtager
- **Links**: UTM-linkbygger med QR-kode, gemmes så navne bliver ens
- **Oppetid**: vagt hver time, mail ved nedbrud og ved genopretning
- **Sidehastighed** fra Googles PageSpeed, mobil og computer, gemt et døgn
- **Dagvagt** hver morgen: opdager hvis sporingen er død (nul målinger i går)
- **Døde links**: adresser folk prøvede som ikke findes, og hvor linket sad
- **SEO og GEO**: hele siden gennemgås hver mandag, 39 sider på 7 sekunder,
  som SEOptimer men gratis: titel, beskrivelse, overskrifter, alt-tekster,
  canonical, delekort, strukturerede data, døde links, vægt. Score med
  udvikling, og opgaverne med det vigtigste først. GEO-tjek: llms.txt,
  om ChatGPT, Claude og Perplexity må læse siden, FAQ-data. AI-trafik:
  besøg fra ChatGPT, Perplexity og Copilot og hvor de lander
- **Muligheder** fra Search Console: ord I ligger plads 4 til 20 med, sorteret
  efter hvor mange klik der venter. Plus "titlen sælger ikke" og "fortjener
  egen side"
- **Ret fra listen**: tryk på en advarsel, og hver side folder ud med det
  der står nu. Skriv en ny titel eller beskrivelse, eller tryk Foreslå og få
  tre fra Claude med tegntal. Gem, og udgiv samlet under Indhold. Panelet
  henter den side der er live, retter feltet, og lægger en ny udgivelse op
  hos Netlify med kun de ændrede filer. Ingen git, ingen filer at åbne
- **Udkast fra Claude**: en knap ved hvert ord skriver et blogindlæg, som
  lander som kladde. Mandag skriver hjulet selv ét udkast om det bedste ord,
  I ikke har skrevet om. Intet udgives uden at et menneske har læst det
- **Læg bloggen ud på siden**: udgivne indlæg fra panelet, Soro og Claude
  bliver til rigtige sider i samme form som de 28 gamle, bloggens forside
  bygges om, sitemap opdateres, og det hele udgives med ét tryk. Før dette
  var "Udgivet" i panelet uden virkning på siden
- **Oprydning hver nat**: chatsamtaler ældre end 90 dage slettes af sig selv,
  medmindre nogen venter på et menneske. Det er GDPR, ikke pynt
- **Fejl i panelet**: hver fejl gemmes og kan ses under Opsætning. Ti eller
  flere på et døgn giver en mail
- **Hastighedsalarm**: dagvagten måler PageSpeed hver morgen og skriver,
  hvis mobil-scoren falder ti point
- **Ugemail** mandag morgen med ugens tal, og mandag også en SEO-mail med
  score og de fem vigtigste opgaver
- **Egne datoer** ud over de fem faste perioder
- **Tidsstempel** på alle tal, og en knap til at hente friske
- **Brugere** med roller
- **Cache** fem minutter, så panelet åbner med det samme
- Alle tabeller sorteres og hentes som CSV. Alt på dansk.

- **Indhold**: 15 felter på forsiden og hent-siden er mærket op og kan
  rettes i panelet: overskrift, undertekst, begge priser, knappen øverst og
  alle afsnitsoverskrifter. Tryk "Hent felter fra siden", ret, gem, udgiv.
  Flere felter mærkes op med `data-vh="side.navn"` i html, så finder
  panelet dem selv
- **Test forbindelserne**: én knap under Opsætning prøver hver nøgle med
  et lille kald og siger virker, fejler eller ikke sat op. Brug den, hver
  gang du har sat en variabel
- **Flyttedagen som én kommando**: `voreshjem-flyt/flyt.sh` henter
  rettelser, udgiver med sporing, tjekker alle adresser og viser DNS

## Hvad der ikke er bygget

- **Brødtekst og billeder** på siderne rettes stadig i filerne. Vil I have
  flere tekster i panelet, mærkes de op med `data-vh`
- **AW-kode** til Google Ads-konverteringer. Pladsen er lavet i
  `sporing_head.html`, men id'et findes først, når I opretter en
  konvertering i Google Ads

## Vigtigt om rettelser fra panelet

Rettelser udgives direkte til den side, der er live. De ligger i panelets
database, ikke i filerne på Nickos computer. Udgiver nogen siden fra
computeren igen uden at hente dem først, overskrives de. Derfor ligger
`hent_rettelser.js` i `voreshjem-site`: kør den før hver udgivelse fra
computeren, så lægger den panelets rettelser ind i filerne først.
