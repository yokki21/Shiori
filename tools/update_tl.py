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
    'milkyway': ('Milky Way Ediciones', 'milky-way-ediciones_175001'),
    'distrito': ('Distrito Manga', 'distrito-manga_178258'),
    'kitsune': ('Kitsune Books', 'kitsune-books_108604'),
    'tomodomo': ('Tomodomo', 'ediciones-tomodomo_97969'),
    'moztros': ('Moztros', 'moztros-producciones-sl_177736'),
    'ooso': ('Ooso Cómics', 'ooso-comics_174673'),
}
# Primera página (la que trae fechas) cuando su dirección no coincide con el nombre del enlace
FIRST = {'tomodomo': 'tomodomo', 'moztros': 'moztros'}


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


def main():
    pub = sys.argv[sys.argv.index('--pub') + 1] if '--pub' in sys.argv else 'todas'
    pages = int(sys.argv[sys.argv.index('--pages') + 1]) if '--pages' in sys.argv else 400
    out = {p: crawl(p, pages) for p in (PUBS if pub == 'todas' else [pub])}
    print(json.dumps(out))


if __name__ == '__main__':
    main()
