#!/usr/bin/env python3
"""Busca novedades de cómics y manga en panini.es (Marvel, DC, manga y el resto) y las añade a tools/panini_raw.json.

Uso: python3 tools/update_panini.py [--max N]
Después se regenera el catálogo con tools/build_panini.py (la tarea semanal lo hace sola).

Qué hace, respetando robots.txt (solo el mapa del sitio y las fichas de producto, una petición por segundo):
1. Lee el mapa del sitio de cómics y saca las referencias nuevas.
2. Abre la ficha de las nuevas y las clasifica: Marvel o DC por la editorial original de la ficha,
   manga por su colección (tools/panini_manga_prefixes.json) o su encuadernación (tankobon), y el resto.
3. Vuelve a abrir las fichas de lo que sale pronto o acaba de salir, para actualizar fecha, precio,
   disponibilidad y códigos (Panini los rellena según se acerca la salida).
"""
import html, json, os, re, sys, time, urllib.request
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'panini_raw.json')
SKIP = os.path.join(HERE, 'panini_skip.json')   # referencias que no se pueden añadir (packs, fichas vacías)
MANGA = os.path.join(HERE, 'panini_manga_prefixes.json')   # colecciones del listado de manga de Panini
BASE = 'https://www.panini.es'
SITEMAP = BASE + '/media/shp_esp_es/comics-sitemap.xml'
UA = 'ShioriCatalogo/1.0 (+https://github.com/yokki21/Shiori)'
DELAY = 2.0   # Panini corta a quien pide demasiado seguido
MONTHS = {'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'ago': 8, 'sep': 9, 'sept': 9, 'oct': 10, 'nov': 11, 'dic': 12}


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if i == tries - 1:
                raise
        except Exception:
            if i == tries - 1:
                raise
        time.sleep(5 * (i + 1))


def field(h, cls):
    m = re.search(rf'class="item {cls}"[\s\S]*?<span class="data">([\s\S]*?)</span>', h)
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', m.group(1))).strip() if m else ''


def parse_page(h):
    """Lo mismo que se sacó de cada ficha en el recorrido inicial (ver build_panini.py)."""
    title = html.unescape((re.search(r'itemprop="name">([^<]+)<', h) or [None, ''])[1]).strip()
    ld = re.search(r'"@type":"Product","name":"((?:[^"\\]|\\.)*)","image":"([^"]+)"', h)
    if not title and ld:
        title = json.loads(f'"{ld.group(1)}"')
    img = ''
    if ld and '/media/catalog/product/' in ld.group(2):
        img = ld.group(2).replace('\\/', '/').split('/media/catalog/product/')[1].split('?')[0]
    if not img:   # si no, la imagen de la ficha para redes sociales
        m = re.search(r'og:image" content="[^"]*/media/catalog/product/([^"?]+)', h)
        img = m.group(1) if m else ''
    price = re.search(r'data-price-amount="([\d.]+)"\s+data-price-type="oldPrice"', h) or re.search(r'data-price-amount="([\d.]+)"\s+data-price-type="finalPrice"', h)
    code = re.search(r'97[789]\d{10}', field(h, 'pnn_isbn'))
    return {
        'title': title, 'img': img,
        'editor': field(h, 'pnn_original_editor'),
        'date': field(h, 'pnn_release_date'),
        'pages': int(field(h, 'pnn_pages_number')) if field(h, 'pnn_pages_number').isdigit() else None,
        'authors': field(h, 'pnn_authors_display')[:160],
        'price': float(price.group(1)) if price else None,
        'code': code.group(0) if code else None,
        'issn': re.sub(r'\D', '', field(h, 'pnn_issn')) or None,
        'listed': 'class="stock unavailable"' not in h,
        'binding': field(h, 'pnn_binding'),
    }


def iso(pdate):
    m = re.match(r'^(\d{1,2}) ([a-z]+)\.? (\d{4})$', (pdate or '').strip().lower())
    return f'{m.group(3)}-{MONTHS[m.group(2)]:02d}-{int(m.group(1)):02d}' if m and m.group(2) in MONTHS else ''


def category(p, prefix, manga_prefixes):
    e = (p['editor'] or '').lower()
    if 'marvel' in e:
        return 'marvel'
    if re.search(r'\bdc\b', e):
        return 'dc'
    if prefix in manga_prefixes or 'tankobon' in (p.get('binding') or '').lower():
        return 'manga'
    # Fichas antiguas sin editorial original: se reconoce por los personajes del título
    t = (p.get('title') or '').lower()
    if not e and MARVEL_RE.search(t):
        return 'marvel'
    if not e and DC_RE.search(t):
        return 'dc'
    return 'otros'


MARVEL_RE = re.compile(r'marvel|spider|ara[ñn]a|x-men|patrulla-x|vengador|avengers|hulk|\bthor\b|lobezno|wolverine|masacre|deadpool|capit[aá]n am[eé]rica|capitana marvel|iron man|daredevil|fant[aá]stic|guardianes de la galaxia|inhumanos|s\.?h\.?i\.?e\.?l\.?d|pantera negra|veneno|venom|castigador|punisher|doctor extra[ñn]o|excalibur|merodeadores|nuevos mutantes|campeones|arma x|x-force|factor-x|motorista fantasma|ms\. marvel|loki|thanos|viuda negra|ojo de halc[oó]n|bruja escarlata|kang|magneto|cable|ultimate|nova\b|silver surfer|estela plateada|namor|eternos|runaways|thunderbolts|defensores|conan|secret wars|guerras secretas|infinit|imperio secreto|jane foster|valquiria|mapache cohete|inhuman|civil war|reinado del diablo|hombre-x|s\\.w\\.o\\.r\\.d|ragnar[oö]k|krakoa|dinast[ií]a de x|potencias de x|axis|siege|asedio|invasi[oó]n secreta|reino oscuro|vengadores|skrull|kree|miles morales|gwen|carnage|matanza')
DC_RE = re.compile(r'batman|superman|wonder woman|\bflash\b|green lantern|linterna verde|aquaman|joker|harley|liga de la justicia|justice league|nightwing|catwoman|robin|titanes|green arrow|shazam|supergirl|batgirl|\bdc\b|sandman|vertigo|watchmen|constantine|hellblazer|lobo\b|darkseid')


def main():
    limit = int(sys.argv[sys.argv.index('--max') + 1]) if '--max' in sys.argv else 400
    raw = json.load(open(RAW))
    K = raw['keys']
    for k in ('ptitle', 'pdate', 'pages', 'authors', 'pprice', 'pcode', 'pissn'):
        if k not in K:
            K.append(k)
            for r in raw['rows']:
                r.append(None)
    col = {k: i for i, k in enumerate(K)}
    rows = {r[col['sku']]: r for r in raw['rows']}
    sk = json.load(open(SKIP)) if os.path.exists(SKIP) else None

    xml = get(SITEMAP)
    entries = {}
    for m in re.finditer(r'/shp_esp_es/([^<"]+?-([a-z0-9]+)-es01)\.html', xml):
        entries[m.group(2)] = m.group(1)
    pre = lambda s: (re.match(r'[a-z]+', s) or [s])[0]
    ours = {pre(s) for s in rows}
    skip = set((sk or {}).get('skus', []))
    manga_prefixes = set(json.load(open(MANGA))) if os.path.exists(MANGA) else set()
    print(f'mapa del sitio: {len(entries)} productos, {len(rows)} ya en el catálogo', file=sys.stderr)

    # Referencias nuevas: primero las de colecciones conocidas; las de colecciones nuevas se comprueban
    new = [s for s in entries if s not in rows and s not in skip]
    new = [s for s in new if not s.startswith('bundle')]   # packs de varios tomos
    known_new = [s for s in new if pre(s) in ours]
    unknown_new = [s for s in new if pre(s) not in ours]
    # Lo que sale pronto o acaba de salir: se refresca para tener fecha, precio y códigos al día
    today = date.today()
    soon = []
    for s, r in rows.items():
        d = iso(r[col['pdate']]) or ''
        if d and today - timedelta(days=21) <= date.fromisoformat(d) <= today + timedelta(days=120):
            soon.append(s)
    todo = known_new + unknown_new + soon
    print(f'nuevas: {len(known_new)} de colecciones conocidas, {len(unknown_new)} por comprobar; a refrescar: {len(soon)}', file=sys.stderr)

    added = updated = skipped = blocked = 0
    for s in todo[:limit]:
        slug = entries.get(s) or (rows[s][col['slug']] if s in rows else None)
        if not slug:
            continue
        time.sleep(DELAY)
        h = get(f'{BASE}/shp_esp_es/{slug}.html')
        if not h:
            continue
        p = parse_page(h)
        if not p['title'] or 'pnn_release_date' not in h:
            # Página sin la ficha: casi siempre el control anti-robots de la tienda. No se descarta nada;
            # tras varias seguidas se para y la próxima pasada sigue por aquí.
            blocked += 1
            if blocked >= 5:
                print('La tienda ha dejado de servir fichas; se sigue en la próxima pasada.', file=sys.stderr)
                break
            time.sleep(30)
            continue
        blocked = 0
        if s in rows:   # refresco
            r = rows[s]
            for k, v in (('ptitle', p['title']), ('pdate', p['date']), ('pages', p['pages']), ('authors', p['authors']),
                         ('pprice', p['price']), ('pcode', p['code']), ('pissn', p['issn'])):
                if v:
                    r[col[k]] = v
            r[col['listed']] = p['listed']
            if p['img'] and not r[col['img']]:
                r[col['img']] = p['img']
            updated += 1
            continue
        cat = category(p, pre(s), manga_prefixes)
        r = [None] * len(K)
        for k, v in (('sku', s), ('slug', slug), ('title', p['title']), ('price', p['price']), ('date', ''), ('cat', cat),
                     ('img', p['img']), ('code', None), ('addon', None), ('listed', p['listed']), ('ptitle', p['title']),
                     ('pdate', p['date']), ('pages', p['pages']), ('authors', p['authors']), ('pprice', p['price']),
                     ('pcode', p['code']), ('pissn', p['issn'])):
            r[col[k]] = v
        raw['rows'].append(r)
        rows[s] = r
        added += 1
        print(f'  + {s}: {p["title"]} ({p["date"]})', file=sys.stderr)

    raw['rows'].sort(key=lambda r: r[col['sku']])
    json.dump(raw, open(RAW, 'w'), ensure_ascii=False)
    json.dump({'skus': sorted(skip)}, open(SKIP, 'w'), indent=0)
    print(f'añadidas {added}, actualizadas {updated}, descartadas {skipped}', file=sys.stderr)
    # Para la tarea de GitHub: resumen en una línea
    print(json.dumps({'added': added, 'updated': updated, 'skipped': skipped}))


if __name__ == '__main__':
    main()
