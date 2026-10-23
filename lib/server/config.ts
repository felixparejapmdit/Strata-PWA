import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface StrataConfig {
  comfyUrl: string;
  /** ComfyUI install folder (contains main.py and models/). */
  comfyPath: string;
}

const CONFIG_DIR = path.join(process.cwd(), ".strata");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export function isComfyDir(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, "main.py")) && fs.statSync(path.join(dir, "models")).isDirectory();
  } catch {
    return false;
  }
}

export function detectComfyPath(): string {
  const home = os.homedir();
  const candidates = [
    process.env.COMFYUI_PATH,
    path.resolve(process.cwd(), "..", "ComfyUI"),
    path.resolve(process.cwd(), "..", "ComfyUI_windows_portable", "ComfyUI"),
    path.join(home, "ComfyUI"),
    path.join(home, "Documents", "ComfyUI"),
    path.join(home, "ComfyUI_windows_portable", "ComfyUI"),
    "C:\\ComfyUI",
    "C:\\ComfyUI_windows_portable\\ComfyUI",
  ].filter(Boolean) as string[];
  return candidates.find(isComfyDir) ?? "";
}

export function getConfig(): StrataConfig {
  let saved: Partial<StrataConfig> = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    // first run
  }
  return {
    comfyUrl: (saved.comfyUrl || process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/+$/, ""),
    comfyPath: saved.comfyPath && isComfyDir(saved.comfyPath) ? saved.comfyPath : detectComfyPath(),
  };
}

export function setConfig(patch: Partial<StrataConfig>): StrataConfig {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const next = { ...getConfig(), ...defined };
  const url = new URL(next.comfyUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("ComfyUI URL must be http(s).");
  if (next.comfyPath && !isComfyDir(next.comfyPath)) throw new Error(`"${next.comfyPath}" is not a ComfyUI folder (no main.py/models).`);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}
