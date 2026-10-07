# Sporingskoder der skal med over fra Wix

*Kortlagt 8. september 2026 ud fra Nickos skaermoptagelse og den live side.
Alle id'er herunder staar allerede offentligt i sidens kildekode. Der er
ingen hemmeligheder i dem.*

Den dag domaenet flytter, forsvinder alle otte blokke paa én gang, fordi de
ligger i Wix og ikke i jeres egen side. De skal genskabes foer skiftet.

---

## De otte blokke

| # | Navn i Wix | Hvad det er | Kodetype i dag |
|---|---|---|---|
| 1 | Facebook Pixel | Meta-pixel, loader | Marketing |
| 2 | Custom | selve Meta-pixlens kode | Essentielt |
| 3 | Cookie (Accept / reject) | iubenda cookiebanner | funktionel |
| 4 | Google Tag Manager | GTM-beholderen | Essentielt |
| 5 | Google Tag Manager (Analytics) | er i virkeligheden gtag til GA4 | Essentielt |
| 6 | Google Tag (Basic Consent Mode) | samtykketilstand | Analyser |
| 7 | Vores hjem bot | jeres egen chat | funktionel |
| 8 | GEO - ChatGPT | OpenAIs maalepixel | Essentielt |

## Analytics skiftede id 15. september

Hjemmesiden målte til G-Y9249CY9TV, som ligger i en ejendom, Nicko ikke kunne
finde adgang til. Der blev lavet en ny ejendom under Nickos egen konto med
måle-id **G-ZFW1KE91LV**, og alle 41 sider måler nu til den. Historikken
før 15. september ligger stadig i den gamle. GTM-beholderen GTM-TQ39D7RM
sender formentlig stadig til den gamle, den er ikke rørt.

## Id'erne

| Tjeneste | Id |
|---|---|
| Google Tag Manager | GTM-TQ39D7RM |
| Google Analytics 4 | G-ZFW1KE91LV (fra 15. sept. Før: G-Y9249CY9TV, se note) |
| Meta-pixel | 697476623339056 |
| OpenAI, GEO | QZwgYr1hiBh3USt1vsSytt |
| iubenda, privatlivspolitik | 85951957 |
| iubenda, siteId | 4517758 |
| iubenda, hele opsaetningen | https://embeds.iubenda.com/widgets/c4881ab1-9037-47e2-b5ce-d1950889d637.js |
| Chatbot | https://voreshjem-bot.netlify.app/widget.js |

OpenAIs kode hentes fra `https://bzrcdn.openai.com/sdk/oaiq.min.js`.

---

## Tre ting der skal rettes, mens vi alligevel er i gang

### 1. OpenAI-pixlen staar i fejlfindingstilstand

Kaldet er `oaiq("init",{pixelId:"...",debug:true})`. **debug:true** hoerer til,
naar man saetter det op, ikke naar det koerer. Det skriver i browserens
konsol hos hver eneste besoegende. Skal vaere `false`.

### 2. Blok 5 hedder noget forkert

Den hedder "Google Tag Manager (Analytics)", men den er ikke Tag Manager.
Det er gtag til Google Analytics 4. Det er forvirrende, naar nogen skal
rette i det senere. Navnet boer vaere "Google Analytics 4".

### 3. Google Ads findes ikke

Der er ingen AW-kode paa siden. Koerer I Ads-annoncer, bliver konverteringer
altsaa ikke maalt. Skal tjekkes.

---

## Hvad der skal ske ved flytningen

**Det er gjort.** Alle otte blokke ligger nu samlet i `sporing_head.html`.
Den fil klistres ind i `<head>` paa hver side i `voreshjem-site`, oeverst,
foer alt andet. Saa er sporingen den samme dagen efter flytningen som dagen
foer.

Raekkefoelgen i filen er ikke tilfaeldig:

1. **Samtykketilstand foerst.** Alt staar paa "afvist", indtil brugeren
   siger ja. Sker det ikke foer Google indlaeses, naar Google at maale paa
   folk, der ikke har sagt ja endnu.
2. **Cookiebanneret derefter.** Det er det, der loefter samtykket.
3. **Saa Google, Meta og OpenAI**, som retter sig efter samtykket.
4. **Chatbot og hent-knap til sidst**, med `defer`. De to skal bruge
   sidens krop, og den findes foerst, naar siden er laest faerdig.

### Afproevet 8. september 2026

Blokken blev indlaest i en rigtig browser. Resultatet:

| Hvad | Kom det i gang |
|---|---|
| dataLayer | ja, 12 begivenheder |
| gtag, Google Analytics | ja |
| fbq, Meta | ja |
| oaiq, OpenAI | ja |
| iubenda cookiebanner | ja, paa dansk |
| Google Tag Manager | ja |
| chatboblen | ja |
| hent-knappen | ja |
| fejl i konsollen | ingen |

### Blokken er ét script, og den starter ikke i en ramme

13. september blev de otte blokke samlet i ét script, som først tjekker om
siden vises for sig selv. Inde i en ramme, som Wix bruger i overgangen,
starter intet. Afprøvet: for sig selv starter alle otte, i en ramme
starter nul. Så er der aldrig to cookiebannere, uanset hvornår DNS skifter
for den enkelte besøgende.

### To ting der blev rettet undervejs

**Chatboblen kom ikke.** `widget.js` beder om sidens krop med det samme, og
i en head-blok findes den ikke endnu. Paa Wix laa den i bunden af siden,
derfor har det aldrig vaeret et problem der. Loest med `defer`.

**Cookiebanneret gaettede vi ikke.** I stedet peger blokken paa jeres egen
widget-adresse hos iubenda, som indeholder hele opsaetningen. Derfor ser
banneret ud og opfoerer sig praecis som i dag, uden at nogen skal skrive
indstillinger af.

### Det eneste, der stadig kraever en haand

`sporing_head.html` skal ind i hver af de 10 sider i `voreshjem-site`.
Det goeres foerst, naar vi er klar til at flytte, for lige nu ville
Meta-pixlen begynde at taelle den midlertidige Netlify-adresse med som
trafik, og saa bliver tallene rodede.

**Cookiebanneret er det vigtigste.** Forsvinder iubenda, staar I uden
samtykke paa en side, der saetter baade Meta- og Google-cookies. Det er
ikke frivilligt.

## Ændret 16. september 2026: hastighed og samtykke

- **Google Tag Manager (GTM-TQ39D7RM) er fjernet** fra alle 41 sider. Containeren var tom (ingen tags, kun indbyggede variabler) og kostede 115 KB. Google Analytics ligger fortsat direkte på siden med gtag.
- **Meta-pixel og OpenAI-pixel starter først efter samtykke til markedsføring.** Sporingsblokken kigger i dataLayer efter en consent-linje med ad_storage granted, som iubenda skriver, når den besøgende klikker ja, eller straks ved genbesøg efter tidligere ja. Testet: nej giver ingen Meta/OpenAI, ja starter dem, genbesøg efter ja starter dem. Noscript-billedet til Meta er fjernet, fordi det sendte uden samtykke.
- **Skrifttypen Plus Jakarta Sans hentes fra jeres egen side** (/fonts/plus-jakarta-sans-latin.woff2, variabel fil 200 til 800, latin) i stedet for Google Fonts. Forudindlæst, caches et år via _headers. Fjerner en blokerende fil og at besøgendes IP sendes til Google Fonts.
- **Forsidens telefonbillede (screen-kalender.webp) forudindlæses** med høj prioritet, fordi det er sidens største element.
- Resultat: sidens vægt uden samtykke 834 KB til 647 KB. Lighthouse mobil lokalt 83 til 97 efter, mod 57 til 83 før, målt over en mobilforbindelse med stor spredning.
- Backup af siden før ændringen: scratchpad voreshjem-site-foer-hastighed.tgz (kun denne session). Den tyske side (de/) er ikke ændret.
- Googles PageSpeed 16. sept. kl. 00.24: mobil 91 (før 79), computer 95. Største element vist på mobil 3,3 s (før 4,2 s), første tegn 1,2 s (før 2,7 s). En enkeltmåling kl. 00.09 gav 57 lige efter udgivelsen, men sammenligning af gammel og ny udgave fire gange hver gav 74 mod 89.
- 16. sept.: hentknap.js laver ikke laengere sin egen knap paa voreshjem.dk. Siden har selv #hent-flyd, saa der stod to ens knapper. Scriptet flytter nu sidens egen knap op over chatten, naar chattens taleboble vises, og ned igen naar den forsvinder. Beskeden taeller stadig besoeget til backenden.
- 16. sept.: Flere hent-knapper paa forsiden. Stor 'Hent appen gratis'-knap over butiksknapperne i toppen med teksten 'Eller tryk paa din butik', og fire baand med knap plus App Store og Google Play efter familiekode, opgaver, madplan og sammenligning. Alle peger paa voreshjem-bot.netlify.app/hent/app?src=hero|familiekode|opgaver|madplan|sammenlign, saa backenden kan se hvilken knap der bliver brugt.

## 17. september 2026: gamle adresser, vores-hjem.dk og bloggens interne links
- Gamle Wix-adresser sendes nu videre med 301 (se _redirects, blokken "Gamle adresser"). Domæneregler står øverst i _redirects, ellers vinder stireglen "/" for alle værter.
- vores-hjem.dk og www.vores-hjem.dk har gyldigt certifikat og sender 301 til www.voreshjem.dk.
- Alle blogindlæg har kategori i meta-linjen og en "Læs også"-boks med tre beslægtede indlæg plus link til funktionssiden. Nye indlæg får det automatisk via blogbyg.js.
