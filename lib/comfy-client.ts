"use client";

import type { ApiPrompt } from "./workflow/graph";

export interface OutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

export interface RunCallbacks {
  onStage?: (label: string) => void;
  onProgress?: (value: number, max: number) => void;
  onPreview?: (dataUrl: string) => void;
  onQueued?: (promptId: string) => void;
}

type ComfyMessage = { type: string; data: Record<string, unknown> };

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
  }
}

export class ComfyCrashedError extends Error {
  constructor() {
    super(
      "ComfyUI stopped during the job. It most likely ran out of memory: close heavy apps, convert CLIP Vision to fp16 in Model Manager, restart ComfyUI, then try again.",
    );
  }
}

class ComfyClient {
  readonly clientId = "strata-" + Math.random().toString(36).slice(2, 12);
  private source: EventSource | null = null;
  private listeners = new Set<(e: { kind: "comfy" | "preview"; payload: Record<string, unknown> }) => void>();

  private connect() {
    if (this.source && this.source.readyState !== EventSource.CLOSED) return;
    const es = new EventSource(`/api/events?clientId=${this.clientId}`);
    es.addEventListener("comfy", (e) => {
      const msg = JSON.parse((e as MessageEvent).data) as ComfyMessage;
      this.listeners.forEach((l) => l({ kind: "comfy", payload: msg as unknown as Record<string, unknown> }));
    });
    es.addEventListener("preview", (e) => {
      const msg = JSON.parse((e as MessageEvent).data);
      this.listeners.forEach((l) => l({ kind: "preview", payload: msg }));
    });
    this.source = es;
  }

  async upload(blob: Blob, filename: string): Promise<string> {
    const form = new FormData();
    form.append("image", new File([blob], filename, { type: blob.type || "image/png" }));
    form.append("subfolder", "strata");
    form.append("type", "input");
    form.append("overwrite", "true");
    const res = await fetch("/api/comfy/upload/image", { method: "POST", body: form });
    if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
    const j = (await res.json()) as { name: string; subfolder: string };
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  }

  private async queue(prompt: ApiPrompt): Promise<string> {
    const res = await fetch("/api/comfy/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, client_id: this.clientId, extra_data: { preview_method: "auto" } }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(describePromptError(j, prompt));
    return j.prompt_id as string;
  }

  /** Queues a prompt and resolves with its outputs once ComfyUI finishes it. */
  async run(prompt: ApiPrompt, stages: Record<string, string>, cb: RunCallbacks = {}, signal?: AbortSignal): Promise<Record<string, { images?: OutputImage[] }>> {
    this.connect();
    const promptId = await this.queue(prompt);
    cb.onQueued?.(promptId);

    return new Promise((resolve, reject) => {
      let finished = false;
      let poll: ReturnType<typeof setInterval> | null = null;
      const cleanup = () => {
        finished = true;
        this.listeners.delete(listener);
        if (poll) clearInterval(poll);
        signal?.removeEventListener("abort", onAbort);
      };
      const complete = async () => {
        if (finished) return;
        cleanup();
        try {
          // ComfyUI announces completion (executing:null / execution_success) from its executor
          // *before* its queue worker writes the history entry. Reading history once at that moment
          // returned nothing on slow machines and the finished render was dropped, so wait for it.
          const deadline = Date.now() + 120_000;
          for (;;) {
            const res = await fetch(`/api/comfy/history/${promptId}`);
            const entry = res.ok ? (await res.json())[promptId] : undefined;
            if (entry?.status?.status_str === "error") return reject(new Error(historyError(entry)));
            if (entry?.status?.completed) return resolve(entry.outputs ?? {});
            if (Date.now() > deadline) return reject(new Error("ComfyUI reported the job finished, but its result never appeared. Check ComfyUI's output folder."));
            await new Promise((r) => setTimeout(r, 1000));
          }
        } catch (e) {
          reject(e);
        }
      };
      const fail = (err: Error) => {
        if (finished) return;
        cleanup();
        reject(err);
      };
      const onAbort = () => {
        fetch("/api/comfy/interrupt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt_id: promptId }) }).catch(() => {});
        fetch("/api/comfy/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: [promptId] }) }).catch(() => {});
        fail(new CancelledError());
      };
      signal?.addEventListener("abort", onAbort);

      const listener = (e: { kind: "comfy" | "preview"; payload: Record<string, unknown> }) => {
        if (e.kind === "preview") {
          if (!e.payload.promptId || e.payload.promptId === promptId) cb.onPreview?.(e.payload.image as string);
          return;
        }
        const { type, data } = e.payload as unknown as ComfyMessage;
        if (data?.prompt_id && data.prompt_id !== promptId) return;
        switch (type) {
          case "executing":
            if (data.node == null) void complete();
            else if (stages[data.node as string]) cb.onStage?.(stages[data.node as string]);
            break;
          case "progress":
            cb.onProgress?.(data.value as number, data.max as number);
            break;
          case "execution_success":
            void complete();
            break;
          case "execution_error":
            fail(new Error(`${data.node_type ?? "Node"} failed: ${data.exception_message ?? "unknown error"}`));
            break;
          case "execution_interrupted":
            fail(new CancelledError());
            break;
        }
      };
      this.listeners.add(listener);

      // Safety net if the event stream drops mid-run. A prompt that is in neither the history nor
      // the queue was lost (ComfyUI restarted); fail instead of waiting forever.
      let missing = 0;
      let refused = 0;
      let inFlight = false;
      poll = setInterval(async () => {
        // A swapping machine can take a minute to answer; never stack polls behind a slow one.
        if (inFlight || finished) return;
        inFlight = true;
        try {
          const res = await fetch(`/api/comfy/history/${promptId}`);
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            // Only "connection refused" means ComfyUI is gone; timeouts mean it is busy (often paging).
            if (body.code === "ECONNREFUSED" && ++refused >= 3) fail(new ComfyCrashedError());
            return;
          }
          const h = await res.json();
          refused = 0;
          if (h[promptId]?.status?.completed || h[promptId]?.status?.status_str === "error") return void complete();
          if (h[promptId]) return;
          const q = (await (await fetch("/api/comfy/queue")).json()) as { queue_running: unknown[][]; queue_pending: unknown[][] };
          const queued = [...q.queue_running, ...q.queue_pending].some((item) => item[1] === promptId);
          missing = queued ? 0 : missing + 1;
          if (missing >= 2) fail(new Error("ComfyUI lost this job (it may have restarted). Please run it again."));
        } catch {
          // Strata's own server unreachable; keep waiting
        } finally {
          inFlight = false;
        }
      }, 4000);
    });
  }

  async fetchImage(o: OutputImage): Promise<Blob> {
    const q = new URLSearchParams({ filename: o.filename, subfolder: o.subfolder, type: o.type });
    const res = await fetch(`/api/comfy/view?${q}`);
    if (!res.ok) throw new Error(`Could not fetch ${o.filename} (${res.status})`);
    return res.blob();
  }
}

function describePromptError(j: Record<string, unknown>, prompt: ApiPrompt): string {
  const err = j.error as { message?: string; details?: string } | undefined;
  const nodeErrors = j.node_errors as Record<string, { class_type: string; errors: { message: string; details: string }[] }> | undefined;
  const parts: string[] = [];
  if (nodeErrors) {
    for (const [id, ne] of Object.entries(nodeErrors)) {
      const title = prompt[id]?._meta?.title ?? ne.class_type;
      for (const e of ne.errors) parts.push(`${title}: ${e.message}${e.details ? ` (${e.details})` : ""}`);
    }
  }
  if (!parts.length) parts.push(err?.message ?? (j.offline ? "ComfyUI is offline." : "ComfyUI rejected the workflow."));
  return parts.slice(0, 4).join(" · ");
}

function historyError(entry: { status?: { messages?: [string, Record<string, unknown>][] } }): string {
  const msg = entry.status?.messages?.find(([t]) => t === "execution_error")?.[1];
  return msg ? `${msg.node_type} failed: ${msg.exception_message}` : "ComfyUI reported an error.";
}

let client: ComfyClient | null = null;
export function comfy(): ComfyClient {
  client ??= new ComfyClient();
  return client;
}
