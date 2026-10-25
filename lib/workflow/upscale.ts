import { Graph, type ApiPrompt } from "./graph";

export interface UpscaleRequest {
  /** Uploaded preview render (already structure-locked). */
  image: string;
  upscaleModel: string | null;
  width: number;
  height: number;
  prefix: string;
}

/**
 * 4K for a finished render. The preview is already composited over the original, so a pure
 * ESRGAN pass keeps the structure lock: no diffusion runs here.
 */
export function buildUpscaleGraph(req: UpscaleRequest): { prompt: ApiPrompt; output: string; stages: Record<string, string> } {
  const g = new Graph();
  const stages: Record<string, string> = {};
  const src = g.add("LoadImage", { image: req.image }, "Render");
  let img = Graph.out(src, 0);
  if (req.upscaleModel) {
    const model = g.add("UpscaleModelLoader", { model_name: req.upscaleModel }, "ESRGAN");
    const up = g.add("ImageUpscaleWithModel", { upscale_model: Graph.out(model, 0), image: img });
    stages[up] = "Upscaling to 4K";
    img = Graph.out(up, 0);
  }
  const sized = g.add("ImageScale", { image: img, upscale_method: "lanczos", width: req.width, height: req.height, crop: "disabled" });
  const output = g.add("SaveImage", { images: Graph.out(sized, 0), filename_prefix: `${req.prefix}_final` }, "Final 4K");
  stages[output] = "Saving 4K render";
  return { prompt: g.prompt, output, stages };
}
