// Project tab: hosting card, deploy of the local version (gated), live log.
import { h, clear } from "./dom.js";
import { t } from "./i18n.js";
import { S, call, notify, gateTier } from "./app.js";
import * as bridge from "./bridge.js";

const P = { st: null, plan: null, err: "", confirm: false, deploying: false, log: [], done: "", loading: false, ref: null };
const WAITLIST = "https://getecosphere.com/api/auth/google/login?intent=launch";

export function mountProject(root) {
  const el = h("div", { class: "screen hidden", "data-view": "project" });
  root.append(el);
  P.ref = el;
  return { el, refresh };
}

export async function refresh() {
  if (!S.active || !P.ref) return;
  P.loading = true;
  P.err = "";
  paint();
  const dir = S.active.dir;
  const [st, plan] = await Promise.allSettled([call("eco.status", { dir }), call("eco.plan")]);
  P.st = st.status === "fulfilled" ? st.value : null;
  P.plan = plan.status === "fulfilled" ? plan.value : null;
  if (st.status === "rejected" && !/git repository|Not logged/.test(st.reason.message)) P.err = st.reason.message;
  P.loading = false;
  paint();
}

const domain = (e) => e.hostnames[0] || (e.serve ? `${e.serve}.getecosphere.app` : "");

function paint() {
  const el = P.ref;
  const e = S.active;
  if (!el || !e) return;
  clear(el, h("div", { class: "scroll" }, P.err && h("div", { class: "err", "data-err": "project" }, P.err, h("button", { class: "btn g", onclick: refresh, text: t("retry", "Retry") })), hosting(e), h("div", { class: "crow" }, h("button", { class: "btn g", onclick: () => chrome.tabs.create({ url: (S.pm && S.pm.dashboard) || "https://getecosphere.com/project" }), text: `${t("proj.open", "Open /project")} ↗` }))));
}

function hosting(e) {
  const paid = gateTier() === "paid";
  const live = e.hosting === "deploy";
  const st = P.st;
  const meta = [live && st && st.deployed ? `${t("proj.release", "live")} ${String(st.live).slice(0, 7)}` : null, P.plan && P.plan.label, `${e.services} ${t("proj.services", "services")}`].filter(Boolean);
  const head = h("div", { class: "crow", style: { justifyContent: "space-between", flexWrap: "nowrap" } }, h("span", { class: "lbl", text: t("proj.hosting", "Hosting") }), h("span", { class: `chip ${live && st && st.deployed ? "c-ok" : "c-mut"}`, text: live ? (st && st.deployed ? "live" : t("proj.notLive", "not deployed")) : "serve" }));
  const name = h("div", { style: { fontWeight: "800", fontSize: "16px", letterSpacing: "-.02em" }, text: domain(e) || e.project });
  const kv = h("div", { class: "kv", text: meta.join(" · ") });
  if (!paid || !live) return h("div", { class: "card lockedcard", "data-card": "hosting" }, head, name, kv, locked(live, paid));
  const ahead = st && st.deployed ? st.ahead : null;
  return h(
    "div",
    { class: "card lockedcard", "data-card": "hosting" },
    head,
    name,
    kv,
    h("div", { class: "crow" }, h("button", { class: "btn", "data-act": "deploy", disabled: P.deploying || P.loading, onclick: () => ((P.confirm = true), paint()), text: t("proj.deploy", "Deploy local version") })),
    P.confirm && !P.deploying && h("div", { class: "confirm", "data-confirm": "deploy" }, h("b", { text: t("proj.confirm", "Deploy the local version to {d}?", { d: domain(e) }) }), h("span", { class: "muted", style: { fontSize: "12.5px" }, text: (ahead != null ? (ahead > 0 ? t("proj.ahead", "{n} commits not deployed yet · ", { n: ahead }) : t("proj.upToDate", "everything committed is already live · ")) : "") + t("proj.local", "built on your machine, source not sent.") }), h("div", { class: "crow" }, h("button", { class: "btn", "data-act": "deploy-go", onclick: deploy, text: t("proj.go", "Deploy") }), h("button", { class: "btn g", onclick: () => ((P.confirm = false), paint()), text: t("cancel", "Cancel") }))),
    (P.log.length > 0 || P.deploying) && h("pre", { class: "log", "data-log": "deploy" }, P.log.slice(-60).join("\n")),
    P.done && h("div", { class: P.done === "ok" ? "dn" : "err", "data-done": P.done }, P.done === "ok" ? h("b", { text: `✓ ${t("proj.deployed", "Deployed.")}` }) : t("proj.failed", "Deploy failed. See the log above.")),
  );
}

function locked(live, paid) {
  return h("div", { "data-locked": "" }, h("p", { style: { margin: "0 0 8px", fontSize: "13px", color: "var(--muted)" }, text: !live ? t("proj.serveOnly", "This project runs with eco serve on your machine (free). Permanent hosting and deploys are on the paid plans.") : t("proj.paidOnly", "Deploys, rollback and backups are on the paid plans.") }), !paid && h("div", { class: "crow" }, h("span", { class: "chip c-w", text: t("proj.soon", "opens soon") }), h("button", { class: "btn g", "data-act": "waitlist", onclick: () => chrome.tabs.create({ url: WAITLIST }), text: `${t("proj.waitlist", "Join the waitlist")} →` })));
}

async function deploy() {
  P.confirm = false;
  P.deploying = true;
  P.done = "";
  P.log = [];
  paint();
  try {
    await call("eco.deploy", { dir: S.active.dir }, { onEvent: (m) => m.event === "log" && (P.log.push(m.line), paint()) });
    P.done = "ok";
  } catch (e) {
    P.log.push(e.message);
    P.done = "fail";
  }
  P.deploying = false;
  paint();
  refresh();
  notify();
}

export { bridge };
