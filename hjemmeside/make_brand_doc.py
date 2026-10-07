from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import copy

doc = Document()

# ── Page margins
for section in doc.sections:
    section.top_margin    = Cm(2.5)
    section.bottom_margin = Cm(2.5)
    section.left_margin   = Cm(2.8)
    section.right_margin  = Cm(2.8)

# ── Helper: set paragraph style
def heading(text, level=1, color=None, size=None, bold=True, space_before=18, space_after=6):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after  = Pt(space_after)
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(size or (28 if level==1 else 18 if level==2 else 13))
    if color:
        run.font.color.rgb = RGBColor(*bytes.fromhex(color.lstrip('#')))
    return p

def body(text, color=None, size=11, bold=False, space_before=2, space_after=4, italic=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after  = Pt(space_after)
    run = p.add_run(text)
    run.bold = bold
    run.italic = italic
    run.font.size = Pt(size)
    if color:
        run.font.color.rgb = RGBColor(*bytes.fromhex(color.lstrip('#')))
    return p

def label(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after  = Pt(4)
    run = p.add_run(text.upper())
    run.bold = True
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(0x7B, 0x3F, 0xE4)
    return p

def divider():
    p = doc.add_paragraph('─' * 72)
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after  = Pt(8)
    run = p.runs[0]
    run.font.color.rgb = RGBColor(0xDD, 0xD8, 0xFF)
    run.font.size = Pt(8)

def color_row(table, row_idx, name, hex_code, rgb_vals, note=''):
    row = table.rows[row_idx]
    # Swatch cell (simulated with background color)
    swatch_cell = row.cells[0]
    swatch_cell.text = '   '
    tc = swatch_cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_code.lstrip('#'))
    tcPr.append(shd)
    # Name cell
    row.cells[1].text = name
    row.cells[1].paragraphs[0].runs[0].bold = True
    # Hex cell
    row.cells[2].text = hex_code
    row.cells[2].paragraphs[0].runs[0].font.name = 'Courier New'
    # RGB cell
    row.cells[3].text = f'rgb({rgb_vals})'
    row.cells[3].paragraphs[0].runs[0].font.name = 'Courier New'
    row.cells[3].paragraphs[0].runs[0].font.size = Pt(9)
    # Note
    if note:
        row.cells[4].text = note
        row.cells[4].paragraphs[0].runs[0].font.color.rgb = RGBColor(0x9B, 0x97, 0xB5)
        row.cells[4].paragraphs[0].runs[0].font.size = Pt(9)

# ══════════════════════════════════════════
#  FORSIDE
# ══════════════════════════════════════════
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(40)
p.paragraph_format.space_after  = Pt(4)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = p.add_run('VORES HJEM')
run.bold = True
run.font.size = Pt(36)
run.font.color.rgb = RGBColor(0x1C, 0x1C, 0x1E)

p2 = doc.add_paragraph()
p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
p2.paragraph_format.space_after = Pt(6)
run2 = p2.add_run('Brand Guideline')
run2.font.size = Pt(22)
run2.font.color.rgb = RGBColor(0x7B, 0x3F, 0xE4)
run2.bold = True

p3 = doc.add_paragraph()
p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
p3.paragraph_format.space_after = Pt(2)
run3 = p3.add_run('Version 1.0  ·  Maj 2026  ·  Fortroligt')
run3.font.size = Pt(10)
run3.font.color.rgb = RGBColor(0x9B, 0x97, 0xB5)

p4 = doc.add_paragraph()
p4.alignment = WD_ALIGN_PARAGRAPH.CENTER
run4 = p4.add_run('© 2026 Vores Hjem I/S  ·  CVR 45804445')
run4.font.size = Pt(9)
run4.font.color.rgb = RGBColor(0xC5, 0xC3, 0xD6)

doc.add_page_break()

# ══════════════════════════════════════════
#  INDHOLDSFORTEGNELSE
# ══════════════════════════════════════════
heading('Indholdsfortegnelse', level=2, size=16, space_before=8)
items = [
    '01  —  Logo',
    '02  —  Farver',
    '03  —  Typografi',
    '04  —  Tone of Voice',
    '05  —  Design elementer',
    '06  —  Ikoner',
]
for item in items:
    p = doc.add_paragraph(item, style='List Bullet')
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after  = Pt(3)

doc.add_page_break()

# ══════════════════════════════════════════
#  01 — LOGO
# ══════════════════════════════════════════
label('01 — Logo')
heading('Vores logo', level=1, color='1C1C1E')
body('Logoet består af to elementer: et hus-ikon tegnet med gradient-streg og ordmærket "VORES HJEM" i Montserrat Black. De to elementer bruges altid sammen og må ikke adskilles.')

heading('Logo-elementer', level=2, size=13, space_before=14)

tbl = doc.add_table(rows=3, cols=2)
tbl.style = 'Table Grid'
headers = ['Element', 'Specifikation']
for i, h in enumerate(headers):
    cell = tbl.rows[0].cells[i]
    cell.text = h
    cell.paragraphs[0].runs[0].bold = True
    cell.paragraphs[0].runs[0].font.color.rgb = RGBColor(0x7B, 0x3F, 0xE4)
data = [
    ['Hus-ikon', 'Gradient outline-streg — lilla → blå → pink → rød\nSkorsten placeret øverst til venstre\nAldrig udfyldt (fill: none)'],
    ['Ordmærke', '"VORES HJEM" i to linjer\nFont: Montserrat Black (weight 900)\nFarve: #1C1C1E på lys baggrund / #FFFFFF på mørk'],
]
for i, (col1, col2) in enumerate(data):
    row = tbl.rows[i+1]
    row.cells[0].text = col1
    row.cells[0].paragraphs[0].runs[0].bold = True
    row.cells[1].text = col2
    row.cells[1].paragraphs[0].runs[0].font.size = Pt(10)

divider()

heading('Brug af logoet', level=2, size=13, space_before=14)

tbl2 = doc.add_table(rows=4, cols=2)
tbl2.style = 'Table Grid'
ok_head = tbl2.rows[0].cells[0]
ok_head.text = '✓  Korrekt brug'
ok_head.paragraphs[0].runs[0].bold = True
ok_head.paragraphs[0].runs[0].font.color.rgb = RGBColor(0x10, 0xB9, 0x81)
no_head = tbl2.rows[0].cells[1]
no_head.text = '✕  Må ikke'
no_head.paragraphs[0].runs[0].bold = True
no_head.paragraphs[0].runs[0].font.color.rgb = RGBColor(0xEF, 0x30, 0x30)

dos = [
    'Brug på hvid/lys baggrund med gradient-ikon',
    'Brug på mørk baggrund med gradient-ikon og hvid tekst',
    'Bevar proportioner ved skalering',
]
donts = [
    'Brug ikke ikonet alene uden ordmærket',
    'Skift ikke farven til éntone (fx helt lilla eller sort)',
    'Stræk eller forvræng ikke logoet',
]
for i, (do, dont) in enumerate(zip(dos, donts)):
    row = tbl2.rows[i+1]
    row.cells[0].text = do
    row.cells[0].paragraphs[0].runs[0].font.size = Pt(10)
    row.cells[1].text = dont
    row.cells[1].paragraphs[0].runs[0].font.size = Pt(10)

heading('Minimum størrelse', level=2, size=13, space_before=14)
body('Logo må ikke bruges mindre end 120px bredt digitalt / 30mm i print. Under denne grænse går detaljer i hus-ikonet tabt.')

doc.add_page_break()

# ══════════════════════════════════════════
#  02 — FARVER
# ══════════════════════════════════════════
label('02 — Farver')
heading('Farvepalette', level=1, color='1C1C1E')
body('Vores brand-gradient går fra lilla til blå til pink til rød. Farverne bruges i denne rækkefølge — aldrig omvendt og aldrig enkeltvis i UI-elementer der kræver gradienten.')

heading('Primære farver', level=2, size=13, space_before=14)

color_table = doc.add_table(rows=6, cols=5)
color_table.style = 'Table Grid'
for i, cell in enumerate(color_table.rows[0].cells):
    cell.text = ['Farve', 'Navn', 'HEX', 'RGB', 'Brug'][i]
    cell.paragraphs[0].runs[0].bold = True
    cell.paragraphs[0].runs[0].font.color.rgb = RGBColor(0x7B, 0x3F, 0xE4)

colors = [
    ('7B3FE4', 'Lilla',      '123, 63, 228',  'Primær – start gradient'),
    ('4F6BFF', 'Blå',        '79, 107, 255',  'Sekundær – midt gradient'),
    ('D93BAA', 'Pink',       '217, 59, 170',  'Tertiær – midt-slut gradient'),
    ('EF3030', 'Rød',        '239, 48, 48',   'Slut gradient / accent'),
    ('1C1C1E', 'Sort',       '28, 28, 30',    'Tekst – primær'),
]
for i, (hex_c, name, rgb, note) in enumerate(colors):
    color_row(color_table, i+1, name, f'#{hex_c}', rgb, note)

heading('Sekundære farver', level=2, size=13, space_before=14)
sec_table = doc.add_table(rows=3, cols=5)
sec_table.style = 'Table Grid'
for i, cell in enumerate(sec_table.rows[0].cells):
    cell.text = ['Farve', 'Navn', 'HEX', 'RGB', 'Brug'][i]
    cell.paragraphs[0].runs[0].bold = True
    cell.paragraphs[0].runs[0].font.color.rgb = RGBColor(0x7B, 0x3F, 0xE4)
sec_colors = [
    ('F8F7FF', 'Baggrund',    '248, 247, 255', 'Side-baggrund lys'),
    ('5E5A7A', 'Tekst grå',   '94, 90, 122',   'Brødtekst / sekundær tekst'),
]
for i, (hex_c, name, rgb, note) in enumerate(sec_colors):
    color_row(sec_table, i+1, name, f'#{hex_c}', rgb, note)

heading('Logo-gradient', level=2, size=13, space_before=14)
body('CSS:  linear-gradient(135deg, #7B3FE4 0%, #4F6BFF 30%, #D93BAA 65%, #EF3030 100%)', size=10, bold=True)
body('Gradienten bruges på: logo-ikon, CTA-knapper, accent-elementer og badges.')

doc.add_page_break()

# ══════════════════════════════════════════
#  03 — TYPOGRAFI
# ══════════════════════════════════════════
label('03 — Typografi')
heading('To skriftsnit', level=1, color='1C1C1E')
body('Vi bruger to fonte: Montserrat Black (kun til logo) og Plus Jakarta Sans (til alt andet).')

heading('Montserrat Black — Logo', level=2, size=13, space_before=14)
body('Bruges udelukkende i logo-ordmærket "VORES HJEM". Aldrig i brødtekst, overskrifter eller UI.')

type_tbl = doc.add_table(rows=2, cols=3)
type_tbl.style = 'Table Grid'
for i, h in enumerate(['Egenskab', 'Værdi', 'Note']):
    type_tbl.rows[0].cells[i].text = h
    type_tbl.rows[0].cells[i].paragraphs[0].runs[0].bold = True
type_tbl.rows[1].cells[0].text = 'Font'
type_tbl.rows[1].cells[1].text = 'Montserrat Black (weight 900)'
type_tbl.rows[1].cells[2].text = 'Google Fonts — gratis'

heading('Plus Jakarta Sans — Alt andet', level=2, size=13, space_before=14)
body('Bruges på hjemmesiden, i app\'en, i nyhedsbreve og al kommunikation.')

type_scale = doc.add_table(rows=7, cols=4)
type_scale.style = 'Table Grid'
for i, h in enumerate(['Navn', 'Størrelse', 'Vægt', 'Brug']):
    type_scale.rows[0].cells[i].text = h
    type_scale.rows[0].cells[i].paragraphs[0].runs[0].bold = True
    type_scale.rows[0].cells[i].paragraphs[0].runs[0].font.color.rgb = RGBColor(0x7B, 0x3F, 0xE4)

scale = [
    ('Display',  '72px / 54pt', '900 ExtraBold', 'Hero-overskrift, forsidevisning'),
    ('H1',       '48px / 36pt', '800 ExtraBold', 'Sektions-overskrift, primær'),
    ('H2',       '32px / 24pt', '800 ExtraBold', 'Under-overskrift'),
    ('H3',       '20px / 15pt', '700 Bold',      'Kort-titel, feature-navn'),
    ('Body',     '16px / 12pt', '400 Regular',   'Brødtekst, beskrivelser'),
    ('Label',    '12px / 9pt',  '700 Bold',      'Badges, tags, uppercase-etiketter'),
]
for i, row_data in enumerate(scale):
    for j, val in enumerate(row_data):
        type_scale.rows[i+1].cells[j].text = val
        type_scale.rows[i+1].cells[j].paragraphs[0].runs[0].font.size = Pt(10)

doc.add_page_break()

# ══════════════════════════════════════════
#  04 — TONE OF VOICE
# ══════════════════════════════════════════
label('04 — Tone of Voice')
heading('Sådan taler vi', level=1, color='1C1C1E')
body('Vores Hjem taler til travle forældre og familier. Vi er direkte, varme og konkrete — aldrig salgsorienterede, stive eller overforklarende.')

heading('Brandets personlighed', level=2, size=13, space_before=14)
traits = [
    ('Nærværende', 'Vi taler som en ven der forstår hverdagen — ikke som et firma der sælger noget.'),
    ('Direkte',    'Korte sætninger. Ingen fyld. Vi kommer hurtigt til sagen og respekterer læserens tid.'),
    ('Dansk',      'Vi skriver dansk — ikke oversat engelsk. Ord som "hverdag", "husstand" og "overblik" er vores.'),
    ('Ærlig',      'Vi lover kun det vi kan holde. Ingen superlativer som "verdens bedste" eller "unikke løsning".'),
]
for trait, desc in traits:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after  = Pt(2)
    r1 = p.add_run(f'{trait}:  ')
    r1.bold = True
    r1.font.color.rgb = RGBColor(0x7B, 0x3F, 0xE4)
    r2 = p.add_run(desc)
    r2.font.size = Pt(11)

heading('Gør og gør ikke', level=2, size=13, space_before=14)
voice_tbl = doc.add_table(rows=5, cols=2)
voice_tbl.style = 'Table Grid'
do_head = voice_tbl.rows[0].cells[0]
do_head.text = '✓  Sig dette'
do_head.paragraphs[0].runs[0].bold = True
do_head.paragraphs[0].runs[0].font.color.rgb = RGBColor(0x10, 0xB9, 0x81)
dont_head = voice_tbl.rows[0].cells[1]
dont_head.text = '✕  Undgå dette'
dont_head.paragraphs[0].runs[0].bold = True
dont_head.paragraphs[0].runs[0].font.color.rgb = RGBColor(0xEF, 0x30, 0x30)

voice_pairs = [
    ('"Slip for hverdagskaoset — alt samlet ét sted."',
     '"En avanceret platform til effektiv familiekoordinering."'),
    ('"Prøv gratis i 14 dage — ingen binding."',
     '"Oplev vores unikke og innovative familieløsning i dag!"'),
    ('"Hvem henter i dag? Det ved alle nu."',
     '"Vores AI-drevne system optimerer din families workflow."'),
    ('"39 kr/md. Op til 7 personer."',
     '"Til en overkommelig månedlig pris kan hele din husstand..."'),
]
for i, (do, dont) in enumerate(voice_pairs):
    row = voice_tbl.rows[i+1]
    row.cells[0].text = do
    row.cells[0].paragraphs[0].runs[0].font.size = Pt(10)
    row.cells[0].paragraphs[0].runs[0].italic = True
    row.cells[1].text = dont
    row.cells[1].paragraphs[0].runs[0].font.size = Pt(10)
    row.cells[1].paragraphs[0].runs[0].italic = True

doc.add_page_break()

# ══════════════════════════════════════════
#  05 — DESIGN ELEMENTER
# ══════════════════════════════════════════
label('05 — Design elementer')
heading('Hjørneradius & skygger', level=1, color='1C1C1E')
body('Vi bruger bløde, afrundede hjørner og subtile lilla-tonede skygger for at skabe et moderne og venligt udtryk.')

heading('Hjørneradius-system', level=2, size=13, space_before=14)
radius_tbl = doc.add_table(rows=5, cols=3)
radius_tbl.style = 'Table Grid'
for i, h in enumerate(['Størrelse', 'Værdi', 'Bruges til']):
    radius_tbl.rows[0].cells[i].text = h
    radius_tbl.rows[0].cells[i].paragraphs[0].runs[0].bold = True
    radius_tbl.rows[0].cells[i].paragraphs[0].runs[0].font.color.rgb = RGBColor(0x7B, 0x3F, 0xE4)
radii = [
    ('XS', 'border-radius: 4px',  'Badges, små tags'),
    ('S',  'border-radius: 8px',  'Knapper, input-felter'),
    ('M',  'border-radius: 16px', 'Kort, modaler, feature-bokse'),
    ('L',  'border-radius: 24px', 'Store sektioner, hero-elementer'),
]
for i, (sz, val, use) in enumerate(radii):
    radius_tbl.rows[i+1].cells[0].text = sz
    radius_tbl.rows[i+1].cells[0].paragraphs[0].runs[0].bold = True
    radius_tbl.rows[i+1].cells[1].text = val
    radius_tbl.rows[i+1].cells[1].paragraphs[0].runs[0].font.name = 'Courier New'
    radius_tbl.rows[i+1].cells[1].paragraphs[0].runs[0].font.size = Pt(10)
    radius_tbl.rows[i+1].cells[2].text = use
    radius_tbl.rows[i+1].cells[2].paragraphs[0].runs[0].font.size = Pt(10)

heading('Skygge-system', level=2, size=13, space_before=14)
shadow_tbl = doc.add_table(rows=4, cols=3)
shadow_tbl.style = 'Table Grid'
for i, h in enumerate(['Navn', 'CSS-værdi', 'Bruges til']):
    shadow_tbl.rows[0].cells[i].text = h
    shadow_tbl.rows[0].cells[i].paragraphs[0].runs[0].bold = True
    shadow_tbl.rows[0].cells[i].paragraphs[0].runs[0].font.color.rgb = RGBColor(0x7B, 0x3F, 0xE4)
shadows = [
    ('Subtil', '0 2px 8px rgba(0,0,0,0.06)',           'Kort, informationsbokse'),
    ('Primær', '0 8px 30px rgba(108,71,255,0.12)',      'Feature-kort, navigations-elementer'),
    ('CTA',    '0 20px 60px rgba(108,71,255,0.35)',     'Call-to-action knapper, fremhævede elementer'),
]
for i, (name, val, use) in enumerate(shadows):
    shadow_tbl.rows[i+1].cells[0].text = name
    shadow_tbl.rows[i+1].cells[0].paragraphs[0].runs[0].bold = True
    shadow_tbl.rows[i+1].cells[1].text = val
    shadow_tbl.rows[i+1].cells[1].paragraphs[0].runs[0].font.name = 'Courier New'
    shadow_tbl.rows[i+1].cells[1].paragraphs[0].runs[0].font.size = Pt(9)
    shadow_tbl.rows[i+1].cells[2].text = use
    shadow_tbl.rows[i+1].cells[2].paragraphs[0].runs[0].font.size = Pt(10)

doc.add_page_break()

# ══════════════════════════════════════════
#  06 — IKONER
# ══════════════════════════════════════════
label('06 — Ikoner')
heading('Ikon-system', level=1, color='1C1C1E')
body('Vi bruger udelukkende linje-ikoner fra Heroicons eller Lucide React. Stroke-width er altid 2px. Vi bruger aldrig emojis som ikoner i UI eller marketing-materiale.')

heading('Primære feature-ikoner', level=2, size=13, space_before=14)
icon_tbl = doc.add_table(rows=5, cols=3)
icon_tbl.style = 'Table Grid'
for i, h in enumerate(['Feature', 'Farve', 'HEX']):
    icon_tbl.rows[0].cells[i].text = h
    icon_tbl.rows[0].cells[i].paragraphs[0].runs[0].bold = True
    icon_tbl.rows[0].cells[i].paragraphs[0].runs[0].font.color.rgb = RGBColor(0x7B, 0x3F, 0xE4)
icons = [
    ('Kalender',     'Lilla',   '#6C47FF'),
    ('Madplan',      'Orange',  '#F97316'),
    ('Indkøbsliste', 'Blå',     '#3B82F6'),
    ('Opgaver',      'Grøn',    '#10B981'),
]
for i, (feat, color, hex_c) in enumerate(icons):
    icon_tbl.rows[i+1].cells[0].text = feat
    icon_tbl.rows[i+1].cells[0].paragraphs[0].runs[0].bold = True
    icon_tbl.rows[i+1].cells[1].text = color
    icon_tbl.rows[i+1].cells[1].paragraphs[0].runs[0].font.size = Pt(10)
    icon_tbl.rows[i+1].cells[2].text = hex_c
    icon_tbl.rows[i+1].cells[2].paragraphs[0].runs[0].font.name = 'Courier New'
    icon_tbl.rows[i+1].cells[2].paragraphs[0].runs[0].font.size = Pt(10)

heading('Regler for ikoner', level=2, size=13, space_before=14)
icon_rules = [
    'Stroke-width: altid 2px — aldrig filled ikoner',
    'Størrelse: minimum 16px, typisk 20–24px i UI',
    'Brug Heroicons (heroicons.com) eller Lucide (lucide.dev)',
    'Ikoner bruges altid med en tekstlabel — aldrig ikon-only i navigation',
    'Emojis bruges ikke som UI-ikoner',
]
for rule in icon_rules:
    p = doc.add_paragraph(rule, style='List Bullet')
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after  = Pt(2)
    p.runs[0].font.size = Pt(11)

# ══════════════════════════════════════════
#  AFSLUTNING
# ══════════════════════════════════════════
doc.add_page_break()
p_end = doc.add_paragraph()
p_end.alignment = WD_ALIGN_PARAGRAPH.CENTER
p_end.paragraph_format.space_before = Pt(60)
r_end = p_end.add_run('Vores Hjem')
r_end.bold = True
r_end.font.size = Pt(24)
r_end.font.color.rgb = RGBColor(0x7B, 0x3F, 0xE4)

p_end2 = doc.add_paragraph()
p_end2.alignment = WD_ALIGN_PARAGRAPH.CENTER
r_end2 = p_end2.add_run('Brand Guideline v1.0  ·  © 2026 Vores Hjem I/S  ·  CVR 45804445')
r_end2.font.size = Pt(9)
r_end2.font.color.rgb = RGBColor(0xC5, 0xC3, 0xD6)

p_end3 = doc.add_paragraph()
p_end3.alignment = WD_ALIGN_PARAGRAPH.CENTER
r_end3 = p_end3.add_run('voreshjem.dk')
r_end3.font.size = Pt(10)
r_end3.font.color.rgb = RGBColor(0x7B, 0x3F, 0xE4)

# Gem
output = '/Users/nickoskovgaard/voreshjem-site/VoresHjem_BrandGuideline.docx'
doc.save(output)
print(f'Gemt: {output}')
