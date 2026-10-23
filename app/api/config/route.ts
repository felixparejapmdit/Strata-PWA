import { getConfig, setConfig } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getConfig());
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { comfyUrl?: string; comfyPath?: string };
    return Response.json(setConfig({ comfyUrl: body.comfyUrl?.trim(), comfyPath: body.comfyPath?.trim() }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
