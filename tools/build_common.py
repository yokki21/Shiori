# Arma series y tomos sueltos de catalog.json a partir de las fichas de una editorial ya normalizadas.
# Lo usan build_planeta.py y build_norma.py.
#
# Cada ficha: {title, cover, price, date, pages, authors, isbn, line, type} y, si es un número de una serie,
# n (número), base (nombre de la serie según el título), gk (clave de la serie) y gname (nombre de la serie en la
# web de la editorial, si no es gk).
import re
from collections import Counter, defaultdict

SKIP_RE = re.compile(r'\(novela\)|^agenda |calendario 20\d\d', re.I)   # lo que no es cómic y se cuela en los listados


def ean_ok(code):
    if not code or not re.fullmatch(r'\d{13}', code):
        return False
    s = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(code[:12]))
    return (10 - s % 10) % 10 == int(code[12])


def assemble(records, PUBLISHER, key, isbn_used, taken_names):
    """Devuelve (series, extras). isbn_used y taken_names (claves de nombres ya usados) se actualizan."""
    groups = defaultdict(list)
    loose = []
    for p in records:
        (groups[p['gk']] if 'n' in p else loose).append(p)

    series = []
    for gk, items in groups.items():
        by_n = {}
        for p in sorted(items, key=lambda p: (p['date'] or '9999', p['isbn'] is None)):
            if p['n'] in by_n:
                loose.append(p)   # otra edición del mismo número (reedición, catalán…)
            else:
                by_n[p['n']] = p
        if len(by_n) == 1 and not by_n.get(1):
            loose.extend(by_n.values())
            continue
        base = Counter(p['base'] for p in by_n.values()).most_common(1)[0][0]
        series.append({'gk': gk, 'gname': next(iter(by_n.values())).get('gname', gk), 'base': base, 'items': by_n})

    # Nombre visible: el del título ("One Piece"); si dos series lo comparten, el de la ficha ("Detective Conan II")
    by_base = defaultdict(list)
    for s in series:
        by_base[key(s['base'])].append(s)
    for g in by_base.values():
        # se queda el nombre corto la que se llama así en la ficha o, si ninguna, la más larga
        main = next((s for s in g if key(s['gname']) == key(s['base'])), None) or max(g, key=lambda s: len(s['items']))
        for s in g:
            s['name'] = s['base'] if s is main else s['gname']
    names = Counter(key(s['name']) for s in series)
    for s in series:
        if names[key(s['name'])] > 1 or key(s['name']) in taken_names:
            y = min((p['date'] for p in s['items'].values() if p['date']), default='')[:4]
            s['name'] = f"{s['name']} ({PUBLISHER}{', ' + y if y else ''})"
    out_series = []
    for s in sorted(series, key=lambda s: key(s['name'])):
        taken_names.add(key(s['name']))
        first = Counter((p['line'], p['type']) for p in s['items'].values()).most_common(1)[0][0]
        o = {'name': s['name'], 'publisher': PUBLISHER, 'type': first[1], 'line': first[0], 'issues': {}}
        for n, p in sorted(s['items'].items()):
            io = {}
            if p['title'] != f"{s['name']} {n}":
                io['title'] = p['title']
            for k in ('cover', 'price', 'date'):
                if p[k]:
                    io[k] = p[k]
            if p['isbn'] and p['isbn'] not in isbn_used:
                io['isbn'] = p['isbn']
                isbn_used.add(p['isbn'])
            for k in ('pages', 'authors'):
                if p[k]:
                    io[k] = p[k]
            o['issues'][str(n)] = io
        out_series.append(o)

    out_extras = []
    for p in sorted(loose, key=lambda p: key(p['title'])):
        if p['isbn'] and p['isbn'] in isbn_used:
            continue
        if SKIP_RE.search(p['title']):
            continue
        o = {'title': p['title'], 'publisher': PUBLISHER}
        for k in ('cover', 'price', 'date', 'isbn', 'pages', 'authors'):
            if p[k]:
                o[k] = p[k]
        if p['isbn']:
            isbn_used.add(p['isbn'])
        o['line'], o['type'] = p['line'], p['type']
        out_extras.append(o)
    return out_series, out_extras
