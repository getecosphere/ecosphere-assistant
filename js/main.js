import { h, clear, svg, ICON, trapEscape } from "./dom.js";
import { t, initLang } from "./i18n.js";
import { led } from "./led.js";
import { loadPrefs, pref, setPref, applyTheme } from "./prefs.js";
import { S, subscribe, notify, call, refreshHelper, refreshWho, refreshEstates, refreshPm, refreshTab, selectProject, flags } from "./app.js";
import { needsOnboarding, mountOnboarding } from "./onboarding.js";
import { mountAgent, agentState, onAgentStatus } from "./agent.js";
import { mountQa, qaBadge, refresh as refreshQa } from "./qa.js";
import { mountProject, refresh as refreshProject } from "./project.js";
import { mountCompose, refresh as refreshCompose } from "./compose.js";

const root = document.getElementById("app");
let header, tabs, stage, menu = null, closeMenu = () => {};
let agent, onboardingPaint, views = {};
let shown = ""; // which view's data was last refreshed

async function boot() {
  await loadPrefs();
  applyTheme();
  await initLang(pref("lang", "en"));
  header = h("div");
  tabs = h("div");
  stage = h("div", { class: "screen" });
  root.append(header, tabs, stage);

  views.onboarding = h("div", { class: "screen hidden", "data-view": "onboarding" });
  stage.append(views.onboarding);
  onboardingPaint = mountOnboarding(views.onboarding);
  const wrap = h("div", { class: "screen hidden", "data-view": "app" });
  stage.append(wrap);
  views.app = wrap;
  agent = mountAgent(wrap);
  const qa = mountQa(wrap, { runQa: (q) => agent.runQa(q), go: (v) => setView(v) });
  const pj = mountProject(wrap);
  const cp = mountCompose(wrap);
  views.agent = wrap.querySelector('[data-view="agent"]');
  views.qa = qa.el;
  views.project = pj.el;
  views.compose = cp.el;

  onAgentStatus(paintHeader);
  subscribe(render);
  render();

  chrome.tabs.onActivated.addListener(refreshTab);
  chrome.tabs.onUpdated.addListener((_id, info) => info.status === "complete" && refreshTab());
  chrome.windows.onFocusChanged.addListener(refreshTab);
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      agent.togglePick();
    }
  });

  await refreshHelper();
  if (S.helper) {
    await Promise.all([refreshWho(), refreshEstates()]);
    await refreshTab();
    await refreshPm();
  }
  setInterval(() => flags().pm && S.active && !document.hidden && (refreshPm(), S.view === "qa" && refreshQa()), 30000);
}

function setView(v) {
  S.view = v;
  notify();
}

function render() {
  const onboarding = needsOnboarding();
  views.onboarding.classList.toggle("hidden", !onboarding);
  views.app.classList.toggle("hidden", onboarding);
  if (onboarding) {
    onboardingPaint();
    paintHeader(true);
    clear(tabs);
    return;
  }
  const f = flags();
  if (!f.pm && (S.view === "qa" || S.view === "project")) S.view = "agent";
  paintHeader();
  paintTabs();
  for (const v of ["agent", "qa", "project", "compose"]) views[v].classList.toggle("hidden", v !== S.view);
  if (shown !== S.view + (S.active ? S.active.dir : "")) {
    shown = S.view + (S.active ? S.active.dir : "");
    if (S.view === "agent") agent.show();
    if (S.view === "qa") refreshQa();
    if (S.view === "project") refreshProject();
    if (S.view === "compose") refreshCompose();
  }
}

const initials = (email) => {
  const local = String(email || "?").split("@")[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2)).toUpperCase();
};

function statusText() {
  const a = agentState();
  if (a.waiting) return [t("status.perm", "permission needed"), "w"];
  if (a.busy) return [t("status.working", "working"), "b"];
  if (S.ocError) return [t("status.down", "agent offline"), "e"];
  return [t("status.ready", "ready"), ""];
}

function paintHeader(onboarding) {
  const a = agentState();
  const [st, cls] = statusText();
  const chip = S.active ? h("span", { class: `chip ${S.active.hosting === "deploy" ? "c-ok" : "c-mut"}`, text: S.active.hosting === "deploy" ? "deploy" : "serve" }) : null;
  clear(
    header,
    h(
      "div",
      { class: "ph" },
      h("h1", { class: "sr", text: "Ecosphere Assistant" }),
      h("span", { class: "mark" }, led(24, a.busy && !a.waiting)),
      onboarding ? h("b", { style: { fontSize: "13.5px" }, text: "Ecosphere Assistant" }) : h("button", { class: "projbtn", "data-act": "project-menu", "aria-haspopup": "menu", "aria-expanded": String(menu === "project"), "aria-label": t("hdr.switch", "Switch project"), onclick: () => toggleMenu("project") }, h("span", { text: S.active ? S.active.project : t("hdr.noProject", "No project") }), chip, svg(ICON.chevron, 12)),
      h("span", { class: "grow" }),
      !onboarding && h("span", { class: `status ${cls}`, "data-status": "", text: st }),
      !onboarding && h("button", { class: "ib", "data-act": "pick", "aria-pressed": String(a.picking), "aria-label": t("hdr.pick", "Pick an element on the page"), title: `${t("hdr.pick", "Pick an element on the page")} (${/Mac/.test(navigator.userAgent) ? "⌘⇧E" : "Ctrl+Shift+E"})`, onclick: () => agent.togglePick() }, svg(ICON.pick, 16)),
      h("button", { class: "av", "data-act": "account-menu", "aria-haspopup": "menu", "aria-expanded": String(menu === "account"), "aria-label": t("hdr.account", "Account menu"), onclick: () => toggleMenu("account"), text: S.who && S.who.signedIn ? initials(S.who.email) : "?" }),
    ),
    menu === "account" && accountMenu(),
    menu === "project" && projectMenu(),
  );
}

function toggleMenu(kind) {
  closeMenu();
  menu = menu === kind ? null : kind;
  paintHeader(needsOnboarding());
  if (menu) {
    const el = header.querySelector(".menu");
    closeMenu = trapEscape(el, () => ((menu = null), paintHeader(needsOnboarding())));
    // pointerdown on the opener would otherwise reopen immediately
  }
}

const shortPath = (p) => p.replace(/^\/(Users|home)\/[^/]+/, "~");

function accountMenu() {
  const dock = pref("dock", "right");
  const theme = pref("theme", "system");
  const themeLabel = { system: t("menu.system", "system"), light: t("menu.light", "light"), dark: t("menu.dark", "dark") }[theme];
  const item = (label, props, v) => h("button", { class: "mi" + (props.danger ? " danger" : ""), role: "menuitem", ...props.attrs, onclick: props.on }, label, v && h("span", { class: "v", text: v }));
  const openDock = (side) => () => {
    setPref("dock", side);
    chrome.tabs.create({ url: "chrome://settings/appearance" });
    menu = null;
    paintHeader();
  };
  return h(
    "div",
    { class: "menu", role: "menu", "data-menu": "account" },
    S.who && S.who.signedIn && h("div", { class: "note", style: { paddingBottom: "2px" }, text: `${S.who.email}${S.who.tier ? ` · ${S.who.tier}` : ""}` }),
    h("div", { class: "lbl", text: t("menu.dock", "Panel position") }),
    h("div", { class: "seg", style: { margin: "0 6px" } }, h("button", { type: "button", "data-dock": "right", "aria-pressed": String(dock === "right"), onclick: openDock("right"), text: t("menu.dockRight", "Dock right") }), h("button", { type: "button", "data-dock": "left", "aria-pressed": String(dock === "left"), onclick: openDock("left"), text: t("menu.dockLeft", "Dock left") })),
    h("div", { class: "note", text: t("menu.dockNote", "Chrome keeps the panel side in Settings → Appearance → Side panel position; these buttons open it.") }),
    h("div", { class: "sep" }),
    item(`${t("menu.openProject", "Open /project")} ↗`, { attrs: { "data-act": "open-project" }, on: () => ((menu = null), chrome.tabs.create({ url: (S.pm && S.pm.dashboard) || "https://getecosphere.com/project" })) }),
    S.active && item(t("menu.folder", "Folder"), { attrs: { "data-act": "folder" }, on: () => navigator.clipboard.writeText(S.active.dir).catch(() => {}) }, shortPath(S.active.dir)),
    S.active && S.active.rules && S.active.rules.length > 0 && item(t("menu.rules", "Workspace rules"), { attrs: { "data-act": "rules", title: S.active.rules.join("\n") }, on: () => navigator.clipboard.writeText(S.active.rules.join("\n")).catch(() => {}) }, `${S.active.rules.length} · ${shortPath(S.active.rules[S.active.rules.length - 1])}`),
    item(t("menu.model", "Model"), { on: () => {} }, "opencode · default"),
    item(`${t("menu.theme", "Theme")}: ${themeLabel}`, { attrs: { "data-act": "theme" }, on: () => (setPref("theme", { system: "light", light: "dark", dark: "system" }[theme]), applyTheme(), paintHeader()) }),
    item(t("menu.signout", "Sign out"), { danger: true, attrs: { "data-act": "signout" }, on: signOut }),
  );
}

async function signOut() {
  menu = null;
  setPref("account", "");
  try {
    await call("eco.logout");
  } catch {}
  await refreshWho();
  notify();
}

function projectMenu() {
  return h(
    "div",
    { class: "menu left", role: "menu", "data-menu": "project" },
    h("div", { class: "lbl", text: t("menu.projects", "Projects") }),
    ...S.estates.map((e) => h("button", { class: "mi", role: "menuitem", "data-project": e.project, "aria-selected": String(S.active && S.active.dir === e.dir), onclick: () => ((menu = null), selectProject(e.dir), paintHeader()) }, h("span", {}, e.project, h("small", { text: shortPath(e.dir) })), h("span", { class: `chip ${e.hosting === "deploy" ? "c-ok" : "c-mut"}`, style: { marginLeft: "auto" }, text: e.hosting === "deploy" ? "deploy" : "serve" }))),
    S.tabEstate && S.active && S.tabEstate.dir !== S.active.dir && h("div", { class: "note", text: t("menu.tabNote", "The active tab belongs to {p}.", { p: S.tabEstate.project }) }),
    h("div", { class: "sep" }),
    h("button", { class: "mi", role: "menuitem", "data-act": "add-project", onclick: addProject, text: t("menu.add", "Add a project folder…") }),
  );
}

async function addProject() {
  menu = null;
  paintHeader();
  const { estates } = await call("estate.scan");
  const fresh = estates.filter((e) => !S.estates.find((x) => x.dir === e.dir));
  if (!fresh.length) return;
  // approve the one matching the tab, else the first new one — the onboarding list is the full picker
  const pick = fresh.find((e) => S.tab && S.tab.url.includes(e.hostnames[0] || "\0")) || fresh[0];
  await call("estate.approve", { dir: pick.dir });
  await refreshEstates();
  await selectProject(pick.dir);
}

function paintTabs() {
  const f = flags();
  const list = [["agent", t("tab.agent", "Agent")], f.pm && ["qa", t("tab.qa", "QA")], f.pm && ["project", t("tab.project", "Project")], ["compose", t("tab.compose", "Compose")]].filter(Boolean);
  const n = f.pm ? qaBadge() : 0;
  clear(
    tabs,
    h("div", { class: "ptabs", role: "tablist" }, ...list.map(([id, label]) => h("button", { role: "tab", "data-tab": id, "aria-selected": String(S.view === id), onclick: () => setView(id) }, label, id === "qa" && n > 0 && h("span", { class: "badge", "data-badge": "", text: String(n) })))),
  );
}

boot();
