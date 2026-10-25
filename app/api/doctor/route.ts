import { createHash } from "node:crypto";
import { getConfig } from "@/lib/server/config";
import { USED_NODES } from "@/lib/workflow/profiles";
import type { ObjectInfo } from "@/lib/workflow/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SystemStats {
  system: { os: string; ram_total: number; ram_free: number; comfyui_version: string; argv?: string[] };
  devices: { name: string; type: string; vram_total: number; vram_free: number }[];
}

const cache = globalThis as unknown as { __strataObjectInfo?: { at: number; url: string; data: ObjectInfo } };

/**
 * ComfyUI health, hardware, and the schemas of the nodes Strata uses. Schemas are ~33 KB and
 * rarely change, so they are sent only when the caller's `have` key differs from `infoKey`.
 */
export async function GET(req: Request) {
  const { comfyUrl, comfyPath } = getConfig();
  const params = new URL(req.url).searchParams;
  const refresh = params.has("refresh");
  try {
    const stats = (await (await fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(4000), cache: "no-store" })).json()) as SystemStats;
    let full = cache.__strataObjectInfo;
    if (refresh || !full || full.url !== comfyUrl || Date.now() - full.at > 30_000) {
      const data = (await (await fetch(`${comfyUrl}/object_info`, { signal: AbortSignal.timeout(20_000), cache: "no-store" })).json()) as ObjectInfo;
      full = cache.__strataObjectInfo = { at: Date.now(), url: comfyUrl, data };
    }
    const objectInfo: ObjectInfo = {};
    for (const n of USED_NODES) if (full.data[n]) objectInfo[n] = full.data[n];
    const infoKey = createHash("sha1").update(JSON.stringify(objectInfo)).digest("hex").slice(0, 16);

    const dev = stats.devices[0];
    const cuda = !!dev && dev.type === "cuda";
    const vramGb = dev ? dev.vram_total / 1024 ** 3 : 0;
    return Response.json({
      online: true,
      comfyUrl,
      comfyPath,
      version: stats.system.comfyui_version,
      device: dev ? { name: dev.name, type: dev.type, vramTotal: dev.vram_total, vramFree: dev.vram_free } : null,
      ramTotal: stats.system.ram_total,
      ramFree: stats.system.ram_free,
      argv: stats.system.argv ?? [],
      recommendedProfile: cuda && vramGb >= 11 ? "studio" : "lite",
      infoKey,
      ...(params.get("have") === infoKey ? {} : { objectInfo }),
    });
  } catch (e) {
    return Response.json({ online: false, comfyUrl, comfyPath, error: e instanceof Error ? e.message : String(e) });
  }
}
