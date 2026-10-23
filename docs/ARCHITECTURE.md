# Strata: architecture and blueprint review

This document records how Strata implements the original four-phase blueprint and where it deliberately departs from it.

## Blueprint review: what changed and why

| Blueprint said | Problem | What Strata does |
|---|---|---|
| SAM "automatically generates masks for ceiling, floor, walls" | Classic SAM is class-agnostic: it outputs segments with no labels. | ComfyUI 0.42 ships **SAM3** natively, which is text-prompted. One `SAM3_Detect` per layer with multi-concept prompts (`wall:8`, `sofa:4, chair:8, …`). The user can refine with brush, eraser, and magic wand. |
| "fed into two ControlNets simultaneously:" | The list was cut off. No official MLSD ControlNet exists for SDXL. | Lite: Canny (lines) + optional depth (SD1.5). Studio: **ControlNet Union ProMax**, one model with type `canny/lineart/anime_lineart/mlsd` for lines and `depth` for depth. |
| ControlNet alone gives "structural lock-in" | ControlNet guides; it does not guarantee. It also locks the old floor's grout lines into the new material. | (1) Sampling is confined to the union mask (`SetLatentNoiseMask`). (2) The render is composited over the untouched original (`ImageCompositeMasked`), so every pixel outside the masks is the original. (3) The Canny map is blanked inside the eroded editable area, so old texture is not forced back. (4) A **Protected** layer (windows, doors, columns, beams) is subtracted from every surface. |
| SDXL **or Flux.1** | IP-Adapter Plus SDXL and ControlNet Union are SDXL-only; Flux needs a different stack. | SDXL only (RealVisXL V5 recommended over base SDXL for interiors). |
| Ultimate SD Upscale → 4K | USDU is a tiled diffusion pass: it can change structure and is far too slow on CPU. | Studio: USDU at 0.25 denoise, then **re-locked at 4K** against an ESRGAN-upscaled original. Lite: pure ESRGAN (4x-UltraSharp) to 3840 px. |
| Browser POSTs to `127.0.0.1:8188/prompt` | Needs `--enable-cors-header`; ComfyUI's origin check returns 403 when the page host differs (`localhost` vs `127.0.0.1`). | A same-origin Next.js proxy (`/api/comfy/*`, allow-listed endpoints) plus a WebSocket→SSE bridge (`/api/events`) that also forwards live latent previews. ComfyUI runs unmodified. |
| PWA "sends a script command to execute wget" | A browser cannot run commands, and an open local command endpoint is a security hole. | The local Next server downloads only **catalogue entries** (hard-coded, verified URLs) into `ComfyUI/models/<dir>`, two at a time with resume-on-drop retries. Custom-node install is limited to listed repos. |
| "AI detects a large-format stone texture" | No such detector exists in the pipeline. | A transparent heuristic classifier (colour, contrast, gradient energy, grain coherence, grout periodicity) proposes a family; tropical rules pick the catalogue item; the user can pin an override. |
| BOQ "estimated area calculations" | Areas cannot be measured from a single perspective photo without scale. | Quantities come from entered room dimensions (area, height, perimeter, openings). Mask coverage is shown but never used as m². |
| Specific supplier addresses and PHP costs | These change and could not be verified. | Suppliers are given at company and district level as in the brief. Rates are labelled indicative and editable in the Material Library. The PDF states that quotations must confirm them. |
| SDXL + 2 ControlNets + IP-Adapter + USDU as the only path | Needs ≥12 GB VRAM. The development machine is an i5-7400 with no NVIDIA GPU and 8 GB RAM. | Two profiles. **Lite** (SD1.5 + LCM, 6 steps) runs on CPU; **Studio** is the blueprint's SDXL stack. The doctor endpoint recommends one from the hardware. |

## Data flow

```
Browser (PWA, IndexedDB)                     Next.js server (127.0.0.1:4787)            ComfyUI (:8188)
─────────────────────────                    ────────────────────────────────            ───────────────
project / masks / refs / renders  ──upload──▶ /api/comfy/upload/image  ──────────────▶   input/strata/*
graph JSON (lib/workflow/*)       ──queue───▶ /api/comfy/prompt        ──────────────▶   /prompt
progress, previews                ◀──SSE──── /api/events  ◀── WebSocket ──────────────   /ws
outputs                           ◀──────── /api/comfy/view, /history ◀──────────────   output/strata/*
proposal payload                  ──POST───▶ /api/proposal → puppeteer-core + system Chrome/Edge → PDF
model download                    ──POST───▶ /api/models → streams into ComfyUI/models/<dir>
```

## Generation graph (Lite)

```
Checkpoint ─ LCM LoRA ─┬─ IPAdapterAdvanced(floor ref, attn_mask=floor) ─ … per surface ─┐
                       │                                                                  ▼
Global prompt ─ + ConditioningSetMask(per-surface prompt, surface mask) ─ ControlNet(lines[, depth]) ─ KSampler
Base ─ Canny ─ blank inside eroded union mask ───────────────────────────┘                  ▲
Base ─ VAEEncode ─ SetLatentNoiseMask(union hard) ───────────────────────────────────────────┘
KSampler ─ VAEDecode ─ ImageCompositeMasked(dest = base, mask = union soft) ─ Save preview
                                         └─ ImageUpscaleWithModel(UltraSharp) ─ ImageScale(3840) ─ Save final
```

`applyDefaults()` fills any required inputs a node pack adds later from the live `/object_info`, and `validatePrompt()` turns schema mismatches into readable messages before anything is queued.

## Storage

Everything user-created lives in the browser's IndexedDB (`strata` database): projects, mask PNGs (alpha), references, renders, custom materials. Server-side state is only `.strata/config.json` (ComfyUI URL and folder).
