"use client";

import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { dismissToast, useStore } from "@/lib/store";
import { cx } from "./ui";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(440px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === "success" ? CheckCircle2 : t.kind === "error" ? AlertCircle : Info;
        return (
          <div key={t.id} className="pointer-events-auto flex animate-toast-in items-start gap-2.5 rounded-lg border border-line bg-white px-3 py-2.5 shadow-float">
            <Icon size={16} className={cx("mt-px shrink-0", t.kind === "success" ? "text-ok" : t.kind === "error" ? "text-danger" : "text-accent")} />
            <p className="flex-1 text-[13px] leading-snug">{t.text}</p>
            {t.action && (
              <button
                className="shrink-0 rounded px-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft"
                onClick={() => {
                  t.action!.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="shrink-0 text-faint hover:text-ink" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
