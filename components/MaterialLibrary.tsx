"use client";

import { useState } from "react";
import { ArrowLeft, Plus, Droplets, RotateCcw, Trash2 } from "lucide-react";
import { deleteLibraryMaterial, saveLibraryMaterial, toast, useStore } from "@/lib/store";
import { MATERIALS, type Material } from "@/lib/materials";
import { php } from "@/lib/boq";
import { BUCKETS, LAYER_INFO } from "@/lib/buckets";
import type { BucketId, TextureFamily } from "@/lib/types";
import { uid } from "@/lib/db";
import { Button, cx, Field, inputClass, NumberInput, Select, TextInput, Toggle } from "./ui";

const FAMILIES: TextureFamily[] = ["stone", "wood", "tile", "concrete", "plain", "fabric", "metal"];

export function MaterialLibrary() {
  const library = useStore((s) => s.library);
  const [editing, setEditing] = useState<Material | null>(null);
  const [filter, setFilter] = useState<BucketId | "all">("all");

  if (editing) return <Editor initial={editing} onDone={() => setEditing(null)} />;

  const list = library.filter((m) => filter === "all" || m.buckets.includes(filter));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex flex-wrap rounded-lg bg-paper p-0.5">
          {(["all", ...BUCKETS] as const).map((b) => (
            <button key={b} onClick={() => setFilter(b)} className={cx("h-7 rounded-md px-2.5 text-xs font-medium", filter === b ? "bg-white shadow-sm" : "text-mute hover:text-ink")}>
              {b === "all" ? "All" : LAYER_INFO[b].label}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() =>
            setEditing({
              id: uid("m_"),
              name: "",
              family: "stone",
              buckets: [filter === "all" ? "floor" : filter],
              zones: "any",
              wetOk: false,
              brands: "",
              suppliers: [{ name: "", area: "" }],
              spec: "",
              unit: "m²",
              supplyPhp: 0,
              installPhp: 0,
              wastagePct: 10,
              prompt: "",
              tropical: [],
              accessories: [],
              guidelines: [],
              custom: true,
            })
          }
        >
          <Plus size={13} /> New material
        </Button>
      </div>

      <div className="divide-y divide-line rounded-lg border border-line">
        {list.map((m) => {
          const overridden = m.custom && MATERIALS.some((x) => x.id === m.id);
          return (
            <button key={m.id} onClick={() => setEditing(m)} className="flex w-full items-start gap-3 p-3 text-left hover:bg-paper">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-medium">{m.name}</span>
                  {m.wetOk && <Droplets size={12} className="text-accent" aria-label="Wet-zone rated" />}
                  {m.custom && <span className="rounded bg-accent-soft px-1.5 text-[10px] font-medium text-accent">{overridden ? "edited" : "custom"}</span>}
                </div>
                <div className="mt-0.5 text-xs text-mute">{m.brands} · {m.suppliers.map((s) => s.name).join(", ")}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.buckets.map((b) => (
                    <span key={b} className="rounded bg-paper px-1.5 text-[10px] text-mute">{LAYER_INFO[b].label}</span>
                  ))}
                  <span className="rounded bg-paper px-1.5 text-[10px] capitalize text-mute">{m.family}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[13px] tabular-nums">{php(m.supplyPhp + m.installPhp, 0)}</div>
                <div className="text-[11px] text-faint">per {m.unit} installed</div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-faint">Rates are indicative Metro Manila figures to make the BOQ useful out of the box. Edit any entry to match your quotations; edits are saved on this device.</p>
    </div>
  );
}

function Editor({ initial, onDone }: { initial: Material; onDone: () => void }) {
  const [m, setM] = useState<Material>(structuredClone(initial));
  const set = (patch: Partial<Material>) => setM((x) => ({ ...x, ...patch }));
  const builtIn = MATERIALS.some((x) => x.id === m.id);
  const isOverride = builtIn && initial.custom;
  const lines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);

  const save = async () => {
    if (!m.name.trim()) return toast("Give the material a name.", "error");
    if (!m.buckets.length) return toast("Pick at least one surface.", "error");
    await saveLibraryMaterial(m);
    toast(`Saved ${m.name}`, "success");
    onDone();
  };

  return (
    <div className="space-y-4">
      <button onClick={onDone} className="flex items-center gap-1 text-xs text-mute hover:text-ink">
        <ArrowLeft size={13} /> Library
      </button>
      <Field label="Name">
        <TextInput value={m.name} onChange={(e) => set({ name: e.target.value })} autoFocus={!m.name} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Texture family" hint="Used to auto-match reference photos.">
          <Select value={m.family} onChange={(v) => set({ family: v })} options={FAMILIES.map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))} />
        </Field>
        <Field label="Unit">
          <Select value={m.unit} onChange={(v) => set({ unit: v })} options={[{ value: "m²", label: "per m²" }, { value: "pc", label: "per piece" }]} />
        </Field>
      </div>
      <Field label="Surfaces">
        <div className="flex flex-wrap gap-1.5">
          {BUCKETS.map((b) => {
            const on = m.buckets.includes(b);
            return (
              <button key={b} onClick={() => set({ buckets: on ? m.buckets.filter((x) => x !== b) : [...m.buckets, b] })} className={cx("h-7 rounded-md border px-2.5 text-xs", on ? "border-accent bg-accent-soft text-accent" : "border-line text-mute hover:bg-paper")}>
                {LAYER_INFO[b].label}
              </button>
            );
          })}
        </div>
      </Field>
      <Toggle label="Wet-zone rated" hint="Only wet-rated materials are suggested for bathrooms, kitchens and lanais." checked={m.wetOk} onChange={(v) => set({ wetOk: v })} />
      <Field label="Specification">
        <TextInput value={m.spec} onChange={(e) => set({ spec: e.target.value })} placeholder="Thickness, format, finish" />
      </Field>
      <Field label="Brands">
        <TextInput value={m.brands} onChange={(e) => set({ brands: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier">
          <TextInput value={m.suppliers[0]?.name ?? ""} onChange={(e) => set({ suppliers: [{ ...m.suppliers[0], name: e.target.value }, ...m.suppliers.slice(1)] })} />
        </Field>
        <Field label="Supplier area / branch">
          <TextInput value={m.suppliers[0]?.area ?? ""} onChange={(e) => set({ suppliers: [{ ...m.suppliers[0], area: e.target.value }, ...m.suppliers.slice(1)] })} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label={`Supply / ${m.unit}`}>
          <NumberInput value={m.supplyPhp} min={0} suffix="₱" onChange={(v) => set({ supplyPhp: v })} />
        </Field>
        <Field label={`Install / ${m.unit}`}>
          <NumberInput value={m.installPhp} min={0} suffix="₱" onChange={(v) => set({ installPhp: v })} />
        </Field>
        <Field label="Wastage">
          <NumberInput value={m.wastagePct} min={0} max={40} suffix="%" onChange={(v) => set({ wastagePct: v })} />
        </Field>
      </div>
      <Field label="Render prompt" hint="How the diffusion model should describe this finish.">
        <TextInput value={m.prompt} onChange={(e) => set({ prompt: e.target.value })} />
      </Field>
      <Field label="Tropical properties (one per line)">
        <textarea rows={3} value={m.tropical.join("\n")} onChange={(e) => set({ tropical: lines(e.target.value) })} className={cx(inputClass, "h-auto py-1.5 leading-snug")} />
      </Field>
      <Field label="Installation guidelines (one per line)">
        <textarea rows={3} value={m.guidelines.join("\n")} onChange={(e) => set({ guidelines: lines(e.target.value) })} className={cx(inputClass, "h-auto py-1.5 leading-snug")} />
      </Field>
      {m.accessories.length > 0 && (
        <div className="rounded-lg bg-paper p-3 text-xs text-mute">
          <div className="mb-1 font-medium text-ink">Mandatory accessories (added to the BOQ)</div>
          {m.accessories.map((a) => (
            <div key={a.name}>• {a.name}: {a.qtyPerUnit} {a.unit}/{m.unit} @ {php(a.unitCostPhp, 0)}</div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-line pt-4">
        <Button variant="primary" onClick={() => void save()}>Save</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        {initial.custom && (
          <Button
            variant="danger"
            className="ml-auto"
            onClick={async () => {
              await deleteLibraryMaterial(m.id);
              toast(isOverride ? "Restored the catalogue version" : "Material deleted", "success");
              onDone();
            }}
          >
            {isOverride ? <><RotateCcw size={13} /> Reset to catalogue</> : <><Trash2 size={13} /> Delete</>}
          </Button>
        )}
      </div>
    </div>
  );
}
