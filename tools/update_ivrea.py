#!/usr/bin/env python3
"""Actualiza tools/ivrea_raw.json con lo nuevo de Ivrea España (editorialivrea.com/ESP).

Uso: python3 tools/update_ivrea.py
Después se regenera el catálogo con tools/build_panini.py (la tarea semanal lo hace sola).

Su web no tiene robots.txt. Se pide una página por segundo:
1. El calendario de salidas: fecha y portada de los próximos tomos.
2. El catálogo completo: las fichas de títulos nuevos.
3. Las fichas de los títulos que han tenido salidas hace poco, para recoger la portada de los tomos nuevos.
4. ISBN y precio de los tomos nuevos en La Comiquería, la tienda online de Ivrea.
"""
import html, json, os, re, sys, time, urllib.request
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'ivrea_raw.json')
BASE = 'https://www.editorialivrea.com/ESP'
STORE = 'https://www.lacomiqueria.com'
SHOP = os.path.join(HERE, 'ivrea_isbn.json')
UA = 'ShioriCatalogo/1.0 (+https://github.com/yokki21/Shiori)'
MONTHS = {m: i + 1 for i, m in enumerate(['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
                                          'septiembre', 'octubre', 'noviembre', 'diciembre'])}


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


def parse_title(h):
    """Lo mismo que se sacó de cada ficha en el recorrido inicial."""
    items = {}
    for blk in re.findall(r'class="post-content_item[^"]*"([\s\S]*?)</div>\s*</div>', h):
        k = re.search(r'<h5[^>]*>([\s\S]*?)</h5>', blk)
        v = re.search(r'class="summary-content[^"]*"[^>]*>([\s\S]*)', blk)
        if k and v:
            items[text(k.group(1))] = text(v.group(1))
    imgs = {}
    for u in re.findall(r'<a\s[^>]*?href="(https://www\.editorialivrea\.com/ESP/storage/[^"]+\.(?:jpg|png|webp))"', h, re.I):
        m = re.search(r'(\d{1,3})(?:-\d+)?\.(?:jpg|png|webp)$', u, re.I)
        if m and ('photo-gallery' in u or '/storage/20' in u):
            n = str(int(m.group(1)))
            if n not in imgs or 'photo-gallery' in imgs[n]:
                imgs[n] = u
    t = re.search(r'<div class="post-title">\s*<h1[^>]*>([\s\S]*?)</h1>', h) or re.search(r'<h1[^>]*>([\s\S]*?)</h1>', h)
    cover = re.search(r'class="summary_image"[\s\S]*?<img[^>]*?(?:data-src|src)="([^"]+)"', h)
    return {'t': text(t.group(1)) if t else '', 'items': items, 'st': '', 'fam': '', 'imgs': imgs, 'cover': cover.group(1) if cover else ''}


def parse_calendar(h):
    today = date.today()
    out, d, reprint, last_img = [], None, False, ''
    for m in re.finditer(r'<a href="([^"]+\.jpg)"[^>]*>|<h[1-6][^>]*>([\s\S]*?)</h[1-6]>', h):
        if m.group(1):
            last_img = m.group(1)
            continue
        t = text(m.group(2))
        dm = re.match(r'^(\d{1,2}) DE ([A-ZÁÉÍÓÚ]+)$', t, re.I)
        if dm and dm.group(2).lower() in MONTHS:
            mo = MONTHS[dm.group(2).lower()]
            y = today.year + (1 if mo < today.month - 2 else 0)
            d, reprint, last_img = f'{y}-{mo:02d}-{int(dm.group(1)):02d}', False, ''
            continue
        if re.search(r'REIMPRESION', t, re.I):
            reprint = True
            continue
        im = re.match(r'^(.+?)\s*#\s*(\d+)\s*$', t) or re.match(r'^(.+?)\s+TOMO ÚNICO$', t, re.I)
        if im and d and not reprint:
            out.append({'d': d, 't': im.group(1).strip(), 'n': int(im.group(2)) if im.lastindex >= 2 else 1, 'img': last_img})
            last_img = ''
    seen, res = set(), []
    for c in out:
        if (c['t'], c['n']) not in seen:
            seen.add((c['t'], c['n']))
            res.append(c)
    return res


def main():
    raw = json.load(open(RAW)) if os.path.exists(RAW) else {'series': {}, 'cal': []}
    cal_html = get(BASE + '/proximas/')
    if cal_html:
        new_cal = parse_calendar(cal_html)
        if new_cal:
            old = [c for c in raw.get('cal', []) if c['d'] >= (date.today() - timedelta(days=60)).isoformat()]
            keep = {(c['t'], c['n']) for c in new_cal}
            raw['cal'] = sorted([c for c in old if (c['t'], c['n']) not in keep] + new_cal, key=lambda c: (c['d'], c['t']))
    time.sleep(1)
    cat = get(BASE + '/catalogo/') or ''
    slugs = list(dict.fromkeys(re.findall(r'href="https://www\.editorialivrea\.com/ESP/titulo/([^"/]+)/"', cat)))
    recent = {re.sub(r'[^a-z0-9]+', '', c['t'].lower()) for c in raw.get('cal', []) if c['d'] <= date.today().isoformat()}
    todo = [s for s in slugs if s not in raw['series']]
    todo += [s for s, r in raw['series'].items() if re.sub(r'[^a-z0-9]+', '', (r.get('t') or '').lower()) in recent]
    print(f'calendario: {len(raw.get("cal", []))}, catálogo: {len(slugs)}, fichas a pedir: {len(todo)}', file=sys.stderr)
    added = updated = 0
    for s in dict.fromkeys(todo):
        time.sleep(1)
        h = get(f'{BASE}/titulo/{s}/')
        if not h:
            continue
        p = parse_title(h)
        if not p['t']:
            continue
        if s in raw['series']:
            updated += 1
        else:
            added += 1
            print(f'  + {s}: {p["t"]}', file=sys.stderr)
        raw['series'][s] = p
    raw['series'] = dict(sorted(raw['series'].items()))

    # ISBN y precio de los tomos nuevos, de La Comiquería (la tienda online de Ivrea; su robots.txt permite las fichas)
    shop = json.load(open(SHOP)) if os.path.exists(SHOP) else {}
    sm = get(STORE + '/sitemap/sitemap-products-ES-1.xml') or ''
    paths = [u.split(STORE + '/')[1] for u in re.findall(r'<loc>([^<]+)</loc>', sm) if not re.search(r'/(giftcards|novelas|products)/', u)]
    for path in [p for p in paths if p not in shop][:300]:
        time.sleep(1)
        h = get(f'{STORE}/{path}')
        if not h:
            continue
        t = re.search(r'<h1[^>]*>([\s\S]*?)</h1>', h)
        isbn = re.search(r'97[89]\d{10}', h)
        pvp = re.search(r'precio-anterior">\s*([\d.,]+)\s*€', h) or re.search(r'itemprop="price" content="([\d.]+)"', h)
        shop[path] = {'t': text(t.group(1)) if t else '', 'isbn': isbn.group(0) if isbn else '',
                      'p': float(pvp.group(1).replace('.', '').replace(',', '.')) if pvp and ',' in pvp.group(1) else (float(pvp.group(1)) if pvp else None)}
    json.dump(dict(sorted(shop.items())), open(SHOP, 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump(raw, open(RAW, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(json.dumps({'added': added, 'updated': updated}))


if __name__ == '__main__':
    main()
