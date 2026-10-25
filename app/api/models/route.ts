import { getConfig } from "@/lib/server/config";
import { MODEL_CATALOG, CUSTOM_NODES } from "@/lib/models-catalog";
import { cancelJob, getJob, isInstalled, partialBytes, startConversion, startModelDownload, startNodeInstall } from "@/lib/server/downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { comfyPath } = getConfig();
  return Response.json({
    comfyPath,
    models: MODEL_CATALOG.map((m) => {
      const installed = isInstalled(comfyPath, m);
      return { ...m, installed, job: getJob(m.id) ?? null, partial: installed ? 0 : partialBytes(comfyPath, m) };
    }),
    nodes: CUSTOM_NODES.map((n) => ({ ...n, job: getJob(`node:${n.id}`) ?? null })),
  });
}

/** Body: { model: id } or { node: id }. Only catalogue entries can be installed. */
export async function POST(req: Request) {
  const { comfyPath } = getConfig();
  if (!comfyPath) return Response.json({ error: "Set the ComfyUI folder in Settings first." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { model?: string; node?: string };
  if (body.model) {
    const m = MODEL_CATALOG.find((x) => x.id === body.model);
    if (!m) return Response.json({ error: "Unknown model" }, { status: 404 });
    if (m.convertFrom) {
      const source = MODEL_CATALOG.find((x) => x.id === m.convertFrom)!;
      if (!isInstalled(comfyPath, source)) return Response.json({ error: `Install "${source.name}" first.` }, { status: 400 });
      startConversion(comfyPath, m, source);
    } else {
      startModelDownload(comfyPath, m);
    }
    return Response.json({ ok: true, job: getJob(m.id) });
  }
  if (body.node) {
    const n = CUSTOM_NODES.find((x) => x.id === body.node);
    if (!n) return Response.json({ error: "Unknown node pack" }, { status: 404 });
    startNodeInstall(comfyPath, n);
    return Response.json({ ok: true, job: getJob(`node:${n.id}`) });
  }
  return Response.json({ error: "Specify model or node" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) cancelJob(id);
  return Response.json({ ok: true });
}
