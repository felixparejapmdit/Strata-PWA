export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Smallest side worth diffusing on its own; SD1.5/SDXL degrade on much smaller canvases. */
const MIN_SIDE = 384;
/** Above this share of the frame, cropping saves too little to be worth the seam risk. */
const MAX_SHARE = 0.8;

const snapDown = (n: number) => Math.floor(n / 8) * 8;
const snapUp = (n: number) => Math.ceil(n / 8) * 8;

/**
 * Plans the region to diffuse: the editable area's bounding box plus context padding, grown to
 * a usable minimum size, kept inside the image and aligned to the VAE's 8 px grid.
 * Returns null when cropping would not help (the region already covers most of the frame).
 */
export function planCrop(bbox: Rect | null, imageWidth: number, imageHeight: number): Rect | null {
  if (!bbox || bbox.width <= 0 || bbox.height <= 0) return null;
  // Context around the edit keeps lighting and perspective consistent with the rest of the room.
  // Each axis is padded from its own extent: a wide floor strip must not get tall padding.
  const padX = Math.max(32, Math.round(0.15 * bbox.width));
  const padY = Math.max(32, Math.round(0.15 * bbox.height));
  let x0 = bbox.x - padX;
  let y0 = bbox.y - padY;
  let x1 = bbox.x + bbox.width + padX;
  let y1 = bbox.y + bbox.height + padY;

  const grow = (a0: number, a1: number, min: number, limit: number): [number, number] => {
    const need = Math.min(min, limit) - (a1 - a0);
    if (need > 0) {
      a0 -= need / 2;
      a1 += need / 2;
    }
    // Shift back inside the image rather than shrinking.
    if (a0 < 0) [a0, a1] = [0, a1 - a0];
    if (a1 > limit) [a0, a1] = [Math.max(0, a0 - (a1 - limit)), limit];
    return [a0, a1];
  };
  [x0, x1] = grow(x0, x1, MIN_SIDE, imageWidth);
  [y0, y1] = grow(y0, y1, MIN_SIDE, imageHeight);

  let x = snapDown(Math.max(0, x0));
  let y = snapDown(Math.max(0, y0));
  let width = Math.min(snapUp(x1 - x), snapDown(imageWidth - x) || imageWidth - x);
  let height = Math.min(snapUp(y1 - y), snapDown(imageHeight - y) || imageHeight - y);
  width = Math.max(8, width);
  height = Math.max(8, height);

  if (width * height > MAX_SHARE * imageWidth * imageHeight) return null;
  return { x, y, width, height };
}
