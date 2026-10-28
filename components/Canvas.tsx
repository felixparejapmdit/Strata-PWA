"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Download, Trash2, Loader2, Maximize2 } from "lucide-react";
import { masksChanged, patchProject, setBaseImage, useStore } from "@/lib/store";
import { masks } from "@/lib/masks";
import { LAYERS, LAYER_INFO } from "@/lib/buckets";
import { canvas as makeCanvas, ctx2d, magicWand, subtractMask, unionInto } from "@/lib/image";
import { deleteBlobs } from "@/lib/db";
import { downloadRender, upscaleRender } from "@/lib/pipeline";
import { CanvasToolbar } from "./CanvasToolbar";
import { BlobImg, Button, cx, useBlobUrl, useDropTarget } from "./ui";

const INSPECTOR_SPACE = 360;

interface View {
  x: number;
  y: number;
  k: number;
}

export function Canvas() {
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.view);
  const tool = useStore((s) => s.tool);
  const layer = useStore((s) => s.layer);
  const brushSize = useStore((s) => s.brushSize);
  const wandTolerance = useStore((s) => s.wandTolerance);
  const showMasks = useStore((s) => s.showMasks);
  const hiddenLayers = useStore((s) => s.hiddenLayers);
  const maskVersion = useStore((s) => s.maskVersion);
  const fitSignal = useStore((s) => s.fitSignal);
  const job = useStore((s) => s.job);

  const base = project?.base ?? null;
  const W = base?.editWidth ?? 0;
  const H = base?.editHeight ?? 0;
  const baseUrl = useBlobUrl(base?.editBlobId);
  const render = project?.renders.find((r) => r.id === project.activeRenderId) ?? null;
  const renderUrl = useBlobUrl(render ? render.finalBlobId ?? render.previewBlobId : null);

  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [vt, setVt] = useState<View>({ x: 0, y: 0, k: 1 });
  const vtRef = useRef(vt);
  vtRef.current = vt;
  const [split, setSplit] = useState(0.5);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const gesture = useRef<{ kind: "pan" | "paint" | "split"; sx: number; sy: number; ox: number; oy: number; last?: { x: number; y: number }; erase?: boolean } | null>(null);
  const pixelCache = useRef<{ id: string; data: ImageData } | null>(null);
  const tint = useRef<HTMLCanvasElement | null>(null);

  // ----- fit -----
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || !W || !H) return;
    const r = el.getBoundingClientRect();
    const availW = r.width - INSPECTOR_SPACE - 64;
    const availH = r.height - 150;
    const k = Math.max(0.05, Math.min(availW / W, availH / H, 4));
    setVt({ k, x: (r.width - INSPECTOR_SPACE - W * k) / 2, y: (r.height - H * k) / 2 - 8 });
  }, [W, H]);

  useEffect(fit, [fit, fitSignal]);
  useEffect(() => {
    const ro = new ResizeObserver(() => fit());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [fit]);

  // ----- overlay -----
  const drawOverlay = useCallback(() => {
    const c = overlayRef.current;
    if (!c || !W || !H) return;
    // The project's base can change a tick before the mask manager reloads at the new size.
    if (!masks.isReadyFor(W, H)) return;
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const x = ctx2d(c);
    x.clearRect(0, 0, W, H);
    const s = useStore.getState();
    if (!s.showMasks || s.view !== "edit") return;
    tint.current ??= makeCanvas(W, H);
    const t = tint.current;
    if (t.width !== W || t.height !== H) {
      t.width = W;
      t.height = H;
    }
    const tx = ctx2d(t);
    for (const l of LAYERS) {
      if (s.hiddenLayers.includes(l)) continue;
      const [r, g, b] = LAYER_INFO[l].color;
      tx.globalCompositeOperation = "source-over";
      tx.clearRect(0, 0, W, H);
      tx.fillStyle = `rgb(${r},${g},${b})`;
      tx.fillRect(0, 0, W, H);
      tx.globalCompositeOperation = "destination-in";
      tx.drawImage(masks.get(l), 0, 0);
      x.globalAlpha = l === s.layer ? 0.5 : 0.28;
      x.drawImage(t, 0, 0);
    }
    x.globalAlpha = 1;
  }, [W, H]);

  useEffect(drawOverlay, [drawOverlay, maskVersion, hiddenLayers, showMasks, layer, view]);
  useEffect(() => {
    const unsubscribe = masks.subscribe(drawOverlay);
    return () => void unsubscribe();
  }, [drawOverlay]);

  // ----- wheel (non-passive so we can prevent page zoom) -----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = vtRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const k = Math.max(0.05, Math.min(16, v.k * Math.exp(-e.deltaY * 0.0018)));
        setVt({ k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k });
      } else {
        setVt({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement).closest("input, textarea, select")) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ----- pointer -----
  const toImage = (e: React.PointerEvent) => {
    const r = containerRef.current!.getBoundingClientRect();
    const v = vtRef.current;
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k };
  };

  const stroke = (a: { x: number; y: number }, b: { x: number; y: number }, erase: boolean) => {
    const x = ctx2d(masks.get(useStore.getState().layer));
    x.save();
    x.globalCompositeOperation = erase ? "destination-out" : "source-over";
    x.strokeStyle = x.fillStyle = "#fff";
    x.lineWidth = brushSize;
    x.lineCap = x.lineJoin = "round";
    x.beginPath();
    x.moveTo(a.x, a.y);
    x.lineTo(b.x, b.y);
    x.stroke();
    x.beginPath();
    x.arc(b.x, b.y, brushSize / 2, 0, Math.PI * 2);
    x.fill();
    x.restore();
  };

  const basePixels = async (): Promise<ImageData | null> => {
    if (!base || !baseUrl) return null;
    if (pixelCache.current?.id === base.editBlobId) return pixelCache.current.data;
    const img = new Image();
    img.src = baseUrl;
    await img.decode();
    const c = makeCanvas(W, H);
    const x = ctx2d(c);
    x.drawImage(img, 0, 0, W, H);
    const data = x.getImageData(0, 0, W, H);
    pixelCache.current = { id: base.editBlobId, data };
    return data;
  };

  const onPointerDown = async (e: React.PointerEvent) => {
    if (!base) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const v = vtRef.current;
    const wantsPan = e.button === 1 || spaceHeld || (view === "edit" && tool === "pan") || (view === "result" && e.button === 0);
    if (wantsPan) {
      gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y };
      return;
    }
    if (e.button !== 0) return;
    if (view === "compare") {
      gesture.current = { kind: "split", sx: 0, sy: 0, ox: 0, oy: 0 };
      setSplit(Math.max(0, Math.min(1, toImage(e).x / W)));
      return;
    }
    if (!masks.isReadyFor(W, H)) return;
    const p = toImage(e);
    if (tool === "wand") {
      if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) return;
      const px = await basePixels();
      if (!px) return;
      const sel = magicWand(px, Math.floor(p.x), Math.floor(p.y), wandTolerance);
      masks.checkpoint(layer);
      if (e.altKey) {
        subtractMask(masks.get(layer), sel);
        masksChanged([layer]);
      } else {
        unionInto(masks.get(layer), sel);
        masks.exclusive(layer);
        masksChanged([...LAYERS], "manual", [layer]);
      }
      return;
    }
    masks.checkpoint(layer);
    const erase = tool === "erase" || e.altKey;
    gesture.current = { kind: "paint", sx: 0, sy: 0, ox: 0, oy: 0, last: p, erase };
    stroke(p, p, erase);
    drawOverlay();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const cur = cursorRef.current;
    if (cur) {
      const r = containerRef.current!.getBoundingClientRect();
      cur.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
    }
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pan") {
      setVt((v) => ({ ...v, x: g.ox + e.clientX - g.sx, y: g.oy + e.clientY - g.sy }));
    } else if (g.kind === "split") {
      setSplit(Math.max(0, Math.min(1, toImage(e).x / W)));
    } else if (g.kind === "paint" && g.last) {
      const p = toImage(e);
      stroke(g.last, p, !!g.erase);
      g.last = p;
      requestAnimationFrame(drawOverlay);
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === "paint") {
      if (!g.erase) {
        masks.exclusive(layer);
        masksChanged([...LAYERS], "manual", [layer]);
      } else {
        masksChanged([layer]);
      }
    }
  };

  // ----- drop -----
  const drop = useDropTarget((files) => {
    if (base && !confirm("Replace the base image? Masks for this project will be cleared.")) return;
    void setBaseImage(files[0]);
  });

  const painting = view === "edit" && (tool === "brush" || tool === "erase") && !spaceHeld;
  const cursor = spaceHeld || (view === "edit" && tool === "pan") || view === "result" ? (gesture.current?.kind === "pan" ? "grabbing" : "grab") : view === "compare" ? "ew-resize" : tool === "wand" ? "crosshair" : painting ? "none" : "default";

  return (
    <div
      ref={containerRef}
      className={cx("dot-grid absolute inset-0 overflow-hidden touch-none select-none", base && "drop-zone !rounded-none !outline-offset-[-6px]", drop.over && "drop-over")}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => cursorRef.current && (cursorRef.current.style.transform = "translate(-999px,-999px)")}
      {...(base ? drop.props : {})}
    >
      {!base && <EmptyState />}

      {base && (
        <div
          className="absolute left-0 top-0 origin-top-left shadow-[0_2px_10px_rgb(0_0_0/0.08),0_20px_50px_rgb(0_0_0/0.12)]"
          style={{ width: W, height: H, transform: `translate(${vt.x}px, ${vt.y}px) scale(${vt.k})` }}
        >
          {baseUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={baseUrl} alt="Base" draggable={false} className="absolute inset-0 h-full w-full" style={{ imageRendering: vt.k > 2 ? "pixelated" : "auto" }} />
          )}
          {view !== "edit" && renderUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={renderUrl}
              alt="Render"
              draggable={false}
              className="absolute inset-0 h-full w-full"
              style={view === "compare" ? { clipPath: `inset(0 0 0 ${split * 100}%)` } : undefined}
            />
          )}
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          {job?.preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={job.preview} alt="Live preview" className="pointer-events-none absolute inset-0 h-full w-full opacity-90" />
          )}
          {view === "compare" && renderUrl && (
            <div className="pointer-events-none absolute inset-y-0" style={{ left: `${split * 100}%` }}>
              <div className="absolute inset-y-0 -left-px w-0.5 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.15)]" style={{ transform: `scaleX(${1 / vt.k})` }} />
              <div
                className="absolute top-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-ink shadow-float"
                style={{ transform: `translate(-50%,-50%) scale(${1 / vt.k})` }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3 1 7l4 4M9 3l4 4-4 4" /></svg>
              </div>
            </div>
          )}
        </div>
      )}

      {base && view === "compare" && renderUrl && (
        <>
          <Chip className="left-4 top-16">Before</Chip>
          <Chip className="top-16" style={{ right: INSPECTOR_SPACE + 16 }}>After</Chip>
        </>
      )}
      {job?.preview && (
        <Chip className="left-1/2 top-16 -translate-x-1/2" style={{ marginLeft: -INSPECTOR_SPACE / 2 }}>
          <Loader2 size={12} className="mr-1.5 inline animate-spin" />
          Live preview · {job.stage}
        </Chip>
      )}

      {painting && base && (
        <div ref={cursorRef} className="pointer-events-none absolute left-0 top-0 z-10" style={{ transform: "translate(-999px,-999px)" }}>
          <div
            className="-translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)]"
            style={{ width: brushSize * vt.k, height: brushSize * vt.k, background: tool === "erase" ? "transparent" : `rgb(${LAYER_INFO[layer].color.join(",")} / 0.25)` }}
          />
        </div>
      )}

      {base && <CanvasToolbar zoom={vt.k} onFit={fit} onZoom={(f) => setVt((v) => zoomAroundCenter(v, f, containerRef.current))} />}
      {base && project && project.renders.length > 0 && <Filmstrip />}
    </div>
  );
}

function zoomAroundCenter(v: View, factor: number, el: HTMLElement | null): View {
  if (!el) return v;
  const r = el.getBoundingClientRect();
  const cx = (r.width - INSPECTOR_SPACE) / 2, cy = r.height / 2;
  const k = Math.max(0.05, Math.min(16, v.k * factor));
  return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
}

function Chip({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cx("pointer-events-none absolute z-10 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur", className)} style={style}>
      {children}
    </div>
  );
}

function EmptyState() {
  const inputRef = useRef<HTMLInputElement>(null);
  const drop = useDropTarget((files) => void setBaseImage(files[0]));
  return (
    <div className="absolute inset-0 grid place-items-center" style={{ paddingRight: INSPECTOR_SPACE }}>
      <div
        {...drop.props}
        className={cx("drop-zone flex w-[min(460px,90%)] flex-col items-center rounded-2xl border-2 border-dashed border-black/10 bg-white/70 px-8 py-12 text-center backdrop-blur", drop.over && "drop-over")}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent">
          <ImagePlus size={22} />
        </div>
        <h2 className="text-[15px] font-semibold">Drop a base photo or render</h2>
        <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-mute">
          A room photo, SketchUp export or render. Strata keeps every wall, door, window and column exactly where it is and only re-finishes the surfaces you choose.
        </p>
        <Button variant="primary" className="mt-5" onClick={() => inputRef.current?.click()}>
          Choose image
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void setBaseImage(f);
            e.target.value = "";
          }}
        />
        <p className="mt-4 text-[11px] text-faint">JPG, PNG or WebP · stays on this device</p>
      </div>
    </div>
  );
}

function Filmstrip() {
  const project = useStore((s) => s.project)!;
  const job = useStore((s) => s.job);
  const active = project.renders.find((r) => r.id === project.activeRenderId);
  return (
    <div
      className="absolute bottom-4 left-1/2 z-10 flex max-w-[60%] items-center gap-1.5 rounded-xl border border-line bg-white/95 p-1.5 shadow-float backdrop-blur"
      style={{ transform: `translateX(calc(-50% - ${INSPECTOR_SPACE / 2}px))` }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="scroll-thin flex gap-1.5 overflow-x-auto">
        {project.renders.map((r, i) => (
          <button
            key={r.id}
            onClick={() => {
              patchProject((d) => void (d.activeRenderId = r.id));
              if (useStore.getState().view === "edit") useStore.setState({ view: "compare" });
            }}
            className={cx("relative shrink-0 overflow-hidden rounded-md ring-2 transition", r.id === project.activeRenderId ? "ring-accent" : "ring-transparent hover:ring-black/10")}
            title={`Render ${project.renders.length - i} · seed ${r.seed}${r.finalWidth ? ` · ${r.finalWidth}×${r.finalHeight}` : ""}`}
          >
            <BlobImg id={r.previewBlobId} className="h-11 w-16 object-cover" />
            {r.finalBlobId && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[9px] font-semibold text-white">4K</span>}
          </button>
        ))}
      </div>
      {active && (
        <div className="flex shrink-0 items-center border-l border-line pl-1.5">
          {!active.finalBlobId && (
            <button
              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-accent-soft disabled:text-faint disabled:hover:bg-transparent"
              title="Upscale this render to 4K for print and the proposal"
              disabled={!!job}
              onClick={() => void upscaleRender(active.id)}
            >
              <Maximize2 size={13} /> 4K
            </button>
          )}
          <button className="grid h-8 w-8 place-items-center rounded-md text-mute hover:bg-hover hover:text-ink" title="Download render" onClick={() => void downloadRender(active, project.name)}>
            <Download size={15} />
          </button>
          <button
            className="grid h-8 w-8 place-items-center rounded-md text-mute hover:bg-red-50 hover:text-danger"
            title="Delete render"
            onClick={() => {
              if (!confirm("Delete this render?")) return;
              patchProject((d) => {
                d.renders = d.renders.filter((r) => r.id !== active.id);
                d.activeRenderId = d.renders[0]?.id ?? null;
              });
              void deleteBlobs([active.previewBlobId, active.finalBlobId]);
              if (project.renders.length === 1) useStore.setState({ view: "edit" });
            }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
