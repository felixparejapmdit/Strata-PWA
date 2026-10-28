"use client";

import { create } from "zustand";
import type { BucketId, BucketState, LayerId, PipelineProfile, Project, ProjectSummary, ReferenceImage, ZoneType } from "./types";
import { BUCKETS, LAYERS } from "./buckets";
import { MATERIALS, suggestMaterial, type Material } from "./materials";
import * as db from "./db";
import { liveCoverage, masks } from "./masks";
import { analyzeTexture } from "./texture";
import { bitmapFromBlob, fitWithin, pixelsOf, resizeBlob } from "./image";
import { checkpointsForProfile, defaultSettings, migrateSettings, PROFILES } from "./workflow/profiles";
import type { ObjectInfo } from "./workflow/graph";

export interface DoctorInfo {
  online: boolean;
  comfyUrl: string;
  comfyPath: string;
  version?: string;
  device?: { name: string; type: string; vramTotal: number; vramFree: number } | null;
  ramTotal?: number;
  ramFree?: number;
  recommendedProfile?: PipelineProfile;
  /** Changes whenever objectInfo does; lets polls skip re-sending the schemas. */
  infoKey?: string;
  /** ComfyUI's launch arguments, e.g. ["main.py", "--cpu"]. */
  argv?: string[];
  objectInfo?: ObjectInfo;
  error?: string;
}

export type Tool = "pan" | "brush" | "erase" | "wand";
export type View = "edit" | "compare" | "result";
export type Modal = null | "models" | "library" | "settings" | "proposal";
export type InspectorTab = "materials" | "render" | "project";

export interface Toast {
  id: string;
  kind: "info" | "success" | "error";
  text: string;
  action?: { label: string; run: () => void };
}

export interface JobState {
  kind: "segment" | "generate" | "upscale" | "proposal";
  stage: string;
  value: number;
  max: number;
  preview: string | null;
  startedAt: number;
  controller: AbortController;
}

interface State {
  ready: boolean;
  projects: ProjectSummary[];
  project: Project | null;
  library: Material[];
  doctor: DoctorInfo | null;
  tool: Tool;
  layer: LayerId;
  brushSize: number;
  wandTolerance: number;
  view: View;
  showMasks: boolean;
  hiddenLayers: LayerId[];
  inspectorTab: InspectorTab;
  modal: Modal;
  job: JobState | null;
  toasts: Toast[];
  maskVersion: number;
  fitSignal: number;
  dragging: boolean;
}

export const EDIT_LONG_SIDE = 1536;

export const useStore = create<State>()(() => ({
  ready: false,
  projects: [],
  project: null,
  library: MATERIALS,
  doctor: null,
  tool: "brush",
  layer: "floor",
  brushSize: 40,
  wandTolerance: 16,
  view: "edit",
  showMasks: true,
  hiddenLayers: [],
  inspectorTab: "materials",
  modal: null,
  job: null,
  toasts: [],
  maskVersion: 0,
  fitSignal: 0,
  dragging: false,
}));

const set = useStore.setState;
const get = useStore.getState;

// ---------- toasts ----------

export function toast(text: string, kind: Toast["kind"] = "info", action?: Toast["action"]) {
  const id = db.uid("t_");
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text, action }] }));
  setTimeout(() => dismissToast(id), kind === "error" ? 9000 : 4500);
}

export function dismissToast(id: string) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

// ---------- persistence ----------

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}

export async function flushSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const p = get().project;
  if (!p) return;
  await db.saveProject(p);
  set({ projects: await db.listProjects() });
}

/** Immutable update of the open project; persisted on a short debounce. */
export function patchProject(fn: (draft: Project) => void) {
  const p = get().project;
  if (!p) return;
  const next = structuredClone(p);
  fn(next);
  next.updatedAt = Date.now();
  set({ project: next });
  scheduleSave();
}

// ---------- lifecycle ----------

let doctorTimer: ReturnType<typeof setInterval> | null = null;

export async function init() {
  if (get().ready) return;
  const [projects, custom] = await Promise.all([db.listProjects(), db.listCustomMaterials()]);
  set({ projects, library: mergeLibrary(custom) });
  await refreshDoctor();
  const last = await db.kvGet<string>("lastProject");
  if (last && projects.some((p) => p.id === last)) await openProject(last);
  else if (projects[0]) await openProject(projects[0].id);
  set({ ready: true });
  doctorTimer ??= setInterval(() => void refreshDoctor(), 8000);
}

export async function refreshDoctor(force = false) {
  try {
    const prev = get().doctor;
    const q = new URLSearchParams();
    if (force) q.set("refresh", "1");
    else if (prev?.online && prev.infoKey && prev.objectInfo) q.set("have", prev.infoKey);
    const res = await fetch(`/api/doctor?${q}`, { cache: "no-store" });
    const doctor = (await res.json()) as DoctorInfo;
    // Unchanged schemas are omitted from the response; keep the copy we already have.
    if (doctor.online && !doctor.objectInfo && prev?.infoKey === doctor.infoKey) doctor.objectInfo = prev?.objectInfo;
    set({ doctor });
    if (prev && prev.online !== doctor.online) toast(doctor.online ? "ComfyUI connected" : "ComfyUI went offline", doctor.online ? "success" : "error");
  } catch {
    set({ doctor: { online: false, comfyUrl: "", comfyPath: "", error: "Strata server unreachable" } });
  }
}

function blankProject(name: string, profile: PipelineProfile, checkpoint: string): Project {
  const bucket = (b: BucketId): BucketState => ({ enabled: b !== "furniture", refs: [], materialId: null, materialPinned: false, weight: b === "furniture" ? 0.7 : 0.85, note: "" });
  return {
    id: db.uid("p_"),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    meta: { client: "", location: "Metro Manila", preparedBy: "", zone: "living", floorArea: 24, ceilingHeight: 2.7, perimeter: 0, openingsPct: 15, furniturePieces: 3, contingencyPct: 10 },
    base: null,
    buckets: Object.fromEntries(BUCKETS.map((b) => [b, bucket(b)])) as Project["buckets"],
    masks: Object.fromEntries(LAYERS.map((l) => [l, { blobId: null, source: null, coverage: 0 }])) as Project["masks"],
    settings: defaultSettings(profile, checkpoint),
    renders: [],
    activeRenderId: null,
  };
}

/** Renders and detections write back into the open project, so it must not change mid-job. */
function blockedByJob(): boolean {
  if (!get().job) return false;
  toast("Finish or cancel the current job before switching projects.", "error");
  return true;
}

export async function newProject(name = "Untitled project") {
  if (blockedByJob()) return;
  await flushSave();
  const doctor = get().doctor;
  const profile = doctor?.recommendedProfile ?? "lite";
  const ckpt = checkpointsForProfile(profile, doctor?.objectInfo ?? null)[0] ?? PROFILES[profile].checkpoints[0];
  const p = blankProject(name, profile, ckpt);
  await db.saveProject(p);
  set({ projects: await db.listProjects() });
  await openProject(p.id);
}

export async function openProject(id: string) {
  if (get().project?.id !== id && blockedByJob()) return;
  await flushSave();
  const p = await db.loadProject(id);
  if (!p) return;
  const migrated = migrateSettings(p.settings);
  set({ project: p, view: p.activeRenderId ? "compare" : "edit", maskVersion: get().maskVersion + 1 });
  if (migrated.length) {
    scheduleSave();
    toast(`Render settings updated for faster CPU renders: ${migrated.join(", ")}.`, "info");
  }
  await db.kvSet("lastProject", id);
  await masks.load(p);
  set({ maskVersion: get().maskVersion + 1, fitSignal: get().fitSignal + 1 });
}

export async function deleteProject(id: string) {
  if (blockedByJob()) return;
  const isOpen = get().project?.id === id;
  if (isOpen) {
    if (saveTimer) clearTimeout(saveTimer);
    set({ project: null });
  }
  await db.deleteProject(id);
  const projects = await db.listProjects();
  set({ projects });
  if (isOpen && projects[0]) await openProject(projects[0].id);
}

// ---------- base image & references ----------

export async function setBaseImage(file: File) {
  if (blockedByJob()) return;
  if (!get().project) await newProject(file.name.replace(/\.[^.]+$/, ""));
  const p = get().project!;
  const bmp = await bitmapFromBlob(file);
  const { width, height } = bmp;
  const edit = fitWithin(width, height, EDIT_LONG_SIDE);
  const editBlob = await resizeBlob(bmp, edit.width, edit.height, "image/png");
  bmp.close();
  const [blobId, editBlobId] = await Promise.all([db.putBlob(file), db.putBlob(editBlob)]);
  const old = p.base;
  const oldMasks = Object.values(p.masks).map((m) => m.blobId);
  patchProject((d) => {
    d.base = { blobId, editBlobId, name: file.name, width, height, editWidth: edit.width, editHeight: edit.height };
    d.masks = Object.fromEntries(LAYERS.map((l) => [l, { blobId: null, source: null, coverage: 0 }])) as Project["masks"];
    d.activeRenderId = null;
    if (d.name === "Untitled project") d.name = file.name.replace(/\.[^.]+$/, "");
  });
  if (old) await db.deleteBlobs([old.blobId, old.editBlobId, ...oldMasks]);
  await masks.load(get().project!);
  set({ view: "edit", maskVersion: get().maskVersion + 1, fitSignal: get().fitSignal + 1 });
  await flushSave();
  const doctor = get().doctor;
  if (doctor?.online && doctor.objectInfo?.SAM3_Detect) {
    toast("Base image set. Detect surfaces automatically?", "info", { label: "Auto-detect", run: () => void import("./pipeline").then((m) => m.runSegmentation()) });
  }
}

export async function addReferences(bucket: BucketId, files: File[]) {
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (!images.length) return;
  const refs: ReferenceImage[] = [];
  // References saved before signatures existed fall back to their file name.
  const existing = new Set((get().project?.buckets[bucket].refs ?? []).map((r) => r.sig ?? `name:${r.name}`));
  let duplicates = 0;
  for (const f of images.slice(0, 4)) {
    // The same image twice would only skew the averaged IP-Adapter embedding.
    const sig = [...new Uint8Array(await crypto.subtle.digest("SHA-1", await f.arrayBuffer()))].map((x) => x.toString(16).padStart(2, "0")).join("");
    if (existing.has(sig) || existing.has(`name:${f.name}`)) {
      duplicates++;
      continue;
    }
    existing.add(sig);
    const bmp = await bitmapFromBlob(f);
    const dims = fitWithin(bmp.width, bmp.height, 1024);
    const stored = await resizeBlob(bmp, dims.width, dims.height, "image/jpeg", 0.92);
    const analysis = analyzeTexture(pixelsOf(bmp, 160));
    bmp.close();
    refs.push({ id: db.uid("r_"), blobId: await db.putBlob(stored), name: f.name, analysis, sig });
  }
  if (!refs.length) {
    toast(`That image is already a ${bucket} reference.`, "info");
    return;
  }
  patchProject((d) => {
    const b = d.buckets[bucket];
    b.refs = [...b.refs, ...refs].slice(-4);
    b.enabled = true;
    if (!b.materialPinned) b.materialId = suggestMaterial(bucket, d.meta.zone, b.refs[0]?.analysis, get().library).materialId;
  });
  const p = get().project!;
  const m = get().library.find((x) => x.id === p.buckets[bucket].materialId);
  toast(`${refs.length} reference${refs.length > 1 ? "s" : ""} added to ${bucket}${m ? ` → ${m.name}` : ""}${duplicates ? ` (${duplicates} duplicate skipped)` : ""}`, "success");
}

export async function removeReference(bucket: BucketId, refId: string) {
  const ref = get().project?.buckets[bucket].refs.find((r) => r.id === refId);
  patchProject((d) => {
    const b = d.buckets[bucket];
    b.refs = b.refs.filter((r) => r.id !== refId);
    if (!b.materialPinned) b.materialId = b.refs[0] ? suggestMaterial(bucket, d.meta.zone, b.refs[0].analysis, get().library).materialId : null;
  });
  if (ref) await db.deleteBlobs([ref.blobId]);
}

export function setMaterial(bucket: BucketId, materialId: string | null) {
  patchProject((d) => {
    d.buckets[bucket].materialId = materialId;
    d.buckets[bucket].materialPinned = materialId !== null;
  });
}

export function setZone(zone: ZoneType) {
  patchProject((d) => {
    d.meta.zone = zone;
    for (const b of BUCKETS) {
      const bucket = d.buckets[b];
      if (!bucket.materialPinned && (bucket.refs.length || bucket.materialId)) {
        bucket.materialId = suggestMaterial(b, zone, bucket.refs[0]?.analysis, get().library).materialId;
      }
    }
  });
}

export function setProfile(profile: PipelineProfile) {
  const doctor = get().doctor;
  const ckpt = checkpointsForProfile(profile, doctor?.objectInfo ?? null)[0] ?? "";
  patchProject((d) => {
    const keep = { seed: d.settings.seed, extraPrompt: d.settings.extraPrompt, negativePrompt: d.settings.negativePrompt };
    d.settings = { ...defaultSettings(profile, ckpt), ...keep };
  });
}

// ---------- masks ----------

let maskSaveTimer: ReturnType<typeof setTimeout> | null = null;
const dirtyLayers = new Set<LayerId>();
const editedLayers = new Set<LayerId>();

/** Marks layers as edited: re-renders overlays now, persists shortly after. */
export function masksChanged(layers: LayerId[], source: "auto" | "manual" = "manual", edited: LayerId[] = layers) {
  layers.forEach((l) => dirtyLayers.add(l));
  edited.forEach((l) => editedLayers.add(l));
  set({ maskVersion: get().maskVersion + 1 });
  // Show the new coverage (chips, Generate button) now; encoding PNGs can take seconds on slow machines.
  const cov = liveCoverage(layers);
  patchProject((d) => {
    for (const l of layers) d.masks[l] = { ...d.masks[l], coverage: cov[l] ?? 0, source: (cov[l] ?? 0) > 0 ? (d.masks[l].source ?? source) : null };
  });
  if (maskSaveTimer) clearTimeout(maskSaveTimer);
  maskSaveTimer = setTimeout(async () => {
    const p = get().project;
    if (!p) return;
    const layersToSave = [...dirtyLayers];
    const edits = [...editedLayers];
    editedLayers.clear();
    dirtyLayers.clear();
    const next = await masks.persist(layersToSave, p.masks, edits);
    patchProject((d) => {
      for (const l of layersToSave) d.masks[l] = { ...next[l], source: next[l].coverage > 0 ? source : null };
    });
  }, 500);
}

export function undoMask() {
  const layers = masks.popUndo();
  if (layers) masksChanged(layers);
}

// ---------- library ----------

/** Custom entries override built-ins with the same id; deleting an override restores the built-in. */
function mergeLibrary(custom: Material[]): Material[] {
  const ids = new Set(custom.map((c) => c.id));
  return [...MATERIALS.filter((m) => !ids.has(m.id)), ...custom];
}

export async function saveLibraryMaterial(m: Material) {
  await db.saveCustomMaterial({ ...m, custom: true });
  set({ library: mergeLibrary(await db.listCustomMaterials()) });
}

export async function deleteLibraryMaterial(id: string) {
  await db.deleteCustomMaterial(id);
  set({ library: mergeLibrary(await db.listCustomMaterials()) });
}
