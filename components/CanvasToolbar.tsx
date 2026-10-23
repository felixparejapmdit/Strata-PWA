"use client";

import { Hand, Paintbrush, Eraser, Wand2, Undo2, Eye, EyeOff, ScanSearch, Maximize, Minus, Plus, Trash2 } from "lucide-react";
import { masksChanged, undoMask, useStore, type Tool, type View } from "@/lib/store";
import { masks } from "@/lib/masks";
import { LAYERS, LAYER_INFO } from "@/lib/buckets";
import { runSegmentation } from "@/lib/pipeline";
import { cx, IconButton, Kbd } from "./ui";

const TOOLS: { id: Tool; icon: typeof Hand; label: string; key: string }[] = [
  { id: "pan", icon: Hand, label: "Pan", key: "V" },
  { id: "brush", icon: Paintbrush, label: "Brush", key: "B" },
  { id: "erase", icon: Eraser, label: "Eraser", key: "E" },
  { id: "wand", icon: Wand2, label: "Magic wand (Alt to subtract)", key: "W" },
];

export function CanvasToolbar({ zoom, onFit, onZoom }: { zoom: number; onFit: () => void; onZoom: (factor: number) => void }) {
  const view = useStore((s) => s.view);
  const tool = useStore((s) => s.tool);
  const layer = useStore((s) => s.layer);
  const brushSize = useStore((s) => s.brushSize);
  const wandTolerance = useStore((s) => s.wandTolerance);
  const showMasks = useStore((s) => s.showMasks);
  const hasRenders = useStore((s) => (s.project?.renders.length ?? 0) > 0);
  const job = useStore((s) => s.job);
  const samReady = useStore((s) => !!s.doctor?.online && !!s.doctor.objectInfo?.SAM3_Detect);
  const coverage = useStore((s) => s.project?.masks[layer]?.coverage ?? 0);
  const set = useStore.setState;

  const views: { id: View; label: string; disabled?: boolean }[] = [
    { id: "edit", label: "Masks" },
    { id: "compare", label: "Compare", disabled: !hasRenders },
    { id: "result", label: "Result", disabled: !hasRenders },
  ];

  return (
    <div className="absolute left-4 right-[376px] top-3 z-20 flex justify-center" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-line bg-white/95 p-1 shadow-float backdrop-blur [scrollbar-width:none]">
        <div className="flex rounded-lg bg-paper p-0.5">
          {views.map((v) => (
            <button
              key={v.id}
              disabled={v.disabled}
              onClick={() => set({ view: v.id })}
              className={cx("h-7 rounded-md px-2.5 text-xs font-medium transition disabled:opacity-40", view === v.id ? "bg-white text-ink shadow-sm" : "text-mute hover:text-ink")}
              title={v.id === "compare" ? "Before / after (C)" : undefined}
            >
              {v.label}
            </button>
          ))}
        </div>

        {view === "edit" && (
          <>
            <Divider />
            {TOOLS.map((t) => (
              <IconButton key={t.id} active={tool === t.id} onClick={() => set({ tool: t.id })} title={`${t.label} (${t.key})`}>
                <t.icon size={16} />
              </IconButton>
            ))}
            <Divider />
            <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Mask layer">
              {LAYERS.map((l) => {
                const info = LAYER_INFO[l];
                return (
                  <button
                    key={l}
                    role="radio"
                    aria-checked={layer === l}
                    onClick={() => set({ layer: l, tool: tool === "pan" ? "brush" : tool })}
                    className={cx("flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition", layer === l ? "bg-paper font-medium text-ink ring-1 ring-black/10" : "text-mute hover:bg-hover")}
                    title={`${info.label} (${info.shortcut})`}
                  >
                    <span className={cx("h-2.5 w-2.5 rounded-sm", l === "protected" && "hatch")} style={{ background: l === "protected" ? undefined : `rgb(${info.color.join(",")})`, outline: l === "protected" ? `1px solid rgb(${info.color.join(",")})` : undefined }} />
                    <span className={layer === l ? "inline" : "hidden 2xl:inline"}>{info.label}</span>
                  </button>
                );
              })}
            </div>
            <Divider />
            {tool === "wand" ? (
              <SizeControl label="Tolerance" value={wandTolerance} min={4} max={90} onChange={(v) => set({ wandTolerance: v })} />
            ) : (
              <SizeControl label="Size" value={brushSize} min={4} max={300} onChange={(v) => set({ brushSize: v })} />
            )}
            <IconButton title="Undo (Ctrl+Z)" onClick={undoMask}>
              <Undo2 size={16} />
            </IconButton>
            <IconButton
              title={`Clear ${LAYER_INFO[layer].label.toLowerCase()} mask`}
              disabled={coverage === 0}
              onClick={() => {
                masks.checkpoint(layer);
                masks.clear(layer);
                masksChanged([layer]);
              }}
            >
              <Trash2 size={15} />
            </IconButton>
            <IconButton title="Show masks (M)" active={!showMasks} onClick={() => set({ showMasks: !showMasks })}>
              {showMasks ? <Eye size={16} /> : <EyeOff size={16} />}
            </IconButton>
            <Divider />
            <button
              disabled={!samReady || !!job}
              onClick={() => void runSegmentation()}
              className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-accent hover:bg-accent-soft disabled:text-faint disabled:hover:bg-transparent"
              title={samReady ? "Detect floor, walls, ceiling, furniture and structure with SAM3" : "Needs ComfyUI online with the SAM3 model"}
            >
              <ScanSearch size={15} /> <span className="whitespace-nowrap">Auto-detect</span>
            </button>
          </>
        )}

        <Divider />
        <IconButton title="Zoom out" onClick={() => onZoom(1 / 1.25)}>
          <Minus size={15} />
        </IconButton>
        <span className="w-10 text-center text-xs tabular-nums text-mute">{Math.round(zoom * 100)}%</span>
        <IconButton title="Zoom in" onClick={() => onZoom(1.25)}>
          <Plus size={15} />
        </IconButton>
        <IconButton title="Fit to screen (F)" onClick={onFit}>
          <Maximize size={14} />
        </IconButton>
      </div>
      {view === "edit" && (
        <div className="pointer-events-none absolute top-[52px] hidden text-[11px] text-mute xl:block">
          <Kbd>Space</Kbd> drag to pan · <Kbd>Ctrl</Kbd>+scroll to zoom · <Kbd>Alt</Kbd> to erase · <Kbd>[</Kbd> <Kbd>]</Kbd> size
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-line" />;
}

function SizeControl({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 px-1 text-xs text-mute">
      <span className="hidden 2xl:inline">{label}</span>
      <input type="range" className="range w-16" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <span className="w-6 tabular-nums text-ink">{value}</span>
    </label>
  );
}
