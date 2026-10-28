import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { classTypes, FIXTURES, FULL_LITE, mockComfy } from "./mock-comfy";

const inspector = (page: Page) => page.locator("aside").last();
// Match the card's exact title: "ceiling" also appears inside other cards' material dropdowns.
const card = (page: Page, label: string) => inspector(page).locator("div.rounded-lg.border").filter({ has: page.getByText(label, { exact: true }) }).first();
const chip = async (page: Page, label: string) => (await card(page, label).locator("button").first().innerText()).replace(/\s+/g, " ");

async function uploadBase(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose image" }).click();
  await (await chooser).setFiles(path.join(FIXTURES, "room.png"));
  await expect(page.locator('img[alt="Base"]')).toBeVisible();
}

async function addReference(page: Page, label: string, file: string) {
  const chooser = page.waitForEvent("filechooser");
  const c = card(page, label);
  const add = c.getByRole("button", { name: /Drop or browse reference images|Add reference image/ }).first();
  await add.click();
  await (await chooser).setFiles(path.join(FIXTURES, file));
}

/** Paints horizontal brush strokes on a layer; coordinates are fractions of the image. */
async function paint(page: Page, layerKey: string, rows: [number, number, number][], size = 60) {
  await page.keyboard.press(layerKey);
  await page.keyboard.press("b");
  await page.locator('input[aria-label="Size"]').fill(String(size));
  const b = (await page.locator('img[alt="Base"]').boundingBox())!;
  for (const [y, x0, x1] of rows) {
    await page.mouse.move(b.x + x0 * b.width, b.y + y * b.height);
    await page.mouse.down();
    await page.mouse.move(b.x + x1 * b.width, b.y + y * b.height, { steps: 15 });
    await page.mouse.up();
  }
}

test.describe("Strata", () => {
  let consoleErrors: string[];
  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => consoleErrors.push(e.message));
  });
  test.afterEach(() => {
    // EventSource reconnects against the mocked stream are expected noise; anything else is a bug.
    expect(consoleErrors.filter((e) => !/EventSource|events\?clientId/.test(e))).toEqual([]);
  });

  test("empty state, ComfyUI status and project creation", async ({ page }) => {
    await mockComfy(page);
    await page.goto("/");
    await expect(page.getByText("ComfyUI connected")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Drop a base photo or render" })).toBeVisible();
    await uploadBase(page);
    // The open project's name is an editable textbox in the sidebar.
    await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("room");
    await expect(page.getByRole("button", { name: /^Generate/ })).toBeDisabled();
    // Sidebar: new project, collapse / expand
    await page.getByRole("button", { name: "New project" }).click();
    await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Untitled project");
    await expect(page.locator("aside").first().getByText("room", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(page.getByRole("button", { name: "Model manager" })).toBeVisible();
  });

  test("mask tools: brush, eraser, undo, wand, clear, layers, zoom", async ({ page }) => {
    await mockComfy(page);
    await page.goto("/");
    await uploadBase(page);
    await paint(page, "1", [[0.8, 0.05, 0.5], [0.9, 0.05, 0.5]]);
    await expect.poll(() => chip(page, "Floor")).toMatch(/\d+% · painted/);
    const painted = await chip(page, "Floor");
    // Undo restores the previous coverage immediately
    await paint(page, "1", [[0.7, 0.55, 0.65]]);
    await expect.poll(() => chip(page, "Floor")).not.toBe(painted);
    await page.keyboard.press("Control+z");
    await expect.poll(() => chip(page, "Floor")).toBe(painted);
    // Eraser reduces coverage
    await page.keyboard.press("e");
    const b = (await page.locator('img[alt="Base"]').boundingBox())!;
    await page.mouse.move(b.x + 0.05 * b.width, b.y + 0.9 * b.height);
    await page.mouse.down();
    await page.mouse.move(b.x + 0.3 * b.width, b.y + 0.9 * b.height, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => chip(page, "Floor")).not.toBe(painted);
    // Magic wand selects a region on the walls layer; clear empties it
    await page.keyboard.press("2");
    await page.keyboard.press("w");
    await page.mouse.click(b.x + 0.88 * b.width, b.y + 0.35 * b.height);
    await expect.poll(() => chip(page, "Walls")).toMatch(/painted/);
    await page.getByRole("button", { name: /Clear walls mask/ }).click();
    await expect.poll(() => chip(page, "Walls")).toMatch(/no mask/);
    // Mask visibility and zoom
    await page.keyboard.press("m");
    await expect(page.getByRole("button", { name: "Show masks (M)" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByText("125%")).toBeVisible();
    await page.keyboard.press("f");
    await expect(page.getByText("100%")).toBeVisible();
  });

  test("references: texture suggestion, duplicate rejection, remove, zone rules", async ({ page }) => {
    await mockComfy(page);
    await page.goto("/");
    await uploadBase(page);
    await addReference(page, "Floor", "marble.png");
    await expect(card(page, "Floor").locator("select")).toHaveValue("sintered-stone-12");
    await addReference(page, "Floor", "marble.png");
    await expect(page.getByText("That image is already a floor reference.")).toBeVisible();
    await expect(card(page, "Floor").locator("div.group.relative")).toHaveCount(1);
    await addReference(page, "Walls", "oak.png");
    await expect(card(page, "Walls").locator("select")).toHaveValue("wpc-fluted-panel");
    // Wet zone forces wet-rated systems
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await inspector(page).locator('label:has-text("Zone") select').selectOption("bathroom");
    await page.getByRole("button", { name: "Materials", exact: true }).click();
    await expect(card(page, "Floor").locator("select")).toHaveValue("slim-porcelain-6");
    // Remove a reference
    const thumb = card(page, "Walls").locator("div.group.relative").first();
    await thumb.hover();
    await thumb.getByRole("button", { name: /Remove/ }).click();
    await expect(card(page, "Walls").locator("div.group.relative")).toHaveCount(0);
  });

  test("tabs and modals open and close", async ({ page }) => {
    await mockComfy(page);
    await page.goto("/");
    await uploadBase(page);
    await page.getByRole("button", { name: "Render", exact: true }).click();
    await expect(page.getByRole("radiogroup", { name: "Render quality" })).toBeVisible();
    await page.getByRole("radio", { name: /Draft/ }).click();
    await expect(page.getByRole("radio", { name: /Draft/ })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await inspector(page).getByPlaceholder("Client name").fill("Test Client");
    await expect(inspector(page).getByText("Estimated total").or(inspector(page).getByText(/Assign materials/))).toBeVisible();
    for (const [name, expectText] of [
      ["Model manager", "Models download straight into your ComfyUI folder."],
      ["Material library", "Sintered stone, large format 12 mm"],
      ["Settings", "ComfyUI 0.42.0 connected"],
      ["Proposal", "Generate a render first"],
    ] as const) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText(expectText);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });

  test("Generate on floor, walls and ceiling, then compare, 4K and PDF export", async ({ page }) => {
    const comfy = await mockComfy(page, { installed: FULL_LITE });
    await page.goto("/");
    await uploadBase(page);
    await paint(page, "1", [[0.78, 0.25, 0.6], [0.9, 0.05, 0.6]]);
    await paint(page, "2", [[0.4, 0.27, 0.32], [0.45, 0.9, 0.97]]);
    await paint(page, "3", [[0.06, 0.2, 0.8], [0.14, 0.3, 0.7]]);
    // Walls and ceiling masked with nothing protected: the window would be repainted too.
    const exposed = inspector(page).getByRole("note").filter({ hasText: "nothing is protected" });
    await expect(exposed).toBeVisible();
    await paint(page, "0", [[0.45, 0.4, 0.6]]);
    await expect(exposed).toHaveCount(0);
    await addReference(page, "Floor", "marble.png");
    await addReference(page, "Walls", "oak.png");
    await card(page, "Ceiling").locator("select").selectOption("aluminium-linear-ceiling");
    const generate = page.getByRole("button", { name: /Generate 3 surfaces/ });
    await expect(generate).toBeEnabled();
    await generate.click();

    await expect(page.locator("aside").first().getByText("Render 1")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Compare" })).toBeEnabled();

    // 1st graph encodes references (CLIP Vision alone); 2nd renders with cached embeddings.
    const [encode, render] = comfy.prompts;
    expect(classTypes(encode)).toContain("IPAdapterEncoder");
    expect(classTypes(encode)).not.toContain("KSampler");
    expect(classTypes(render)).toContain("KSampler");
    expect(classTypes(render)).not.toContain("CLIPVisionLoader");
    expect(classTypes(render).filter((t) => t === "IPAdapterEmbeds")).toHaveLength(2);
    // Three regional prompts: floor, walls and the text-only ceiling material.
    const regional = Object.values(render).filter((n) => n.class_type === "ConditioningSetMask");
    expect(regional).toHaveLength(3);
    const sampler = Object.values(render).find((n) => n.class_type === "KSampler")!;
    expect(sampler.inputs.cfg).toBe(1);
    expect(sampler.inputs.denoise).toBe(0.75);
    expect(classTypes(render)).not.toContain("ImageUpscaleWithModel");
    // Geometry: on this CPU host the depth lock runs alone (no Canny) on an fp8 UNet, and the
    // references transfer finish only ("style transfer"), never objects or layout.
    expect(classTypes(render)).toContain("DA3Inference");
    expect(classTypes(render)).not.toContain("Canny");
    expect(classTypes(render).filter((t) => t === "ControlNetApplyAdvanced")).toHaveLength(1);
    const depthLock = Object.values(render).find((n) => n.class_type === "ControlNetApplyAdvanced")!;
    expect(depthLock.inputs.end_percent).toBe(1);
    expect(Object.values(render).find((n) => n.class_type === "UNETLoader")?.inputs.weight_dtype).toBe("fp8_e4m3fn");
    for (const n of Object.values(render).filter((n) => n.class_type === "IPAdapterEmbeds")) expect(n.inputs.weight_type).toBe("style transfer");

    // 4K on demand
    await page.getByRole("button", { name: /^4K$/ }).click();
    await expect(page.getByText(/4K ready/)).toBeVisible({ timeout: 30_000 });
    expect(classTypes(comfy.prompts.at(-1)!)).toContain("ImageUpscaleWithModel");

    // Compare / result views
    await page.getByRole("button", { name: "Result", exact: true }).click();
    await expect(page.locator('img[alt="Render"]')).toBeVisible();

    // Proposal PDF (real server route, system Chrome)
    await page.getByRole("button", { name: "Proposal" }).click();
    const download = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: /Export PDF/ }).click();
    expect((await download).suggestedFilename()).toMatch(/proposal\.pdf$/);
  });

  test("a second render reuses cached embeddings and loaded models", async ({ page }) => {
    const comfy = await mockComfy(page);
    await page.goto("/");
    await uploadBase(page);
    await paint(page, "1", [[0.85, 0.05, 0.6]]);
    await addReference(page, "Floor", "marble.png");
    await page.getByRole("button", { name: /Generate 1 surface/ }).click();
    await expect(page.locator("aside").first().getByText("Render 1")).toBeVisible({ timeout: 60_000 });
    const firstRunPrompts = comfy.prompts.length;
    const firstRunFrees = comfy.frees.length;
    await page.getByRole("button", { name: /Generate 1 surface/ }).click();
    await expect(page.locator("aside").first().getByText("Render 2")).toBeVisible({ timeout: 60_000 });
    expect(comfy.prompts.length - firstRunPrompts, "no second encode job").toBe(1);
    expect(comfy.frees.length - firstRunFrees, "no model eviction between consecutive renders").toBe(0);
  });

  test("offline ComfyUI is reported, not mistaken for missing models", async ({ page }) => {
    await mockComfy(page, { online: false });
    await page.goto("/");
    await expect(page.getByText("ComfyUI offline")).toBeVisible();
    await uploadBase(page);
    await page.getByRole("button", { name: "Render", exact: true }).click();
    await expect(inspector(page).getByText("ComfyUI is offline.")).toBeVisible();
    await expect(inspector(page).getByText(/required models? missing/)).toHaveCount(0);
  });

  test("--fp16-unet on CPU is caught before a render with references", async ({ page }) => {
    const comfy = await mockComfy(page, { argv: ["main.py", "--cpu", "--fp16-unet"] });
    await page.goto("/");
    await uploadBase(page);
    await paint(page, "1", [[0.85, 0.05, 0.6]]);
    await addReference(page, "Floor", "marble.png");
    await page.getByRole("button", { name: /Generate 1 surface/ }).click();
    await expect(page.getByText(/breaks reference images on CPU/)).toBeVisible();
    expect(comfy.prompts).toHaveLength(0);
  });

  test("dropping a file onto a drop zone clears the dimmed drag state", async ({ page }) => {
    await mockComfy(page);
    await page.goto("/");
    await uploadBase(page);
    const png = (await import("node:fs")).readFileSync(path.join(FIXTURES, "marble.png")).toString("base64");
    const dt = await page.evaluateHandle((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const t = new DataTransfer();
      t.items.add(new File([bytes], "marble.png", { type: "image/png" }));
      return t;
    }, png);
    const zone = card(page, "Floor").locator(".drop-zone").first();
    await zone.dispatchEvent("dragenter", { dataTransfer: dt });
    await expect(page.locator(".dragging")).toHaveCount(1);
    await zone.dispatchEvent("dragover", { dataTransfer: dt });
    await zone.dispatchEvent("drop", { dataTransfer: dt });
    await expect(page.locator(".dragging")).toHaveCount(0);
    await expect(card(page, "Floor").locator("div.group.relative")).toHaveCount(1);
  });

  test("deleting a project removes it", async ({ page }) => {
    await mockComfy(page);
    await page.goto("/");
    await uploadBase(page);
    page.once("dialog", (d) => d.accept());
    const row = page.locator("aside").first().locator("div.group").filter({ has: page.getByRole("textbox", { name: "Project name" }) }).first();
    await row.hover();
    await row.getByRole("button", { name: "Delete room" }).click();
    await expect(page.getByText("No projects yet.")).toBeVisible();
  });
});
