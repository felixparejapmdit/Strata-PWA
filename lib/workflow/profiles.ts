import type { GenSettings, PipelineProfile } from "../types";
import { comboOptions, pickAvailable, type ObjectInfo } from "./graph";

export interface ProfileSpec {
  id: PipelineProfile;
  label: string;
  summary: string;
  checkpoints: string[];
  /**
   * The checkpoint split into parts (Model Manager "Convert"), so the UNet alone can be stored in
   * fp8 via UNETLoader on low-memory hosts. Only valid for `splitFrom`.
   */
  split?: { from: string; unet: string; clip: string; vae: string };
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
  "UltimateSDUpscale", "MaskToImage", "ImageToMask", "SAM3_Detect", "ImageCrop", "CropMask", "MaskComposite", "UNETLoader", "CLIPLoader", "VAELoader",
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
    split: {
      from: "Realistic_Vision_V5.1_fp16-no-ema.safetensors",
      unet: "Realistic_Vision_V5.1_unet.safetensors",
      clip: "Realistic_Vision_V5.1_clip_l.safetensors",
      // The VAE Realistic Vision's authors recommend for this no-VAE checkpoint.
      vae: "vae-ft-mse-840000-ema-pruned.safetensors",
    },
    lcmLora: ["lcm-lora-sdv1-5.safetensors"],
    union: false,
    lineControlNet: ["control_v11p_sd15_canny_fp16.safetensors", "control_v11p_sd15_mlsd_fp16.safetensors"],
    depthControlNet: ["control_v11f1p_sd15_depth_fp16.safetensors"],
    lineUnionType: "",
    depthUnionType: "",
    ipadapter: ["ip-adapter-plus_sd15.safetensors", "ip-adapter_sd15.safetensors"],
    // SD1.5 "style transfer" skips the composition blocks: finish and colour, not objects or layout.
    ipaWeightType: "style transfer",
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
      // Lower than full repaint so the original shading and geometry anchor the new finish.
      denoise: 0.75,
      lineStrength: 0.85,
      // On by default: in soft-lit rooms the depth map, not edges, is what defines wall planes.
      useDepth: true,
      depthStrength: 0.75,
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
      denoise: 0.8,
      lineStrength: 0.7,
      useDepth: true,
      depthStrength: 0.7,
      upscale: true,
      targetLongSide: 3840,
      workLongSide: 1344,
      maskGrow: 6,
      maskFeather: 10,
    },
  },
};

/** Bumped when defaults change in a way saved projects should pick up; see migrateSettings(). */
export const SETTINGS_VERSION = 3;

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
  /** Split UNet / text encoder / VAE for the chosen checkpoint, when all three are installed. */
  split: { unet: string; clip: string; vae: string } | null;
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
  if ((s.settingsVersion ?? 1) < 3 && s.profile === "lite") {
    // Repainting walls/ceiling without the depth lock let the model move room corners.
    if (!s.useDepth) {
      s.useDepth = true;
      s.depthStrength = Math.max(s.depthStrength, 0.75);
      changed.push("depth lock on (keeps walls, floor and ceiling on their original planes)");
    }
    if (s.denoise === 0.9) {
      s.denoise = 0.75;
      changed.push("material strength 75% (original geometry and shading anchor the finish)");
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
  const sp = p.split;
  const split =
    sp && checkpoint === sp.from && pickAvailable(info, "UNETLoader", "unet_name", [sp.unet]) && pickAvailable(info, "CLIPLoader", "clip_name", [sp.clip]) && pickAvailable(info, "VAELoader", "vae_name", [sp.vae])
      ? { unet: sp.unet, clip: sp.clip, vae: sp.vae }
      : null;
  return {
    checkpoint,
    split,
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
