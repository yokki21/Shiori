# Series y tomos de ECC Ediciones para el catálogo (lo llama build_panini.py antes de escribir catalog.json).
#
# Entrada: tools/ecc_raw.json = {isbn: {t, p, d, s}} del listado de la editorial en todostuslibros.com
# (título, precio, mes de salida "2025-02" si lo da y la ruta de la ficha).
import json, os, re

from build_common import assemble, ean_ok

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'ecc_raw.json')
PUBLISHER = 'ECC Ediciones'
# Portada: la imagen que usan las librerías de CEGAL, que se deduce del ISBN (no se descarga nada)
IMG = 'https://static.cegal.es/imagenes/marcadas/'
# "Dai Dark núm. 07", "Batman y los Outsiders vol. 2 de 4: La verdad sobre Halo", "Kakegurui núm. 01 (Cuarta edición)"
NUM_RE = re.compile(r'^(.*?\S)\s*,?\s+(?:núm\.|num\.|nº|n\.º|vol\.|#)\s*0*(\d{1,4})(?:\s*/\s*\d+)?(?:\s+de\s+\d+)?\s*(?:[:.-]\s*(.*?))?\s*(\([^)]*\))?$', re.I)
# Manga: además «Drifting Dragons 21», «Frieren 3 (edición especial)» (número de hasta 3 cifras al final)
NUM_LOOSE = re.compile(r'^(.*?\S)\s*,?\s+(?:(?:núm|num|nº|n\.º|n|vol|volumen|tomo)\.?\s+|#)?0*(\d{1,3})(?:\s*/\s*\d+)?(?:\s+de\s+\d+)?\s*(?:[:.-]\s*(.*?))?\s*(\([^)]*\))?$', re.I)
REPRINT = re.compile(r'(segunda|tercera|cuarta|quinta|sexta|s[eé]ptima|octava|\d+\s*ª?)\s+edici[oó]n', re.I)
DC_RE = re.compile(r'batman|superman|wonder woman|\bflash\b|green lantern|linterna verde|aquaman|joker|harley|liga de la justicia|nightwing|catwoman|robin\b|titanes|green arrow|shazam|supergirl|batgirl|sandman|watchmen|constantine|hellblazer|darkseid|\bdc\b|absolute|batwoman|zatanna|deathstroke|suicide squad|escuadr[oó]n suicida', re.I)


def build(key, nice, isbn_used, taken_names, raw_path=RAW, publisher=PUBLISHER, manga=False, loose=False):
    """También sirve para las editoriales de manga sacadas del mismo listado (build_tl.py)."""
    if not os.path.exists(raw_path):
        return [], []
    raw = json.load(open(raw_path))
    recs = []
    for isbn, r in sorted(raw.items()):
        t = re.sub(r'\s+', ' ', r.get('t') or '').strip()
        letters = [c for c in t if c.isalpha()]
        if manga:   # Distrito Manga añade la demografía: «Cross Game (Shônen)»
            t = re.sub(r'\s*\((?:sh[oôō]nen|seinen|josei|sh[oôō]jo|kodomo)\)', '', t, flags=re.I).strip()
        if (manga or loose) and letters and sum(c.isupper() for c in letters) / len(letters) >= 0.8:
            t = nice(t)   # fichas antiguas en mayúsculas: «ASTRA LOST IN SPACE N 03»
        if not t or not ean_ok(isbn) or re.search(r'\bnovela\b|agenda|calendario', t, re.I):
            continue
        d = r.get('d') or ''
        p = {'title': t, 'cover': f'cg:{isbn[:7]}/{isbn[:12]}.gif', 'price': r.get('p') or None, 'date': f'{d}-01' if re.fullmatch(r'\d{4}-\d{2}', d) else '',
             'pages': None, 'authors': None, 'isbn': isbn}
        p['line'], p['type'] = ('Manga', 'manga') if manga else ('DC', 'americano') if DC_RE.search(t) else ('Otros', 'americano')
        m = (NUM_RE.match(t) or NUM_LOOSE.match(t)) if manga or loose else NUM_RE.match(t)
        if m and not REPRINT.search(m.group(4) or ''):   # las reediciones van sueltas (se reconocen igual por su ISBN)
            p['n'] = int(m.group(2))
            # «(Biblioteca Super Kodomo)», «(Edición Deluxe)»: otra edición, otra serie
            p['base'] = (m.group(1).strip(' ,.-:') + (' ' + m.group(4) if m.group(4) else '')).strip()
            p['gk'] = key(p['base'])
        recs.append(p)
    return assemble(recs, publisher, key, isbn_used, taken_names)
