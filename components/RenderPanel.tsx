"use client";

import { useState } from "react";
import { Check, X, Dices, ChevronDown, Cpu, Zap } from "lucide-react";
import { patchProject, setProfile, useStore } from "@/lib/store";
import { checkpointsForProfile, PROFILES, resolveModels } from "@/lib/workflow/profiles";
import { comboOptions } from "@/lib/workflow/graph";
import type { GenSettings, PipelineProfile } from "@/lib/types";
import { Button, cx, Field, inputClass, NumberInput, Section, Select, Slider, Toggle } from "./ui";

export function RenderPanel() {
  const s = useStore((st) => st.project!.settings);
  const doctor = useStore((st) => st.doctor);
  const [advanced, setAdvanced] = useState(false);
  const info = doctor?.objectInfo ?? null;
  const models = resolveModels(s.profile, s, info);
  const ckpts = checkpointsForProfile(s.profile, info);
  const samplers = comboOptions(info, "KSampler", "sampler_name") ?? [s.sampler];
  const schedulers = comboOptions(info, "KSampler", "scheduler") ?? [s.scheduler];
  const set = (patch: Partial<GenSettings>) => patchProject((d) => void Object.assign(d.settings, patch));

  return (
    <div>
      <Section title="Pipeline">
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(PROFILES) as PipelineProfile[]).map((p) => (
            <button
              key={p}
              onClick={() => p !== s.profile && setProfile(p)}
              className={cx("rounded-lg border p-2.5 text-left transition", s.profile === p ? "border-accent bg-accent-soft/60 ring-1 ring-accent/30" : "border-line hover:bg-paper")}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                {p === "lite" ? <Cpu size={13} /> : <Zap size={13} />}
                {p === "lite" ? "Lite" : "Studio"}
                {doctor?.recommendedProfile === p && <span className="rounded bg-ok/10 px-1 text-[9px] font-semibold uppercase text-ok">Fits</span>}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-mute">{p === "lite" ? "SD1.5 + LCM · CPU / ≤8 GB" : "SDXL · NVIDIA ≥12 GB"}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-faint">{PROFILES[s.profile].summary}</p>
        <Field label="Checkpoint">
          <Select value={s.checkpoint} onChange={(v) => set({ checkpoint: v })} options={(ckpts.length ? ckpts : [s.checkpoint]).map((c) => ({ value: c, label: c.replace(/\.safetensors$/, "") }))} />
        </Field>
        <ModelStatus models={models} useDepth={s.useDepth} useLcm={s.useLcm} />
      </Section>

      <Section title="Material">
        <Slider label="Material strength" value={s.denoise} min={0.4} max={1} step={0.01} onChange={(v) => set({ denoise: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <p className="-mt-1 text-[11px] leading-snug text-faint">Lower keeps more of the original lighting and reflections on the surface; higher fully replaces the finish.</p>
        <Field label="Extra prompt">
          <textarea
            value={s.extraPrompt}
            onChange={(e) => set({ extraPrompt: e.target.value })}
            rows={2}
            placeholder="e.g. warm late-afternoon light, tropical modern"
            className={cx(inputClass, "h-auto resize-none py-1.5 leading-snug")}
          />
        </Field>
      </Section>

      <Section title="Structure lock">
        <Slider label="Line lock (Canny ControlNet)" value={s.lineStrength} min={0} max={1.5} step={0.05} onChange={(v) => set({ lineStrength: v })} format={(v) => v.toFixed(2)} />
        <Toggle label="Depth lock" hint="Depth Anything 3 → depth ControlNet keeps new materials on the right perspective planes. Adds RAM and time on CPU." checked={s.useDepth} onChange={(v) => set({ useDepth: v })} />
        {s.useDepth && <Slider label="Depth strength" value={s.depthStrength} min={0.1} max={1.2} step={0.05} onChange={(v) => set({ depthStrength: v })} format={(v) => v.toFixed(2)} />}
        <p className="text-[11px] leading-snug text-faint">Pixels outside the surface masks are always composited back from the original, so walls, openings and columns cannot move regardless of these settings.</p>
      </Section>

      <Section title="Output">
        <Toggle label="4K upscale" hint={`ESRGAN ${models.upscaleModel ?? "(none installed)"}${s.profile === "studio" && models.hasUltimateUpscale ? " + Ultimate SD Upscale" : ""}`} checked={s.upscale} onChange={(v) => set({ upscale: v })} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Final long side">
            <Select value={String(s.targetLongSide)} onChange={(v) => set({ targetLongSide: Number(v) })} options={[{ value: "2560", label: "2560 px" }, { value: "3840", label: "3840 px (4K UHD)" }, { value: "4096", label: "4096 px (DCI 4K)" }]} />
          </Field>
          <Field label="Diffusion size">
            <Select
              value={String(s.workLongSide)}
              onChange={(v) => set({ workLongSide: Number(v) })}
              options={(s.profile === "lite" ? [512, 640, 768, 896, 1024] : [1024, 1152, 1344, 1536]).map((n) => ({ value: String(n), label: `${n} px` }))}
            />
          </Field>
        </div>
        <Field label="Seed">
          <div className="flex gap-1.5">
            <NumberInput value={s.seed} min={-1} onChange={(v) => set({ seed: Math.floor(v) })} />
            <Button size="md" title="Random each render" onClick={() => set({ seed: -1 })} className={cx(s.seed === -1 && "border-accent text-accent")}>
              <Dices size={14} />
            </Button>
          </div>
        </Field>
        <p className="-mt-1 text-[11px] text-faint">{s.seed === -1 ? "Random seed per render." : "Fixed seed: re-renders are repeatable."}</p>
      </Section>

      <Section
        title="Advanced"
        aside={
          <button className="flex items-center gap-1 text-xs text-mute hover:text-ink" onClick={() => setAdvanced(!advanced)}>
            {advanced ? "Hide" : "Show"} <ChevronDown size={12} className={cx("transition", advanced && "rotate-180")} />
          </button>
        }
      >
        {advanced && (
          <>
            <Toggle label="LCM LoRA (fast sampling)" checked={s.useLcm} onChange={(v) => set({ useLcm: v, ...(v ? { steps: 6, cfg: 1.5, sampler: "lcm", scheduler: "sgm_uniform" } : { steps: 25, cfg: 6, sampler: "dpmpp_2m", scheduler: "karras" }) })} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Steps">
                <NumberInput value={s.steps} min={1} max={80} onChange={(v) => set({ steps: Math.round(v) })} />
              </Field>
              <Field label="CFG">
                <NumberInput value={s.cfg} min={1} max={15} step={0.5} onChange={(v) => set({ cfg: v })} />
              </Field>
              <Field label="Sampler">
                <Select value={s.sampler} onChange={(v) => set({ sampler: v })} options={samplers.map((x) => ({ value: x, label: x }))} />
              </Field>
              <Field label="Scheduler">
                <Select value={s.scheduler} onChange={(v) => set({ scheduler: v })} options={schedulers.map((x) => ({ value: x, label: x }))} />
              </Field>
              <Field label="Mask grow">
                <NumberInput value={s.maskGrow} min={0} max={40} suffix="px" onChange={(v) => set({ maskGrow: Math.round(v) })} />
              </Field>
              <Field label="Edge feather">
                <NumberInput value={s.maskFeather} min={0} max={40} suffix="px" onChange={(v) => set({ maskFeather: Math.round(v) })} />
              </Field>
            </div>
            <Field label="Negative prompt">
              <textarea value={s.negativePrompt} onChange={(e) => set({ negativePrompt: e.target.value })} rows={3} className={cx(inputClass, "h-auto resize-none py-1.5 text-xs leading-snug")} />
            </Field>
          </>
        )}
      </Section>
    </div>
  );
}

function ModelStatus({ models, useDepth, useLcm }: { models: ReturnType<typeof resolveModels>; useDepth: boolean; useLcm: boolean }) {
  const rows: { label: string; ok: boolean; value: string | null; needed: boolean }[] = [
    { label: "Checkpoint", ok: !!models.checkpoint, value: models.checkpoint, needed: true },
    { label: "LCM LoRA", ok: !!models.lcmLora, value: models.lcmLora, needed: useLcm },
    { label: "Line ControlNet", ok: !!models.lineControlNet, value: models.lineControlNet, needed: true },
    { label: "Depth lock", ok: !!(models.depthControlNet && models.depthModel), value: models.depthModel, needed: useDepth },
    { label: "IP-Adapter", ok: !!(models.hasIpAdapter && models.ipadapter && models.clipVision), value: models.ipadapter, needed: true },
    { label: "SAM3 auto-detect", ok: !!(models.hasSam3 && models.sam), value: models.sam, needed: false },
    { label: "4K upscaler", ok: !!models.upscaleModel, value: models.upscaleModel, needed: false },
  ];
  const missing = rows.filter((r) => !r.ok && r.needed).length;
  return (
    <div className="rounded-lg border border-line">
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2 px-2.5 py-1.5 text-xs" title={r.value ?? "Not installed"}>
            {r.ok ? <Check size={13} className="shrink-0 text-ok" /> : <X size={13} className={cx("shrink-0", r.needed ? "text-danger" : "text-faint")} />}
            <span className={cx("shrink-0", !r.needed && !r.ok && "text-faint")}>{r.label}</span>
            <span className="ml-auto truncate text-[11px] text-faint">{r.ok ? r.value?.replace(/\.(safetensors|pth)$/, "") : r.needed ? "missing" : "optional"}</span>
          </li>
        ))}
      </ul>
      <button onClick={() => useStore.setState({ modal: "models" })} className={cx("w-full border-t border-line px-2.5 py-1.5 text-left text-xs font-medium hover:bg-paper", missing ? "text-danger" : "text-accent")}>
        {missing ? `${missing} required model${missing > 1 ? "s" : ""} missing → Model Manager` : "Open Model Manager"}
      </button>
    </div>
  );
}
