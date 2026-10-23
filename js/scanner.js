// Cámara + detección de códigos. Usa el lector nativo del navegador
// (BarcodeDetector, en Chrome Android) y, si no existe, el lector propio.

import { scanGray, toGray, isValidEan13 } from './ean.js';

async function nativeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    const want = ['ean_13', 'upc_a', 'ean_8'].filter((f) => formats.includes(f));
    if (!want.includes('ean_13')) return null;
    return new window.BarcodeDetector({ formats: want });
  } catch {
    return null;
  }
}

function cleanCode(raw) {
  let c = String(raw || '').replace(/\D/g, '');
  if (c.length === 12) c = '0' + c; // UPC-A → EAN-13
  return c.length === 13 && isValidEan13(c) ? c : null;
}

export class Scanner {
  constructor(video, { onCode, onError }) {
    this.video = video;
    this.onCode = onCode;
    this.onError = onError;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.running = false;
    this.paused = false;
    this.frame = 0;
    this.last = null; // último código leído por el lector propio (para confirmar)
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('nocamera');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    this.track = this.stream.getVideoTracks()[0];
    try { await this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* opcional */ }
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    this.native = await nativeDetector();
    this.running = true;
    this.loop();
  }

  get torchAvailable() {
    try { return !!this.track?.getCapabilities?.().torch; } catch { return false; }
  }

  async setTorch(on) {
    try { await this.track.applyConstraints({ advanced: [{ torch: on }] }); return true; } catch { return false; }
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  pause(ms) {
    this.paused = true;
    clearTimeout(this.resumeTimer);
    if (ms) this.resumeTimer = setTimeout(() => { this.paused = false; this.last = null; }, ms);
  }

  resume() { this.paused = false; this.last = null; }

  async loop() {
    if (!this.running) return;
    const t0 = performance.now();
    try {
      if (!this.paused && this.video.readyState >= 2) {
        let hit = this.native ? await this.detectNative() : this.detectOwn();
        if (hit) hit = this.withAddon(hit);
        if (hit && !this.paused) this.onCode(hit.code, hit.addon);
      }
    } catch (e) {
      if (this.native) { this.native = null; } else this.onError?.(e);
    }
    const spent = performance.now() - t0;
    this.timer = setTimeout(() => this.loop(), Math.max(40, 110 - spent));
  }

  async detectNative() {
    const found = await this.native.detect(this.video);
    for (const b of found) {
      const c = cleanCode(b.rawValue);
      if (c) return { code: c, addon: null };
    }
    return null;
  }

  // Las revistas (código 977…, ISSN) llevan el número en un suplemento de
  // 2 o 5 cifras. El lector nativo no lo da, así que se busca con el propio
  // durante un momento antes de dar el código por bueno.
  withAddon(hit) {
    if (!hit.code.startsWith('977') || hit.addon) { this.pendingAddon = null; return hit; }
    const extra = this.native ? this.ownScan(false, 30) : null;
    if (extra?.code === hit.code && extra.addon) { this.pendingAddon = null; return { code: hit.code, addon: extra.addon }; }
    const now = performance.now();
    if (this.pendingAddon?.code !== hit.code) this.pendingAddon = { code: hit.code, since: now };
    if (now - this.pendingAddon.since < 1500) return null; // sigue intentándolo
    this.pendingAddon = null;
    return hit;
  }

  detectOwn() {
    if (!this.video.videoWidth) return null;
    this.frame++;
    const vertical = this.frame % 3 === 0; // de vez en cuando, código en vertical
    const r = this.ownScan(vertical, 18);
    if (!r) return null;
    // Confirmación: dos líneas coinciden en el mismo fotograma o en dos seguidos
    if (r.votes >= 2 || this.last?.code === r.code) {
      const addon = r.addon || (this.last?.code === r.code ? this.last.addon : null);
      this.last = null;
      return { code: r.code, addon };
    }
    this.last = r;
    return null;
  }

  ownScan(vertical, lines) {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh) return null;
    let sx, sy, sw, sh;
    if (!vertical) { sw = vw * 0.9; sh = vh * 0.45; } else { sw = vw * 0.45; sh = vh * 0.9; }
    sx = (vw - sw) / 2; sy = (vh - sh) / 2;
    const scale = Math.min(1, 1280 / Math.max(sw, sh));
    const w = Math.round(sw * scale), h = Math.round(sh * scale);
    this.canvas.width = w; this.canvas.height = h;
    this.ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h);
    return scanGray(toGray(img.data, w, h), w, h, { lines, horizontal: !vertical, vertical });
  }
}

// Lee un código desde una foto (galería o cámara del sistema): { code, addon }
export async function scanFile(file) {
  const bmp = await createImageBitmap(file);
  const native = await nativeDetector();
  let fallback = null;
  if (native) {
    try {
      const found = await native.detect(bmp);
      for (const b of found) {
        const c = cleanCode(b.rawValue);
        if (c && !c.startsWith('977')) return { code: c, addon: null };
        if (c) fallback = c; // revista: se intenta leer también el suplemento
      }
    } catch { /* sigue con el lector propio */ }
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (const maxSide of [1600, 1000, 2400]) {
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    canvas.width = w; canvas.height = h;
    ctx.drawImage(bmp, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const r = scanGray(toGray(img.data, w, h), w, h, { lines: 60, horizontal: true, vertical: true });
    if (r) return { code: r.code, addon: r.addon };
  }
  return fallback ? { code: fallback, addon: null } : null;
}
