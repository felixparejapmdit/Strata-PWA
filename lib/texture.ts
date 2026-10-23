import type { TextureAnalysis, TextureFamily } from "./types";

export interface PixelData {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/**
 * Heuristic material classifier for reference photos. It reads colour, contrast, gradient
 * energy, orientation coherence (wood grain) and axis-aligned periodicity (tile grids).
 * It is a suggestion engine: the result only pre-selects a catalogue item the user can change.
 */
export function analyzeTexture(px: PixelData): TextureAnalysis {
  const { data, width: w, height: h } = px;
  const n = w * h;
  const lum = new Float32Array(n);
  let r = 0, g = 0, b = 0, satSum = 0;
  for (let i = 0; i < n; i++) {
    const R = data[i * 4], G = data[i * 4 + 1], B = data[i * 4 + 2];
    r += R; g += G; b += B;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    satSum += max === 0 ? 0 : (max - min) / max;
    lum[i] = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
  }
  r /= n; g /= n; b /= n;
  const saturation = satSum / n;
  const meanLum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (lum[i] - meanLum) ** 2;
  const lumStd = Math.sqrt(variance / n);

  // Sobel gradients + structure tensor
  let energy = 0, jxx = 0, jyy = 0, jxy = 0;
  const colEdge = new Float32Array(w);
  const rowEdge = new Float32Array(h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (yy: number, xx: number) => lum[yy * w + xx];
      const gx = p(y - 1, x + 1) + 2 * p(y, x + 1) + p(y + 1, x + 1) - p(y - 1, x - 1) - 2 * p(y, x - 1) - p(y + 1, x - 1);
      const gy = p(y + 1, x - 1) + 2 * p(y + 1, x) + p(y + 1, x + 1) - p(y - 1, x - 1) - 2 * p(y - 1, x) - p(y - 1, x + 1);
      energy += Math.hypot(gx, gy);
      jxx += gx * gx; jyy += gy * gy; jxy += gx * gy;
      colEdge[x] += Math.abs(gx);
      rowEdge[y] += Math.abs(gy);
    }
  }
  const inner = (w - 2) * (h - 2);
  const edgeDensity = energy / Math.max(1, inner);
  // 0 = isotropic, 1 = all gradients share one orientation (grain, brushed metal, flutes)
  const coherence = Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / Math.max(1e-6, jxx + jyy);
  const gridiness = (peakiness(colEdge) + peakiness(rowEdge)) / 2;

  const hue = rgbHue(r, g, b);
  const warm = (hue < 50 || hue > 330) && saturation > 0.12;
  const features = { meanLum, lumStd, saturation, edgeDensity, coherence, gridiness, hue };

  const scores: Record<TextureFamily, number> = {
    tile: gridiness * 1.6 + (saturation < 0.25 ? 0.1 : 0),
    wood: coherence * 1.4 + (warm ? 0.45 : 0) + (saturation > 0.18 && saturation < 0.6 ? 0.15 : 0),
    stone: (saturation < 0.15 ? 0.35 : 0) + (meanLum > 0.55 ? 0.25 : 0) + (edgeDensity > 0.08 && edgeDensity < 0.6 ? 0.3 : 0) + (lumStd > 0.06 ? 0.15 : 0),
    concrete: (saturation < 0.12 ? 0.4 : 0) + (meanLum > 0.3 && meanLum < 0.7 ? 0.25 : 0) + (lumStd < 0.08 ? 0.25 : 0) + (edgeDensity < 0.35 ? 0.1 : 0),
    plain: (lumStd < 0.035 ? 0.7 : 0) + (edgeDensity < 0.05 ? 0.5 : 0),
    fabric: (edgeDensity > 0.5 ? 0.45 : 0) + (coherence < 0.25 ? 0.2 : 0) + (saturation > 0.2 ? 0.15 : 0),
    metal: (saturation < 0.1 ? 0.2 : 0) + (coherence > 0.5 ? 0.3 : 0) + (lumStd > 0.12 ? 0.2 : 0) - (warm ? 0.3 : 0),
  };
  const ranked = (Object.entries(scores) as [TextureFamily, number][]).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  const confidence = Math.max(0.2, Math.min(0.95, best[1] / (best[1] + Math.max(0.05, second[1]))));

  return {
    family: best[0],
    confidence: Math.round(confidence * 100) / 100,
    swatch: "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""),
    tone: meanLum > 0.62 ? "light" : meanLum < 0.32 ? "dark" : "mid",
    warmth: warm ? "warm" : saturation < 0.08 ? "neutral" : hue > 170 && hue < 260 ? "cool" : "neutral",
    features,
  };
}

/** How much a 1-D edge profile is dominated by sharp, repeated peaks (grout lines). */
function peakiness(profile: Float32Array): number {
  const v = Array.from(profile).slice(1, -1);
  if (v.length < 8) return 0;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  if (mean <= 0) return 0;
  const peaks = v.filter((x, i) => x > mean * 2.2 && x >= (v[i - 1] ?? 0) && x >= (v[i + 1] ?? 0));
  if (peaks.length < 2 || peaks.length > v.length / 6) return 0;
  const share = peaks.reduce((s, x) => s + x, 0) / (mean * v.length);
  return Math.min(1, share * 2.5);
}

function rgbHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}
