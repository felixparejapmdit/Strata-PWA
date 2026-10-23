import type { LayerId } from "../types";
import { LAYER_INFO } from "../buckets";
import { Graph, type ApiPrompt } from "./graph";

export interface SegmentationRequest {
  /** Uploaded image reference, e.g. "strata/abc_base.png". */
  image: string;
  samCheckpoint: string;
  layers: LayerId[];
  prefix: string;
  /** SAM decoder refinement passes per detection; 1 is much cheaper on CPU. */
  refineIterations?: number;
}

export interface SegmentationGraph {
  prompt: ApiPrompt;
  /** SaveImage node id → layer it produces. */
  outputs: Record<string, LayerId>;
  stages: Record<string, string>;
}

/**
 * One SAM3 detection per layer. Each layer's prompt lists several concepts with per-concept
 * detection caps ("wall:8"), which SAM3 unions into a single mask.
 */
export function buildSegmentationGraph(req: SegmentationRequest): SegmentationGraph {
  const g = new Graph();
  const outputs: Record<string, LayerId> = {};
  const stages: Record<string, string> = {};

  const sam = g.add("CheckpointLoaderSimple", { ckpt_name: req.samCheckpoint }, "SAM3");
  stages[sam] = "Loading SAM3";
  const image = g.add("LoadImage", { image: req.image }, "Base image");

  for (const layer of req.layers) {
    const info = LAYER_INFO[layer];
    const text = g.add("CLIPTextEncode", { text: info.samPrompt, clip: Graph.out(sam, 1) }, `${info.label} concepts`);
    const detect = g.add(
      "SAM3_Detect",
      {
        model: Graph.out(sam, 0),
        image: Graph.out(image, 0),
        conditioning: Graph.out(text, 0),
        threshold: info.threshold,
        refine_iterations: req.refineIterations ?? 2,
        individual_masks: false,
      },
      `Detect ${info.label}`,
    );
    stages[detect] = `Detecting ${info.label.toLowerCase()}`;
    const asImage = g.add("MaskToImage", { mask: Graph.out(detect, 0) });
    const save = g.add("SaveImage", { images: Graph.out(asImage, 0), filename_prefix: `${req.prefix}_${layer}` }, `Mask ${info.label}`);
    outputs[save] = layer;
  }
  return { prompt: g.prompt, outputs, stages };
}
