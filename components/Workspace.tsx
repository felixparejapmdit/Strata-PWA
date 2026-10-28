"use client";

import { useEffect } from "react";
import { init, undoMask, useStore, type Tool } from "@/lib/store";
import { LAYERS, LAYER_INFO } from "@/lib/buckets";
import { generate } from "@/lib/pipeline";
import { Sidebar } from "./Sidebar";
import { Canvas } from "./Canvas";
import { Inspector } from "./Inspector";
import { Toasts } from "./Toasts";
import { Modals } from "./Modals";
import { cx } from "./ui";

const TOOL_KEYS: Record<string, Tool> = { v: "pan", h: "pan", b: "brush", e: "erase", w: "wand" };

export function Workspace() {
  const ready = useStore((s) => s.ready);
  const dragging = useStore((s) => s.dragging);

  useEffect(() => {
    void init();
  }, []);

  // Global drag state: dims the UI and lights up drop zones; swallows stray drops.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      useStore.setState({ dragging: true });
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) useStore.setState({ dragging: false });
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const end = () => {
      depth = 0;
      useStore.setState({ dragging: false });
    };
    // Bubble phase: swallow drops outside drop zones so the browser doesn't open the file.
    const drop = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    // Capture phase: drop zones stopPropagation(), so clearing the dimmed state must not rely on bubbling.
    window.addEventListener("drop", end, true);
    window.addEventListener("dragend", end, true);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("drop", end, true);
      window.removeEventListener("dragend", end, true);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      const s = useStore.getState();
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        undoMask();
      } else if ((e.ctrlKey || e.metaKey) && k === "enter") {
        e.preventDefault();
        void generate();
      } else if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      } else if (k === "escape") {
        if (s.modal) useStore.setState({ modal: null });
      } else if (TOOL_KEYS[k]) {
        useStore.setState({ tool: TOOL_KEYS[k], view: "edit" });
      } else if (k === "[" || k === "]") {
        useStore.setState({ brushSize: Math.max(4, Math.min(300, Math.round(s.brushSize * (k === "]" ? 1.2 : 1 / 1.2)))) });
      } else if (k === "f") {
        useStore.setState({ fitSignal: s.fitSignal + 1 });
      } else if (k === "c") {
        if (s.project?.renders.length) useStore.setState({ view: s.view === "compare" ? "edit" : "compare" });
      } else if (k === "m") {
        useStore.setState({ showMasks: !s.showMasks });
      } else {
        const layer = LAYERS.find((l) => LAYER_INFO[l].shortcut === k);
        if (layer) useStore.setState({ layer, view: "edit", tool: s.tool === "pan" ? "brush" : s.tool });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={cx("flex h-dvh w-full overflow-hidden", dragging && "dragging")}>
      <Sidebar />
      <main className="relative min-w-0 flex-1">
        <Canvas />
        <Inspector />
      </main>
      {dragging && <div className="pointer-events-none fixed inset-0 z-40 bg-black/25 transition-opacity" />}
      {!ready && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-paper">
          <div className="flex items-center gap-3 text-mute">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
            Opening workspace…
          </div>
        </div>
      )}
      <Modals />
      <Toasts />
    </div>
  );
}
