"use client";

import type { LayerId, Project } from "./types";
import { LAYERS, LAYER_PRIORITY } from "./buckets";
import { getBlob, putBlob, deleteBlobs } from "./db";
import { cloneMask, ctx2d, maskCoverage, maskFromStoredBlob, newMask, subtractMask, toBlob, unionInto, type MaskCanvas } from "./image";

/**
 * Live mask canvases for the open project. React state only holds a version counter; the
 * pixels stay here so painting never round-trips through state.
 */
class MaskManager {
  projectId: string | null = null;
  width = 0;
  height = 0;
  layers = new Map<LayerId, MaskCanvas>();
  /** Coverage of each layer as last written to IndexedDB (the UI may already show newer values). */
  private saved = new Map<LayerId, number>();
  private undo: { layer: LayerId; snapshot: Map<LayerId, MaskCanvas> }[] = [];
  private listeners = new Set<() => void>();

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    this.listeners.forEach((f) => f());
  }

  async load(p: Project) {
    this.projectId = p.id;
    this.layers.clear();
    this.saved.clear();
    for (const l of LAYERS) this.saved.set(l, p.masks[l]?.coverage ?? 0);
    this.undo = [];
    if (!p.base) {
      this.width = this.height = 0;
      this.notify();
      return;
    }
    this.width = p.base.editWidth;
    this.height = p.base.editHeight;
    for (const layer of LAYERS) {
      const id = p.masks[layer]?.blobId;
      const blob = id ? await getBlob(id) : undefined;
      this.layers.set(layer, blob ? await maskFromStoredBlob(blob, this.width, this.height) : newMask(this.width, this.height));
    }
    this.notify();
  }

  get(layer: LayerId): MaskCanvas {
    let m = this.layers.get(layer);
    if (!m) {
      // Before load() knows the image size, hand out a throwaway 1×1 mask rather than caching
      // a 0×0 canvas (drawImage throws on those, and the bad canvas would stick until reload).
      if (!this.width || !this.height) return newMask(1, 1);
      m = newMask(this.width, this.height);
      this.layers.set(layer, m);
    }
    return m;
  }

  /** True once masks are loaded for an image of this size. */
  isReadyFor(width: number, height: number): boolean {
    return width > 0 && height > 0 && this.width === width && this.height === height;
  }

  /** Call before a destructive edit so it can be undone. */
  checkpoint(layer: LayerId) {
    const snapshot = new Map<LayerId, MaskCanvas>();
    for (const l of LAYERS) snapshot.set(l, cloneMask(this.get(l)));
    this.undo.push({ layer, snapshot });
    if (this.undo.length > 25) this.undo.shift();
  }

  popUndo(): LayerId[] | null {
    const entry = this.undo.pop();
    if (!entry) return null;
    for (const [l, c] of entry.snapshot) this.layers.set(l, c);
    this.notify();
    return [...LAYERS];
  }

  /** Surfaces are mutually exclusive: painting one layer clears the same pixels elsewhere. */
  exclusive(layer: LayerId) {
    const painted = this.get(layer);
    for (const other of LAYERS) if (other !== layer) subtractMask(this.get(other), painted);
  }

  replace(layer: LayerId, m: MaskCanvas) {
    this.layers.set(layer, m);
  }

  /** Resolves overlaps between detected layers by priority (protected wins). */
  resolveOverlaps() {
    const claimed = newMask(this.width, this.height);
    for (const layer of LAYER_PRIORITY) {
      const m = this.get(layer);
      subtractMask(m, claimed);
      unionInto(claimed, m);
    }
  }

  clear(layer: LayerId) {
    const m = this.get(layer);
    ctx2d(m).clearRect(0, 0, m.width, m.height);
  }

  /** Effective mask for a surface: its own pixels minus protected structure. */
  effective(layer: LayerId): MaskCanvas {
    const m = cloneMask(this.get(layer));
    if (layer !== "protected") subtractMask(m, this.get("protected"));
    return m;
  }

  /**
   * Saves layers as PNG blobs. Layers not in `edited` were only changed by exclusivity, which can
   * only remove pixels, so an unchanged pixel count means unchanged pixels: those skip the encode.
   */
  async persist(layers: LayerId[], previous: Project["masks"], edited: LayerId[] = layers): Promise<Project["masks"]> {
    const next = { ...previous };
    const stale: (string | null)[] = [];
    for (const layer of layers) {
      const m = this.get(layer);
      const coverage = maskCoverage(m);
      const prev = previous[layer];
      if (!edited.includes(layer) && this.saved.get(layer) === coverage && (coverage === 0 || prev?.blobId)) continue;
      this.saved.set(layer, coverage);
      stale.push(prev?.blobId ?? null);
      next[layer] = {
        blobId: coverage > 0 ? await putBlob(await toBlob(m)) : null,
        source: coverage > 0 ? (previous[layer]?.source ?? "manual") : null,
        coverage,
      };
    }
    await deleteBlobs(stale);
    return next;
  }
}

export const masks = new MaskManager();

/** Coverage of each layer right now, without saving anything (cheap: one getImageData each). */
export function liveCoverage(layers: LayerId[]): Partial<Record<LayerId, number>> {
  return Object.fromEntries(layers.map((l) => [l, maskCoverage(masks.get(l))]));
}
