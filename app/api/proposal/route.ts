import fs from "node:fs";
import path from "node:path";
import { renderProposalHtml, type ProposalPayload } from "@/lib/proposal";
import { findBrowser } from "@/lib/server/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

let fontCss: string | null = null;

/** Inter, embedded as a data URL so PDF export works offline and never waits on Google Fonts. */
function interFontFace(): string {
  if (fontCss !== null) return fontCss;
  try {
    const file = path.join(process.cwd(), "node_modules", "@fontsource-variable", "inter", "files", "inter-latin-wght-normal.woff2");
    fontCss = `@font-face { font-family: Inter; font-style: normal; font-weight: 100 900; src: url(data:font/woff2;base64,${fs.readFileSync(file).toString("base64")}) format("woff2"); }`;
  } catch {
    fontCss = ""; // fall back to the system font stack
  }
  return fontCss;
}

/** POST a ProposalPayload; returns application/pdf, or the HTML with ?format=html. */
export async function POST(req: Request) {
  const payload = (await req.json()) as ProposalPayload;
  const html = renderProposalHtml(payload, interFontFace());
  if (new URL(req.url).searchParams.get("format") === "html") {
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const executablePath = findBrowser();
  if (!executablePath) {
    return Response.json({ error: "No Chrome or Edge found for PDF export. Set CHROME_PATH, or use Print → Save as PDF." }, { status: 501 });
  }
  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const page = await browser.newPage();
    // Everything (images, font) is inlined, so "load" is reached without network access.
    await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      // Footers come from CSS @page margin boxes (see lib/proposal.ts) so the cover can omit them.
      displayHeaderFooter: false,
    });
    const safe = payload.project.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "proposal";
    return new Response(Buffer.from(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${safe}-proposal.pdf"` },
    });
  } finally {
    await browser.close();
  }
}
