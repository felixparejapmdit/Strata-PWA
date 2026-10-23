import type { BucketId, TextureAnalysis, ZoneType } from "./types";
import { zoneLabel } from "./buckets";
import type { Material } from "./materials";

const SURFACE_NOUN: Record<BucketId, string> = {
  floor: "floor",
  walls: "walls",
  ceiling: "ceiling",
  furniture: "furniture",
};

function describeAnalysis(a: TextureAnalysis | undefined): string {
  if (!a) return "";
  const tone = a.tone === "mid" ? "" : a.tone;
  const warmth = a.warmth === "neutral" ? "" : a.warmth + "-toned";
  return [tone, warmth].filter(Boolean).join(" ");
}

export function surfacePrompt(bucket: BucketId, material: Material | undefined, analysis: TextureAnalysis | undefined, note: string): string {
  const parts = [describeAnalysis(analysis), material?.prompt ?? "", note.trim()].filter(Boolean);
  if (!parts.length) return "";
  return `${SURFACE_NOUN[bucket]}: ${parts.join(", ")}`;
}

export function globalPrompt(zone: ZoneType, surfaceDescriptions: string[], extra: string): string {
  return [
    `professional architectural interior photograph of a ${zoneLabel(zone).toLowerCase()}`,
    ...surfaceDescriptions,
    "realistic physically based materials, accurate scale and perspective, soft natural daylight, sharp focus, high detail",
    extra.trim(),
  ]
    .filter(Boolean)
    .join(", ");
}
