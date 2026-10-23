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
          const h = await (await fetch(`/api/comfy/history/${promptId}`)).json();
          const entry = h[promptId];
          if (entry?.status?.status_str === "error") reject(new Error(historyError(entry)));
          else resolve(entry?.outputs ?? {});
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

      // Safety net if the event stream drops mid-run.
      poll = setInterval(async () => {
        try {
          const h = await (await fetch(`/api/comfy/history/${promptId}`)).json();
          if (h[promptId]?.status?.completed || h[promptId]?.status?.status_str === "error") void complete();
        } catch {
          // ComfyUI briefly unreachable; keep waiting
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
