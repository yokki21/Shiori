// Pruebas unitarias: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanGray, isValidEan13 } from '../js/ean.js';
import { normalizeIsbn, isIssnEan, issnFromEan, eanFromIssn, parseTitle, normalizePublisher } from '../js/lookup.js';

// ---------- Generador de códigos de barras sintéticos ----------
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((p) => [...p].map((b) => (b === '0' ? '1' : '0')).join(''));
const G = R.map((p) => [...p].reverse().join(''));
const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const P5 = ['GGLLL', 'GLGLL', 'GLLGL', 'GLLLG', 'LGGLL', 'LLGGL', 'LLLGG', 'LGLGL', 'LGLLG', 'LLGLG'];

function eanBits(code) {
  let b = '101';
  for (let i = 0; i < 6; i++) b += (PAR[+code[0]][i] === 'L' ? L : G)[+code[i + 1]];
  b += '01010';
  for (let i = 7; i < 13; i++) b += R[+code[i]];
  return b + '101';
}
function addonBits(a) {
  let par;
  if (a.length === 2) par = ['LL', 'LG', 'GL', 'GG'][+a % 4];
  else { const d = [...a].map(Number); par = P5[(3 * (d[0] + d[2] + d[4]) + 9 * (d[1] + d[3])) % 10]; }
  let b = '1011';
  [...a].forEach((c, i) => { b += (par[i] === 'L' ? L : G)[+c]; if (i < a.length - 1) b += '01'; });
  return b;
}
// Imagen en grises con el código dibujado (módulo de `mod` píxeles, desenfoque leve y ruido)
function render(bits, { mod = 3, h = 60, noise = 6, reverse = false } = {}) {
  const quiet = 12 * mod;
  const w = bits.length * mod + quiet * 2;
  const row = new Float32Array(w).fill(240);
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') for (let x = 0; x < mod; x++) row[quiet + i * mod + x] = 25;
  const blurred = row.map((v, i) => (row[Math.max(0, i - 1)] + v * 2 + row[Math.min(w - 1, i + 1)]) / 4);
  const img = new Uint8ClampedArray(w * h);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = reverse ? w - 1 - x : x;
    img[y * w + x] = blurred[sx] + rnd() * noise * 2;
  }
  return { img, w, h };
}
const ean = (c12) => { let s = 0; for (let i = 0; i < 12; i++) s += +c12[i] * (i % 2 ? 3 : 1); return c12 + ((10 - (s % 10)) % 10); };

test('dígito de control EAN-13', () => {
  assert.ok(isValidEan13('9788468471495'));
  assert.ok(!isValidEan13('9788468471496'));
  assert.ok(!isValidEan13('97884684714'));
});

test('lee un ISBN dibujado, también al revés', () => {
  for (const code of ['9788468471563', '9788467941159', ean('978841856226')]) {
    for (const mod of [2, 3, 4]) {
      const { img, w, h } = render(eanBits(code), { mod });
      assert.equal(scanGray(img, w, h)?.code, code, `módulo ${mod}`);
    }
    const { img, w, h } = render(eanBits(code), { reverse: true });
    assert.equal(scanGray(img, w, h)?.code, code, 'girado 180°');
  }
});

test('lee el suplemento de 5 y de 2 cifras de las grapas', () => {
  const cases = [['9773081600001', '00012'], ['9773081286007', '00020'], ['9770317847001', '42']];
  for (const [code, add] of cases) {
    const { img, w, h } = render(eanBits(code) + '0'.repeat(9) + addonBits(add), { mod: 3 });
    const r = scanGray(img, w, h);
    assert.equal(r?.code, code);
    assert.equal(r?.addon, add);
  }
});

test('no se inventa códigos en una imagen sin código', () => {
  const w = 400, h = 60;
  const img = new Uint8ClampedArray(w * h).map((_, i) => 128 + ((i * 7919) % 40) - 20);
  assert.equal(scanGray(img, w, h), null);
});

test('ISBN-10 a ISBN-13 y validación', () => {
  assert.equal(normalizeIsbn('978-84-684-7149-5'), '9788468471495');
  assert.equal(normalizeIsbn('84-684-7156-9'), '9788468471563');
  assert.equal(normalizeIsbn('84-684-7156-0'), null);
});

test('ISSN ↔ EAN 977', () => {
  assert.ok(isIssnEan('9773081600001'));
  assert.equal(issnFromEan('9773081600001'), '3081-6009');
  assert.equal(issnFromEan('9773081286007'), '3081-2860');
  assert.equal(eanFromIssn('3081-6009'), '9773081600001');
  assert.equal(eanFromIssn('0317-8471'), '9770317847001');
  assert.equal(eanFromIssn('0317-8472'), null);
});

test('serie y número a partir del título', () => {
  const t = (a, b = '') => { const p = parseTitle(a, b); return [p.series, p.number, p.total]; };
  assert.deepEqual(t('One Piece nº 01'), ['One Piece', 1, null]);
  assert.deepEqual(t('One Piece', 'nº 105'), ['One Piece', 105, null]);
  assert.deepEqual(t('Dragon Ball Super nº 21/24'), ['Dragon Ball Super', 21, 24]);
  assert.deepEqual(t('Chainsaw Man', '5'), ['Chainsaw Man', 5, null]);
  assert.deepEqual(t('One Piece 5, Por quién doblan las campanas'), ['One Piece', 5, null]);
  assert.deepEqual(t('Ultimate Spider-Man, núm. 3'), ['Ultimate Spider-Man', 3, null]);
  assert.deepEqual(t('Akira 2023'), ['', null, null]);
  assert.deepEqual(t('Batman', 'La broma asesina'), ['', null, null]);
});

test('nombres de editorial normalizados', () => {
  assert.equal(normalizePublisher('Planeta DeAgostini Cómics'), 'Planeta Cómic');
  assert.equal(normalizePublisher('Paneta deAgostini'), 'Planeta Cómic');
  assert.equal(normalizePublisher('Norma Editorial S.A.'), 'Norma Editorial');
  assert.equal(normalizePublisher('Editorial Ivrea'), 'Ivrea');
});

test('catálogo: portadas, ISBN, ISSN y búsqueda', async () => {
  const { readFile } = await import('node:fs/promises');
  const json = JSON.parse(await readFile(new URL('../catalog/catalog.json', import.meta.url)));
  globalThis.fetch = async () => ({ ok: true, json: async () => json });
  const cat = await import('../js/catalog.js');
  await cat.loadCatalog();
  const mm = cat.catalogSeries('3081-6009');
  assert.equal(mm?.name, 'Absolute Martian Manhunter');
  const it = cat.catalogIssue(mm, 1);
  assert.equal(it.number, 1);
  assert.match(it.cover, /^https:\/\/www\.panini\.es\/media\/catalog\/product\/.+\?quality=/);
  // Cada ISBN del catálogo se encuentra y trae su serie y número cuando los tiene
  const withIsbn = json.series.flatMap((s) => Object.entries(s.issues).filter(([, i]) => i.isbn).map(([n, i]) => [s.name, +n, i.isbn]));
  assert.ok(withIsbn.length > 500, `tomos con ISBN: ${withIsbn.length}`);
  for (const [name, n, isbn] of withIsbn.slice(0, 200)) {
    const r = cat.catalogByIsbn(isbn);
    assert.equal(r.series, name); assert.equal(r.number, n); assert.equal(r.isbn, isbn);
  }
  // Ningún ISBN repetido en dos fichas distintas
  const all = [...withIsbn.map((x) => x[2]), ...json.extras.filter((e) => e.isbn).map((e) => e.isbn)];
  assert.equal(new Set(all).size, all.length, 'ISBN repetidos');
  // Grapas: ISSN + suplemento -> el número de la serie (aunque el suplemento siga otra numeración)
  assert.equal(cat.catalogByIssue('3081-6009', 12)?.title, 'Absolute Martian Manhunter 12');
  let checked = 0;
  for (const s of json.series) {
    for (const [n, i] of Object.entries(s.issues)) {
      const issn = i.issn || s.issn;
      if (!issn || i.a == null) continue;
      const r = cat.catalogByIssue(issn, i.a);
      if (r?.series === s.name) { assert.equal(r.number, +n); checked++; }
    }
  }
  assert.ok(checked > 0, 'hay grapas con suplemento distinto del número');
  const found = cat.searchCatalog('martian manhunter 3');
  assert.ok(found.some((r) => r.title === 'Absolute Martian Manhunter 3'), JSON.stringify(found.map((r) => r.title)));
});
