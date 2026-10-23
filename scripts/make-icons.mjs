// Renders the PWA PNG icons from public/icons/icon.svg. Run: node scripts/make-icons.mjs
import sharp from "sharp";
import fs from "node:fs";

const svg = fs.readFileSync("public/icons/icon.svg");
await sharp(svg).resize(192, 192).png().toFile("public/icons/icon-192.png");
await sharp(svg).resize(512, 512).png().toFile("public/icons/icon-512.png");
// Maskable: keep the mark inside the 80% safe zone on a full-bleed background.
const inner = await sharp(svg).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#2F2F2F" } })
  .composite([{ input: inner, top: 56, left: 56 }])
  .png()
  .toFile("public/icons/icon-maskable-512.png");
console.log("icons written");

// favicon.ico: an ICO container holding 16/32/48 px PNGs (supported by every current browser).
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => sharp(svg).resize(s, s).png().toBuffer()));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s, 0); // width
  e.writeUInt8(s, 1); // height
  e.writeUInt16LE(1, 4); // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
fs.writeFileSync("app/favicon.ico", Buffer.concat([header, ...entries, ...pngs]));
console.log("favicon written");
