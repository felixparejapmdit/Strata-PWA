import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyDefaults, comboOptions, validatePrompt, type ObjectInfo } from "../lib/workflow/graph";
import { buildGenerationGraph } from "../lib/workflow/generate";
import { buildSegmentationGraph } from "../lib/workflow/segment";
import { defaultSettings, fitDims, migrateSettings, resolveModels } from "../lib/workflow/profiles";
import { planCrop } from "../lib/workflow/crop";
import { buildUpscaleGraph } from "../lib/workflow/upscale";
import { buildEncodeGraph } from "../lib/workflow/embeds";

// Trimmed /object_info captured from a live ComfyUI 0.42 (CPU, SD1.5 models installed).
const info = JSON.parse(fs.readFileSync(new URL("./fixtures/object_info.json", import.meta.url), "utf8")) as ObjectInfo;

function withModels(extra: Record<string, string[]>): ObjectInfo {
  const copy = structuredClone(info);
  for (const [key, files] of Object.entries(extra)) {
    const [cls, input] = key.split(".");
    const spec = copy[cls].input.required![input];
    if (Array.isArray(spec[0])) (spec[0] as string[]).push(...files);
    else (spec[1]!.options as string[]).push(...files);
  }
  return copy;
}

const fullLite = withModels({
  "CheckpointLoaderSimple.ckpt_name": ["sam3.1_multiplex_fp16.safetensors"],
  "ControlNetLoader.control_net_name": ["control_v11f1p_sd15_depth_fp16.safetensors"],
  "IPAdapterModelLoader.ipadapter_file": ["ip-adapter-plus_sd15.safetensors"],
  "LoadDA3Model.model_name": ["depth_anything_3_small.safetensors"],
  "UpscaleModelLoader.model_name": ["4x-UltraSharp.pth"],
});

function liteRequest(overrides: Partial<ReturnType<typeof defaultSettings>> = {}, objectInfo = fullLite) {
  const settings = { ...defaultSettings("lite"), ...overrides };
  return {
    settings,
    models: resolveModels("lite", settings, objectInfo),
    baseImage: "strata/p_base.png",
    unionHard: "strata/p_union_hard.png",
    unionSoft: "strata/p_union_soft.png",
    width: 768,
    height: 512,
    finalWidth: 3840,
    finalHeight: 2560,
    surfaces: [
      { bucket: "floor" as const, mask: "strata/p_mask_floor.png", refs: ["strata/r1.png", "strata/r2.png"], weight: 0.85, prompt: "floor: marble" },
      { bucket: "walls" as const, mask: "strata/p_mask_walls.png", refs: [], weight: 0.85, prompt: "walls: matte paint" },
    ],
    globalPrompt: "interior",
    seed: 42,
    prefix: "strata/test",
  };
}

test("combo options read both legacy and v3 shapes", () => {
  assert.ok(comboOptions(info, "KSampler", "sampler_name")!.includes("lcm"));
  assert.deepEqual(comboOptions(info, "ImageToMask", "channel"), ["red", "green", "blue", "alpha"]);
});

test("resolveModels prefers IP-Adapter Plus and UltraSharp when installed", () => {
  const m = resolveModels("lite", defaultSettings("lite"), fullLite);
  assert.equal(m.ipadapter, "ip-adapter-plus_sd15.safetensors");
  assert.equal(m.upscaleModel, "4x-UltraSharp.pth");
  assert.equal(m.sam, "sam3.1_multiplex_fp16.safetensors");
  assert.equal(m.hasUltimateUpscale, false);
});

test("resolveModels falls back to what this machine already has", () => {
  const m = resolveModels("lite", defaultSettings("lite"), info);
  assert.equal(m.checkpoint, "Realistic_Vision_V5.1_fp16-no-ema.safetensors");
  assert.equal(m.ipadapter, "ip-adapter_sd15.safetensors");
  assert.equal(m.upscaleModel, "RealESRGAN_x4plus.pth");
  assert.equal(m.depthControlNet, null);
});

test("lite generation graph validates against the live schema", () => {
  const g = buildGenerationGraph(liteRequest({ useDepth: true, upscale: true }));
  applyDefaults(g.prompt, fullLite);
  assert.deepEqual(validatePrompt(g.prompt, fullLite), []);
  assert.deepEqual(g.warnings, []);
  const types = Object.values(g.prompt).map((n) => n.class_type);
  for (const t of ["LoraLoader", "Canny", "DA3Inference", "IPAdapterAdvanced", "SetLatentNoiseMask", "ImageCompositeMasked", "ImageUpscaleWithModel"]) {
    assert.ok(types.includes(t), `missing ${t}`);
  }
  // Only surfaces with references get an IP-Adapter pass.
  assert.equal(types.filter((t) => t === "IPAdapterAdvanced").length, 1);
  assert.equal(types.filter((t) => t === "ImageBatch").length, 1);
});

test("structure lock composites the render over the untouched base with the soft mask", () => {
  const g = buildGenerationGraph(liteRequest());
  const [lockId, lock] = Object.entries(g.prompt).find(([, n]) => n._meta?.title === "Structure lock")!;
  const base = Object.entries(g.prompt).find(([, n]) => n._meta?.title === "Base image")![0];
  const soft = Object.entries(g.prompt).find(([, n]) => n._meta?.title === "Blend mask")![0];
  assert.deepEqual(lock.inputs.destination, [base, 0]);
  assert.deepEqual(lock.inputs.mask, [soft, 0]);
  assert.deepEqual(g.prompt[g.previewNode].inputs.images, [lockId, 0]);
});

test("line lock blanks texture per surface, keeping the corners between surfaces", () => {
  const g = buildGenerationGraph(liteRequest());
  const entries = Object.entries(g.prompt);
  const byId = Object.fromEntries(entries);
  const [cannyId] = entries.find(([, n]) => n.class_type === "Canny")!;
  const blank = entries.find(([, n]) => n.class_type === "ImageCompositeMasked" && JSON.stringify(n.inputs.destination) === JSON.stringify([cannyId, 0]))!;
  assert.ok(blank, "canny output must be masked before reaching the ControlNet");
  // Two surfaces → their eroded masks are added together; the grown union is not used.
  const combine = byId[(blank[1].inputs.mask as [string, number])[0]];
  assert.equal(combine.class_type, "MaskComposite");
  const erosions = entries.filter(([, n]) => n.class_type === "GrowMask" && (n.inputs.expand as number) < 0);
  assert.equal(erosions.length, 2, "one erosion per surface");
  const sources = erosions.map(([, n]) => byId[(n.inputs.mask as [string, number])[0]]._meta?.title);
  assert.deepEqual(sources.sort(), ["floor mask", "walls mask"], "each erosion starts from a single surface mask");
});

test("depth lock is on by default and holds through the last step", () => {
  const g = buildGenerationGraph(liteRequest());
  const depthApply = Object.values(g.prompt).filter((n) => n.class_type === "ControlNetApplyAdvanced").at(-1)!;
  assert.equal(depthApply.inputs.end_percent, 1);
  assert.ok(Object.values(g.prompt).some((n) => n.class_type === "DA3Inference"));
  const ipa = Object.values(g.prompt).find((n) => n.class_type === "IPAdapterAdvanced")!;
  assert.equal(ipa.inputs.weight_type, "style transfer", "references transfer finish, not objects");
});

test("missing optional models degrade with warnings instead of failing", () => {
  const g = buildGenerationGraph(liteRequest({ useDepth: true, useLcm: true }, info));
  applyDefaults(g.prompt, info);
  assert.deepEqual(validatePrompt(g.prompt, info), []);
  assert.ok(g.warnings.some((w) => w.includes("Depth lock skipped")));
});

test("validatePrompt reports models that are not installed", () => {
  const req = liteRequest();
  req.models = { ...req.models, ipadapter: "nope.safetensors" };
  const g = buildGenerationGraph(req);
  applyDefaults(g.prompt, fullLite);
  const problems = validatePrompt(g.prompt, fullLite);
  assert.ok(problems.some((p) => p.includes("nope.safetensors")));
});

test("studio graph without Ultimate SD Upscale is flagged as missing the node", () => {
  const settings = defaultSettings("studio");
  const req = { ...liteRequest(), settings, models: { ...resolveModels("studio", settings, fullLite), checkpoint: "x.safetensors", hasUltimateUpscale: true, upscaleModel: "4x-UltraSharp.pth" } };
  const g = buildGenerationGraph(req);
  const problems = validatePrompt(g.prompt, fullLite);
  assert.ok(problems.some((p) => p.includes("UltimateSDUpscale")));
});

test("segmentation graph uses one SAM3 detection per layer with multi-concept prompts", () => {
  const g = buildSegmentationGraph({ image: "strata/p_seg.png", samCheckpoint: "sam3.1_multiplex_fp16.safetensors", layers: ["floor", "walls", "protected"], prefix: "strata/p_seg" });
  applyDefaults(g.prompt, fullLite);
  assert.deepEqual(validatePrompt(g.prompt, fullLite), []);
  assert.equal(Object.values(g.prompt).filter((n) => n.class_type === "SAM3_Detect").length, 3);
  assert.deepEqual(Object.values(g.outputs).sort(), ["floor", "protected", "walls"]);
  const texts = Object.values(g.prompt).filter((n) => n.class_type === "CLIPTextEncode").map((n) => n.inputs.text);
  assert.ok(texts.includes("wall:8"));
});

test("fitDims snaps to multiples of 8 and keeps aspect", () => {
  assert.deepEqual(fitDims(4032, 3024, 768), { width: 768, height: 576 });
  const d = fitDims(1000, 333, 3840);
  assert.equal(d.width % 8, 0);
  assert.equal(d.height % 8, 0);
});

test("planCrop pads the edit region, keeps it inside the image and 8-aligned", () => {
  const c = planCrop({ x: 20, y: 300, width: 300, height: 180 }, 768, 512)!;
  assert.ok(c);
  for (const v of [c.x, c.y, c.width, c.height]) assert.equal(v % 8, 0);
  assert.ok(c.x <= 20 && c.y <= 300, "crop must contain the region");
  assert.ok(c.x + c.width >= 320 && c.y + c.height >= 480);
  assert.ok(c.x + c.width <= 768 && c.y + c.height <= 512, "crop must stay inside the image");
  assert.ok(c.width >= 384 && c.height >= 384, "crop is grown to a usable size");
});

test("planCrop declines when the region already covers most of the frame", () => {
  assert.equal(planCrop({ x: 0, y: 0, width: 760, height: 500 }, 768, 512), null);
  assert.equal(planCrop(null, 768, 512), null);
  assert.equal(planCrop({ x: 0, y: 0, width: 0, height: 0 }, 768, 512), null);
});

test("cropped graph diffuses the region and pastes it back at the crop offset", () => {
  const crop = { x: 0, y: 128, width: 512, height: 384 };
  const g = buildGenerationGraph({ ...liteRequest({ useDepth: true }), crop });
  applyDefaults(g.prompt, fullLite);
  assert.deepEqual(validatePrompt(g.prompt, fullLite), []);
  const nodes = Object.entries(g.prompt);
  const [cropId] = nodes.find(([, n]) => n.class_type === "ImageCrop")!;
  // Canny, depth and VAE encode all read the crop, not the full base.
  for (const t of ["Canny", "DA3Inference", "VAEEncode"]) {
    const [, n] = nodes.find(([, x]) => x.class_type === t)!;
    assert.deepEqual(n.inputs.image ?? n.inputs.pixels, [cropId, 0], `${t} must read the crop`);
  }
  const black = nodes.find(([, n]) => n.class_type === "EmptyImage")![1];
  assert.equal(black.inputs.width, 512);
  assert.equal(black.inputs.height, 384);
  const lock = nodes.find(([, n]) => n._meta?.title === "Structure lock")![1];
  assert.equal(lock.inputs.x, 0);
  assert.equal(lock.inputs.y, 128);
  const baseId = nodes.find(([, n]) => n._meta?.title === "Base image")![0];
  assert.deepEqual(lock.inputs.destination, [baseId, 0], "paste-back target is the full untouched base");
  assert.ok(nodes.filter(([, n]) => n.class_type === "CropMask").length >= 4, "hard, soft and every surface mask are cropped");
});

test("on-demand 4K is a pure ESRGAN pass (no diffusion, structure untouched)", () => {
  const g = buildUpscaleGraph({ image: "strata/p_up.png", upscaleModel: "4x-UltraSharp.pth", width: 3840, height: 2560, prefix: "strata/t" });
  applyDefaults(g.prompt, fullLite);
  assert.deepEqual(validatePrompt(g.prompt, fullLite), []);
  const types = Object.values(g.prompt).map((n) => n.class_type);
  assert.ok(types.includes("ImageUpscaleWithModel"));
  assert.ok(!types.some((t) => /KSampler|VAE|ControlNet|IPAdapter/.test(t)), "no diffusion in the upscale pass");
  const scale = Object.values(g.prompt).find((n) => n.class_type === "ImageScale")!;
  assert.equal(scale.inputs.width, 3840);
  assert.equal(scale.inputs.height, 2560);
});

test("new Lite projects default to CFG 1 (no negative pass) and 4K on demand", () => {
  const s = defaultSettings("lite");
  assert.equal(s.cfg, 1);
  assert.equal(s.upscale, false);
  assert.deepEqual(migrateSettings(s), [], "fresh settings need no migration");
});

test("migration updates only values still at the old defaults", () => {
  const old = { ...defaultSettings("lite"), cfg: 1.5, upscale: true, settingsVersion: undefined };
  assert.equal(migrateSettings(old).length, 2);
  assert.equal(old.cfg, 1);
  assert.equal(old.upscale, false);

  const tuned = { ...defaultSettings("lite"), cfg: 2.5, upscale: false, settingsVersion: undefined };
  migrateSettings(tuned);
  assert.equal(tuned.cfg, 2.5, "a CFG the user chose is kept");

  const studio = { ...defaultSettings("studio"), settingsVersion: undefined };
  assert.deepEqual(migrateSettings(studio), [], "Studio settings are untouched");
});

test("planCrop crops a wide floor strip (regression: padding came from the longest side)", () => {
  // Exact union bbox the UI uploaded for a floor painted across the room.
  const c = planCrop({ x: 3, y: 331, width: 762, height: 181 }, 768, 512);
  assert.ok(c, "a floor covering the bottom third must be cropped");
  assert.equal(c!.height, 384);
  assert.ok(c!.y <= 331 && c!.y + c!.height >= 512);
});

test("reference encoding runs as its own job and averages like IPAdapterAdvanced", () => {
  const g = buildEncodeGraph({ ipadapter: "ip-adapter-plus_sd15.safetensors", clipVision: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors", items: [{ key: "abc_1", refs: ["strata/r1.png", "strata/r2.png"] }] });
  applyDefaults(g.prompt, fullLite);
  assert.deepEqual(validatePrompt(g.prompt, fullLite), []);
  const types = Object.values(g.prompt).map((n) => n.class_type);
  assert.ok(!types.some((t) => /Checkpoint|KSampler|ControlNet/.test(t)), "no diffusion models in the encode job");
  const combine = Object.values(g.prompt).find((n) => n.class_type === "IPAdapterCombineEmbeds")!;
  assert.equal(combine.inputs.method, "average");
  assert.deepEqual(g.files.abc_1, { pos: "strata_emb_abc_1_pos.ipadpt", neg: "strata_emb_abc_1_neg.ipadpt" });
  const saves = Object.values(g.prompt).filter((n) => n.class_type === "IPAdapterSaveEmbeds").map((n) => n.inputs.filename_prefix);
  assert.deepEqual(saves.sort(), ["strata_emb_abc_1_neg", "strata_emb_abc_1_pos"], "saved under the canonical prefixes the server promotes");
});

test("generation with pre-encoded embeddings never loads CLIP Vision", () => {
  const req = liteRequest();
  req.surfaces = req.surfaces.map((x) => (x.refs.length ? { ...x, embeds: { pos: "strata_emb_k_pos.ipadpt", neg: "strata_emb_k_neg.ipadpt" } } : x));
  const g = buildGenerationGraph(req);
  applyDefaults(g.prompt, fullLite);
  assert.deepEqual(validatePrompt(g.prompt, fullLite), []);
  const types = Object.values(g.prompt).map((n) => n.class_type);
  assert.ok(!types.includes("CLIPVisionLoader"), "CLIP Vision must not be loaded during diffusion");
  assert.ok(types.includes("IPAdapterEmbeds") && !types.includes("IPAdapterAdvanced"));
  const apply = Object.values(g.prompt).find((n) => n.class_type === "IPAdapterEmbeds")!;
  assert.ok(apply.inputs.attn_mask, "embeddings stay confined to the surface mask");
});

const withSplit = withModels({
  "CheckpointLoaderSimple.ckpt_name": ["sam3.1_multiplex_fp16.safetensors"],
  "IPAdapterModelLoader.ipadapter_file": ["ip-adapter-plus_sd15.safetensors"],
  "UpscaleModelLoader.model_name": ["4x-UltraSharp.pth"],
  "UNETLoader.unet_name": ["Realistic_Vision_V5.1_unet.safetensors"],
  "CLIPLoader.clip_name": ["Realistic_Vision_V5.1_clip_l.safetensors"],
});

test("split UNet resolves only when all parts exist for the chosen checkpoint", () => {
  assert.deepEqual(resolveModels("lite", defaultSettings("lite"), withSplit).split, {
    unet: "Realistic_Vision_V5.1_unet.safetensors",
    clip: "Realistic_Vision_V5.1_clip_l.safetensors",
    vae: "vae-ft-mse-840000-ema-pruned.safetensors",
  });
  assert.equal(resolveModels("lite", defaultSettings("lite"), fullLite).split, null, "parts not converted yet");
  const other = withModels({ "CheckpointLoaderSimple.ckpt_name": ["other_sd15.safetensors"], "UNETLoader.unet_name": ["Realistic_Vision_V5.1_unet.safetensors"], "CLIPLoader.clip_name": ["Realistic_Vision_V5.1_clip_l.safetensors"] });
  assert.equal(resolveModels("lite", { checkpoint: "other_sd15.safetensors" }, other).split, null, "split parts belong to a different checkpoint");
});

test("low-memory renders store only the UNet in fp8 (per model, not a global flag)", () => {
  const settings = defaultSettings("lite");
  const req = { ...liteRequest({}, withSplit), models: resolveModels("lite", settings, withSplit), fp8Unet: true };
  const g = buildGenerationGraph(req);
  applyDefaults(g.prompt, withSplit);
  assert.deepEqual(validatePrompt(g.prompt, withSplit), []);
  const types = Object.values(g.prompt).map((n) => n.class_type);
  assert.ok(!types.includes("CheckpointLoaderSimple"));
  const unet = Object.values(g.prompt).find((n) => n.class_type === "UNETLoader")!;
  assert.equal(unet.inputs.weight_dtype, "fp8_e4m3fn");
  assert.ok(types.includes("CLIPLoader") && types.includes("VAELoader") && types.includes("LoraLoader"));
  // Without the flag (or without the parts) the full checkpoint is used as before.
  assert.ok(Object.values(buildGenerationGraph({ ...req, fp8Unet: false }).prompt).some((n) => n.class_type === "CheckpointLoaderSimple"));
});

test("low-memory hosts run the depth lock alone instead of two ControlNets", () => {
  const withDepth = withModels({
    "ControlNetLoader.control_net_name": ["control_v11f1p_sd15_depth_fp16.safetensors"],
    "LoadDA3Model.model_name": ["depth_anything_3_small.safetensors"],
    "IPAdapterModelLoader.ipadapter_file": ["ip-adapter-plus_sd15.safetensors"],
  });
  const base = liteRequest({}, withDepth);
  const count = (g: ReturnType<typeof buildGenerationGraph>, t: string) => Object.values(g.prompt).filter((n) => n.class_type === t).length;
  const both = buildGenerationGraph(base);
  assert.equal(count(both, "ControlNetApplyAdvanced"), 2);
  const single = buildGenerationGraph({ ...base, singleControlNet: true });
  assert.equal(count(single, "ControlNetApplyAdvanced"), 1);
  assert.equal(count(single, "Canny"), 0);
  assert.equal(count(single, "DA3Inference"), 1, "the depth lock is the one kept");
  // Without depth available, the line lock stays even on low-memory hosts.
  const noDepth = buildGenerationGraph({ ...liteRequest({ useDepth: false }, withDepth), singleControlNet: true });
  assert.equal(count(noDepth, "Canny"), 1);
});
