"use client";

import { AlertTriangle } from "lucide-react";
import { useStore } from "@/lib/store";
import { formatBytes } from "@/lib/models-catalog";
import { ipAdapterDtypeConflict } from "@/lib/pipeline";

const GB = 1024 ** 3;

/**
 * Explains what makes CPU renders fail or crawl: a ComfyUI flag that breaks IP-Adapter, a CLIP
 * Vision file that spikes memory, and too little free RAM (weights are then swapped to disk).
 */
export function PerfHints() {
  const d = useStore((s) => s.doctor);
  if (!d?.online || d.device?.type !== "cpu") return null;
  const conflict = ipAdapterDtypeConflict();
  // fp8 storage quarters UNet/ControlNet memory; IP-Adapter still computes in fp32 on CPU (verified).
  const fullWeights = !conflict && !(d.argv ?? []).some((a) => /^--fp8_e4m3fn-unet$/.test(a));
  const lowRam = (d.ramFree ?? Infinity) < 1.5 * GB;
  const clipOptions = d.objectInfo?.CLIPVisionLoader?.input.required?.clip_name;
  const clipList = (Array.isArray(clipOptions?.[0]) ? clipOptions?.[0] : (clipOptions?.[1]?.options as string[] | undefined)) as string[] | undefined;
  const fp32Clip = !!clipList?.length && !clipList.some((c) => /fp16/i.test(c));
  if (!conflict && !fullWeights && !lowRam && !fp32Clip) return null;
  return (
    <div className="mx-4 mt-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
      <div className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle size={13} /> {conflict ? "Reference images will fail with this ComfyUI" : "Renders will be slow on this setup"}
      </div>
      {conflict && (
        <p>
          ComfyUI was started with <code className="rounded bg-white/70 px-1">--fp16-unet</code>. On CPU that breaks IP-Adapter (fp16/fp32 mismatch). Restart it with fp8 storage instead:
          <code className="mt-1 block rounded bg-white/70 px-1.5 py-1">python main.py --listen 127.0.0.1 --cpu --fp8_e4m3fn-unet</code>
        </p>
      )}
      {fullWeights && (
        <p>
          ComfyUI keeps the diffusion model and ControlNet in full precision, which can run an 8 GB machine out of memory (crashes or very slow renders). Restart it with fp8 weight storage; math still runs in fp32 and reference images keep working:
          <code className="mt-1 block rounded bg-white/70 px-1.5 py-1">python main.py --listen 127.0.0.1 --cpu --fp8_e4m3fn-unet</code>
        </p>
      )}
      {fp32Clip && (
        <p>
          Loading the full-precision CLIP Vision encoder briefly needs about 3.8 GB. In <button className="font-medium underline" onClick={() => useStore.setState({ modal: "models" })}>Model manager</button>, click <b>Convert</b> on the fp16 encoder; results are identical.
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
