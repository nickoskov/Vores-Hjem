# Flytning af voreshjem.dk, trin for trin

*12. september 2026. Alt det tekniske er bygget og afprøvet. Herunder står
kun det, du selv skal klikke, i den rækkefølge det skal ske.*

---

## Først: mailen. En rettelse fra mig

Jeg sagde tidligere, at jeres mail ikke kom frem. Det var forkert. Jeres
mail ligger på **vores-hjem.dk** med bindestreg, nst@vores-hjem.dk, og der
er alt i orden: MX peger på Simply, og serveren svarer.

voreshjem.dk uden bindestreg har ingen mail, og det behøver den ikke,
medmindre I vil kunne modtage på @voreshjem.dk. Vil I det, opretter I MX i
Simplys panel i trin 4. Ellers springes det over.

**Men der er én ting, der gælder mail:** vores-hjem.dk har OGSÅ sine
navneservere hos Wix. Det domæne rører vi ikke i nat, og mailen kører
videre. Men den dag Wix-abonnementet opsiges, forsvinder vores-hjem.dk's
DNS med det, og så stopper mailen. **Før Wix opsiges, skal vores-hjem.dk
også flyttes til Simplys navneservere** med MX, SPF og de to
Firebase-DKIM-linjer genskabt. Det står i planen under "Efter flytningen".

---

## Trin 1, Netlify: frigiv domænet fra den døde side

En side ved navn **illustrious-frangollo-cc3d64** gør krav på voreshjem.dk.
Den er sidst udgivet 12. maj og bruges ikke til noget. Så længe den holder
domænet, kan den rigtige side ikke få det.

1. Gå til app.netlify.com og log ind
2. Åbn siden **illustrious-frangollo-cc3d64**
3. Klik **Domain management** i menuen til venstre
4. Ud for **voreshjem.dk** klikker du de tre prikker og vælger **Remove**
5. Bekræft

Du sletter ikke selve siden, kun dens krav på domænet. Vil du rydde helt op
bagefter, kan siden slettes, men det haster ikke.

## Trin 2, Netlify: giv domænet til den rigtige side

1. Åbn siden **stirring-cactus-7010c5** (den, der i dag hedder
   info.voreshjem.dk). Det er den, hele den nye side ligger på.
2. **Domain management** → **Add a domain**
3. Skriv `www.voreshjem.dk` og gem
4. Netlify spørger, om den også skal tage `voreshjem.dk` med. Sig ja.
5. Sæt **www.voreshjem.dk** som primær. Netlify sender så rod-adressen
   videre til www af sig selv.

Netlify siger nu, at domænet ikke peger på dem endnu. Det er rigtigt. Det
ordner trin 3.

## Trin 3, Simply: flyt navneserverne væk fra Wix

Lige nu styrer Wix jeres DNS (ns8.wixdns.net og ns9.wixdns.net). Det skal
væk, ellers dør DNS'en den dag Wix-abonnementet stopper.

1. Log ind på simply.com
2. Vælg domænet **voreshjem.dk**
3. Find **Navneservere**
4. Vælg **Brug Simplys navneservere**
5. Gem

Herefter er DNS'en tom og skal fyldes. Det er trin 4. **Lav trin 4 med det
samme**, så der ikke går lang tid, hvor siden er nede.

## Trin 4, Simply: skriv recordsne ind

Under **DNS-indstillinger** opretter du præcis det her:

| Type | Navn | Værdi | Hvorfor |
|---|---|---|---|
| A | @ | `75.2.60.5` | rod-domænet til Netlify |
| CNAME | www | `stirring-cactus-7010c5.netlify.app` | selve siden |
| CNAME | info | `stirring-cactus-7010c5.netlify.app` | den gamle adresse, sendes videre |
| CNAME | download | `voreshjem-download.netlify.app` | hentesiden |
| TXT | @ | `google-site-verification=y3gHV6QdKK0rDUTm_HfXC0R3BzXm1kkvUkbY4lII3GE` | Search Console |
| TXT | @ | `google-site-verification=BdEeeJxH4-oOsIWoZteZS_KdS3nH8HEYrV_6MYzR30A` | Search Console, nr. to |
| TXT | @ | `v=spf1 include:spf.simply.com include:_spf.firebasemail.com ~all` | så jeres mails ikke havner i spam |
| TXT | @ | `firebase=vores-hjem-2b372` | appens Firebase |
| TXT | _dmarc | `v=DMARC1; p=none;` | mail-politik |
| CNAME | firebase1._domainkey | `mail-voreshjem-dk.dkim1._domainkey.firebasemail.com` | underskrift på appens mails |
| CNAME | firebase2._domainkey | `mail-voreshjem-dk.dkim2._domainkey.firebasemail.com` | samme |
| MX | @ | kun hvis I vil modtage på @voreshjem.dk. Ellers udelades | valgfrit |

De fire TXT-linjer og de to DKIM-linjer er dem, der gør ondt hvis de
glemmes. De to Google-linjer holder Search Console i live. SPF og DKIM
afgør, om appens mails til brugerne lander i indbakken eller i spam.
Firebase-linjen bruger appen.

## Trin 5: sig til

Når trin 1 til 4 er klaret, siger du til. Så kører jeg `flyt.sh`, som
udgiver siden med sporing, tjekker alle 39 adresser og viser hvor domænet
peger. To minutter.

## Overgangen, time for time

Der går fra ti minutter til et døgn, før alle i verden ser den nye side.
I den tid ser nogle stadig Wix, og Wix viser den nye side inde i sin
ramme. Det er tænkt igennem:

- **Sporingen starter ikke inde i en ramme.** Så de, der stadig ser Wix,
  får Wix' eget cookiebanner og ikke to. De, der ser den nye side, får den
  fulde sporing. Afprøvet begge veje.
- **info.voreshjem.dk sendes IKKE videre til www endnu.** Det ville sende
  Wix-rammen tilbage til Wix i det uendelige. Det slås til om to dage med
  `efter_dns.sh`, som selv tjekker, at DNS er igennem, før den gør noget.
- **Certifikatet.** Netlify laver selv et certifikat til www.voreshjem.dk,
  få minutter efter DNS peger på dem. I de minutter kan enkelte se en
  advarsel om sikkerhed. Det går over af sig selv.
- **Wix-siden skal blive tændt** i mindst to uger. Så længe den er der,
  kan vi rulle tilbage ved at sætte navneserverne tilbage til Wix.

## Trin 6, om to dage

```
bash /Users/nickoskovgaard/voreshjem-flyt/efter_dns.sh
```

Slår omdirigeringen fra info til www til, og minder om at melde sitemap i
Search Console.

---

## Efter flytningen

- **Luk ikke Wix ned endnu.** Vent et par uger, så vi kan gå tilbage, hvis
  noget viser sig
- **Før Wix opsiges: flyt vores-hjem.dk til Simplys navneservere.** Det
  domæne bærer jeres mail (nst@vores-hjem.dk), og dets DNS ligger hos Wix.
  Records der skal genskabes: MX 10 mx.simply.com, SPF
  `v=spf1 include:spf.simply.com include:_spf.firebasemail.com ~all`, og
  www kan pege på voreshjem.dk. Ellers stopper mailen den dag Wix lukker
- **Soro holder op med at udgive.** Den skriver ind i Wix, og den
  forbindelse dør med flytningen. Ingen fejlbesked, indlæggene holder bare
  op med at komme. Skal ordnes bagefter
- **Meld det nye sitemap** i Search Console: `https://www.voreshjem.dk/sitemap.xml`
- Den tyske side og hreflang venter til bagefter, som aftalt

## Hvad du får ud af det

Forsiden vejede 3.842 KB gennem Wix. Direkte vejer den 204 KB. Det er
nitten gange lettere, og 1.504 KB af det, der forsvinder, er Wix' egen
JavaScript, som ingen har brug for.

Vigtigere: i dag ligger indholdet i en ramme fra info.voreshjem.dk, så
Google tilskriver det underdomænet og ikke voreshjem.dk. Efter flytningen
tæller det hele på hovedadressen.
