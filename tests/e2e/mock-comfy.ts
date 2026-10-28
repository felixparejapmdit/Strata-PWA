import fs from "node:fs";
import path from "node:path";
import type { Page, Route } from "@playwright/test";

type ApiNode = { class_type: string; inputs: Record<string, unknown> };
type Graph = Record<string, ApiNode>;

export const FIXTURES = path.join(__dirname, "fixtures");
const OBJECT_INFO = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "object_info.json"), "utf8"));
const RENDER_PNG = fs.readFileSync(path.join(FIXTURES, "room.png"));

export interface MockOptions {
  online?: boolean;
  argv?: string[];
  ramFreeGb?: number;
  /** History reads that return nothing after a prompt is announced done (ComfyUI's real race). */
  historyLag?: number;
  /** Extra model files, keyed "Node.input" (the fixture only has what an early install had). */
  installed?: Record<string, string[]>;
}

/** A complete Lite install, as Model Manager leaves it (depth lock, IP-Adapter Plus, split UNet). */
export const FULL_LITE = {
  "ControlNetLoader.control_net_name": ["control_v11f1p_sd15_depth_fp16.safetensors"],
  "LoadDA3Model.model_name": ["depth_anything_3_small.safetensors"],
  "IPAdapterModelLoader.ipadapter_file": ["ip-adapter-plus_sd15.safetensors"],
  "UpscaleModelLoader.model_name": ["4x-UltraSharp.pth"],
  "UNETLoader.unet_name": ["Realistic_Vision_V5.1_unet.safetensors"],
  "CLIPLoader.clip_name": ["Realistic_Vision_V5.1_clip_l.safetensors"],
};

function withModels(extra: Record<string, string[]>) {
  const copy = structuredClone(OBJECT_INFO);
  for (const [key, files] of Object.entries(extra)) {
    const [cls, input] = key.split(".");
    const spec = copy[cls].input.required[input];
    if (Array.isArray(spec[0])) spec[0].push(...files);
    else spec[1].options.push(...files);
  }
  return copy;
}

/**
 * Stands in for ComfyUI behind Strata's own API routes (/api/doctor, /api/comfy/*, /api/events,
 * /api/embeds). Every submitted graph is recorded in `prompts` so tests can assert on what the
 * app actually sent; every job "completes" immediately with a real image.
 */
export async function mockComfy(page: Page, opts: MockOptions = {}) {
  const prompts: Graph[] = [];
  const promoted = new Set<string>();
  const frees: unknown[] = [];
  const lag = new Map<string, number>();
  const objectInfo = opts.installed ? withModels(opts.installed) : OBJECT_INFO;
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/doctor**", (route) =>
    opts.online === false
      ? json(route, { online: false, comfyUrl: "http://127.0.0.1:8188", comfyPath: "D:\\ComfyUI", error: "ECONNREFUSED" })
      : json(route, {
          online: true,
          comfyUrl: "http://127.0.0.1:8188",
          comfyPath: "D:\\ComfyUI",
          version: "0.42.0",
          device: { name: "cpu", type: "cpu", vramTotal: 8e9, vramFree: 4e9 },
          ramTotal: 8e9,
          ramFree: (opts.ramFreeGb ?? 4) * 1024 ** 3,
          argv: opts.argv ?? ["main.py", "--listen", "127.0.0.1", "--cpu"],
          recommendedProfile: "lite",
          infoKey: opts.installed ? "fixture-full" : "fixture",
          objectInfo,
        }),
  );
  // Like ComfyUI, announce "executing: null" (done) *before* the history entry exists; the
  // EventSource reconnects quickly (retry: 200) and re-reads the latest announcement.
  await page.route("**/api/events**", (route) => {
    const id = prompts.length ? `mock-${prompts.length}` : null;
    const done = id ? `event: comfy\ndata: ${JSON.stringify({ type: "executing", data: { node: null, prompt_id: id } })}\n\n` : "";
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: `retry: 200\n\n${done}` });
  });
  await page.route("**/api/embeds**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      const names = (new URL(req.url()).searchParams.get("check") ?? "").split(",").filter(Boolean);
      return json(route, { available: true, exists: Object.fromEntries(names.map((n) => [n, promoted.has(n.replace(/\.ipadpt$/, ""))])) });
    }
    const { promote = [] } = req.postDataJSON() as { promote?: string[] };
    promote.forEach((p) => promoted.add(p));
    return json(route, { ok: true, missing: [] });
  });
  await page.route("**/api/comfy/**", async (route) => {
    const req = route.request();
    const sub = new URL(req.url()).pathname.replace(/^\/api\/comfy\//, "");
    if (sub === "upload/image") {
      const name = /filename="([^"]+)"/.exec(req.postDataBuffer()?.toString("latin1") ?? "")?.[1] ?? "upload.png";
      return json(route, { name, subfolder: "strata", type: "input" });
    }
    if (sub === "prompt") {
      const { prompt } = req.postDataJSON() as { prompt: Graph };
      prompts.push(prompt);
      return json(route, { prompt_id: `mock-${prompts.length}`, number: prompts.length, node_errors: {} });
    }
    if (sub.startsWith("history/")) {
      const id = sub.slice("history/".length);
      const graph = prompts[Number(id.replace("mock-", "")) - 1];
      if (!graph) return json(route, {});
      const remaining = lag.get(id) ?? opts.historyLag ?? 2;
      if (remaining > 0) {
        lag.set(id, remaining - 1);
        return json(route, {});
      }
      const outputs: Record<string, unknown> = {};
      for (const [nodeId, node] of Object.entries(graph)) {
        if (node.class_type === "SaveImage") outputs[nodeId] = { images: [{ filename: `${node.inputs.filename_prefix}.png`.replace(/^strata\//, ""), subfolder: "strata", type: "output" }] };
      }
      return json(route, { [id]: { status: { completed: true, status_str: "success", messages: [] }, outputs } });
    }
    if (sub === "view") return route.fulfill({ status: 200, contentType: "image/png", body: RENDER_PNG });
    if (sub === "free") {
      frees.push(req.postDataJSON());
      return json(route, {});
    }
    if (sub === "queue") return json(route, { queue_running: [], queue_pending: [] });
    return json(route, {});
  });
  return { prompts, frees };
}

/** Node class types of the n-th submitted graph. */
export const classTypes = (g: Graph) => Object.values(g).map((n) => n.class_type);
