"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { getBlob } from "@/lib/db";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ variant = "secondary", size = "md", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors select-none disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
        size === "sm" && "h-7 px-2 text-xs",
        size === "md" && "h-8 px-3 text-[13px]",
        size === "lg" && "h-10 px-4 text-sm",
        variant === "primary" && "bg-accent text-white hover:bg-accent-strong shadow-sm",
        variant === "secondary" && "bg-white text-ink border border-line hover:bg-hover",
        variant === "ghost" && "text-ink hover:bg-hover",
        variant === "danger" && "text-danger hover:bg-red-50",
        className,
      )}
    />
  );
}

export function IconButton({ active, className, title, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...rest}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cx(
        "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-40",
        active ? "bg-accent-soft text-accent" : "text-mute hover:bg-hover hover:text-ink",
        className,
      )}
    />
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-mute">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-faint">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full h-8 rounded-md border border-line bg-white px-2.5 text-[13px] text-ink placeholder:text-faint outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function NumberInput({ value, onChange, step = 1, min, max, suffix, ...rest }: { value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; suffix?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <div className="relative">
      <input
        {...rest}
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n)) onChange(n);
        }}
        className={cx(inputClass, suffix && "pr-9")}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">{suffix}</span>}
    </div>
  );
}

export function Select<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; group?: string }[]; className?: string }) {
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={cx(inputClass, "pr-7 cursor-pointer", className)}>
      {groups.map((g) =>
        g ? (
          <optgroup key={g} label={g}>
            {options.filter((o) => o.group === g).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>
        ) : (
          options.filter((o) => !o.group).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))
        ),
      )}
    </select>
  );
}

export function Slider({ label, value, onChange, min, max, step, format }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; format?: (v: number) => string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-mute">{label}</span>
        <span className="tabular-nums text-ink">{format ? format(value) : value}</span>
      </div>
      <input type="range" className="range w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label?: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      {label && (
        <span>
          <span className="block text-[13px] text-ink">{label}</span>
          {hint && <span className="block text-[11px] leading-snug text-faint">{hint}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        className={cx("relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-black/15")}
      >
        <span className={cx("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[16px]" : "translate-x-0.5")} />
      </button>
    </label>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mute">{title}</h3>
        {aside}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-white px-1 py-px font-sans text-[10px] text-mute">{children}</kbd>;
}

const urlCache = new Map<string, string>();

/** Object URL for a blob stored in IndexedDB (cached for the session). */
export function useBlobUrl(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (id ? urlCache.get(id) ?? null : null));
  useEffect(() => {
    if (!id) {
      setUrl(null);
      return;
    }
    const hit = urlCache.get(id);
    if (hit) {
      setUrl(hit);
      return;
    }
    let alive = true;
    getBlob(id).then((b) => {
      if (!b || !alive) return;
      const u = URL.createObjectURL(b);
      urlCache.set(id, u);
      setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}

export function BlobImg({ id, className, alt = "" }: { id: string | null | undefined; className?: string; alt?: string }) {
  const url = useBlobUrl(id);
  if (!url) return <div className={cx("bg-hover", className)} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={className} draggable={false} />;
}

export function timeAgo(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

/** Accepts dropped files on an element and lights it up while a drag hovers it. */
export function useDropTarget(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
        if (files.length) onFiles(files);
      },
    },
  };
}
