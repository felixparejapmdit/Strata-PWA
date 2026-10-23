"use client";

import { FileText } from "lucide-react";
import { patchProject, setZone, useStore } from "@/lib/store";
import { ZONES, isWetZone } from "@/lib/buckets";
import { computeBoq, measuredAreas, php } from "@/lib/boq";
import { proposalSelections } from "@/lib/pipeline";
import type { ProjectMeta, ZoneType } from "@/lib/types";
import { Button, Field, NumberInput, Section, Select, TextInput } from "./ui";

export function ProjectPanel() {
  const project = useStore((s) => s.project!);
  useStore((s) => s.library);
  const m = project.meta;
  const set = (patch: Partial<ProjectMeta>) => patchProject((d) => void Object.assign(d.meta, patch));
  const boq = computeBoq(m, proposalSelections());
  const areas = measuredAreas(m);

  return (
    <div>
      <Section title="Project">
        <Field label="Project name">
          <TextInput value={project.name} onChange={(e) => patchProject((d) => void (d.name = e.target.value))} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Client">
            <TextInput value={m.client} onChange={(e) => set({ client: e.target.value })} placeholder="Client name" />
          </Field>
          <Field label="Location">
            <TextInput value={m.location} onChange={(e) => set({ location: e.target.value })} />
          </Field>
        </div>
        <Field label="Prepared by">
          <TextInput value={m.preparedBy} onChange={(e) => set({ preparedBy: e.target.value })} placeholder="Your name / firm" />
        </Field>
      </Section>

      <Section title="Space">
        <Field label="Zone" hint={isWetZone(m.zone) ? "Wet zone: wet-rated systems, waterproofing and epoxy grout are enforced." : "Dry zone."}>
          <Select value={m.zone} onChange={(v) => setZone(v as ZoneType)} options={ZONES.map((z) => ({ value: z.id, label: z.label }))} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Floor area">
            <NumberInput value={m.floorArea} min={0} step={0.5} suffix="m²" onChange={(v) => set({ floorArea: Math.max(0, v) })} />
          </Field>
          <Field label="Ceiling height">
            <NumberInput value={m.ceilingHeight} min={0} step={0.1} suffix="m" onChange={(v) => set({ ceilingHeight: Math.max(0, v) })} />
          </Field>
          <Field label="Perimeter" hint={m.perimeter ? undefined : `Estimated ${areas.perimeter.toFixed(1)} m`}>
            <NumberInput value={m.perimeter} min={0} step={0.5} suffix="m" onChange={(v) => set({ perimeter: Math.max(0, v) })} />
          </Field>
          <Field label="Openings">
            <NumberInput value={m.openingsPct} min={0} max={90} suffix="%" onChange={(v) => set({ openingsPct: v })} />
          </Field>
          <Field label="Furniture pieces">
            <NumberInput value={m.furniturePieces} min={0} onChange={(v) => set({ furniturePieces: Math.max(0, Math.round(v)) })} />
          </Field>
          <Field label="Contingency">
            <NumberInput value={m.contingencyPct} min={0} max={50} suffix="%" onChange={(v) => set({ contingencyPct: v })} />
          </Field>
        </div>
      </Section>

      <Section title="Estimate">
        <dl className="space-y-1 text-xs">
          {boq.sections.map((s) => (
            <div key={s.bucket} className="flex justify-between gap-3">
              <dt className="truncate text-mute">{s.label}: {s.material.name}</dt>
              <dd className="shrink-0 tabular-nums">{php(s.subtotal, 0)}</dd>
            </div>
          ))}
          {!boq.sections.length && <p className="text-faint">Assign materials to surfaces to see costs.</p>}
          {boq.sections.length > 0 && (
            <>
              <div className="flex justify-between border-t border-line pt-1 text-mute">
                <dt>Contingency + VAT 12%</dt>
                <dd className="tabular-nums">{php(boq.contingency + boq.vat, 0)}</dd>
              </div>
              <div className="flex justify-between text-[13px] font-semibold">
                <dt>Estimated total</dt>
                <dd className="tabular-nums">{php(boq.total, 0)}</dd>
              </div>
            </>
          )}
        </dl>
        <Button variant="secondary" className="w-full" onClick={() => useStore.setState({ modal: "proposal" })}>
          <FileText size={14} /> Specification proposal
        </Button>
      </Section>
    </div>
  );
}
