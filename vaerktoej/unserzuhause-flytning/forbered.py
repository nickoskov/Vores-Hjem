# -*- coding: utf-8 -*-
"""Gør den tyske side klar til at stå alene på www.unserzuhauseapp.de i stedet for i en Wix-ramme.

Kan køres flere gange: hver ændring tjekker først, om den allerede er lavet.
"""
import re, os, json

MAPPE = '/Users/nickoskovgaard/unserzuhause'
DOM = 'https://www.unserzuhauseapp.de'
DA = 'https://www.voreshjem.dk'

# fil -> (ren adresse, dansk søsterside eller None)
SIDER = {
    'index.html':            ('/',                  '/'),
    'kalender.html':         ('/kalender',          '/kalender'),
    'opgaver.html':          ('/aufgaben',          '/opgaver'),
    'madplan.html':          ('/essenpl%C3%A4ne',   '/madplan'),
    'indkob.html':           ('/einkaufsliste',     '/indkobsliste'),
    'einstellungen.html':    ('/einstellungen',     '/indstillinger'),
    'synchronisierung.html': ('/synchronisierung',  '/synkronisering'),
    'kontakt.html':          ('/support',           '/support'),
    'slet-konto.html':       ('/konto-loeschen',    '/hvordan-sletter-man-sin-konto'),
    'impressum.html':        ('/impressum',         None),
}

SKRIFT = '''<link rel="preload" href="/fonts/plus-jakarta-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<style>@font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:200 800;font-display:swap;src:url(/fonts/plus-jakarta-sans-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}</style>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/favicon.png">
<script>window.__uzT = Date.now();</script>'''

HP = ('<input type="text" id="uz-hp" name="hjemmeside" tabindex="-1" autocomplete="off" aria-hidden="true" '
      'style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0">')

FORMULAR = re.compile(r"await fetch\('https://hook\.eu1\.make\.com/[^']+',\s*\{[\s\S]*?body:\s*JSON\.stringify\((\{[\s\S]*?\})\)\s*\}\);")


def meta(s, navn, egen=None):
    m = re.search(r'<meta name="%s" content="([^"]*)"' % navn, s)
    return m.group(1) if m else egen


def seo_blok(fil, s):
    sti, da = SIDER[fil]
    url = DOM + sti
    titel = re.search(r'<title>([^<]*)</title>', s).group(1).strip()
    beskr = meta(s, 'description', '')
    linjer = [
        '<!-- SEO til eget domæne (tilføjet ved flytningen fra Wix) -->',
        '<link rel="canonical" href="%s">' % url,
        '<meta property="og:type" content="website">',
        '<meta property="og:locale" content="de_DE">',
        '<meta property="og:site_name" content="Unser Zuhause">',
        '<meta property="og:title" content="%s">' % titel,
        '<meta property="og:description" content="%s">' % beskr,
        '<meta property="og:url" content="%s">' % url,
        '<meta property="og:image" content="%s/images/og.jpg">' % DOM,
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="twitter:title" content="%s">' % titel,
        '<meta name="twitter:description" content="%s">' % beskr,
        '<meta name="twitter:image" content="%s/images/og.jpg">' % DOM,
    ]
    if da:
        linjer += [
            '<link rel="alternate" hreflang="de" href="%s">' % url,
            '<link rel="alternate" hreflang="da" href="%s">' % (DA + da),
            '<link rel="alternate" hreflang="x-default" href="%s">' % url,
        ]
    if fil == 'index.html':
        ld = {"@context": "https://schema.org", "@type": "MobileApplication", "name": "Unser Zuhause",
              "applicationCategory": "LifestyleApplication", "operatingSystem": "iOS, Android", "inLanguage": "de",
              "description": beskr, "url": DOM + '/', "image": DOM + "/images/og.jpg",
              "offers": {"@type": "Offer", "price": "0", "priceCurrency": "EUR",
                         "description": "14 Tage kostenlos testen, danach Abo im App Store oder bei Google Play."},
              "sameAs": ["https://apps.apple.com/de/app/unser-zuhause/id6771931999",
                         "https://play.google.com/store/apps/details?id=com.unserzuhause.app"],
              "publisher": {"@type": "Organization", "name": "Vores Hjem I/S", "url": DOM + '/',
                            "logo": DOM + "/favicon.png",
                            "address": {"@type": "PostalAddress", "streetAddress": "Tværgade 5",
                                        "postalCode": "5500", "addressLocality": "Middelfart", "addressCountry": "DK"}}}
        linjer.append('<script type="application/ld+json">%s</script>' % json.dumps(ld, ensure_ascii=False))
    return '\n'.join(linjer) + '\n'


def formular(m):
    obj = m.group(1)
    return ("const __d = " + obj + ";\n"
            "    const __r = await fetch('https://backend.voreshjem.dk/formular/kontakt', { method: 'POST',\n"
            "      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },\n"
            "      body: new URLSearchParams({ navn: __d.name || '', email: __d.email || '', emne: __d.subject || '',\n"
            "        besked: __d.message || '', t: String(window.__uzT || 0),\n"
            "        hjemmeside: (document.getElementById('uz-hp') || {}).value || '', side: 'de' }) });\n"
            "    if (!__r.ok) throw new Error('Senden fehlgeschlagen');")


rapport = []
for fil in SIDER:
    p = os.path.join(MAPPE, fil)
    s = open(p, encoding='utf-8').read()
    før = s
    # 1. Google Fonts ud, egen skrifttype og favicon ind
    s = re.sub(r'\s*<link rel="preconnect" href="https://fonts\.(googleapis|gstatic)\.com"[^>]*>', '', s)
    s = re.sub(r'\s*<link href="https://fonts\.googleapis\.com/css2[^"]*" rel="stylesheet">', '', s)
    if '/fonts/plus-jakarta-sans-latin.woff2' not in s:
        s = re.sub(r'(<meta charset="UTF-8">)', r'\1\n' + SKRIFT.replace('\\', '\\\\'), s, count=1)
    # 2. canonical, delingskort og sprogpar
    if 'rel="canonical"' not in s:
        s = s.replace('</title>', '</title>\n' + seo_blok(fil, s), 1)
    # 3. formularerne til den beskyttede backend
    n_form = len(FORMULAR.findall(s))
    s = FORMULAR.sub(formular, s)
    if 'id="uz-hp"' not in s:
        if '<form id="contactForm">' in s:
            s = s.replace('<form id="contactForm">', '<form id="contactForm">\n          ' + HP, 1)
        elif 'id="c-msg"' in s:
            s = re.sub(r'(<textarea[^>]*id="c-msg"[^>]*>[\s\S]*?</textarea>)', r'\1' + HP, s, count=1)
    if s != før:
        open(p, 'w', encoding='utf-8').write(s)
    rapport.append((fil, n_form, 'make.com' in s, 'uz-hp' in s, 'canonical' in s, 'fonts.googleapis' in s))

for r in rapport:
    print('%-24s formularer=%d  make_tilbage=%s  honeypot=%s  canonical=%s  googlefonts=%s' % r)
