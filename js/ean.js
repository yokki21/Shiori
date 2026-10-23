// Lector de códigos EAN-13 (ISBN) propio, sin dependencias.
// Recorre líneas de la imagen, mide el ancho de barras y espacios y los
// compara con los patrones del estándar. Se usa cuando el navegador no
// trae BarcodeDetector (iPhone, Firefox, escritorio).

const L = [
  [3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2],
  [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2],
];
const G = L.map((p) => [...p].reverse());
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function isValidEan13(code) {
  if (!/^\d{13}$/.test(code)) return false;
  let s = 0;
  for (let i = 0; i < 12; i++) s += +code[i] * (i % 2 ? 3 : 1);
  return (10 - (s % 10)) % 10 === +code[12];
}

function matchDigit(runs, i, sets) {
  const tot = runs[i] + runs[i + 1] + runs[i + 2] + runs[i + 3];
  const k = 7 / tot;
  let best = null;
  let bestErr = Infinity;
  for (const [name, patterns] of sets) {
    for (let d = 0; d < 10; d++) {
      const p = patterns[d];
      let e = 0;
      for (let j = 0; j < 4; j++) e += Math.abs(runs[i + j] * k - p[j]);
      // bordes similares (barra+espacio): resiste mejor la tinta corrida
      e += 0.5 * Math.abs((runs[i] + runs[i + 1]) * k - (p[0] + p[1]));
      e += 0.5 * Math.abs((runs[i + 1] + runs[i + 2]) * k - (p[1] + p[2]));
      if (e < bestErr) { bestErr = e; best = { d, set: name, err: e, tot }; }
    }
  }
  return best;
}

const LEFT_SETS = [['L', L], ['G', G]];
const RIGHT_SETS = [['R', L]];

function guardOk(runs, i, n, m) {
  for (let j = 0; j < n; j++) {
    const r = runs[i + j] / m;
    if (r < 0.3 || r > 2.2) return false;
  }
  return true;
}

// runs: anchos alternos empezando por barra en `s`
function decodeAt(runs, s) {
  if (s + 59 > runs.length) return null;
  let total = 0;
  for (let j = 0; j < 59; j++) total += runs[s + j];
  const m = total / 95;
  if (m < 0.7) return null;
  if (s > 0 && runs[s - 1] < 2.5 * m) return null; // zona en blanco antes
  if (s + 59 < runs.length && runs[s + 59] < 2.5 * m) return null; // y después
  if (!guardOk(runs, s, 3, m) || !guardOk(runs, s + 27, 5, m) || !guardOk(runs, s + 56, 3, m)) return null;

  let parity = '';
  let digits = '';
  let err = 0;
  for (let j = 0; j < 6; j++) {
    const r = matchDigit(runs, s + 3 + 4 * j, LEFT_SETS);
    const w = r.tot / m;
    if (r.err > 1.9 || w < 5 || w > 9) return null;
    parity += r.set; digits += r.d; err += r.err;
  }
  const first = PARITY.indexOf(parity);
  if (first < 0) return null;
  for (let j = 0; j < 6; j++) {
    const r = matchDigit(runs, s + 32 + 4 * j, RIGHT_SETS);
    const w = r.tot / m;
    if (r.err > 1.9 || w < 5 || w > 9) return null;
    digits += r.d; err += r.err;
  }
  const code = first + digits;
  if (!isValidEan13(code)) return null;
  // Código pequeño a la derecha (2 o 5 cifras): en revistas y grapas, el número
  const addon = s + 60 < runs.length ? decodeAddon(runs, s + 60, m) : null;
  return { code, err, addon };
}

const ADDON5_PARITY = ['GGLLL', 'GLGLL', 'GLLGL', 'GLLLG', 'LGGLL', 'LLGGL', 'LLLGG', 'LGLGL', 'LGLLG', 'LLGLG'];

function near(runs, i, m, target) {
  const r = runs[i] / m;
  return r > target * 0.45 && r < target * 1.9 + 0.4;
}

// a: índice de la primera barra del guarda del suplemento (1011)
function decodeAddon(runs, a, m) {
  const gap = runs[a - 1] / m; // separación respecto al código principal: 7–12 módulos
  if (gap < 4 || gap > 18) return null;
  if (a + 13 > runs.length) return null;
  if (!near(runs, a, m, 1) || !near(runs, a + 1, m, 1) || !near(runs, a + 2, m, 2)) return null;
  for (const n of [5, 2]) {
    let idx = a + 3, digits = '', parity = '', ok = true;
    for (let j = 0; j < n && ok; j++) {
      if (idx + 4 > runs.length) { ok = false; break; }
      const r = matchDigit(runs, idx, LEFT_SETS);
      const w = r.tot / m;
      if (r.err > 1.9 || w < 5 || w > 9) { ok = false; break; }
      digits += r.d; parity += r.set; idx += 4;
      if (j < n - 1) {
        if (idx + 2 > runs.length || !near(runs, idx, m, 1) || !near(runs, idx + 1, m, 1)) { ok = false; break; }
        idx += 2;
      }
    }
    if (!ok) continue;
    // Detrás tiene que venir margen en blanco (o el final de la línea)
    if (idx < runs.length - 1 && runs[idx] < 2.5 * m) continue;
    if (n === 2) {
      if (['LL', 'LG', 'GL', 'GG'][+digits % 4] === parity) return digits;
    } else {
      const d = digits.split('').map(Number);
      const chk = (3 * (d[0] + d[2] + d[4]) + 9 * (d[1] + d[3])) % 10;
      if (ADDON5_PARITY[chk] === parity) return digits;
    }
  }
  return null;
}

function decodeRuns(runs, firstDark) {
  // índices donde empieza una barra
  for (let s = firstDark ? 0 : 1; s + 59 <= runs.length; s += 2) {
    const r = decodeAt(runs, s);
    if (r) return r;
  }
  return null;
}

// Convierte una línea de luminancias en anchos de barras/espacios con
// bordes interpolados (precisión subpíxel) y umbral local.
function lineToRuns(v) {
  const n = v.length;
  let gMin = 255, gMax = 0;
  for (let i = 0; i < n; i++) { if (v[i] < gMin) gMin = v[i]; if (v[i] > gMax) gMax = v[i]; }
  if (gMax - gMin < 30) return null;
  const gMid = (gMin + gMax) / 2;
  const W = Math.max(12, Math.round(n / 14));
  const t = new Float32Array(n);
  // mínimo/máximo deslizante (ventana centrada)
  for (let i = 0; i < n; i++) {
    let lo = 255, hi = 0;
    const a = Math.max(0, i - W), b = Math.min(n - 1, i + W);
    for (let j = a; j <= b; j += 2) { const x = v[j]; if (x < lo) lo = x; if (x > hi) hi = x; }
    t[i] = hi - lo < 0.3 * (gMax - gMin) ? gMid : (lo + hi) / 2;
  }
  const edges = [];
  let dark = v[0] < t[0];
  const firstDark = dark;
  for (let i = 1; i < n; i++) {
    const d = v[i] < t[i];
    if (d !== dark) {
      const a = v[i - 1] - t[i - 1], b = v[i] - t[i];
      const f = a === b ? 0.5 : a / (a - b);
      edges.push(i - 1 + Math.min(1, Math.max(0, f)));
      dark = d;
    }
  }
  return finishRuns(v, edges, firstDark, gMax - gMin);
}

// Alternativa: bordes en los máximos de la derivada. Funciona mejor con
// imágenes desenfocadas, donde los espacios finos no llegan a blanco.
function lineToRunsGradient(v) {
  const n = v.length;
  const s = new Float32Array(n);
  s[0] = v[0]; s[n - 1] = v[n - 1];
  for (let i = 1; i < n - 1; i++) s[i] = (v[i - 1] + 2 * v[i] + v[i + 1]) / 4;
  const d = new Float32Array(n);
  let dMax = 0;
  for (let i = 1; i < n - 1; i++) { d[i] = s[i + 1] - s[i - 1]; const a = Math.abs(d[i]); if (a > dMax) dMax = a; }
  if (dMax < 20) return null;
  const T = Math.max(6, 0.09 * dMax);
  const ext = []; // [pos, signo, magnitud]
  for (let i = 2; i < n - 2; i++) {
    const a = Math.abs(d[i]);
    if (a < T || a < Math.abs(d[i - 1]) || a <= Math.abs(d[i + 1])) continue;
    const den = d[i - 1] - 2 * d[i] + d[i + 1];
    const off = den === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (d[i - 1] - d[i + 1]) / (2 * den)));
    const sg = d[i] > 0 ? 1 : -1;
    const last = ext[ext.length - 1];
    if (last && last[1] === sg) { if (a > last[2]) ext[ext.length - 1] = [i + off, sg, a]; }
    else ext.push([i + off, sg, a]);
  }
  if (ext.length < 58) return null;
  let gMin = 255, gMax = 0;
  for (let i = 0; i < n; i++) { if (v[i] < gMin) gMin = v[i]; if (v[i] > gMax) gMax = v[i]; }
  // primer borde oscuro→claro (derivada positiva): la línea empieza en barra
  return finishRuns(v, ext.map((e) => e[0]), ext[0][1] > 0, gMax - gMin);
}

// Quita bordes falsos por ruido: si un tramo apenas se distingue en
// intensidad de sus vecinos, se fusiona con ellos. Devuelve los anchos.
function finishRuns(v, edges, firstDark, range) {
  if (edges.length < 58) return null;
  const n = v.length;
  const bounds = [0, ...edges, n - 1];
  // tramo i va de bounds[i] a bounds[i+1]; oscuro si (i par) === firstDark
  const extOf = (a, b, dark) => {
    let e = dark ? 255 : 0;
    for (let x = Math.ceil(a); x <= Math.floor(b); x++) e = dark ? Math.min(e, v[x]) : Math.max(e, v[x]);
    if (Math.floor(b) < Math.ceil(a)) e = v[Math.round((a + b) / 2)];
    return e;
  };
  let segs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const dark = (i % 2 === 0) === firstDark;
    segs.push({ a: bounds[i], b: bounds[i + 1], dark, e: extOf(bounds[i], bounds[i + 1], dark) });
  }
  const C = 0.12 * range;
  for (let guard = 0; guard < 400; guard++) {
    let worst = -1, worstC = C;
    for (let i = 1; i < segs.length - 1; i++) {
      const c = Math.min(Math.abs(segs[i].e - segs[i - 1].e), Math.abs(segs[i].e - segs[i + 1].e));
      if (c < worstC) { worstC = c; worst = i; }
    }
    if (worst < 0) break;
    const p = segs[worst - 1], q = segs[worst + 1];
    const merged = { a: p.a, b: q.b, dark: p.dark, e: p.dark ? Math.min(p.e, q.e) : Math.max(p.e, q.e) };
    segs.splice(worst - 1, 3, merged);
  }
  if (segs.length < 59) return null;
  return { runs: segs.map((sg) => sg.b - sg.a), firstDark: segs[0].dark };
}

function decodeLine(v) {
  return decodeFrom(lineToRunsGradient(v)) || decodeFrom(lineToRuns(v));
}

function decodeFrom(lr) {
  if (!lr) return null;
  const fw = decodeRuns(lr.runs, lr.firstDark);
  if (fw) return fw;
  // código al revés (libro girado 180°)
  const rev = lr.runs.slice().reverse();
  const lastDark = (lr.runs.length % 2 === 1) ? lr.firstDark : !lr.firstDark;
  return decodeRuns(rev, lastDark);
}

export function toGray(rgba, w, h) {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }
  return g;
}

// Busca un EAN-13 en una imagen en grises. Devuelve el código más votado.
export function scanGray(gray, w, h, { lines = 24, horizontal = true, vertical = false } = {}) {
  const votes = new Map();
  const addons = new Map(); // código → { suplemento: votos }
  const vote = (r) => {
    if (!r) return;
    votes.set(r.code, (votes.get(r.code) || 0) + 1);
    if (r.addon) {
      const m = addons.get(r.code) || new Map();
      m.set(r.addon, (m.get(r.addon) || 0) + 1);
      addons.set(r.code, m);
    }
  };
  if (horizontal) {
    const buf = new Float32Array(w);
    for (let k = 1; k <= lines; k++) {
      const y = Math.round((h * k) / (lines + 1));
      for (let x = 0; x < w; x++) {
        // media de 3 filas para quitar ruido
        const y0 = Math.max(0, y - 1), y2 = Math.min(h - 1, y + 1);
        buf[x] = (gray[y0 * w + x] + gray[y * w + x] + gray[y2 * w + x]) / 3;
      }
      vote(decodeLine(buf));
    }
  }
  if (vertical) {
    const buf = new Float32Array(h);
    for (let k = 1; k <= lines; k++) {
      const x = Math.round((w * k) / (lines + 1));
      for (let y = 0; y < h; y++) {
        const x0 = Math.max(0, x - 1), x2 = Math.min(w - 1, x + 1);
        buf[y] = (gray[y * w + x0] + gray[y * w + x] + gray[y * w + x2]) / 3;
      }
      vote(decodeLine(buf));
    }
  }
  let best = null, bestN = 0;
  for (const [code, n] of votes) if (n > bestN) { best = code; bestN = n; }
  if (!best) return null;
  let addon = null, aN = 0;
  for (const [a, n] of addons.get(best) || []) if (n > aN) { addon = a; aN = n; }
  return { code: best, votes: bestN, addon };
}

