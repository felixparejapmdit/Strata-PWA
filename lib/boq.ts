import type { BucketId, ProjectMeta } from "./types";
import { BUCKETS, LAYER_INFO } from "./buckets";
import type { Material } from "./materials";

export const VAT_RATE = 0.12;

export interface BoqLine {
  bucket: BucketId;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
  note?: string;
  kind: "supply" | "install" | "accessory";
}

export interface BoqSection {
  bucket: BucketId;
  label: string;
  material: Material;
  /** Net measured quantity before wastage. */
  netQty: number;
  lines: BoqLine[];
  subtotal: number;
}

export interface Boq {
  sections: BoqSection[];
  subtotal: number;
  contingencyPct: number;
  contingency: number;
  vat: number;
  total: number;
  areas: { floor: number; ceiling: number; walls: number; perimeter: number };
}

export function measuredAreas(meta: ProjectMeta) {
  const floor = Math.max(0, meta.floorArea);
  // Without a measured perimeter, assume a square room.
  const perimeter = meta.perimeter > 0 ? meta.perimeter : 4 * Math.sqrt(floor);
  const walls = perimeter * Math.max(0, meta.ceilingHeight) * (1 - clamp(meta.openingsPct, 0, 90) / 100);
  return { floor, ceiling: floor, walls, perimeter };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function computeBoq(meta: ProjectMeta, selections: Partial<Record<BucketId, Material | undefined>>): Boq {
  const areas = measuredAreas(meta);
  const sections: BoqSection[] = [];

  for (const bucket of BUCKETS) {
    const material = selections[bucket];
    if (!material) continue;
    const netQty = material.unit === "pc" ? Math.max(0, Math.round(meta.furniturePieces)) : round2(bucket === "walls" ? areas.walls : areas.floor);
    if (netQty <= 0) continue;

    const supplyQty = material.unit === "pc" ? netQty : round2(netQty * (1 + material.wastagePct / 100));
    const lines: BoqLine[] = [
      {
        bucket,
        kind: "supply",
        description: `Supply: ${material.name}`,
        unit: material.unit,
        qty: supplyQty,
        rate: material.supplyPhp,
        amount: round2(supplyQty * material.supplyPhp),
        note: material.wastagePct ? `incl. ${material.wastagePct}% wastage` : undefined,
      },
      {
        bucket,
        kind: "install",
        description: `Install: ${material.name}`,
        unit: material.unit,
        qty: netQty,
        rate: material.installPhp,
        amount: round2(netQty * material.installPhp),
      },
    ];
    for (const acc of material.accessories) {
      // Bagged and per-kg accessories are bought whole.
      const raw = netQty * acc.qtyPerUnit;
      const qty = /bag|kg|pc/.test(acc.unit) ? Math.ceil(raw) : round2(raw);
      lines.push({
        bucket,
        kind: "accessory",
        description: acc.name,
        unit: acc.unit,
        qty,
        rate: acc.unitCostPhp,
        amount: round2(qty * acc.unitCostPhp),
        note: acc.reason,
      });
    }
    sections.push({
      bucket,
      label: LAYER_INFO[bucket].label,
      material,
      netQty,
      lines,
      subtotal: round2(lines.reduce((s, l) => s + l.amount, 0)),
    });
  }

  const subtotal = round2(sections.reduce((s, x) => s + x.subtotal, 0));
  const contingencyPct = clamp(meta.contingencyPct, 0, 50);
  const contingency = round2((subtotal * contingencyPct) / 100);
  const vat = round2((subtotal + contingency) * VAT_RATE);
  return { sections, subtotal, contingencyPct, contingency, vat, total: round2(subtotal + contingency + vat), areas };
}

export function php(n: number, decimals = 2): string {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
