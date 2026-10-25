# Series y tomos de Norma Editorial para el catálogo (lo llama build_panini.py antes de escribir catalog.json).
#
# Entrada: tools/norma_raw.json = {ruta: {t, au, d, isbn, pg, p, img, bc, g}} sacado de los datos estructurados
# de las fichas de normaeditorial.com. La ruta es la de la ficha sin /ficha/ ("manga/keroro/keroro-31"):
# categoría (manga, comic-americano, comic-europeo), serie si la tiene y tomo. bc es la miga de pan
# ("Manga > KERORO") y d la fecha ISO.
import json, os, re

from build_common import assemble, ean_ok

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'norma_raw.json')
PUBLISHER = 'Norma Editorial'
IMG = 'https://www.normaeditorial.com/upload/media/albumes/'
KIND = {'manga': ('Manga', 'manga'), 'comic-americano': ('Otros', 'americano'), 'comic-europeo': ('Otros', 'europeo')}
# "KERORO 31", "MINECRAFT 9 (CATALÀ)", "BLACKSAD 7. TODO CAE (PRIMERA PARTE)"
NUM_RE = re.compile(r'^(.*?\S)\s+(\d{1,4})(\s*\([^)]*\))?$')


def build(key, nice, isbn_used, taken_names):
    if not os.path.exists(RAW):
        return [], []
    raw = json.load(open(RAW))
    recs = []
    for path, r in sorted(raw.items()):
        parts = path.split('/')
        if parts[0] not in KIND or not r.get('t'):
            continue
        t = nice(html_fix(r['t']))
        isbn = r.get('isbn') if ean_ok(r.get('isbn')) else None
        img = r.get('img') or ''
        p = {
            'title': t,
            'cover': ('nm:' + img[len(IMG):]) if img.startswith(IMG) else (img or None),
            'price': r.get('p') or None,
            'date': (r.get('d') or '')[:10] if re.match(r'^\d{4}-\d{2}-\d{2}', r.get('d') or '') else '',
            'pages': r.get('pg') or None,
            'authors': (r.get('au') or '')[:120] or None,
            'isbn': isbn,
        }
        p['line'], p['type'] = KIND[parts[0]]
        m = NUM_RE.match(t)
        if m:
            p['n'] = int(m.group(2))
            p['base'] = (m.group(1) + (m.group(3) or '')).strip(' ,.-:')
            # la serie de la web junta a veces varias ediciones ("Berserk" y "Berserk Maximum"): se separan por título
            p['gk'] = (parts[-2] if len(parts) >= 3 else '') + '|' + key(p['base'])
            p['gname'] = p['base']
        recs.append(p)
    return assemble(recs, PUBLISHER, key, isbn_used, taken_names)


def html_fix(s):
    return re.sub(r'\s+', ' ', s.replace('’', "'")).strip()
