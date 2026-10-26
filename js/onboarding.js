// Onboarding (F): one checklist that resumes where it stopped. Each step is derived from real state.
import { h, clear } from "./dom.js";
import { t } from "./i18n.js";
import { led } from "./led.js";
import { replayIntro } from "./intro.js";
import { S, call, notify, setBoot, refreshHelper, refreshWho, refreshEstates, refreshPm, selectProject, flags } from "./app.js";
import { pref, setPref } from "./prefs.js";
import { matchEstate } from "./page.js";

const HELPER_URL = "https://getecosphere.com/downloads/helper-install.sh";

const ui = { login: null, loginUrl: "", loginLog: [], loginBusy: false, install: [], installBusy: false, installErr: "", scan: null, scanning: false, pick: "", linkBusy: false, linkErr: "", checking: false };

const osName = () => (/Windows/i.test(navigator.userAgent) ? "windows" : /Mac/i.test(navigator.userAgent) ? "mac" : "linux");

export function steps() {
  const signed = Boolean(S.who && S.who.signedIn);
  const confirmed = signed && pref("account", "") === S.who.email;
  return [
    { id: "login", done: confirmed },
    { id: "helper", done: Boolean(S.helper) },
    { id: "opencode", done: Boolean(S.helper && (S.helper.opencode || (S.helper.claude && pref("agent", "opencode") === "claude"))) },
    { id: "project", done: S.estates.length > 0 },
    { id: "link", done: Boolean(S.pm && S.pm.linked), optional: !flags().pm },
  ];
}

/// Onboarding shows until steps 1–4 are done (step 5 only when /project is enabled).
export const needsOnboarding = () => steps().some((s) => !s.done && !s.optional);

export function mountOnboarding(root) {
  const el = h("div", { class: "ob" });
  root.append(el);
  const render = () => paint(el);
  render();
  return render;
}

async function recheck() {
  ui.checking = true;
  setBoot({ label: t("boot.helper", "Looking for the helper…"), pct: 25 });
  await refreshHelper();
  if (S.helper) {
    setBoot({ label: t("boot.account", "Checking your sign-in and projects…"), pct: 60 });
    await Promise.all([refreshWho(), refreshEstates()]);
    setBoot({ label: t("boot.pm", "Checking the /project link…"), pct: 90 });
    await refreshPm();
  }
  ui.checking = false;
  setBoot(null);
}

function paint(el) {
  const list = steps();
  const cur = !S.helper ? 1 : list.findIndex((s) => !s.done && !s.optional);
  const doneN = list.filter((s) => s.done).length;
  const req = list.filter((s) => !s.optional);
  const reqDone = req.filter((s) => s.done).length;
  clear(
    el,
    h("div", { class: "progress ob-prog", role: "progressbar", "aria-label": t("ob.progress", "Setup progress"), "aria-valuemin": "0", "aria-valuemax": String(req.length), "aria-valuenow": String(reqDone), "data-ob-progress": "" }, h("i", { style: { width: `${Math.round((reqDone / req.length) * 100)}%` } })),
    h("div", { class: "ob-hero" }, led(64, ui.loginBusy || ui.installBusy || ui.checking), h("h1", { text: t("ob.title", "A coding agent beside your page") }), h("p", { text: t("ob.sub", "The code stays on your machine. This panel sets everything up; you only approve.") })),
    ...list.map((s, i) => stepEl(s, i, cur)),
    h("div", { class: "ob-foot" }, h("span", { class: "grow", text: t("ob.foot", "helper · opencode · eco · all local") }), h("span", { text: `${Math.min(doneN + 1, 5)}/5` }), h("button", { class: "btn g", "data-act": "tour", onclick: replayIntro, text: t("ob.tour", "How it works") }), h("button", { class: "btn g", onclick: recheck, disabled: ui.checking, text: t("ob.retry", "Check again") })),
  );
}

function stepEl(s, i, cur) {
  const state = s.done ? "done" : i === cur ? "cur" : "";
  const copy = {
    login: [t("ob.login.t", "Sign in"), t("ob.login.d", "One account for the extension, the eco CLI and /project.")],
    helper: [t("ob.helper.t", "Helper installed"), t("ob.helper.d", "A small program that runs your coding agent and eco for you, with a fixed list of actions.")],
    opencode: [t("ob.oc.t", "Coding agent"), t("ob.oc.d", "OpenCode, installed for you if it is missing, or Claude Code if you already use it.")],
    project: [t("ob.project.t", "Pick a project"), t("ob.project.d", "A folder with an ecompose.yml on this machine. The one matching the active tab is marked.")],
    link: [t("ob.link.t", "Connect to /project"), t("ob.link.d", "eco pm link — QA requests arrive in this panel and session summaries appear in /project.")],
  }[s.id];
  const body = i === cur || (s.id === "link" && s.optional === false && !s.done && cur === -1) ? stepBody(s.id) : null;
  return h("div", { class: `step ${state}`, "data-step": s.id }, h("span", { class: "n", "aria-hidden": "true", text: s.done ? "✓" : String(i + 1) }), h("div", { class: "body" }, h("h2", { text: copy[0] }), h("p", { text: copy[1] }), s.id === "opencode" && agentLogos(), body));
}

/// The two agents with their logos and whether this machine has them.
function agentLogos() {
  const has = { opencode: Boolean(S.helper && S.helper.opencode), claude: Boolean(S.helper && S.helper.claude) };
  const one = (kind, name) => h("span", { class: "agentlogo" + (has[kind] ? " on" : ""), "data-agent": kind }, h("img", { src: `icons/agents/${kind}.svg`, alt: "", width: 16, height: 16 }), h("b", { text: name }), h("span", { text: has[kind] ? t("ob.agentHas", "installed") : t("ob.agentNo", "not found") }));
  return h("div", { class: "agentlogos" }, one("opencode", "OpenCode"), one("claude", "Claude Code"));
}

function stepBody(id) {
  return { login, helper, opencode, project, link }[id]();
}

// 1 ─ sign in
function login() {
  const signed = Boolean(S.who && S.who.signedIn);
  return h(
    "div",
    { class: "body" },
    signed && h("button", { class: "btn", "data-act": "use-cli", onclick: () => (setPref("account", S.who.email), notify()), text: t("ob.useCli", "Use the eco account on this machine · {email}", { email: S.who.email }) }),
    h("button", { class: signed ? "btn g" : "btn", "data-act": "google", disabled: ui.loginBusy, onclick: googleLogin, text: ui.loginBusy ? t("ob.waiting", "Waiting for you in the browser…") : t("ob.google", "Sign in with Google") }),
    ui.loginUrl && /^https?:\/\//.test(ui.loginUrl) && h("p", { class: "subtle", style: { fontSize: "12.5px" } }, t("ob.loginUrl", "If no tab opened:"), " ", h("a", { href: ui.loginUrl, target: "_blank", rel: "noopener", "data-act": "open-login", text: t("ob.loginOpen", "Open the sign-in page") })),
    ui.login && h("div", { class: "err" }, ui.login),
  );
}

async function googleLogin() {
  ui.loginBusy = true;
  ui.login = null;
  ui.loginUrl = "";
  notify();
  try {
    await call("eco.login", {}, { onEvent: (m) => m.event === "url" && ((ui.loginUrl = m.url), notify()) });
    await refreshWho();
    if (S.who && S.who.signedIn) setPref("account", S.who.email);
  } catch (e) {
    ui.login = e.message;
  }
  ui.loginBusy = false;
  notify();
}

// 2 ─ helper
function helper() {
  const os = osName();
  const cmd = `curl -fsSL ${HELPER_URL} | bash`;
  if (os === "windows") return h("div", { class: "err" }, t("ob.helper.win", "Windows is not supported yet. It is on the roadmap via WSL (run Chrome and the helper inside WSL)."));
  return h(
    "div",
    { class: "body" },
    h("p", { class: "subtle", style: { margin: 0 } }, os === "mac" ? t("ob.helper.mac", "Open Terminal and run this once (macOS):") : t("ob.helper.linux", "Run this once in a terminal (Linux):")),
    h("pre", { class: "log", "data-cmd": "" }, cmd),
    h("div", { class: "crow" }, h("button", { class: "btn g", onclick: () => navigator.clipboard.writeText(cmd).catch(() => {}), text: t("ob.copy", "Copy command") }), h("button", { class: "btn", "data-act": "recheck-helper", onclick: recheck, text: t("ob.recheck", "Check again") })),
    S.helperError && h("p", { class: "subtle mono", style: { fontSize: "11px", margin: 0 }, text: S.helperError }),
    h("p", { class: "subtle mono", style: { fontSize: "11px", margin: 0 } }, `${t("ob.extid", "extension id")}: ${chrome.runtime.id}`),
  );
}

// 3 ─ opencode
function opencode() {
  return h(
    "div",
    { class: "body" },
    (ui.install.length > 0 || ui.installBusy) && h("pre", { class: "log", "data-log": "install" }, ui.install.slice(-12).join("\n")),
    ui.installErr && h("div", { class: "err" }, ui.installErr),
    h("button", { class: "btn br", "data-act": "install-oc", disabled: ui.installBusy, onclick: installOc, text: ui.installBusy ? t("ob.installing", "Installing…") : t("ob.install", "Install OpenCode") }),
    S.helper && S.helper.claude && h("button", { class: "btn g", "data-act": "use-claude", disabled: ui.installBusy, onclick: () => (setPref("agent", "claude"), notify()), text: t("ob.useClaude", "Use Claude Code instead") }),
  );
}

async function installOc() {
  ui.installBusy = true;
  ui.installErr = "";
  ui.install = [];
  notify();
  try {
    await call("oc.install", {}, { onEvent: (m) => m.event === "log" && (ui.install.push(m.line), notify()) });
    await refreshHelper();
  } catch (e) {
    ui.installErr = e.message;
  }
  ui.installBusy = false;
  notify();
}

// 4 ─ project
function project() {
  if (ui.scan === null && !ui.scanning) scan();
  const list = ui.scan || [];
  const mine = S.tab ? matchEstate(S.tab.url, list) : null;
  if (!ui.pick && list.length) ui.pick = (mine || list[0]).dir;
  return h(
    "div",
    { class: "body" },
    ui.scanning && h("p", { class: "subtle", text: t("ob.scanning", "Looking for projects…") }),
    !ui.scanning && list.length === 0 && h("p", { class: "subtle" }, t("ob.noProjects", "No folder with an ecompose.yml found in your usual places. Create one with"), " ", h("code", { text: "eco init" }), "."),
    list.length > 0 && h("div", { class: "card", role: "radiogroup", "aria-label": t("ob.project.t", "Pick a project") }, ...list.map((e) => h("button", { class: "opt", role: "radio", "aria-checked": String(ui.pick === e.dir), "data-dir": e.dir, onclick: () => ((ui.pick = e.dir), notify()) }, h("b", { text: e.project }), h("span", { text: e.dir.replace(/^\/(Users|home)\/[^/]+/, "~") }), mine && mine.dir === e.dir && h("span", { class: "chip c-br tag", text: t("ob.matchesTab", "matches this tab") })))),
    list.length > 0 && h("button", { class: "btn br", "data-act": "approve", onclick: approve, text: t("ob.connect", "Connect") }),
    h("button", { class: "btn g", onclick: () => ((ui.scan = null), notify()), text: t("ob.rescan", "Scan again") }),
  );
}

async function scan() {
  ui.scanning = true;
  try {
    ui.scan = (await call("estate.scan")).estates;
  } catch {
    ui.scan = [];
  }
  ui.scanning = false;
  notify();
}

async function approve() {
  if (!ui.pick) return;
  await call("estate.approve", { dir: ui.pick });
  await refreshEstates();
  await selectProject(ui.pick);
  await refreshPm();
}

// 5 ─ /project
function link() {
  return h(
    "div",
    { class: "body" },
    ui.linkErr && h("div", { class: "err" }, ui.linkErr),
    h("button", { class: "btn br", "data-act": "pm-link", disabled: ui.linkBusy, onclick: pmLink, text: ui.linkBusy ? t("ob.linking", "Linking…") : t("ob.linkBtn", "Connect to /project") }),
  );
}

async function pmLink() {
  ui.linkBusy = true;
  ui.linkErr = "";
  notify();
  try {
    await call("eco.pm.link", { dir: S.active.dir });
    await refreshPm();
  } catch (e) {
    ui.linkErr = e.message;
  }
  ui.linkBusy = false;
  notify();
}
