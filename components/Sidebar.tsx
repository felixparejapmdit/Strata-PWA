"use client";

import { useState } from "react";
import { ChevronRight, Plus, Library, Boxes, Settings, Trash2, ImageIcon, PanelLeftClose, PanelLeft } from "lucide-react";
import { deleteProject, newProject, openProject, patchProject, useStore } from "@/lib/store";
import { formatDuration } from "@/lib/pipeline";
import { BlobImg, cx, timeAgo } from "./ui";

export function Sidebar() {
  const projects = useStore((s) => s.projects);
  const current = useStore((s) => s.project);
  const doctor = useStore((s) => s.doctor);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-paper py-3">
        <button className="rounded-md p-2 text-mute hover:bg-hover" onClick={() => setCollapsed(false)} aria-label="Expand sidebar">
          <PanelLeft size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-line bg-paper">
      <div className="flex h-12 items-center gap-2 px-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon.svg" alt="" className="h-6 w-6 rounded-md" />
        <span className="text-[14px] font-semibold tracking-tight">Strata</span>
        <span className="rounded bg-black/5 px-1.5 text-[10px] font-medium text-mute">LOCAL</span>
        <button className="ml-auto rounded-md p-1.5 text-faint hover:bg-hover hover:text-ink" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar">
          <PanelLeftClose size={15} />
        </button>
      </div>

      <div className="px-2">
        <button onClick={() => void newProject()} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-mute hover:bg-hover hover:text-ink">
          <Plus size={15} /> New project
        </button>
      </div>

      <div className="mt-3 px-4 pb-1 text-[11px] font-medium text-faint">Projects</div>
      <nav className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
        {projects.length === 0 && <p className="px-2 py-2 text-xs text-faint">No projects yet. Drop a photo on the canvas to start.</p>}
        {projects.map((p) => {
          const active = current?.id === p.id;
          const expanded = open[p.id] ?? active;
          return (
            <div key={p.id}>
              <div className={cx("group flex h-8 items-center gap-1 rounded-md pr-1", active ? "bg-hover" : "hover:bg-hover")}>
                <button
                  className="grid h-6 w-5 place-items-center text-faint hover:text-ink"
                  onClick={() => setOpen((o) => ({ ...o, [p.id]: !expanded }))}
                  aria-label={expanded ? "Collapse" : "Expand"}
                >
                  <ChevronRight size={13} className={cx("transition-transform", expanded && "rotate-90")} />
                </button>
                {active ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <BlobImg id={p.thumbBlobId} className="h-5 w-5 shrink-0 rounded object-cover" />
                    <input
                      value={current.name}
                      onChange={(e) => patchProject((d) => void (d.name = e.target.value))}
                      className="min-w-0 flex-1 truncate rounded bg-transparent px-0.5 text-[13px] font-medium outline-none focus:bg-white focus:ring-1 focus:ring-accent/30"
                      aria-label="Project name"
                    />
                  </div>
                ) : (
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void openProject(p.id)}>
                    <BlobImg id={p.thumbBlobId} className="h-5 w-5 shrink-0 rounded object-cover" />
                    <span className="truncate text-[13px]">{p.name}</span>
                  </button>
                )}
                <button
                  className="hidden rounded p-1 text-faint hover:bg-black/5 hover:text-danger group-hover:block"
                  onClick={() => {
                    if (confirm(`Delete "${p.name}" and all its renders? This cannot be undone.`)) void deleteProject(p.id);
                  }}
                  aria-label={`Delete ${p.name}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {expanded && (
                <div className="ml-5 border-l border-line pl-2">
                  {p.renders.length === 0 && <div className="flex h-7 items-center gap-2 px-2 text-xs text-faint"><ImageIcon size={12} /> No renders</div>}
                  {p.renders.map((r, i) => {
                    const isActive = active && current.activeRenderId === r.id;
                    const full = active ? current.renders.find((x) => x.id === r.id) : undefined;
                    return (
                      <button
                        key={r.id}
                        onClick={async () => {
                          if (!active) await openProject(p.id);
                          if (useStore.getState().project?.id !== p.id) return;
                          patchProject((d) => void (d.activeRenderId = r.id));
                          useStore.setState({ view: "compare" });
                        }}
                        className={cx("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left", isActive ? "bg-accent-soft text-accent" : "text-mute hover:bg-hover hover:text-ink")}
                      >
                        <BlobImg id={r.previewBlobId} className="h-5 w-7 shrink-0 rounded-sm object-cover" />
                        <span className="truncate text-xs">Render {p.renders.length - i}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-faint">{full ? formatDuration(full.durationMs) : timeAgo(r.createdAt)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-line p-2">
        <SideLink icon={<Library size={15} />} label="Material library" onClick={() => useStore.setState({ modal: "library" })} />
        <SideLink icon={<Boxes size={15} />} label="Model manager" onClick={() => useStore.setState({ modal: "models" })} />
        <SideLink icon={<Settings size={15} />} label="Settings" onClick={() => useStore.setState({ modal: "settings" })} />
        <button
          onClick={() => useStore.setState({ modal: "settings" })}
          className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
          title={doctor?.online ? `ComfyUI ${doctor.version} at ${doctor.comfyUrl}` : doctor?.error}
        >
          <span className={cx("h-2 w-2 shrink-0 rounded-full", doctor?.online ? "bg-ok" : "bg-danger", !doctor && "bg-faint")} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{doctor?.online ? "ComfyUI connected" : doctor ? "ComfyUI offline" : "Checking ComfyUI…"}</span>
            <span className="block truncate text-[11px] text-faint">
              {doctor?.online ? `${doctor.device?.type === "cuda" ? "GPU" : "CPU"} · ${doctor.device?.name?.replace(/^cuda:\d+\s*/, "").slice(0, 28) ?? ""}` : doctor?.comfyUrl}
            </span>
          </span>
        </button>
      </div>
    </aside>
  );
}

function SideLink({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-mute hover:bg-hover hover:text-ink">
      {icon}
      {label}
    </button>
  );
}
