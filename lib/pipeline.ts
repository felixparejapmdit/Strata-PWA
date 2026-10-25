"use client";

import type { BucketId, LayerId, Project, RenderRecord } from "./types";
import { BUCKETS, LAYERS, LAYER_INFO, zoneLabel } from "./buckets";
import { findMaterial, type Material } from "./materials";
import { computeBoq } from "./boq";
import { buildGuidelines } from "./guidelines";
import type { ProposalPayload, ScheduleItem } from "./proposal";
import { globalPrompt, surfacePrompt } from "./prompting";
import { getBlob, kvGet, kvSet, putBlob, uid } from "./db";
import { masks } from "./masks";
import { comfy, CancelledError } from "./comfy-client";
import { bitmapFromBlob, canvas, ctx2d, fitWithin, maskBBox, maskFromBwBlob, maskToBwBlob, newMask, resizeBlob, squareCropBlob, toBlob, unionInto } from "./image";
import { planCrop } from "./workflow/crop";
import { applyDefaults, validatePrompt } from "./workflow/graph";
import { buildSegmentationGraph } from "./workflow/segment";
import { buildGenerationGraph, type SurfaceInput } from "./workflow/generate";
import { buildUpscaleGraph } from "./workflow/upscale";
import { buildEncodeGraph, EMBED_NODES, type EmbedFiles, type EncodeItem } from "./workflow/embeds";
import { fitDims, resolveModels } from "./workflow/profiles";
import { masksChanged, patchProject, toast, useStore, type JobState } from "./store";

const get = useStore.getState;
const set = useStore.setState;

function startJob(kind: JobState["kind"], stage: string): AbortController {
  const controller = new AbortController();
  set({ job: { kind, stage, value: 0, max: 0, preview: null, startedAt: Date.now(), controller } });
  return controller;
}

function updateJob(patch: Partial<JobState>) {
  const job = get().job;
  if (job) set({ job: { ...job, ...patch } });
}

export function cancelJob() {
  get().job?.controller.abort();
}

function requireOnline(): boolean {
  const d = get().doctor;
  if (d?.online && d.objectInfo) return true;
  toast("ComfyUI is offline. Start it, or check the URL in Settings.", "error", { label: "Settings", run: () => set({ modal: "settings" }) });
  return false;
}

/**
 * IP-Adapter Plus computes in unet_dtype(); with --fp16-unet/--bf16-unet on CPU the UNet runs
 * through an fp32 manual cast, so its attention patch mixes fp32 and fp16 and every render with
 * reference images fails in the sampler ("mat1 and mat2 must have the same dtype").
 */
export function ipAdapterDtypeConflict(): boolean {
  const d = get().doctor;
  return d?.device?.type === "cpu" && (d.argv ?? []).some((a) => /^--(fp16|bf16)-unet$/.test(a));
}

/** True on hosts where ComfyUI's model cache can overflow memory (CPU inference, or little RAM/VRAM). */
function memoryTight(): boolean {
  const d = get().doctor;
  if (!d?.online) return false;
  const GB = 1024 ** 3;
  return d.device?.type === "cpu" || (d.ramFree ?? Infinity) < 3 * GB || (d.device?.type === "cuda" && d.device.vramTotal < 8 * GB);
}

/**
 * ComfyUI keeps every model it has loaded (checkpoint, ControlNets, CLIP Vision, SAM3) cached.
 * On an 8 GB CPU machine that overflows RAM and the next job thrashes swap for hours, so ask
 * ComfyUI to evict its cache before queueing. The flag is honoured before the next prompt runs.
 */
async function freeComfyMemoryIfTight() {
  if (!memoryTight()) return;
  await fetch("/api/comfy/free", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }).catch(() => {});
}

async function sha1Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/**
 * Gives every surface with references pre-encoded IP-Adapter embeddings, encoding only reference
 * sets not already cached. The encode runs as its own small job, so CLIP Vision is never in
 * memory together with the diffusion models. Needs ComfyUI on this machine (files are copied
 * from its output to its input folder); otherwise surfaces keep the in-graph encoder.
 */
async function ensureEmbeddings(surfaces: SurfaceInput[], refIds: Partial<Record<BucketId, string[]>>, models: ReturnType<typeof resolveModels>, signal: AbortSignal) {
  const { doctor } = get();
  const info = doctor?.objectInfo;
  const withRefs = surfaces.filter((x) => x.refs.length);
  if (!withRefs.length || !doctor?.comfyPath || !models.ipadapter || !models.clipVision || !EMBED_NODES.every((n) => info?.[n])) return;

  const keys = new Map<SurfaceInput, string>();
  const toEncode: EncodeItem[] = [];
  const pending = new Map<string, SurfaceInput[]>();
  for (const surf of withRefs) {
    const key = await sha1Hex([models.ipadapter, models.clipVision, ...(refIds[surf.bucket] ?? surf.refs)].join("|"));
    keys.set(surf, key);
    const cached = await kvGet<EmbedFiles>(`emb:${key}`);
    if (cached) {
      const check = await (await fetch(`/api/embeds?check=${cached.pos},${cached.neg}`)).json();
      if (check.exists?.[cached.pos] && check.exists?.[cached.neg]) {
        surf.embeds = cached;
        continue;
      }
    }
    if (!pending.has(key)) {
      pending.set(key, []);
      // A fresh suffix guarantees SaveEmbeds writes counter 00001 (see embedFileName).
      toEncode.push({ key: `${key}_${Date.now().toString(36)}`, refs: surf.refs });
    }
    pending.get(key)!.push(surf);
  }
  if (!toEncode.length) return;

  updateJob({ stage: "Encoding reference materials", value: 0, max: 0 });
  const graph = buildEncodeGraph({ ipadapter: models.ipadapter, clipVision: models.clipVision, items: toEncode });
  applyDefaults(graph.prompt, info!);
  const problems = validatePrompt(graph.prompt, info!);
  if (problems.length) throw new Error(problems[0]);
  await freeComfyMemoryIfTight();
  await comfy().run(graph.prompt, graph.stages, { onStage: (stage) => updateJob({ stage }) }, signal);

  const names = Object.values(graph.files).flatMap((f) => [f.pos, f.neg]);
  const res = await (await fetch("/api/embeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ promote: names }) })).json();
  if (!res.ok) throw new Error(`Reference encoding produced no files (${(res.missing ?? []).join(", ") || res.error}).`);
  for (const item of toEncode) {
    const hash = item.key.split("_")[0];
    const files = graph.files[item.key];
    await kvSet(`emb:${hash}`, files);
    for (const surf of pending.get(hash) ?? []) surf.embeds = files;
  }
}

/** Surfaces that will be repainted: enabled, masked, and given a reference or material. */
export function activeSurfaces(p: Project | null = get().project): BucketId[] {
  if (!p) return [];
  return BUCKETS.filter((b) => p.buckets[b].enabled && p.masks[b].coverage > 0.001 && (p.buckets[b].refs.length > 0 || !!p.buckets[b].materialId));
}

// ---------- auto-detect ----------

export async function runSegmentation(only?: LayerId[]) {
  const p = get().project;
  if (!p?.base || get().job || !requireOnline()) return;
  const info = get().doctor!.objectInfo!;
  const models = resolveModels(p.settings.profile, p.settings, info);
  if (!models.hasSam3 || !models.sam) {
    toast("SAM3 model not installed: download it in Model Manager, or paint masks by hand.", "error", { label: "Model Manager", run: () => set({ modal: "models" }) });
    return;
  }
  const layers = only ?? LAYERS;
  const controller = startJob("segment", "Uploading image");
  try {
    const edit = (await getBlob(p.base.editBlobId))!;
    const image = await comfy().upload(edit, `${p.id}_seg.png`);
    const graph = buildSegmentationGraph({ image, samCheckpoint: models.sam, layers, prefix: `strata/${p.id}_seg`, refineIterations: memoryTight() ? 1 : 2 });
    applyDefaults(graph.prompt, info);
    const problems = validatePrompt(graph.prompt, info);
    if (problems.length) throw new Error(problems[0]);
    await freeComfyMemoryIfTight();
    updateJob({ stage: "Loading SAM3" });
    const outputs = await comfy().run(graph.prompt, graph.stages, {
      onStage: (stage) => updateJob({ stage }),
      onProgress: (value, max) => updateJob({ value, max }),
    }, controller.signal);

    masks.checkpoint(layers[0]);
    const found: string[] = [];
    for (const [nodeId, layer] of Object.entries(graph.outputs)) {
      const img = outputs[nodeId]?.images?.[0];
      if (!img) continue;
      const m = await maskFromBwBlob(await comfy().fetchImage(img), p.base.editWidth, p.base.editHeight);
      masks.replace(layer, m);
    }
    masks.resolveOverlaps();
    for (const layer of layers) {
      const c = masks.get(layer);
      const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
      let on = 0;
      for (let i = 3; i < d.length; i += 16) if (d[i] > 127) on++;
      if (on / (d.length / 16) > 0.002) found.push(LAYER_INFO[layer].label);
    }
    masksChanged(LAYERS, "auto");
    toast(found.length ? `Detected: ${found.join(", ")}. Refine with the brush; Ctrl+Z to undo.` : "Nothing detected. Paint the surfaces by hand.", found.length ? "success" : "info");
  } catch (e) {
    if (e instanceof CancelledError) toast("Detection cancelled");
    else toast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    set({ job: null });
  }
}

// ---------- generate ----------

export async function generate() {
  const state = get();
  const p = state.project;
  if (!p?.base || state.job || !requireOnline()) return;
  const surfacesToRender = activeSurfaces();
  if (!surfacesToRender.length) {
    toast("Nothing to render yet: mask at least one surface and give it a reference image or material.", "error");
    return;
  }
  const info = state.doctor!.objectInfo!;
  const s = p.settings;
  const models = resolveModels(s.profile, s, info);
  if (!models.checkpoint) {
    toast(`No ${s.profile === "studio" ? "SDXL" : "SD1.5"} checkpoint installed.`, "error", { label: "Model Manager", run: () => set({ modal: "models" }) });
    return;
  }

  if (surfacesToRender.some((b) => p.buckets[b].refs.length) && ipAdapterDtypeConflict()) {
    toast("ComfyUI was started with --fp16-unet, which breaks reference images on CPU (IP-Adapter dtype mismatch). Restart ComfyUI without it: python main.py --listen 127.0.0.1 --cpu", "error", { label: "Settings", run: () => set({ modal: "settings" }) });
    return;
  }

  const controller = startJob("generate", "Preparing inputs");
  const t0 = Date.now();
  try {
    const seed = s.seed >= 0 ? s.seed : Math.floor(Math.random() * 2 ** 31);
    const work = fitDims(p.base.width, p.base.height, Math.min(s.workLongSide, Math.max(p.base.width, p.base.height) * 2));
    const final = fitDims(p.base.width, p.base.height, s.targetLongSide);
    const tag = `${p.id}_${uid()}`;

    const baseBmp = await bitmapFromBlob((await getBlob(p.base.blobId))!);
    const baseImage = await comfy().upload(await resizeBlob(baseBmp, work.width, work.height), `${p.id}_base.png`);
    baseBmp.close();

    updateJob({ stage: "Uploading inputs" });
    const union = newMask(masks.width, masks.height);
    const descriptions: string[] = [];
    const refSize = s.profile === "studio" ? 768 : 512;
    const uploadRef = async (r: { id: string; blobId: string }) => {
      const bmp = await bitmapFromBlob((await getBlob(r.blobId))!);
      try {
        return await comfy().upload(await squareCropBlob(bmp, refSize), `${p.id}_ref_${r.id}.png`);
      } finally {
        bmp.close();
      }
    };
    // Masks and references upload in parallel; each surface is independent.
    const surfaces: SurfaceInput[] = await Promise.all(
      surfacesToRender.map(async (b) => {
        const bucket = p.buckets[b];
        const eff = masks.effective(b);
        unionInto(union, eff);
        const material = findMaterial(bucket.materialId, state.library);
        if (material) descriptions.push(`${material.prompt.split(",")[0]} ${b === "walls" ? "walls" : b}`);
        const [mask, refs] = await Promise.all([
          maskToBwBlob(eff, work.width, work.height).then((blob) => comfy().upload(blob, `${p.id}_mask_${b}.png`)),
          Promise.all(bucket.refs.map(uploadRef)),
        ]);
        return { bucket: b, mask, refs, weight: bucket.weight, prompt: surfacePrompt(b, material, bucket.refs[0]?.analysis, bucket.note) };
      }),
    );
    const [unionHard, unionSoft] = await Promise.all([
      maskToBwBlob(union, work.width, work.height, { grow: s.maskGrow + s.maskFeather }).then((blob) => comfy().upload(blob, `${p.id}_union_hard.png`)),
      maskToBwBlob(union, work.width, work.height, { grow: s.maskGrow, feather: s.maskFeather }).then((blob) => comfy().upload(blob, `${p.id}_union_soft.png`)),
    ]);
    // Diffusion cost scales with pixels, so only the edited region (plus context) is sampled.
    const crop = s.cropToMask === false ? null : planCrop(maskBBox(union, work.width, work.height), work.width, work.height);
    const refIds = Object.fromEntries(surfacesToRender.map((b) => [b, p.buckets[b].refs.map((r) => r.id)]));
    await ensureEmbeddings(surfaces, refIds, models, controller.signal);

    const graph = buildGenerationGraph({
      settings: s,
      models,
      baseImage,
      unionHard,
      unionSoft,
      width: work.width,
      height: work.height,
      finalWidth: final.width,
      finalHeight: final.height,
      surfaces,
      globalPrompt: globalPrompt(p.meta.zone, descriptions, s.extraPrompt),
      seed,
      prefix: `strata/${tag}`,
      crop,
    });
    applyDefaults(graph.prompt, info);
    const problems = validatePrompt(graph.prompt, info);
    if (problems.length) throw new Error(problems.slice(0, 2).join(" "));
    graph.warnings.forEach((w) => toast(w, "info"));

    await freeComfyMemoryIfTight();
    updateJob({ stage: "Queued" });
    const outputs = await comfy().run(graph.prompt, graph.stages, {
      onStage: (stage) => updateJob({ stage, value: 0, max: 0 }),
      onProgress: (value, max) => updateJob({ value, max }),
      onPreview: (preview) => updateJob({ preview }),
    }, controller.signal);

    updateJob({ stage: "Saving render", preview: null });
    const previewImg = outputs[graph.previewNode]?.images?.[0];
    if (!previewImg) throw new Error("ComfyUI finished without producing an image.");
    const previewBlobId = await putBlob(await comfy().fetchImage(previewImg));
    const finalImg = graph.finalNode ? outputs[graph.finalNode]?.images?.[0] : undefined;
    const finalBlobId = finalImg ? await putBlob(await comfy().fetchImage(finalImg)) : null;

    const record: RenderRecord = {
      id: uid("r_"),
      createdAt: Date.now(),
      seed,
      profile: s.profile,
      previewBlobId,
      finalBlobId,
      width: work.width,
      height: work.height,
      finalWidth: finalBlobId ? final.width : null,
      finalHeight: finalBlobId ? final.height : null,
      materials: Object.fromEntries(surfacesToRender.map((b) => [b, p.buckets[b].materialId])),
      durationMs: Date.now() - t0,
    };
    patchProject((d) => {
      d.renders.unshift(record);
      d.activeRenderId = record.id;
    });
    set({ view: "compare" });
    toast(`Render finished in ${formatDuration(record.durationMs)}${finalBlobId ? ` · 4K ${final.width}×${final.height}` : ""}`, "success");
  } catch (e) {
    if (e instanceof CancelledError) toast("Render cancelled");
    else toast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    set({ job: null });
  }
}

/**
 * 4K for one finished render, on demand. Iterating on 768 px previews is several times faster
 * on CPU than upscaling every attempt; only the render you keep needs 4K.
 */
export async function upscaleRender(renderId?: string): Promise<boolean> {
  const p = get().project;
  const render = p?.renders.find((r) => r.id === (renderId ?? p.activeRenderId)) ?? p?.renders[0];
  if (!p?.base || !render) return false;
  if (render.finalBlobId) return true;
  if (get().job || !requireOnline()) return false;
  const info = get().doctor!.objectInfo!;
  const models = resolveModels(p.settings.profile, p.settings, info);
  const final = fitDims(p.base.width, p.base.height, p.settings.targetLongSide);
  const controller = startJob("upscale", "Preparing 4K upscale");
  const t0 = Date.now();
  try {
    const image = await comfy().upload((await getBlob(render.previewBlobId))!, `${p.id}_up_${render.id}.png`);
    const graph = buildUpscaleGraph({ image, upscaleModel: models.upscaleModel, width: final.width, height: final.height, prefix: `strata/${p.id}_${uid()}` });
    applyDefaults(graph.prompt, info);
    if (!models.upscaleModel) toast("No ESRGAN model installed: 4K uses plain resampling. Download 4x-UltraSharp in Model Manager.", "info");
    await freeComfyMemoryIfTight();
    const outputs = await comfy().run(graph.prompt, graph.stages, {
      onStage: (stage) => updateJob({ stage, value: 0, max: 0 }),
      onProgress: (value, max) => updateJob({ value, max }),
    }, controller.signal);
    const img = outputs[graph.output]?.images?.[0];
    if (!img) throw new Error("ComfyUI finished without producing the 4K image.");
    const finalBlobId = await putBlob(await comfy().fetchImage(img));
    patchProject((d) => {
      const r = d.renders.find((x) => x.id === render.id);
      if (r) Object.assign(r, { finalBlobId, finalWidth: final.width, finalHeight: final.height });
    });
    toast(`4K ready (${final.width}×${final.height}) in ${formatDuration(Date.now() - t0)}`, "success");
    return true;
  } catch (e) {
    if (e instanceof CancelledError) toast("Upscale cancelled");
    else toast(e instanceof Error ? e.message : String(e), "error");
    return false;
  } finally {
    set({ job: null });
  }
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

// ---------- proposal ----------

async function jpegDataUrl(blob: Blob, maxSide: number, quality: number): Promise<string> {
  const bmp = await bitmapFromBlob(blob);
  const { width, height } = fitWithin(bmp.width, bmp.height, maxSide);
  const c = canvas(width, height);
  const x = ctx2d(c);
  x.imageSmoothingQuality = "high";
  x.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const out = await toBlob(c, "image/jpeg", quality);
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(out);
  });
}

export function proposalSelections(): Partial<Record<BucketId, Material | undefined>> {
  const { project: p, library } = get();
  if (!p) return {};
  const out: Partial<Record<BucketId, Material | undefined>> = {};
  for (const b of BUCKETS) {
    const bucket = p.buckets[b];
    if (bucket.enabled && bucket.materialId) out[b] = findMaterial(bucket.materialId, library);
  }
  return out;
}

export async function exportProposal(paper: "A4" | "A3", format: "pdf" | "html") {
  let p = get().project;
  if (!p?.base || get().job) return;
  const base = p.base;
  let render = p.renders.find((r) => r.id === p!.activeRenderId) ?? p.renders[0];
  if (!render) {
    toast("Generate a render first; the proposal is built around it.", "error");
    return;
  }
  // The cover is printed full-bleed, so make sure the chosen render has its 4K version.
  if (format === "pdf" && !render.finalBlobId && get().doctor?.online) {
    await upscaleRender(render.id);
    p = get().project!;
    render = p.renders.find((r) => r.id === render!.id) ?? render;
  }
  const controller = startJob("proposal", "Preparing images");
  try {
    const heroBlob = (await getBlob(render.finalBlobId ?? render.previewBlobId))!;
    const previewBlob = (await getBlob(render.previewBlobId))!;
    const [hero, before, after] = await Promise.all([
      jpegDataUrl(heroBlob, paper === "A3" ? 4096 : 3200, 0.9),
      jpegDataUrl((await getBlob(base.editBlobId))!, 1800, 0.88),
      jpegDataUrl(previewBlob, 1800, 0.9),
    ]);
    const selections = proposalSelections();
    const schedule: ScheduleItem[] = [];
    for (const b of BUCKETS) {
      const material = selections[b];
      if (!material) continue;
      const bucket = p.buckets[b];
      const swatches: string[] = [];
      for (const r of bucket.refs.slice(0, 3)) swatches.push(await jpegDataUrl((await getBlob(r.blobId))!, 480, 0.85));
      schedule.push({ bucket: b, label: LAYER_INFO[b].label, material, swatches, colour: bucket.refs[0]?.analysis?.swatch ?? null });
    }
    const payload: ProposalPayload = {
      project: { name: p.name, meta: p.meta, zoneLabel: zoneLabel(p.meta.zone), date: new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }) },
      images: { hero, before, after },
      schedule,
      boq: computeBoq(p.meta, selections),
      guidelines: buildGuidelines(p.meta.zone, selections),
      render: { seed: render.seed, profile: render.profile, width: render.finalWidth ?? render.width, height: render.finalHeight ?? render.height },
      paper,
    };
    updateJob({ stage: format === "pdf" ? "Rendering PDF" : "Building preview" });
    const res = await fetch(`/api/proposal${format === "html" ? "?format=html" : ""}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Export failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (format === "html") {
      window.open(url, "_blank");
    } else {
      download(url, `${p.name.replace(/[^\w\- ]+/g, "").trim() || "proposal"} - proposal.pdf`);
      toast("Proposal PDF exported", "success");
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    if ((e as Error).name !== "AbortError") toast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    set({ job: null });
  }
}

export function download(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function downloadRender(render: RenderRecord, name: string) {
  const blob = await getBlob(render.finalBlobId ?? render.previewBlobId);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  download(url, `${name} - ${render.finalBlobId ? "4K" : "preview"} - ${render.seed}.png`);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
