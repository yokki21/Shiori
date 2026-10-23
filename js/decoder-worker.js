// Decodifica códigos de barras fuera del hilo principal para que la interfaz no se trabe.
import { scanGray, toGray } from './ean.js';

self.onmessage = (e) => {
  const { id, data, w, h, opts } = e.data;
  let result = null;
  try { result = scanGray(toGray(data, w, h), w, h, opts); } catch { result = null; }
  self.postMessage({ id, result });
};
