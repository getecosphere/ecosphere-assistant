// Toolbar/store icons = the P4 LED mark (brand.md): 4×5 dots, D1 geometry, 13 lit. Transparent PNGs.
// Run:  cd e2e && node make-icons.mjs
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "icons");
const COL = { V: "#7048F5", B: "#2B8CF5", G: "#18B47B", C: "#F2593A" };
const PAT = ["VBBB", "V...", "VGG.", "V...", "VCCC"];

function svg(size) {
  const pad = size * 0.08, pitch = (size - pad * 2) / 5, d = pitch * 0.84, r = d / 2;
  const x0 = pad + (size - pad * 2 - (4 * pitch - (pitch - d))) / 2;
  let dots = "";
  for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) {
    const g = PAT[y][x];
    dots += `<circle cx="${(x0 + x * pitch + r).toFixed(2)}" cy="${(pad + y * pitch + r).toFixed(2)}" r="${r.toFixed(2)}" fill="${g === "." ? "rgba(23,20,29,.10)" : COL[g]}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${dots}</svg>`;
}

const b = await chromium.launch({ channel: "chromium" });
const p = await b.newPage();
for (const s of [16, 32, 48, 128]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<body style="margin:0;background:transparent">${svg(s)}</body>`);
  fs.writeFileSync(path.join(out, `icon${s}.png`), await p.screenshot({ omitBackground: true }));
}
await b.close();
console.log("icons written");
