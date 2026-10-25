// Profiles Strata's generation graph against a live ComfyUI, node by node.
// Builds the graph with the app's own builder, so timings match what Generate runs.
//
//   npx tsx scripts/profile-generate.mts --project p_108810238cc04e3f --surfaces floor [--set key=value ...] [--no-free]
//
// --project   prefix of files the app already uploaded to ComfyUI/input/strata
// --surfaces  comma-separated buckets that have uploaded masks/refs
// --set       override a GenSettings field, e.g. --set cfg=1 --set upscale=false --set workLongSide=640
// --no-free   keep ComfyUI's model cache (by default it is evicted first, as the app does on CPU)
// --crop      diffuse only the edited region, planned from the uploaded union mask like the app does
// --no-refs   skip reference images (no IP-Adapter / CLIP Vision), text-only materials
import fs from "node:fs";
import path from "node:path";
import { applyDefaults, validatePrompt, type ObjectInfo } from "../lib/workflow/graph.ts";
import { buildGenerationGraph, type SurfaceInput } from "../lib/workflow/generate.ts";
import { defaultSettings, fitDims, resolveModels } from "../lib/workflow/profiles.ts";
import { planCrop, type Rect } from "../lib/workflow/crop.ts";
import sharp from "sharp";
import type { BucketId, GenSettings } from "../lib/types.ts";

const COMFY = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";
const INPUT_DIR = path.join(process.env.COMFYUI_PATH ?? "D:/PROJECTS/ComfyUI", "input", "strata");

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const project = arg("project") ?? "p_108810238cc04e3f";
const surfacesArg = (arg("surfaces") ?? "floor").split(",") as BucketId[];

const settings: GenSettings = defaultSettings("lite");
args.forEach((a, i) => {
  if (a !== "--set") return;
  const [k, v] = args[i + 1].split("=");
  const cur = (settings as unknown as Record<string, unknown>)[k];
  (settings as unknown as Record<string, unknown>)[k] = typeof cur === "number" ? Number(v) : typeof cur === "boolean" ? v === "true" : v;
});

const info = (await (await fetch(`${COMFY}/object_info`)).json()) as ObjectInfo;
const models = resolveModels("lite", settings, info);

const refsFor = (b: BucketId) => args.includes("--no-refs") ? [] : fs.readdirSync(INPUT_DIR).filter((f) => f.startsWith(`${project}_ref_`)).map((f) => `strata/${f}`).slice(0, b === surfacesArg[0] ? 4 : 0);
const surfaces: SurfaceInput[] = surfacesArg.map((b) => ({ bucket: b, mask: `strata/${project}_mask_${b}.png`, refs: refsFor(b), weight: 0.85, prompt: `${b}: polished white marble` }));

// Read the base image size from the PNG header (IHDR) to size the graph like the app does.
const png = fs.readFileSync(path.join(INPUT_DIR, `${project}_base.png`));
const work = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
const final = fitDims(work.width, work.height, settings.targetLongSide);

async function unionBBox(): Promise<Rect | null> {
  const { data, info: meta } = await sharp(path.join(INPUT_DIR, `${project}_union_hard.png`)).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  let x0 = meta.width, y0 = meta.height, x1 = -1, y1 = -1;
  for (let y = 0; y < meta.height; y++)
    for (let x = 0; x < meta.width; x++)
      if (data[y * meta.width + x] > 127) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
const crop = args.includes("--crop") ? planCrop(await unionBBox(), work.width, work.height) : null;

const graph = buildGenerationGraph({
  settings,
  models,
  baseImage: `strata/${project}_base.png`,
  unionHard: `strata/${project}_union_hard.png`,
  unionSoft: `strata/${project}_union_soft.png`,
  width: work.width,
  height: work.height,
  finalWidth: final.width,
  finalHeight: final.height,
  surfaces,
  globalPrompt: "professional architectural interior photograph",
  seed: Number(arg("seed") ?? 42),
  prefix: `strata/profile_${Date.now()}`,
  crop,
});
applyDefaults(graph.prompt, info);
const problems = validatePrompt(graph.prompt, info);
if (problems.length) throw new Error(problems.join("\n"));

if (!args.includes("--no-free")) {
  await fetch(`${COMFY}/free`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
}

const clientId = "profile-" + Date.now();
const ws = new WebSocket(`${COMFY.replace(/^http/, "ws")}/ws?clientId=${clientId}`);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

const timings: { node: string; label: string; ms: number }[] = [];
let current: { node: string; at: number } | null = null;
const t0 = Date.now();
const label = (id: string) => `${graph.prompt[id]?.class_type}${graph.prompt[id]?._meta?.title ? ` (${graph.prompt[id]._meta!.title})` : ""}`;

const res = await fetch(`${COMFY}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph.prompt, client_id: clientId }) });
const { prompt_id } = (await res.json()) as { prompt_id: string };
console.log(`queued ${prompt_id} · ${work.width}×${work.height} · steps ${settings.steps} cfg ${settings.cfg} · depth ${settings.useDepth} · upscale ${settings.upscale} · crop ${crop ? `${crop.width}×${crop.height}@${crop.x},${crop.y}` : "none"} · ${Object.keys(graph.prompt).length} nodes`);

await new Promise<void>((resolve, reject) => {
  ws.addEventListener("message", (ev) => {
    if (typeof ev.data !== "string") return;
    const { type, data } = JSON.parse(ev.data);
    if (data?.prompt_id && data.prompt_id !== prompt_id) return;
    const now = Date.now();
    if (type === "executing" || type === "execution_success") {
      if (current) timings.push({ node: current.node, label: label(current.node), ms: now - current.at });
      current = type === "executing" && data.node ? { node: data.node, at: now } : null;
      if (type === "execution_success" || (type === "executing" && data.node == null)) resolve();
    } else if (type === "execution_cached") {
      console.log(`cached: ${data.nodes.length} nodes`);
    } else if (type === "execution_error") {
      reject(new Error(`${data.node_type}: ${data.exception_message}`));
    }
  });
  // If ComfyUI dies mid-run the socket closes; report it instead of waiting forever.
  ws.addEventListener("close", () => reject(new Error(`ComfyUI connection closed during ${current ? label(current.node) : "the run"} (crashed or restarted)`)));
});
ws.close();

const total = Date.now() - t0;
timings.sort((a, b) => b.ms - a.ms);
console.log(`\ntotal ${(total / 1000).toFixed(1)} s`);
for (const t of timings.filter((t) => t.ms >= 200)) {
  console.log(`${(t.ms / 1000).toFixed(1).padStart(7)} s  ${((t.ms / total) * 100).toFixed(0).padStart(3)}%  #${t.node} ${t.label}`);
}
