#!/usr/bin/env python3
"""Busca novedades de Planeta Cómic en planetadelibros.com y las añade a tools/planeta_raw.json.

Uso: python3 tools/update_planeta.py [--max N]
Después se regenera el catálogo con tools/build_panini.py (la tarea semanal lo hace sola).

Qué hace, respetando robots.txt (fichas de producto y la página de la editorial; una petición cada 5 s,
el Crawl-delay que pide su robots.txt):
1. Lee la página de Planeta Cómic, que lista las novedades y lo próximo del mes, y abre las fichas nuevas.
2. Vuelve a abrir las fichas de lo que sale pronto o acaba de salir (fecha, precio e ISBN cambian al acercarse).
"""
import html, json, os, re, sys, time, urllib.request
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'planeta_raw.json')
BASE = 'https://www.planetadelibros.com'
PAGES = ['/editorial/planeta-comic/54', '/libros/comic-y-manga/00021', '/libros/manga/00112']
UA = 'ShioriCatalogo/1.0 (+https://github.com/yokki21/Shiori)'
DELAY = 5.0
sys.path.insert(0, HERE)
from build_planeta import iso   # noqa: E402


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
        time.sleep(15 * (i + 1))
    return None


def dec(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s or '')).strip()


def parse(h):
    """Lo mismo que se sacó de cada ficha en el recorrido inicial."""
    rows = {dec(a): dec(b)[:120] for a, b in re.findall(r'fichaTecnicaLabel[^>]*>([^<]+)</th><td[^>]*>([\s\S]*?)</td>', h)}
    img = re.search(r'https://proassets\.planetadelibros\.com/usuaris/libros/fotos/\d+/original/[^"\'\s\\)]+', h)
    price = re.search(r'\\"price\\":([\d.]+)', h)
    og = (re.search(r'property="og:title" content="([^"]+)"', h) or [None, ''])[1]
    h1 = re.search(r'<h1[^>]*>([\s\S]*?)</h1>', h)
    return {
        't': dec(h1.group(1)) if h1 else '',
        'au': dec(' - '.join(og.split(' | ')[0].split(' - ')[1:])),
        'img': img.group(0).replace('/original/', '/m_libros/') if img else '',
        'p': float(price.group(1)) if price else None,
        'isbn': re.sub(r'\D', '', rows.get('ISBN', '')),
        'd': rows.get('Publicación', ''), 'pg': int(rows['Páginas']) if rows.get('Páginas', '').isdigit() else None,
        'serie': rows.get('Serie', ''), 'col': rows.get('Colección', ''), 'ed': rows.get('Editorial', ''), 'tem': rows.get('Temáticas', ''),
    }


def main():
    limit = int(sys.argv[sys.argv.index('--max') + 1]) if '--max' in sys.argv else 300
    raw = json.load(open(RAW)) if os.path.exists(RAW) else {}
    found = {}
    for p in PAGES:
        h = get(BASE + p) or ''
        for slug, pid in re.findall(r'/(libro-[^"/\s\\?#]+)/(\d+)', h):
            found.setdefault(pid, slug)
        time.sleep(DELAY)
    new = [(pid, slug) for pid, slug in found.items() if pid not in raw]
    today = date.today()
    soon = []
    for pid, r in raw.items():
        d = iso(r.get('d'))
        if r.get('s') and d and today - timedelta(days=21) <= date.fromisoformat(d) <= today + timedelta(days=150):
            soon.append((pid, r['s']))
    print(f'en las páginas: {len(found)}, nuevas: {len(new)}, a refrescar: {len(soon)}', file=sys.stderr)

    added = updated = errors = 0
    for pid, slug in (new + soon)[:limit]:
        time.sleep(DELAY)
        h = get(f'{BASE}/{slug}/{pid}')
        p = parse(h) if h else None
        if not p or not (p['isbn'] or p['d']) or re.match(r'^error \d+', p['t'], re.I):
            errors += 1
            if errors >= 8 and not (added or updated):
                print('La web no está sirviendo fichas; se sigue en la próxima pasada.', file=sys.stderr)
                break
            continue
        if pid in raw:
            k = raw[pid].get('k')
            raw[pid].update({a: b for a, b in p.items() if b})
            raw[pid]['k'] = k
            updated += 1
            continue
        if 'planeta c' not in p['ed'].lower() and not re.search(r'c[oó]mic|manga', p['tem'] + p['col'], re.I):
            continue   # en las listas se cuela algún libro que no es cómic
        p['k'] = 'manga' if re.search(r'manga|manhwa', p['tem'] + p['col'], re.I) else 'comic'
        p['s'] = slug
        raw[pid] = p
        added += 1
        print(f'  + {pid}: {p["t"]} ({p["d"]})', file=sys.stderr)

    json.dump(dict(sorted(raw.items(), key=lambda kv: int(kv[0]))), open(RAW, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'añadidas {added}, actualizadas {updated}, errores {errors}', file=sys.stderr)
    print(json.dumps({'added': added, 'updated': updated}))


if __name__ == '__main__':
    main()
