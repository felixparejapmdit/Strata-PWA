"use client";

import { AlertTriangle } from "lucide-react";
import { useStore } from "@/lib/store";
import { formatBytes } from "@/lib/models-catalog";
import { globalFp8Flag, ipAdapterDtypeConflict } from "@/lib/pipeline";
import { PROFILES, resolveModels } from "@/lib/workflow/profiles";

const GB = 1024 ** 3;
const RECOMMENDED = "python main.py --listen 127.0.0.1 --cpu";

/**
 * Explains what makes CPU renders fail or crawl. On CPU the safe setup is plain --cpu plus the
 * Model Manager conversions: Strata then stores only the render UNet in fp8, per model, because
 * global dtype flags each break something (--fp16-unet: IP-Adapter; --fp8_e4m3fn-unet: SAM3).
 */
export function PerfHints() {
  const d = useStore((s) => s.doctor);
  const settings = useStore((s) => s.project?.settings);
  if (!d?.online || d.device?.type !== "cpu") return null;
  const fp16Conflict = ipAdapterDtypeConflict();
  const fp8Global = globalFp8Flag();
  const models = settings ? resolveModels(settings.profile, settings, d.objectInfo ?? null) : null;
  const canSplit = !!settings && settings.profile === "lite" && models?.checkpoint === PROFILES.lite.split?.from;
  const needsSplit = canSplit && !models?.split && !fp8Global;
  const lowRam = (d.ramFree ?? Infinity) < 1.5 * GB;
  const clipOptions = d.objectInfo?.CLIPVisionLoader?.input.required?.clip_name;
  const clipList = (Array.isArray(clipOptions?.[0]) ? clipOptions?.[0] : (clipOptions?.[1]?.options as string[] | undefined)) as string[] | undefined;
  const fp32Clip = !!clipList?.length && !clipList.some((c) => /fp16/i.test(c));
  if (!fp16Conflict && !fp8Global && !needsSplit && !lowRam && !fp32Clip) return null;
  const openModels = () => useStore.setState({ modal: "models" });
  return (
    <div className="mx-4 mt-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
      <div className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle size={13} /> {fp16Conflict ? "Reference images will fail with this ComfyUI" : fp8Global ? "Auto-detect will fail with this ComfyUI" : "Renders will be slow on this setup"}
      </div>
      {(fp16Conflict || fp8Global) && (
        <p>
          ComfyUI was started with <code className="rounded bg-white/70 px-1">{fp16Conflict ? "--fp16-unet" : "--fp8_e4m3fn-unet"}</code>, which on CPU breaks{" "}
          {fp16Conflict ? "IP-Adapter (fp16/fp32 mismatch)" : "SAM3 Auto-detect (no fp8 convolutions on CPU)"}. Restart it with plain <code className="rounded bg-white/70 px-1">--cpu</code>; Strata stores the render model in fp8 by itself:
          <code className="mt-1 block rounded bg-white/70 px-1.5 py-1">{RECOMMENDED}</code>
        </p>
      )}
      {needsSplit && (
        <p>
          The full checkpoint in fp32 can run an 8 GB machine out of memory. In <button className="font-medium underline" onClick={openModels}>Model manager</button>, click <b>Convert</b> on the Realistic Vision <b>UNet</b> and <b>text encoder</b>: renders then store the UNet in fp8 (a quarter of the memory, still computed in fp32).
        </p>
      )}
      {fp32Clip && (
        <p>
          Loading the full-precision CLIP Vision encoder briefly needs about 3.8 GB. In <button className="font-medium underline" onClick={openModels}>Model manager</button>, click <b>Convert</b> on the fp16 encoder; results are identical.
        </p>
      )}
      {lowRam && (
        <p>
          Only {formatBytes(d.ramFree ?? 0)} of RAM is free, so Windows swaps model weights to disk on every step. Close heavy apps (editors, browser tabs, a second ComfyUI) before rendering.
        </p>
      )}
    </div>
  );
}
