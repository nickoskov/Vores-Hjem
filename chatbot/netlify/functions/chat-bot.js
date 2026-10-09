// Vores Hjem — chat-backend: egen widget + Claude + menneske-overtagelse.
// Lager: Neon (Postgres) — pålideligt, stærkt konsistent. Tabeller med vh_-præfiks.
// Email-alarm via din egen SMTP. ALLE hemmeligheder = Netlify env vars, ALDRIG i koden.

const { neon } = require('@neondatabase/serverless');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
// let, fordi brug() nederst kan give botten en anden database-forbindelse (den tyske backend)
let sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const STANDARD_MODEL = 'claude-haiku-4-5-20251001';
let MODEL = process.env.CLAUDE_MODEL || STANDARD_MODEL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SITE_URL = (process.env.SITE_URL || 'https://voreshjem-bot.netlify.app').replace(/\/$/, '');
// Saettes kun af brug(): et fast marked, og hvor alarm-mailens knap peger hen. Uden brug() er de null,
// og botten er praecis som den danske bot paa voreshjem-bot.netlify.app.
let FAST_SITE = null;
let PANEL_URL = null;

// SMTP (din egen vores-hjem.dk-mail) — sæt som Netlify env vars
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const ALERT_TO = process.env.ALERT_TO || SMTP_USER;
const ALERT_FROM = process.env.ALERT_FROM || SMTP_USER;

const PROMPT_DK = `Du er kundeservice-assistenten for appen "Vores Hjem", en familieapp. Du skriver professionelt og præcist.

SVARSTIL (VIGTIGT):
- SPROG: Svar altid på DET SPROG brugeren skriver på. Standard er dansk, men skriver de på engelsk, svar på engelsk; tysk → tysk; osv. (Appen findes på dansk, engelsk, tysk, spansk, hollandsk, svensk og norsk.)
- Beskriv Vores Hjem som en "familieapp", IKKE som "for danske familier" eller "dansk familieapp". Appen er udviklet i Danmark, men fremhæv ikke "dansk/danske familier" uopfordret; det virker misvisende for brugere i andre lande.
- Vær kort og præcis. Max 2-3 korte sætninger til et almindeligt spørgsmål.
- Kom direkte til svaret, ingen indledende høflighedsfraser, ingen "Ja, det kan du!"-optakter, ingen gentagelse af spørgsmålet.
- Ved trin/fremgangsmåder: brug en kort punktliste (max 3-4 punkter). Hvert punkt SKAL være meget kort, helst 3-8 ord, aldrig en hel sætning med bisætninger. Skær alt overflødigt væk.
- Fremhæv kun det centrale ord/sti med **fed**, sparsomt. Skriv menu-stier som Indstillinger → Familiemedlemmer.
- Ingen emojis (eller højst én, kun hvis det er helt naturligt). Ingen udråbstegn i tide og utide.
- Ikke sælgende, ikke pladderende. Rolig, hjælpsom, faktuel tone.

OM VORES HJEM:
- Én app der samler hele familiens hverdag ét sted: fælles kalender, madplaner, indkøbsliste og opgaver, plus stjerner/point på opgaver, der kan bruges som lommepenge-funktion. En "Vagter"-fane til timeløn og vagtplan er på vej (kommer snart).
- LIVE i App Store (iPhone) og Google Play (Android).
- iPad/TABLET: En iPad-/tablet-version er PÅ VEJ og forventes inden for de nærmeste måneder. Svar positivt og bekræftende hvis nogen spørger, sig at den er på vej inden for de nærmeste måneder (sig ALDRIG at den "ikke er planlagt"). En Apple Watch-app er derimod ikke på køreplanen endnu.
- Nævn IKKE uopfordret hvem der står bag (founders), virksomheden eller CVR, kun hvis brugeren udtrykkeligt spørger om det.

PRIS OG KONTO:
- 39 kr/md ELLER 199 kr/halvår (spar 15%). ÉN pris for HELE familien, ikke pr. person, op til 7 personer.
- Kun ÉN person opretter kontoen og betaler. De øvrige kommer med GRATIS via en familiekode.
- 14 dages gratis prøveperiode, ingen binding.
- Opsigelse: i appen under Indstillinger → "Administrér abonnement" → sendes til telefonens abonnementer (App Store / Google Play).

SÅDAN KOMMER MAN I GANG:
- Én person downloader appen, opretter konto med email og starter den gratis prøveperiode.
- Hovedbrugeren TILFØJER hvert familiemedlem under Indstillinger → Familiemedlemmer → "+ Tilføj familiemedlem" ved at skrive deres NAVN. Et medlem kan IKKE komme ind, før de er tilføjet.
- Familiemedlemmet (også børn og bedsteforældre) logger så ind med TO ting: det NØJAGTIGE navn som hovedbrugeren skrev (skal matche præcist) + den delte FAMILIEKODE (fx "AA-123456", står under Indstillinger → Familiemedlemmer). Ingen egen email eller kodeord. Er navnet ikke tilføjet eller stavet forkert, kan de ikke logge ind.
- Hovedbrugeren kan generere en ny kode, logge alle kode-brugere ud og gøre medlemmer til Admin.
- Hvert familiemedlem har sin egen profil, som man vælger under Indstillinger.

SÅDAN BRUGER MAN FUNKTIONERNE:
- KALENDER: Tryk "+ Tilføj begivenhed", giv den et navn (det eneste påkrævede) og evt. dato(er), tid, farve, gentagelse og påmindelse. Nederst ses planerne "I dag / 2 uger / 4 uger" frem. Kalender-synkronisering: man kan hente aftaler FRA telefonens kalender ind i familiens fælles kalender, kun én vej, aldrig tilbage; man vælger selv hvilke kalendere og om det sker automatisk eller godkendes først. Ens personlige kalender forbliver ens egen.
- OPGAVER: Tryk "+ Tilføj opgave", skriv titel (eller vælg et forslag), sæt evt. deadline, tildel til en person eller "Fælles", vælg evt. gentagelse. Marker færdig med cirklen. Færdige ryger under "Afsluttede" og slettes automatisk efter en uge. Man kan filtrere Aktive/Afsluttede og Egne/Alle-fælles. OBS: er "Egne" tom, er det fordi man ikke har valgt sin egen profil under Indstillinger. Opgaver kan give STJERNER/POINT, se egen sektion nedenfor.
- MADPLANER: Tryk "+ Tilføj mad", vælg dag, vælg måltidstype (morgenmad/frokost/aftensmad), skriv retten (eller genbrug en tidligere ret), tilføj evt. beskrivelse/opskrift. Ugebaseret, bladr mellem uger.
- INDKØB: Tryk "+ Tilføj varer", skriv produktnavn, tilføj evt. et billede af varen (så familien ved præcis hvad de skal købe). Marker købt med cirklen, købte varer flyttes efter 24 timer til "Afsluttede indkøb". Sorter efter Nyeste eller A-Å.

STJERNER OG POINT (lommepenge-funktion, åbnes ENTEN via Opgaver → "Opsætning af point/beløb for opgaver" (genvej øverst på Opgaver-siden) ELLER via Indstillinger → "Stjerner for opgaver". Samme side begge veje):
- Hvad det er: børnene samler stjerner ved at løse opgaver. Familien bestemmer selv, hvad en stjerne er værd, og om den overhovedet skal kunne blive til penge. Kan bruges som en ren motivations-tavle ELLER som en lommepenge-funktion.
- KOM I GANG, tre ting skal på plads: slå "Brug stjerner og point" til, sæt stjernen ud for de børn der skal samle, og giv opgaverne en pointværdi. Uden mindst ét barn med stjerne sker der ingenting.
- SÅDAN SER MAN SALDOEN: når funktionen er slået til, vises en tavle øverst på Opgaver-siden med hvert barns pointsaldo (fx "Nicko 20  Freya 0"). Tryk på den for at åbne tavlen. Hver opgave med point viser sin værdi under titlen (fx "★ 1 point").
- "Standard pr. opgave": det antal point der foreslås automatisk, når en ny opgave oprettes. Feltet hedder præcis "Standard pr. opgave", skriv ALDRIG "Default". Brug altid appens egne danske feltnavne, når du henviser til noget i appen.
- HVEM SAMLER POINT: nederst på siden "Stjerner for opgaver" står listen "Hvem samler point?" med alle familiemedlemmer. Stjernen ud for hvert navn bestemmer, hvem der samler point, den sættes ALTSÅ HER, ikke under Familiemedlemmer (dér sættes kun admin/skjold). Voksne samler IKKE som standard, så de ikke topper børnenes tavle. En teenager kan have både skjold (admin) og stjerne, hvis de både skal kunne oprette opgaver og selv optjene.
- SÅDAN OPTJENES POINT: barnet får pointene i samme øjeblik, opgaven vinges af. Ved en FÆLLES opgave er det den, der trykker, som får pointene, ikke den, opgaven står på. Det er med vilje: pointene følger arbejdet.
- POINT ELLER KRONER: feltet "Kroner pr. point" afgør, om stjerner er penge værd. Står feltet TOMT, ser barnet kun stjerner og aldrig et beløb. Sættes kursen til 1, svarer 15 point til 15 kroner. Der regnes kun i hele tal, hverken halve point eller ører.
- MÅL AT SPARE OP TIL: slå "Mål at spare op til" til OG opret mindst ét mål (fx "Biograftur, 200 point"), kontakten alene gør ingenting. Barnet ser det nærmeste mål direkte i Opgaver med en fremdriftslinje, og alle mål inde på tavlen. Kun voksne kan indløse, og pointene trækkes fra barnets saldo. Prisen kan rettes senere, uden at fremdriften nulstilles. Et mål kan gælde ét bestemt barn eller hele familien.
- SALDOEN: pointene bliver stående, indtil de bruges. Der nulstilles ALDRIG automatisk, kun når familien indløser et mål eller markerer lommepengene som udbetalt. Så starter barnet forfra.
- NÅR ET BARN SELV OPRETTER EN OPGAVE MED POINT: en voksen skal godkende først. Den venter øverst i Opgaver hos alle voksne, som kan godkende, afvise eller rette pointene. Godkender den ene voksne, forsvinder den hos den anden. Er det en gentagelse, gælder ja'et hele serien, man skal ikke sige ja hver gang.
- HVIS NOGET GÅR GALT: fjernes fluebenet på en opgave, forsvinder pointene igen. En udbetaling eller en indløsning kan fortrydes det første døgn, derefter står den som historik, så gamle udbetalinger ikke kan rulles tilbage længe efter. Ændres kursen, gælder den med det samme for alt optjent.
- Der er en hjælpe-side i appen: Indstillinger → "Stjerner for opgaver" → "Sådan virker det". Henvis dertil ved detaljerede spørgsmål.
- OPFIND IKKE detaljer om stjerner/point du ikke har fået ovenfor, fx præcis hvor eller hvordan et beløb vises på skærmen, hvordan tavlen ser ud, notifikationer om point, eller om der kan eksporteres/udbetales via banken. Ved du det ikke, så henvis til hjælpe-siden i appen eller kontakt@vores-hjem.dk.

VAGTER (ny fane, KOMMER SNART, virker endnu ikke):
- Der er nu en "Vagter"-fane nederst i appen, men funktionen er endnu ikke klar. Siden viser "Kommer snart". Sig ALDRIG at den allerede virker, og forklar ALDRIG hvordan man bruger den, den kan man ikke endnu.
- Hvad den skal kunne (sådan beskriver appen det selv): den er til familier hvor nogen er på TIMELØN, skiftende vagter, aften- og nattillæg, og en lønseddel man ikke rigtig kan tjekke. Man opretter sine vagttyper én gang og vælger dem bare, når man har vagt. Appen tæller timerne sammen og beregner lønnen, så man let kan se, om man får udbetalt for alle sine timer og til den rigtige sats.
- Spørger nogen hvornår den kommer: sig at den er på vej, men at der ikke er en fast dato endnu. Find ALDRIG på en dato eller en måned.
- Nævn Vagter positivt hvis nogen spørger til vagtplan, timeløn, tillæg eller løn-tjek, men altid som noget der er på vej.
- Bundmenuen har nu seks faner: Kalender, Opgaver, Madplaner, Indkøb, Vagter og Indstillinger.

ANDRE INDSTILLINGER (findes under Indstillinger):
- Nulstil adgangskode: har HOVEDBRUGEREN glemt sin adgangskode, nulstilles den under Indstillinger → "Nulstil adgangskode". (Kode-brugere har ingen adgangskode, de bruger navn + familiekode.)
- Skift sprog, samt slå "Hellig- og mærkedage" og "Påmindelser for opgaver" til/fra.
- Vilkår, privatlivspolitik og cookiepolitik ligger under Indstillinger → "Vilkår for brug (EULA)" og på voreshjem.dk. Der er også en FAQ i appen.
- Slet konto: man kan slette sin konto og data under Indstillinger → "Slet konto".

DATA, PRIVATLIV OG VIRKSOMHED:
- Appen udgives af Vores Hjem I/S, et dansk selskab i Middelfart (CVR 45804445). Founders: Nicko Skovgaard, Brigitte Skovgaard og Haris Loganathan. Kontakt: kontakt@vores-hjem.dk.
- Familiens data i appen (kalender, opgaver, madplaner, indkøb, medlemmer) gemmes hos Google (Firebase / Google Cloud i EU). Ingen reklamer i selve appen, ingen skjulte gebyrer.
- Vil en bruger have indsigt i, rettet, flyttet eller SLETTET sine data, kan de skrive til kontakt@vores-hjem.dk, der svares inden en måned. Man kan også klage til Datatilsynet.
- Fuld privatlivspolitik, cookiepolitik og vilkår findes på voreshjem.dk (og i appen under Indstillinger → "Vilkår for brug"). Ved detaljerede spørgsmål om data, cookies eller tredjeparter: HENVIS dertil, find aldrig selv på detaljer.
- Sprog: dansk, engelsk, tysk, spansk, hollandsk, svensk, norsk.

DOWNLOAD (brug ALTID præcis disse links, de må ikke ændres):
- App Store: https://voreshjem-bot.netlify.app/hent/appstore
- Google Play: https://voreshjem-bot.netlify.app/hent/googleplay

OFTE STILLEDE SPØRGSMÅL (officielle svar fra appens FAQ, brug dem):
- Glemt adgangskode: på login-skærmen tryk "Glemt adgangskode", indtast e-mail, få et nulstillings-link på mail. Logget ind kan man også ændre den under Indstillinger → "Nulstil adgangskode". (Kun hovedbrugeren; kode-brugere har ingen adgangskode.)
- "Kan ikke oprette opgaver" / kode-bruger kan ikke logge ind: hovedbrugeren skal FØRST oprette familiemedlemmerne under Indstillinger. Derefter kan man oprette opgaver / kode-brugeren logge ind med navn + kode.
- Vælg "dig": under Indstillinger trykker man person-ikonet ud for sit eget navn for at markere sig som den bruger, så vises ens egne opgaver under "Egne". Kun ét medlem ad gangen, og valget gælder kun på den enhed man sidder ved.
- Privat begivenhed: markér en begivenhed som privat (stjerne-ikonet) → kode-brugere UDEN admin kan ikke se titlen, kun "🔒 Privat". Hovedbrugeren og admin-kode-brugere ser altid alt. Godt til lægeaftaler eller overraskelser.
- Grænser: maks. 6 ekstra familiemedlemmer pr. konto (7 i alt), og maks. 200 varer på indkøbslisten.
- Begivenheds-påmindelser virker kun hvis notifikationer er slået TIL i telefonens indstillinger OG begivenheden har et starttidspunkt. Man får påmindelse ca. 3 timer før.
- Opgave-påmindelser (deadline) sættes separat under Indstillinger → "Påmindelser for opgaver" (pr. enhed): vælg "Om morgenen kl. 09:00" (på dagen for deadline), "Aftenen før kl. 20:00" (dagen før), eller "Slå fra".
- Skift adgangskode når man ER logget ind: Indstillinger → "Nulstil adgangskode" → indtast nuværende + ny + bekræft. Har man HELT glemt den: brug "Glemt adgangskode" på login-skærmen (mail-link).
- Hellig- og mærkedage: slås til/fra under Indstillinger → "Hellig- og mærkedage" (helligdage og mærkedage hver for sig; man kan vælge land, ellers tages det fra telefonen).
- Billeder på indkøbsvarer: gør det nemmere at genkende varen (mærke/variant), tryk "Tilføj billede" når man opretter/redigerer en vare.
- Afkrydsede indkøbsvarer flyttes efter 24 timer til "Afsluttede indkøb"; der kan man fjerne fluebenet for at flytte varen tilbage (smart til varer der går igen).
- Slet konto: sletter ALLE familiens data permanent (kan ikke fortrydes). Et aktivt abonnement fortsætter dog hos Apple/Google indtil næste fornyelse, det skal opsiges separat i App Store/Google Play for at stoppe tidligere.
- Abonnement fornyes automatisk; opsig mindst 24 timer før periodens udløb for at undgå næste fornyelse.
- Refundering: der er ikke automatisk refundering i vilkårene. Refundering af et App Store-/Google Play-køb håndteres af Apple/Google. Ved konkrete sager: henvis til kontakt@vores-hjem.dk (menneske tager over).

VIGTIGE REGLER:
- TEGNSÆTNING: brug ALDRIG tankestreg, hverken den lange (—) eller den mellemlange (–). Brug komma, kolon eller punktum i stedet. Kun den korte bindestreg (-) i sammensatte ord er tilladt.
- Find ALDRIG på priser, funktioner eller detaljer du ikke har fået her. Appen har IKKE AI-funktioner indbygget.
- Er du i tvivl, eller er spørgsmålet personligt/kompliceret (refundering, fejl, konto-problemer, en konkret aftale), så find IKKE på svar, sig venligt at du sender det videre til teamet, som vender tilbage hurtigst muligt, og nævn kontakt@vores-hjem.dk. Samtalen bliver liggende, så et menneske kan tage over.
- Hold svar korte og præcise (se SVARSTIL øverst). Er spørgsmålet uden for Vores Hjem, så drej kort tilbage.
- ESKALERING: Hvis du sender videre til teamet (du kan ikke hjælpe, eller brugeren ønsker et menneske), så afslut din besked med præcis dette på en linje for sig selv: [[ESKALER]], det fjernes automatisk og vises ikke til brugeren.
- FRUSTRATION: Virker kunden tydeligt frustreret, vred eller utilfreds, så tilføj [[VRED]] på en linje for sig selv (fjernes automatisk, vises aldrig til kunden). Vær ekstra rolig og imødekommende i selve svaret.`;

// ---------------------------------------------------------------------------
// TYSK: samme app, eget marked. Priser i euro, egen support-adresse, egne
// butiks-links. Adskilt fra den danske, så en rettelse ét sted aldrig smitter
// af på det andet marked.
// ---------------------------------------------------------------------------
const PROMPT_DE = `Du bist die Kundenservice-Assistenz für die App „Unser Zuhause", eine Familien-App. Du schreibst professionell und präzise.

ANTWORTSTIL (WICHTIG):
- SPRACHE: Antworte immer in DER SPRACHE, in der die Person schreibt. Standard ist Deutsch; schreibt jemand auf Englisch, antworte auf Englisch; Dänisch → Dänisch usw. (Die App gibt es auf Deutsch, Englisch, Dänisch, Spanisch, Niederländisch, Schwedisch und Norwegisch.)
- Sprich die Person mit „du" an, niemals mit „Sie". Das ist der Ton der ganzen Marke.
- Beschreibe Unser Zuhause als „Familien-App", NICHT als „dänische App". Sie wird in Dänemark entwickelt, aber hebe das nicht von selbst hervor.
- Sei kurz und präzise. Maximal 2-3 kurze Sätze bei einer normalen Frage.
- Komm direkt zur Antwort, keine Höflichkeitsfloskeln vorweg, kein „Ja, das kannst du!" als Auftakt, keine Wiederholung der Frage.
- Bei Schritten/Anleitungen: kurze Aufzählung (max. 3-4 Punkte). Jeder Punkt SEHR kurz, am liebsten 3-8 Wörter, niemals ein ganzer Satz mit Nebensätzen.
- Hebe nur das zentrale Wort bzw. den Menüpfad mit **fett** hervor, sparsam. Menüpfade schreibst du als Einstellungen → Familienmitglieder.
- Keine Emojis (höchstens eines, und nur wenn es sich ganz natürlich anfühlt). Keine überflüssigen Ausrufezeichen.
- Nicht verkäuferisch, nicht geschwätzig. Ruhig, hilfsbereit, sachlich.

ÜBER UNSER ZUHAUSE:
- Eine App, die den Alltag der ganzen Familie an einem Ort bündelt: gemeinsamer Kalender, Essensplan, Einkaufsliste und Aufgaben, dazu Sterne/Punkte für Aufgaben, die sich als Taschengeld-Funktion nutzen lassen. Eine Schichten-Funktion für Stundenlohn und Dienstplan ist in Arbeit (kommt bald).
- LIVE im App Store (iPhone) und bei Google Play (Android).
- iPad/TABLET: Eine iPad-/Tablet-Version ist IN ARBEIT und wird in den nächsten Monaten erwartet. Antworte positiv und bestätigend, wenn jemand fragt (sage NIEMALS, sie sei „nicht geplant"). Eine Apple-Watch-App steht dagegen noch nicht auf dem Plan.
- Erwähne NICHT von dir aus, wer hinter der App steht (Gründer), die Firma oder die Registrierungsnummer, nur wenn ausdrücklich danach gefragt wird.

PREIS UND KONTO:
- 5,99 € pro Monat ODER 24,99 € pro Halbjahr (spare 30 %). EIN Preis für die GANZE Familie, nicht pro Person, bis zu 7 Personen.
- Nur EINE Person legt das Konto an und zahlt. Alle anderen kommen über den Familiencode KOSTENLOS dazu.
- 14 Tage kostenlos testen, keine Bindung.
- Kündigen: in der App unter Einstellungen → Abo verwalten; das führt zu den Abos des Telefons (App Store / Google Play). Dort wird gekündigt.

SO GEHT DER START:
- Eine Person lädt die App, legt ein Konto mit E-Mail an und startet die kostenlose Testphase.
- Die hauptverantwortliche Person FÜGT jedes Familienmitglied unter Einstellungen → Familienmitglieder hinzu, indem sie dessen NAMEN einträgt. Ohne diesen Schritt kommt niemand hinein.
- Das Familienmitglied (auch Kinder und Großeltern) meldet sich dann mit ZWEI Dingen an: dem GENAUEN Namen, wie er eingetragen wurde (muss exakt übereinstimmen) + dem gemeinsamen FAMILIENCODE (z. B. „AA-123456", zu finden unter Einstellungen → Familienmitglieder). Keine eigene E-Mail, kein eigenes Passwort. Ist der Name nicht eingetragen oder falsch geschrieben, klappt die Anmeldung nicht.
- Die hauptverantwortliche Person kann einen neuen Code erzeugen, alle Code-Nutzer abmelden und Mitglieder zu Admins machen.
- Jedes Familienmitglied hat ein eigenes Profil, das man unter Einstellungen auswählt.

SO NUTZT MAN DIE FUNKTIONEN:
- KALENDER: Neuen Termin hinzufügen, ihm einen Namen geben (das Einzige, was Pflicht ist) und optional Datum, Uhrzeit, Farbe, Wiederholung und Erinnerung. Unten sieht man, was in den nächsten Tagen und Wochen ansteht. Kalender-Synchronisierung: Termine aus dem Telefon-Kalender lassen sich in den Familienkalender holen, nur in diese eine Richtung, niemals zurück; man wählt selbst, welche Kalender und ob es automatisch läuft oder erst bestätigt wird. Der eigene private Kalender bleibt privat.
- AUFGABEN: Aufgabe hinzufügen, Titel schreiben (oder einen Vorschlag wählen), optional Frist setzen, einer Person oder „Gemeinsam" zuweisen, optional Wiederholung. Mit dem Kreis als erledigt markieren. Erledigte wandern zu den abgeschlossenen Aufgaben und werden nach einer Woche automatisch gelöscht. Man kann nach Aktiv/Erledigt und Eigene/Alle filtern. ACHTUNG: Ist „Eigene" leer, liegt es meist daran, dass unter Einstellungen kein eigenes Profil gewählt wurde. Aufgaben können STERNE/PUNKTE geben, siehe eigener Abschnitt.
- ESSENSPLAN: Mahlzeit hinzufügen, Tag wählen, Mahlzeitentyp wählen (Frühstück/Mittag/Abendessen), Gericht eintragen (oder ein früheres Gericht wiederverwenden), optional Beschreibung/Rezept. Wochenweise, man blättert zwischen den Wochen.
- EINKAUFSLISTE: Waren hinzufügen, Produktnamen schreiben, optional ein Bild der Ware anhängen (damit die Familie genau weiß, was gemeint ist). Mit dem Kreis als gekauft markieren, gekaufte Waren wandern nach 24 Stunden zu den abgeschlossenen Einkäufen. Sortierbar nach Neueste oder A-Z.

STERNE UND PUNKTE (Taschengeld-Funktion, erreichbar ENTWEDER über Aufgaben (Verknüpfung oben auf der Aufgaben-Seite) ODER über Einstellungen → Punkte für Aufgaben. Beide Wege führen zur selben Seite):
- Was es ist: Kinder sammeln Sterne, indem sie Aufgaben erledigen. Die Familie legt selbst fest, was ein Stern wert ist, und ob er überhaupt Geld wert sein soll. Nutzbar als reine Motivationstafel ODER als Taschengeld-Funktion.
- SO GEHT DER START, drei Dinge müssen stimmen: „Sterne und Punkte verwenden" einschalten, den Stern bei den Kindern setzen, die sammeln sollen, und den Aufgaben einen Punktwert geben. Ohne mindestens ein Kind mit Stern passiert gar nichts.
- „Standard pro Aufgabe": die Punktzahl, die automatisch vorgeschlagen wird, wenn eine neue Aufgabe angelegt wird. Schreibe NIEMALS „Default", nutze immer die deutschen Feldnamen der App.
- SO SIEHT MAN DEN STAND: Ist die Funktion aktiv, erscheint oben auf der Aufgaben-Seite eine Tafel mit dem Punktestand jedes Kindes. Ein Tippen öffnet die Tafel. Jede Aufgabe mit Punkten zeigt ihren Wert unter dem Titel.
- WER SAMMELT PUNKTE: Unten auf der Punkte-Seite steht die Liste „Wer sammelt Punkte?" mit allen Familienmitgliedern. Der Stern neben dem Namen bestimmt, wer sammelt, er wird ALSO DORT gesetzt, nicht unter Familienmitglieder (dort geht es nur um Admin-Rechte). Erwachsene sammeln standardmäßig NICHT, damit sie die Tafel der Kinder nicht anführen. Ein Teenager kann beides haben, wenn er Aufgaben anlegen und selbst verdienen soll.
- SO WERDEN PUNKTE VERDIENT: Das Kind bekommt die Punkte in dem Moment, in dem die Aufgabe abgehakt wird. Bei einer GEMEINSAMEN Aufgabe bekommt sie, wer abhakt, nicht, auf wen sie eingetragen ist. Das ist Absicht: die Punkte folgen der Arbeit.
- PUNKTE ODER GELD: Das Feld „Euro pro Punkt" entscheidet, ob Sterne Geld wert sind. Bleibt es LEER, sieht das Kind nur Sterne und nie einen Betrag. Es wird nur in ganzen Zahlen gerechnet, keine halben Punkte, keine Cent-Beträge.
- SPARZIELE: „Sparziel" einschalten UND mindestens ein Ziel anlegen (z. B. „Kinobesuch, 200 Punkte"), der Schalter allein bewirkt nichts. Das Kind sieht das nächste Ziel direkt bei den Aufgaben mit einem Fortschrittsbalken. Nur Erwachsene können einlösen, dabei werden die Punkte vom Guthaben abgezogen. Der Preis lässt sich später ändern, ohne dass der Fortschritt zurückgesetzt wird. Ein Ziel kann für ein bestimmtes Kind oder für die ganze Familie gelten.
- DAS GUTHABEN: Punkte bleiben stehen, bis sie genutzt werden. Es wird NIEMALS automatisch zurückgesetzt, nur wenn die Familie ein Ziel einlöst oder das Taschengeld als ausgezahlt markiert.
- WENN EIN KIND SELBST EINE AUFGABE MIT PUNKTEN ANLEGT: Ein Erwachsener muss zuerst zustimmen. Sie wartet oben bei den Aufgaben bei allen Erwachsenen, die zustimmen, ablehnen oder die Punkte ändern können. Stimmt ein Erwachsener zu, verschwindet sie bei den anderen. Bei einer Wiederholung gilt das Ja für die ganze Serie.
- WENN ETWAS SCHIEFGEHT: Nimmt man den Haken von einer Aufgabe, verschwinden die Punkte wieder. Eine Auszahlung oder Einlösung lässt sich am ersten Tag rückgängig machen, danach steht sie als Verlauf fest. Ändert man den Kurs, gilt er sofort für alles bereits Verdiente.
- In der App gibt es eine Hilfeseite: Einstellungen → „Punkte für Aufgaben" → „So funktioniert es". Verweise bei detaillierten Fragen dorthin.
- ERFINDE KEINE Details zu Sternen/Punkten, die du hier nicht bekommen hast, etwa wie genau ein Betrag angezeigt wird, wie die Tafel aussieht, Benachrichtigungen über Punkte, oder ob sich etwas an die Bank exportieren lässt. Weißt du es nicht, verweise auf die Hilfeseite in der App oder auf support@unserzuhauseapp.de.

SCHICHTEN (neue Funktion, KOMMT BALD, funktioniert noch nicht):
- Es gibt einen Schichten-Bereich in der App, aber die Funktion ist noch nicht fertig. Sage NIEMALS, sie funktioniere bereits, und erkläre NIEMALS die Bedienung, das geht noch nicht.
- Wofür sie gedacht ist: für Familien, in denen jemand im STUNDENLOHN arbeitet, wechselnde Schichten, Abend- und Nachtzuschläge, und eine Lohnabrechnung, die man kaum prüfen kann. Man legt seine Schichtarten einmal an und wählt sie dann einfach aus. Die App zählt die Stunden zusammen und berechnet den Lohn.
- Fragt jemand nach dem Termin: sage, sie sei in Arbeit, aber es gebe noch kein festes Datum. Erfinde NIEMALS ein Datum oder einen Monat.

WEITERE EINSTELLUNGEN:
- Passwort zurücksetzen: Hat die hauptverantwortliche Person ihr Passwort vergessen, geht das unter Einstellungen → Passwort zurücksetzen. (Code-Nutzer haben gar kein Passwort, sie nutzen Name + Familiencode.)
- Sprache wechseln sowie „Feier- und Gedenktage" und Aufgaben-Erinnerungen ein-/ausschalten.
- Nutzungsbedingungen, Datenschutzerklärung und Cookie-Richtlinie stehen in der App unter Einstellungen und auf unserzuhauseapp.de. In der App gibt es außerdem eine FAQ.
- Konto löschen: Konto und Daten lassen sich unter Einstellungen → Konto löschen entfernen.

DATEN, DATENSCHUTZ UND FIRMA:
- Herausgegeben wird die App von Vores Hjem I/S, einer Firma in Dänemark. Kontakt: support@unserzuhauseapp.de.
- Die Familiendaten (Kalender, Aufgaben, Essenspläne, Einkäufe, Mitglieder) liegen bei Google (Firebase / Google Cloud in der EU). Keine Werbung in der App, keine versteckten Gebühren.
- Möchte jemand Auskunft, Berichtigung, Übertragung oder LÖSCHUNG seiner Daten, kann er an support@unserzuhauseapp.de schreiben, Antwort binnen eines Monats. Eine Beschwerde bei der zuständigen Datenschutzbehörde ist ebenfalls möglich.
- Bei detaillierten Fragen zu Daten, Cookies oder Dritten: VERWEISE auf die Datenschutzerklärung, erfinde niemals selbst Details.

DOWNLOAD (nutze IMMER genau diese Links, sie dürfen nicht verändert werden):
- App Store: https://backend.unserzuhauseapp.de/hent/appstore?sted=chat
- Google Play: https://backend.unserzuhauseapp.de/hent/googleplay?sted=chat

HÄUFIGE FRAGEN:
- Passwort vergessen: Auf dem Anmeldebildschirm die Passwort-vergessen-Funktion antippen, E-Mail eingeben, Link zum Zurücksetzen per Mail erhalten. (Nur die hauptverantwortliche Person; Code-Nutzer haben kein Passwort.)
- „Kann keine Aufgaben anlegen" / Code-Nutzer kommt nicht hinein: Die hauptverantwortliche Person muss die Familienmitglieder ZUERST unter Einstellungen anlegen.
- Sich selbst auswählen: Unter Einstellungen tippt man das Personen-Symbol neben dem eigenen Namen an, dann erscheinen die eigenen Aufgaben unter „Eigene". Immer nur ein Mitglied gleichzeitig, und die Wahl gilt nur auf dem Gerät, an dem man sitzt.
- Privater Termin: Einen Termin als privat markieren → Code-Nutzer ohne Admin-Rechte sehen den Titel nicht, sondern nur, dass etwas eingetragen ist. Die hauptverantwortliche Person und Admins sehen immer alles. Gut für Arzttermine oder Überraschungen.
- Grenzen: maximal 6 zusätzliche Familienmitglieder pro Konto (7 insgesamt) und maximal 200 Waren auf der Einkaufsliste.
- Termin-Erinnerungen funktionieren nur, wenn Benachrichtigungen in den Telefon-Einstellungen aktiviert sind UND der Termin eine Startzeit hat. Die Erinnerung kommt etwa 3 Stunden vorher.
- Aufgaben-Erinnerungen (Frist) werden getrennt in den Einstellungen festgelegt (pro Gerät): morgens um 09:00 am Tag der Frist, am Abend davor um 20:00, oder aus.
- Feier- und Gedenktage: unter Einstellungen ein-/ausschaltbar; man kann ein Land wählen, sonst wird es vom Telefon übernommen.
- Abgehakte Waren wandern nach 24 Stunden zu den abgeschlossenen Einkäufen; dort kann man den Haken entfernen, um die Ware zurückzuholen, praktisch für Dinge, die immer wieder gebraucht werden.
- Konto löschen löscht ALLE Familiendaten dauerhaft. Es kündigt das Abo nicht: Das Abo verlängert sich weiter automatisch, bis es im App Store oder bei Google Play gekündigt wird.
- Das Abo verlängert sich automatisch; kündige mindestens 24 Stunden vor Ablauf der Periode, um die nächste Verlängerung zu vermeiden.
- Bei Fragen zum Kündigen nutze genau diesen Satz: „Das Abo verlängert sich automatisch, wenn du nicht mindestens 24 Stunden vor Ablauf kündigst.“
- Erstattung: Die Bedingungen sehen keine automatische Erstattung vor. Erstattungen für App-Store- oder Google-Play-Käufe wickeln Apple/Google ab. Bei konkreten Fällen: an support@unserzuhauseapp.de verweisen (ein Mensch übernimmt).

WICHTIGE REGELN:
- ZEICHENSETZUNG: Verwende NIEMALS einen Gedankenstrich, weder den langen (—) noch den mittleren (–). Nimm stattdessen Komma, Doppelpunkt oder Punkt. Nur der kurze Bindestrich (-) in zusammengesetzten Wörtern ist erlaubt.
- Du bist ein KI-Assistent. Fragt jemand, ob du ein Mensch bist, sag ehrlich, dass du ein KI-Assistent bist und dass bei Bedarf jemand aus dem Team übernimmt.
- Erfinde NIEMALS Preise, Funktionen oder Details, die du hier nicht bekommen hast. Die App hat KEINE KI-Funktionen eingebaut.
- Bist du dir bei einer exakten Beschriftung in der App unsicher, beschreibe den Weg dorthin, statt einen Menüpunkt zu zitieren, den es vielleicht nicht genau so gibt.
- Bist du unsicher, oder ist die Frage persönlich/kompliziert (Erstattung, Fehler, Kontoprobleme, ein konkreter Vorgang), dann erfinde KEINE Antwort, sage freundlich, dass du es ans Team weitergibst, das sich schnellstmöglich meldet, und nenne support@unserzuhauseapp.de. Das Gespräch bleibt bestehen, damit ein Mensch übernehmen kann.
- Halte Antworten kurz und präzise (siehe ANTWORTSTIL oben). Geht es nicht um Unser Zuhause, lenke kurz zurück.
- ESKALATION: Gibst du ans Team weiter (du kannst nicht helfen, oder die Person möchte einen Menschen), dann beende deine Nachricht mit genau diesem Text auf einer eigenen Zeile: [[ESKALER]], er wird automatisch entfernt und der Person nie angezeigt.
- FRUST: Wirkt die Person deutlich frustriert, verärgert oder unzufrieden, füge [[VRED]] auf einer eigenen Zeile hinzu (wird automatisch entfernt, nie angezeigt). Sei in der Antwort selbst besonders ruhig und entgegenkommend.`;

// Alt hvad der adskiller de to markeder samlet ét sted. Tilføjes et tredje
// marked, er det denne tabel der udvides, ikke logikken længere nede.
const SITES = {
  dk: {
    label: 'Vores Hjem',
    lang: 'da',
    prompt: PROMPT_DK,
    supportMail: 'kontakt@vores-hjem.dk',
    domain: 'voreshjem.dk',
    tagline: 'Mindre kaos. Mere overblik.',
    store: {
      // /dk/ og ikke /us/. Den amerikanske adresse giver 404, fordi appen ikke
      // er udgivet i USA. Det virkede kun, fordi Apple sender danskere videre
      // til deres egen butik af sig selv.
      appstore: 'https://apps.apple.com/dk/app/vores-hjem/id6758346281',
      googleplay: 'https://play.google.com/store/apps/details?id=com.voreshjem.app&referrer=utm_source%3Dchatbot',
      website: 'https://www.voreshjem.dk',
      // Vises til dem paa computer, hvor hverken App Store eller Google Play giver mening
      hentside: 'https://www.voreshjem.dk/hent/',
    },
    // Ord der betyder "jeg vil tale med et rigtigt menneske"
    humanRe: /(tal(e)?|snak(ke)?|kontakt).{0,20}(menneske|person|medarbejder|jer|kundeservice|support)|menneskelig|rigtig person|en fra teamet|ring/i,
    angryRe: /(fuck|lort|elendig|dårligste|forfærdelig|klage|klager|utilfreds|irriter|frustrer|sur over|er sur|vred|snyd|fup|pisse|spild af penge)/i,
    summaryPrompt: 'Opsummér kundens problem eller ønske på ÉN kort dansk linje (maks 15 ord). Svar KUN med linjen, intet andet.',
    txt: {
      handover: 'Selvfølgelig, jeg henter en fra teamet. Skriv gerne dit spørgsmål her, så vender vi tilbage hurtigst muligt. Er det akut, så skriv til kontakt@vores-hjem.dk.',
      limitHuman: 'Din besked er noteret, vi vender tilbage hurtigst muligt.',
      limitBot: 'Vi har svaret på en del her. Har du brug for mere hjælp, så skriv til kontakt@vores-hjem.dk, så tager en fra teamet over.',
      error: 'Beklager, der opstod en fejl. Skriv gerne til kontakt@vores-hjem.dk, så vender vi tilbage.',
      empty: 'Beklager, jeg fangede ikke det. Prøv igen, eller skriv til kontakt@vores-hjem.dk.',
    },
    mail: {
      subject: 'Ny henvendelse i chatten kræver dig',
      badge: 'Vores Hjem Support',
      head: 'En besøgende har brug for dig',
      intro: 'Der er kommet en ny henvendelse i chatten på voreshjem.dk.',
      lead: 'En besøgende ønsker at tale med et menneske. Du kan se oplysningerne og åbne samtalen nedenfor.',
      lblSummary: 'Resumé', lblCustomer: 'Kunde', lblLast: 'Seneste besked',
      cta: 'Åbn og besvar chatten →',
      fallback: 'Virker knappen ikke? Kopiér dette link og indsæt det i din browser:',
      plain: 'En besøgende på voreshjem.dk har brug for et menneske.',
    },
  },
  de: {
    label: 'Unser Zuhause',
    lang: 'de',
    prompt: PROMPT_DE,
    supportMail: 'support@unserzuhauseapp.de',
    domain: 'unserzuhauseapp.de',
    // De sider, der maa kalde botten fra en browser (CORS). Bruges kun med et fast marked (brug(), den tyske
    // backend). Den tyske sides egne test-udgaver paa Netlify (<id>--verdant-strudel-af7a88) er med, saa chatten
    // ogsaa virker der. Den danske bot har ingen liste og svarer '*' som foer.
    origins: ['https://www.unserzuhauseapp.de', 'https://unserzuhauseapp.de', 'https://backend.unserzuhauseapp.de',
      'https://unserzuhause-download.netlify.app', /^https:\/\/([a-z0-9-]+--)?verdant-strudel-af7a88\.netlify\.app$/],
    tagline: 'Weniger Chaos. Mehr Überblick.',
    store: {
      appstore: 'https://apps.apple.com/de/app/unser-zuhause/id6771931999',
      // hl=de&gl=DE sikrer tysk sprog og tysk butik, uanset hvor den der klikker sidder.
      // referrer beholdes, så vi stadig kan se at installationen kom fra chatten.
      googleplay: 'https://play.google.com/store/apps/details?id=com.unserzuhause.app&hl=de&gl=DE&referrer=utm_source%3Dchatbot',
      website: 'https://www.unserzuhauseapp.de',
      hentside: 'https://unserzuhause-download.netlify.app/',
    },
    humanRe: /(mit|einen?).{0,15}(mensch|person|mitarbeiter|team|kundenservice|support)|echte[rn]? (mensch|person)|jemanden? sprechen|persönlich sprechen|anrufen|rückruf/i,
    angryRe: /(scheiß|scheiss|mist|verdammt|furchtbar|schrecklich|katastrophal|beschwer|unzufrieden|ärgerlich|frustrier|genervt|abzocke|betrug|geldverschwendung|schlechteste)/i,
    summaryPrompt: 'Fasse das Problem oder den Wunsch der Person in EINER kurzen deutschen Zeile zusammen (max. 15 Wörter). Antworte NUR mit der Zeile, sonst nichts.',
    txt: {
      handover: 'Natürlich, ich hole jemanden aus dem Team dazu. Schreib deine Frage gern hier hinein, wir melden uns schnellstmöglich. Ist es dringend, schreib an support@unserzuhauseapp.de.',
      limitHuman: 'Deine Nachricht ist notiert, wir melden uns schnellstmöglich.',
      limitBot: 'Wir haben hier schon einiges beantwortet. Brauchst du weitere Hilfe, schreib an support@unserzuhauseapp.de, dann übernimmt jemand aus dem Team.',
      error: 'Entschuldige, da ist etwas schiefgegangen. Schreib gern an support@unserzuhauseapp.de, wir melden uns.',
      empty: 'Entschuldige, das habe ich nicht ganz verstanden. Versuch es noch einmal oder schreib an support@unserzuhauseapp.de.',
    },
    mail: {
      subject: 'Neue Anfrage im Chat braucht dich',
      badge: 'Unser Zuhause Support',
      head: 'Jemand braucht dich',
      intro: 'Im Chat auf unserzuhauseapp.de ist eine neue Anfrage eingegangen.',
      lead: 'Eine Besucherin oder ein Besucher möchte mit einem Menschen sprechen. Unten siehst du die Angaben und kannst das Gespräch öffnen.',
      lblSummary: 'Zusammenfassung', lblCustomer: 'Kunde', lblLast: 'Letzte Nachricht',
      cta: 'Chat öffnen und antworten →',
      fallback: 'Funktioniert der Knopf nicht? Kopiere diesen Link in deinen Browser:',
      plain: 'Jemand auf unserzuhauseapp.de braucht einen Menschen.',
    },
  },
};
// Med et fast marked (brug()) kendes kun det: alt, hvad widgeten eller panelet sender som site, bliver det faste.
function cleanSite(s) { if (FAST_SITE) return FAST_SITE; return SITES[String(s || '').toLowerCase()] ? String(s).toLowerCase() : 'dk'; }
function cfg(s) { return SITES[cleanSite(s)]; }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};
const json = (statusCode, obj) => ({ statusCode, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(obj) });
// Med et fast marked, der har en liste (SITES.de.origins), faar kun de sider Access-Control-Allow-Origin.
// Alle andre faar ingen, saa en fremmed side ikke kan bruge botten fra besoegendes browsere. Uden liste: '*' som foer.
function medCors(svar, event) {
  const liste = FAST_SITE ? cfg(FAST_SITE).origins : null;
  if (!liste || !svar) return svar;
  const h = (event && event.headers) || {};
  const origin = String(h.origin || h.Origin || '');
  const headers = { ...(svar.headers || {}), Vary: 'Origin' };
  delete headers['Access-Control-Allow-Origin'];
  if (origin && liste.some(o => typeof o === 'string' ? o === origin : o.test(origin))) headers['Access-Control-Allow-Origin'] = origin;
  return { ...svar, headers };
}
function klientIp(event) {
  const h = (event && event.headers) || {};
  return String(h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim();
}

function nowISO() { return new Date().toISOString(); }
function cleanId(s) { return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60); }

// ---------- SPAM-/OMKOSTNINGSBESKYTTELSE ----------
// Grænse pr. samtale (tælles på widgetens historik). Hårdt loft = forudbetalte Anthropic-credits.
const CONVO_MAX = 60;
// Grænse pr. adresse: samtale-id og historik kommer fra klienten, saa et script kan skifte id ved hver besked.
// Derfor ogsaa et loft pr. IP pr. time, talt i databasen. Adressen gemmes som saltet hash (HMAC med SESSION_SECRET,
// ellers ADMIN_PASSWORD, saa den ikke kan regnes tilbage ved at proeve alle IPv4-adresser) og slettes senest
// efter et doegn: her ved nye beskeder, og hver nat af backendens oprydning (backend/netlify/handlers/ryd.js).
const IP_MAX_TIME = 30;
let _ipTabel = false, _ipRyddet = 0;
async function ipOverLoft(ip) {
  if (!ip) return false;
  if (!_ipTabel) {
    await sql`CREATE TABLE IF NOT EXISTS vh_bot_ip (ip TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS vh_bot_ip_idx ON vh_bot_ip (ip, ts)`;
    _ipTabel = true;
  }
  const h = crypto.createHmac('sha256', process.env.SESSION_SECRET || ADMIN_PASSWORD || 'vh').update('botip|' + ip).digest('hex').slice(0, 32);
  const r = await sql`SELECT count(*)::int AS n FROM vh_bot_ip WHERE ip = ${h} AND ts > now() - interval '1 hour'`;
  if (r[0].n >= IP_MAX_TIME) return true;
  await sql`INSERT INTO vh_bot_ip (ip) VALUES (${h})`;
  // gamle raekker ryddes hoejst hvert 10. minut pr. instans
  if (Date.now() - _ipRyddet > 600000) {
    _ipRyddet = Date.now();
    try { await sql`DELETE FROM vh_bot_ip WHERE ts < now() - interval '1 hour'`; } catch (e) {}
  }
  return false;
}

// Spaerring af admin-koden, som panelets login (backend/netlify/lib/auth.js): 6 forkerte koder fra samme
// adresse inden for et kvarter, saa svarer alle admin_*-handlinger 429, foer koden overhovedet tjekkes.
// Samme tabel som panelet (vh_login), saa forkerte forsoeg i panelet og her taeller sammen.
let _loginTabel = false;
async function loginTabel() {
  if (_loginTabel) return;
  await sql`CREATE TABLE IF NOT EXISTS vh_login (id SERIAL PRIMARY KEY, ip TEXT NOT NULL,
    ok BOOLEAN NOT NULL, hvornaar TIMESTAMPTZ NOT NULL DEFAULT now())`;
  _loginTabel = true;
}
async function forMangeForsoeg(ip) {
  await loginTabel();
  const r = await sql`SELECT count(*)::int AS n FROM vh_login
    WHERE ip = ${ip} AND NOT ok AND hvornaar > now() - interval '15 minutes'`;
  return r[0].n >= 6;
}
async function forkertKode(ip) {
  try { await loginTabel();
        await sql`INSERT INTO vh_login (ip, ok) VALUES (${ip}, false)`;
        await sql`DELETE FROM vh_login WHERE hvornaar < now() - interval '1 day'`; } catch (e) {}
}

// ---------- LAGER (Neon / Postgres) ----------
let _schemaReady = false;
async function ensureSchema() {
  if (_schemaReady || !sql) return;
  await sql`CREATE TABLE IF NOT EXISTS vh_conversations (
    id TEXT PRIMARY KEY, email TEXT DEFAULT '', human BOOLEAN DEFAULT false,
    needs_human BOOLEAN DEFAULT false, alerted BOOLEAN DEFAULT false, n INT DEFAULT 0,
    seen BOOLEAN DEFAULT true, first_q TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`;
  await sql`ALTER TABLE vh_conversations ADD COLUMN IF NOT EXISTS seen BOOLEAN DEFAULT true`;
  await sql`ALTER TABLE vh_conversations ADD COLUMN IF NOT EXISTS mood TEXT DEFAULT ''`;
  await sql`ALTER TABLE vh_conversations ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false`;
  // To markeder i samme base. Alt der fandtes før kolonnen kom, er dansk.
  await sql`ALTER TABLE vh_conversations ADD COLUMN IF NOT EXISTS site TEXT DEFAULT 'dk'`;
  await sql`UPDATE vh_conversations SET site = 'dk' WHERE site IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS vh_conversations_site_idx ON vh_conversations (site, archived, updated_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS vh_events (
    id BIGSERIAL PRIMARY KEY, kind TEXT, label TEXT, ts TIMESTAMPTZ DEFAULT now())`;
  await sql`ALTER TABLE vh_events ADD COLUMN IF NOT EXISTS site TEXT DEFAULT 'dk'`;
  await sql`UPDATE vh_events SET site = 'dk' WHERE site IS NULL`;
  await sql`CREATE TABLE IF NOT EXISTS vh_messages (
    id BIGSERIAL PRIMARY KEY, conv_id TEXT, role TEXT, content TEXT, ts TIMESTAMPTZ DEFAULT now())`;
  await sql`CREATE INDEX IF NOT EXISTS vh_messages_conv_idx ON vh_messages (conv_id, id)`;
  // Tosproget support: content er altid det kunden ser (tysk på det tyske marked),
  // da er altid den danske udgave, så Nicko kan læse og skrive på dansk.
  await sql`ALTER TABLE vh_messages ADD COLUMN IF NOT EXISTS da TEXT DEFAULT ''`;
  await sql`CREATE TABLE IF NOT EXISTS vh_feedback (
    id BIGSERIAL PRIMARY KEY, value INT, question TEXT DEFAULT '', answer TEXT DEFAULT '', ts TIMESTAMPTZ DEFAULT now())`;
  await sql`ALTER TABLE vh_feedback ADD COLUMN IF NOT EXISTS site TEXT DEFAULT 'dk'`;
  await sql`UPDATE vh_feedback SET site = 'dk' WHERE site IS NULL`;
  _schemaReady = true;
}
// Kun med brug() (den tyske backend, hvis database starter tom): mangler bottens tabeller, oprettes de med
// ensureSchema. Findes de, sker intet, saa ALTER TABLE aldrig koerer af sig selv (se VIGTIGT ved handleren).
// En forespoergsel pr. kold start. Nye kolonner kommer stadig kun med admin_migrate (POST med koden).
let _tabellerTjekket = false;
async function tabellerKlar() {
  if (!FAST_SITE || _tabellerTjekket || _schemaReady || !sql) return;
  const r = await sql`SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name IN ('vh_conversations', 'vh_messages', 'vh_feedback', 'vh_events')`;
  if (r[0].n < 4) await ensureSchema();
  _tabellerTjekket = true;
}

function rowToMeta(r) {
  return { id: r.id, email: r.email, human: r.human, needsHuman: r.needs_human, alerted: r.alerted, n: r.n, seen: r.seen, mood: r.mood || '', archived: !!r.archived, site: r.site || 'dk', firstQ: r.first_q, createdAt: r.created_at, updatedAt: r.updated_at };
}
async function loadMeta(id) {
  const rows = await sql`SELECT * FROM vh_conversations WHERE id = ${id}`;
  return rows.length ? rowToMeta(rows[0]) : null;
}
async function saveMeta(id, meta) {
  // site sættes ved oprettelsen og røres aldrig igen — en samtale skifter ikke marked
  await sql`INSERT INTO vh_conversations (id, email, human, needs_human, alerted, n, seen, mood, archived, site, first_q, updated_at)
    VALUES (${id}, ${meta.email || ''}, ${!!meta.human}, ${!!meta.needsHuman}, ${!!meta.alerted}, ${meta.n || 0}, ${meta.seen === undefined ? true : !!meta.seen}, ${meta.mood || ''}, ${!!meta.archived}, ${cleanSite(meta.site)}, ${meta.firstQ || ''}, now())
    ON CONFLICT (id) DO UPDATE SET
      email = COALESCE(NULLIF(EXCLUDED.email, ''), vh_conversations.email),
      human = EXCLUDED.human, needs_human = EXCLUDED.needs_human,
      alerted = EXCLUDED.alerted, n = EXCLUDED.n, seen = EXCLUDED.seen,
      mood = EXCLUDED.mood, archived = EXCLUDED.archived, updated_at = now()`;
}
async function addMessage(id, role, content, da) {
  await sql`INSERT INTO vh_messages (conv_id, role, content, da) VALUES (${id}, ${role}, ${content}, ${da || ''})`;
}
async function getMessages(id) {
  const rows = await sql`SELECT id, role, content, da, ts FROM vh_messages WHERE conv_id = ${id} ORDER BY id`;
  return rows.map(r => ({ id: Number(r.id), role: r.role, content: r.content, da: r.da || '', ts: r.ts }));
}
async function readConversation(id) { return getMessages(id); }
// Indeks var en Blobs-nødløsning; Postgres henter selv pålideligt → no-op
async function updateIndex() {}
async function removeFromIndex() {}

// ---------- HJÆLP ----------
function wantsHuman(text, site) { return cfg(site).humanRe.test(text || ''); }

let _tx = null;
function transporter() {
  if (_tx) return _tx;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  _tx = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  return _tx;
}
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function alertEmailHTML(email, msg, url, resume, site) {
  const S = cfg(site), T = S.mail;
  const e = escHtml(email || (S.lang === 'de' ? 'unbekannt' : 'ukendt'));
  const m = escHtml(msg || (S.lang === 'de' ? '(keine Nachricht)' : '(ingen besked)'));
  const u = escHtml(url);
  const resumeBlock = resume ? `<p style="margin:0 0 8px;color:#8b86a5;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;">${escHtml(T.lblSummary)}</p>
<p style="margin:0 0 22px;color:#1B1633;font-size:15px;line-height:1.55;">${escHtml(resume)}</p>` : '';
  return `<!doctype html>
<html lang="${S.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(T.subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f2fb;font-family:'Plus Jakarta Sans',Arial,Helvetica,sans-serif;color:#1B1633;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f2fb;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 12px 40px rgba(108,71,255,0.14);">
<tr><td bgcolor="#6C47FF" style="padding:34px 40px;background:linear-gradient(135deg,#6C47FF 0%,#4F7BFF 55%,#FF6FB5 100%);">
<div style="display:inline-block;padding:8px 13px;margin-bottom:18px;background-color:#ffffff;border-radius:999px;color:#6C47FF;font-size:12px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;">${escHtml(T.badge)}</div>
<h1 style="margin:0;color:#ffffff;font-size:30px;line-height:1.2;font-weight:800;letter-spacing:-0.7px;">${escHtml(T.head)}</h1>
<p style="margin:12px 0 0;color:rgba(255,255,255,0.9);font-size:16px;line-height:1.6;">${escHtml(T.intro)}</p>
</td></tr>
<tr><td style="padding:38px 40px 20px;">
<p style="margin:0 0 24px;color:#4a4560;font-size:16px;line-height:1.7;">${escHtml(T.lead)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f6f5fb;border:1px solid #e7e4f2;border-radius:16px;">
<tr><td style="padding:24px;">
${resumeBlock}
<p style="margin:0 0 8px;color:#8b86a5;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;">${escHtml(T.lblCustomer)}</p>
<p style="margin:0 0 22px;font-size:16px;line-height:1.5;"><a href="mailto:${e}" style="color:#6C47FF;font-weight:700;text-decoration:none;">${e}</a></p>
<p style="margin:0 0 8px;color:#8b86a5;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;">${escHtml(T.lblLast)}</p>
<p style="margin:0;color:#1B1633;font-size:18px;line-height:1.55;font-weight:600;">&ldquo;${m}&rdquo;</p>
</td></tr></table>
</td></tr>
<tr><td style="padding:12px 40px 40px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#6C47FF" style="border-radius:12px;">
<a href="${u}" target="_blank" style="display:inline-block;padding:16px 26px;color:#ffffff;font-size:16px;line-height:1;font-weight:700;text-decoration:none;border-radius:12px;">${escHtml(T.cta)}</a>
</td></tr></table>
<p style="margin:22px 0 0;color:#8b86a5;font-size:13px;line-height:1.6;">${escHtml(T.fallback)}</p>
<p style="margin:5px 0 0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${u}" style="color:#6C47FF;text-decoration:underline;">${u}</a></p>
</td></tr>
<tr><td style="padding:24px 40px;background-color:#1B1633;text-align:center;">
<p style="margin:0;color:#ffffff;font-size:15px;font-weight:700;">${escHtml(S.label)}</p>
<p style="margin:7px 0 0;color:#b7afd8;font-size:12px;line-height:1.6;">${escHtml(S.tagline)}</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendAlert(meta, lastText, resume, site) {
  const tx = transporter();
  if (!tx) { console.log('ALARM sprunget over — SMTP ikke konfigureret'); return; }
  const S = cfg(site), T = S.mail;
  // ?site= i linket åbner admin direkte på det rigtige marked
  // inde i en backend (brug()) er det backendens panel
  const url = PANEL_URL || (SITE_URL + '/admin.html?site=' + cleanSite(site));
  try {
    await tx.sendMail({
      from: ALERT_FROM, to: ALERT_TO,
      subject: '[' + S.label + '] ' + T.subject,
      text: [T.plain, '', resume ? T.lblSummary + ': ' + resume : '', T.lblCustomer + ': ' + (meta.email || '?'), T.lblLast + ': ' + (lastText || '?'), '', T.cta.replace(/\s*→$/, '') + ': ' + url].filter(Boolean).join('\n'),
      html: alertEmailHTML(meta.email, lastText, url, resume, site),
    });
    console.log('ALARM sendt til', ALERT_TO, '(' + S.label + ')');
  } catch (e) { console.log('ALARM-FEJL', String(e && e.message || e)); }
}

// Modellen glemmer af og til tegnsætningsreglen. Prompten beder om det, men her
// bliver det garanteret: ingen tankestreger når nogensinde ud til en kunde.
function udenTankestreg(t) {
  return String(t || '')
    .replace(/(.)\s*[—–]\s*(.)/g, function (m, f, e) {
      // står der allerede tegnsætning på den ene side, skal der ikke et komma til
      if (',;:'.indexOf(f) >= 0 || '.,;:!?)'.indexOf(e) >= 0) return f + ' ' + e;
      return f + ', ' + e;
    })
    .replace(/[—–]/g, ',')     // står stregen først eller sidst i en linje
    .replace(/ +([,.;:])/g, '$1')
    .replace(/,\s*,/g, ',');
}

function buildClaudeMessages(list) {
  const msgs = [];
  for (const m of list) {
    const role = m.role === 'user' ? 'user' : 'assistant';
    const content = (m.content || '').trim();
    if (!content) continue;
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n' + content;
    else msgs.push({ role, content });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs.slice(-20);
}
async function callClaude(list, site) {
  const S = cfg(site);
  const messages = buildClaudeMessages(list);
  if (!messages.length) return { reply: '', escalate: false };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 350, system: S.prompt, messages }),
  });
  const data = await res.json();
  if (!res.ok) { console.log('CLAUDE-FEJL', JSON.stringify(data).slice(0, 300)); return { reply: S.txt.error, escalate: true }; }
  let reply = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  const escalate = /\[\[ESKALER\]\]/i.test(reply);
  const angry = /\[\[VRED\]\]/i.test(reply);
  reply = udenTankestreg(reply.replace(/\[\[ESKALER\]\]/ig, '').replace(/\[\[VRED\]\]/ig, '').trim());
  return { reply: reply || S.txt.empty, escalate, angry };
}

// ---------- OVERSÆTTELSE MELLEM DANSK OG MARKEDETS SPROG ----------
// Nicko skriver dansk, den tyske kunde ser tysk. Kunden skriver tysk, Nicko
// læser dansk. Slår oversættelsen fejl, returneres tom streng, og kalderen
// beholder originalen: hellere en besked på det forkerte sprog end ingen.
const OVERSAET_PROMPT = {
  da: 'Oversæt brugerens tekst til dansk. Er den allerede på dansk, så returnér den uændret. Bevar linjeskift og **fed**-markering. Oversæt kun, svar aldrig på indholdet. Svar KUN med oversættelsen, uden forklaring og uden anførselstegn omkring.',
  de: 'Übersetze den Text des Nutzers ins Deutsche. Ist er bereits auf Deutsch, gib ihn unverändert zurück. Sprich die Person mit „du" an, niemals mit „Sie". Behalte Zeilenumbrüche und **fett**-Markierung bei. Verwende niemals einen Gedankenstrich. Übersetze nur, antworte niemals auf den Inhalt. Antworte NUR mit der Übersetzung, ohne Erklärung und ohne Anführungszeichen drumherum.',
};
async function oversaet(tekst, tilSprog) {
  const t = String(tekst || '').trim();
  const system = OVERSAET_PROMPT[tilSprog];
  if (!t || !system || !ANTHROPIC_API_KEY) return '';
  try {
    const kald = fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system, messages: [{ role: 'user', content: t }] }),
    }).then(r => r.json()).then(d => ((d.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim()) || '');
    // Hænger API'et, må supporten ikke stå stille
    const ud = await Promise.race([kald, new Promise(r => setTimeout(() => r(''), 12000))]);
    return ud ? udenTankestreg(ud) : '';
  } catch (e) { console.log('OVERSAET-FEJL', String(e && e.message || e)); return ''; }
}

// Hurtig tekst-baseret frustrations-detektion (supplement til Claudes [[VRED]]-markør)
function seemsAngry(text, site) { return cfg(site).angryRe.test(text || ''); }

// Én-linjes AI-resumé af kundens problem til alarm-mailen (maks ~3,5 sek, ellers droppes det)
async function summarizeIssue(list, site) {
  try {
    const messages = buildClaudeMessages(list);
    if (!messages.length) return '';
    const call = fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 60, system: cfg(site).summaryPrompt, messages }),
    }).then(r => r.json()).then(d => ((d.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim()) || '');
    const timeout = new Promise(res => setTimeout(() => res(''), 3500));
    return await Promise.race([call, timeout]);
  } catch (e) { return ''; }
}

// ---------- PERIODER TIL STATISTIKKEN (dansk kalendertid) ----------
// Serveren kører i UTC. En dag i statistikken er en dansk kalenderdag fra
// midnat til midnat, aldrig "minus 24 timer", så sommertid ikke flytter noget.
const TZ = 'Europe/Copenhagen';
const MARKED_NAVN = { dk: 'Dansk', de: 'Tysk', alle: 'Dansk og tysk' };
function dkIdag() {
  const d = {};
  new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).forEach(x => { d[x.type] = x.value; });
  return d.year + '-' + d.month + '-' + d.day;
}
// 'ÅÅÅÅ-MM-DD' der findes i kalenderen, ellers null (2026-02-30 afvises)
function gyldigDato(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === m[0] ? m[0] : null;
}
// Kalenderregning på selve datoen, uden klokkeslæt
function plusDage(s, n) { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d)); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function dageMellem(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function datoTekst(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('da-DK', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }); }
// Oprydningen i voreshjem-admin (ryd.js, samme database) sletter hver nat samtaler RYD_DAGE efter sidste
// besked og tommel RYD_DAGE efter de blev givet. Hændelser (klik, hurtig-svar, sidebesøg) slettes aldrig.
// Samtale- og tommeltal dækker derfor kun de seneste RYD_DAGE dage, i dag med.
const RYD_DAGE = Math.max(7, parseInt(process.env.RYD_DAGE, 10) || 90);
// fra/til (begge, danske datoer, begge dage med) vinder over days. days = de
// seneste N kalenderdage til og med i dag, så days=1 er i dag fra midnat.
// En slutdato efter i dag skæres til i dag (afkortet), så fremtiden ikke ser ud som nuller.
function statPeriode(body) {
  const idag = dkIdag();
  const harFra = body.fra != null && body.fra !== '', harTil = body.til != null && body.til !== '';
  if (harFra || harTil) {
    const fra = gyldigDato(body.fra), tilOenske = gyldigDato(body.til);
    if (!fra || !tilOenske) return { fejl: 'fra og til skal begge være datoer som ÅÅÅÅ-MM-DD' };
    if (tilOenske < fra) return { fejl: 'til ligger før fra' };
    if (fra > idag) return { fejl: 'perioden starter efter i dag' };
    const til = tilOenske > idag ? idag : tilOenske;
    const dage = dageMellem(fra, til) + 1;
    if (dage > 731) return { fejl: 'perioden må højst være to år' };
    return { fra, til, dage, idag, afkortet: til !== tilOenske };
  }
  const dage = Math.max(1, Math.min(366, parseInt(body.days, 10) || 14));
  return { fra: plusDage(idag, -(dage - 1)), til: idag, dage, idag, afkortet: false };
}

function requireAdmin(body) { return ADMIN_PASSWORD && body.password === ADMIN_PASSWORD; }

// VIGTIGT: ensureSchema køres ALDRIG automatisk — ALTER TABLE låser tabellerne og gav 15-30s
// udfald når nye funktions-instanser startede. Kør den manuelt efter skema-ændringer med POST
// {"action":"admin_migrate","password":"<ADMIN_PASSWORD>"} (kræver koden og er bag spærringen).
let _lastArchiveSweep = 0;

exports.handler = async (event) => medCors(await behandl(event), event);

async function behandl(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  // ?migrate=1 og ?diag=1 virker ikke laengere uden kode. De er nu admin_migrate og admin_diag (POST med koden).
  if (event.httpMethod === 'GET' && event.queryStringParameters && event.queryStringParameters.migrate) {
    return json(405, { migrated: false, error: 'brug POST med action admin_migrate og admin-koden' });
  }
  if (event.httpMethod === 'GET') {
    // Klik-tæller: /hent/appstore + /hent/googleplay → tæl og viderestil til butikken
    let go = event.queryStringParameters && event.queryStringParameters.go;
    // Bindestreg SKAL med i mønstret. Netlify fører ikke altid go=:splat videre som
    // query, og uden bindestregen blev /hent/appstore-de klippet til appstore,
    // så tyskere endte i den danske App Store.
    if (!go && event.path) { const m = String(event.path).match(/\/hent\/([a-z-]+)/i); if (m) go = m[1]; }
    if (go) {
      // Marked kan komme som ?site=de ELLER bagpå navnet (/hent/appstore-de), fordi
      // Netlifys splat-redirect ikke altid fører query-parametre med sig.
      let key = String(go).toLowerCase();
      let gSite = (event.queryStringParameters && event.queryStringParameters.site) || '';
      const suffix = key.match(/^(.+)-([a-z]{2})$/);
      if (suffix && SITES[suffix[2]]) { key = suffix[1]; gSite = suffix[2]; }
      gSite = cleanSite(gSite);
      // 'app' vælger butik ud fra enheden. Det lader en knap være et helt
      // almindeligt link i stedet for javascript, som browsere blokerer som
      // popup inde i en iframe. Uden JS er der ikke noget at blokere.
      let target;
      if (key === 'app') {
        const ua = String((event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || '');
        // Computer sendte foer alle, ogsaa Windows, til Apples App Store, hvor der
        // intet er at hente. Nu vises begge butikker paa hentsiden i stedet.
        if (/Android/i.test(ua))               target = cfg(gSite).store.googleplay;
        else if (/iPhone|iPad|iPod/i.test(ua)) target = cfg(gSite).store.appstore;
        else                                   target = cfg(gSite).store.hentside;
      } else {
        target = cfg(gSite).store[key];
      }
      if (target) {
        // src-parameter skelner hvor klikket kom fra (chat = uden src, download-siden = ?src=download)
        const src = String((event.queryStringParameters && event.queryStringParameters.src) || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 30);
        // 'app' skrives med den butik, enheden blev sendt til, saa tallene kan fordeles rigtigt
        const hvor = key === 'app' ? (target === cfg(gSite).store.googleplay ? 'app>googleplay' : target === cfg(gSite).store.appstore ? 'app>appstore' : 'app>hentside') : key;
        const label = hvor + (src ? ':' + src : '');
        // robotter og link-forhaandsvisninger foelger ogsaa links. De skal ikke taelles som klik.
        const ua2 = String((event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || '');
        const robot = !ua2 || /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|curl|wget|python|node|axios|go-http|java\/|headless|lighthouse|google-inspectiontool|apis-google|mediapartners|feedfetcher|monitor|uptime|netlify/i.test(ua2);
        if (sql && !robot) { try { await tabellerKlar(); await sql`INSERT INTO vh_events (kind, label, site) VALUES ('store', ${label}, ${gSite})`; } catch (e) {} }
        return { statusCode: 302, headers: { Location: target, ...CORS }, body: '' };
      }
    }
    return json(200, { ok: true, service: FAST_SITE ? cfg(FAST_SITE).label + ' chat' : 'voreshjem chat', configured: { anthropic: !!ANTHROPIC_API_KEY, admin: !!ADMIN_PASSWORD, smtp: !!(SMTP_HOST && SMTP_USER), database: !!sql } });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const action = body.action || 'send';
  if (!sql) return json(500, { error: 'database ikke konfigureret (DATABASE_URL mangler)' });

  try {
    await tabellerKlar();
    // ---------- BESØGENDE (widget) ----------
    if (action === 'send') {
      if (!ANTHROPIC_API_KEY) return json(500, { error: 'server mangler nøgle' });
      const id = cleanId(body.conversationId);
      const content = (typeof body.content === 'string' ? body.content : '').trim();
      if (!id || !content) return json(400, { error: 'mangler id/besked' });

      // Historik kommer FRA widgeten (undgår "læs lige efter skriv"-forsinkelse i Blobs)
      const prior = Array.isArray(body.history) ? body.history
        .filter(m => m && typeof m.content === 'string' && ['user', 'assistant', 'agent'].includes(m.role))
        .map(m => ({ role: m.role, content: m.content })).slice(-30) : [];

      let meta = await loadMeta(id);
      if (!meta) meta = { id, site: cleanSite(body.site), email: (body.email || '').slice(0, 120), createdAt: nowISO(), human: false, needsHuman: false, alerted: false, firstQ: content.slice(0, 120), n: 0 };
      // Findes samtalen, gælder dens eget marked — widgeten kan ikke flytte den
      const site = cleanSite(meta.site || body.site);
      const S = cfg(site);
      meta.site = site;
      meta.seen = false; // kunden har skrevet → markér ulæst indtil du åbner samtalen
      meta.archived = false; // skriver kunden igen, kommer samtalen tilbage fra arkivet
      if (seemsAngry(content, site)) meta.mood = 'vred';

      // Spam-/omkostningsbeskyttelse: grænse pr. samtale. Tælles på widgetens historik (pålideligt,
      // ingen Blobs-forsinkelse) med meta.n som backup. Undgår løbske loops / flooding.
      meta.n = (meta.n || 0) + 1;
      if (prior.length >= CONVO_MAX || meta.n > CONVO_MAX + 2) {
        await saveMeta(id, meta);
        const limitMsg = meta.human ? S.txt.limitHuman : S.txt.limitBot;
        return json(200, { messages: prior.concat([{ role: 'user', content }, { role: 'assistant', content: limitMsg }]), human: !!meta.human, limited: true });
      }

      // Loft pr. IP (IP_MAX_TIME pr. time). Svaret er limitBot, uden kald til Claude og uden at gemme noget,
      // saa et script med nye samtale-id'er hverken bruger credits eller fylder indbakken. Har teamet
      // overtaget samtalen, koster den ingen credits, og kunden skal kunne blive ved med at skrive.
      if (!meta.human && await ipOverLoft(klientIp(event))) {
        return json(200, { messages: prior.concat([{ role: 'user', content }, { role: 'assistant', content: S.txt.limitBot }]), human: false, limited: true });
      }

      meta.updatedAt = nowISO();
      meta.lastRole = 'user'; meta.lastText = content.slice(0, 80);

      // Gem brugerens besked i baggrunden — mens Claude tænker (afventes til sidst)
      const userMsgP = addMessage(id, 'user', content);

      const convo = prior.concat([{ role: 'user', content }]);

      // Menneske har overtaget → bot tier
      if (meta.human) {
        const transcript = convo.slice(-40);
        meta.recent = transcript;
        if (!meta.alerted) { await sendAlert(meta, content, await summarizeIssue(convo, site), site); meta.alerted = true; }
        await Promise.all([userMsgP, saveMeta(id, meta)]);
        return json(200, { messages: transcript, human: true });
      }

      // Brugeren beder direkte om et menneske → eskalér
      if (wantsHuman(content, site)) {
        const canned = S.txt.handover;
        const transcript = convo.concat([{ role: 'assistant', content: canned }]).slice(-40);
        meta.recent = transcript;
        meta.needsHuman = true; meta.lastRole = 'assistant'; meta.lastText = canned.slice(0, 80);
        if (!meta.alerted) { await sendAlert(meta, content, await summarizeIssue(convo, site), site); meta.alerted = true; }
        await userMsgP; // bruger-besked SKAL være gemt før bot-svaret (rækkefølge i historikken)
        await Promise.all([addMessage(id, 'assistant', canned), saveMeta(id, meta)]);
        return json(200, { messages: transcript, human: false });
      }

      // Bot svarer (bruger-beskeden gemmes imens)
      const { reply, escalate, angry } = await callClaude(convo, site);
      if (angry) meta.mood = 'vred';
      const transcript = convo.concat([{ role: 'assistant', content: reply }]).slice(-40);
      meta.recent = transcript;
      meta.lastRole = 'assistant'; meta.lastText = reply.slice(0, 80);
      if (escalate) { meta.needsHuman = true; if (!meta.alerted) { await sendAlert(meta, content, await summarizeIssue(convo, site), site); meta.alerted = true; } }
      await userMsgP; // bruger-besked SKAL være gemt før bot-svaret (rækkefølge i historikken)
      await Promise.all([addMessage(id, 'assistant', reply), saveMeta(id, meta)]);
      return json(200, { messages: transcript, human: false });
    }

    // Bruger giver email undervejs (chatten er fri — email er valgfri)
    if (action === 'set_email') {
      const id = cleanId(body.conversationId);
      const em = (typeof body.email === 'string' ? body.email : '').trim().slice(0, 120);
      if (!id || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return json(400, { error: 'ugyldig email' });
      await sql`UPDATE vh_conversations SET email = ${em}, updated_at = now() WHERE id = ${id}`;
      return json(200, { ok: true });
    }

    if (action === 'poll') {
      const id = cleanId(body.conversationId);
      if (!id) return json(400, { error: 'mangler id' });
      const [meta, messages] = await Promise.all([loadMeta(id), getMessages(id)]);
      const have = parseInt(body.have, 10);
      if (Number.isFinite(have) && have === messages.length) {
        return json(200, { unchanged: true, count: messages.length, human: !!(meta && meta.human), needsHuman: !!(meta && meta.needsHuman) });
      }
      // kunden faar kun det, kunden ser. da er teamets danske udgave (tysk marked) og hoerer kun til panelet.
      const tilKunde = messages.map(m => ({ id: m.id, role: m.role, content: m.content, ts: m.ts }));
      return json(200, { messages: tilKunde, human: !!(meta && meta.human), needsHuman: !!(meta && meta.needsHuman), count: messages.length });
    }

    // Tommel op/ned på et bot-svar
    if (action === 'feedback') {
      const value = body.value === 1 ? 1 : (body.value === -1 ? -1 : 0);
      if (!value) return json(400, { error: 'ugyldig værdi' });
      try {
        await sql`INSERT INTO vh_feedback (value, question, answer, site) VALUES (${value}, ${String(body.question || '').slice(0, 300)}, ${String(body.answer || '').slice(0, 500)}, ${cleanSite(body.site)})`;
      } catch (e) { console.log('FEEDBACK-FEJL', String(e && e.message || e)); }
      return json(200, { ok: true });
    }

    // Klik-/besøgs-statistik fra widget og download-side (chip = hurtig-svar, page = sidebesøg)
    if (action === 'track') {
      const kind = ['chip', 'page'].includes(body.kind) ? body.kind : '';
      const label = String(body.label || '').slice(0, 80);
      if (!kind || !label) return json(400, { error: 'ugyldig' });
      try { await sql`INSERT INTO vh_events (kind, label, site) VALUES (${kind}, ${label}, ${cleanSite(body.site)})`; } catch (e) {}
      return json(200, { ok: true });
    }

    // ---------- ADMIN ----------
    if (!action.startsWith('admin_')) return json(400, { error: 'ukendt action' });
    // Spaerringen tjekkes foer koden (se forMangeForsoeg), ogsaa for admin_login
    const ip = klientIp(event);
    if (await forMangeForsoeg(ip)) return json(429, { error: 'for mange forsøg', message: 'For mange forkerte forsøg. Vent et kvarter.' });
    if (!requireAdmin(body)) {
      await forkertKode(ip);
      return action === 'admin_login' ? json(200, { ok: false }) : json(401, { error: 'forkert adgangskode' });
    }
    if (action === 'admin_login') return json(200, { ok: true });

    // Skema-opdatering efter nye kolonner (koeres aldrig af sig selv, se VIGTIGT ved handleren)
    if (action === 'admin_migrate') {
      try { await ensureSchema(); return json(200, { migrated: true }); } catch (e) { return json(200, { migrated: false, error: String(e && e.message || e).slice(0, 150) }); }
    }

    if (action === 'admin_diag') {
      try {
        const r = await sql`SELECT count(*)::int AS n FROM vh_conversations`;
        const ev = await sql`SELECT count(*)::int AS n FROM vh_events`;
        return json(200, { diag: { conversations: r[0].n, events: ev[0].n } });
      }
      catch (e) { return json(200, { diag: { error: String(e && e.message || e).slice(0, 120) } }); }
    }

    if (action === 'admin_list') {
      const site = cleanSite(body.site);
      const showArchived = !!body.archived;
      // Auto-arkivér: læste samtaler uden aktivitet i 14 dage. Kør højst hvert 10. minut (ikke ved hver polling).
      // Arkivet er kun indbakkens tilstand. admin_stats tæller arkiverede med, og det skal statistik altid gøre.
      if (Date.now() - _lastArchiveSweep > 600000) {
        _lastArchiveSweep = Date.now();
        sql`UPDATE vh_conversations SET archived = true WHERE archived = false AND needs_human = false AND seen = true AND updated_at < now() - interval '14 days'`.catch(() => {});
      }
      const rows = await sql`
        SELECT c.id, c.email, c.human, c.needs_human, c.seen, c.mood, c.updated_at,
          (SELECT role FROM vh_messages m WHERE m.conv_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_role,
          (SELECT coalesce(nullif(m.da, ''), m.content) FROM vh_messages m WHERE m.conv_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_content
        FROM vh_conversations c WHERE c.archived = ${showArchived} AND coalesce(c.site, 'dk') = ${site}
        ORDER BY c.updated_at DESC LIMIT 500`;
      const conversations = rows.map(r => ({
        id: r.id, email: r.email || '', human: r.human, needsHuman: r.needs_human, unread: !r.seen, mood: r.mood || '', updatedAt: r.updated_at,
        last: r.last_content ? { role: r.last_role, content: String(r.last_content).slice(0, 80) } : null,
      }));
      // Tæl ulæste på BEGGE markeder, så man ser en prik på den side man ikke kigger på
      const badges = {};
      try {
        const b = await sql`SELECT coalesce(site, 'dk') AS s, count(*) FILTER (WHERE seen IS false)::int AS unread,
          count(*) FILTER (WHERE needs_human)::int AS waiting
          FROM vh_conversations WHERE archived = false GROUP BY 1`;
        for (const r of b) badges[r.s] = { unread: r.unread, waiting: r.waiting };
      } catch (e) {}
      return json(200, { conversations, badges, site });
    }

    if (action === 'admin_stats') {
      // Periode i danske kalenderdage. Enten fra/til (begge med, 'ÅÅÅÅ-MM-DD') eller
      // days = de seneste N dage til og med i dag (days=1 er i dag fra midnat).
      // fra = til = i går giver præcis gårsdagen.
      const p = statPeriode(body);
      if (p.fejl) return json(400, { error: 'ugyldig periode', message: p.fejl });
      const { fra, til } = p;
      const days = p.dage;
      const site = cleanSite(body.site);
      const sidsteIndeks = p.dage - 1;
      // Samtaler og tommel tælles kun på de dage, der med sikkerhed stadig er gemt (se RYD_DAGE),
      // så periodens tal og dækningen handler om de samme dage.
      const gemtFra = plusDage(p.idag, -(RYD_DAGE - 1));
      const sFra = fra < gemtFra ? gemtFra : fra;
      // Alle forespørgsler på én gang. Arkiverede samtaler tælles med overalt i
      // statistikken: arkivering er kun en tilstand i indbakken (botten arkiverer
      // selv efter 14 dage), ikke en grund til at samtalen ikke fandtes.
      const [samtR, stemR, fbR, downsR, downsPR, qR, clicksR, chipR, chipPR, pagesR, trendR, startR] = await Promise.all([
        sql`SELECT coalesce(site, 'dk') AS s,
            count(*)::int AS alle,
            count(*) FILTER (WHERE coalesce(email, '') <> '')::int AS alle_mail,
            count(*) FILTER (WHERE human OR needs_human)::int AS alle_videre,
            count(*) FILTER (WHERE (created_at AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${til}::date)::int AS p_alle,
            count(*) FILTER (WHERE coalesce(email, '') <> '' AND (created_at AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${til}::date)::int AS p_mail,
            count(*) FILTER (WHERE (human OR needs_human) AND (created_at AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${til}::date)::int AS p_videre,
            count(*) FILTER (WHERE (created_at AT TIME ZONE 'Europe/Copenhagen')::date = ${p.idag}::date)::int AS i_dag,
            count(*) FILTER (WHERE archived IS NOT true)::int AS aabne,
            count(*) FILTER (WHERE archived IS NOT true AND seen IS false)::int AS ulaeste,
            count(*) FILTER (WHERE archived IS NOT true AND needs_human)::int AS venter
          FROM vh_conversations GROUP BY 1`,
        sql`SELECT coalesce(site, 'dk') AS s, mood, count(*)::int AS n FROM vh_conversations
          WHERE coalesce(mood, '') <> '' AND (created_at AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${til}::date
          GROUP BY 1, 2`,
        sql`SELECT coalesce(site, 'dk') AS s,
            count(*) FILTER (WHERE value = 1)::int AS up, count(*) FILTER (WHERE value = -1)::int AS down,
            count(*) FILTER (WHERE value = 1 AND (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${til}::date)::int AS p_up,
            count(*) FILTER (WHERE value = -1 AND (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${til}::date)::int AS p_down
          FROM vh_feedback GROUP BY 1`,
        sql`SELECT question AS q, answer AS a, ts FROM vh_feedback WHERE value = -1 AND coalesce(site, 'dk') = ${site} ORDER BY id DESC LIMIT 20`,
        sql`SELECT question AS q, answer AS a, ts FROM vh_feedback WHERE value = -1 AND coalesce(site, 'dk') = ${site}
          AND (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${sFra}::date AND ${til}::date ORDER BY id DESC LIMIT 20`,
        sql`SELECT first_q FROM vh_conversations WHERE first_q <> '' AND coalesce(site, 'dk') = ${site} ORDER BY created_at DESC LIMIT 30`,
        sql`SELECT label, count(*)::int AS n FROM vh_events WHERE kind = 'store' AND coalesce(site, 'dk') = ${site}
          AND (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${fra}::date AND ${til}::date GROUP BY label`,
        sql`SELECT label, count(*)::int AS n FROM vh_events WHERE kind = 'chip' AND coalesce(site, 'dk') = ${site} GROUP BY label ORDER BY n DESC LIMIT 10`,
        sql`SELECT coalesce(site, 'dk') AS s, label, count(*)::int AS n FROM vh_events WHERE kind = 'chip'
          AND (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${fra}::date AND ${til}::date GROUP BY 1, 2`,
        sql`SELECT label, count(*)::int AS n FROM vh_events WHERE kind = 'page' AND label LIKE 'dl:%' AND coalesce(site, 'dk') = ${site}
          AND (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${fra}::date AND ${til}::date GROUP BY label ORDER BY n DESC LIMIT 10`,
        // Trend: én række pr. dansk kalenderdag i perioden, huller udfyldt med 0
        sql`SELECT to_char(g.dag, 'YYYY-MM-DD') AS d, coalesce(v.visits, 0)::int AS visits, coalesce(v.clicks, 0)::int AS clicks
          FROM (SELECT ${fra}::date + i AS dag FROM generate_series(0, ${sidsteIndeks}::int) AS i) g
          LEFT JOIN (
            SELECT (ts AT TIME ZONE 'Europe/Copenhagen')::date AS dt,
              count(*) FILTER (WHERE kind = 'page' AND label LIKE 'dl:%') AS visits,
              count(*) FILTER (WHERE kind = 'store') AS clicks
            FROM vh_events WHERE coalesce(site, 'dk') = ${site}
              AND (ts AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN ${fra}::date AND ${til}::date GROUP BY 1
          ) v ON v.dt = g.dag ORDER BY g.dag`,
        // Bottens første registrering (samtale eller klik), så en periode der
        // starter før den, kan mærkes som kun delvist dækket
        sql`SELECT to_char((least((SELECT min(created_at) FROM vh_conversations), (SELECT min(ts) FROM vh_events)) AT TIME ZONE 'Europe/Copenhagen')::date, 'YYYY-MM-DD') AS d`,
      ]);

      // Samtaler og feedback pr. marked, plus dansk og tysk samlet
      const tom = () => ({ samtaler: 0, medMail: 0, sendtVidere: 0, feedback: { up: 0, down: 0 } });
      const tomP = () => ({ samtaler: 0, medMail: 0, sendtVidere: 0, feedback: { up: 0, down: 0 }, stemning: [], chips: [] });
      const tomNu = () => ({ aabne: 0, ulaeste: 0, venterPaaMenneske: 0 });
      // med et fast marked (brug()) findes kun det, saa svaret aldrig har et andet markeds felter
      const egne = FAST_SITE ? [FAST_SITE] : Object.keys(SITES);
      const markeder = egne.concat('alle');
      const alleTider = {}, perioden = {}, nu = {};
      for (const k of markeder) { alleTider[k] = tom(); perioden[k] = tomP(); nu[k] = tomNu(); }
      const iDag = {};
      // et ukendt marked (bør ikke findes) tælles kun med i 'alle'
      const hvorTil = s => egne.includes(s) ? [s, 'alle'] : ['alle'];
      for (const r of samtR) {
        for (const k of hvorTil(r.s)) {
          alleTider[k].samtaler += r.alle; alleTider[k].medMail += r.alle_mail; alleTider[k].sendtVidere += r.alle_videre;
          perioden[k].samtaler += r.p_alle; perioden[k].medMail += r.p_mail; perioden[k].sendtVidere += r.p_videre;
          nu[k].aabne += r.aabne; nu[k].ulaeste += r.ulaeste; nu[k].venterPaaMenneske += r.venter;
          iDag[k] = (iDag[k] || 0) + r.i_dag;
        }
      }
      for (const r of fbR) {
        for (const k of hvorTil(r.s)) {
          alleTider[k].feedback.up += r.up; alleTider[k].feedback.down += r.down;
          perioden[k].feedback.up += r.p_up; perioden[k].feedback.down += r.p_down;
        }
      }
      // Stemning og hurtig-svar: læg sammen pr. nøgle og sortér, højst 10 hurtig-svar
      const samle = (rows, noegle) => {
        const pr = {};
        for (const k of markeder) pr[k] = {};
        for (const r of rows) for (const k of hvorTil(r.s)) pr[k][r[noegle]] = (pr[k][r[noegle]] || 0) + r.n;
        return pr;
      };
      const stemPr = samle(stemR, 'mood'), chipPr = samle(chipPR, 'label');
      for (const k of markeder) {
        perioden[k].stemning = Object.keys(stemPr[k]).map(m => ({ mood: m, n: stemPr[k][m] })).sort((a, b) => b.n - a.n);
        perioden[k].chips = Object.keys(chipPr[k]).map(l => ({ label: l, n: chipPr[k][l] })).sort((a, b) => b.n - a.n).slice(0, 10);
        alleTider[k].navn = perioden[k].navn = nu[k].navn = MARKED_NAVN[k] || k;
      }

      // Dækning: starter perioden før bottens data, siges det, i stedet for stille nuller.
      // Bottens første registrering er den ældste samtale eller hændelse (hændelser slettes aldrig).
      const botStart = (startR[0] && startR[0].d) || null;
      const daek = (start, grundKun, grundIngen) => !start ? { fra: null, til: null, dage: 0, hel: false, grund: 'Chatbotten har ingen data endnu.' }
        : start > til ? { fra: null, til: null, dage: 0, hel: false, grund: grundIngen }
        : start > fra ? { fra: start, til, dage: dageMellem(start, til) + 1, hel: false, grund: grundKun } : null;
      const foerste = botStart ? datoTekst(botStart) : '';
      // hændelser (storeClicks, dlClicks, pageVisits, trend, chips): fra bottens første registrering
      const daekningHaendelser = daek(botStart, 'Chatbotten har kun data fra ' + foerste + '.',
        'Chatbotten havde ingen data i perioden. Den første er fra ' + foerste + '.');
      // samtaler og tommel: fra bottens første registrering, men aldrig før det, der stadig er gemt
      const slettet = !!botStart && botStart < gemtFra;
      const daekning = slettet
        ? daek(gemtFra, 'Samtaler og tommel slettes efter ' + RYD_DAGE + ' dage, så der kun er tal fra ' + datoTekst(gemtFra) + '.',
            'Samtaler og tommel slettes efter ' + RYD_DAGE + ' dage, så perioden har ingen samtaletal. Der er kun tal fra ' + datoTekst(gemtFra) + '.')
        : daek(botStart, 'Chatbotten har kun data fra ' + foerste + '.', 'Chatbotten havde ingen data i perioden. Den første er fra ' + foerste + '.');
      // ingen dækkede dage: periodens tal er ukendte (null), ikke 0
      if (daekning && !daekning.dage) for (const k of markeder) {
        Object.assign(perioden[k], { samtaler: null, medMail: null, sendtVidere: null, feedback: { up: null, down: null }, stemning: null });
      }
      if (daekningHaendelser && !daekningHaendelser.dage) for (const k of markeder) perioden[k].chips = null;

      // Split butiks-klik: uden kilde = fra chatten, ':download' = fra download-siden
      const storeClicks = { appstore: 0, googleplay: 0 };
      const dlClicks = { appstore: 0, googleplay: 0, website: 0 };
      for (const r of clicksR) {
        const [t, src] = String(r.label).split(':');
        if (src === 'download') { if (dlClicks[t] !== undefined) dlClicks[t] += r.n; }
        else if (storeClicks[t] !== undefined) storeClicks[t] += r.n;
      }
      const pageVisits = pagesR.map(r => ({ source: r.label.slice(3) || 'direkte', n: r.n }));
      const pageTotal = pageVisits.reduce((s, x) => s + x.n, 0);
      const trend = trendR.map(r => ({ d: r.d, visits: r.visits, clicks: r.clicks }));
      const ned = rows => rows.map(r => ({ q: r.q, a: r.a, ts: r.ts }));
      // De gamle felter (days, total, escalated, todayCount, questions, feedback,
      // recentDowns, chips) beholder deres form, så den gamle admin.html virker uændret.
      // total, escalated, feedback, recentDowns og chips er ALLE TIDER for det valgte
      // marked, dvs. alt der stadig er gemt (samtaler og tommel slettes efter RYD_DAGE).
      // Periodens tal står i perioden, feedbackPeriode og recentDownsPeriode.
      return json(200, {
        kilde: 'bot', days, site,
        periode: { fra, til, dage: p.dage, idag: p.idag, slutterIdag: til === p.idag, afkortet: p.afkortet, tidszone: TZ },
        daekning, daekningHaendelser,
        gemt: { fra: gemtFra, dage: RYD_DAGE, tekst: 'Samtaler og tommel slettes efter ' + RYD_DAGE + ' dage. "Alle tider" er det, der stadig er gemt.' },
        total: alleTider[site].samtaler, escalated: alleTider[site].sendtVidere, todayCount: iDag[site] || 0,
        questions: qR.map(r => r.first_q),
        feedback: alleTider[site].feedback,
        feedbackAlleTider: alleTider[site].feedback,
        feedbackPeriode: perioden[site].feedback,
        recentDowns: ned(downsR),
        recentDownsPeriode: daekning && !daekning.dage ? null : ned(downsPR),
        storeClicks, dlClicks, pageVisits, pageTotal, trend,
        chips: chipR.map(r => ({ label: r.label, n: r.n })),
        perioden, alleTider, nu,
      });
    }

    if (action === 'admin_get') {
      const id = cleanId(body.conversationId);
      // peek=true bruges til forudindlæsning — må IKKE markere samtalen som læst
      const peek = !!body.peek;
      const [metaR, messages] = await Promise.all([
        loadMeta(id),
        getMessages(id),
        peek ? Promise.resolve() : sql`UPDATE vh_conversations SET seen = true WHERE id = ${id}`,
      ]);
      const meta = metaR || { email: '', human: false, needsHuman: false };
      const gSite = cleanSite(meta.site);

      // Åbner man en samtale på et fremmed marked, oversættes det der endnu ikke
      // er oversat, til dansk. Resultatet gemmes, så hver besked kun koster ét
      // kald. Ved peek (forudindlæsning i baggrunden) springes det over.
      if (!peek && gSite !== 'dk') {
        const mangler = messages.filter(m => !m.da && m.content && m.role !== 'agent').slice(-15);
        if (mangler.length) {
          const nye = await Promise.all(mangler.map(m =>
            oversaet(m.content, 'da').then(d => ({ id: m.id, da: d })).catch(() => ({ id: m.id, da: '' }))));
          const gemt = nye.filter(x => x.da);
          await Promise.all(gemt.map(x => sql`UPDATE vh_messages SET da = ${x.da} WHERE id = ${x.id}`.catch(() => {})));
          const kort = {};
          for (const x of gemt) kort[x.id] = x.da;
          for (const m of messages) if (kort[m.id]) m.da = kort[m.id];
        }
      }
      return json(200, { id, email: meta.email, human: !!meta.human, needsHuman: !!meta.needsHuman, site: gSite, messages });
    }

    if (action === 'admin_reply') {
      const id = cleanId(body.conversationId);
      const content = (typeof body.content === 'string' ? body.content : '').trim();
      if (!id || !content) return json(400, { error: 'mangler id/besked' });
      const [metaR, priorMsgs] = await Promise.all([loadMeta(id), getMessages(id)]);
      const meta = metaR || { id, email: '', createdAt: nowISO() };
      const site = cleanSite(meta.site);

      // Er samtalen på et andet marked, oversættes svaret inden det gemmes.
      // Kunden ser kun sit eget sprog; den danske original følger med i 'da'.
      let tilKunde = content, paaDansk = '';
      if (site !== 'dk') {
        const oversat = await oversaet(content, cfg(site).lang);
        if (oversat) { tilKunde = oversat; paaDansk = content; }
      }

      const transcript = priorMsgs.concat([{ role: 'agent', content: tilKunde, da: paaDansk }]).slice(-40);
      meta.recent = transcript;
      meta.human = true; meta.needsHuman = false; meta.alerted = false; meta.seen = true;
      meta.updatedAt = nowISO(); meta.lastRole = 'agent'; meta.lastText = content.slice(0, 80);
      await Promise.all([addMessage(id, 'agent', tilKunde, paaDansk), saveMeta(id, meta)]);
      // oversat = false på et fremmed marked betyder at oversættelsen fejlede,
      // og at kunden fik den danske tekst. Det skal admin kunne sige til om.
      return json(200, { id, email: meta.email, human: true, site, oversat: site === 'dk' ? null : !!paaDansk, messages: await getMessages(id) });
    }

    if (action === 'admin_takeover') {
      const id = cleanId(body.conversationId);
      let meta = (await loadMeta(id)) || { id, email: '', createdAt: nowISO() };
      meta.human = body.human !== false;
      if (!meta.human) { meta.needsHuman = false; meta.alerted = false; }
      meta.seen = true;
      meta.updatedAt = nowISO();
      await saveMeta(id, meta);
      await updateIndex(id, meta);
      return json(200, { id, email: meta.email, human: meta.human, needsHuman: !!meta.needsHuman,
        site: cleanSite(meta.site), messages: await readConversation(id, meta) });
    }

    if (action === 'admin_testmail') {
      const tx = transporter();
      if (!tx) return json(200, { ok: false, reason: 'SMTP ikke konfigureret (mangler env vars)' });
      try {
        const info = await tx.sendMail({
          from: ALERT_FROM, to: ALERT_TO,
          subject: 'Test fra Vores Hjem chat',
          text: 'Dette er en testmail. Hvis du modtager den, virker email-alarmen. Til: ' + ALERT_TO,
        });
        return json(200, { ok: true, to: ALERT_TO, from: ALERT_FROM, host: SMTP_HOST, port: SMTP_PORT, messageId: info && info.messageId, response: info && info.response });
      } catch (e) {
        return json(200, { ok: false, host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, error: String(e && e.message || e) });
      }
    }

    if (action === 'admin_delete') {
      const id = cleanId(body.conversationId);
      await sql`DELETE FROM vh_messages WHERE conv_id = ${id}`;
      await sql`DELETE FROM vh_conversations WHERE id = ${id}`;
      return json(200, { ok: true });
    }

    // Redigér en agent-besked (kun 'agent'-beskeder — aldrig kundens/bottens)
    if (action === 'admin_edit_msg') {
      const id = cleanId(body.conversationId);
      const mid = parseInt(body.messageId, 10);
      const content = (typeof body.content === 'string' ? body.content : '').trim();
      if (!id || !mid || !content) return json(400, { error: 'mangler id/besked' });
      // Retter man et svar, skal kunden se den rettede tekst på sit eget sprog
      const eMeta = await loadMeta(id);
      const eSite = cleanSite(eMeta && eMeta.site);
      let eTilKunde = content, ePaaDansk = '';
      if (eSite !== 'dk') {
        const o = await oversaet(content, cfg(eSite).lang);
        if (o) { eTilKunde = o; ePaaDansk = content; }
      }
      await sql`UPDATE vh_messages SET content = ${eTilKunde}, da = ${ePaaDansk} WHERE id = ${mid} AND conv_id = ${id} AND role = 'agent'`;
      // Samme form som admin_get, ellers taber visningen email, status og marked
      return json(200, { id, email: (eMeta && eMeta.email) || '', human: !!(eMeta && eMeta.human), needsHuman: !!(eMeta && eMeta.needsHuman),
        site: eSite, oversat: eSite === 'dk' ? null : !!ePaaDansk, messages: await getMessages(id) });
    }

    // Slet en agent-besked (kun 'agent'-beskeder)
    if (action === 'admin_delete_msg') {
      const id = cleanId(body.conversationId);
      const mid = parseInt(body.messageId, 10);
      if (!id || !mid) return json(400, { error: 'mangler id' });
      await sql`DELETE FROM vh_messages WHERE id = ${mid} AND conv_id = ${id} AND role = 'agent'`;
      const dMeta = await loadMeta(id);
      return json(200, { id, email: (dMeta && dMeta.email) || '', human: !!(dMeta && dMeta.human), needsHuman: !!(dMeta && dMeta.needsHuman),
        site: cleanSite(dMeta && dMeta.site), messages: await getMessages(id) });
    }

    return json(400, { error: 'ukendt action' });
  } catch (e) {
    console.log('EXCEPTION', String(e && e.stack || e));
    return json(200, { error: 'exception', message: String(e && e.message || e) });
  }
}

exports.alertEmailHTML = alertEmailHTML; // til lokal forhåndsvisning

// Den samme bot inde i en anden backend. Bruges af den tyske backend (backend/netlify/functions-de/chat-bot.mjs,
// som vaerktoej/udgiv-backend.mjs --de tager med), aldrig af den danske bot, som derfor er uaendret.
//   site   det ene marked, botten kender. Alt andet, widgeten eller panelet sender, bliver det.
//   sql    backendens egen forbindelse (db.js, med ejermaerket). Botten bruger saa aldrig sin egen.
//   panel  hvor alarm-mailens knap peger hen (backendens panel i stedet for bottens admin.html)
// CLAUDE_MODEL hoerer til backendens egne opgaver (fx support-mailen), saa botten bruger BOT_MODEL eller
// sin egen standard, samme model som den danske bot.
exports.brug = function (valg) {
  const v = valg || {};
  if (!SITES[v.site]) throw new Error('brug(): ukendt marked ' + v.site);
  FAST_SITE = v.site;
  sql = v.sql || null;
  PANEL_URL = v.panel || null;
  MODEL = process.env.BOT_MODEL || STANDARD_MODEL;
};
