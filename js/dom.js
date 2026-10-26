// Tiny DOM builder. Text always goes through textContent/createTextNode — never innerHTML.
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "text") el.textContent = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function clear(el, ...kids) {
  el.replaceChildren();
  add(el, kids);
  return el;
}

export const svg = (path, size = 16, extra = "") => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", size);
  s.setAttribute("height", size);
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2.2");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  for (const d of path.split("|")) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    s.append(p);
  }
  if (extra) s.setAttribute("class", extra);
  return s;
};

export const ICON = {
  chevron: "m6 9 6 6 6-6",
  pick: "M5 3l14 7-6 2-2 6z",
  check: "M5 12l5 5L20 7",
  x: "M6 6l12 12|M18 6L6 18",
  ext: "M7 17L17 7|M8 7h9v9",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function trapEscape(el, onClose) {
  const on = (e) => {
    if (e.key === "Escape") {
      onClose();
      cleanup();
    }
  };
  const click = (e) => {
    if (!e.target.closest(".menu, [aria-haspopup]")) {
      onClose();
      cleanup();
    }
  };
  const cleanup = () => {
    document.removeEventListener("keydown", on, true);
    document.removeEventListener("pointerdown", click, true);
  };
  document.addEventListener("keydown", on, true);
  setTimeout(() => document.addEventListener("pointerdown", click, true), 0);
  return cleanup;
}
