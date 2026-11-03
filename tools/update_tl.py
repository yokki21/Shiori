#!/usr/bin/env python3
"""Catálogo de editoriales de manga a partir de todostuslibros.com (el catálogo de las librerías de CEGAL).

Mismo método que ECC (ver update_ecc.py): el listado de la editorial da título, ISBN (en el enlace de la ficha),
precio y, en la primera página, el mes de salida. Una petición por segundo, como pide su robots.txt.

Uso: python3 tools/update_tl.py --pub milkyway [--pages N]      (o --pub todas)
"""
import json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_ecc import BASE, get, parse   # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
# clave: (nombre en la app, enlace de la editorial en todostuslibros.com)
PUBS = {
    # manga
    'milkyway': ('Milky Way Ediciones', 'milky-way-ediciones_175001'),
    'distrito': ('Distrito Manga', 'distrito-manga_178258'),
    'kitsune': ('Kitsune Books', 'kitsune-books_108604'),
    'tomodomo': ('Tomodomo', 'ediciones-tomodomo_97969'),
    'moztros': ('Moztros', 'moztros-producciones-sl_177736'),
    'ooso': ('Ooso Cómics', 'ooso-comics_174673'),
    # cómic (europeo, independiente, americano…); Yermo incluye Arechi Manga
    'astiberri': ('Astiberri', 'astiberri-ediciones_66490'),
    'dolmen': ('Dolmen', 'tebeos-dolmen-editorial-s-l_71269'),
    'cupula': ('La Cúpula', 'ediciones-la-cupula-s-l_175795'),
    'salamandra': ('Salamandra Graphic', 'salamandra-graphic_179778'),
    'reservoir': ('Reservoir Books', 'reservoir-books_176736'),
    'sapristi': ('Sapristi', 'sapristi_179812'),
    'diabolo': ('Diábolo Ediciones', 'diabolo-ediciones_126894'),
    'dibbuks': ('Dibbuks', 'dibbuks_70911'),
    'ponentmon': ('Ponent Mon', 'ponent-mon_3403'),
    'grafito': ('Grafito Editorial', 'grafito-editorial_142955'),
    'nuevonueve': ('Nuevo Nueve', 'nuevo-nueve-editores-s-l_175496'),
    'garbuix': ('Garbuix Books', 'garbuix-books_153302'),
    'bang': ('Bang Ediciones', 'bang-ediciones_123283'),
    'fulgencio': ('Fulgencio Pimentel', 'fulgencio-pimentel-s-l_77336'),
    'liana': ('Liana Editorial', 'liana-editorial_174718'),
    'yermo': ('Yermo / Arechi Manga', 'yermo-ediciones-y-publicaciones-s-l_176080'),
    'babylon': ('Ediciones Babylon', 'ediciones-babylon_83791'),
    'komikids': ('Kómikids', 'komikids_152236'),
    'desfiladero': ('Desfiladero Ediciones', 'desfiladero-ediciones_111271'),
    'eljueves': ('RBA El Jueves', 'rba-el-jueves_72116'),
    'spaceman': ('Spaceman Project', 'spaceman-project-s-l_117488'),
    'sinsentido': ('Sinsentido', 'espacio-sinsentido-sl_73009'),
    'edt': ('Editores de Tebeos (Glénat)', 'editores-de-tebeos_73782'),
    'apaapa': ('Apa Apa Cómics', 'apa-apa-comics_65260'),
}
MANGA = {'milkyway', 'distrito', 'kitsune', 'tomodomo', 'moztros', 'ooso'}
# Primera página (la que trae fechas) cuando su dirección no coincide con el nombre del enlace
FIRST = {'tomodomo': 'tomodomo', 'moztros': 'moztros', 'dolmen': 'dolmen', 'cupula': 'ediciones-la-cupula', 'nuevonueve': 'nuevo-nueve-editores',
         'fulgencio': 'fulgencio-pimentel', 'yermo': 'yermo-ediciones', 'eljueves': 'ediciones-el-jueves', 'sinsentido': 'ediciones-sinsentido', 'edt': 'glenat'}


def crawl(pub, pages):
    name, ref = PUBS[pub]
    path = os.path.join(HERE, f'tl_{pub}.json')
    raw = json.load(open(path)) if os.path.exists(path) else {}
    added = 0
    for n in range(1, pages + 1):
        h = get(f'{BASE}/editorial/{FIRST.get(pub, ref.rsplit("_", 1)[0])}' if n == 1 else f'{BASE}/editoriales/{ref}/catalogo?page={n}')
        books = parse(h) if h else {}
        if not books:
            break
        new = sum(1 for i in books if i not in raw)
        for isbn, b in books.items():
            raw[isbn] = {**raw.get(isbn, {}), **{k: v for k, v in b.items() if v}}
        added += new
        print(f'{name}, página {n}: {len(books)} libros, {new} nuevos', file=sys.stderr)
        time.sleep(1)
    json.dump(dict(sorted(raw.items())), open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
    return added, len(raw)


def probe(url, dest):
    """Guarda una página para revisar su estructura (tarea manual)."""
    h = get(url) or ''
    open(os.path.join(HERE, dest), 'w').write(h)
    print(json.dumps({'probe': url, 'bytes': len(h), 'books': len(parse(h))}))


def find(slugs):
    """Busca el enlace de cada editorial (/editoriales/<slug>_<id>) y cuántos títulos tiene (tarea manual)."""
    import re
    out = {}
    for slug in slugs:
        h = get(f'{BASE}/editorial/{slug}') or ''
        m = re.search(r'Todos los libros de ([^|<]+)\|\s*(\d+) títulos', h)
        ref = re.search(r'editoriales/([a-z0-9-]+_\d+)/catalogo', h) or re.search(r'data-destino="([^"]+)"', h)
        if ref and not ref.group(1).count('_'):
            import base64
            dec = base64.b64decode(ref.group(1)).decode('utf-8', 'replace')
            ref = re.search(r'editoriales/([a-z0-9-]+_\d+)/catalogo', dec)
        out[slug] = [m.group(1).strip() if m else '', int(m.group(2)) if m else 0, ref.group(1) if ref else '']
        time.sleep(1)
    json.dump(out, open(os.path.join(HERE, 'tl_probe.json'), 'w'), ensure_ascii=False, indent=0)


def main():
    if '--find' in sys.argv:
        return find(sys.argv[sys.argv.index('--find') + 1].split(','))
    if '--probe' in sys.argv:
        return probe(sys.argv[sys.argv.index('--probe') + 1], 'tl_probe.html')
    pub = sys.argv[sys.argv.index('--pub') + 1] if '--pub' in sys.argv else 'todas'
    pages = int(sys.argv[sys.argv.index('--pages') + 1]) if '--pages' in sys.argv else 400
    out = {p: crawl(p, pages) for p in (PUBS if pub == 'todas' else [pub])}
    print(json.dumps(out))


if __name__ == '__main__':
    main()
