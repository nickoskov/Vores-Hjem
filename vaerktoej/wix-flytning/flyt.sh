#!/bin/bash
# Flyttedagen som én kommando. Koeres NAAR Nicko har gjort de fire trin
# (Netlify domaene + Simply navneservere og records). Scriptet:
#   1. henter panelets rettelser ind i filerne
#   2. udgiver siden MED sporing til stirring-cactus (den side der faar domaenet)
#   3. tjekker at alle adresser i sitemap svarer 200
#   4. tjekker at sporingen er paa, og hvor domaenet peger
set -u
SITE=/Users/nickoskovgaard/voreshjem-site
ID=fff8c0f6-c7e6-42c1-889d-8e128f9f070b
BASE=${BASE:-https://www.voreshjem.dk}
cd "$SITE"

echo "== 1. panelets rettelser ind i filerne"
if [ -n "${ADMIN_PASSWORD:-}${BACKEND_SEDDEL:-}" ]; then node hent_rettelser.js || echo "   (kunne ikke hente rettelser, fortsaetter)"; else echo "   springes over: saet ADMIN_PASSWORD=... foran kommandoen for at tage rettelser med"; fi

echo "== 2. udgiver siden med sporing"
grep -q "GTM-TQ39D7RM" index.html || { echo "   FEJL: sporingsblokken mangler i index.html"; exit 1; }
for i in 1 2 3 4 5; do
  ud=$(npx netlify-cli deploy --dir . --prod --site $ID 2>&1)
  if echo "$ud" | grep -q "Deploy is live"; then echo "   udgivet i forsoeg $i"; break; fi
  echo "   forsoeg $i fejlede, proever igen om 10 s"; sleep 10
  [ $i = 5 ] && { echo "   FEJL: kunne ikke udgive"; exit 1; }
done
sleep 5

echo "== 3. alle adresser i sitemap"
fejl=0; n=0
for u in $(grep -o "<loc>[^<]*</loc>" sitemap.xml | sed 's/<[^>]*>//g'); do
  n=$((n+1)); sti=${u#https://www.voreshjem.dk}
  kode=$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 20 "$BASE$sti")
  [ "$kode" = "200" ] || { echo "   $kode  $sti"; fejl=$((fejl+1)); }
done
echo "   $n adresser, $fejl fejl"

echo "== 4. sporing og domaene"
curl -s -L --max-time 20 "$BASE/" | grep -q "GTM-TQ39D7RM" && echo "   sporing: paa" || echo "   sporing: MANGLER paa $BASE"
curl -s -L --max-time 20 "$BASE/" | grep -c "iubenda" | sed 's/^/   cookiebanner-referencer: /'
echo "   www peger paa: $(dig +short www.voreshjem.dk | head -2 | tr '\n' ' ')"
echo "   rod peger paa: $(dig +short voreshjem.dk | head -2 | tr '\n' ' ')"
echo "   navneservere:  $(dig +short NS voreshjem.dk | tr '\n' ' ')"
echo "   mail (MX):     $(dig +short MX voreshjem.dk | tr '\n' ' ')"
[ $fejl = 0 ] && echo "== FAERDIG, alt svarer" || echo "== FAERDIG med $fejl fejl, se ovenfor"
