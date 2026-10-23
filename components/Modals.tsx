"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { useStore } from "@/lib/store";
import { ModelManager } from "./ModelManager";
import { MaterialLibrary } from "./MaterialLibrary";
import { SettingsDialog } from "./SettingsDialog";
import { ProposalPeek } from "./ProposalPeek";

export function Modals() {
  const modal = useStore((s) => s.modal);
  if (!modal) return null;
  const close = () => useStore.setState({ modal: null });
  if (modal === "settings") return <CenterModal title="Settings" onClose={close}><SettingsDialog /></CenterModal>;
  return (
    <Peek
      title={modal === "models" ? "Model manager" : modal === "library" ? "Material library" : "Specification proposal"}
      subtitle={
        modal === "models"
          ? "Models download straight into your ComfyUI folder."
          : modal === "library"
            ? "Philippine, tropical-rated finishes used for sourcing and the BOQ."
            : "Cover, before/after, mood board, BOQ and tropical guidelines."
      }
      onClose={close}
    >
      {modal === "models" && <ModelManager />}
      {modal === "library" && <MaterialLibrary />}
      {modal === "proposal" && <ProposalPeek />}
    </Peek>
  );
}

/** Notion-style peek: slides in from the right over a light scrim. */
function Peek({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/10" onClick={onClose} />
      <div className="relative flex h-full w-[min(620px,100vw)] animate-peek-in flex-col bg-white shadow-peek">
        <header className="flex shrink-0 items-start gap-3 px-6 pb-4 pt-5">
          <div className="flex-1">
            <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-mute">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-mute hover:bg-hover hover:text-ink" aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

function CenterModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/15" onClick={onClose} />
      <div className="relative w-[min(520px,100%)] animate-pop-in rounded-xl bg-white shadow-[0_24px_64px_rgb(0_0_0/0.18)]">
        <header className="flex items-center px-5 pb-1 pt-4">
          <h2 className="flex-1 text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-mute hover:bg-hover hover:text-ink" aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

function useEscape(fn: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && fn();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [fn]);
}
