import fs from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only Strata's own embedding files, top level, no path components.
const NAME = /^strata_emb_[A-Za-z0-9_-]+\.ipadpt$/;

/** GET ?check=a,b → which embedding files already exist in ComfyUI's input folder. */
export async function GET(req: Request) {
  const { comfyPath } = getConfig();
  const names = (new URL(req.url).searchParams.get("check") ?? "").split(",").filter((n) => NAME.test(n));
  const exists = Object.fromEntries(names.map((n) => [n, !!comfyPath && fs.existsSync(path.join(comfyPath, "input", n))]));
  return Response.json({ available: !!comfyPath, exists });
}

/**
 * POST { promote: [names] } → copies embeddings ComfyUI saved to output/ into input/, where
 * IPAdapterLoadEmbeds reads them. Requires ComfyUI on this machine (its folder is known).
 */
export async function POST(req: Request) {
  const { comfyPath } = getConfig();
  if (!comfyPath) return Response.json({ error: "ComfyUI folder unknown; set it in Settings." }, { status: 400 });
  const { promote = [] } = (await req.json().catch(() => ({}))) as { promote?: string[] };
  const missing: string[] = [];
  for (const name of promote) {
    if (!NAME.test(name)) return Response.json({ error: `Invalid embedding name: ${name}` }, { status: 400 });
    const src = path.join(comfyPath, "output", name);
    if (!fs.existsSync(src)) {
      missing.push(name);
      continue;
    }
    fs.copyFileSync(src, path.join(comfyPath, "input", name));
  }
  return Response.json({ ok: missing.length === 0, missing });
}
