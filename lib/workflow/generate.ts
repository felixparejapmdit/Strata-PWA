import type { BucketId, GenSettings } from "../types";
import { Graph, type ApiPrompt, type Link } from "./graph";
import { PROFILES, type ResolvedModels } from "./profiles";

export interface SurfaceInput {
  bucket: BucketId;
  /** Uploaded mask image (white = repaint). */
  mask: string;
  /** Uploaded reference images; empty means text-only for this surface. */
  refs: string[];
  weight: number;
  prompt: string;
}

export interface GenerationRequest {
  settings: GenSettings;
  models: ResolvedModels;
  baseImage: string;
  /** Union of all surface masks, grown: where the sampler may change pixels. */
  unionHard: string;
  /** Feathered union: blends the render back over the untouched original. */
  unionSoft: string;
  width: number;
  height: number;
  finalWidth: number;
  finalHeight: number;
  surfaces: SurfaceInput[];
  globalPrompt: string;
  seed: number;
  prefix: string;
}

export interface GenerationGraph {
  prompt: ApiPrompt;
  previewNode: string;
  finalNode: string | null;
  stages: Record<string, string>;
  warnings: string[];
}

/**
 * Structure-locked material replacement:
 *   lines (Canny, texture inside editable areas removed) + optional depth → ControlNet
 *   reference images → IP-Adapter, one pass per surface, scoped by attn_mask
 *   material text → regional conditioning per surface mask
 *   sampling only inside the union mask (SetLatentNoiseMask)
 *   composite onto the untouched original, so pixels outside the masks are byte-identical
 *   4K: ESRGAN (lite) or Ultimate SD Upscale + re-composite over the ESRGAN'd original (studio)
 */
export function buildGenerationGraph(req: GenerationRequest): GenerationGraph {
  const { settings: s, models: m } = req;
  const spec = PROFILES[s.profile];
  const g = new Graph();
  const stages: Record<string, string> = {};
  const warnings: string[] = [];
  if (!m.checkpoint) throw new Error("No checkpoint available for this profile. Download one in Model Manager.");

  // Models
  const ckpt = g.add("CheckpointLoaderSimple", { ckpt_name: m.checkpoint }, "Checkpoint");
  stages[ckpt] = "Loading checkpoint";
  let model: Link = Graph.out(ckpt, 0);
  let clip: Link = Graph.out(ckpt, 1);
  const vae: Link = Graph.out(ckpt, 2);
  if (s.useLcm) {
    if (m.lcmLora) {
      const lora = g.add("LoraLoader", { model, clip, lora_name: m.lcmLora, strength_model: 1, strength_clip: 1 }, "LCM LoRA");
      model = Graph.out(lora, 0);
      clip = Graph.out(lora, 1);
    } else {
      warnings.push("LCM LoRA not installed: running without it. Raise steps to ~25 and CFG to ~6.");
    }
  }
  const baseModel = model;

  // Inputs
  const base = g.add("LoadImage", { image: req.baseImage }, "Base image");
  const hard = g.add("LoadImageMask", { image: req.unionHard, channel: "red" }, "Editable area");
  const soft = g.add("LoadImageMask", { image: req.unionSoft, channel: "red" }, "Blend mask");
  const surfaceMasks: Partial<Record<BucketId, Link>> = {};
  for (const surf of req.surfaces) {
    surfaceMasks[surf.bucket] = Graph.out(g.add("LoadImageMask", { image: surf.mask, channel: "red" }, `${surf.bucket} mask`), 0);
  }

  // Text conditioning: global + one masked region per surface
  let positive: Link = Graph.out(g.add("CLIPTextEncode", { text: req.globalPrompt, clip }, "Global prompt"), 0);
  const plainPositive = positive;
  for (const surf of req.surfaces) {
    if (!surf.prompt) continue;
    const enc = g.add("CLIPTextEncode", { text: surf.prompt, clip }, `${surf.bucket} prompt`);
    const masked = g.add("ConditioningSetMask", { conditioning: Graph.out(enc, 0), mask: surfaceMasks[surf.bucket], strength: 1, set_cond_area: "default" });
    positive = Graph.out(g.add("ConditioningCombine", { conditioning_1: positive, conditioning_2: Graph.out(masked, 0) }), 0);
  }
  let negative: Link = Graph.out(g.add("CLIPTextEncode", { text: s.negativePrompt, clip }, "Negative prompt"), 0);
  const plainNegative = negative;

  // Line lock: Canny edges with the old surface texture blanked out (eroded mask keeps boundary lines)
  if (m.lineControlNet && s.lineStrength > 0) {
    const canny = g.add("Canny", { image: Graph.out(base, 0), low_threshold: 0.2, high_threshold: 0.45 }, "Structure lines");
    stages[canny] = "Analysing structure";
    const eroded = g.add("GrowMask", { mask: Graph.out(hard, 0), expand: -8, tapered_corners: true });
    const black = g.add("EmptyImage", { width: req.width, height: req.height, batch_size: 1, color: 0 });
    const lines = g.add("ImageCompositeMasked", {
      destination: Graph.out(canny, 0),
      source: Graph.out(black, 0),
      x: 0,
      y: 0,
      resize_source: false,
      mask: Graph.out(eroded, 0),
    });
    let cn: Link = Graph.out(g.add("ControlNetLoader", { control_net_name: m.lineControlNet }, "Line ControlNet"), 0);
    if (spec.union) cn = Graph.out(g.add("SetUnionControlNetType", { control_net: cn, type: spec.lineUnionType }), 0);
    const applied = g.add("ControlNetApplyAdvanced", {
      positive,
      negative,
      control_net: cn,
      image: Graph.out(lines, 0),
      strength: s.lineStrength,
      start_percent: 0,
      end_percent: 1,
    });
    positive = Graph.out(applied, 0);
    negative = Graph.out(applied, 1);
  } else if (s.lineStrength > 0) {
    warnings.push("Line ControlNet not installed: structure is protected by masking only.");
  }

  // Depth lock: keeps the new material on the same perspective planes
  if (s.useDepth) {
    if (m.depthControlNet && m.depthModel && m.hasDepthAnything) {
      const da3 = g.add("LoadDA3Model", { model_name: m.depthModel, weight_dtype: "default" }, "Depth Anything 3");
      const geo = g.add("DA3Inference", { da3_model: Graph.out(da3, 0), image: Graph.out(base, 0), resolution: 504, resize_method: "upper_bound_resize", mode: "mono" });
      stages[geo] = "Estimating depth";
      const depth = g.add("DA3Render", { da3_geometry: Graph.out(geo, 0), output: "depth", "output.normalization": "v2_style", "output.apply_sky_clip": false }, "Depth map");
      let cn: Link = Graph.out(g.add("ControlNetLoader", { control_net_name: m.depthControlNet }, "Depth ControlNet"), 0);
      if (spec.union) cn = Graph.out(g.add("SetUnionControlNetType", { control_net: cn, type: spec.depthUnionType }), 0);
      const applied = g.add("ControlNetApplyAdvanced", {
        positive,
        negative,
        control_net: cn,
        image: Graph.out(depth, 0),
        strength: s.depthStrength,
        start_percent: 0,
        end_percent: 0.8,
      });
      positive = Graph.out(applied, 0);
      negative = Graph.out(applied, 1);
    } else {
      warnings.push("Depth lock skipped: Depth Anything 3 or the depth ControlNet is not installed.");
    }
  }

  // Material transfer: one IP-Adapter pass per surface, confined to that surface's mask
  const withRefs = req.surfaces.filter((x) => x.refs.length);
  if (withRefs.length) {
    if (m.hasIpAdapter && m.ipadapter && m.clipVision) {
      const ipa = g.add("IPAdapterModelLoader", { ipadapter_file: m.ipadapter }, "IP-Adapter");
      const cv = g.add("CLIPVisionLoader", { clip_name: m.clipVision }, "CLIP Vision");
      for (const surf of withRefs) {
        let img: Link = Graph.out(g.add("LoadImage", { image: surf.refs[0] }, `${surf.bucket} reference`), 0);
        for (const extra of surf.refs.slice(1)) {
          const next = g.add("LoadImage", { image: extra });
          img = Graph.out(g.add("ImageBatch", { image1: img, image2: Graph.out(next, 0) }), 0);
        }
        const node = g.add(
          "IPAdapterAdvanced",
          {
            model,
            ipadapter: Graph.out(ipa, 0),
            image: img,
            weight: surf.weight,
            weight_type: spec.ipaWeightType,
            combine_embeds: "average",
            start_at: 0,
            end_at: 1,
            embeds_scaling: "V only",
            attn_mask: surfaceMasks[surf.bucket],
            clip_vision: Graph.out(cv, 0),
          },
          `Apply ${surf.bucket} material`,
        );
        stages[node] = "Encoding reference materials";
        model = Graph.out(node, 0);
      }
    } else {
      warnings.push("IP-Adapter not installed: reference images are ignored; materials come from text only.");
    }
  }

  // Sample only inside the editable area
  const latent = g.add("VAEEncode", { pixels: Graph.out(base, 0), vae });
  stages[latent] = "Encoding base image";
  const noiseMasked = g.add("SetLatentNoiseMask", { samples: Graph.out(latent, 0), mask: Graph.out(hard, 0) });
  const sampler = g.add(
    "KSampler",
    {
      model,
      seed: req.seed,
      steps: s.steps,
      cfg: s.cfg,
      sampler_name: s.sampler,
      scheduler: s.scheduler,
      positive,
      negative,
      latent_image: Graph.out(noiseMasked, 0),
      denoise: s.denoise,
    },
    "Render",
  );
  stages[sampler] = "Applying materials";
  const decoded = g.add("VAEDecode", { samples: Graph.out(sampler, 0), vae });
  stages[decoded] = "Decoding";

  // Structural lock: everything outside the masks is the original image
  const locked = g.add(
    "ImageCompositeMasked",
    { destination: Graph.out(base, 0), source: Graph.out(decoded, 0), x: 0, y: 0, resize_source: false, mask: Graph.out(soft, 0) },
    "Structure lock",
  );
  stages[locked] = "Locking structure";
  const previewNode = g.add("SaveImage", { images: Graph.out(locked, 0), filename_prefix: `${req.prefix}_preview` }, "Preview");

  let finalNode: string | null = null;
  if (s.upscale) {
    const size = { width: req.finalWidth, height: req.finalHeight, crop: "disabled" };
    let finalImage: Link;
    if (!m.upscaleModel) {
      warnings.push("No ESRGAN model installed: 4K output uses plain resampling. Download 4x-UltraSharp.");
      finalImage = Graph.out(g.add("ImageScale", { image: Graph.out(locked, 0), upscale_method: "lanczos", ...size }), 0);
    } else {
      const upModel = g.add("UpscaleModelLoader", { model_name: m.upscaleModel }, "ESRGAN");
      if (s.profile === "studio" && m.hasUltimateUpscale) {
        const usdu = g.add(
          "UltimateSDUpscale",
          {
            image: Graph.out(locked, 0),
            model: baseModel,
            positive: plainPositive,
            negative: plainNegative,
            vae,
            upscale_by: req.finalWidth / req.width,
            seed: req.seed,
            steps: 18,
            cfg: s.cfg,
            sampler_name: s.sampler,
            scheduler: s.scheduler,
            denoise: 0.25,
            upscale_model: Graph.out(upModel, 0),
            mode_type: "Linear",
            tile_width: 1024,
            tile_height: 1024,
            mask_blur: 8,
            tile_padding: 32,
            seam_fix_mode: "None",
            seam_fix_denoise: 1,
            seam_fix_width: 64,
            seam_fix_mask_blur: 8,
            seam_fix_padding: 16,
            force_uniform_tiles: true,
            tiled_decode: false,
          },
          "Ultimate SD Upscale",
        );
        stages[usdu] = "Upscaling to 4K (tiled diffusion)";
        const usduSized = g.add("ImageScale", { image: Graph.out(usdu, 0), upscale_method: "lanczos", ...size });
        // Re-lock at 4K: the low-denoise tile pass must not touch unmasked structure either
        const baseUp = g.add("ImageUpscaleWithModel", { upscale_model: Graph.out(upModel, 0), image: Graph.out(base, 0) });
        const baseSized = g.add("ImageScale", { image: Graph.out(baseUp, 0), upscale_method: "lanczos", ...size });
        const maskImg = g.add("MaskToImage", { mask: Graph.out(soft, 0) });
        const maskSized = g.add("ImageScale", { image: Graph.out(maskImg, 0), upscale_method: "bilinear", ...size });
        const maskUp = g.add("ImageToMask", { image: Graph.out(maskSized, 0), channel: "red" });
        finalImage = Graph.out(
          g.add("ImageCompositeMasked", {
            destination: Graph.out(baseSized, 0),
            source: Graph.out(usduSized, 0),
            x: 0,
            y: 0,
            resize_source: false,
            mask: Graph.out(maskUp, 0),
          }),
          0,
        );
      } else {
        if (s.profile === "studio") warnings.push("Ultimate SD Upscale not installed: using a pure ESRGAN 4K pass.");
        const up = g.add("ImageUpscaleWithModel", { upscale_model: Graph.out(upModel, 0), image: Graph.out(locked, 0) });
        stages[up] = "Upscaling to 4K";
        finalImage = Graph.out(g.add("ImageScale", { image: Graph.out(up, 0), upscale_method: "lanczos", ...size }), 0);
      }
    }
    finalNode = g.add("SaveImage", { images: finalImage, filename_prefix: `${req.prefix}_final` }, "Final 4K");
    stages[finalNode] = "Saving 4K render";
  }

  return { prompt: g.prompt, previewNode, finalNode, stages, warnings };
}
