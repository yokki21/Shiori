# Genera catalog/catalog.json a partir del recorrido del catálogo de Panini España (Marvel y DC).
# Uso: python3 tools/build_panini.py tools/panini_raw.json
#
# Entrada: {"keys": [...], "rows": [[...], ...]} con un producto por fila:
#   sku, slug, title, price, date (dd/mm/aa), cat (marvel|dc), img (ruta de la portada), code (EAN de la imagen),
#   addon (suplemento), listed (a la venta), y lo de la ficha: ptitle, pdate ("3 dic 2020"), pages, authors, pprice, pcode,
#   pissn (campo ISSN de las grapas: EAN 977 + suplemento)
#
# Salida (versión 2):
#   series: [{name, publisher, type, ean?, issn?, issues: {"n": {title?, cover, price?, date?, isbn?, pages?, authors?}}}]
#   extras: [{title, cover, price?, date?, isbn?, ...}]    (tomos únicos, sin número)
#   img / imgq: prefijo y parámetros de las portadas (cover es la ruta relativa)
import html, json, os, re, sys, unicodedata
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'panini_raw.json')
raw = json.load(open(src))
K = raw['keys']
rows = [dict(zip(K, r)) for r in raw['rows']]

MONTHS = {'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'ago': 8, 'sep': 9, 'sept': 9, 'oct': 10, 'nov': 11, 'dic': 12}


def iso(d, pd):
    if d and re.match(r'^\d{2}/\d{2}/\d{2,4}$', d):
        dd, mm, yy = d.split('/')
        return f"{'20' + yy if len(yy) == 2 else yy}-{mm}-{dd}"
    m = re.match(r'^(\d{1,2}) ([a-z]+)\.? (\d{4})$', (pd or '').strip().lower())
    if m and m.group(2) in MONTHS:
        return f"{m.group(3)}-{MONTHS[m.group(2)]:02d}-{int(m.group(1)):02d}"
    return ''


def fold(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s or '') if unicodedata.category(c) != 'Mn').lower()


def key(s):
    return re.sub(r'[^a-z0-9]+', ' ', fold(s)).strip()


def issn_from_ean(ean):
    s = ean[3:10]
    t = sum(int(c) * (8 - i) for i, c in enumerate(s))
    c = (11 - t % 11) % 11
    return f"{s[:4]}-{s[4:]}{'X' if c == 10 else c}"


def ean_ok(code):
    if not code or not re.match(r'^\d{13}$', code):
        return False
    s = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(code[:12]))
    return (10 - s % 10) % 10 == int(code[12])


SMALL = {'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a', 'al', 'o', 'u', 'por', 'con', 'para', 'sin', 'un', 'una', 'vs', 'vs.'}
KEEP_UP = {'X', 'DC', 'HC', 'TPB', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'SHIELD', 'S.H.I.E.L.D.', 'AIM', 'HYDRA', 'USA', 'IA', 'JLA', 'JSA', 'MCU', 'G.I.', 'GI', 'ROM'}


def nice(s):
    """Pasa a minúsculas los títulos antiguos que vienen en mayúsculas."""
    s = re.sub(r'\s+', ' ', s or '').strip()
    s = re.sub(r'(?<=[a-záéíóúñ0-9])\.(?=[A-ZÁÉÍÓÚÑa-záéíóúñ]{3})', '. ', s, flags=re.I)   # "1.PRIMER" -> "1. PRIMER"
    letters = [c for c in s if c.isalpha()]
    if not letters or sum(c.isupper() for c in letters) / len(letters) < 0.8:
        return s
    out = []
    for i, w in enumerate(s.split(' ')):
        parts = []
        for p in re.split(r'(-)', w):
            core = re.sub(r'[^\w.]', '', p)
            if core.upper() in KEEP_UP or re.fullmatch(r'(?:[A-ZÁÉÍÓÚÑ]\.)+[A-ZÁÉÍÓÚÑ]\.?', core):
                parts.append(p)
            elif i > 0 and p.lower() in SMALL:
                parts.append(p.lower())
            else:
                parts.append(p[:1].upper() + p[1:].lower() if p else p)
        out.append(''.join(parts))
    s = ' '.join(out)
    return re.sub(r'(?<=[.:¡¿] )([a-záéíóúñ])', lambda m: m.group(1).upper(), s)


def clean(s):
    return re.sub(r'[\s,.:;\-–(]+$', '', re.sub(r'\s+', ' ', s or '')).strip()


# ---------- Datos de cada producto ----------
products = []
for r in rows:
    sku = r['sku'] or ''
    # El título de la ficha suele estar más limpio que el del listado ("Capitán América v8 3" frente a "CAP.AMERICA VOL.8 N.3")
    title = ''
    for t in ((r.get('ptitle') or '').strip(), (r.get('title') or '').strip()):
        t = html.unescape(t)
        if t and t.upper() != sku.upper():
            title = t
            break
    if not title:
        continue
    code = r.get('code') if ean_ok(r.get('code')) else None
    pcode = r.get('pcode') if ean_ok(r.get('pcode')) else None
    code = code or pcode
    addon = r.get('addon')
    # Grapas: la ficha trae el campo ISSN con el EAN 977 y el suplemento seguidos ("977293855500600005")
    pissn = re.sub(r'\D', '', r.get('pissn') or '')
    if not code and len(pissn) in (15, 18) and ean_ok(pissn[:13]):
        code, addon = pissn[:13], pissn[13:]
    price = r.get('price') or r.get('pprice') or None
    p = {
        'sku': sku, 'title': re.sub(r'\s+', ' ', title), 'cover': r.get('img') or None,
        'price': round(float(price), 2) if price else None,
        'date': iso(r.get('date'), r.get('pdate')), 'code': code, 'addon': addon,
        'listed': bool(r.get('listed')), 'cat': r.get('cat'),
        'pages': r.get('pages') or None, 'authors': html.unescape(r.get('authors') or '').strip() or None,
        'prefix': re.match(r'^([a-z]+)', sku.lower()).group(1) if re.match(r'^[a-z]+', sku.lower()) else sku,
        'variant': bool(re.search(r'\d[a-z]+$', sku.lower())),
    }
    m = re.search(r'(\d+)[a-z]*$', sku)
    p['skunum'] = int(m.group(1)) if m else None
    products.append(p)

# ---------- Grapas (ISSN): serie por ISSN y número por el suplemento ----------
GRAPA_NUM = re.compile(r'^(.*?)[\s.,:-]*(?:n\s?[.º°]\s?|nº\s?|núm\.?\s?|#)\s*0*(\d{1,4})\b(.*)$', re.I)
OF_NUM = re.compile(r'^(.*\S)\s+0*(\d{1,3})\s*(?:/|de)\s*\d{1,3}$')                      # "Patrulla-X Verde 1 de 2"
TRAIL_NUM = re.compile(r'^(.*(?:\D|\bv\d{1,2}))\s0*(\d{1,4})$')                               # "Thor 5", "Capitán América v8 3"


VARIANT = re.compile(r'\s*\([^()]*\)\s*$')   # "(Portada alternativa)", "(2ª edición)", "(RED BAND)": no cuentan para la serie


def grapa_parse(t):
    t = VARIANT.sub('', t)
    m = GRAPA_NUM.match(t)
    if m and m.group(1).strip():
        return clean(m.group(1)), int(m.group(2))
    m = OF_NUM.match(t) or TRAIL_NUM.match(t)
    if m:
        return clean(m.group(1)), int(m.group(2))
    return clean(t), None


def addon_num(addon):
    if not addon:
        return None
    n = int(addon)
    if len(addon) == 5 and n >= 1000:
        n = int(addon[:3])
    return n or None


series = {}   # clave -> serie


def get_series(name, k=None):
    k = k or key(name)
    s = series.get(k)
    if not s:
        s = series[k] = {'name': name, 'names': Counter(), 'issues': {}, 'ean': None, 'issn': None, 'cats': Counter()}
    return s


losers = []   # ediciones repetidas de un mismo número: se guardan aparte para que su ISBN se reconozca


def put_issue(s, n, p, isbn=None, issn=None, addon=None):
    """Guarda el número n en la serie; el original manda sobre las variantes y lo que tiene código sobre lo que no."""
    old = s['issues'].get(n)
    rank = lambda q: (0 if q['variant'] else 1, 1 if q.get('code') else 0, 1 if q['listed'] else 0, q['date'] or '')
    if old and rank(old['_p']) >= rank(p):
        losers.append((s, n, p, isbn))
        return False
    if old:
        losers.append((s, n, old['_p'], old['isbn']))
    s['issues'][n] = {'_p': p, 'isbn': isbn, 'issn': issn, 'addon': addon}
    s['cats'][p['cat']] += 1
    return True


def segments(items):
    """items: [(p, n)] -> listas por volumen, en orden de referencia (un volumen termina cuando la numeración vuelve atrás)."""
    items = sorted(items, key=lambda x: (x[0]['skunum'] or 0, x[0]['sku']))
    out, last = [[]], None
    for p, n in items:
        if last is not None and n <= last and not p['variant']:
            out.append([])
        out[-1].append((p, n))
        if not p['variant']:
            last = n
    return out


# Panini numera el suplemento por colección ISSN, no por serie: una ISSN puede seguir de un volumen
# a otro ("Capitán América 4" lleva el 00021) o agrupar varias miniseries. Por eso las grapas se
# agrupan por serie (referencia + nombre + volumen) y cada número guarda su ISSN y su suplemento.
grapa_prefixes = {p['prefix'] for p in products if p['code'] and p['code'].startswith('977')}
used = set()
issn_extras = []   # grapas con código pero sin número en el título
groups = defaultdict(list)
for p in products:
    if p['prefix'] not in grapa_prefixes or (p['code'] and not p['code'].startswith('977')):
        continue
    nm, tn = grapa_parse(p['title'])
    if tn is None:
        if p['code']:
            issn_extras.append(p)
            used.add(id(p))
        continue
    groups[(p['prefix'], key(nm))].append((p, tn, nm))

for (prefix, k), items in groups.items():
    names = {id(p): nm for p, _, nm in items}
    for vol, seg in enumerate(segments([(p, n) for p, n, _ in items])):
        coded = [(p, n) for p, n in seg if p['code']]
        s = get_series(names[id(seg[0][0])], f'g|{prefix}|{k}|{vol}')
        for p, n in seg:
            s['names'][names[id(p)]] += 2 if p['listed'] else 1
        offsets, issns = Counter(), Counter()
        for p, n in coded:
            issns[issn_from_ean(p['code'])] += 1
            an = addon_num(p['addon'])
            if an is None:
                continue
            if len(p['addon']) == 2:
                offsets[0 if an == n % 100 else None] += 1
            else:
                offsets[an - n] += 1
        if issns:
            s['issn'] = issns.most_common(1)[0][0]
            s['ean'] = Counter(p['code'] for p, _ in coded if issn_from_ean(p['code']) == s['issn']).most_common(1)[0][0]
        off = offsets.most_common(1)[0][0] if offsets else 0
        for p, n in seg:
            issn = issn_from_ean(p['code']) if p['code'] else s['issn']
            an = addon_num(p['addon']) if p['code'] and p['addon'] and len(p['addon']) == 5 else None
            if an is None and issn and off is not None:
                an = n + off
            put_issue(s, n, p, issn=issn, addon=an)
            used.add(id(p))

# ---------- Tomos y el resto: serie y número a partir del título ----------
LINE_NUM = re.compile(r'^(.+?\D)\s0*(\d{1,3})\.\s+\S')                 # "Biblioteca Marvel 2. El Increíble Hulk 1"
NUM_RE = re.compile(r'^(.*?)[\s,.:;\-–(]*(?:n\.?\s?[ºo°]\.?|nº|núm\.?|num\.?|número|vol\.?|volumen|tomo|#)\s*0*(\d{1,4})(?:\s*(?:/|de)\s*0*(\d{1,4}))?\)?(.*)$', re.I)


def tomo_parse(p):
    t = VARIANT.sub('', p['title'])
    m = LINE_NUM.match(t)
    if m and p['skunum'] is not None and int(m.group(2)) == p['skunum'] % 1000:
        return clean(m.group(1)), int(m.group(2))       # colección numerada: cuenta el número de la colección
    m = OF_NUM.match(t) or TRAIL_NUM.match(t)
    if m and int(m.group(2)) < 1000:
        return clean(m.group(1)), int(m.group(2))
    m = re.match(r'^(.*?\D)\s0*(\d{1,3})\s*[.,:]\s+\S', t)
    if m:
        return clean(m.group(1)), int(m.group(2))
    m = NUM_RE.match(t)
    if m and m.group(1).strip() and not re.match(r'^\s*\d', m.group(4) or ''):
        return clean(m.group(1)), int(m.group(2))
    m = GRAPA_NUM.match(t)
    if m and m.group(1).strip():
        return clean(m.group(1)), int(m.group(2))
    return None, None


extras = []
isbn_of = lambda p: p['code'] if p['code'] and p['code'][:3] in ('978', '979') else None

# Colecciones de tomos sin número impreso: cada título es una entrega de la colección, en orden de salida
LINES = {'smust': 'Marvel Must-Have', 'smusd': 'DC Must-Have', 'sesse': 'Marvel Essentials'}
for prefix, line in LINES.items():
    # Cada título es una entrega; las reediciones (smust012x, smust012y…) cuentan como la misma
    entries = {}
    for p in sorted((p for p in products if p['prefix'] == prefix and id(p) not in used), key=lambda p: (p['skunum'] or 0, p['sku'])):
        if re.match(r'pack\b', p['title'], re.I):
            continue
        k = ' '.join(w for w in key(VARIANT.sub('', p['title'])).split() if w not in {'el', 'la', 'los', 'las', 'al', 'del', 'de', 'y'})
        entries.setdefault(k, []).append(p)   # «Masacre mata al/el Universo Marvel» es el mismo tomo
    s = get_series(line, 'line|' + prefix)
    s['names'][line] += 1
    s['unnumbered'] = True
    for n, ps in enumerate(entries.values(), 1):
        for p in ps:
            put_issue(s, n, p, isbn_of(p))
            used.add(id(p))

loose = defaultdict(list)   # grapas antiguas sin código, por referencia y nombre
for p in sorted(products, key=lambda p: 0 if isbn_of(p) else 1):   # primero los que tienen ISBN
    if id(p) in used:
        continue
    isbn = isbn_of(p)
    name, n = tomo_parse(p)
    if name and len(key(name)) >= 3 and n is not None and n < 1000:
        # Tomos con ISBN: la serie es el título (una colección puede tener varias referencias).
        # Sin código: se une a la serie de tomos con ese nombre si existe (y no es de grapas)
        if isbn or (key(name) in series and p['prefix'] not in grapa_prefixes):
            s = get_series(name)
            s['names'][name] += 2 if p['listed'] else 1
            put_issue(s, n, p, isbn)
        else:
            loose[(p['prefix'], key(name))].append((p, name, n))
        continue
    extras.append((p, isbn))

# Las grapas sin código se separan en volúmenes: empieza uno nuevo cuando la numeración vuelve atrás
for (prefix, k), items in loose.items():
    names = {id(p): name for p, name, _ in items}
    for vol, seg in enumerate(segments([(p, n) for p, _, n in items])):
        for p, n in seg:
            s = get_series(names[id(p)], f'{prefix}|{k}|{vol}')
            s['names'][names[id(p)]] += 1
            put_issue(s, n, p)

# ---------- Salida ----------
LINE = {'marvel': 'Marvel', 'dc': 'DC', 'manga': 'Manga', 'otros': 'Otros'}   # línea de Panini (filtro de Novedades)
TYPE = {'manga': 'manga'}
def issue_out(sname, n, p, isbn):
    o = {}
    if p['title'] != f'{sname} {n}':
        o['title'] = nice(p['title'])
    if p['cover']:
        o['cover'] = p['cover']
    if p['price']:
        o['price'] = p['price']
    if p['date']:
        o['date'] = p['date']
    if isbn:
        o['isbn'] = isbn
    if p['pages']:
        o['pages'] = p['pages']
    if p['authors']:
        o['authors'] = p['authors'][:120]
    return o


out_series = []
isbn_used = set()   # Panini repite a veces un ISBN en dos fichas: se queda en la primera
for s in series.values():
    if not s['issues']:
        continue
    if s['names']:
        s['name'] = nice(sorted(s['names'].items(), key=lambda kv: (-kv[1], kv[0].isupper()))[0][0])
    # Una serie de un solo número sin ISSN es en realidad un tomo suelto
    if len(s['issues']) == 1 and not s['issn']:
        (n, it), = s['issues'].items()
        extras.append((it['_p'], it['isbn']))
        continue
    cat = s['cats'].most_common(1)[0][0]
    o = {'name': s['name'], 'publisher': 'Panini', 'type': TYPE.get(cat, 'americano'), 'line': LINE.get(cat, 'Otros')}
    if s['issn']:
        o['issn'], o['ean'] = s['issn'], s['ean']
    if s.get('unnumbered'):
        o['unnumbered'] = True   # colección sin número impreso: se muestra el título de cada tomo
    o['issues'] = {}
    for n, it in sorted(s['issues'].items()):
        isbn = it['isbn'] if it['isbn'] not in isbn_used else None
        if isbn:
            isbn_used.add(isbn)
        io = issue_out(s['name'], n, it['_p'], isbn)
        if it.get('issn') and it['issn'] != s['issn']:
            io['issn'] = it['issn']
        if it.get('addon') is not None and it['addon'] != n:
            io['a'] = it['addon']
        if it['_p'].get('code'):
            io['_coded'] = True
        o['issues'][str(n)] = io
    out_series.append(o)

# Un suplemento de una colección ISSN es un solo cómic: si un suplemento deducido choca con otro,
# gana el que trae el código de verdad (o el primero) y el deducido se queda sin él
taken = {}
for s in sorted(out_series, key=lambda s: 0 if any(i.get('_coded') for i in s['issues'].values()) else 1):
    for n, io in s['issues'].items():
        issn = io.get('issn') or s.get('issn')
        if not issn:
            continue
        k = (issn, io.get('a', int(n)))
        if k in taken:
            io.pop('a', None)
            io['a'] = None   # sin suplemento: no se reconoce al escanear, pero sigue en la serie
        else:
            taken[k] = True
for s in out_series:
    for io in s['issues'].values():
        io.pop('_coded', None)
        if 'a' in io and io['a'] is None:
            del io['a']
            io['noa'] = True

# Series con el mismo nombre visible: la más reciente se queda el nombre y las demás llevan su año
groups = defaultdict(list)
for s in out_series:
    groups[key(s['name'])].append(s)
for g in groups.values():
    if len(g) < 2:
        continue
    dates = lambda s: [i['date'] for i in s['issues'].values() if i.get('date')]
    g.sort(key=lambda s: ('issn' in s, max(dates(s) or [''])), reverse=True)   # las grapas con ISSN primero
    years = Counter(min(dates(s) or [''])[:4] for s in g[1:])
    for s in g[1:]:
        y = min(dates(s) or [''])[:4]
        suf = y if y and years[y] == 1 else (f"{y}, " if y else '') + (s.get('issn') or f"{len(s['issues'])} nº")
        s['name'] = f"{s['name']} ({suf})"

# Números encontrados en otras fuentes
manual = os.path.join(HERE, 'panini_manual.json')
if os.path.exists(manual):
    by_issn = {s['issn']: s for s in out_series if s.get('issn')}
    for m in json.load(open(manual))['issues']:
        s = by_issn.get(m['issn'])
        if s and str(m['n']) not in s['issues']:
            s['issues'][str(m['n'])] = {k: v for k, v in m.items() if k not in ('issn', 'n')}
            s['issues'] = dict(sorted(s['issues'].items(), key=lambda kv: int(kv[0])))

out_series.sort(key=lambda s: key(s['name']))
issue_isbn = {i['isbn'] for s in out_series for i in s['issues'].values() if 'isbn' in i}
seen_isbn = set(issue_isbn)
extra_isbn = set()
extra_ref = {}
for s0, n, p, isbn in losers:
    if not isbn or isbn in seen_isbn:
        continue
    seen_isbn.add(isbn)
    if len(s0['issues']) > 1 or s0['issn']:
        extra_ref[id(p)] = (s0['name'], n)
    extras.append((p, isbn))
out_extras = []
for p, isbn in sorted(extras, key=lambda e: key(e[0]['title'])):
    if isbn and id(p) not in extra_ref:
        if isbn in issue_isbn or isbn in extra_isbn:
            continue
        extra_isbn.add(isbn)
    o = {'title': nice(p['title'])}
    if id(p) in extra_ref:
        o['series'], o['number'] = extra_ref[id(p)]
    o.update({k: v for k, v in issue_out('', -1, p, isbn).items() if k != 'title'})
    o['line'] = LINE.get(p['cat'], 'Otros')
    if TYPE.get(p['cat']) == 'manga':
        o['type'] = 'manga'
    out_extras.append(o)
for p in issn_extras:   # grapas con código y sin número en el título (especiales de una colección)
    o = {'title': nice(p['title']), 'issn': issn_from_ean(p['code'])}
    an = addon_num(p['addon']) if p['addon'] and len(p['addon']) == 5 else None
    if an is not None:
        o['a'] = an
    o.update({k: v for k, v in issue_out('', -1, p, None).items() if k != 'title'})
    o['line'] = LINE.get(p['cat'], 'Otros')
    if TYPE.get(p['cat']) == 'manga':
        o['type'] = 'manga'
    out_extras.append(o)

# Otras editoriales (sus ISBN repetidos con Panini se quedan en Panini)
import build_planeta
used = {i['isbn'] for s in out_series for i in s['issues'].values() if 'isbn' in i} | {e['isbn'] for e in out_extras if 'isbn' in e}
names = {key(s['name']) for s in out_series}
pl_series, pl_extras = build_planeta.build(key, used, names)
out_series = sorted(out_series + pl_series, key=lambda s: key(s['name']))
out_extras += pl_extras

out = {
    'version': 2,
    'updated': __import__('datetime').date.today().isoformat(),
    'source': 'Catálogos de Panini España (panini.es) y Planeta Cómic (planetadelibros.com)',
    'img': 'https://www.panini.es/media/catalog/product/',
    'imgq': '?quality=80&fit=bounds&height=480&width=320',
    'imgs': {'pl': build_planeta.IMG},   # portadas de otras editoriales: "pl:ruta"
    'series': out_series,
    'extras': out_extras,
}
dst = os.path.join(HERE, '..', 'catalog', 'catalog.json')
json.dump(out, open(dst, 'w'), ensure_ascii=False, separators=(',', ':'))

n_issues = sum(len(s['issues']) for s in out_series)
n_isbn = sum(1 for s in out_series for i in s['issues'].values() if 'isbn' in i) + sum(1 for e in out_extras if 'isbn' in e)
print(f"{len(out_series)} series ({sum(1 for s in out_series if 'issn' in s)} con ISSN), {n_issues} números, "
      f"{len(out_extras)} sueltos, {n_isbn} con ISBN, {os.path.getsize(dst) // 1024} KB", file=sys.stderr)
