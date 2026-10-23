# Genera catalog/catalog.json a partir de los datos del catálogo oficial de Panini (panini_absolute_rows.json).
# Uso: python3 tools/build_absolute.py
import json, re, sys
rows = json.load(open(__import__('os').path.join(__import__('os').path.dirname(__file__), 'panini_absolute_rows.json')))
def issn_from_ean(ean):
    s = ean[3:10]; t = sum(int(c)*(8-i) for i,c in enumerate(s)); c=(11-t%11)%11
    return f"{s[:4]}-{s[4:]}{'X' if c==10 else c}"
def img_url(f): return f"https://www.panini.es/media/catalog/product/{f[0]}/{f[1]}/{f}?quality=80&fit=bounds&height=480&width=320"
def iso(d):
    if not d: return ''
    dd,mm,yy = d.split('/'); return f"20{yy}-{mm}-{dd}" if len(yy)==2 else f"{yy}-{mm}-{dd}"
series = {}
others = []
for name, f, price, date in rows:
    m = re.match(r'^(Absolute [A-Za-z ]+?) (\d+)$', name)
    if not m:
        others.append({"title": name, "cover": img_url(f), "price": price, "date": iso(date), "publisher": "Panini", "type": "americano"}); continue
    sname, n = m.group(1), int(m.group(2))
    s = series.setdefault(sname, {"name": sname, "publisher": "Panini", "type": "americano", "ean": None, "issues": {}})
    code = re.search(r'(977\d{10})(\d{5})', f)
    if code:
        ean, add = code.group(1), code.group(2)
        if s["ean"] and s["ean"] != ean: print('EAN distinto', sname, ean, file=sys.stderr)
        s["ean"] = ean
        assert int(add) == n, (name, add)
    s["issues"][str(n)] = {"title": f"{sname} {n}", "cover": img_url(f), "price": price, "date": iso(date)}
out = {"version": 1, "updated": "2026-10-23", "source": "Catálogo oficial de Panini España (panini.es)", "series": [], "isbn": {}, "extras": others}
for s in sorted(series.values(), key=lambda x: x["name"]):
    assert s["ean"], s["name"]
    s["issn"] = issn_from_ean(s["ean"])
    s["issues"] = dict(sorted(s["issues"].items(), key=lambda kv: int(kv[0])))
    out["series"].append(s)
    nums = sorted(map(int, s["issues"]))
    missing = [n for n in range(1, max(nums)+1) if n not in nums]
    print(f'{s["name"]}: ISSN {s["issn"]} ({s["ean"]}), nº {nums[0]}-{nums[-1]}, faltan {missing}', file=sys.stderr)
json.dump(out, open(__import__('os').path.join(__import__('os').path.dirname(__file__), '..', 'catalog', 'catalog.json'),'w'), ensure_ascii=False, indent=1)
