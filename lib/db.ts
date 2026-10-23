"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Project, ProjectSummary } from "./types";
import type { Material } from "./materials";

interface StrataDB extends DBSchema {
  projects: { key: string; value: Project; indexes: { updatedAt: number } };
  blobs: { key: string; value: { id: string; blob: Blob; createdAt: number } };
  materials: { key: string; value: Material };
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<StrataDB>> | null = null;

function db() {
  dbPromise ??= openDB<StrataDB>("strata", 1, {
    upgrade(d) {
      const projects = d.createObjectStore("projects", { keyPath: "id" });
      projects.createIndex("updatedAt", "updatedAt");
      d.createObjectStore("blobs", { keyPath: "id" });
      d.createObjectStore("materials", { keyPath: "id" });
      d.createObjectStore("kv");
    },
  });
  return dbPromise;
}

export const uid = (prefix = "") => prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export async function putBlob(blob: Blob, id = uid("b_")): Promise<string> {
  await (await db()).put("blobs", { id, blob, createdAt: Date.now() });
  return id;
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return (await (await db()).get("blobs", id))?.blob;
}

export async function deleteBlobs(ids: (string | null | undefined)[]) {
  const d = await db();
  const tx = d.transaction("blobs", "readwrite");
  await Promise.all(ids.filter(Boolean).map((id) => tx.store.delete(id!)));
  await tx.done;
}

export async function saveProject(p: Project) {
  await (await db()).put("projects", p);
}

export async function loadProject(id: string) {
  return (await db()).get("projects", id);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await (await db()).getAllFromIndex("projects", "updatedAt");
  return all.reverse().map((p) => ({
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    thumbBlobId: p.renders[0]?.previewBlobId ?? p.base?.editBlobId ?? null,
    renders: p.renders.map((r) => ({ id: r.id, createdAt: r.createdAt, previewBlobId: r.previewBlobId })),
  }));
}

/** Deletes a project and every blob it owns. */
export async function deleteProject(id: string) {
  const p = await loadProject(id);
  if (!p) return;
  const ids: (string | null)[] = [p.base?.blobId ?? null, p.base?.editBlobId ?? null];
  for (const m of Object.values(p.masks)) ids.push(m.blobId);
  for (const b of Object.values(p.buckets)) for (const r of b.refs) ids.push(r.blobId);
  for (const r of p.renders) ids.push(r.previewBlobId, r.finalBlobId);
  await deleteBlobs(ids);
  await (await db()).delete("projects", id);
}

export async function listCustomMaterials(): Promise<Material[]> {
  return (await db()).getAll("materials");
}

export async function saveCustomMaterial(m: Material) {
  await (await db()).put("materials", m);
}

export async function deleteCustomMaterial(id: string) {
  await (await db()).delete("materials", id);
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get("kv", key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown) {
  await (await db()).put("kv", value, key);
}
