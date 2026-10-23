"use client";

import type { BucketId, LayerId, Project, RenderRecord } from "./types";
import { BUCKETS, LAYERS, LAYER_INFO, zoneLabel } from "./buckets";
import { findMaterial, type Material } from "./materials";
import { computeBoq } from "./boq";
import { buildGuidelines } from "./guidelines";
import type { ProposalPayload, ScheduleItem } from "./proposal";
import { globalPrompt, surfacePrompt } from "./prompting";
import { getBlob, putBlob, uid } from "./db";
import { masks } from "./masks";
import { comfy, CancelledError } from "./comfy-client";
import { bitmapFromBlob, canvas, ctx2d, fitWithin, maskFromBwBlob, maskToBwBlob, newMask, resizeBlob, squareCropBlob, toBlob, unionInto } from "./image";
import { applyDefaults, validatePrompt } from "./workflow/graph";
import { buildSegmentationGraph } from "./workflow/segment";
import { buildGenerationGraph, type SurfaceInput } from "./workflow/generate";
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

    const union = newMask(masks.width, masks.height);
    const surfaces: SurfaceInput[] = [];
    const descriptions: string[] = [];
    const refSize = s.profile === "studio" ? 768 : 512;
    for (const b of surfacesToRender) {
      updateJob({ stage: `Uploading ${b}` });
      const bucket = p.buckets[b];
      const eff = masks.effective(b);
      unionInto(union, eff);
      const mask = await comfy().upload(await maskToBwBlob(eff, work.width, work.height), `${p.id}_mask_${b}.png`);
      const refs: string[] = [];
      for (const r of bucket.refs) {
        const bmp = await bitmapFromBlob((await getBlob(r.blobId))!);
        refs.push(await comfy().upload(await squareCropBlob(bmp, refSize), `${p.id}_ref_${r.id}.png`));
        bmp.close();
      }
      const material = findMaterial(bucket.materialId, state.library);
      const prompt = surfacePrompt(b, material, bucket.refs[0]?.analysis, bucket.note);
      if (material) descriptions.push(`${material.prompt.split(",")[0]} ${b === "walls" ? "walls" : b}`);
      surfaces.push({ bucket: b, mask, refs, weight: bucket.weight, prompt });
    }
    const unionHard = await comfy().upload(await maskToBwBlob(union, work.width, work.height, { grow: s.maskGrow + s.maskFeather }), `${p.id}_union_hard.png`);
    const unionSoft = await comfy().upload(await maskToBwBlob(union, work.width, work.height, { grow: s.maskGrow, feather: s.maskFeather }), `${p.id}_union_soft.png`);

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
  const p = get().project;
  if (!p?.base || get().job) return;
  const render = p.renders.find((r) => r.id === p.activeRenderId) ?? p.renders[0];
  if (!render) {
    toast("Generate a render first; the proposal is built around it.", "error");
    return;
  }
  const controller = startJob("proposal", "Preparing images");
  try {
    const heroBlob = (await getBlob(render.finalBlobId ?? render.previewBlobId))!;
    const previewBlob = (await getBlob(render.previewBlobId))!;
    const [hero, before, after] = await Promise.all([
      jpegDataUrl(heroBlob, paper === "A3" ? 4096 : 3200, 0.9),
      jpegDataUrl((await getBlob(p.base.editBlobId))!, 1800, 0.88),
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
