"use client";

/**
 * Canvas helpers. Masks live in the alpha channel of a white canvas at the project's edit
 * resolution; they are converted to opaque black/white PNGs only when sent to ComfyUI.
 */

export type MaskCanvas = HTMLCanvasElement;

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: HTMLCanvasElement) {
  return c.getContext("2d", { willReadFrequently: true })!;
}

export async function bitmapFromBlob(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

export function toBlob(c: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas encode failed"))), type, quality));
}

export function fitWithin(w: number, h: number, maxSide: number) {
  const s = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

export async function resizeBlob(src: CanvasImageSource, w: number, h: number, type = "image/png", quality?: number): Promise<Blob> {
  const c = canvas(w, h);
  const x = ctx2d(c);
  x.imageSmoothingQuality = "high";
  x.drawImage(src, 0, 0, w, h);
  return toBlob(c, type, quality);
}

/** Centre-crops to a square, which is what CLIP Vision sees anyway. */
export async function squareCropBlob(src: ImageBitmap, size: number): Promise<Blob> {
  const s = Math.min(src.width, src.height);
  const c = canvas(size, size);
  const x = ctx2d(c);
  x.imageSmoothingQuality = "high";
  x.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
  return toBlob(c, "image/png");
}

export function pixelsOf(src: CanvasImageSource & { width: number; height: number }, maxSide: number): ImageData {
  const { width, height } = fitWithin(src.width, src.height, maxSide);
  const c = canvas(width, height);
  const x = ctx2d(c);
  x.drawImage(src, 0, 0, width, height);
  return x.getImageData(0, 0, width, height);
}

export function newMask(w: number, h: number): MaskCanvas {
  return canvas(w, h);
}

export function cloneMask(m: MaskCanvas): MaskCanvas {
  const c = canvas(m.width, m.height);
  ctx2d(c).drawImage(m, 0, 0);
  return c;
}

/** Loads a stored alpha mask PNG. */
export async function maskFromStoredBlob(blob: Blob, w: number, h: number): Promise<MaskCanvas> {
  const bmp = await bitmapFromBlob(blob);
  const c = canvas(w, h);
  ctx2d(c).drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return c;
}

/** Converts a ComfyUI black/white mask image into an alpha mask at (w,h). */
export async function maskFromBwBlob(blob: Blob, w: number, h: number): Promise<MaskCanvas> {
  const bmp = await bitmapFromBlob(blob);
  const c = canvas(w, h);
  const x = ctx2d(c);
  x.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] > 127 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = v;
  }
  x.putImageData(img, 0, 0);
  return c;
}

/** Bounding box of the mask's set pixels, scaled to (w,h); null when the mask is empty. */
export function maskBBox(m: MaskCanvas, w = m.width, h = m.height): { x: number; y: number; width: number; height: number } | null {
  const d = ctx2d(m).getImageData(0, 0, m.width, m.height).data;
  let x0 = m.width, y0 = m.height, x1 = -1, y1 = -1;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (d[(y * m.width + x) * 4 + 3] > 127) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const sx = w / m.width, sy = h / m.height;
  return { x: Math.floor(x0 * sx), y: Math.floor(y0 * sy), width: Math.ceil((x1 - x0 + 1) * sx), height: Math.ceil((y1 - y0 + 1) * sy) };
}

export function maskCoverage(m: MaskCanvas): number {
  const d = ctx2d(m).getImageData(0, 0, m.width, m.height).data;
  let on = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 127) on++;
  return on / (m.width * m.height);
}

/** Removes `cutter`'s area from `target` in place. */
export function subtractMask(target: MaskCanvas, cutter: MaskCanvas) {
  const x = ctx2d(target);
  x.save();
  x.globalCompositeOperation = "destination-out";
  x.drawImage(cutter, 0, 0, target.width, target.height);
  x.restore();
}

export function unionInto(target: MaskCanvas, src: MaskCanvas) {
  ctx2d(target).drawImage(src, 0, 0, target.width, target.height);
}

/** Dilates by blurring the alpha and re-thresholding (cheap, good enough for a few px). */
function grow(m: MaskCanvas, px: number): MaskCanvas {
  const c = canvas(m.width, m.height);
  const x = ctx2d(c);
  if (px > 0) x.filter = `blur(${px}px)`;
  x.drawImage(m, 0, 0);
  x.filter = "none";
  if (px > 0) {
    const img = x.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 8 ? 255 : 0;
    x.putImageData(img, 0, 0);
  }
  return c;
}

/**
 * Renders an alpha mask as the opaque black/white PNG ComfyUI's LoadImageMask expects,
 * at the diffusion resolution, optionally grown and feathered.
 */
export async function maskToBwBlob(m: MaskCanvas, w: number, h: number, opts: { grow?: number; feather?: number } = {}): Promise<Blob> {
  const scaled = canvas(w, h);
  ctx2d(scaled).drawImage(m, 0, 0, w, h);
  const grown = opts.grow ? grow(scaled, opts.grow) : scaled;
  const out = canvas(w, h);
  const x = ctx2d(out);
  x.fillStyle = "#000";
  x.fillRect(0, 0, w, h);
  if (opts.feather) x.filter = `blur(${opts.feather}px)`;
  x.drawImage(grown, 0, 0);
  x.filter = "none";
  return toBlob(out, "image/png");
}

/**
 * Contiguous flood fill on `pixels` from (sx,sy): selects neighbours whose colour is within
 * `tolerance` (0..255 RGB distance) of the seed. Returns an alpha mask canvas.
 */
export function magicWand(pixels: ImageData, sx: number, sy: number, tolerance: number): MaskCanvas {
  const { width: w, height: h, data } = pixels;
  const out = canvas(w, h);
  const x = ctx2d(out);
  const img = x.createImageData(w, h);
  const o = img.data;
  const seen = new Uint8Array(w * h);
  const si = (sy * w + sx) * 4;
  const r0 = data[si], g0 = data[si + 1], b0 = data[si + 2];
  const tol2 = tolerance * tolerance * 3;
  const stack = [sy * w + sx];
  seen[sy * w + sx] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const i = p * 4;
    o[i] = o[i + 1] = o[i + 2] = o[i + 3] = 255;
    const px = p % w, py = (p - px) / w;
    const neighbours = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1];
    for (const q of neighbours) {
      if (q < 0 || seen[q]) continue;
      seen[q] = 1;
      const j = q * 4;
      const dr = data[j] - r0, dg = data[j + 1] - g0, db = data[j + 2] - b0;
      if (dr * dr + dg * dg + db * db <= tol2) stack.push(q);
    }
  }
  x.putImageData(img, 0, 0);
  return grow(out, 1);
}
