"use client";

import { useState } from "react";
import { FileDown, Eye, Loader2, AlertTriangle } from "lucide-react";
import { useStore } from "@/lib/store";
import { computeBoq, php } from "@/lib/boq";
import { buildGuidelines } from "@/lib/guidelines";
import { exportProposal, proposalSelections } from "@/lib/pipeline";
import { BUCKETS, LAYER_INFO, zoneLabel } from "@/lib/buckets";
import { BlobImg, Button, cx } from "./ui";

export function ProposalPeek() {
  const project = useStore((s) => s.project);
  const job = useStore((s) => s.job);
  useStore((s) => s.library);
  const [paper, setPaper] = useState<"A4" | "A3">("A4");
  if (!project) return null;

  const selections = proposalSelections();
  const boq = computeBoq(project.meta, selections);
  const guidelines = buildGuidelines(project.meta.zone, selections);
  const render = project.renders.find((r) => r.id === project.activeRenderId) ?? project.renders[0];
  const exporting = job?.kind === "proposal";

  return (
    <div className="space-y-5">
      {!render && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
          <AlertTriangle size={16} className="mt-px shrink-0" /> Generate a render first. The proposal cover and before/after pages are built from it.
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-line">
        <div className="relative aspect-[1.414] bg-paper">
          {render && <BlobImg id={render.finalBlobId ?? render.previewBlobId} className="absolute inset-0 h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent from-50% to-black/70" />
          <div className="absolute bottom-4 left-4 right-4 text-white">
            <div className="text-[10px] uppercase tracking-[0.14em] opacity-80">Material &amp; Specification Proposal</div>
            <div className="mt-1 text-xl font-bold tracking-tight">{project.name}</div>
            <div className="mt-1 text-xs opacity-85">
              {zoneLabel(project.meta.zone)}
              {project.meta.location && ` · ${project.meta.location}`}
              {project.meta.client && ` · For ${project.meta.client}`}
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute">Schedule</h3>
        <div className="divide-y divide-line rounded-lg border border-line">
          {BUCKETS.map((b) => {
            const m = selections[b];
            const refs = project.buckets[b].refs;
            return (
              <div key={b} className={cx("flex items-center gap-3 p-2.5", !m && "opacity-50")}>
                <div className="flex -space-x-2">
                  {refs.slice(0, 3).map((r) => (
                    <BlobImg key={r.id} id={r.blobId} className="h-9 w-9 rounded-md object-cover ring-2 ring-white" />
                  ))}
                  {!refs.length && <div className="h-9 w-9 rounded-md bg-paper" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-accent">{LAYER_INFO[b].label}</div>
                  <div className="truncate text-[13px]">{m?.name ?? "Not specified"}</div>
                </div>
                {m && <div className="shrink-0 text-xs tabular-nums text-mute">{php(boq.sections.find((s) => s.bucket === b)?.subtotal ?? 0, 0)}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg bg-paper p-3 text-[13px]">
        <div className="flex justify-between"><span className="text-mute">Subtotal</span><span className="tabular-nums">{php(boq.subtotal)}</span></div>
        <div className="flex justify-between"><span className="text-mute">Contingency {boq.contingencyPct}%</span><span className="tabular-nums">{php(boq.contingency)}</span></div>
        <div className="flex justify-between"><span className="text-mute">VAT 12%</span><span className="tabular-nums">{php(boq.vat)}</span></div>
        <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold"><span>Estimated total</span><span className="tabular-nums">{php(boq.total)}</span></div>
      </div>

      <p className="text-xs text-mute">
        {guidelines.reduce((n, g) => n + g.items.length, 0)} tropical installation notes across {guidelines.length} groups will be included. Quantities come from the room dimensions in the Project tab.
      </p>

      <div className="flex items-center gap-2 border-t border-line pt-4">
        <div className="flex rounded-lg bg-paper p-0.5">
          {(["A4", "A3"] as const).map((p) => (
            <button key={p} onClick={() => setPaper(p)} className={cx("h-7 rounded-md px-3 text-xs font-medium", paper === p ? "bg-white shadow-sm" : "text-mute")}>
              {p} landscape
            </button>
          ))}
        </div>
        <Button className="ml-auto" disabled={!render || !!job} onClick={() => void exportProposal(paper, "html")}>
          <Eye size={14} /> Preview
        </Button>
        <Button variant="primary" disabled={!render || !!job} onClick={() => void exportProposal(paper, "pdf")}>
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} {exporting ? job.stage : "Export PDF"}
        </Button>
      </div>
    </div>
  );
}
