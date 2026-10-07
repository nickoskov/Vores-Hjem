#!/bin/bash
# Trin to, TIDLIGST to dage efter flytningen, naar DNS er igennem overalt:
# info.voreshjem.dk sendes videre til www, saa Google kun taeller indholdet ét sted.
set -u
SITE=/Users/nickoskovgaard/voreshjem-site
cd "$SITE"
if dig +short www.voreshjem.dk | grep -qE "netlify|75\.2\.60\.5|99\.83\.231\.61"; then echo "== www peger paa Netlify, fortsaetter"; else echo "== STOP: www.voreshjem.dk peger ikke paa Netlify endnu"; exit 1; fi
grep -q "^https://info.voreshjem.dk/\*" _redirects || printf '\n# info samles paa www (slaaet til %s)\nhttps://info.voreshjem.dk/*   https://www.voreshjem.dk/:splat   301!\n' "$(date +%F)" >> _redirects
[ -n "${ADMIN_PASSWORD:-}" ] && node hent_rettelser.js
npx netlify-cli deploy --dir . --prod --site fff8c0f6-c7e6-42c1-889d-8e128f9f070b 2>&1 | grep -E "live|rror"
sleep 5
curl -s -o /dev/null -w "   info -> %{redirect_url} (%{http_code})\n" https://info.voreshjem.dk/kalender-informationsside
echo "== faerdig. Meld sitemap i Search Console: https://www.voreshjem.dk/sitemap.xml"
