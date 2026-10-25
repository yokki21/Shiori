#!/usr/bin/env python3
"""Busca novedades de Norma Editorial en normaeditorial.com y las añade a tools/norma_raw.json.

Uso: python3 tools/update_norma.py [--max N]
Después se regenera el catálogo con tools/build_panini.py (la tarea semanal lo hace sola).

Qué hace, respetando robots.txt (mapa del sitio y fichas de producto, una petición por segundo):
1. Lee el mapa del sitio de álbumes y abre las fichas nuevas de manga, cómic americano y cómic europeo.
2. Vuelve a abrir las fichas de lo que sale pronto o acaba de salir (fecha, precio e ISBN cambian al acercarse).
"""
import json, os, re, sys, time, urllib.request
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'norma_raw.json')
BASE = 'https://www.normaeditorial.com'
CATS = ('manga', 'comic-americano', 'comic-europeo')
UA = 'ShioriCatalogo/1.0 (+https://github.com/yokki21/Shiori)'
DELAY = 1.0


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


def parse(h):
    """Lo mismo que se sacó de cada ficha en el recorrido inicial: sus datos estructurados."""
    lds = []
    for m in re.finditer(r'<script type="application/ld\+json">([\s\S]*?)</script>', h):
        try:
            lds.append(json.loads(m.group(1)))
        except ValueError:
            pass
    b = next((x for x in lds if isinstance(x, dict) and x.get('@type') == 'Book'), {})
    w = next((x for x in lds if isinstance(x, dict) and x.get('@type') == 'WebPage'), {})
    offers = b.get('offers') or {}
    pg = str(b.get('numberOfPages') or '')
    return {
        't': b.get('name') or '', 'au': (b.get('author') or '')[:160], 'd': b.get('datePublished') or '',
        'isbn': re.sub(r'\D', '', b.get('isbn') or ''), 'pg': int(pg) if pg.isdigit() else None,
        'p': float(offers['price']) if offers.get('price') else None,
        'img': b.get('thumbnailUrl') or b.get('image') or '', 'bc': w.get('breadcrumb') or '', 'g': b.get('about') or '',
    }


def main():
    limit = int(sys.argv[sys.argv.index('--max') + 1]) if '--max' in sys.argv else 400
    raw = json.load(open(RAW)) if os.path.exists(RAW) else {}
    xml = get(BASE + '/sitemap-albumes.xml') or ''
    paths = [m.group(1) for m in re.finditer(r'<loc>https://www\.normaeditorial\.com/ficha/([^<]+)</loc>', xml)]
    new = [p for p in paths if p.split('/')[0] in CATS and p not in raw]
    today = date.today()
    soon = [p for p, r in raw.items() if re.match(r'^\d{4}-\d{2}-\d{2}', r.get('d') or '')
            and today - timedelta(days=21) <= date.fromisoformat(r['d'][:10]) <= today + timedelta(days=150)]
    print(f'mapa del sitio: {len(paths)}, nuevas: {len(new)}, a refrescar: {len(soon)}', file=sys.stderr)

    added = updated = errors = 0
    for p in (new + soon)[:limit]:
        time.sleep(DELAY)
        h = get(f'{BASE}/ficha/{p}')
        r = parse(h) if h else None
        if not r or not r['t']:
            errors += 1
            if errors >= 10 and not (added or updated):
                print('La web no está sirviendo fichas; se sigue en la próxima pasada.', file=sys.stderr)
                break
            continue
        if p in raw:
            raw[p].update({k: v for k, v in r.items() if v})
            updated += 1
        else:
            raw[p] = r
            added += 1
            print(f'  + {p}: {r["t"]} ({r["d"]})', file=sys.stderr)

    json.dump(dict(sorted(raw.items())), open(RAW, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'añadidas {added}, actualizadas {updated}, errores {errors}', file=sys.stderr)
    print(json.dumps({'added': added, 'updated': updated}))


if __name__ == '__main__':
    main()
