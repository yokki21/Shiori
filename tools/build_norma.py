# Series y tomos de Norma Editorial para el catálogo (lo llama build_panini.py antes de escribir catalog.json).
#
# Entrada: tools/norma_raw.json = {ruta: {t, au, d, isbn, pg, p, img, bc, g}} sacado de los datos estructurados
# de las fichas de normaeditorial.com. La ruta es la de la ficha sin /ficha/ ("manga/keroro/keroro-31"):
# categoría (manga, comic-americano, comic-europeo), serie si la tiene y tomo. bc es la miga de pan
# ("Manga > KERORO") y d la fecha ISO.
import html, json, os, re

from build_common import assemble, ean_ok

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'norma_raw.json')
PUBLISHER = 'Norma Editorial'
IMG = 'https://www.normaeditorial.com/upload/media/albumes/'
KIND = {'manga': ('Manga', 'manga'), 'comic-americano': ('Otros', 'americano'), 'comic-europeo': ('Otros', 'europeo')}
# "KERORO 31", "MINECRAFT 9 (CATALÀ)", "BLACKSAD 7. TODO CAE (PRIMERA PARTE)"
NUM_RE = re.compile(r'^(.*?\S)\s+(\d{1,4})(\s*\([^)]*\))?$')
# "LOS PITUFOS 31. LOS PITUFOS DEL ORDEN", "HELLBOY 15: LA NOVIA DEL INFIERNO" (solo en fichas de una serie)
SUB_RE = re.compile(r'^(.*?\S)\s+(\d{1,4})\s*[.:]\s+\S.*$')


def build(key, nice, isbn_used, taken_names):
    if not os.path.exists(RAW):
        return [], []
    raw = json.load(open(RAW))
    recs = []
    for path, r in sorted(raw.items()):
        parts = path.split('/')
        if parts[0] not in KIND or not r.get('t'):
            continue
        t = html_fix(r['t'])
        core = [c for c in re.sub(r'\([^)]*\)', '', t) if c.isalpha()]
        if core and sum(c.isupper() for c in core) / len(core) >= 0.8:
            t = t.upper()   # "CHOBITS (Ed. Integral)": todo en mayúsculas salvo el añadido
        t = nice(t)
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
        sub = None if m or len(parts) < 3 else SUB_RE.match(t)
        if m or sub:
            p['n'] = int((m or sub).group(2))
            p['base'] = re.sub(r'[\s.,]+vol\.?$', '', ((m.group(1) + (m.group(3) or '')) if m else sub.group(1)), flags=re.I).strip(' ,.-:')
            # Serie según la miga de pan de la web ("Cómic Americano > HELLBOY > HELLBOY CARTONÉ"); a veces junta
            # varias ediciones ("Berserk" y "Berserk Maximum"), así que se separan además por el título
            crumbs = [c.strip() for c in (r.get('bc') or '').split('>')]
            crumb = html_fix(crumbs[-1]) if len(crumbs) >= 2 else p['base']
            if len(crumbs) >= 2 and key(crumb).startswith(key(p['base']) + ' '):
                p['base'] = nice(crumb)   # "Solo Leveling 1. (Novela)" va con «Solo Leveling (Novela)»
            p['gk'] = key(crumb) + '|' + key(p['base'])
            p['gname'] = nice(crumb) if key(crumb) != key(p['base']) else p['base']
        recs.append(p)
    return assemble(recs, PUBLISHER, key, isbn_used, taken_names)


def html_fix(s):
    return re.sub(r'\s+', ' ', html.unescape(html.unescape(s)).replace('’', "'")).strip()
