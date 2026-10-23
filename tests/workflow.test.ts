import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyDefaults, comboOptions, validatePrompt, type ObjectInfo } from "../lib/workflow/graph";
import { buildGenerationGraph } from "../lib/workflow/generate";
import { buildSegmentationGraph } from "../lib/workflow/segment";
import { defaultSettings, fitDims, resolveModels } from "../lib/workflow/profiles";

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
  const g = buildGenerationGraph(liteRequest({ useDepth: true }));
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

test("line lock blanks old texture inside the editable area", () => {
  const g = buildGenerationGraph(liteRequest());
  const entries = Object.entries(g.prompt);
  const [cannyId] = entries.find(([, n]) => n.class_type === "Canny")!;
  const blank = entries.find(([, n]) => n.class_type === "ImageCompositeMasked" && JSON.stringify(n.inputs.destination) === JSON.stringify([cannyId, 0]));
  assert.ok(blank, "canny output must be masked before reaching the ControlNet");
  const [, grow] = entries.find(([id]) => JSON.stringify(blank![1].inputs.mask) === JSON.stringify([id, 0]))!;
  assert.equal(grow.class_type, "GrowMask");
  assert.ok((grow.inputs.expand as number) < 0, "mask must be eroded so boundary lines survive");
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
