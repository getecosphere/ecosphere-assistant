// Side-by-side: the real panel (left) next to the matching design screen (right), saved to e2e/shots/<phase>/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCREENS = path.resolve(here, "..", "docs", "handover", "screens");

/// crop: [x, y, w, h] of the design image (1440×900 window screens: panel = [1040, 79, 400, 821]).
export async function compare(ctx, phase, name, panelPng, design, crop) {
  const out = path.join(here, "shots", phase);
  fs.mkdirSync(out, { recursive: true });
  const d = fs.readFileSync(path.join(SCREENS, design)).toString("base64");
  const p = panelPng.toString("base64");
  const [x, y, w, h] = crop || [0, 0, 400, 900];
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 880, height: 960 });
  await page.setContent(`<body style="margin:0;background:#ddd;font:12px monospace;display:flex;gap:16px;padding:16px">
    <div><div>real build</div><img src="data:image/png;base64,${p}" style="width:400px;display:block;border:1px solid #999"></div>
    <div><div>design · ${design}</div><div style="width:${w}px;height:${h}px;overflow:hidden;border:1px solid #999;position:relative"><img src="data:image/png;base64,${d}" style="position:absolute;left:-${x}px;top:-${y}px"></div></div></body>`);
  await page.waitForTimeout(150);
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
  return file;
}

export const PANEL = [1040, 79, 400, 821];
