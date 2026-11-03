# Editoriales de manga sacadas del listado de todostuslibros.com (tools/tl_<clave>.json, ver update_tl.py).
# Mismo formato y reglas que ECC (build_ecc.py); todo va en la línea Manga.
import os

import build_ecc
from update_tl import PUBS

HERE = os.path.dirname(os.path.abspath(__file__))


def build(key, nice, isbn_used, taken_names):
    """Devuelve {nombre de la editorial: (series, extras)}."""
    out = {}
    for pub, (name, _) in PUBS.items():
        out[name] = build_ecc.build(key, nice, isbn_used, taken_names, os.path.join(HERE, f'tl_{pub}.json'), name, manga=True)
    return out
