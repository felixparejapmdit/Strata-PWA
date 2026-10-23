import { getConfig } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bridges ComfyUI's WebSocket to Server-Sent Events for the browser. JSON messages pass
 * through as-is; binary latent previews are re-encoded as data URLs.
 */
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId");
  if (!clientId || !/^[\w-]{6,64}$/.test(clientId)) return new Response("clientId required", { status: 400 });

  const wsUrl = getConfig().comfyUrl.replace(/^http/, "ws") + `/ws?clientId=${clientId}`;
  const encoder = new TextEncoder();
  let ws: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        try {
          ws?.close();
        } catch {}
        try {
          controller.close();
        } catch {}
      };

      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        send("bridge", JSON.stringify({ status: "error", message: String(e) }));
        close();
        return;
      }
      ws.binaryType = "arraybuffer";
      ws.onopen = () => send("bridge", JSON.stringify({ status: "open" }));
      ws.onerror = () => send("bridge", JSON.stringify({ status: "error", message: "ComfyUI WebSocket error" }));
      ws.onclose = () => {
        send("bridge", JSON.stringify({ status: "closed" }));
        close();
      };
      ws.onmessage = (msg) => {
        if (typeof msg.data === "string") {
          send("comfy", msg.data);
          return;
        }
        const buf = Buffer.from(msg.data as ArrayBuffer);
        if (buf.length < 8) return;
        const type = buf.readUInt32BE(0);
        if (type === 1) {
          const mime = buf.readUInt32BE(4) === 2 ? "image/png" : "image/jpeg";
          send("preview", JSON.stringify({ image: `data:${mime};base64,${buf.subarray(8).toString("base64")}` }));
        } else if (type === 4) {
          const metaLen = buf.readUInt32BE(4);
          const meta = JSON.parse(buf.subarray(8, 8 + metaLen).toString("utf8"));
          const img = buf.subarray(8 + metaLen).toString("base64");
          send("preview", JSON.stringify({ image: `data:${meta.image_type ?? "image/jpeg"};base64,${img}`, promptId: meta.prompt_id, node: meta.node_id }));
        }
      };
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          close();
        }
      }, 15_000);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      try {
        ws?.close();
      } catch {}
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
