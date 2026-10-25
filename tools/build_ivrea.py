# Series de Ivrea España para el catálogo (lo llama build_panini.py antes de escribir catalog.json).
#
# Entrada: tools/ivrea_raw.json = {series: {slug: {t, items, st, fam, imgs: {n: portada}, cover}}, cal: [{d, t, n, img}]}
# sacado de editorialivrea.com/ESP: la ficha de cada título (nombre, autores, demografía y la galería con la
# portada de cada tomo publicado) y el calendario de salidas (fecha de los próximos tomos).
# Ivrea no publica ISBN ni precio por tomo en su web: salen de La Comiquería, su tienda online
# (tools/ivrea_isbn.json = {ruta: {t, isbn, p}}), cruzando el título del producto con la serie y el número.
import html, json, os, re

from build_common import ean_ok

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'ivrea_raw.json')
PUBLISHER = 'Ivrea'
IMG = 'https://www.editorialivrea.com/ESP/storage/'
TODAY = __import__('datetime').date.today().isoformat()


def short(url):
    return ('iv:' + url[len(IMG):]) if url and url.startswith(IMG) else (url or None)


def build(key, nice, isbn_used, taken_names):
    if not os.path.exists(RAW):
        return [], []
    raw = json.load(open(RAW))
    series, extras = [], []
    by_key = {}
    for slug, r in sorted(raw.get('series', {}).items()):
        name = re.sub(r'\s+', ' ', r.get('t') or '').strip()
        if not name:
            continue
        it = r.get('items') or {}
        authors = ', '.join(x for x in [it.get('Author(s)', ''), it.get('Artist(s)', '')] if x)
        authors = ', '.join(dict.fromkeys(a.strip() for a in authors.split(',') if a.strip()))[:120] or None
        novel = 'novela' in slug or 'novela' in (it.get('Genre(s)') or '').lower()
        imgs = {int(n): u for n, u in (r.get('imgs') or {}).items() if str(n).isdigit() and 0 < int(n) < 300 and not re.search(r'\d+x\d+\.\w+$|cropped-icon', u)}
        # Portadas sueltas fuera de la galería (los últimos tomos): solo si se llaman como las de la galería
        gal = {re.sub(r'[^a-z]', '', u.split('/')[-1].split('.')[0].lower()) for u in imgs.values() if 'photo-gallery' in u}
        if gal:
            imgs = {n: u for n, u in imgs.items() if 'photo-gallery' in u or re.sub(r'[^a-z]', '', u.split('/')[-1].split('.')[0].lower()) in gal}
        if novel:
            continue   # las novelas ligeras no son cómic
        if len(imgs) <= 1:
            extras.append({'title': name, 'publisher': PUBLISHER, 'cover': short(next(iter(imgs.values()), r.get('cover', '').replace('-193x278', ''))),
                           'authors': authors, 'line': 'Manga', 'type': 'manga'})
            by_key[key(name)] = extras[-1]
            continue
        o = {'name': name, 'publisher': PUBLISHER, 'type': 'manga', 'line': 'Manga',
             'issues': {str(n): {'cover': short(u), **({'authors': authors} if authors else {})} for n, u in sorted(imgs.items())}}
        series.append(o)
        by_key[key(name)] = o

    # Próximos tomos del calendario: fecha (y portada si aún no está en la galería); las series nuevas se crean
    for c in raw.get('cal', []):
        k = key(c['t'])
        s = by_key.get(k) or next((v for kk, v in by_key.items() if 'issues' in v and (kk.startswith(k + ' ') or k.startswith(kk + ' '))), None)
        if s is None:   # «JOJO'S STEEL BALL RUN» → «JoJo's Bizarre Adventure Parte 7: Steel Ball Run»
            words = set(k.split())
            cands = [(len(kk), v) for kk, v in by_key.items() if 'issues' in v and len(words) > 1 and words <= set(kk.split())]
            s = min(cands, key=lambda x: x[0])[1] if cands else None
        if s is not None and 'issues' not in s:
            continue   # tomo único ya en el catálogo
        if s is None:
            s = {'name': re.sub(r'^([¿¡])(\w)', lambda m: m.group(1) + m.group(2).upper(), nice(c['t'])), 'publisher': PUBLISHER, 'type': 'manga', 'line': 'Manga', 'issues': {}}
            series.append(s)
            by_key[k] = s
        if str(c['n']) in s['issues'] and s['issues'][str(c['n'])].get('cover') and c['d'] <= TODAY:
            continue   # reimpresión de un tomo ya publicado
        io = s['issues'].setdefault(str(c['n']), {})
        io['date'] = c['d']
        if c.get('img') and not io.get('cover'):
            io['cover'] = short(c['img'])
        s['issues'] = dict(sorted(s['issues'].items(), key=lambda kv: int(kv[0])))

    # ISBN y precio de cada tomo, de las fichas de La Comiquería (la tienda online de Ivrea): «GOBLIN SLAYER 03»
    shop = os.path.join(HERE, 'ivrea_isbn.json')
    if os.path.exists(shop):
        for path, r in json.load(open(shop)).items():
            t = html.unescape(r.get('t') or '').strip()
            isbn = r.get('isbn') if ean_ok(r.get('isbn')) else None
            if not t or isbn in isbn_used:
                continue
            m = re.match(r'^(.*?\S)\s+(?:N[º°]\s*)?0*(\d{1,3})$', t, re.I)
            k = key(m.group(1)) if m else key(t)
            s = by_key.get(k)
            if s is None:
                continue
            io = s['issues'].get(m.group(2).lstrip('0') or '0') if m and 'issues' in s else (s if 'issues' not in s and not m else None)
            if io is None:
                continue
            if isbn and not io.get('isbn'):
                io['isbn'] = isbn
                isbn_used.add(isbn)
            if r.get('p') and not io.get('price'):
                io['price'] = r['p']

    # Nombres que ya usa otra editorial: se distinguen
    for s in series:
        if key(s['name']) in taken_names:
            s['name'] = f"{s['name']} ({PUBLISHER})"
        taken_names.add(key(s['name']))
    for e in extras:
        for k in [k for k, v in e.items() if v is None]:
            del e[k]
    return sorted(series, key=lambda s: key(s['name'])), extras
