"use client";

import { useEffect, useState } from "react";
import { Check, Download, Loader2, X, GitBranch, AlertTriangle } from "lucide-react";
import { refreshDoctor, toast, useStore } from "@/lib/store";
import { formatBytes, type CatalogModel, type CustomNodePack } from "@/lib/models-catalog";
import type { PipelineProfile } from "@/lib/types";
import { Button, cx } from "./ui";

interface JobView {
  status: "running" | "done" | "error" | "cancelled";
  received: number;
  total: number;
  speed: number;
  error?: string;
  log: string[];
}
type ModelRow = CatalogModel & { installed: boolean; job: JobView | null; partial: number };
type NodeRow = CustomNodePack & { job: JobView | null };

export function ModelManager() {
  const doctor = useStore((s) => s.doctor);
  const currentProfile = useStore((s) => s.project?.settings.profile ?? s.doctor?.recommendedProfile ?? "lite");
  const [profile, setProfile] = useState<PipelineProfile>(currentProfile);
  const [data, setData] = useState<{ comfyPath: string; models: ModelRow[]; nodes: NodeRow[] } | null>(null);

  useEffect(() => {
    let alive = true;
    let wasRunning = false;
    const load = async () => {
      const res = await fetch("/api/models", { cache: "no-store" });
      const json = await res.json();
      if (!alive) return;
      setData(json);
      const running = [...json.models, ...json.nodes].some((x: ModelRow | NodeRow) => x.job?.status === "running");
      // A finished download changes ComfyUI's model lists.
      if (wasRunning && !running) void refreshDoctor(true);
      wasRunning = running;
    };
    void load();
    const id = setInterval(load, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const start = async (body: { model?: string; node?: string }) => {
    const res = await fetch("/api/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) toast((await res.json()).error ?? "Could not start", "error");
  };
  const cancel = (id: string) => fetch(`/api/models?id=${encodeURIComponent(id)}`, { method: "DELETE" });

  if (!data) return <div className="flex items-center gap-2 py-8 text-mute"><Loader2 size={16} className="animate-spin" /> Loading catalogue…</div>;

  const models = data.models.filter((m) => m.profiles.includes(profile));
  const missingBytes = models.filter((m) => !m.installed && m.required).reduce((s, m) => s + m.bytes, 0);
  const nodes = data.nodes.filter((n) => n.profiles.includes(profile));

  return (
    <div className="space-y-5">
      {!data.comfyPath && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
          <AlertTriangle size={16} className="mt-px shrink-0" />
          <span>ComfyUI folder not found. Set it in <button className="font-medium underline" onClick={() => useStore.setState({ modal: "settings" })}>Settings</button> so downloads land in the right place.</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex rounded-lg bg-paper p-0.5">
          {(["lite", "studio"] as const).map((p) => (
            <button key={p} onClick={() => setProfile(p)} className={cx("h-7 rounded-md px-3 text-xs font-medium", profile === p ? "bg-white shadow-sm" : "text-mute hover:text-ink")}>
              {p === "lite" ? "Lite (CPU)" : "Studio (GPU)"}
              {doctor?.recommendedProfile === p && <span className="ml-1.5 text-ok">●</span>}
            </button>
          ))}
        </div>
        <span className="text-xs text-mute">{missingBytes ? `${formatBytes(missingBytes)} of required models to download` : "All required models installed"}</span>
      </div>
      {profile === "studio" && doctor?.device?.type !== "cuda" && (
        <p className="rounded-lg bg-paper p-3 text-xs leading-relaxed text-mute">
          This machine runs ComfyUI on <b>{doctor?.device?.type === "cpu" || !doctor?.device ? "CPU" : doctor.device.type}</b>. The Studio stack (SDXL, 2× ControlNet, IP-Adapter, tiled 4K) needs an NVIDIA GPU with ≥12 GB VRAM; on CPU a single render would take hours. Download these only for a GPU machine sharing this ComfyUI folder.
        </p>
      )}

      <div className="divide-y divide-line rounded-lg border border-line">
        {models.map((m) => (
          <div key={m.id} className="flex items-start gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium">{m.name}</span>
                {m.required ? <span className="rounded bg-paper px-1.5 text-[10px] text-mute">required</span> : <span className="rounded px-1.5 text-[10px] text-faint ring-1 ring-line">optional</span>}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-faint">models/{m.dir}/{m.filename} · {formatBytes(m.bytes)}</div>
              {m.note && <div className="mt-1 text-xs leading-snug text-mute">{m.note}</div>}
              {m.job?.status === "running" && <Progress job={m.job} />}
              {m.job?.status === "error" && <div className="mt-1 text-xs text-danger">{m.job.error}</div>}
              {m.job?.status !== "running" && m.partial > 0 && (
                <div className="mt-1 text-xs text-mute">Paused at {formatBytes(m.partial)} of {formatBytes(m.bytes)} ({Math.round((m.partial / m.bytes) * 100)}%). Resume continues from there.</div>
              )}
            </div>
            <div className="shrink-0 pt-0.5">
              {m.installed ? (
                <span className="flex items-center gap-1 text-xs font-medium text-ok"><Check size={14} /> Installed</span>
              ) : m.job?.status === "running" ? (
                <Button size="sm" onClick={() => void cancel(m.id)}><X size={12} /> Cancel</Button>
              ) : (
                <Button size="sm" variant={m.required ? "primary" : "secondary"} disabled={!data.comfyPath} onClick={() => void start({ model: m.id })}>
                  <Download size={12} /> {m.partial > 0 || m.job?.status === "error" || m.job?.status === "cancelled" ? "Resume" : "Download"}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute">Custom nodes</h3>
        <div className="divide-y divide-line rounded-lg border border-line">
          {nodes.map((n) => {
            const loaded = !!doctor?.objectInfo?.[n.probeClass];
            return (
              <div key={n.id} className="flex items-start gap-3 p-3">
                <GitBranch size={15} className="mt-0.5 shrink-0 text-mute" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{n.name}</div>
                  <div className="text-xs text-mute">{n.note}</div>
                  {n.job && n.job.log.length > 0 && (
                    <pre className="mt-2 max-h-28 overflow-auto rounded bg-paper p-2 text-[10px] leading-relaxed text-mute">{n.job.log.join("\n")}</pre>
                  )}
                  {n.job?.status === "error" && <div className="mt-1 text-xs text-danger">{n.job.error}</div>}
                </div>
                <div className="shrink-0">
                  {loaded ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-ok"><Check size={14} /> Loaded</span>
                  ) : n.job?.status === "running" ? (
                    <span className="flex items-center gap-1 text-xs text-mute"><Loader2 size={13} className="animate-spin" /> Installing</span>
                  ) : n.job?.status === "done" ? (
                    <span className="text-xs text-amber-700">Restart ComfyUI</span>
                  ) : (
                    <Button size="sm" disabled={!data.comfyPath} onClick={() => void start({ node: n.id })}>Install</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-faint">SAM3, Depth Anything 3 and Canny are built into ComfyUI 0.42+, so no extra node packs are needed for them.</p>
      </div>
    </div>
  );
}

function Progress({ job }: { job: JobView }) {
  const pct = job.total ? (job.received / job.total) * 100 : 0;
  const eta = job.speed > 0 ? (job.total - job.received) / job.speed : 0;
  return (
    <div className="mt-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-paper">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-mute">
        <span>{formatBytes(job.received)} / {formatBytes(job.total)} · {pct.toFixed(0)}%</span>
        <span className="truncate pl-3">{job.speed ? `${formatBytes(job.speed)}/s${eta ? ` · ${Math.ceil(eta / 60)} min left` : ""}` : (job.log.at(-1) ?? "starting…")}</span>
      </div>
    </div>
  );
}
