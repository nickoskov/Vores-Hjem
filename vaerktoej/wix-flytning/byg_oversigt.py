# -*- coding: utf-8 -*-
"""Bygger blogoversigten paa /blog. Den er det eneste doede link paa siden:
alle 28 indlaeg linker op til den, men den har aldrig eksisteret som egen side,
fordi Wix lavede den automatisk."""
import io, os, re, json, glob, html

HER = os.path.dirname(os.path.abspath(__file__))
MDR = ["januar","februar","marts","april","maj","juni",
       "juli","august","september","oktober","november","december"]

def felt(s, m):
    t = re.search(m, s, re.S)
    return html.unescape(t.group(1)).strip() if t else ""

IKONER = {
 "mad": '<path d="M3 2v7c0 1.1.9 2 2 2h1v11h2V11h1c1.1 0 2-.9 2-2V2H9v7H8V2H6v7H5V2H3zm13 0c-1.7 0-3 2.7-3 6 0 2.5.8 4.6 2 5.5V22h2V2h-1z"/>',
 "kal": '<path d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zM5 10h14v10H5V10z"/>',
 "kob": '<path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM1 2v2h2l3.6 7.6-1.35 2.45A2 2 0 0 0 7 17h12v-2H7.4l1.1-2h7a2 2 0 0 0 1.8-1.1l3.6-6.5H6.2L5.3 2H1z"/>',
 "opg": '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>',
 "hus": '<path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3L12 3z"/>',
}
def ikon(titel):
    t = titel.lower()
    n = "mad" if ("mad" in t or "aftensmad" in t or "opskrift" in t) else \
        "kob" if ("indkøb" in t or "indkob" in t) else \
        "kal" if ("kalender" in t or "aftaler" in t or "aktivitet" in t) else \
        "opg" if ("opgav" in t or "rutine" in t or "pligt" in t) else "hus"
    return ('<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">%s</svg>' % IKONER[n])

indlaeg = []
for sti in glob.glob(os.path.join(HER, "raa", "*.json")):
    d = json.load(io.open(sti, encoding="utf-8"))
    bygget = os.path.join(HER, "blog", "post", d["slug"] + ".html")
    if not os.path.exists(bygget):
        print("  springer over, ikke bygget: %s" % d["slug"]); continue
    s = io.open(bygget, encoding="utf-8").read()
    indlaeg.append({
        "slug"   : d["slug"],
        "titel"  : felt(s, r'<title>(.*?)\s*\|\s*Vores Hjem</title>') or d["titel"],
        "tekst"  : felt(s, r'<meta name="description" content="(.*?)">'),
        "billede": d.get("billede") or "",
        "dato"   : d.get("aendret") or "",
    })

# nyeste foerst, saa det friskeste moeder laeseren
indlaeg.sort(key=lambda p: p["dato"], reverse=True)

def dansk(d):
    if not d: return ""
    try:
        aa, mm, dd = d.split("-")
        return "%d. %s %s" % (int(dd), MDR[int(mm)-1], aa)
    except Exception:
        return d

# billederne ligger hos Wix. Efter flytningen findes de stadig, men vi beder
# om en mindre udgave, saa oversigten ikke henter 28 fuldstoerrelsesbilleder.
def lille(u):
    if "wixstatic.com" not in u: return u
    return re.sub(r"/v1/fill/[^/]+/", "/v1/fill/w_600,h_400,al_c,q_80/", u) if "/v1/fill/" in u \
           else u.split("/v1/")[0] + "/v1/fill/w_600,h_400,al_c,q_80/" + u.split("/")[-1]

kort = []
for i, p in enumerate(indlaeg):
    b = lille(p["billede"])
    # de foerste seks ligger oeverst paa skaermen og skal hentes med det samme
    doven = "" if i < 6 else ' loading="lazy" decoding="async"'
    billede = ('<img src="%s" alt="" class="bk-bil"%s>' % (html.escape(b), doven)) if b \
              else '<div class="bk-bil bk-tom">%s</div>' % ikon(p["titel"])
    kort.append("""      <a class="bk" href="/post/%s">
        <div class="bk-ramme">%s</div>
        <div class="bk-ind">
          <time class="bk-dato" datetime="%s">%s</time>
          <h2 class="bk-titel">%s</h2>
          <p class="bk-tekst">%s</p>
          <span class="bk-mere">Læs indlægget
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
        </div>
      </a>""" % (p["slug"], billede, p["dato"], dansk(p["dato"]),
                 html.escape(p["titel"]), html.escape(p["tekst"])))

# Googles liste over indlaeg, saa oversigten kan vises som en samling
liste = {
  "@context": "https://schema.org",
  "@type": "Blog",
  "name": "Vores Hjem, bloggen",
  "description": "Gode råd om familiens hverdag, kalender, madplan og rutiner.",
  "url": "https://www.voreshjem.dk/blog",
  "blogPost": [{
      "@type": "BlogPosting",
      "headline": p["titel"],
      "datePublished": p["dato"],
      "url": "https://www.voreshjem.dk/post/" + p["slug"]
  } for p in indlaeg]
}
brodkrumme = {
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  "itemListElement": [
    {"@type":"ListItem","position":1,"name":"Forsiden","item":"https://www.voreshjem.dk"},
    {"@type":"ListItem","position":2,"name":"Blog","item":"https://www.voreshjem.dk/blog"}]
}

# nav og footer tages ordret fra et indlaeg, saa oversigten ikke falder ud af stilen
kilde = io.open(os.path.join(HER,"blog","post",indlaeg[0]["slug"]+".html"), encoding="utf-8").read()
stil   = re.search(r"<style>(.*?)</style>", kilde, re.S).group(1)
nav    = re.search(r"<nav>.*?</nav>", kilde, re.S).group(0)
footer = kilde[kilde.index("<footer"):].replace("</body>","").replace("</html>","").rstrip()

ud = """<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Blog | Vores Hjem</title>
<link rel="canonical" href="https://www.voreshjem.dk/blog">
<meta name="description" content="Gode råd om familiens hverdag. Om kalender, madplan, opgaver og rutiner, der gør ugen lettere for hele husstanden.">
<meta property="og:type" content="website">
<meta property="og:title" content="Blog | Vores Hjem">
<meta property="og:description" content="Gode råd om familiens hverdag. Om kalender, madplan, opgaver og rutiner, der gør ugen lettere for hele husstanden.">
<meta property="og:url" content="https://www.voreshjem.dk/blog">
<meta property="og:image" content="https://www.voreshjem.dk/images/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<script type="application/ld+json">%s</script>
<script type="application/ld+json">%s</script>
<style>%s

/* ─── BLOGOVERSIGT ─── */
.bo-top { padding: 88px 0 48px; text-align: center; }
.bo-top h1 { font-size: clamp(38px, 6vw, 60px); font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
.bo-top h1 span { background: var(--gradient); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.bo-top p { margin: 18px auto 0; max-width: 560px; font-size: 18px; color: var(--text-secondary); }
.bo-antal { display:inline-block; margin-top:22px; padding:7px 16px; border-radius:999px;
            background: var(--bg-muted); color: var(--text-secondary); font-size:13px; font-weight:600; }

.bo-net { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; padding-bottom: 96px; }
.bk { display:flex; flex-direction:column; background: var(--bg); border:1px solid var(--border);
      border-radius: var(--radius); overflow:hidden; transition: transform .25s, box-shadow .25s, border-color .25s; }
.bk:hover { transform: translateY(-4px); box-shadow: var(--shadow); border-color: var(--purple-light); }
.bk-ramme { aspect-ratio: 3/2; overflow:hidden; background: var(--bg-muted); }
.bk-bil { width:100%%; height:100%%; object-fit:cover; display:block; transition: transform .4s; }
.bk:hover .bk-bil { transform: scale(1.04); }
.bk-tom { display:flex; align-items:center; justify-content:center;
           background: linear-gradient(135deg, #F3F0FF 0%%, #EDF2FF 55%%, #FDF0F7 100%%); }
.bk-tom svg { width:54px; height:54px; color: var(--purple); opacity:.34; }
.bk-ind { padding: 24px; display:flex; flex-direction:column; flex:1; }
.bk-dato { font-size:12px; font-weight:700; color: var(--text-muted); text-transform:uppercase; letter-spacing:.05em; }
.bk-titel { margin-top:10px; font-size:19px; font-weight:700; line-height:1.35; letter-spacing:-0.01em; }
.bk-tekst { margin-top:10px; font-size:14.5px; color: var(--text-secondary); line-height:1.6; flex:1;
            display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.bk-mere { margin-top:18px; display:inline-flex; align-items:center; gap:6px;
           font-size:14px; font-weight:700; color: var(--purple); }
.bk-mere svg { width:14px; height:14px; transition: transform .2s; }
.bk:hover .bk-mere svg { transform: translateX(3px); }

@media (max-width: 940px) { .bo-net { grid-template-columns: repeat(2, 1fr); gap: 22px; } }
@media (max-width: 620px) { .bo-net { grid-template-columns: 1fr; } .bo-top { padding: 56px 0 36px; } }
</style>
</head>
<body>

%s

<header class="bo-top">
  <div class="container">
    <h1>Fra <span>bloggen</span></h1>
    <p>Gode råd om familiens hverdag. Om kalender, madplan, opgaver og de rutiner, der gør ugen lettere for hele husstanden.</p>
    <div class="bo-antal">%d indlæg</div>
  </div>
</header>

<main>
  <div class="container">
    <div class="bo-net">
%s
    </div>
  </div>
</main>

%s
</body>
</html>
""" % (json.dumps(liste, ensure_ascii=False), json.dumps(brodkrumme, ensure_ascii=False),
       stil, nav, len(indlaeg), "\n".join(kort), footer)

sti = os.path.join(HER, "blog", "index.html")
io.open(sti, "w", encoding="utf-8").write(ud)
print("  blog/index.html bygget, %d indlaeg, %.0f KB" % (len(indlaeg), len(ud.encode())/1024))
print("  nyeste: %s (%s)" % (indlaeg[0]["titel"][:52], dansk(indlaeg[0]["dato"])))
print("  aeldste: %s (%s)" % (indlaeg[-1]["titel"][:52], dansk(indlaeg[-1]["dato"])))
