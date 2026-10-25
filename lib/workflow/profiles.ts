import type { GenSettings, PipelineProfile } from "../types";
import { comboOptions, pickAvailable, type ObjectInfo } from "./graph";

export interface ProfileSpec {
  id: PipelineProfile;
  label: string;
  summary: string;
  checkpoints: string[];
  lcmLora: string[];
  /** Union ControlNets take a type selector; separate ones are loaded per lock. */
  union: boolean;
  lineControlNet: string[];
  depthControlNet: string[];
  lineUnionType: string;
  depthUnionType: string;
  ipadapter: string[];
  ipaWeightType: string;
  clipVision: string[];
  depthModel: string[];
  upscaleModels: string[];
  sam: string[];
  defaults: Omit<GenSettings, "profile" | "checkpoint" | "extraPrompt" | "negativePrompt" | "seed">;
}

/** Every node class Strata's graphs can emit; the doctor ships only these schemas to the browser. */
export const USED_NODES = [
  "CheckpointLoaderSimple", "LoraLoader", "CLIPTextEncode", "ConditioningSetMask", "ConditioningCombine",
  "ControlNetLoader", "ControlNetApplyAdvanced", "SetUnionControlNetType", "Canny", "GrowMask", "EmptyImage",
  "ImageCompositeMasked", "LoadImage", "LoadImageMask", "LoadDA3Model", "DA3Inference", "DA3Render",
  "IPAdapterModelLoader", "CLIPVisionLoader", "IPAdapterAdvanced", "ImageBatch", "VAEEncode", "SetLatentNoiseMask",
  "KSampler", "VAEDecode", "SaveImage", "UpscaleModelLoader", "ImageUpscaleWithModel", "ImageScale",
  "UltimateSDUpscale", "MaskToImage", "ImageToMask", "SAM3_Detect", "ImageCrop", "CropMask",
  "IPAdapterEncoder", "IPAdapterCombineEmbeds", "IPAdapterSaveEmbeds", "IPAdapterLoadEmbeds", "IPAdapterEmbeds",
];

export const NEGATIVE_DEFAULT =
  "people, person, text, watermark, logo, signature, extra furniture, clutter, distorted perspective, warped lines, bent walls, blurry, lowres, jpeg artifacts, cartoon, illustration, oversaturated";

export const PROFILES: Record<PipelineProfile, ProfileSpec> = {
  lite: {
    id: "lite",
    label: "Lite: CPU / ≤8 GB VRAM",
    summary: "SD1.5 + LCM (6 steps), Canny line lock, optional depth lock, IP-Adapter Plus, ESRGAN 4K.",
    checkpoints: ["Realistic_Vision_V5.1_fp16-no-ema.safetensors"],
    lcmLora: ["lcm-lora-sdv1-5.safetensors"],
    union: false,
    lineControlNet: ["control_v11p_sd15_canny_fp16.safetensors", "control_v11p_sd15_mlsd_fp16.safetensors"],
    depthControlNet: ["control_v11f1p_sd15_depth_fp16.safetensors"],
    lineUnionType: "",
    depthUnionType: "",
    ipadapter: ["ip-adapter-plus_sd15.safetensors", "ip-adapter_sd15.safetensors"],
    ipaWeightType: "linear",
    clipVision: ["CLIP-ViT-H-14-laion2B-s32B-b79K.fp16.safetensors", "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"],
    depthModel: ["depth_anything_3_small.safetensors", "depth_anything_3_base.safetensors", "depth_anything_3_mono_large.safetensors"],
    upscaleModels: ["4x-UltraSharp.pth", "RealESRGAN_x4plus.pth"],
    sam: ["sam3.1_multiplex_fp16.safetensors"],
    defaults: {
      steps: 6,
      // CFG 1.0 makes ComfyUI skip the negative pass entirely (half the work per step).
      cfg: 1,
      sampler: "lcm",
      scheduler: "sgm_uniform",
      useLcm: true,
      denoise: 0.9,
      lineStrength: 0.85,
      useDepth: false,
      depthStrength: 0.55,
      // 4K on demand (filmstrip / proposal export): iterating at 768 px is far faster on CPU.
      upscale: false,
      targetLongSide: 3840,
      workLongSide: 768,
      maskGrow: 4,
      maskFeather: 6,
    },
  },
  studio: {
    id: "studio",
    label: "Studio: NVIDIA ≥12 GB VRAM",
    summary: "SDXL, ControlNet Union (MLSD lines + depth), IP-Adapter Plus SDXL, Ultimate SD Upscale to 4K.",
    checkpoints: ["RealVisXL_V5.0_fp16.safetensors", "sd_xl_base_1.0.safetensors"],
    lcmLora: [],
    union: true,
    lineControlNet: ["controlnet-union-sdxl-promax.safetensors"],
    depthControlNet: ["controlnet-union-sdxl-promax.safetensors"],
    lineUnionType: "canny/lineart/anime_lineart/mlsd",
    depthUnionType: "depth",
    ipadapter: ["ip-adapter-plus_sdxl_vit-h.safetensors"],
    ipaWeightType: "style transfer",
    clipVision: ["CLIP-ViT-H-14-laion2B-s32B-b79K.fp16.safetensors", "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"],
    depthModel: ["depth_anything_3_mono_large.safetensors", "depth_anything_3_base.safetensors", "depth_anything_3_small.safetensors"],
    upscaleModels: ["4x-UltraSharp.pth", "RealESRGAN_x4plus.pth"],
    sam: ["sam3.1_multiplex_fp16.safetensors"],
    defaults: {
      steps: 28,
      cfg: 5,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      useLcm: false,
      denoise: 0.92,
      lineStrength: 0.7,
      useDepth: true,
      depthStrength: 0.5,
      upscale: true,
      targetLongSide: 3840,
      workLongSide: 1344,
      maskGrow: 6,
      maskFeather: 10,
    },
  },
};

/** Bumped when defaults change in a way saved projects should pick up; see migrateSettings(). */
export const SETTINGS_VERSION = 2;

export function defaultSettings(profile: PipelineProfile, checkpoint = ""): GenSettings {
  return {
    settingsVersion: SETTINGS_VERSION,
    profile,
    checkpoint: checkpoint || PROFILES[profile].checkpoints[0],
    seed: -1,
    extraPrompt: "",
    negativePrompt: NEGATIVE_DEFAULT,
    ...PROFILES[profile].defaults,
  };
}

export interface ResolvedModels {
  checkpoint: string | null;
  lcmLora: string | null;
  lineControlNet: string | null;
  depthControlNet: string | null;
  ipadapter: string | null;
  clipVision: string | null;
  depthModel: string | null;
  upscaleModel: string | null;
  sam: string | null;
  hasUltimateUpscale: boolean;
  hasIpAdapter: boolean;
  hasSam3: boolean;
  hasDepthAnything: boolean;
}

/**
 * Brings settings saved under older defaults up to date. Only values still equal to the old
 * default change, so anything the user tuned is kept. Returns what changed, for a notice.
 */
export function migrateSettings(s: GenSettings): string[] {
  const changed: string[] = [];
  if ((s.settingsVersion ?? 1) < 2 && s.profile === "lite") {
    if (s.useLcm && s.cfg === 1.5) {
      s.cfg = 1;
      changed.push("CFG 1.0 (about 2× faster sampling)");
    }
    if (s.upscale) {
      s.upscale = false;
      changed.push("4K on demand instead of every render");
    }
  }
  s.settingsVersion = SETTINGS_VERSION;
  return changed;
}

/** Resolves each model slot against what ComfyUI actually has installed. */
export function resolveModels(profile: PipelineProfile, settings: Pick<GenSettings, "checkpoint">, info: ObjectInfo | null): ResolvedModels {
  const p = PROFILES[profile];
  const ckptOptions = comboOptions(info, "CheckpointLoaderSimple", "ckpt_name") ?? [];
  const checkpoint = settings.checkpoint && ckptOptions.includes(settings.checkpoint) ? settings.checkpoint : pickAvailable(info, "CheckpointLoaderSimple", "ckpt_name", p.checkpoints);
  return {
    checkpoint,
    lcmLora: pickAvailable(info, "LoraLoader", "lora_name", p.lcmLora),
    lineControlNet: pickAvailable(info, "ControlNetLoader", "control_net_name", p.lineControlNet),
    depthControlNet: pickAvailable(info, "ControlNetLoader", "control_net_name", p.depthControlNet),
    ipadapter: pickAvailable(info, "IPAdapterModelLoader", "ipadapter_file", p.ipadapter),
    clipVision: pickAvailable(info, "CLIPVisionLoader", "clip_name", p.clipVision),
    depthModel: pickAvailable(info, "LoadDA3Model", "model_name", p.depthModel),
    upscaleModel: pickAvailable(info, "UpscaleModelLoader", "model_name", p.upscaleModels),
    sam: pickAvailable(info, "CheckpointLoaderSimple", "ckpt_name", p.sam),
    hasUltimateUpscale: !!info?.UltimateSDUpscale,
    hasIpAdapter: !!info?.IPAdapterAdvanced,
    hasSam3: !!info?.SAM3_Detect,
    hasDepthAnything: !!info?.DA3Inference,
  };
}

/** Checkpoints that look like they belong to the profile's architecture (by filename heuristics). */
export function checkpointsForProfile(profile: PipelineProfile, info: ObjectInfo | null): string[] {
  const all = (comboOptions(info, "CheckpointLoaderSimple", "ckpt_name") ?? []).filter((c) => !/sam3|sam_/i.test(c));
  const isXl = (c: string) => /xl|sdxl|pony|illustrious/i.test(c);
  const filtered = all.filter((c) => (profile === "studio" ? isXl(c) : !isXl(c)));
  return filtered.length ? filtered : all;
}

/** Scales (w,h) so the long side is `longSide`, snapped to multiples of 8 for the VAE. */
export function fitDims(w: number, h: number, longSide: number): { width: number; height: number } {
  const s = longSide / Math.max(w, h);
  return { width: Math.max(64, Math.round((w * s) / 8) * 8), height: Math.max(64, Math.round((h * s) / 8) * 8) };
}
