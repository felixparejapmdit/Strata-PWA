import fs from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only Strata's own embedding files, top level, no path components.
const NAME = /^strata_emb_[A-Za-z0-9_-]+\.ipadpt$/;
const PREFIX = /^strata_emb_[A-Za-z0-9_-]+$/;

/** GET ?check=a,b → which embedding files already exist in ComfyUI's input folder. */
export async function GET(req: Request) {
  const { comfyPath } = getConfig();
  const names = (new URL(req.url).searchParams.get("check") ?? "").split(",").filter((n) => NAME.test(n));
  const exists = Object.fromEntries(names.map((n) => [n, !!comfyPath && fs.existsSync(path.join(comfyPath, "input", n))]));
  return Response.json({ available: !!comfyPath, exists });
}

/**
 * POST { promote: [prefixes] } → for each prefix, copies the newest `{prefix}_NNNNN.ipadpt` that
 * ComfyUI saved to output/ into input/ as `{prefix}.ipadpt`, where IPAdapterLoadEmbeds reads it.
 * Requires ComfyUI on this machine (its folder is known).
 */
export async function POST(req: Request) {
  const { comfyPath } = getConfig();
  if (!comfyPath) return Response.json({ error: "ComfyUI folder unknown; set it in Settings." }, { status: 400 });
  const { promote = [] } = (await req.json().catch(() => ({}))) as { promote?: string[] };
  const outDir = path.join(comfyPath, "output");
  const missing: string[] = [];
  for (const prefix of promote) {
    if (!PREFIX.test(prefix)) return Response.json({ error: `Invalid embedding prefix: ${prefix}` }, { status: 400 });
    const saved = fs
      .readdirSync(outDir)
      .filter((f) => f.startsWith(`${prefix}_`) && /_\d{5}\.ipadpt$/.test(f))
      .sort();
    const newest = saved.at(-1);
    if (!newest) {
      missing.push(prefix);
      continue;
    }
    fs.copyFileSync(path.join(outDir, newest), path.join(comfyPath, "input", `${prefix}.ipadpt`));
  }
  return Response.json({ ok: missing.length === 0, missing });
}
