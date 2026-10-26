"""Prueba de extremo a extremo de Shiori con un Chromium móvil simulado.

Recorre lo esencial: escanear con la cámara (simulada) una grapa y un tomo, ver la
biblioteca, abrir la ficha y marcar como leído, las series con lo que falta y su precio,
el perfil con estadísticas, la copia de seguridad, borrar el dispositivo y las cuentas
con una nube simulada (sin mezclar colecciones al cambiar de cuenta).

Uso:  pip install playwright pillow && playwright install chromium
      python3 tests/e2e_test.py
"""
import asyncio, json, functools, http.server, io, json, os, re, socketserver, sys, tempfile, threading
from PIL import Image, ImageDraw, ImageFilter
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix='shiori-e2e-')
JPG_PATH = os.path.join(TMP, 'foto.jpg')
FAILS = []

def check(cond, msg):
    print(('  ok  ' if cond else '  FALLO ') + msg)
    if not cond: FAILS.append(msg)

# ---------- Servidor local ----------
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve():
    httpd = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f'http://localhost:{httpd.server_address[1]}/'

# ---------- Vídeo de cámara con un código de barras ----------
L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
R = [''.join('1' if c == '0' else '0' for c in p) for p in L]; G = [p[::-1] for p in R]
PAR = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']
P5 = ['GGLLL','GLGLL','GLLGL','GLLLG','LGGLL','LLGGL','LLLGG','LGLGL','LGLLG','LLGLG']
def ean_bits(code):
    b = '101'
    for i, d in enumerate(code[1:7]): b += (L if PAR[int(code[0])][i] == 'L' else G)[int(d)]
    b += '01010'
    for d in code[7:]: b += R[int(d)]
    return b + '101'
def addon_bits(a):
    if len(a) == 2: par = ['LL','LG','GL','GG'][int(a) % 4]
    else:
        d = list(map(int, a)); par = P5[(3*(d[0]+d[2]+d[4]) + 9*(d[1]+d[3])) % 10]
    b = '1011'
    for i, c in enumerate(a):
        b += (L if par[i] == 'L' else G)[int(c)]
        if i < len(a) - 1: b += '01'
    return b
def camera(code, addon=None):
    bits = ean_bits(code) + ('0' * 9 + addon_bits(addon) if addon else '')
    W, H, mod = 640, 480, 2.2
    img = Image.new('RGB', (W, H), (40, 40, 70)); d = ImageDraw.Draw(img)
    bw = len(bits) * mod; x0 = (W - bw) / 2
    d.rectangle([x0 - 25, 140, x0 + bw + 25, 340], fill=(250, 250, 248))
    i = 0
    while i < len(bits):
        if bits[i] == '1':
            j = i
            while j < len(bits) and bits[j] == '1': j += 1
            d.rectangle([x0 + i*mod, 160 if i < 95 else 185, x0 + j*mod - 1, 310], fill=(20, 20, 20)); i = j
        else: i += 1
    img = img.rotate(-2, resample=Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.6))
    Y, Cb, Cr = img.convert('YCbCr').split(); Cb = Cb.resize((W//2, H//2)); Cr = Cr.resize((W//2, H//2))
    path = os.path.join(TMP, f'{code}-{addon or ""}.y4m')
    with open(path, 'wb') as f:
        f.write(f'YUV4MPEG2 W{W} H{H} F15:1 Ip A1:1 C420jpeg\n'.encode())
        for _ in range(30): f.write(b'FRAME\n' + Y.tobytes() + Cb.tobytes() + Cr.tobytes())
    return path

# ---------- Red simulada ----------
def ean13(c12):
    s = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(c12)); return c12 + str((10 - s % 10) % 10)
CHAINSAW = {ean13('978846794%03d' % n): (f'Chainsaw Man {n}', 8.5) for n in range(1, 6)}
async def google(route):
    m = re.search(r'isbn:(\d{13})', route.request.url); items = []
    if m and m.group(1) in CHAINSAW:
        t, p = CHAINSAW[m.group(1)]
        items = [{'volumeInfo': {'title': t, 'publisher': 'Norma Editorial', 'authors': ['Tatsuki Fujimoto'],
                  'industryIdentifiers': [{'type': 'ISBN_13', 'identifier': m.group(1)}]},
                  'saleInfo': {'listPrice': {'amount': p, 'currencyCode': 'EUR'}}}]
    await route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'},
                        body=json.dumps({'items': items} if items else {'totalItems': 0}))
def jpeg():
    b = io.BytesIO(); Image.new('RGB', (64, 96), (200, 60, 60)).save(b, 'JPEG'); return b.getvalue()
JPEG = jpeg()
open(JPG_PATH, 'wb').write(JPEG)
_cfg = re.sub(r'export const FIREBASE_CONFIG = [\s\S]*?;\n', 'export const FIREBASE_CONFIG = @@;\n', open(os.path.join(ROOT, 'js/config.js')).read())
CONFIG = _cfg.replace('@@', "{ apiKey: 'test', projectId: 'test' }")   # nube simulada
NOCLOUD = _cfg.replace('@@', 'null')                                   # sin cuentas

async def new_page(browser, base, video=None, cloud=False):
    args = {'viewport': {'width': 390, 'height': 844}, 'is_mobile': True, 'has_touch': True, 'service_workers': 'block'}
    if video: args['permissions'] = ['camera']
    ctx = await browser.new_context(**args)
    pg = await ctx.new_page()
    pg.errors = []
    pg.on('pageerror', lambda e: pg.errors.append(str(e)))
    await pg.route('https://www.googleapis.com/**', google)
    await pg.route('https://openlibrary.org/**', lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body='{}')))
    await pg.route('https://covers.openlibrary.org/**', lambda r: asyncio.ensure_future(r.fulfill(status=404, body='')))
    # Planeta: la portada mediana (m_libros) no existe para muchos tomos; la original sí
    await pg.route('https://proassets.planetadelibros.com/**', lambda r: asyncio.ensure_future(r.fulfill(status=404, body='') if '/m_libros/' in r.request.url else r.fulfill(status=200, content_type='image/jpeg', body=JPEG)))
    await pg.route('https://www.panini.es/**', lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type='image/jpeg', body=JPEG)))
    await pg.route('https://fonts.googleapis.com/**', lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type='text/css', body='')))
    body = CONFIG if cloud else NOCLOUD
    await pg.route('**/js/config.js', lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type='text/javascript', body=body)))
    if cloud:
        async def fake(route):
            name = route.request.url.split('/')[-1]
            await route.fulfill(status=200, content_type='text/javascript', headers={'access-control-allow-origin': '*'},
                                body=open(os.path.join(TESTS, 'fakefb', name)).read())
        await pg.route('https://www.gstatic.com/firebasejs/**', fake)
    await pg.goto(base + '?debug'); await pg.wait_for_timeout(700)
    return ctx, pg

async def scan_with_camera(p, base, code, addon=None):
    br = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                                       f'--use-file-for-fake-video-capture={camera(code, addon)}'])
    return br

async def main():
    httpd, base = serve()
    async with async_playwright() as p:
        print('Escanear con la cámara')
        br = await scan_with_camera(p, base, '9773081600001', '00012')
        ctx, pg = await new_page(br, base, video=True)
        await pg.click('#btn-scan'); await pg.wait_for_timeout(5000)
        comics = await pg.evaluate('JSON.stringify(shiori.state.comics.map(c => [c.title, c.number, c.price, !!c.cover]))')
        check('Absolute Martian Manhunter 12' in comics and '4.6' in comics, f'grapa leída por cámara y añadida sola: {comics}')
        check('Añadido' in await pg.inner_text('#scan-log'), 'aviso de añadido en el escáner')
        check(not pg.errors, f'sin errores ({pg.errors})')
        await br.close()

        br = await p.chromium.launch()
        ctx, pg = await new_page(br, base)
        print('Añadir y biblioteca')
        for n in [1, 2, 3, 5]: await pg.evaluate(f"shiori.handleCode('9773081600001', {{addon: '{n:05d}'}})"); await pg.wait_for_timeout(150)
        for code in list(CHAINSAW)[:2]: await pg.evaluate(f"shiori.handleCode('{code}')"); await pg.wait_for_timeout(200)
        await pg.wait_for_timeout(400)
        check(await pg.locator('.book').count() == 6, 'seis cómics en la biblioteca')
        check('Añadido' in (await pg.text_content('#toast-text')), 'aviso «Añadido» con Deshacer')
        await pg.evaluate("shiori.handleCode('9773081600001', {addon: '00001'})"); await pg.wait_for_timeout(300)
        check(await pg.evaluate("document.querySelector('#sheet-detail').open") and 'Ya lo tienes' in await pg.text_content('#toast-text'), 'repetido: abre su ficha y avisa')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.evaluate("shiori.handleCode('9788499999990')"); await pg.wait_for_timeout(500)
        check(await pg.evaluate("document.querySelector('#sheet-comic').open"), 'no encontrado: abre la ficha para completarlo')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)

        print('Ficha y leído')
        await pg.click('.book:has-text("Martian Manhunter 2")'); await pg.wait_for_selector('#sheet-detail[open]')
        body = await pg.inner_text('#detail-body')
        check('Panini' in body and '3,30' in body and '3081-6009' in body, 'la ficha muestra editorial, precio e ISSN')
        await pg.click('#detail-read'); await pg.wait_for_timeout(200)
        check(await pg.get_attribute('#detail-read', 'aria-pressed') == 'true', 'botón «Marcar como leído» funciona')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        check(await pg.locator('.book:has-text("Martian Manhunter 2") .mark-read').count() == 1, 'la portada lleva la marca de leído')
        await pg.click('#lib-filters [data-read="leido"]'); await pg.wait_for_timeout(250)
        check(await pg.locator('.book').count() == 1, 'filtro «Leídos»')
        await pg.click('#lib-filters [data-read=""]'); await pg.wait_for_timeout(250)

        print('Series')
        await pg.click('.tab[data-view=library]'); await pg.click('#lib-mode [data-mode=series]'); await pg.wait_for_timeout(300)
        card = await pg.inner_text('.series-card:has-text("Martian")')
        # publicados 1–11 (el 12 es preventa); tiene 1, 2, 3, 5 → faltan 4, 6–11 = 7, a 3,30 € = 23,10 €
        check('te faltan 7' in card and '23,10' in card, f'faltan y precio para completarla: {card!r}')
        await pg.click('.series-card:has-text("Martian")'); await pg.wait_for_selector('#sheet-series[open]')
        check(await pg.locator('.vol.miss').count() == 7 and await pg.locator('.vol.own').count() == 4, 'la hoja de la serie marca tenidos y faltantes')
        await pg.click('.vol.miss >> nth=0'); await pg.wait_for_selector('#sheet-detail[open]')
        check(await pg.is_visible('#detail-want') and await pg.is_visible('#detail-have'), 'un número que falta abre su ficha con «Lo quiero» y «Ya lo tengo»')
        await pg.click('#detail-have'); await pg.wait_for_timeout(400)
        check(await pg.is_visible('#detail-read'), 'tras añadirlo, la ficha pasa a ser la del cómic tuyo')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        check(await pg.locator('.vol.miss').count() == 6, 'añadir un número que falta desde la serie')
        # El sello de la portada marca el tomo como leído sin abrir la ficha, y vuelve a desmarcarlo
        r0 = await pg.evaluate("shiori.state.comics.filter(c => c.reading === 'leido').length")
        await pg.click('.vol-read:not(.on) >> nth=0'); await pg.wait_for_timeout(300)
        check(await pg.evaluate("shiori.state.comics.filter(c => c.reading === 'leido').length") == r0 + 1 and not await pg.is_visible('#sheet-detail[open]'), 'marcar leído desde la portada de la serie')
        check(await pg.locator('.vol-read.on').count() >= 1, 'el sello queda marcado')
        await pg.click('.vol-read.on >> nth=-1'); await pg.wait_for_timeout(300)
        check(await pg.evaluate("shiori.state.comics.filter(c => c.reading === 'leido').length") == r0, 'y desmarcarlo')
        # En los que faltan: ✓ lo añade y 済 lo añade ya leído (luego se quitan para no cambiar lo que sigue)
        ids0 = await pg.evaluate("shiori.state.comics.map(c => c.id)")
        await pg.click('.vol-have >> nth=0'); await pg.wait_for_timeout(400)
        check(await pg.locator('.vol.miss').count() == 5 and not await pg.is_visible('#sheet-detail[open]'), 'añadir un número que falta con ✓')
        await pg.click('.vol-read[data-readnew] >> nth=0'); await pg.wait_for_timeout(400)
        check(await pg.locator('.vol.miss').count() == 4 and await pg.evaluate("shiori.state.comics.filter(c => c.reading === 'leido').length") == r0 + 1, 'añadir uno que falta ya leído con 済')
        await pg.evaluate("(async (old) => { const m = await import('./js/store.js'); for (const c of [...m.state.comics]) if (!old.includes(c.id)) await m.removeComic(c.id); })(%s)" % json.dumps(ids0)); await pg.wait_for_timeout(300)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)

        print('ISSN escrito y selector por portada')
        await pg.click('#btn-add'); await pg.fill('#add-input', '3081-2860'); await pg.press('#add-input', 'Enter')
        await pg.wait_for_selector('#sheet-pick[open]'); await pg.click('.pick[data-n="7"]'); await pg.wait_for_timeout(400)
        check(await pg.evaluate("shiori.state.comics.some(c => c.title === 'Absolute Batman 7')"), 'ISSN → elegir número → añadido')

        print('Perfil')
        await pg.click('#btn-profile'); await pg.wait_for_timeout(300)
        kpis = await pg.inner_text('.kpis')
        check('8' in kpis and 'invertido' in kpis and 'Completar tus series' in kpis, f'estadísticas: {kpis!r}')
        check(not await pg.locator('#open-account').count(), 'sin Firebase configurado no ofrece cuenta')

        print('Copia de seguridad')
        async with pg.expect_download() as dl: await pg.click('#btn-export')
        data = json.load(open(await (await dl.value).path()))
        check(len(data['comics']) == 8, 'la copia tiene los 8 cómics')
        older = json.loads(json.dumps(data))
        for c in older['comics']: c['reading'] = 'pendiente'; c['updatedAt'] = 1
        older_path = os.path.join(TMP, 'vieja.json'); json.dump(older, open(older_path, 'w'))
        await pg.set_input_files('#import-file', older_path); await pg.wait_for_selector('#sheet-confirm[open]'); await pg.click('#confirm-ok'); await pg.wait_for_timeout(400)
        check(await pg.evaluate("shiori.state.comics.filter(c => c.reading === 'leido').length") == 1, 'una copia vieja no deshace cambios nuevos')
        await pg.click('#btn-wipe'); await pg.wait_for_selector('#sheet-confirm[open]'); await pg.click('#confirm-ok'); await pg.wait_for_timeout(400)
        check(await pg.evaluate('shiori.state.comics.length') == 0, 'borrar este dispositivo')
        await pg.set_input_files('#import-file', older_path.replace('vieja', 'vieja')); await pg.wait_for_selector('#sheet-confirm[open]'); await pg.click('#confirm-ok'); await pg.wait_for_timeout(400)
        check(await pg.evaluate('shiori.state.comics.length') == 8, 'importar una copia en un dispositivo vacío')

        print('Logo, deseados, notas y fechas')
        await pg.click('.tab[data-view=library]'); await pg.click('#lib-mode [data-mode=series]'); await pg.wait_for_timeout(200)
        await pg.click('#brand'); await pg.wait_for_timeout(200)
        check(await pg.is_visible('#lib-grid') and await pg.inner_text('#screen-title') == 'Biblioteca', 'el logo lleva a la biblioteca (cómics)')
        # Próximas novedades: primero lo de tus series y deseados
        await pg.click('.tab[data-view=new]'); await pg.wait_for_timeout(500)
        txt = await pg.inner_text('#new-list')
        check('novedades anunciadas' in txt and 'Para ti' in txt, f'novedades con «Para ti» primero: {txt[:120]!r}')
        mine_first = await pg.evaluate("(() => { const r = [...document.querySelectorAll('#new-list .rel')]; const i = r.findIndex(x => !x.classList.contains('mine')); return i === -1 || r.slice(i).every(x => !x.classList.contains('mine')); })()")
        check(mine_first, 'lo tuyo sale antes que lo demás')
        n0 = await pg.evaluate("shiori.state.comics.filter(c => c.status === 'deseo').length")
        await pg.click('#new-list .row-add >> nth=0'); await pg.wait_for_timeout(400)
        check(await pg.evaluate("shiori.state.comics.filter(c => c.status === 'deseo').length") == n0 + 1, 'desde novedades se añade a deseados')
        await pg.click('#new-filters [data-line="DC"]'); await pg.wait_for_timeout(300)
        check('Marvel' not in await pg.inner_text('#new-list .rel >> nth=-1'), 'filtro por línea')
        await pg.click('#new-filters [data-line=""]'); await pg.click('#new-pubs [data-pub="Planeta Cómic"]'); await pg.wait_for_timeout(300)
        rows = await pg.evaluate("[...document.querySelectorAll('#new-list .rel .row-main span')].map(e => e.textContent)")
        check(all('Planeta Cómic' in r for r in rows), f'filtro por editorial: {len(rows)} de Planeta')
        await pg.click('#new-pubs [data-pub=""]'); await pg.wait_for_timeout(200)
        # Tocar una novedad que no tienes abre su ficha y desde ella se desea
        nw = await pg.evaluate("shiori.state.comics.filter(c => c.status === 'deseo').length")
        await pg.click('#new-list .rel:has(.row-add) .row-main >> nth=0'); await pg.wait_for_selector('#sheet-detail[open]')
        txt = await pg.inner_text('#detail-body')
        check('Sale el' in txt and await pg.is_visible('#detail-want'), f'la novedad abre su ficha: {txt[:80]!r}')
        await pg.click('#detail-want'); await pg.wait_for_timeout(400)
        check(await pg.evaluate("shiori.state.comics.filter(c => c.status === 'deseo').length") == nw + 1 and await pg.is_visible('#detail-own'), 'desde la ficha de la novedad se guarda en deseados')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)

        print('Buscar')
        await pg.click('.tab[data-view=search]'); await pg.wait_for_timeout(200)
        await pg.fill('#search-input', 'one piece'); await pg.wait_for_timeout(800)
        txt = await pg.inner_text('#search-results')
        check('Series' in txt and 'Cómics' in txt and 'One Piece' in txt, f'la búsqueda saca series y cómics: {txt[:100]!r}')
        await pg.click('#search-results .row[data-item] >> nth=0'); await pg.wait_for_selector('#sheet-detail[open]')
        check(await pg.is_visible('#detail-want') or await pg.is_visible('#detail-read') or await pg.is_visible('#detail-own'), 'un cómic de la búsqueda abre su ficha')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.fill('#search-input', 'hunter x hunter'); await pg.wait_for_timeout(800)
        await pg.click('#search-results .row[data-series] >> nth=0'); await pg.wait_for_selector('#sheet-series[open]')
        check(await pg.locator('#series-body .vol').count() > 3, 'una serie del catálogo que no tienes se ve entera')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.fill('#search-input', '9788468471525'); await pg.wait_for_timeout(800)
        check('One Piece' in await pg.inner_text('#search-results'), 'buscar por ISBN')
        await pg.click('.tab[data-view=wish]'); await pg.wait_for_timeout(200)
        await pg.fill('#wish-input', 'absolute flash'); await pg.wait_for_timeout(700)
        await pg.click('#wish-results .series-row .row-add'); await pg.wait_for_timeout(800)
        nwish = await pg.evaluate("shiori.state.comics.filter(c => c.status === 'deseo').length")
        check(nwish >= 10 and 'deseados' in await pg.inner_text('#wish-count'), f'serie entera añadida a deseados ({nwish})')
        await pg.evaluate("shiori.handleCode('9773081595000', {addon: '00003'})"); await pg.wait_for_timeout(500)
        f3 = await pg.evaluate("JSON.stringify(shiori.state.comics.filter(c => c.series === 'Absolute Flash' && c.number === 3).map(c => c.status))")
        check(f3 == '["coleccion"]', f'escanear un deseado lo pasa a la biblioteca: {f3}')
        await pg.click('#wish-grid .book >> nth=0'); await pg.wait_for_selector('#sheet-detail[open]')
        await pg.click('#detail-own'); await pg.wait_for_timeout(400)
        check(await pg.evaluate("shiori.state.comics.filter(c => c.status === 'deseo').length") == nwish - 2, '«Ya lo tengo» pasa el deseado a la biblioteca')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.click('.tab[data-view=library]'); await pg.click('#lib-mode [data-mode=comics]'); await pg.wait_for_timeout(200)
        await pg.click('.book >> nth=0'); await pg.wait_for_selector('#sheet-detail[open]')
        await pg.click('.star[data-star="4"]'); await pg.wait_for_timeout(300)
        await pg.evaluate("(() => { const p = document.querySelector('#date-picker'); p.dataset.field = 'purchaseDate'; p.value = '2025-12-24'; p.dispatchEvent(new Event('change', { bubbles: true })); })()"); await pg.wait_for_timeout(300)
        first = await pg.evaluate("JSON.stringify((() => { const c = [...shiori.state.comics].filter(x => x.status !== 'deseo').sort((a, b) => b.createdAt - a.createdAt)[0]; return [c.rating, c.purchaseDate]; })())")
        check(first == '[4,"2025-12-24"]', f'nota propia y fecha de compra editable: {first}')
        check(await pg.locator('#sheet-detail .ext').count() == 3, 'enlaces a notas en otras plataformas')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)

        print('Catálogo de Planeta Cómic')
        await pg.evaluate("shiori.handleCode('9788468471525')"); await pg.wait_for_timeout(400)
        op = await pg.evaluate("JSON.stringify(shiori.state.comics.filter(c => c.isbn === '9788468471525').map(c => [c.series, c.number, c.publisher, (c.cover || '').slice(0, 40)]))")
        check('"One Piece",1,"Planeta Cómic","https://proassets.planetadelibros.com' in op, f'tomo de Planeta por ISBN, con serie, número y portada: {op}')
        await pg.click('.tab[data-view=library]'); await pg.click('#lib-mode [data-mode=comics]'); await pg.wait_for_timeout(400)
        src = await pg.evaluate("(() => { const c = shiori.state.comics.find(c => c.isbn === '9788468471525'); const i = [...document.querySelectorAll('#lib-grid img')].find(i => i.src.includes('one-piece-n-001')); return i ? i.src : 'sin img'; })()")
        check('/original/' in src, f'portada de Planeta sin versión mediana: se usa la original ({src[-60:]})')
        fb = await pg.evaluate("""(async () => { const m = await import('./js/util.js'); const d = document.createElement('div');
          d.innerHTML = m.coverHTML({ title: 'x', cover: 'https://proassets.planetadelibros.com/usuaris/libros/fotos/1/m_libros/a.jpg' }, { lazy: false });
          document.body.append(d); await new Promise(r => setTimeout(r, 800)); const i = d.querySelector('img'); const out = i ? i.src : 'sin img'; d.remove(); return out; })()""")
        check('/original/a.jpg' in fb, f'una portada mediana que falla se cambia por la original: {fb}')

        print('Catálogo de Norma')
        await pg.evaluate("shiori.handleCode('9788467985078')"); await pg.wait_for_timeout(400)
        cm = await pg.evaluate("JSON.stringify(shiori.state.comics.filter(c => c.isbn === '9788467985078').map(c => [c.series, c.number, c.publisher, (c.cover || '').slice(0, 40)]))")
        check('"Chainsaw Man",23,"Norma Editorial","https://www.normaeditorial.com/upload' in cm, f'tomo de Norma por ISBN, con serie, número y portada: {cm}')
        await pg.click('.tab[data-view=new]'); await pg.click('#new-pubs [data-pub="Norma Editorial"]'); await pg.wait_for_timeout(300)
        rows = await pg.evaluate("[...document.querySelectorAll('#new-list .rel .row-main span')].map(e => e.textContent)")
        check(all('Norma Editorial' in r for r in rows), f'filtro Norma en novedades: {len(rows)}')
        await pg.click('#new-pubs [data-pub=""]')

        print('Catálogo de Ivrea')
        await pg.evaluate("shiori.handleCode('9788418172052')"); await pg.wait_for_timeout(400)
        gs = await pg.evaluate("JSON.stringify(shiori.state.comics.filter(c => c.isbn === '9788418172052').map(c => [c.series, c.number, c.publisher, c.price]))")
        check(gs == '[["Goblin Slayer",3,"Ivrea",8.5]]', f'tomo de Ivrea por ISBN (de La Comiquería), con serie, número y precio: {gs}')
        await pg.click('.tab[data-view=search]'); await pg.fill('#search-input', 'goblin slayer'); await pg.wait_for_timeout(800)
        txt = await pg.inner_text('#search-results')
        check('Ivrea' in txt, f'las series de Ivrea salen en la búsqueda: {txt[:120]!r}')
        await pg.click('#search-results .row[data-series]:has-text("Ivrea") >> nth=0'); await pg.wait_for_selector('#sheet-series[open]')
        check(await pg.locator('#series-body .vol').count() >= 10, 'la serie de Ivrea trae sus tomos')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.click('.tab[data-view=new]'); await pg.click('#new-pubs [data-pub="Ivrea"]'); await pg.wait_for_timeout(300)
        rows = await pg.evaluate("[...document.querySelectorAll('#new-list .rel .row-main span')].map(e => e.textContent)")
        check(len(rows) > 10 and all('Ivrea' in r for r in rows), f'filtro Ivrea en novedades: {len(rows)}')
        await pg.click('#new-pubs [data-pub=""]')

        print('Catálogo de Panini')
        # El suplemento numera la colección ISSN: el 00021 de 2938-5199 es «Capitán América 4»
        await pg.evaluate("shiori.handleCode('9772938519008', {addon: '00021'})"); await pg.wait_for_timeout(400)
        check(await pg.evaluate("shiori.state.comics.some(c => c.series === 'Capitán América' && c.number === 4)"), 'grapa cuyo suplemento sigue otra numeración')
        await pg.evaluate("shiori.handleCode('9772938519008', {addon: '00021'})"); await pg.wait_for_timeout(300)
        check(await pg.evaluate("shiori.state.comics.filter(c => c.series === 'Capitán América').length") == 1, 'escanearla otra vez no la duplica')
        # Tomo por ISBN con serie y número
        await pg.evaluate("shiori.handleCode('9788411503358')"); await pg.wait_for_timeout(400)
        check(await pg.evaluate("shiori.state.comics.some(c => c.isbn === '9788411503358' && c.series && c.number)"), 'tomo de Panini por ISBN, con serie y número')
        # Colección sin número impreso: el tomo entra en la serie «Marvel Must-Have» con su título
        await pg.evaluate("shiori.handleCode('9788413342610')"); await pg.wait_for_timeout(400)
        mh = await pg.evaluate("JSON.stringify(shiori.state.comics.filter(c => c.series === 'Marvel Must-Have').map(c => [c.title, c.number]))")
        check('Desunidos' in mh, f'Marvel Must-Have como serie: {mh}')
        await pg.click('.tab[data-view=library]'); await pg.click('#lib-mode [data-mode=series]'); await pg.wait_for_timeout(300)
        await pg.click('.series-card:has-text("Marvel Must-Have")'); await pg.wait_for_selector('#sheet-series[open]')
        own = await pg.inner_text('#series-body .vol.own .vol-n')
        check('Desunidos' in own and 'Te faltan' in await pg.inner_text('#series-body'), f'la colección muestra títulos en vez de números: {own!r}')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.click('.tab[data-view=library]'); await pg.click('#lib-mode [data-mode=comics]'); await pg.wait_for_timeout(200)
        await pg.click('#btn-add'); await pg.fill('#add-input', 'lobezno 3'); await pg.press('#add-input', 'Enter'); await pg.wait_for_timeout(500)
        first = await pg.inner_text('#add-results .row >> nth=0 >> b')
        check(first == 'Lobezno 3', f'buscar por título en el catálogo: {first!r}')
        await pg.keyboard.press('Escape')
        check(not pg.errors, f'sin errores ({pg.errors})')
        await ctx.close()

        print('Cuentas (nube simulada)')
        ctx, pg = await new_page(br, base, cloud=True)
        for n in [1, 2]: await pg.evaluate(f"shiori.handleCode('9773081600001', {{addon: '{n:05d}'}})"); await pg.wait_for_timeout(150)
        await pg.click('#btn-profile'); await pg.click('#open-account'); await pg.wait_for_selector('#sheet-account[open]')
        await pg.fill('#acc-email', 'a@test.es'); await pg.fill('#acc-pass', '123'); await pg.click('[data-act="up"]'); await pg.wait_for_timeout(300)
        check('6 caracteres' in await pg.text_content('#acc-msg'), 'contraseña corta rechazada')
        await pg.fill('#acc-pass', 'secreta1'); await pg.click('[data-act="up"]'); await pg.wait_for_timeout(1200)
        cloud = await pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('fakecloud') || '{}')).filter(k => k.includes('/comics/')).length")
        check(cloud == 2, f'al crear la cuenta se suben los cómics ({cloud})')
        # Nombre de usuario único y foto de perfil
        await pg.click('#open-account'); await pg.wait_for_selector('#sheet-account[open]')
        await pg.fill('#acc-username', 'Joaquin_M'); await pg.click('#acc-name-save'); await pg.wait_for_timeout(500)
        names = await pg.evaluate("JSON.parse(localStorage.getItem('fakecloud'))['usernames/joaquin_m']")
        check(names and await pg.evaluate("shiori.state.profile.username") == 'joaquin_m', f'nombre de usuario reservado: {names}')
        await pg.set_input_files('#acc-photo', JPG_PATH); await pg.wait_for_timeout(800)
        photos = await pg.evaluate("Object.entries(JSON.parse(localStorage.getItem('fakecloud'))).filter(([k]) => /^users\\/[^/]+$/.test(k)).map(([, v]) => (v.photo || '').slice(0, 15))")
        check(any(x.startswith('data:image/jpeg') for x in photos), f'foto de perfil guardada en la cuenta {photos}')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        check('@joaquin_m' in await pg.inner_text('#profile-head') and await pg.locator('#profile-head .avatar.photo img').count() == 1, 'el perfil muestra @nombre y la foto')
        await pg.click('#btn-wipe'); await pg.wait_for_selector('#sheet-confirm[open]'); await pg.click('#confirm-ok'); await pg.wait_for_timeout(500)
        cloud2 = await pg.evaluate("Object.entries(JSON.parse(localStorage.getItem('fakecloud'))).filter(([k, v]) => k.includes('/comics/') && !v.deleted).length")
        check(cloud2 == 2, 'borrar el dispositivo NO borra la nube')
        await pg.click('#open-account'); await pg.wait_for_selector('#sheet-account[open]')
        await pg.fill('#acc-email', 'b@test.es'); await pg.fill('#acc-pass', 'secreta2'); await pg.click('[data-act="up"]'); await pg.wait_for_timeout(1000)
        check(await pg.evaluate("shiori.state.profile.username") == '', 'otra cuenta no hereda el perfil')
        await pg.click('#open-account'); await pg.wait_for_selector('#sheet-account[open]')
        await pg.fill('#acc-username', 'joaquin_m'); await pg.click('#acc-name-save'); await pg.wait_for_timeout(500)
        check('ya lo tiene' in await pg.inner_text('#acc-name-msg'), 'un nombre cogido no se puede repetir')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.evaluate("shiori.handleCode('9773081286007', {addon: '00001'})"); await pg.wait_for_timeout(400)
        await pg.click('#open-account'); await pg.wait_for_selector('#sheet-account[open]'); await pg.click('#acc-out'); await pg.wait_for_timeout(300)
        await pg.click('#open-account'); await pg.wait_for_selector('#sheet-account[open]')
        await pg.fill('#acc-email', 'a@test.es'); await pg.fill('#acc-pass', 'secreta1'); await pg.click('[data-act="in"]'); await pg.wait_for_timeout(1200)
        titles = await pg.evaluate("JSON.stringify(shiori.state.comics.map(c => c.title).sort())")
        check(titles == json.dumps(['Absolute Martian Manhunter 1', 'Absolute Martian Manhunter 2']).replace(' ', '') or titles == '["Absolute Martian Manhunter 1","Absolute Martian Manhunter 2"]',
              f'al entrar con otra cuenta no se mezclan colecciones: {titles}')
        a_cloud = await pg.evaluate("Object.entries(JSON.parse(localStorage.getItem('fakecloud'))).filter(([k, v]) => k.startsWith('users/u_atestes/') && !v.deleted).length")
        check(a_cloud == 2, 'la cuenta A sigue con sus 2 cómics')
        check(not pg.errors, f'sin errores ({pg.errors})')
        await br.close()
    httpd.shutdown()
    print(f'\n{"TODO BIEN" if not FAILS else f"{len(FAILS)} FALLOS"}')
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
