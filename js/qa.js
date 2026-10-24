// QA tab: this project's QA requests, capture the tab into a new one, and work on one with the agent.
import { h, clear } from "./dom.js";
import { t } from "./i18n.js";
import { S, call, notify } from "./app.js";
import * as page from "./page.js";

const Q = { items: null, err: "", loading: false, cap: null, busy: "", ref: null };

export const qaBadge = () => (Q.items ? Q.items.filter((i) => (i.phase || "wait") === "wait").length : (S.pm && S.pm.qaWaiting) || 0);

export function mountQa(root, { runQa, go }) {
  const el = h("div", { class: "screen hidden", "data-view": "qa" });
  root.append(el);
  Q.ref = el;
  Q.runQa = runQa;
  Q.go = go;
  return { el, refresh };
}

export async function refresh() {
  if (!S.active || !Q.ref) return;
  Q.loading = true;
  Q.err = "";
  paint();
  try {
    Q.items = (await call("eco.pm.qa", { dir: S.active.dir })).items;
    if (!Array.isArray(Q.items)) Q.items = Q.items && Q.items.qa ? Q.items.qa : [];
  } catch (e) {
    Q.err = e.message;
    Q.items = Q.items || [];
  }
  Q.loading = false;
  paint();
  notify();
}

const wait = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const dashboard = () => (S.pm && S.pm.dashboard) || "https://getecosphere.com/project";

function paint() {
  const el = Q.ref;
  if (!el) return;
  clear(el, h("div", { class: "scroll" }, toolbar(), Q.cap && capture(), Q.err && h("div", { class: "err", "data-err": "qa" }, Q.err, h("button", { class: "btn g", onclick: refresh, text: t("retry", "Retry") })), list()));
}

function toolbar() {
  return h("div", { class: "crow" }, h("button", { class: "btn", "data-act": "capture", onclick: startCapture, disabled: Boolean(Q.cap), text: t("qa.capture", "Capture tab as QA") }), h("button", { class: "btn g", onclick: () => chrome.tabs.create({ url: dashboard() }), text: `${t("qa.open", "Open in /project")} ↗` }));
}

function list() {
  if (Q.loading && !Q.items) return h("div", { class: "empty" }, t("loading", "Loading…"));
  if (!Q.items || !Q.items.length) return h("div", { class: "empty", "data-empty": "qa" }, t("qa.empty", "No QA requests for this project yet."));
  return h("div", { class: "card" }, ...Q.items.map(row));
}

function row(q) {
  const phase = q.phase || "wait";
  const chip = { wait: ["c-w", t("qa.waiting", "waiting")], work: ["c-br", t("qa.working", "in progress")], done: ["c-ok", t("qa.ready", "ready to verify")], closed: ["c-mut", t("qa.closed", "closed")] }[phase] || ["c-mut", phase];
  return h("div", { class: "qa-r", "data-qa": q.number }, h("div", { class: "grow" }, h("div", { class: "m", text: `#${q.number} · ${q.severity}${q.waitSeconds != null && phase === "wait" ? ` · ${t("qa.waited", "waiting")} ${wait(q.waitSeconds)}` : ""}` }), h("div", { class: "t", title: q.title, text: q.title })), h("span", { class: `chip ${chip[0]}`, text: chip[1] }), phase === "wait" && h("button", { class: "btn", "data-act": "work", disabled: Boolean(Q.busy), onclick: () => work(q), text: Q.busy === q.number ? "…" : t("qa.work", "Work on it") }));
}

async function work(q) {
  Q.busy = q.number;
  paint();
  try {
    await Q.runQa(q);
    Q.go("agent");
  } catch (e) {
    Q.err = e.message;
  }
  Q.busy = "";
  paint();
  refresh();
}

// ── capture ───────────────────────────────────────────────────────────────

async function startCapture() {
  const tab = S.tab;
  if (!tab) return ((Q.err = t("qa.noTab", "Open the page you want to report in the active tab first.")), paint());
  if (!page.isLocal(tab.url) && !(await page.hasAccess(tab.url)) && !(await page.requestAccess(tab.url))) return;
  try {
    const shot = await page.downscale(await page.screenshot(tab.windowId));
    Q.cap = { shot, title: "", severity: "p1", box: null, url: tab.url, viewport: `${tab.width || ""}x${tab.height || ""}`, busy: false, err: "" };
  } catch (e) {
    Q.err = e.message;
  }
  paint();
}

function capture() {
  const c = Q.cap;
  const img = h("img", { src: c.shot, alt: t("qa.shotAlt", "Screenshot of the tab") });
  const box = h("div", { class: "box", hidden: !c.box });
  const place = () => {
    if (!c.box) return (box.hidden = true);
    box.hidden = false;
    Object.assign(box.style, { left: `${c.box.fx * 100}%`, top: `${c.box.fy * 100}%`, width: `${c.box.fw * 100}%`, height: `${c.box.fh * 100}%` });
  };
  const wrap = h("div", { class: "shot", "data-shot": "" }, img, box, h("span", { class: "cap", text: t("qa.mark", "drag to mark") }));
  let start = null;
  const pt = (e) => {
    const r = wrap.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  wrap.addEventListener("pointerdown", (e) => ((start = pt(e)), wrap.setPointerCapture(e.pointerId)));
  wrap.addEventListener("pointermove", (e) => {
    if (!start) return;
    const p = pt(e);
    c.box = { fx: Math.min(start.x, p.x), fy: Math.min(start.y, p.y), fw: Math.abs(p.x - start.x), fh: Math.abs(p.y - start.y) };
    place();
  });
  wrap.addEventListener("pointerup", () => (start = null));
  place();
  return h(
    "div",
    { class: "card", style: { padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }, "data-card": "capture" },
    h("span", { class: "lbl", text: t("qa.new", "New QA · from this tab") }),
    wrap,
    h("label", { class: "lbl" }, t("qa.title", "Title"), h("input", { class: "field", "data-field": "title", value: c.title, oninput: (e) => (c.title = e.target.value), style: { marginTop: "4px", textTransform: "none", letterSpacing: "0", fontFamily: "var(--sans)", fontSize: "14px", color: "var(--ink)" } })),
    h("div", { class: "seg", role: "group", "aria-label": t("qa.severity", "Severity") }, ...["p0", "p1", "p2"].map((s) => h("button", { type: "button", "aria-pressed": String(c.severity === s), "data-sev": s, onclick: () => ((c.severity = s), paint()), text: s }))),
    c.err && h("div", { class: "err" }, c.err),
    h("div", { class: "crow" }, h("button", { class: "btn", "data-act": "send-qa-new", disabled: c.busy, onclick: submit, text: t("qa.send", "Send QA") }), h("button", { class: "btn g", onclick: () => ((Q.cap = null), paint()), text: t("cancel", "Cancel") }), h("span", { class: "mono subtle", style: { fontSize: "11px" }, text: t("qa.auto", "url + browser attached automatically") })),
  );
}

async function submit() {
  const c = Q.cap;
  if (!c.title.trim()) return ((c.err = t("qa.needTitle", "Add a title.")), paint());
  c.busy = true;
  c.err = "";
  paint();
  try {
    const img = await new Promise((r) => {
      const i = new Image();
      i.onload = () => r(i);
      i.src = c.shot;
    });
    const box = c.box ? { x: c.box.fx * img.width, y: c.box.fy * img.height, w: c.box.fw * img.width, h: c.box.fh * img.height } : null;
    await call("eco.pm.qa.new", { dir: S.active.dir, title: c.title.trim(), severity: c.severity, url: c.url, ua: navigator.userAgent, os: navigator.platform, viewport: c.viewport.replace(/^x$/, ""), box, shot: c.shot });
    Q.cap = null;
    await refresh();
  } catch (e) {
    c.err = /unknown|Usage|usage/i.test(e.message) ? t("qa.needNewer", "Creating a QA from the panel needs a newer eco and /project. Report it in /project for now.") : e.message;
    c.busy = false;
    paint();
  }
}
