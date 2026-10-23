export type BucketId = "floor" | "walls" | "ceiling" | "furniture";
/** Mask layers the user can paint: the four surface buckets plus the protected (structural) layer. */
export type LayerId = BucketId | "protected";

export type ZoneType =
  | "living"
  | "dining"
  | "bedroom"
  | "kitchen"
  | "bathroom"
  | "office"
  | "parking"
  | "commercial"
  | "outdoor-covered";

export type PipelineProfile = "lite" | "studio";

export type TextureFamily = "stone" | "wood" | "tile" | "concrete" | "plain" | "fabric" | "metal";

export interface TextureAnalysis {
  family: TextureFamily;
  confidence: number;
  /** Average colour as #rrggbb. */
  swatch: string;
  tone: "light" | "mid" | "dark";
  warmth: "warm" | "neutral" | "cool";
  features: Record<string, number>;
}

export interface ReferenceImage {
  id: string;
  blobId: string;
  name: string;
  analysis?: TextureAnalysis;
}

export interface BucketState {
  enabled: boolean;
  refs: ReferenceImage[];
  /** Chosen catalogue material. */
  materialId: string | null;
  /** True once the user picked a material by hand; auto-suggestion then stops overriding it. */
  materialPinned: boolean;
  /** IP-Adapter weight for this surface. */
  weight: number;
  /** Extra free-text for this surface's regional prompt. */
  note: string;
}

export interface MaskState {
  blobId: string | null;
  source: "auto" | "manual" | null;
  /** Fraction of the image covered, 0..1. */
  coverage: number;
}

export interface ProjectMeta {
  client: string;
  location: string;
  preparedBy: string;
  zone: ZoneType;
  /** Floor area in m². */
  floorArea: number;
  /** Ceiling height in m. */
  ceilingHeight: number;
  /** Room perimeter in m; 0 means estimate from area. */
  perimeter: number;
  /** Percentage of wall area taken by doors/windows. */
  openingsPct: number;
  furniturePieces: number;
  contingencyPct: number;
}

export interface GenSettings {
  profile: PipelineProfile;
  checkpoint: string;
  /** -1 = random per render. */
  seed: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  useLcm: boolean;
  /** How strongly the masked surfaces are repainted (KSampler denoise). */
  denoise: number;
  lineStrength: number;
  useDepth: boolean;
  depthStrength: number;
  upscale: boolean;
  /** Long side of the final upscaled render in px. */
  targetLongSide: number;
  /** Long side of the diffusion pass in px. */
  workLongSide: number;
  maskGrow: number;
  maskFeather: number;
  extraPrompt: string;
  negativePrompt: string;
}

export interface RenderRecord {
  id: string;
  createdAt: number;
  seed: number;
  profile: PipelineProfile;
  previewBlobId: string;
  finalBlobId: string | null;
  width: number;
  height: number;
  finalWidth: number | null;
  finalHeight: number | null;
  materials: Partial<Record<BucketId, string | null>>;
  durationMs: number;
}

export interface BaseImage {
  /** Original upload. */
  blobId: string;
  /** Downscaled copy used for editing and as the mask coordinate space. */
  editBlobId: string;
  name: string;
  width: number;
  height: number;
  editWidth: number;
  editHeight: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  meta: ProjectMeta;
  base: BaseImage | null;
  buckets: Record<BucketId, BucketState>;
  masks: Record<LayerId, MaskState>;
  settings: GenSettings;
  renders: RenderRecord[];
  activeRenderId: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  thumbBlobId: string | null;
  renders: { id: string; createdAt: number; previewBlobId: string }[];
}
