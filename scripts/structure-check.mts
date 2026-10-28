// Measures whether a render kept the room's geometry: runs Depth Anything 3 (through ComfyUI) on
// the original and the render and compares the depth maps, overall and per vertical third
// (left wall / centre / right wall). Moved walls or corners show up as low correlation.
//
//   npx tsx scripts/structure-check.mts <original.png> <render.png>
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const COMFY = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";
const [origPath, renderPath] = process.argv.slice(2);
if (!origPath || !renderPath) throw new Error("usage: structure-check <original> <render>");

async function upload(file: string): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([fs.readFileSync(file)], { type: "image/png" }), `check_${Date.now()}_${path.basename(file)}`);
  form.append("subfolder", "strata");
  form.append("overwrite", "true");
  const j = (await (await fetch(`${COMFY}/upload/image`, { method: "POST", body: form })).json()) as { name: string; subfolder: string };
  return `${j.subfolder}/${j.name}`;
}

async function depthOf(image: string): Promise<Buffer> {
  const prompt = {
    1: { class_type: "LoadImage", inputs: { image } },
    2: { class_type: "LoadDA3Model", inputs: { model_name: "depth_anything_3_small.safetensors", weight_dtype: "default" } },
    3: { class_type: "DA3Inference", inputs: { da3_model: ["2", 0], image: ["1", 0], resolution: 504, resize_method: "upper_bound_resize", mode: "mono" } },
    4: { class_type: "DA3Render", inputs: { da3_geometry: ["3", 0], output: "depth", "output.normalization": "min_max", "output.apply_sky_clip": false } },
    5: { class_type: "SaveImage", inputs: { images: ["4", 0], filename_prefix: `strata/depthcheck_${Date.now()}` } },
  };
  const { prompt_id } = (await (await fetch(`${COMFY}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) })).json()) as { prompt_id: string };
  for (;;) {
    const h = (await (await fetch(`${COMFY}/history/${prompt_id}`)).json()) as Record<string, { status: { completed: boolean; status_str: string }; outputs: Record<string, { images: { filename: string; subfolder: string }[] }> }>;
    const e = h[prompt_id];
    if (e?.status.status_str === "error") throw new Error("depth job failed");
    if (e?.status.completed) {
      const img = e.outputs["5"].images[0];
      return Buffer.from(await (await fetch(`${COMFY}/view?filename=${img.filename}&subfolder=${img.subfolder}&type=output`)).arrayBuffer());
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const W = 192, H = 128;
const gray = async (png: Buffer) => new Float64Array(await sharp(png).resize(W, H, { fit: "fill" }).greyscale().raw().toBuffer());

function pearson(a: Float64Array, b: Float64Array, x0: number, x1: number): number {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let y = 0; y < H; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * W + x, u = a[i], v = b[i];
      n++; sa += u; sb += v; saa += u * u; sbb += v * v; sab += u * v;
    }
  const cov = sab / n - (sa / n) * (sb / n);
  return cov / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2));
}

const [dA, dB] = [await depthOf(await upload(origPath)), await depthOf(await upload(renderPath))];
const [a, b] = [await gray(dA), await gray(dB)];
const thirds = [0, W / 3, (2 * W) / 3, W].map(Math.round);
console.log(`depth correlation (1.00 = identical geometry)`);
console.log(`  whole image : ${pearson(a, b, 0, W).toFixed(3)}`);
["left third ", "centre third", "right third"].forEach((label, i) => console.log(`  ${label}: ${pearson(a, b, thirds[i], thirds[i + 1]).toFixed(3)}`));
