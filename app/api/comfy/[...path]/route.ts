import { getConfig } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin proxy to ComfyUI. The browser never talks to :8188 directly, so ComfyUI needs no
 * --enable-cors-header and its origin check never fires. Only the endpoints Strata uses pass.
 */
const ALLOWED = [/^prompt$/, /^queue$/, /^history(\/[\w-]+)?$/, /^view$/, /^upload\/image$/, /^object_info(\/\w+)?$/, /^system_stats$/, /^interrupt$/, /^free$/];

async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const sub = path.join("/");
  if (!ALLOWED.some((re) => re.test(sub))) return Response.json({ error: `Endpoint /${sub} is not proxied` }, { status: 404 });

  const { comfyUrl } = getConfig();
  const target = `${comfyUrl}/${sub}${new URL(req.url).search}`;
  const headers = new Headers();
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  try {
    const res = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      cache: "no-store",
      signal: AbortSignal.timeout(sub === "upload/image" ? 120_000 : 30_000),
    });
    const out = new Headers();
    for (const h of ["content-type", "content-length", "content-disposition"]) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    out.set("cache-control", "no-store");
    return new Response(res.body, { status: res.status, headers: out });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `ComfyUI unreachable at ${comfyUrl}`, detail: reason, offline: true }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST };
