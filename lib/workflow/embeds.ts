import { Graph, type ApiPrompt, type Link } from "./graph";

/** Nodes required for pre-encoded IP-Adapter embeddings (all from ComfyUI_IPAdapter_plus). */
export const EMBED_NODES = ["IPAdapterEncoder", "IPAdapterCombineEmbeds", "IPAdapterSaveEmbeds", "IPAdapterLoadEmbeds", "IPAdapterEmbeds"];

export interface EmbedFiles {
  /** File names in ComfyUI's input folder (top level, so names match on every OS). */
  pos: string;
  neg: string;
}

export interface EncodeItem {
  /** Unique, filename-safe id for this reference set. */
  key: string;
  refs: string[];
}

/** ComfyUI's SaveEmbeds writes `{prefix}_{counter:05}.ipadpt`; a fresh prefix always gets 00001. */
export const embedFileName = (prefix: string) => `${prefix}_00001.ipadpt`;

/**
 * Encodes reference images into IP-Adapter embeddings in a job of their own, so the CLIP Vision
 * encoder (~1.3–2.5 GB) is never resident together with the diffusion models. Multiple
 * references are averaged exactly as IPAdapterAdvanced's combine_embeds="average" does.
 */
export function buildEncodeGraph(req: { ipadapter: string; clipVision: string; items: EncodeItem[] }): {
  prompt: ApiPrompt;
  files: Record<string, EmbedFiles>;
  stages: Record<string, string>;
} {
  const g = new Graph();
  const stages: Record<string, string> = {};
  const files: Record<string, EmbedFiles> = {};
  const ipa = g.add("IPAdapterModelLoader", { ipadapter_file: req.ipadapter }, "IP-Adapter");
  const cv = g.add("CLIPVisionLoader", { clip_name: req.clipVision }, "CLIP Vision");
  stages[cv] = "Loading image encoder";
  for (const item of req.items) {
    let img: Link = Graph.out(g.add("LoadImage", { image: item.refs[0] }), 0);
    for (const extra of item.refs.slice(1)) {
      img = Graph.out(g.add("ImageBatch", { image1: img, image2: Graph.out(g.add("LoadImage", { image: extra }), 0) }), 0);
    }
    const enc = g.add("IPAdapterEncoder", { ipadapter: Graph.out(ipa, 0), image: img, weight: 1, clip_vision: Graph.out(cv, 0) }, "Encode references");
    stages[enc] = "Encoding reference materials";
    const avg = g.add("IPAdapterCombineEmbeds", { embed1: Graph.out(enc, 0), method: "average" });
    const pos = `strata_emb_${item.key}_pos`;
    const neg = `strata_emb_${item.key}_neg`;
    g.add("IPAdapterSaveEmbeds", { embeds: Graph.out(avg, 0), filename_prefix: pos });
    g.add("IPAdapterSaveEmbeds", { embeds: Graph.out(enc, 1), filename_prefix: neg });
    files[item.key] = { pos: embedFileName(pos), neg: embedFileName(neg) };
  }
  return { prompt: g.prompt, files, stages };
}
