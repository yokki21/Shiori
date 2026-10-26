#!/usr/bin/env python3
"""Catálogo de ECC Ediciones a partir de todostuslibros.com (el catálogo de las librerías de CEGAL).

La web de ECC no deja leer su catálogo de forma automática, así que se usa el listado de la editorial en
todostuslibros.com, que su robots.txt permite (una petición por segundo): título, ISBN (en el enlace de la ficha),
precio y mes de salida de cada libro. Las portadas no se copian (su robots.txt las excluye): la app las busca por ISBN.

Uso: python3 tools/update_ecc.py [--pages N] [--probe]
  --pages N  solo las N primeras páginas del listado (la tarea semanal mira las primeras, que son lo más nuevo)
  --probe    guarda además la segunda página en tools/ecc_probe.html para revisar su estructura
"""
import html, json, os, re, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'ecc_raw.json')
BASE = 'https://www.todostuslibros.com'
LIST = BASE + '/editorial/ecc-ediciones'
PAGED = BASE + '/editoriales/ecc-ediciones_174634/catalogo?page='   # el enlace de cada página del listado
UA = 'ShioriCatalogo/1.0 (+https://github.com/yokki21/Shiori)'
MONTHS = {'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'ago': 8, 'sep': 9, 'sept': 9, 'oct': 10, 'nov': 11, 'dic': 12}


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception:
            pass
        time.sleep(10 * (i + 1))
    return None


def text(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def parse(h):
    """Un libro por cada enlace a /libros/{título}_{ISBN}: se mira el trozo de página hasta el siguiente libro."""
    links = list(re.finditer(r'href="(?:https://www\.todostuslibros\.com)?/libros/([^"_]+)_((?:97[89])-?[\d-]{10,14})"', h))
    out = {}
    starts = []
    for m in links:
        isbn = re.sub(r'\D', '', m.group(2))
        if not starts or starts[-1][1] != isbn:
            starts.append((m.start(), isbn, m.group(1)))
    for i, (pos, isbn, slug) in enumerate(starts):
        if isbn in out:
            continue
        own = h[pos:starts[i + 1][0] if i + 1 < len(starts) else pos + 4000]
        t = next((x for x in (text(a) for a in re.findall(r'<a[^>]+/libros/' + re.escape(slug) + r'_[^"]*"[^>]*>([\s\S]*?)</a>', h)) if x), '')
        price = re.search(r'(\d{1,3},\d{2})\s*(?:&nbsp;|\s)*€', own)
        date = re.search(r'\b(ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)\.?\s+(\d{4})\b', own, re.I)
        out[isbn] = {
            't': t or slug.replace('-', ' '),
            'p': float(price.group(1).replace(',', '.')) if price else None,
            'd': f'{date.group(2)}-{MONTHS[date.group(1).lower()]:02d}' if date else '',
            's': slug,
        }
    return out


def main():
    pages = int(sys.argv[sys.argv.index('--pages') + 1]) if '--pages' in sys.argv else 400
    raw = json.load(open(RAW)) if os.path.exists(RAW) else {}
    added = 0
    for n in range(1, pages + 1):
        h = get(LIST if n == 1 else f'{PAGED}{n}')
        if not h:
            break
        if n == 2 and '--probe' in sys.argv:
            open(os.path.join(HERE, 'ecc_probe.html'), 'w').write(h)
        books = parse(h)
        if not books:
            break
        new = 0
        for isbn, b in books.items():
            if isbn not in raw:
                new += 1
            raw[isbn] = {**raw.get(isbn, {}), **{k: v for k, v in b.items() if v}}
        added += new
        print(f'página {n}: {len(books)} libros, {new} nuevos', file=sys.stderr)
        time.sleep(1)
    json.dump(dict(sorted(raw.items())), open(RAW, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(json.dumps({'added': added, 'total': len(raw)}))


if __name__ == '__main__':
    main()
