# Series y tomos de Planeta Cómic para el catálogo (lo llama build_panini.py antes de escribir catalog.json).
#
# Entrada: tools/planeta_raw.json = {id: {t, au, img, p, isbn, d, pg, serie, col, k}} sacado de las fichas de
# planetadelibros.com (t título, au autores, img portada, p precio, d "6 julio 2022", pg páginas,
# serie y col de la ficha técnica, k "manga" o "comic" según el listado del que vino).
import json, os, re
from collections import defaultdict
from build_common import assemble, ean_ok

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'planeta_raw.json')
PUBLISHER = 'Planeta Cómic'
IMG = 'https://proassets.planetadelibros.com/usuaris/libros/fotos/'
MONTHS = {m: i + 1 for i, m in enumerate(['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
                                          'septiembre', 'octubre', 'noviembre', 'diciembre'])}
# "One Piece nº 100", "Bobobo nº 19/21", "Dragon Ball Color Saiyan nº 01/03", "Akira (Edición original) nº 03/06"
NUM_RE = re.compile(r'^(.*?)\s*,?\s+(?:n[º°o]\.?|n\.|núm\.?|vol\.?|tomo)\s*(\d{1,4})(?:\s*/\s*\d{1,4})?\s*(.*)$', re.I)



def iso(d):
    m = re.match(r'^(\d{1,2}) (?:de )?([a-z]+) (?:de )?(\d{4})$', (d or '').strip().lower())
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


def cover(img, orig):
    if not img.startswith(IMG):
        return img or None
    path = img[len(IMG):]
    return 'pl:' + (path.replace('/m_libros/', '/original/') if path in orig else path)


def build(key, isbn_used, taken_names):
    """Devuelve (series, extras) con el formato de catalog.json. isbn_used y taken_names se actualizan."""
    if not os.path.exists(RAW):
        return [], []
    raw = json.load(open(RAW))
    # Portadas sin versión mediana (m_libros) en su servidor, comprobadas una a una: se usa la original
    cov = os.path.join(HERE, 'planeta_covers.json')
    orig = set(json.load(open(cov))['original']) if os.path.exists(cov) else set()
    groups = defaultdict(list)
    loose = []
    for pid, r in sorted(raw.items(), key=lambda kv: int(kv[0])):
        t = re.sub(r'\s+', ' ', r.get('t') or '').strip()
        if not t or re.match(r'^error \d{3}$', t, re.I) or not (r.get('isbn') or r.get('d')):
            continue   # página de error del servidor: se vuelve a pedir en la siguiente pasada
        p = {
            'title': t,
            'cover': cover(r.get('img') or '', orig),
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

    recs = []
    for p in loose:
        recs.append(p)
    for gk, items in groups.items():
        for p in items:
            p['gk'] = gk
            recs.append(p)
    for p in recs:
        p['line'], p['type'] = ('Manga', 'manga') if p.pop('manga') else ('Otros', 'americano')
    return assemble(recs, PUBLISHER, key, isbn_used, taken_names)
