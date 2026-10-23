"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { refreshDoctor, toast, useStore } from "@/lib/store";
import { formatBytes } from "@/lib/models-catalog";
import { Button, cx, Field, TextInput } from "./ui";

export function SettingsDialog() {
  const doctor = useStore((s) => s.doctor);
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/config").then(async (r) => {
      const c = await r.json();
      setUrl(c.comfyUrl);
      setPath(c.comfyPath);
    });
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ comfyUrl: url, comfyPath: path }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      await refreshDoctor(true);
      toast(useStore.getState().doctor?.online ? "Connected to ComfyUI" : "Saved, but ComfyUI is not reachable at that URL", useStore.getState().doctor?.online ? "success" : "error");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div className={cx("rounded-lg p-3 text-[13px]", doctor?.online ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900")}>
        {doctor?.online ? (
          <>
            <div className="font-medium">ComfyUI {doctor.version} connected</div>
            <div className="mt-0.5 text-xs opacity-80">
              {doctor.device?.type === "cuda" ? `GPU · ${doctor.device.name} · ${formatBytes(doctor.device.vramTotal)} VRAM` : `CPU inference · ${formatBytes(doctor.ramFree ?? 0)} of ${formatBytes(doctor.ramTotal ?? 0)} RAM free`}
              {" · "}recommended profile: <b>{doctor.recommendedProfile === "studio" ? "Studio" : "Lite"}</b>
            </div>
          </>
        ) : (
          <>
            <div className="font-medium">ComfyUI is not reachable</div>
            <div className="mt-1 text-xs opacity-80">
              Start it from its folder, e.g. <code className="rounded bg-white/70 px-1">python main.py --listen 127.0.0.1</code> (add <code className="rounded bg-white/70 px-1">--cpu</code> without an NVIDIA GPU). No CORS flags are needed: Strata proxies all requests.
            </div>
          </>
        )}
      </div>
      <Field label="ComfyUI URL" hint="Can point at another machine on your LAN, e.g. a GPU workstation.">
        <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8188" />
      </Field>
      <Field label="ComfyUI folder" hint="Where Model Manager writes downloads (contains main.py and models/).">
        <TextInput value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\ComfyUI" />
      </Field>
      <div className="flex gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          {busy && <Loader2 size={13} className="animate-spin" />} Save &amp; connect
        </Button>
        <Button variant="ghost" onClick={() => void refreshDoctor(true)}>
          <RefreshCw size={13} /> Re-check
        </Button>
      </div>
      <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
        Projects, masks, references and renders are stored in this browser (IndexedDB) and never leave your machine except to your own ComfyUI.
      </p>
    </div>
  );
}
