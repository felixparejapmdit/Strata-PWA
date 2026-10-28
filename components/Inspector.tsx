"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Plus, X, Sparkles, Pin, Paintbrush, ShieldCheck, Square, FileText } from "lucide-react";
import { addReferences, patchProject, removeReference, setMaterial, useStore } from "@/lib/store";
import { BUCKETS, LAYER_INFO } from "@/lib/buckets";
import { suggestMaterial } from "@/lib/materials";
import { activeSurfaces, cancelJob, formatDuration, generate } from "@/lib/pipeline";
import type { BucketId } from "@/lib/types";
import { RenderPanel } from "./RenderPanel";
import { ProjectPanel } from "./ProjectPanel";
import { BlobImg, Button, cx, Select, Slider, Toggle, useDropTarget } from "./ui";

export function Inspector() {
  const project = useStore((s) => s.project);
  const tab = useStore((s) => s.inspectorTab);
  const tabs = [
    { id: "materials", label: "Materials" },
    { id: "render", label: "Render" },
    { id: "project", label: "Project" },
  ] as const;

  return (
    <aside className="absolute bottom-3 right-3 top-3 z-30 flex w-[344px] flex-col overflow-hidden rounded-xl border border-line bg-white shadow-float" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => useStore.setState({ inspectorTab: t.id })}
            className={cx("h-7 rounded-md px-2.5 text-[13px] font-medium transition", tab === t.id ? "bg-hover text-ink" : "text-mute hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
        {project && (
          <button
            onClick={() => useStore.setState({ modal: "proposal" })}
            className="ml-auto flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-mute hover:bg-hover hover:text-ink"
            title="Specification proposal (PDF)"
          >
            <FileText size={14} /> Proposal
          </button>
        )}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {!project ? (
          <p className="p-4 text-[13px] text-mute">Create a project or drop a base image on the canvas to begin.</p>
        ) : tab === "materials" ? (
          <MaterialsPanel />
        ) : tab === "render" ? (
          <RenderPanel />
        ) : (
          <ProjectPanel />
        )}
      </div>
      {project && <GenerateFooter />}
    </aside>
  );
}

function MaterialsPanel() {
  return (
    <div className="space-y-2.5 p-3">
      <p className="px-1 text-xs leading-relaxed text-mute">
        Drop reference photos into a surface. Strata reads the texture, picks a tropical-rated Philippine material, and applies it only inside that surface&apos;s mask.
      </p>
      {BUCKETS.map((b) => (
        <BucketCard key={b} bucket={b} />
      ))}
      <ProtectedCard />
    </div>
  );
}

function BucketCard({ bucket }: { bucket: BucketId }) {
  const state = useStore((s) => s.project!.buckets[bucket]);
  const mask = useStore((s) => s.project!.masks[bucket]);
  const zone = useStore((s) => s.project!.meta.zone);
  const library = useStore((s) => s.library);
  const activeLayer = useStore((s) => s.layer);
  const hidden = useStore((s) => s.hiddenLayers.includes(bucket));
  const inputRef = useRef<HTMLInputElement>(null);
  const info = LAYER_INFO[bucket];
  const drop = useDropTarget((files) => void addReferences(bucket, files));

  const suggestion = useMemo(() => suggestMaterial(bucket, zone, state.refs[0]?.analysis, library), [bucket, zone, state.refs, library]);
  const options = library
    .filter((m) => m.buckets.includes(bucket))
    .map((m) => ({ value: m.id, label: m.name + (m.id === suggestion.materialId ? "  ★" : ""), group: m.custom ? "Your library" : "Catalogue" }));
  const analysis = state.refs[0]?.analysis;

  return (
    <div className={cx("rounded-lg border bg-white transition", activeLayer === bucket ? "border-black/15 shadow-sm" : "border-line", !state.enabled && "opacity-60")}>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <button
          onClick={() => useStore.setState({ layer: bucket, view: "edit", tool: useStore.getState().tool === "pan" ? "brush" : useStore.getState().tool })}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title="Select to paint this mask"
        >
          <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: `rgb(${info.color.join(",")})` }} />
          <span className="text-[13px] font-semibold">{info.label}</span>
          <span className={cx("rounded px-1.5 py-px text-[10px] font-medium tabular-nums", mask.coverage > 0 ? "bg-paper text-mute" : "bg-amber-50 text-amber-700")}>
            {mask.coverage > 0 ? `${(mask.coverage * 100).toFixed(mask.coverage < 0.1 ? 1 : 0)}% · ${mask.source === "auto" ? "detected" : "painted"}` : "no mask"}
          </span>
          {activeLayer === bucket && <Paintbrush size={12} className="text-accent" />}
        </button>
        <button
          className="rounded p-1 text-faint hover:bg-hover hover:text-ink"
          onClick={() => useStore.setState((s) => ({ hiddenLayers: hidden ? s.hiddenLayers.filter((l) => l !== bucket) : [...s.hiddenLayers, bucket] }))}
          aria-label={hidden ? "Show mask" : "Hide mask"}
        >
          {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <Toggle checked={state.enabled} onChange={(v) => patchProject((d) => void (d.buckets[bucket].enabled = v))} />
      </div>

      <div className="space-y-2.5 p-3">
        <div {...drop.props} className={cx("drop-zone grid grid-cols-4 gap-1.5 rounded-md", drop.over && "drop-over")}>
          {state.refs.map((r) => (
            <div key={r.id} className="group relative aspect-square overflow-hidden rounded-md bg-paper ring-1 ring-black/5">
              <BlobImg id={r.blobId} className="h-full w-full object-cover" />
              {r.analysis && (
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/55 px-1 text-[9px] font-medium capitalize text-white">{r.analysis.family}</span>
              )}
              <button
                onClick={() => void removeReference(bucket, r.id)}
                className="absolute right-0.5 top-0.5 hidden rounded bg-black/60 p-0.5 text-white group-hover:block"
                aria-label={`Remove ${r.name}`}
              >
                <X size={11} />
              </button>
            </div>
          ))}
          {state.refs.length === 0 ? (
            <button
              onClick={() => inputRef.current?.click()}
              className="col-span-4 flex h-14 items-center justify-center gap-2 rounded-md border border-dashed border-black/15 text-xs text-faint transition hover:border-accent hover:bg-accent-soft hover:text-accent"
            >
              <Plus size={15} /> Drop or browse reference images
            </button>
          ) : (
            state.refs.length < 4 && (
              <button
                onClick={() => inputRef.current?.click()}
                className="flex aspect-square items-center justify-center rounded-md border border-dashed border-black/15 text-faint transition hover:border-accent hover:bg-accent-soft hover:text-accent"
                aria-label="Add reference image"
              >
                <Plus size={14} />
              </button>
            )
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void addReferences(bucket, [...e.target.files]);
              e.target.value = "";
            }}
          />
        </div>

        <div>
          <Select
            value={state.materialId ?? ""}
            onChange={(v) => setMaterial(bucket, v || null)}
            options={[{ value: "", label: state.refs.length ? "Text-free (reference only)" : "Choose a material…" }, ...options]}
          />
          <div className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-faint">
            {state.materialPinned ? (
              <>
                <Pin size={11} className="mt-px shrink-0" />
                <span className="flex-1">Chosen by you.</span>
                <button
                  className="font-medium text-accent hover:underline"
                  onClick={() =>
                    patchProject((d) => {
                      d.buckets[bucket].materialPinned = false;
                      d.buckets[bucket].materialId = suggestion.materialId;
                    })
                  }
                >
                  Use suggestion
                </button>
              </>
            ) : state.materialId ? (
              <>
                <Sparkles size={11} className="mt-px shrink-0 text-accent" />
                <span>{suggestion.reason}</span>
              </>
            ) : null}
          </div>
          {analysis && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-mute">
              <span className="h-3 w-3 rounded-sm ring-1 ring-black/10" style={{ background: analysis.swatch }} />
              {analysis.tone} · {analysis.warmth} · {analysis.family} ({Math.round(analysis.confidence * 100)}%)
            </div>
          )}
        </div>

        {state.refs.length > 0 && (
          <Slider label="Reference strength" value={state.weight} min={0.2} max={1.4} step={0.05} onChange={(v) => patchProject((d) => void (d.buckets[bucket].weight = v))} format={(v) => v.toFixed(2)} />
        )}
        <input
          value={state.note}
          onChange={(e) => patchProject((d) => void (d.buckets[bucket].note = e.target.value))}
          placeholder={`Notes for the ${info.label.toLowerCase()}, e.g. "herringbone, honed"`}
          className="h-7 w-full rounded-md border border-transparent bg-paper px-2 text-xs outline-none placeholder:text-faint focus:border-line focus:bg-white"
        />
      </div>
    </div>
  );
}

function ProtectedCard() {
  const mask = useStore((s) => s.project!.masks.protected);
  const active = useStore((s) => s.layer === "protected");
  // Walls or ceiling masked with nothing protected: windows, doors and beams inside those masks
  // would be repainted along with the surface.
  const exposed = useStore((s) => {
    const p = s.project!;
    return mask.coverage === 0 && (["walls", "ceiling"] as const).some((b) => p.buckets[b].enabled && p.masks[b].coverage > 0.001);
  });
  return (
    <div className="space-y-2">
      <button
        onClick={() => useStore.setState({ layer: "protected", view: "edit", tool: "brush" })}
        className={cx("flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition hover:bg-paper", active ? "border-red-200 bg-red-50/40" : "border-line")}
      >
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-danger" />
        <span className="flex-1">
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            Protected structure
            <span className="rounded bg-paper px-1.5 py-px text-[10px] font-medium tabular-nums text-mute">{(mask.coverage * 100).toFixed(1)}%</span>
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-mute">Doors, windows, mullions, columns, beams and fixtures. Subtracted from every surface, so they are never repainted.</span>
        </span>
      </button>
      {exposed && (
        <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
          Walls or ceiling are masked but nothing is protected, so any window, door, beam or light inside those masks will be repainted too. Run <b>Auto-detect</b> or paint them with the <b>Protected</b> layer (key 0).
        </p>
      )}
    </div>
  );
}

function GenerateFooter() {
  const job = useStore((s) => s.job);
  const doctor = useStore((s) => s.doctor);
  const project = useStore((s) => s.project);
  const hasBase = !!project?.base;
  const profile = project?.settings.profile;
  const surfaces = activeSurfaces(project);
  const online = !!doctor?.online;
  const ready = hasBase && online && surfaces.length > 0;
  const pct = job && job.max > 0 ? job.value / job.max : null;

  return (
    <div className="shrink-0 border-t border-line bg-white p-3">
      {job ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">{job.stage}</span>
            <span className="tabular-nums text-mute">
              {pct !== null ? `${job.value}/${job.max}` : ""} <Elapsed since={job.startedAt} />
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-paper">
            <div
              className={cx("h-full rounded-full bg-accent transition-all duration-300", pct === null && "w-1/3 animate-pulse")}
              style={pct !== null ? { width: `${Math.max(4, pct * 100)}%` } : undefined}
            />
          </div>
          <Button className="w-full" onClick={cancelJob}>
            <Square size={12} /> Cancel
          </Button>
        </div>
      ) : (
        <>
          <Button variant="primary" size="lg" className="w-full" disabled={!ready} onClick={() => void generate()}>
            <Sparkles size={15} /> Generate {surfaces.length ? `${surfaces.length} surface${surfaces.length > 1 ? "s" : ""}` : ""}
          </Button>
          <p className="mt-1.5 text-center text-[11px] text-faint">
            {!hasBase
              ? "Add a base image first"
              : !online
                ? "ComfyUI is offline"
                : !surfaces.length
                  ? "Mask a surface and give it a reference or material"
                  : `${profile === "studio" ? "Studio (SDXL)" : "Lite (CPU)"} · Ctrl+Enter`}
          </p>
        </>
      )}
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <span>· {formatDuration(Date.now() - since)}</span>;
}
