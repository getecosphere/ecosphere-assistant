// Compose tab: the estate's LXS (from ecompose.yml + eco.lock), add/remove through `eco`, run dev.
import { h, clear } from "./dom.js";
import { t } from "./i18n.js";
import { S, call, notify } from "./app.js";
import * as bridge from "./bridge.js";

const C = { catalog: null, q: "", busy: "", log: [], err: "", running: false, ref: null };

export function mountCompose(root) {
  const el = h("div", { class: "screen hidden", "data-view": "compose" });
  root.append(el);
  C.ref = el;
  return { el, refresh };
}

export async function refresh() {
  if (!S.active || !C.ref) return;
  try {
    const info = await call("estate.info", { dir: S.active.dir });
    S.estates = S.estates.map((e) => (e.dir === info.dir ? info : e));
    S.active = info;
  } catch (e) {
    C.err = e.message;
  }
  if (!C.catalog) call("lxs.catalog").then((r) => ((C.catalog = r.lxs), paint())).catch(() => (C.catalog = []));
  paint();
}

function paint() {
  const el = C.ref;
  const e = S.active;
  if (!el || !e) return;
  const have = new Set(e.lxs.map((x) => x.name));
  const q = C.q.trim().toLowerCase();
  const sugg = (C.catalog || []).filter((c) => !have.has(c.name) && (!q || c.name.includes(q))).slice(0, 6);
  clear(
    el,
    h(
      "div",
      { class: "scroll" },
      C.err && h("div", { class: "err", "data-err": "compose" }, C.err),
      h("div", { class: "card", "data-card": "lxs" }, h("div", { class: "row" }, h("span", { class: "lbl grow", text: "ecompose.yml · LXS" }), h("span", { class: "mono subtle", style: { fontSize: "11px" }, text: `${e.services} ${t("proj.services", "services")}` })), e.lxs.length === 0 && h("div", { class: "empty", text: t("compose.none", "No LXS in this estate yet.") }), ...e.lxs.map((x) => h("div", { class: "lxs", "data-lxs": x.name }, h("b", { text: x.name }), h("span", { class: "ver", text: x.version }), h("span", { class: "grow" }), h("span", { class: `chip ${x.signed ? "c-ok" : "c-mut"}`, text: x.signed ? `${t("compose.signed", "signed")} ✓` : t("compose.unsigned", "unsigned") }), h("button", { class: "rm", "aria-label": t("compose.remove", "Remove {n}", { n: x.name }), title: t("compose.remove", "Remove {n}", { n: x.name }), disabled: Boolean(C.busy), onclick: () => run("eco.lxs.remove", x.name), text: "×" })))),
      h(
        "div",
        { class: "card", style: { padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }, "data-card": "add" },
        h("span", { class: "lbl", text: t("compose.add", "Add a capability") }),
        h("input", { class: "field", "data-field": "lxs", placeholder: t("compose.ph", "search LXS: payment, email, search…"), value: C.q, "aria-label": t("compose.add", "Add a capability"), oninput: (ev) => ((C.q = ev.target.value), paint(), document.querySelector('[data-field="lxs"]').focus(), document.querySelector('[data-field="lxs"]').setSelectionRange(C.q.length, C.q.length)), onkeydown: (ev) => ev.key === "Enter" && C.q.trim() && run("eco.lxs.add", C.q.trim()) }),
        h("div", { class: "sugs" }, ...sugg.map((c) => h("button", { class: "cc", "data-add": c.name, disabled: Boolean(C.busy), onclick: () => run("eco.lxs.add", `${c.name}@${c.version}`), text: `+ ${c.name}@${c.version}` }))),
      ),
      h("div", { class: "crow" }, h("button", { class: "btn g", "data-act": "up-dev", disabled: C.running || Boolean(C.busy), onclick: upDev, text: C.running ? t("compose.starting", "Starting…") : "eco up dev ↻" })),
      (C.log.length > 0 || C.busy) && h("pre", { class: "log", "data-log": "compose" }, C.log.slice(-40).join("\n")),
    ),
  );
}

async function run(action, name) {
  C.busy = name;
  C.err = "";
  C.log = [`$ eco lxs ${action.endsWith("add") ? "add" : "remove"} ${name}`];
  paint();
  try {
    const r = await call(action, { dir: S.active.dir, name });
    if (r.output) C.log.push(r.output);
    C.q = "";
    await refresh();
  } catch (e) {
    C.err = e.message;
  }
  C.busy = "";
  paint();
  notify();
}

async function upDev() {
  C.running = true;
  C.log = ["$ eco up dev"];
  C.err = "";
  paint();
  let id = 0;
  try {
    await call("eco.up.dev", { dir: S.active.dir }, { idOut: (i) => (id = i), onEvent: (m) => {
      if (m.event !== "log") return;
      C.log.push(m.line);
      paint();
      // `eco up dev` stays attached streaming logs; the estate keeps running once we detach.
      if (/\d+\s*\/\s*\d+\s+services online/i.test(m.line) || /services online/i.test(m.line)) bridge.cancel(id);
    } });
  } catch (e) {
    C.err = e.message;
  }
  C.running = false;
  paint();
}
