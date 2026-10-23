/** Minimal builder for ComfyUI API-format prompts ("Save (API Format)" JSON). */

export type Link = [string, number];
export type ApiNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } };
export type ApiPrompt = Record<string, ApiNode>;

export type InputSpec = [unknown, Record<string, unknown>?];
export interface NodeInfo {
  input: { required?: Record<string, InputSpec>; optional?: Record<string, InputSpec> };
  output: string[];
}
export type ObjectInfo = Record<string, NodeInfo>;

export class Graph {
  readonly prompt: ApiPrompt = {};
  private counter = 0;

  add(classType: string, inputs: Record<string, unknown>, title?: string): string {
    const id = String(++this.counter);
    this.prompt[id] = { class_type: classType, inputs, ...(title ? { _meta: { title } } : {}) };
    return id;
  }

  /** Output slot `index` of node `id`. */
  static out(id: string, index = 0): Link {
    return [id, index];
  }
}

/** Options of a COMBO input; handles both the legacy `[[...]]` and the v3 `["COMBO", {options}]` shapes. */
export function comboOptions(info: ObjectInfo | null | undefined, classType: string, input: string): string[] | null {
  const node = info?.[classType];
  const spec = node?.input.required?.[input] ?? node?.input.optional?.[input];
  if (!spec) return null;
  if (Array.isArray(spec[0])) return spec[0] as string[];
  if (spec[0] === "COMBO" && Array.isArray(spec[1]?.options)) return spec[1]!.options as string[];
  return null;
}

/** First preferred value that the server actually offers, else null. */
export function pickAvailable(info: ObjectInfo | null | undefined, classType: string, input: string, preferred: string[]): string | null {
  const options = comboOptions(info, classType, input);
  if (!options) return null;
  return preferred.find((p) => options.includes(p)) ?? null;
}

const PRIMITIVES = new Set(["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"]);

/**
 * Fills required inputs we did not set with the server's defaults, so prompts survive node
 * packs adding new required widgets. Link-typed inputs are left alone and reported by validate().
 */
export function applyDefaults(prompt: ApiPrompt, info: ObjectInfo): ApiPrompt {
  for (const node of Object.values(prompt)) {
    const req = info[node.class_type]?.input.required ?? {};
    for (const [name, spec] of Object.entries(req)) {
      if (name in node.inputs) continue;
      const [type, opts] = spec;
      if (Array.isArray(type)) {
        node.inputs[name] = opts?.default ?? type[0];
      } else if (typeof type === "string" && PRIMITIVES.has(type)) {
        if (opts && "default" in opts) node.inputs[name] = opts.default;
        else if (type === "COMBO" && Array.isArray(opts?.options)) node.inputs[name] = (opts!.options as string[])[0];
      }
    }
  }
  return prompt;
}

/** Problems that would make ComfyUI reject the prompt, phrased for the user. */
export function validatePrompt(prompt: ApiPrompt, info: ObjectInfo): string[] {
  const problems: string[] = [];
  for (const [id, node] of Object.entries(prompt)) {
    const nodeInfo = info[node.class_type];
    if (!nodeInfo) {
      problems.push(`ComfyUI is missing the node "${node.class_type}". Install its custom node pack, then restart ComfyUI.`);
      continue;
    }
    for (const [name, spec] of Object.entries(nodeInfo.input.required ?? {})) {
      const value = node.inputs[name];
      if (value === undefined) {
        problems.push(`Node ${id} (${node.class_type}) is missing input "${name}".`);
        continue;
      }
      const options = Array.isArray(spec[0]) ? (spec[0] as string[]) : spec[0] === "COMBO" ? (spec[1]?.options as string[] | undefined) : undefined;
      // Upload-backed combos (LoadImage) list only files present at query time, so skip them.
      if (options && typeof value === "string" && !options.includes(value) && !spec[1]?.image_upload && !/^Load.*Image/.test(node.class_type)) {
        problems.push(`"${value}" is not available for ${node.class_type}.${name}. Download it in Model Manager.`);
      }
    }
  }
  return [...new Set(problems)];
}
