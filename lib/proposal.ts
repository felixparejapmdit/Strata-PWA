import type { Boq } from "./boq";
import { php } from "./boq";
import type { GuidelineGroup } from "./guidelines";
import type { Material } from "./materials";
import type { BucketId, ProjectMeta } from "./types";

export interface ScheduleItem {
  bucket: BucketId;
  label: string;
  material: Material;
  swatches: string[];
  colour: string | null;
}

export interface ProposalPayload {
  project: { name: string; meta: ProjectMeta; zoneLabel: string; date: string };
  images: { hero: string; before: string; after: string };
  schedule: ScheduleItem[];
  boq: Boq;
  guidelines: GuidelineGroup[];
  render: { seed: number; profile: string; width: number; height: number };
  paper: "A4" | "A3";
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Escapes text for a CSS string literal. */
const cssString = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/[<>]/g, "").replace(/["\\]/g, (c) => "\\" + c);

const qty = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 2 });

/**
 * Print-ready HTML for the specification proposal (rendered to PDF by Chrome/Edge).
 * `fontCss` carries an embedded @font-face so rendering never waits on the network.
 */
export function renderProposalHtml(p: ProposalPayload, fontCss = ""): string {
  const { project: pr, boq } = p;
  const m = pr.meta;
  const size = p.paper === "A3" ? "A3 landscape" : "A4 landscape";

  const cover = `
  <section class="cover">
    <img class="hero" src="${p.images.hero}" alt="">
    <div class="shade"></div>
    <div class="cover-text">
      <div class="eyebrow">Material &amp; Specification Proposal</div>
      <h1>${esc(pr.name)}</h1>
      <div class="cover-meta">
        <span>${esc(pr.zoneLabel)}</span>${m.location ? `<span>${esc(m.location)}</span>` : ""}${m.client ? `<span>For ${esc(m.client)}</span>` : ""}<span>${esc(pr.date)}</span>
      </div>
      ${m.preparedBy ? `<div class="prepared">Prepared by ${esc(m.preparedBy)}</div>` : ""}
    </div>
  </section>`;

  const beforeAfter = `
  <section class="page">
    <header><span class="num">01</span><h2>Before &amp; after</h2></header>
    <div class="ba">
      <figure><img src="${p.images.before}" alt=""><figcaption>Existing / base</figcaption></figure>
      <figure><img src="${p.images.after}" alt=""><figcaption>Proposed finishes</figcaption></figure>
    </div>
    <p class="note">Structure-locked render: geometry, doors, windows and columns are reproduced from the base image pixel for pixel; only the specified surfaces were re-finished.
    Render ${p.render.width}×${p.render.height}px · seed ${p.render.seed} · ${esc(p.render.profile)} pipeline.</p>
  </section>`;

  const cards = p.schedule
    .map(
      (s) => `
    <article class="card${s.swatches.length || s.colour ? "" : " plain"}">
      ${
        s.swatches.length || s.colour
          ? `<div class="swatches">
        ${s.swatches.slice(0, 3).map((src) => `<img src="${src}" alt="">`).join("")}
        ${s.colour ? `<div class="chip" style="background:${esc(s.colour)}"><span>${esc(s.colour)}</span></div>` : ""}
      </div>`
          : ""
      }
      <div class="card-body">
        <div class="tag">${esc(s.label)}</div>
        <h3>${esc(s.material.name)}</h3>
        <dl>
          <dt>Specification</dt><dd>${esc(s.material.spec)}</dd>
          <dt>Brands</dt><dd>${esc(s.material.brands)}</dd>
          <dt>Source</dt><dd>${s.material.suppliers.map((x) => `${esc(x.name)} <span class="muted">· ${esc(x.area)}</span>`).join("<br>")}</dd>
        </dl>
        <ul class="tropical">${s.material.tropical.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      </div>
    </article>`,
    )
    .join("");

  const schedule = `
  <section class="page">
    <header><span class="num">02</span><h2>Material mood board &amp; schedule</h2></header>
    <div class="cards">${cards || `<p class="muted">No surfaces specified.</p>`}</div>
  </section>`;

  const rows = boq.sections
    .map(
      (sec) => `
      <tr class="sec"><td colspan="4">${esc(sec.label)}: ${esc(sec.material.name)} <span class="muted">(${qty(sec.netQty)} ${esc(sec.material.unit)} net)</span></td><td class="r">${php(sec.subtotal)}</td></tr>
      ${sec.lines
        .map(
          (l) => `<tr><td>${esc(l.description)}${l.note ? `<span class="muted small">${esc(l.note)}</span>` : ""}</td><td class="c">${esc(l.unit)}</td><td class="r">${qty(l.qty)}</td><td class="r">${php(l.rate)}</td><td class="r">${php(l.amount)}</td></tr>`,
        )
        .join("")}`,
    )
    .join("");

  const boqPage = `
  <section class="page flow">
    <header><span class="num">03</span><h2>Bill of quantities</h2></header>
    <p class="basis">Basis: floor ${qty(boq.areas.floor)} m² · ceiling ${qty(boq.areas.ceiling)} m² · walls ${qty(boq.areas.walls)} m²
      (perimeter ${qty(boq.areas.perimeter)} m × ${qty(m.ceilingHeight)} m height, less ${m.openingsPct}% openings)${m.furniturePieces ? ` · ${m.furniturePieces} furniture pieces` : ""}.
      Rates are indicative Metro Manila figures in PHP and must be confirmed by supplier quotation before tender; quantities come from the stated room dimensions, not from the render.</p>
    <table class="boq">
      <colgroup><col><col style="width:22mm"><col style="width:18mm"><col style="width:26mm"><col style="width:32mm"></colgroup>
      <thead><tr><th>Description</th><th class="c">Unit</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="4">Subtotal</td><td class="r">${php(boq.subtotal)}</td></tr>
        <tr><td colspan="4">Contingency (${boq.contingencyPct}%)</td><td class="r">${php(boq.contingency)}</td></tr>
        <tr><td colspan="4">VAT (12%)</td><td class="r">${php(boq.vat)}</td></tr>
        <tr class="total"><td colspan="4">Estimated total</td><td class="r">${php(boq.total)}</td></tr>
      </tfoot>
    </table>
  </section>`;

  const guide = `
  <section class="page flow">
    <header><span class="num">04</span><h2>Tropical installation guidelines</h2></header>
    <div class="guides">
      ${p.guidelines.map((g) => `<div class="guide"><h4>${esc(g.title)}</h4><ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`).join("")}
    </div>
  </section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(pr.name)}: Proposal</title>
<style>
  ${fontCss}
  @page {
    size: ${size};
    margin: 14mm 14mm 16mm;
    @bottom-left { content: "${cssString(pr.name)}: Specification proposal"; font: 7pt Inter, "Segoe UI", sans-serif; color: #9a9a9a; }
    @bottom-right { content: counter(page) " / " counter(pages); font: 7pt Inter, "Segoe UI", sans-serif; color: #9a9a9a; }
  }
  @page cover { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }
  * { box-sizing: border-box; }
  html, body { margin: 0; color: #2F2F2F; font: 10pt/1.5 Inter, "Segoe UI", system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .muted { color: #7A7A7A; } .small { font-size: 8pt; }
  .cover { page: cover; position: relative; width: 100vw; height: 100vh; overflow: hidden; break-after: page; background: #111; }
  .cover .hero { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .cover .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,.72) 100%); }
  .cover-text { position: absolute; left: 14mm; right: 14mm; bottom: 14mm; color: #fff; }
  .eyebrow { font-size: 9pt; letter-spacing: .14em; text-transform: uppercase; opacity: .8; }
  .cover h1 { font-size: 34pt; line-height: 1.1; margin: 6px 0 10px; font-weight: 700; letter-spacing: -.02em; }
  .cover-meta span { display: inline-block; margin-right: 18px; font-size: 10.5pt; opacity: .92; }
  .prepared { margin-top: 8px; font-size: 9pt; opacity: .75; }
  .page { break-before: page; }
  .page:not(.flow) { break-inside: avoid; }
  header { display: flex; align-items: baseline; gap: 10px; border-bottom: 1px solid #E6E6E3; padding-bottom: 6px; margin-bottom: 14px; }
  header .num { font-size: 9pt; color: #3366FF; font-weight: 600; }
  h2 { font-size: 16pt; margin: 0; font-weight: 600; letter-spacing: -.01em; }
  .ba { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  figure { margin: 0; } figure img { width: 100%; height: 128mm; object-fit: cover; border-radius: 4px; display: block; }
  figcaption { font-size: 8.5pt; color: #7A7A7A; margin-top: 4px; }
  .note { font-size: 8.5pt; color: #7A7A7A; margin-top: 10px; }
  .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .card { display: grid; grid-template-columns: 40mm 1fr; gap: 10px; border: 1px solid #E6E6E3; border-radius: 6px; padding: 8px; break-inside: avoid; }
  .card.plain { grid-template-columns: 1fr; }
  .swatches { display: grid; gap: 4px; align-content: start; }
  .swatches img { width: 100%; height: 22mm; object-fit: cover; border-radius: 3px; }
  .chip { height: 9mm; border-radius: 3px; display: flex; align-items: flex-end; padding: 2px 4px; }
  .chip span { font-size: 7pt; background: rgba(255,255,255,.85); padding: 0 3px; border-radius: 2px; }
  .tag { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .1em; color: #3366FF; font-weight: 600; }
  h3 { margin: 2px 0 6px; font-size: 11pt; font-weight: 600; }
  dl { display: grid; grid-template-columns: 18mm 1fr; gap: 2px 6px; margin: 0 0 6px; font-size: 8.5pt; }
  dt { color: #7A7A7A; } dd { margin: 0; }
  .tropical { margin: 0; padding-left: 14px; font-size: 8pt; color: #3d3d3d; }
  .basis { font-size: 8.5pt; color: #7A7A7A; margin: -6px 0 10px; }
  table.boq { width: 100%; border-collapse: collapse; font-size: 8.3pt; line-height: 1.3; }
  .boq td .small { display: inline; margin-left: 6px; }
  .boq tfoot { break-inside: avoid; }
  .boq th.r { text-align: right; } .boq th.c { text-align: center; }
  .boq th { text-align: left; font-weight: 600; color: #7A7A7A; border-bottom: 1px solid #DADAD6; padding: 5px 6px; }
  .boq td { padding: 3px 6px; border-bottom: 1px solid #F0F0EE; vertical-align: top; }
  .boq tr { break-inside: avoid; }
  .boq tr.sec td { background: #F7F7F5; font-weight: 600; border-bottom: 1px solid #E6E6E3; }
  .boq tfoot td { font-weight: 500; border-bottom: none; padding-top: 4px; }
  .boq tfoot tr.total td { font-size: 11pt; font-weight: 700; border-top: 2px solid #2F2F2F; }
  .r { text-align: right; white-space: nowrap; } .c { text-align: center; }
  .guides { columns: 2; column-gap: 12mm; }
  .guide { break-inside: avoid; margin-bottom: 10px; }
  .guide h4 { margin: 0 0 4px; font-size: 10pt; font-weight: 600; }
  .guide ul { margin: 0; padding-left: 14px; font-size: 8.8pt; }
  .guide li { margin-bottom: 3px; }
</style></head>
<body>${cover}${beforeAfter}${schedule}${boqPage}${guide}</body></html>`;
}
