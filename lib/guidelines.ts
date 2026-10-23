import type { BucketId, ZoneType } from "./types";
import { isWetZone } from "./buckets";
import type { Material } from "./materials";

export interface GuidelineGroup {
  title: string;
  items: string[];
}

const GENERAL: string[] = [
  "Pre-construction soil termite treatment by a licensed pest control operator, with a written warranty, before any floor finish goes down.",
  "Test concrete slab moisture before any resilient, timber-look or adhesive-bonded finish (ASTM F2170 in-situ RH ≤75%). New slabs in the rainy season can take 60+ days to dry.",
  "Store finishes indoors, off the ground and covered; cartons left on site absorb humidity and swell.",
  "Seal all wall and ceiling penetrations around AC lines; condensation dripping into voids is the leading cause of hidden mould.",
];

const WET: string[] = [
  "Wet zones: continuous waterproofing membrane under all tiling, upturned ≥150 mm at walls and 1800 mm in shower areas, flood-tested 24 h.",
  "Wet zones: 100% solids epoxy grout is mandatory. Cementitious grout will grow black mould within months in Philippine humidity.",
  "Provide mechanical exhaust ducted to outside air in every bathroom and kitchen.",
];

const FLOOR_CONCRETE: string =
  "Do not install click-lock floating floors directly over bare concrete. Air-conditioned rooms over warm slabs condense moisture underneath; lay a 0.2 mm PE vapour barrier with taped 200 mm laps or use glue-down products.";

export function buildGuidelines(zone: ZoneType, selections: Partial<Record<BucketId, Material | undefined>>): GuidelineGroup[] {
  const groups: GuidelineGroup[] = [{ title: "General tropical practice", items: [...GENERAL] }];
  if (isWetZone(zone)) groups.push({ title: "Wet-zone requirements", items: [...WET] });

  const floor = selections.floor;
  if (floor && (floor.family === "wood" || floor.id === "spc-plank")) {
    groups[0].items.push(FLOOR_CONCRETE);
  }

  const seen = new Set<string>();
  for (const [bucket, m] of Object.entries(selections) as [BucketId, Material | undefined][]) {
    if (!m || seen.has(m.id) || !m.guidelines.length) continue;
    seen.add(m.id);
    groups.push({ title: `${m.name} (${bucket})`, items: m.guidelines });
  }
  return groups;
}
