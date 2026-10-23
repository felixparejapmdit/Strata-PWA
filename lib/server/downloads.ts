import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import type { CatalogModel, CustomNodePack } from "../models-catalog";

export interface Job {
  id: string;
  kind: "model" | "node";
  status: "running" | "done" | "error" | "cancelled";
  received: number;
  total: number;
  /** Bytes per second, smoothed. */
  speed: number;
  error?: string;
  log: string[];
  startedAt: number;
  abort?: () => void;
}

// Survive dev-server hot reloads.
const g = globalThis as unknown as { __strataJobs?: Map<string, Job> };
const jobs = (g.__strataJobs ??= new Map());

export function getJob(id: string): Omit<Job, "abort"> | undefined {
  const j = jobs.get(id);
  if (!j) return undefined;
  const { abort: _abort, ...rest } = j;
  return { ...rest, log: rest.log.slice(-12) };
}

export function modelPath(comfyPath: string, m: CatalogModel) {
  return path.join(comfyPath, "models", m.dir, m.filename);
}

/** Bytes already on disk from an interrupted download (0 if none). */
export function partialBytes(comfyPath: string, m: CatalogModel): number {
  if (!comfyPath) return 0;
  try {
    return fs.statSync(modelPath(comfyPath, m) + ".part").size;
  } catch {
    return 0;
  }
}

export function isInstalled(comfyPath: string, m: CatalogModel): boolean {
  if (!comfyPath) return false;
  try {
    const st = fs.statSync(modelPath(comfyPath, m));
    return st.size > 0 && (!m.bytes || st.size === m.bytes);
  } catch {
    return false;
  }
}

const formatMb = (n: number) => `${(n / 1e6).toFixed(0)} MB`;
const MAX_PARALLEL = 2;
const MAX_ATTEMPTS = 6;
const queue: (() => void)[] = [];
let active = 0;

function schedule(task: () => Promise<void>) {
  const run = () => {
    active++;
    task().finally(() => {
      active--;
      queue.shift()?.();
    });
  };
  if (active < MAX_PARALLEL) run();
  else queue.push(run);
}

/** One HTTP attempt: appends to `part` from its current size. */
async function fetchInto(url: string, part: string, job: Job, signal: AbortSignal) {
  const resumeFrom = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const res = await fetch(url, { headers: resumeFrom ? { Range: `bytes=${resumeFrom}-` } : {}, signal, redirect: "follow" });
  if (res.status === 416) return; // already complete
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  const resumed = res.status === 206;
  job.received = resumed ? resumeFrom : 0;
  const len = Number(res.headers.get("content-length") || 0);
  if (len) job.total = job.received + len;

  const out = fs.createWriteStream(part, { flags: resumed ? "a" : "w" });
  let windowStart = Date.now();
  let windowBytes = 0;
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    job.received += chunk.length;
    windowBytes += chunk.length;
    const dt = Date.now() - windowStart;
    if (dt > 1000) {
      const now = (windowBytes / dt) * 1000;
      job.speed = job.speed ? job.speed * 0.6 + now * 0.4 : now;
      windowStart = Date.now();
      windowBytes = 0;
    }
  });
  await new Promise<void>((resolve, reject) => {
    body.pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
    body.on("error", (e) => {
      out.end();
      reject(e);
    });
  });
}

/**
 * Streams a catalogue model into ComfyUI/models/<dir>. Runs two downloads at a time and
 * retries dropped connections, resuming from the .part file each time.
 */
export function startModelDownload(comfyPath: string, m: CatalogModel): Job {
  const existing = jobs.get(m.id);
  if (existing?.status === "running") return existing;
  const dest = modelPath(comfyPath, m);
  const part = dest + ".part";
  const controller = new AbortController();
  const job: Job = { id: m.id, kind: "model", status: "running", received: 0, total: m.bytes, speed: 0, log: ["Queued"], startedAt: Date.now(), abort: () => controller.abort() };
  jobs.set(m.id, job);

  schedule(async () => {
    try {
      if (controller.signal.aborted) throw new Error("aborted");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      job.log.push("Downloading");
      // Give up only after MAX_ATTEMPTS consecutive drops that made no progress; a slow but
      // flaky link keeps resuming for as long as bytes keep arriving.
      for (let attempt = 1; ; attempt++) {
        const before = fs.existsSync(part) ? fs.statSync(part).size : 0;
        try {
          await fetchInto(m.url, part, job, controller.signal);
          break;
        } catch (e) {
          if (controller.signal.aborted) throw e;
          const after = fs.existsSync(part) ? fs.statSync(part).size : 0;
          if (after > before) attempt = 0;
          else if (attempt >= MAX_ATTEMPTS) throw e;
          job.speed = 0;
          job.log.push(`Connection dropped (${e instanceof Error ? e.message : e}); resuming from ${formatMb(after)}`);
          await new Promise((r) => setTimeout(r, 1500 * Math.max(1, attempt)));
        }
      }
      const size = fs.statSync(part).size;
      if (m.bytes && size !== m.bytes) throw new Error(`Size mismatch: got ${size}, expected ${m.bytes}. Retry to resume.`);
      fs.renameSync(part, dest);
      job.received = job.total = size;
      job.status = "done";
    } catch (e) {
      if (controller.signal.aborted) {
        job.status = "cancelled";
      } else {
        job.status = "error";
        job.error = e instanceof Error ? e.message : String(e);
      }
    }
  });
  return job;
}

export function cancelJob(id: string) {
  jobs.get(id)?.abort?.();
}

/** Python that runs this ComfyUI: portable, venv, or .venv. */
export function findComfyPython(comfyPath: string): string | null {
  const win = process.platform === "win32";
  const candidates = win
    ? [path.join(comfyPath, ".venv", "Scripts", "python.exe"), path.join(comfyPath, "venv", "Scripts", "python.exe"), path.join(comfyPath, "..", "python_embeded", "python.exe")]
    : [path.join(comfyPath, ".venv", "bin", "python"), path.join(comfyPath, "venv", "bin", "python")];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function run(job: Job, cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    job.log.push(`$ ${path.basename(cmd)} ${args.join(" ")}`);
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    job.abort = () => child.kill();
    const onData = (d: Buffer) => job.log.push(...d.toString().split(/\r?\n/).filter(Boolean).slice(-4));
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`))));
  });
}

/** git clone + pip install -r requirements.txt into this ComfyUI's own Python. */
export function startNodeInstall(comfyPath: string, pack: CustomNodePack): Job {
  const id = `node:${pack.id}`;
  const existing = jobs.get(id);
  if (existing?.status === "running") return existing;
  const job: Job = { id, kind: "node", status: "running", received: 0, total: 0, speed: 0, log: [], startedAt: Date.now() };
  jobs.set(id, job);
  const dir = path.join(comfyPath, "custom_nodes", pack.repo.split("/").pop()!);

  (async () => {
    if (!fs.existsSync(dir)) await run(job, "git", ["clone", "--depth", "1", "--recursive", pack.repo, dir], path.join(comfyPath, "custom_nodes"));
    else job.log.push("Already cloned; checking requirements.");
    const req = path.join(dir, "requirements.txt");
    if (fs.existsSync(req)) {
      const py = findComfyPython(comfyPath);
      if (!py) throw new Error("Could not find ComfyUI's Python to install requirements; run pip manually.");
      await run(job, py, ["-m", "pip", "install", "-r", req], dir);
    }
    job.log.push("Installed. Restart ComfyUI to load the new nodes.");
    job.status = "done";
  })().catch((e: unknown) => {
    job.status = "error";
    job.error = e instanceof Error ? e.message : String(e);
  });
  return job;
}
