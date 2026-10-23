import type { BucketId, LayerId, ZoneType } from "./types";

export const BUCKETS: BucketId[] = ["floor", "walls", "ceiling", "furniture"];
export const LAYERS: LayerId[] = [...BUCKETS, "protected"];

export interface LayerInfo {
  label: string;
  /** Overlay tint, rgb. */
  color: [number, number, number];
  /** SAM3 prompt: comma-separated concepts, each with ":N" max detections; detections are unioned. */
  samPrompt: string;
  threshold: number;
  shortcut: string;
}

export const LAYER_INFO: Record<LayerId, LayerInfo> = {
  floor: { label: "Floor", color: [51, 102, 255], samPrompt: "floor:3", threshold: 0.4, shortcut: "1" },
  walls: { label: "Walls", color: [16, 185, 129], samPrompt: "wall:8", threshold: 0.35, shortcut: "2" },
  ceiling: { label: "Ceiling", color: [245, 158, 11], samPrompt: "ceiling:3", threshold: 0.4, shortcut: "3" },
  furniture: {
    label: "Furniture",
    color: [168, 85, 247],
    samPrompt: "sofa:4, armchair:4, chair:8, table:4, cabinet:6, bed:2, shelf:4",
    threshold: 0.45,
    shortcut: "4",
  },
  protected: {
    label: "Protected",
    color: [239, 68, 68],
    samPrompt: "window:10, door:6, column:6, beam:6",
    threshold: 0.4,
    shortcut: "0",
  },
};

/**
 * When detected masks overlap, the earlier layer wins. Protected structure always wins so
 * doors, windows and columns can never be repainted.
 */
export const LAYER_PRIORITY: LayerId[] = ["protected", "furniture", "ceiling", "floor", "walls"];

export const ZONES: { id: ZoneType; label: string; wet: boolean }[] = [
  { id: "living", label: "Living room", wet: false },
  { id: "dining", label: "Dining", wet: false },
  { id: "bedroom", label: "Bedroom", wet: false },
  { id: "kitchen", label: "Kitchen", wet: true },
  { id: "bathroom", label: "Bathroom / T&B", wet: true },
  { id: "office", label: "Office", wet: false },
  { id: "parking", label: "Parking / garage", wet: false },
  { id: "commercial", label: "Commercial / retail", wet: false },
  { id: "outdoor-covered", label: "Covered outdoor / lanai", wet: true },
];

export function zoneLabel(zone: ZoneType): string {
  return ZONES.find((z) => z.id === zone)?.label ?? zone;
}

export function isWetZone(zone: ZoneType): boolean {
  return ZONES.find((z) => z.id === zone)?.wet ?? false;
}
