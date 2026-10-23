# Strata

Structure-locked AI material rendering for architects and interior designers, running on a local ComfyUI. Drop in a room photo or render, drop reference photos onto **Floor / Walls / Ceiling / Furniture**, and Strata re-finishes only those surfaces. Walls, doors, windows and columns stay pixel-identical. It then exports a costed specification proposal (PDF) with Philippine, tropical-rated materials.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the pipeline and how it departs from the original blueprint.

## Requirements

- Node.js 20+ (developed on 24)
- ComfyUI **0.42 or newer** (native SAM3, Depth Anything 3 and Canny nodes), with the
  [ComfyUI_IPAdapter_plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus) custom node
- Google Chrome or Microsoft Edge (used headless for PDF export)

## Run

```bash
# 1. Start ComfyUI (add --cpu if you have no NVIDIA GPU). No CORS flags needed.
cd D:\PROJECTS\ComfyUI
.venv\Scripts\python.exe main.py --listen 127.0.0.1 --cpu

# 2. Start Strata
cd "D:\PROJECTS\Strata PWA"
npm install
npm run build
npm start            # http://127.0.0.1:4787
```

Use `npm run dev` while developing. The service worker (offline shell, installable PWA) only registers in production builds.

Strata looks for ComfyUI at `http://127.0.0.1:8188` and auto-detects the ComfyUI folder (a sibling `../ComfyUI`, `COMFYUI_PATH`, or common locations). Change either in **Settings**.

## First run

1. Open **Model manager**. Strata recommends **Lite** (CPU / ≤8 GB VRAM) or **Studio** (SDXL, NVIDIA ≥12 GB) from your hardware. Download the required models; they stream straight into `ComfyUI/models/…`, resume after dropped connections, and ComfyUI picks them up without a restart.
2. Drop a base image on the canvas.
3. **Auto-detect** (SAM3) masks floor, walls, ceiling, furniture and protected structure. Refine with Brush `B`, Eraser `E` or Magic wand `W`; `1`–`4` and `0` switch layers.
4. Drop reference photos into a surface. Strata classifies the texture and picks a tropical-rated catalogue material (overridable).
5. **Generate** (`Ctrl+Enter`). A live preview streams while sampling; the result opens in a before/after slider.
6. Fill in room dimensions in **Project**, then **Proposal → Export PDF**.

## Keyboard

| Key | Action |
|---|---|
| `V` / `B` / `E` / `W` | Pan / brush / eraser / magic wand |
| `1` `2` `3` `4` `0` | Floor / walls / ceiling / furniture / protected |
| `[` `]` | Brush size |
| `Alt` + paint or click | Erase / subtract |
| `Space` + drag, scroll | Pan |
| `Ctrl` + scroll | Zoom |
| `F` / `C` / `M` | Fit / toggle compare / toggle masks |
| `Ctrl+Z` / `Ctrl+Enter` | Undo mask edit / generate |

## Performance notes

On CPU, expect minutes per render: the reference machine (i5-7400, 8 GB RAM) takes about 30 s per diffusion step at 768 px. Keep **Diffusion size** at 640–768 px and leave **Depth lock** off unless needed. ControlNet, IP-Adapter, SAM3 and the 4K ESRGAN pass all run on that CPU too. A CUDA GPU makes the Studio profile practical.

## Tests

```bash
npm test        # graph builders vs. a captured ComfyUI 0.42 schema, BOQ, material rules, texture classifier, proposal HTML
npm run typecheck
```

## Material data

`lib/materials.ts` holds the built-in catalogue (sintered stone, slim porcelain + mandatory epoxy grout, PU-cement screed, SPC with vapour barrier, anti-mould paint, MR gypsum, fibre-cement and more). Rates are **indicative** Metro Manila PHP figures and every entry is editable in the Material Library. Confirm suppliers and prices by quotation before issuing a proposal.
