# Vores Hjem – regler for arbejdet i dette repo

Gælder på alle computere (Windows-PC og Mac). Repoet er den eneste kilde til, hvad der ligger live.

## Udgivelse

- www.voreshjem.dk og www.unserzuhauseapp.de er **låst** i Netlify. `netlify deploy --prod` giver fejlen
  "Deployments are locked". Det er meningen: så kan en gammel kopi aldrig overskrive det, der ligger live.
- **Lås aldrig op, og brug aldrig `--prod-if-unlocked`** for at komme uden om låsen.
- Udgiv kun med scriptet, kørt fra repoets rod:
  - `node vaerktoej/udgiv.mjs hjemmeside` laver en testudgave og tester den.
  - `node vaerktoej/udgiv.mjs hjemmeside --live` lægger den live, beholder låsen og pusher til GitHub.
  - Samme for `unserzuhause`, `download` og `unserzuhause-download`.
- Scriptet stopper, hvis repoet er bagud for GitHub, eller hvis live er nyere end repoet (`vh-version.txt`).
- Kør altid `git pull`, før du ændrer noget, og push bagefter.
- `backend/` udgives kun med `node vaerktoej/udgiv-backend.mjs` (prøveudgave) og `--live`. Scriptet samler
  de udgivne filer og bundter funktionerne (Netlifys nye format, fordi det gamle højst tillader 4 KB
  miljøvariabler). Brug aldrig `netlify deploy` direkte i `backend/`.
- `chatbot/` må **ikke** udgives herfra endnu. Funktionskoden ligger i repoet, men der er intet udgivelsesscript.

## Flytning fra Mac'ens gamle mappe (`~/voreshjem-site` m.fl.)

Repoet er nyere end Mac'ens gamle mapper. Kopiér kun filer, der **ikke findes** i repoet, fx
generator-scripts, `_redirects`, funktionskode (`netlify/functions/…`) til backend og chatbot.
**Overskriv aldrig** eksisterende filer i `hjemmeside/` eller `unserzuhause/`.
Mappen `minbolighandel/` hører ikke til Vores Hjem og skal ikke med.

## Indhold på sitet

- Nævn aldrig andre familieapps (FamilyPlan, Cozi osv.). Det er reklame for dem.
- Ingen nye synlige bokse eller layoutændringer uden ejerens ja på en testudgave.
- Virksomheden hedder Vores Hjem I/S (CVR 45804445), Middelfart. Skriv aldrig "VoresHjem" i ét ord;
  det er byggefirmaet VoresHjem A/S.
- Faste fakta: 39 kr./md. eller 199 kr./halvår for hele familien, op til 7 personer, 14 dages gratis
  prøveperiode, der fornyes automatisk, ingen reklamer, iPhone og Android. Kontakt: kontakt@vores-hjem.dk.
  Support svarer inden for 24 timer på hverdage. Data opbevares i EU, primært i Frankfurt.
  Børn uden admin ser "🔒 Privat" ved private aftaler. Kalendervisninger: dag, uge, 2 uger, 4 uger.
  Maks. 200 varer. Outlook-synkronisering er ikke bekræftet; skriv den ikke ind nye steder.
