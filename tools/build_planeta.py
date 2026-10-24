# Series y tomos de Planeta Cómic para el catálogo (lo llama build_panini.py antes de escribir catalog.json).
#
# Entrada: tools/planeta_raw.json = {id: {t, au, img, p, isbn, d, pg, serie, col, k}} sacado de las fichas de
# planetadelibros.com (t título, au autores, img portada, p precio, d "6 julio 2022", pg páginas,
# serie y col de la ficha técnica, k "manga" o "comic" según el listado del que vino).
import json, os, re
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'planeta_raw.json')
PUBLISHER = 'Planeta Cómic'
IMG = 'https://proassets.planetadelibros.com/usuaris/libros/fotos/'
MONTHS = {m: i + 1 for i, m in enumerate(['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
                                          'septiembre', 'octubre', 'noviembre', 'diciembre'])}
# "One Piece nº 100", "Bobobo nº 19/21", "Dragon Ball Color Saiyan nº 01/03", "Akira (Edición original) nº 03/06"
NUM_RE = re.compile(r'^(.*?)\s*,?\s+(?:n[º°o]\.?|n\.|núm\.?|vol\.?|tomo)\s*(\d{1,4})(?:\s*/\s*\d{1,4})?\s*(.*)$', re.I)


def ean_ok(code):
    if not code or not re.fullmatch(r'\d{13}', code):
        return False
    s = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(code[:12]))
    return (10 - s % 10) % 10 == int(code[12])


def iso(d):
    m = re.match(r'^(\d{1,2}) de? ?([a-z]+) (?:de )?(\d{4})$', (d or '').strip().lower())
    return f'{m.group(3)}-{MONTHS[m.group(2)]:02d}-{int(m.group(1)):02d}' if m and m.group(2) in MONTHS else ''


def code_of(r):
    """ISBN de la ficha; en las fichas antiguas sin ISBN, el código de barras va en el nombre de la portada."""
    c = re.sub(r'\D', '', r.get('isbn') or '')
    if ean_ok(c):
        return c
    for m in re.finditer(r'(?<!\d)(\d{13})(?!\d)', r.get('img') or ''):
        if ean_ok(m.group(1)) and m.group(1)[:2] in ('97', '84'):
            return m.group(1)
    return None


def build(key, isbn_used, taken_names):
    """Devuelve (series, extras) con el formato de catalog.json. isbn_used y taken_names se actualizan."""
    if not os.path.exists(RAW):
        return [], []
    raw = json.load(open(RAW))
    groups = defaultdict(list)
    loose = []
    for pid, r in sorted(raw.items(), key=lambda kv: int(kv[0])):
        t = re.sub(r'\s+', ' ', r.get('t') or '').strip()
        if not t or re.match(r'^error \d{3}$', t, re.I) or not (r.get('isbn') or r.get('d')):
            continue   # página de error del servidor: se vuelve a pedir en la siguiente pasada
        p = {
            'title': t,
            'cover': ('pl:' + r['img'][len(IMG):]) if (r.get('img') or '').startswith(IMG) else (r.get('img') or None),
            'price': r.get('p') or None,
            'date': iso(r.get('d')),
            'pages': r.get('pg') or None,
            'authors': (r.get('au') or '')[:120] or None,
            'isbn': code_of(r),
            'manga': r.get('k') == 'manga' or 'manga' in (r.get('col') or '').lower(),
        }
        m = NUM_RE.match(t)
        if m and m.group(1) and (not m.group(3) or (r.get('serie') or '').strip()):
            p['n'] = int(m.group(2))
            p['base'] = m.group(1).strip(' ,.-')
            groups[(r.get('serie') or '').strip() or p['base']].append(p)
        else:
            loose.append(p)

    series = []
    for gk, items in groups.items():
        by_n = {}
        for p in sorted(items, key=lambda p: (p['date'] or '9999', p['isbn'] is None)):
            if p['n'] in by_n:
                loose.append(p)   # otra edición del mismo número (reedición, catalán…)
            else:
                by_n[p['n']] = p
        if len(by_n) == 1 and not by_n.get(1):
            loose.extend(by_n.values())
            continue
        base = Counter(p['base'] for p in by_n.values()).most_common(1)[0][0]
        series.append({'gk': gk, 'base': base, 'items': by_n})

    # Nombre visible: el del título ("One Piece"); si dos series lo comparten, el de la ficha ("Detective Conan II")
    by_base = defaultdict(list)
    for s in series:
        by_base[key(s['base'])].append(s)
    for g in by_base.values():
        for s in g:
            s['name'] = s['base'] if len(g) == 1 or key(s['gk']) == key(s['base']) else s['gk']
    names = Counter(key(s['name']) for s in series)
    for s in series:
        if names[key(s['name'])] > 1 or key(s['name']) in taken_names:
            y = min((p['date'] for p in s['items'].values() if p['date']), default='')[:4]
            s['name'] = f"{s['name']} ({PUBLISHER}{', ' + y if y else ''})"
    out_series = []
    for s in sorted(series, key=lambda s: key(s['name'])):
        taken_names.add(key(s['name']))
        manga = sum(p['manga'] for p in s['items'].values()) * 2 >= len(s['items'])
        o = {'name': s['name'], 'publisher': PUBLISHER, 'type': 'manga' if manga else 'americano',
             'line': 'Manga' if manga else 'Otros', 'issues': {}}
        for n, p in sorted(s['items'].items()):
            io = {}
            if p['title'] != f"{s['name']} {n}":
                io['title'] = p['title']
            for k in ('cover', 'price', 'date'):
                if p[k]:
                    io[k] = p[k]
            if p['isbn'] and p['isbn'] not in isbn_used:
                io['isbn'] = p['isbn']
                isbn_used.add(p['isbn'])
            for k in ('pages', 'authors'):
                if p[k]:
                    io[k] = p[k]
            o['issues'][str(n)] = io
        out_series.append(o)

    out_extras = []
    for p in sorted(loose, key=lambda p: key(p['title'])):
        if p['isbn'] and p['isbn'] in isbn_used:
            continue
        o = {'title': p['title'], 'publisher': PUBLISHER}
        for k in ('cover', 'price', 'date', 'isbn', 'pages', 'authors'):
            if p[k]:
                o[k] = p[k]
        if p['isbn']:
            isbn_used.add(p['isbn'])
        o['line'] = 'Manga' if p['manga'] else 'Otros'
        o['type'] = 'manga' if p['manga'] else 'americano'
        out_extras.append(o)
    return out_series, out_extras
