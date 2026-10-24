// Ecosphere logo = P4 LED: a 4×5 dot matrix in which the letter E lights up (brand.md).
// Static = all 13 lit. Running = dots light one by one (140 ms each) via CSS; reduced motion = static.
import { h } from "./dom.js";

const PAT = ["VBBB", "V...", "VGG.", "V...", "VCCC"];
const COL = { V: "#7048F5", B: "#2B8CF5", G: "#18B47B", C: "#F2593A" };

// drawing order: spine top→bottom, then top, middle, bottom arm
const ORDER = [0, 4, 8, 12, 16, 1, 2, 3, 9, 10, 17, 18, 19].map((i) => i);

export function led(size = 24, running = false) {
  const pad = size * 0.08;
  const pitch = (size - pad * 2) / 5;
  const cell = pitch * 0.84;
  const gap = pitch * 0.16;
  const el = h("span", { class: "led" + (running ? " run" : ""), role: "img", "aria-label": "Ecosphere" });
  el.style.cssText = `grid-template-columns:repeat(4,${cell}px);grid-auto-rows:${cell}px;gap:${gap}px;padding:${pad}px`;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 4; c++) {
      const g = PAT[r][c];
      const dot = h("i");
      if (g !== ".") {
        const b = h("b");
        b.style.setProperty("--c", COL[g]);
        b.style.setProperty("--k", String(ORDER.indexOf(r * 4 + c)));
        dot.append(b);
      }
      el.append(dot);
    }
  }
  return el;
}

export function setRunning(el, on) {
  el.classList.toggle("run", on);
}
