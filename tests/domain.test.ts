import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBoq, measuredAreas, VAT_RATE } from "../lib/boq";
import { MATERIALS, findMaterial, suggestMaterial } from "../lib/materials";
import { buildGuidelines } from "../lib/guidelines";
import { analyzeTexture } from "../lib/texture";
import { renderProposalHtml } from "../lib/proposal";
import type { ProjectMeta, TextureAnalysis } from "../lib/types";

const meta: ProjectMeta = { client: "", location: "", preparedBy: "", zone: "living", floorArea: 25, ceilingHeight: 3, perimeter: 20, openingsPct: 10, furniturePieces: 2, contingencyPct: 10 };
const fake = (family: TextureAnalysis["family"]): TextureAnalysis => ({ family, confidence: 0.8, swatch: "#cccccc", tone: "light", warmth: "neutral", features: {} });

test("areas: walls are perimeter × height less openings", () => {
  const a = measuredAreas(meta);
  assert.equal(a.walls, 20 * 3 * 0.9);
  assert.equal(measuredAreas({ ...meta, perimeter: 0 }).perimeter, 20);
});

test("BOQ totals add up with contingency and 12% VAT", () => {
  const boq = computeBoq(meta, { floor: findMaterial("sintered-stone-12"), walls: findMaterial("anti-mold-paint") });
  assert.equal(boq.sections.length, 2);
  const floor = boq.sections[0];
  assert.equal(floor.lines[0].qty, 28); // 25 m² + 12% wastage
  const sum = boq.sections.reduce((s, x) => s + x.subtotal, 0);
  assert.ok(Math.abs(boq.subtotal - sum) < 0.01);
  assert.ok(Math.abs(boq.vat - (boq.subtotal + boq.contingency) * VAT_RATE) < 0.01);
  assert.ok(Math.abs(boq.total - (boq.subtotal + boq.contingency + boq.vat)) < 0.01);
});

test("wet-zone porcelain always carries epoxy grout in the BOQ", () => {
  const boq = computeBoq({ ...meta, zone: "bathroom" }, { floor: findMaterial("slim-porcelain-6") });
  assert.ok(boq.sections[0].lines.some((l) => /epoxy grout/i.test(l.description)));
});

test("material rules: stone in a living room → sintered stone", () => {
  assert.equal(suggestMaterial("floor", "living", fake("stone")).materialId, "sintered-stone-12");
});

test("material rules: any bathroom floor → wet-rated slim porcelain", () => {
  for (const fam of ["stone", "wood", "tile", "plain"] as const) {
    const id = suggestMaterial("floor", "bathroom", fake(fam)).materialId;
    assert.ok(findMaterial(id)!.wetOk, `${fam} → ${id} must be wet-rated`);
  }
  assert.equal(suggestMaterial("floor", "bathroom", fake("stone")).materialId, "slim-porcelain-6");
});

test("material rules: parking and office floors → PU-cement screed", () => {
  assert.equal(suggestMaterial("floor", "parking", fake("concrete")).materialId, "pu-cement-screed");
  assert.equal(suggestMaterial("floor", "office", undefined).materialId, "pu-cement-screed");
});

test("every suggestion is a real catalogue entry for that surface", () => {
  for (const bucket of ["floor", "walls", "ceiling", "furniture"] as const)
    for (const zone of ["living", "bathroom", "kitchen", "office", "parking", "outdoor-covered"] as const)
      for (const fam of ["stone", "wood", "tile", "concrete", "plain", "fabric", "metal"] as const) {
        const m = findMaterial(suggestMaterial(bucket, zone, fake(fam)).materialId);
        assert.ok(m, `${bucket}/${zone}/${fam}`);
        assert.ok(m!.buckets.includes(bucket), `${m!.id} not valid for ${bucket}`);
      }
});

test("guidelines warn against floating floors over concrete when a wood-look floor is chosen", () => {
  const g = buildGuidelines("living", { floor: findMaterial("spc-plank") });
  assert.ok(g.flatMap((x) => x.items).some((i) => /floating floors/i.test(i)));
});

function synth(w: number, h: number, fn: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  return { data, width: w, height: h };
}

test("texture: flat colour reads as plain", () => {
  assert.equal(analyzeTexture(synth(96, 96, () => [235, 233, 228])).family, "plain");
});

test("texture: warm directional grain reads as wood", () => {
  const a = analyzeTexture(synth(128, 128, (x, y) => {
    const v = 140 + 40 * Math.sin(y * 0.9 + Math.sin(x * 0.05) * 2);
    return [v + 40, v * 0.75, v * 0.45];
  }));
  assert.equal(a.family, "wood");
  assert.equal(a.warmth, "warm");
});

test("texture: grout grid reads as tile", () => {
  const a = analyzeTexture(synth(128, 128, (x, y) => (x % 32 < 2 || y % 32 < 2 ? [90, 90, 90] : [210, 208, 204])));
  assert.equal(a.family, "tile");
});

test("proposal HTML escapes user text and includes every section", () => {
  const html = renderProposalHtml({
    project: { name: "<script>x</script> Villa", meta, zoneLabel: "Living room", date: "1 Jan 2026" },
    images: { hero: "data:image/jpeg;base64,AA", before: "data:,", after: "data:," },
    schedule: [{ bucket: "floor", label: "Floor", material: MATERIALS[0], swatches: [], colour: "#ffffff" }],
    boq: computeBoq(meta, { floor: MATERIALS[0] }),
    guidelines: buildGuidelines("living", { floor: MATERIALS[0] }),
    render: { seed: 1, profile: "lite", width: 3840, height: 2560 },
    paper: "A4",
  });
  assert.ok(!html.includes("<script>x</script>"));
  for (const s of ["Before &amp; after", "Material mood board", "Bill of quantities", "Tropical installation guidelines", "VAT (12%)"]) assert.ok(html.includes(s), s);
});
