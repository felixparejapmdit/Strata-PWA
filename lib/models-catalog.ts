import type { PipelineProfile } from "./types";

export type ModelRole = "checkpoint" | "unet" | "text_encoder" | "lora" | "controlnet" | "ipadapter" | "clip_vision" | "depth" | "segmentation" | "upscale";

export interface CatalogModel {
  id: string;
  name: string;
  role: ModelRole;
  /** Folder under ComfyUI/models. */
  dir: string;
  filename: string;
  url: string;
  bytes: number;
  profiles: PipelineProfile[];
  /** Part of the minimum set the profile needs to render. */
  required: boolean;
  note?: string;
  /** Produced locally from another catalogue model instead of downloaded (url is unused). */
  convertFrom?: string;
  /** How a derived model is produced from `convertFrom`. */
  convert?: "fp16" | "extract-unet" | "extract-clip";
}

/**
 * Every URL here was verified against Hugging Face. Downloads are restricted to this list
 * server-side so the local API can never be used to fetch arbitrary files.
 */
export const MODEL_CATALOG: CatalogModel[] = [
  // Shared
  {
    id: "sam3",
    name: "SAM 3.1 (text-prompted segmentation)",
    role: "segmentation",
    dir: "checkpoints",
    filename: "sam3.1_multiplex_fp16.safetensors",
    url: "https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors",
    bytes: 1745546848,
    profiles: ["lite", "studio"],
    required: false,
    note: "Auto-detects floor, walls, ceiling, furniture and protected structure. Without it, paint masks by hand.",
  },
  {
    id: "clip-vision-h",
    name: "CLIP ViT-H/14 image encoder",
    role: "clip_vision",
    dir: "clip_vision",
    filename: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
    url: "https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors",
    bytes: 2528373448,
    profiles: ["lite", "studio"],
    required: true,
    note: "Encodes your reference images for IP-Adapter.",
  },
  {
    id: "clip-vision-h-fp16",
    name: "CLIP ViT-H/14 image encoder (fp16, low-memory)",
    role: "clip_vision",
    dir: "clip_vision",
    filename: "CLIP-ViT-H-14-laion2B-s32B-b79K.fp16.safetensors",
    url: "",
    bytes: 0,
    profiles: ["lite", "studio"],
    required: false,
    convertFrom: "clip-vision-h",
    convert: "fp16",
    note: "Half-size copy of the encoder above, made locally. ComfyUI already runs it in fp16 on CPU, so results are identical, but loading no longer needs ~3.8 GB at once. Recommended on 8 GB machines.",
  },
  {
    id: "ultrasharp",
    name: "4x-UltraSharp ESRGAN",
    role: "upscale",
    dir: "upscale_models",
    filename: "4x-UltraSharp.pth",
    url: "https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth",
    bytes: 66961958,
    profiles: ["lite", "studio"],
    required: false,
    note: "Sharper material micro-detail than RealESRGAN for the 4K pass.",
  },
  // Lite (CPU / ≤8 GB VRAM)
  {
    id: "rv51",
    name: "Realistic Vision 5.1 (SD1.5)",
    role: "checkpoint",
    dir: "checkpoints",
    filename: "Realistic_Vision_V5.1_fp16-no-ema.safetensors",
    url: "https://huggingface.co/SG161222/Realistic_Vision_V5.1_noVAE/resolve/main/Realistic_Vision_V5.1_fp16-no-ema.safetensors",
    bytes: 2132625894,
    profiles: ["lite"],
    required: true,
  },
  {
    id: "rv51-unet",
    name: "Realistic Vision 5.1 UNet (low-memory renders)",
    role: "unet",
    dir: "diffusion_models",
    filename: "Realistic_Vision_V5.1_unet.safetensors",
    url: "",
    bytes: 0,
    profiles: ["lite"],
    required: false,
    convertFrom: "rv51",
    convert: "extract-unet",
    note: "The checkpoint's diffusion model on its own, so Strata can store it in fp8 (a quarter of fp32) for renders without a global ComfyUI flag that would break Auto-detect. Recommended on 8 GB machines; convert this and the text encoder below.",
  },
  {
    id: "rv51-clip",
    name: "Realistic Vision 5.1 text encoder (low-memory renders)",
    role: "text_encoder",
    dir: "text_encoders",
    filename: "Realistic_Vision_V5.1_clip_l.safetensors",
    url: "",
    bytes: 0,
    profiles: ["lite"],
    required: false,
    convertFrom: "rv51",
    convert: "extract-clip",
    note: "The checkpoint's CLIP-L text encoder on its own, used together with the UNet above.",
  },
  {
    id: "lcm-sd15",
    name: "LCM LoRA (SD1.5), 6-step sampling",
    role: "lora",
    dir: "loras",
    filename: "lcm-lora-sdv1-5.safetensors",
    url: "https://huggingface.co/latent-consistency/lcm-lora-sdv1-5/resolve/main/pytorch_lora_weights.safetensors",
    bytes: 134621556,
    profiles: ["lite"],
    required: false,
    note: "Cuts sampling from ~25 to 6 steps; essential on CPU.",
  },
  {
    id: "cn-canny-sd15",
    name: "ControlNet Canny (SD1.5): line lock",
    role: "controlnet",
    dir: "controlnet",
    filename: "control_v11p_sd15_canny_fp16.safetensors",
    url: "https://huggingface.co/comfyanonymous/ControlNet-v1-1_fp16_safetensors/resolve/main/control_v11p_sd15_canny_fp16.safetensors",
    bytes: 722601100,
    profiles: ["lite"],
    required: true,
  },
  {
    id: "cn-depth-sd15",
    name: "ControlNet Depth (SD1.5): perspective lock",
    role: "controlnet",
    dir: "controlnet",
    filename: "control_v11f1p_sd15_depth_fp16.safetensors",
    url: "https://huggingface.co/comfyanonymous/ControlNet-v1-1_fp16_safetensors/resolve/main/control_v11f1p_sd15_depth_fp16.safetensors",
    bytes: 722601100,
    profiles: ["lite"],
    required: false,
  },
  {
    id: "ipa-plus-sd15",
    name: "IP-Adapter Plus (SD1.5)",
    role: "ipadapter",
    dir: "ipadapter",
    filename: "ip-adapter-plus_sd15.safetensors",
    url: "https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter-plus_sd15.safetensors",
    bytes: 98183288,
    profiles: ["lite"],
    required: true,
    note: "Finer texture transfer than the base SD1.5 IP-Adapter.",
  },
  {
    id: "da3-small",
    name: "Depth Anything 3 Small",
    role: "depth",
    dir: "geometry_estimation",
    filename: "depth_anything_3_small.safetensors",
    url: "https://huggingface.co/Comfy-Org/Depth-Anything-3/resolve/main/geometry_estimation/depth_anything_3_small.safetensors",
    bytes: 137254980,
    profiles: ["lite"],
    required: false,
  },
  // Studio (NVIDIA ≥12 GB VRAM): the blueprint's SDXL stack
  {
    id: "realvisxl5",
    name: "RealVisXL V5.0 (SDXL, photoreal)",
    role: "checkpoint",
    dir: "checkpoints",
    filename: "RealVisXL_V5.0_fp16.safetensors",
    url: "https://huggingface.co/SG161222/RealVisXL_V5.0/resolve/main/RealVisXL_V5.0_fp16.safetensors",
    bytes: 6938065488,
    profiles: ["studio"],
    required: false,
    note: "Recommended over SDXL base for interiors: far better materials and light.",
  },
  {
    id: "sdxl-base",
    name: "SDXL 1.0 Base",
    role: "checkpoint",
    dir: "checkpoints",
    filename: "sd_xl_base_1.0.safetensors",
    url: "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors",
    bytes: 6938078334,
    profiles: ["studio"],
    required: false,
  },
  {
    id: "cn-union-sdxl",
    name: "ControlNet Union ProMax (SDXL): MLSD/lines + depth",
    role: "controlnet",
    dir: "controlnet",
    filename: "controlnet-union-sdxl-promax.safetensors",
    url: "https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors",
    bytes: 2513342408,
    profiles: ["studio"],
    required: true,
    note: "One model drives both the line (MLSD/canny) and depth locks.",
  },
  {
    id: "ipa-plus-sdxl",
    name: "IP-Adapter Plus (SDXL, ViT-H)",
    role: "ipadapter",
    dir: "ipadapter",
    filename: "ip-adapter-plus_sdxl_vit-h.safetensors",
    url: "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors",
    bytes: 847517512,
    profiles: ["studio"],
    required: true,
  },
  {
    id: "da3-large",
    name: "Depth Anything 3 Mono Large",
    role: "depth",
    dir: "geometry_estimation",
    filename: "depth_anything_3_mono_large.safetensors",
    url: "https://huggingface.co/Comfy-Org/Depth-Anything-3/resolve/main/geometry_estimation/depth_anything_3_mono_large.safetensors",
    bytes: 1336748056,
    profiles: ["studio"],
    required: true,
  },
];

export interface CustomNodePack {
  id: string;
  name: string;
  repo: string;
  /** A node class that proves the pack is loaded. */
  probeClass: string;
  profiles: PipelineProfile[];
  required: boolean;
  note: string;
}

export const CUSTOM_NODES: CustomNodePack[] = [
  {
    id: "ipadapter-plus",
    name: "ComfyUI IPAdapter Plus",
    repo: "https://github.com/cubiq/ComfyUI_IPAdapter_plus",
    probeClass: "IPAdapterAdvanced",
    profiles: ["lite", "studio"],
    required: true,
    note: "Regional, mask-scoped material transfer from reference images.",
  },
  {
    id: "ultimate-sd-upscale",
    name: "Ultimate SD Upscale",
    repo: "https://github.com/ssitu/ComfyUI_UltimateSDUpscale",
    probeClass: "UltimateSDUpscale",
    profiles: ["studio"],
    required: false,
    note: "Tiled diffusion upscale to 4K. Without it, Strata uses a pure ESRGAN 4K pass.",
  },
];

export function formatBytes(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(0) + " MB";
  return (n / 1e3).toFixed(0) + " KB";
}
