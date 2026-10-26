// Agent tab: our own chat UI on the OpenCode server API, aware of the page you are on.
import { h, clear, svg, ICON } from "./dom.js";
import { t } from "./i18n.js";
import { led, setRunning } from "./led.js";
import { S, call, notify, subscribe, ensureOpenCode, flags, workDir, needsRoot, setRoot, agentKind, agentLabel } from "./app.js";
import { pref, setPref } from "./prefs.js";
import { Timeline, toolArg } from "./session.js";
import * as page from "./page.js";
import { renderMarkdown } from "./md.js";
import { sessionsPanel, sessionTitle, fmtTokens } from "./sessions.js";

const A = {
  tl: null,
  sessionId: "",
  meta: null, // the OpenCode session object (title, tokens, revert)
  abort: null,
  draft: "",
  chips: { page: true, shot: false, el: false, cons: false },
  picked: null, // {…element data, crop}
  picking: false,
  yoloAsk: false, // the "turn on YOLO?" confirm is showing in the session bar
  restarting: false, // "Restart OpenCode" clicked, the new server not up yet
  restartedAt: "", // time of the last restart that failed, shown under the error
  consoleErrors: [],
  access: false,
  guess: "",
  guessFor: "",
  qa: null, // {n, title} when the run came from a QA request
  mode: "chat", // chat | summary | sessions
  summary: null,
  commands: null,
  pop: null, // {kind: "cmd"|"file", items, sel}
  sending: false,
  startedAt: 0,
  mirror: { seen: new Set(), queue: Promise.resolve(), tag: "" },
  toast: "",
  ocBusyStart: false,
  ref: {},
};

export const agentState = () => ({
  busy: Boolean(A.tl && A.tl.busy),
  waiting: Boolean(A.tl && A.tl.waitingForPermission),
  picking: A.picking,
});

let onStatus = () => {};
export const onAgentStatus = (fn) => (onStatus = fn);

const shortDir = (p) => {
  const parts = p.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : p;
};

const bump = () => {
  onStatus();
  paint();
};

// ── mount ─────────────────────────────────────────────────────────────────

export function mountAgent(root) {
  const el = h("div", { class: "screen", "data-view": "agent" });
  root.append(el);
  A.root = el;
  build();
  subscribe(() => {
    const key = `${needsRoot()}|${Boolean(S.rootAsk)}|${pref("steps", "intent")}`;
    if (key !== A.rootKey) ((A.rootKey = key), paintStream());
    syncContext();
    paintStrip();
    paintCtx();
  });
  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === "picker:picked") onPicked(m.data);
    else if (m.type === "picker:cancel") ((A.picking = false), bump());
    else if (m.type === "cmd:pick") togglePick();
  });
  chrome.tabs.onActivated.addListener(() => S.tab && syncContext(true));
  chrome.tabs.onUpdated.addListener((id, info) => info.status === "complete" && S.tab && id === S.tab.id && syncContext(true));
  return { show: () => (syncContext(true), connect()), togglePick, runQa, summarize, newSession, sessionStats, openSessions };
}

function build() {
  A.ref.strip = h("div", { class: "strip", role: "status" });
  A.ref.barRow = h("div", { class: "sesbar" });
  A.ref.tip = h("div", { class: "ctxtip", id: "ctx-tip", role: "tooltip", hidden: true });
  A.ref.bar = h("div", { class: "sesbarwrap" }, A.ref.barRow, A.ref.tip);
  A.ref.barRow.addEventListener("mouseover", (e) => e.target.closest("[data-ctx]") && showTip("hover"));
  A.ref.barRow.addEventListener("mouseout", (e) => e.target.closest("[data-ctx]") && hideTip());
  A.ref.tip.addEventListener("mouseenter", () => clearTimeout(A.tipTimer));
  A.ref.tip.addEventListener("mouseleave", hideTip);
  document.addEventListener("keydown", (e) => e.key === "Escape" && A.tipMode && ((A.tipMode = ""), paintTip()));
  A.ref.ctx = h("div", { class: "ctxwrap" });
  A.ref.stream = h("div", { class: "scroll", "aria-live": "polite", "data-stream": "" });
  A.ref.comp = h("div", { class: "comp" });
  A.ref.ta = h("textarea", { class: "ta", rows: "2", "aria-label": t("agent.msg", "Message for the agent"), placeholder: t("agent.ph", "Ask the agent… (/ commands, @ files)"), oninput: onInput, onkeydown: onKey });
  A.ref.chips = h("div", { class: "cchips" });
  A.ref.actions = h("div", { class: "crow" });
  A.ref.pop = h("div");
  A.ref.comp.append(A.ref.pop, A.ref.chips, A.ref.ta, A.ref.actions);
  clear(A.root, A.ref.strip, A.ref.bar, A.ref.stream, A.ref.comp);
  paint();
}

function paint() {
  paintStrip();
  paintBar();
  paintStream();
  paintChips();
  paintActions();
  paintPop();
}

// ── context ───────────────────────────────────────────────────────────────

async function syncContext(force) {
  const tab = S.tab;
  if (!tab) return;
  A.access = page.isLocal(tab.url) || (await page.hasAccess(tab.url));
  if (A.access) {
    await page.hookConsole(tab.id).catch(() => {});
    A.consoleErrors = await page.readConsole(tab.id).catch(() => []);
  } else A.consoleErrors = [];
  if (force || A.guessFor !== tab.url) await guessFile(tab.url);
  paintCtx();
  paintChips();
}

async function guessFile(url) {
  A.guessFor = url;
  A.guess = "";
  if (!S.oc) return;
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).pop() || "index";
    const res = await S.oc.findFiles(seg.replace(/[^\w-]/g, ""), 12);
    const files = (Array.isArray(res) ? res : []).filter((f) => !/\.(test|spec|md|json|lock)\b|node_modules|dist\//.test(f));
    const rel = S.active && S.active.dir.startsWith(workDir() + "/") ? S.active.dir.slice(workDir().length + 1) + "/" : "";
    A.guess = files.find((f) => rel && f.startsWith(rel)) || files[0] || "";
  } catch {
    A.guess = "";
  }
}

function paintCtx() {
  // The context card lives at the top of the stream (collapsible), like the design.
  const host = A.ref.ctxHost;
  if (!host) return;
  const tab = S.tab;
  if (!tab) return clear(host);
  const hostPart = (() => {
    try {
      const u = new URL(tab.url);
      return u.host + (u.pathname === "/" ? "" : u.pathname);
    } catch {
      return tab.url;
    }
  })();
  const errs = A.consoleErrors;
  const body = h(
    "div",
    { class: "ctxbody" },
    h("div", { class: "thumb", style: A.picked ? { backgroundImage: `url(${A.picked.crop})` } : {} }),
    h("div", { class: "ctxl" }, h("span", { text: hostPart }), A.guess && h("span", { class: "s", text: `→ ${A.guess}` }), A.picked ? h("span", { class: "el", "data-el": "", text: `${t("ctx.element", "element")}: ${A.picked.selector.split(" > ").pop()} · ${Math.round(A.picked.rect.w)}×${Math.round(A.picked.rect.h)}${A.picked.loc ? " · " + A.picked.loc : ""}` }) : h("span", { class: "s", text: t("ctx.noEl", "no element picked · {key}", { key: /Mac/.test(navigator.userAgent) ? "⌘⇧E" : "Ctrl⇧E" }) })),
  );
  clear(
    host,
    h(
      "div",
      { class: "card ctxcard", "data-card": "context" },
      h("button", { class: "crow", style: { width: "100%", background: "none", border: 0, textAlign: "left" }, "aria-expanded": String(!A.ctxCollapsed), "data-act": "toggle-ctx", onclick: () => ((A.ctxCollapsed = !A.ctxCollapsed), paintCtx()) }, h("span", { class: "lbl grow", text: t("ctx.title", "Page context") }), h("span", { class: "mono subtle", style: { fontSize: "11px" }, text: A.ctxCollapsed ? hostPart : t("ctx.follows", "follows every message") })),
      !A.ctxCollapsed && body,
      !A.ctxCollapsed && !A.access && h("div", { class: "row" }, h("span", { class: "grow muted", style: { fontSize: "12.5px" }, text: t("ctx.noAccess", "Allow this site to let the agent see it.") }), h("button", { class: "btn g", "data-act": "allow-site", onclick: allowSite, text: t("ctx.allow", "Allow") })),
      !A.ctxCollapsed && errs.length > 0 && h("details", { class: "cons" }, h("summary", { text: t("ctx.console", "console · {n} error", { n: errs.length }) }), h("div", {}, ...errs.map((e) => h("div", { text: e })))),
    ),
  );
}

async function allowSite() {
  if (S.tab && (await page.requestAccess(S.tab.url))) await syncContext(true);
}

// ── stream ────────────────────────────────────────────────────────────────

function paintStrip() {
  const s = A.ref.strip;
  if (!s) return;
  const busy = A.tl && A.tl.busy;
  const wait = A.tl && A.tl.waitingForPermission;
  const dir = S.active ? shortDir(workDir()) : "";
  let title = t("agent.ready", "Agent ready");
  let sub = `${dir}${yoloOn() ? " · yolo" : ""}`;
  let chip = h("span", { class: "chip c-mut", text: "idle" });
  if (wait) ((title = t("agent.waiting", "Agent is waiting for your permission")), (sub = `${A.tl.stepCount} ${t("agent.steps", "steps")} · ${dir}`), (chip = h("span", { class: "chip c-w", text: t("status.perm", "permission needed") })));
  else if (busy) ((title = t("agent.working", "Agent is working · {n} steps", { n: A.tl.stepCount })), (chip = h("span", { class: "chip c-br", text: t("status.working", "working") })));
  const starting = A.restarting || (A.connecting && !S.oc);
  if (starting) ((title = A.restarting && !A.switching ? t("agent.restarting", "Restarting {name}…", { name: agentLabel() }) : t("agent.starting", "Starting {name}…", { name: agentLabel() })), (chip = h("span", { class: "chip c-br", text: t("status.starting", "starting") })));
  else if (S.ocError) ((title = t("agent.down", "{name} is not running", { name: agentLabel() })), (chip = h("span", { class: "chip c-bad", text: "down" })));
  const folder = h("button", { type: "button", class: "sub folderbtn", "data-act": "work-folder", title: t("menu.root.t", "The folder the agent runs in: its sessions and AGENTS.md come from here"), onclick: () => ((S.rootAsk = true), notify()) }, svg(ICON.folder, 12), h("span", { text: sub }));
  clear(s, h("div", { class: "grow" }, h("b", { text: title }), folder), agentSwitch(busy), chip, h("div", { class: "progress" + ((busy && !wait) || starting ? " ind" : ""), style: wait ? { width: "50%" } : {} }));
}

const tilde = (p) => p.replace(/^\/(Users|home)\/[^/]+/, "~");

async function browseTo(dir) {
  A.browse = { ...(A.browse || {}), loading: true, err: "" };
  paintStream();
  try {
    A.browse = await call("fs.dirs", { dir });
  } catch (e) {
    A.browse = { ...(A.browse || {}), loading: false, err: e.message };
  }
  paintStream();
}

function browser() {
  const b = A.browse;
  const badges = (x) => [x.agents && "AGENTS.md", x.git && "git"].filter(Boolean).join(" · ");
  return h(
    "div",
    { class: "card rootcard", "data-card": "root-browse" },
    h("b", { text: t("root.browse", "Choose a folder") }),
    h("div", { class: "mono", style: { fontSize: "12px", wordBreak: "break-all" }, "data-browse-dir": "", text: b.dir ? tilde(b.dir) : "…" }),
    b.err && h("div", { class: "err", text: b.err }),
    h(
      "div",
      { class: "roots", role: "list" },
      b.parent && h("button", { class: "opt", "data-act": "browse-up", onclick: () => browseTo(b.parent) }, h("b", { text: "↑ " + t("root.up", "up one folder") }), h("span", { text: tilde(b.parent) })),
      ...(b.dirs || []).map((d) => h("button", { class: "opt", "data-browse": d.name, onclick: () => browseTo(`${b.dir}/${d.name}`) }, h("b", { text: d.name }), h("span", { text: badges(d) }))),
      b.dirs && !b.dirs.length && h("div", { class: "mt subtle", text: t("root.noSub", "No sub-folders here.") }),
    ),
    h(
      "div",
      { class: "crow" },
      h("button", { class: "btn br", "data-act": "browse-use", disabled: !b.selectable, title: b.selectable ? "" : t("root.homeNo", "Pick a folder inside your home folder, not the home folder itself."), onclick: () => ((A.rootPick = b.dir), (A.browse = null), useRoot()), text: t("root.useHere", "Use this folder") }),
      h("button", { class: "btn g", "data-act": "browse-back", onclick: () => ((A.browse = null), paintStream()), text: t("ses.shareNo", "Cancel") }),
    ),
  );
}

function rootCard() {
  if (A.browse) return browser();
  const e = S.active;
  const opts = [...e.ancestors.map((a) => ({ dir: a.dir, agents: a.agents, git: a.git })), { dir: e.dir, self: true }];
  const hint = [...e.ancestors].reverse().find((a) => a.agents);
  if (!opts.some((o) => o.dir === A.rootPick)) A.rootPick = e.root || "";
  return h(
    "div",
    { class: "card rootcard", "data-card": "root" },
    h("b", { text: t("root.t", "Where do you work from?") }),
    h("p", { class: "subtle", text: t("root.d", "OpenCode works in one folder. Its sessions and your AGENTS.md rules belong to that folder, so pick the one you normally start your agent in. It can be this project or a folder above it.") }),
    h(
      "div",
      { role: "radiogroup", class: "roots", "aria-label": t("root.t", "Where do you work from?") },
      ...opts.map((o) => h("button", { class: "opt", role: "radio", "aria-checked": String(A.rootPick === o.dir), "data-root": o.dir, onclick: () => ((A.rootPick = o.dir), paintStream()) }, h("b", { text: tilde(o.dir) }), h("span", { text: o.self ? t("root.self", "this project only") : [o.agents && "AGENTS.md", o.git && "git repo"].filter(Boolean).join(" · ") || t("root.folder", "folder") }), hint && hint.dir === o.dir && h("span", { class: "chip c-br tag", text: t("root.hint", "has your AGENTS.md") }))),
    ),
    A.rootErr && h("div", { class: "err", text: A.rootErr }),
    h(
      "div",
      { class: "crow" },
      h("button", { class: "btn br", "data-act": "root-use", disabled: !A.rootPick, onclick: useRoot, text: t("root.use", "Use this folder") }),
      h("button", { class: "btn g", "data-act": "root-browse", onclick: () => browseTo(A.rootPick || workDir() || e.dir), text: t("root.other", "Another folder…") }),
      h("button", { class: "btn g", "data-act": "root-cancel", onclick: () => ((S.rootAsk = false), (A.rootDismiss = true), (A.rootKey = ""), notify(), paintStream()), text: t("ses.shareNo", "Cancel") }),
    ),
  );
}

async function useRoot() {
  A.rootErr = "";
  try {
    await setRoot(A.rootPick);
    A.connectedDir = "";
    A.tl = null;
    A.sessionId = "";
    A.meta = null;
    await connect();
  } catch (e) {
    A.rootErr = e.message;
  }
  bump();
}

// ── context meter: what "ctx 51k" means and what to do about it ──────────

const num = (n) => n.toLocaleString("en-US");

async function loadLimits() {
  if (A.limits || A.limitsLoading) return;
  A.limitsLoading = true;
  try {
    const out = {};
    for (const p of (await S.oc.providers()).providers || []) for (const [id, m] of Object.entries(p.models || {})) if (m.limit && m.limit.context) out[`${p.id}/${id}`] = m.limit.context;
    A.limits = out;
    paintBar();
  } catch {
    A.limits = {}; // unknown limits: levels fall back to fixed sizes
  }
}

/// {tokens, limit, pct, level: ok|warn|bad}; the level follows the share of the model's memory used.
function ctxInfo() {
  const k = A.tl && A.tl.lastTokens();
  if (!k || !k.total) return null;
  const m = A.tl.model();
  const limit = (m && A.limits && A.limits[`${m.providerID}/${m.modelID}`]) || 0;
  const pct = limit ? Math.min(100, Math.round((k.total / limit) * 100)) : 0;
  const level = limit ? (pct >= 80 ? "bad" : pct >= 50 ? "warn" : "ok") : k.total >= 150000 ? "bad" : k.total >= 80000 ? "warn" : "ok";
  return { k, limit, pct, level };
}

function showTip(mode) {
  clearTimeout(A.tipTimer);
  if (A.tipMode !== "pin") A.tipMode = mode;
  paintTip();
}
function hideTip() {
  clearTimeout(A.tipTimer);
  A.tipTimer = setTimeout(() => A.tipMode !== "pin" && ((A.tipMode = ""), paintTip()), 180);
}

function paintTip() {
  const tip = A.ref.tip;
  const c = ctxInfo();
  tip.hidden = !A.tipMode || !c;
  if (tip.hidden) return;
  const words = Math.round(c.k.total * 0.75);
  const advice = { ok: t("ctx.ok", "Healthy. Nothing to do."), warn: t("ctx.warn", "Getting long. If you are about to start a different topic, a new session is cheaper and keeps the agent sharper."), bad: t("ctx.bad", "Almost full. Compact now, or start a new session: when the memory fills up the agent can forget early details.") }[c.level];
  const cost = A.meta && A.meta.cost > 0 ? (A.meta.cost < 0.01 ? "<$0.01" : `$${A.meta.cost.toFixed(2)}`) : "";
  const row = (k, v, hint) => h("div", { class: "kv" }, h("span", { text: k }), h("b", { text: v }), hint && h("small", { text: hint }));
  clear(
    tip,
    h("b", { class: "tt", text: t("ctx.title", "Conversation size (context)") }),
    h("p", { text: t("ctx.what", "Every time you send a message, the agent re-reads the whole conversation so far. This is how big that conversation is now: {n} tokens, about {w} words. A token is a small piece of text (roughly ¾ of a word).", { n: num(c.k.total), w: num(words) }) }),
    c.limit > 0 && h("div", { class: "meter", role: "img", "aria-label": `${c.pct}%` }, h("i", { class: c.level, style: { width: `${Math.max(2, c.pct)}%` } })),
    c.limit > 0 && h("p", { class: "sm", text: t("ctx.of", "{p}% of this model's memory ({l} tokens).", { p: c.pct, l: num(c.limit) }) }),
    h("p", { class: `advice ${c.level}`, text: advice }),
    h("details", {}, h("summary", { text: t("ctx.break", "What it is made of") }),
      row(t("ctx.cached", "Remembered from before (cached)"), num(c.k.cacheRead), t("ctx.cachedH", "Re-read at a lower price.")),
      row(t("ctx.written", "Newly remembered"), num(c.k.cacheWrite)),
      row(t("ctx.input", "New this turn"), num(c.k.input)),
      row(t("ctx.output", "The agent's last answer"), num(c.k.output + c.k.reasoning)),
      cost && row(t("ctx.cost", "Cost of this session so far"), cost)),
    h("div", { class: "crow" },
      h("button", { class: "btn br sm", "data-act": "compact", onclick: () => ((A.tipMode = ""), paintTip(), runBuiltin("compact")), text: t("ses.compact", "Compact") }),
      h("button", { class: "btn g sm", "data-act": "tip-new", onclick: () => ((A.tipMode = ""), paintTip(), newSession()), text: "+ " + t("ses.new", "New session") })),
    h("p", { class: "sm", text: t("ctx.how", "Compact: the agent summarizes the conversation (the gist stays, the detail goes). Your files are not touched. New session: starts blank, the old one stays in the list. One topic per session is the cheapest way to work.") }),
  );
}

// YOLO: the user's per-folder choice to let the agent run everything without asking (OpenCode
// permission requests are answered "once" automatically). Off by default; turning it on asks first.
const yoloOn = () => Boolean(S.active && pref(`yolo:${workDir()}`, false));

function yoloControls() {
  if (A.yoloAsk)
    return [
      h("span", { class: "yolo-q", text: t("yolo.ask", "Run every command and edit without asking?") }),
      h("button", { class: "btn sm yolo-go", "data-act": "yolo-on", onclick: () => setYolo(true), text: t("yolo.on", "Turn on YOLO") }),
      h("button", { class: "btn g sm", "data-act": "yolo-cancel", onclick: () => ((A.yoloAsk = false), paintBar()), text: t("ses.shareNo", "Cancel") }),
    ];
  const on = yoloOn();
  return [h("button", { class: "cc" + (on ? " yolo" : ""), "data-act": "yolo", "aria-pressed": String(on), title: on ? t("yolo.onT", "YOLO: the agent runs commands and edits files without asking. Click to ask first again.") : t("yolo.offT", "The agent asks before each command or edit. Click for YOLO (no questions)."), onclick: () => (on ? setYolo(false) : ((A.yoloAsk = true), paintBar())), text: on ? "yolo" : t("yolo.ask0", "ask first") })];
}

function setYolo(on) {
  A.yoloAsk = false;
  setPref(`yolo:${workDir()}`, on);
  if (on && A.tl) for (const [id, p] of A.tl.perms) if (!p.answer) autoApprove(id);
  bump();
}

function autoApprove(id) {
  const p = A.tl && A.tl.perms.get(id);
  if (p) p.auto = true;
  answer(id, "once");
}

function paintBar() {
  const b = A.ref.barRow;
  if (!b) return;
  if (S.oc) loadLimits();
  const c = ctxInfo();
  clear(
    b,
    h("button", { class: "sesbtn", "data-act": "sessions", "aria-haspopup": "dialog", "aria-expanded": String(A.mode === "sessions"), title: t("ses.open", "Sessions"), onclick: () => (A.mode === "sessions" ? closeSessions() : openSessions()) }, h("span", { class: "t", "data-session-title": "", text: A.meta ? sessionTitle(A.meta) : t("ses.new", "New session") }), h("span", { text: "▾" })),
    c && h("button", { class: `cc ctx-${c.level}`, "data-ctx": "", "aria-describedby": "ctx-tip", "aria-expanded": String(Boolean(A.tipMode)), onclick: () => ((A.tipMode = A.tipMode === "pin" ? "" : "pin"), paintTip()), onfocus: () => showTip("hover"), onblur: hideTip, text: `ctx ${fmtTokens(c.k.total)}${c.limit ? ` · ${c.pct}%` : ""}` }),
    c && c.level === "bad" && h("button", { class: "btn g sm", "data-act": "compact", onclick: () => runBuiltin("compact"), text: t("ses.compact", "Compact") }),
    A.meta && A.meta.share && A.meta.share.url && h("span", { class: "cc on", "data-shared": "", title: t("ses.sharedT", "Shared: anyone with this link can read the session"), text: t("ses.shared", "shared") }),
    h("span", { class: "grow" }),
    ...yoloControls(),
    !A.yoloAsk && h("button", { class: "btn g sm", "data-act": "new-session", onclick: newSession, text: "+ " + t("ses.newShort", "New") }),
  );
  if (A.tipMode) paintTip();
}

function paintStream() {
  const st = A.ref.stream;
  if (!st) return;
  if (A.mode === "summary") return paintSummary(st);
  if (needsRoot() && A.rootDismiss && !S.rootAsk) return clear(st, h("div", { class: "card rootcard", "data-card": "root-note" }, h("b", { text: t("root.none", "No work folder chosen yet") }), h("p", { class: "subtle", text: t("root.noneD", "The agent needs a folder to work in before it can start.") }), h("div", { class: "crow" }, h("button", { class: "btn br", "data-act": "root-choose", onclick: () => ((A.rootDismiss = false), paintStream()), text: t("root.choose", "Choose work folder") }))));
  if (needsRoot() || S.rootAsk) return clear(st, rootCard());
  if (A.mode === "sessions") return clear(st, A.sesPanel.el);
  const tl = A.tl;
  const kids = [];
  A.ref.ctxHost = h("div");
  kids.push(A.ref.ctxHost);
  if (!A.tl || A.tl.items().length === 0) kids.push(suggestions());
  if (A.restarting && A.switching) kids.push(h("div", { class: "mt", "data-oc": "switching" }, t("agent.switchingD", "Switching to {name}. Your sessions with the other agent stay where they are.", { name: agentLabel() })));
  else if (A.restarting) kids.push(h("div", { class: "mt", "data-oc": "restarting" }, t("agent.restartingD", "Restarting {name}: stopping the old server and starting a new one. This can take up to a minute.", { name: agentLabel() })));
  else if (S.ocError) kids.push(h("div", { class: "err", "data-err": "opencode" }, t("agent.downMsg", "Could not reach the local {name} server: {e}", { e: S.ocError, name: agentLabel() }), A.restartedAt && h("div", { class: "sub", "data-oc": "retried" }, t("agent.retried", "Restart tried at {time}, still not running.", { time: A.restartedAt })), h("button", { class: "btn g", "data-act": "restart-oc", onclick: restartOc, text: t("agent.restart", "Restart {name}", { name: agentLabel() }) })));
  if (tl) {
    for (const it of tl.items()) kids.push(renderItem(it));
    kids.push(shareCard());
    if (A.toast) kids.push(h("div", { class: "pm", style: { background: "var(--ok-wash)", borderColor: "var(--ok-line)" } }, A.toast));
    if (!tl.busy && tl.finished > 0 && tl.stepCount + tl.items().length > 0 && !tl.error && !tl.stopped) kids.push(doneCard());
    if (tl.error) kids.push(h("div", { class: "err", "data-err": "run" }, tl.error));
    if (tl.stopped) kids.push(h("div", { class: "mt subtle", text: t("agent.stopped", "Stopped.") }));
    if (tl.busy && !tl.waitingForPermission) kids.push(h("div", { class: "run" }, led(16, true), t("agent.thinking", "working…")));
  }
  clear(st, ...kids);
  paintCtx();
  // Never chase the streaming text: a new question goes to the top of the view and the reply is read
  // from its first line; the user scrolls. A reopened session starts at its latest message.
  const users = st.querySelectorAll('[data-kind="user"]');
  if (A.anchorUser && users.length > A.userCount) {
    st.scrollTop += users[users.length - 1].getBoundingClientRect().top - st.getBoundingClientRect().top - 8;
    A.anchorUser = false;
  } else if (A.scrollEnd && tl && tl.items().length) {
    st.scrollTop = st.scrollHeight;
    A.scrollEnd = false;
  }
}

function suggestions() {
  const out = [];
  const go = (text) => () => ((A.draft = text), (A.ref.ta.value = text), A.ref.ta.focus());
  if (!A.picked) out.push(h("button", { class: "cc", "data-act": "pick-first", onclick: togglePick, text: t("sug.pick", "↖ pick an element first") }));
  else out.push(h("button", { class: "cc", onclick: go(t("sug.explainEl", "Explain this element and where it is defined")), text: t("sug.explainEl.l", "Explain this element") }), h("button", { class: "cc", onclick: go(t("sug.a11y", "Improve this element's accessibility")), text: t("sug.a11y.l", "Improve accessibility") }));
  if (A.consoleErrors.length) out.push(h("button", { class: "cc", onclick: go(t("sug.fixCons", "Fix the console errors on this page")), text: t("sug.fixCons.l", "Fix {n} console errors", { n: A.consoleErrors.length }) }));
  out.push(h("button", { class: "cc", onclick: go(t("sug.explain", "Explain this page and the code behind it")), text: t("sug.explain.l", "Explain this page") }));
  return h("div", { class: "sugs", "data-sugs": "" }, ...out);
}

const INTENT = { read: "Reading {a}", list: "Listing {a}", grep: "Searching for “{a}”", glob: "Finding files {a}", fetch: "Fetching {a}", text: "{a}" };
const intentText = (i) => t(`intent.${i.k}`, INTENT[i.k], { a: i.a });

// Replies appear like typing with a soft fade, not all at once. Only text that arrives while the user is
// waiting is animated; history shows at once. Each text part keeps its element, so a repaint of the
// stream does not restart the animation.
const R = new Map();
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function paintBlock(r) {
  const text = r.full.slice(0, r.shown);
  if (r.text === text && !r.fading) return;
  const now = performance.now();
  const { node, words } = renderMarkdown(text, (i) => {
    if (r.times[i] === undefined) return ((r.times[i] = now), 0);
    const age = now - r.times[i];
    return age < 700 ? age : null;
  });
  r.times.length = words;
  r.fading = words > 0 && now - r.times[words - 1] < 700;
  r.text = text;
  r.el.replaceChildren(node);
}

function tick() {
  A.revealRaf = 0;
  let more = false;
  for (const r of R.values()) {
    if (r.shown < r.full.length) {
      const to = Math.min(r.full.length, r.shown + Math.max(2, Math.ceil((r.full.length - r.shown) / 40)));
      const ws = /\s/.exec(r.full.slice(to, to + 12));
      r.shown = Math.min(r.full.length, ws ? to + ws.index : to);
    }
    paintBlock(r);
    if (r.shown < r.full.length || r.fading) more = true;
  }
  if (more) A.revealRaf = requestAnimationFrame(tick);
}

function textBlock(it) {
  let r = R.get(it.id);
  if (!r) R.set(it.id, (r = { full: "", shown: A.revealArm && !reduced() ? 0 : it.text.length, times: [], text: null, fading: false, el: h("div", { class: "mt md", "data-kind": "text" }) }));
  r.full = it.text;
  r.shown = Math.min(r.shown, r.full.length);
  if (!A.revealArm || reduced()) r.shown = r.full.length;
  paintBlock(r);
  if ((r.shown < r.full.length || r.fading) && !A.revealRaf) A.revealRaf = requestAnimationFrame(tick);
  return r.el;
}

function renderItem(it) {
  switch (it.kind) {
    case "user":
      return h("div", { class: "mu", "data-kind": "user" }, it.text, it.chips.length > 0 && h("div", { class: "chips" }, ...it.chips.map((c) => h("span", { text: c }))));
    case "text":
      return textBlock(it);
    case "step": {
      const mode = pref("steps", "intent");
      if (it.status !== "error" && mode !== "verbose") {
        // quiet: nothing; intent: only what the call is for (a bare command says nothing useful)
        if (mode === "quiet" || !it.intent) return null;
        return h("div", { class: `st it ${it.status === "completed" ? "" : "run"}`, "data-kind": "step", "data-intent": "" }, h("span", { class: "i", text: it.status === "completed" ? "✓" : "●" }), h("span", { class: "a", title: it.arg, text: intentText(it.intent) }));
      }
      const icon = it.status === "completed" ? "✓" : it.status === "error" ? "✕" : "●";
      return h("div", { class: `st ${it.status === "completed" ? "" : it.status === "error" ? "err" : "run"}`, "data-kind": "step" }, h("span", { class: "i", text: icon }), h("span", { class: "t", text: it.tool }), h("span", { class: "a", title: it.arg, text: it.arg || it.error || "" }), h("span", { class: "m", text: it.meta }));
    }
    case "diff":
      return h("div", { class: "df", "data-kind": "diff" }, h("div", { class: "dh" }, h("span", { class: "f", text: it.file }), h("span", { class: "pl", text: `+${it.plus}` }), h("span", { class: "mi2", text: `−${it.minus}` })), h("div", { class: "pre" }, ...it.lines.map(([sg, tx]) => h("div", { class: sg === "+" ? "dl-add" : sg === "-" ? "dl-del" : "dl-ctx", text: `${sg === " " ? " " : sg} ${tx}` })), it.more > 0 && h("div", { class: "dl-ctx", text: `… ${it.more} more` })));
    case "perm":
      return permCard(it);
  }
}

function permCard(it) {
  const r = it.req;
  const cmd = (r.patterns && r.patterns[0]) || "";
  const isRun = r.permission === "bash";
  const what = isRun ? t("perm.run", "Run") : t("perm.allow", "Allow {perm}", { perm: r.permission });
  const answered = it.answer;
  const label = it.auto ? t("perm.auto.done", "auto-approved (YOLO)") : { once: t("perm.once.done", "allowed once"), always: t("perm.always.done", "always allowed for this project"), reject: t("perm.reject.done", "rejected") }[answered];
  return h(
    "div",
    { class: "pm", "data-kind": "perm", "data-id": r.id },
    h("div", { class: "crow" }, h("span", { class: "chip c-w", text: t("perm.chip", "permission") }), h("span", { class: "q" }, what, " ", cmd && h("code", { text: cmd }), "?")),
    r.metadata && r.metadata.description && h("span", { class: "why", text: r.metadata.description }),
    answered ? h("span", { class: "mono", style: { fontSize: "12px", color: "var(--warn)" }, text: `✓ ${label}` }) : h("div", { class: "crow" }, h("button", { class: "btn", "data-act": "perm-once", onclick: () => answer(r.id, "once"), text: t("perm.once", "Allow once") }), h("button", { class: "btn g", "data-act": "perm-always", onclick: () => answer(r.id, "always"), text: t("perm.always", "Always for this project") }), h("button", { class: "btn g", "data-act": "perm-reject", onclick: () => answer(r.id, "reject"), text: t("perm.reject", "Reject") })),
  );
}

async function answer(id, reply) {
  const p = A.tl.perms.get(id);
  if (p) p.answer = reply;
  bump();
  try {
    await S.oc.reply(id, reply);
  } catch (e) {
    if (p) p.answer = null;
    A.tl.error = e.message;
    bump();
  }
}

function doneCard() {
  const tl = A.tl;
  const n = tl.files.size;
  const list = [];
  if (n) list.push(n === 1 ? t("done.file1", "1 file changed") : t("done.files", "{n} files changed", { n }));
  const checks = tl.items().filter((i) => i.kind === "step" && i.status === "completed" && /^(bash)$/.test(i.tool) && /(test|build|check|lint)/.test(i.arg));
  for (const c of checks.slice(-3)) list.push(`${c.arg.slice(0, 60)} ✓`);
  if (!list.length) list.push(t("done.noFiles", "No files changed"));
  const title = A.qa ? t("done.qa", "QA #{n} is ready to verify", { n: A.qa.n }) : n ? t("done.local", "Changes are ready in the local estate") : t("done.plain", "Done");
  const canReload = Boolean(S.tab && A.access);
  return h(
    "div",
    { class: "dn", "data-kind": "done" },
    h("b", { text: `✓ ${title}` }),
    ...list.map((x) => h("span", { text: `· ${x}` })),
    h("div", { class: "acts" }, canReload && n > 0 && h("button", { class: "btn g", "data-act": "reload-tab", onclick: reloadTab, text: t("done.reload", "Reload tab") }), A.qa && flags().pm && h("button", { class: "btn br", "data-act": "send-qa", onclick: sendToQa, text: t("done.sendQa", "Send to QA #{n} →", { n: A.qa.n }) }), flags().pm && h("button", { class: "btn g", "data-act": "summarize", onclick: summarize, text: t("done.summarize", "Summarize session") })),
  );
}

async function reloadTab() {
  if (!S.tab) return;
  await page.reloadTab(S.tab.id);
  const port = (() => {
    try {
      return new URL(S.tab.url).port;
    } catch {
      return "";
    }
  })();
  await page.toast(S.tab.id, `✓ ${t("done.reloaded", "reloaded")}${port ? ` · :${port}` : ""}`);
  A.toast = t("done.reloaded.n", "Tab reloaded.");
  bump();
  setTimeout(() => ((A.toast = ""), paintStream()), 4000);
}

// ── composer ──────────────────────────────────────────────────────────────

function paintChips() {
  const c = A.ref.chips;
  if (!c) return;
  const chip = (key, label, on, extra = {}) => h("button", { class: "cc" + (on ? " on" : ""), "aria-pressed": String(on), "data-chip": key, ...extra, onclick: () => ((A.chips[key] = !A.chips[key]), paintChips()), text: (on ? "✓ " : "+ ") + label });
  clear(
    c,
    chip("page", t("chip.page", "page"), A.chips.page),
    chip("shot", t("chip.shot", "screenshot"), A.chips.shot, { disabled: !A.access }),
    chip("el", t("chip.el", "element"), A.chips.el && Boolean(A.picked), { disabled: !A.picked }),
    chip("cons", A.consoleErrors.length ? t("chip.cons", "console · {n} error", { n: A.consoleErrors.length }) : t("chip.cons0", "console"), A.chips.cons && A.consoleErrors.length > 0, { disabled: !A.consoleErrors.length }),
  );
}

/// OpenCode | Claude Code logos in the status strip, switchable any time the agent is not working (the chosen one starts in
/// its own last session). The active one shows its name too.
function agentSwitch(busy) {
  const cur = agentKind();
  const lock = busy || A.restarting;
  const opt = (kind, label, missing) =>
    h("button", { type: "button", "data-agent": kind, "aria-pressed": String(cur === kind), disabled: lock || (missing && cur !== kind), title: lock ? t("agentSw.busy", "Stop the agent first") : missing ? t("agentSw.missing", "{name} is not installed on this machine", { name: label }) : t("agentSw.use", "Use {name}", { name: label }), onclick: () => cur !== kind && switchAgent(kind), "aria-label": label }, h("img", { src: `icons/agents/${kind}.svg`, alt: "", width: 14, height: 14 }), cur === kind && h("span", { text: label }));
  return h("div", { class: "seg agentseg", role: "group", "aria-label": t("agentSw.label", "Coding agent") }, opt("opencode", "OpenCode", !(S.helper && S.helper.opencode)), opt("claude", "Claude Code", !(S.helper && S.helper.claude)));
}

function paintActions() {
  const a = A.ref.actions;
  if (!a) return;
  const busy = A.tl && A.tl.busy;
  clear(a, h("span", { class: "grow" }), busy && h("button", { class: "btn g", "data-act": "stop", onclick: stop, text: t("agent.stop", "Stop") }), h("button", { class: "btn br", "data-act": "send", disabled: A.sending, onclick: send, text: t("agent.send", "Send") + " ↵" }));
}

function onInput() {
  A.draft = A.ref.ta.value;
  const v = A.draft;
  const cmd = v.match(/^\/([\w-]*)$/);
  const at = v.slice(0, A.ref.ta.selectionStart).match(/(?:^|\s)@([\w./-]*)$/);
  if (cmd) openCommands(cmd[1]);
  else if (at) openFiles(at[1]);
  else ((A.pop = null), paintPop());
}

async function openCommands(q) {
  try {
    if (!A.commands) A.commands = await (await ensureOpenCode()).commands();
  } catch {
    A.commands = [];
  }
  const own = BUILTIN.filter((b) => [b.name, ...b.alias].some((n) => n.startsWith(q))).map((b) => ({ label: `/${b.name}`, hint: t(`slash.${b.name}`, b.hint), insert: `/${b.name} ` }));
  const rest = (A.commands || []).filter((c) => c.name.startsWith(q) && !builtinFor(c.name)).map((c) => ({ label: `/${c.name}`, hint: c.description || "", insert: `/${c.name} ` }));
  const items = [...own, ...rest].slice(0, 10);
  A.pop = items.length ? { kind: "cmd", items, sel: 0 } : null;
  paintPop();
}

async function openFiles(q) {
  try {
    const oc = await ensureOpenCode();
    const files = q ? await oc.findFiles(q, 8) : [];
    A.pop = files.length ? { kind: "file", items: files.map((f) => ({ label: f, insert: `@${f} `, file: f })), sel: 0 } : null;
  } catch {
    A.pop = null;
  }
  paintPop();
}

function paintPop() {
  const p = A.ref.pop;
  if (!p) return;
  if (!A.pop) return clear(p);
  clear(p, h("div", { class: "pop", role: "listbox", "data-pop": A.pop.kind }, ...A.pop.items.map((it, i) => h("button", { class: "mi", role: "option", "aria-selected": String(i === A.pop.sel), onclick: () => choose(i), onmousedown: (e) => e.preventDefault() }, it.label, it.hint && h("span", { class: "v", text: it.hint })))));
}

function choose(i) {
  const it = A.pop.items[i];
  const ta = A.ref.ta;
  const before = ta.value.slice(0, ta.selectionStart);
  const after = ta.value.slice(ta.selectionStart);
  const re = A.pop.kind === "cmd" ? /^\/[\w-]*$/ : /@[\w./-]*$/;
  ta.value = before.replace(re, it.insert) + after;
  A.draft = ta.value;
  if (it.file) (A.attach ||= new Set()).add(it.file);
  A.pop = null;
  paintPop();
  ta.focus();
}

function onKey(e) {
  if (A.pop) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      A.pop.sel = (A.pop.sel + (e.key === "ArrowDown" ? 1 : -1) + A.pop.items.length) % A.pop.items.length;
      return paintPop();
    }
    // a fully typed command runs on Enter; a partial one completes first
    const typed = A.pop.kind === "cmd" && A.ref.ta.value.trim() === A.pop.items[A.pop.sel].label;
    if ((e.key === "Enter" && !typed) || e.key === "Tab") {
      e.preventDefault();
      return choose(A.pop.sel);
    }
    if (e.key === "Escape") return ((A.pop = null), paintPop());
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
}

// ── session + sending ─────────────────────────────────────────────────────

async function connect() {
  if (!S.active || A.connecting) return;
  if (needsRoot()) return bump();
  const dir = workDir();
  if (A.connectedDir === dir) return;
  if (A.connectedDir) ((A.tl = null), (A.sessionId = ""), (A.meta = null), (A.qa = null), (A.picked = null), (A.mode = "chat"));
  A.connecting = true;
  paintStrip();
  try {
    const oc = await ensureOpenCode();
    A.connectedDir = dir;
    if (!A.tl) A.sessionId = pref(sessKey(dir), "");
    if (!A.tl && A.sessionId) {
      try {
        const tl = new Timeline(A.sessionId);
        tl.load(await oc.messages(A.sessionId));
        A.tl = tl;
        A.scrollEnd = true;
        refreshMeta();
      } catch {
        A.sessionId = "";
      }
    }
    listen(oc);
    syncContext(true);
  } catch {
    A.connectedDir = "";
  }
  A.connecting = false;
  bump();
}

function listen(oc) {
  if (A.abort) A.abort.abort();
  const ctl = (A.abort = new AbortController());
  A.sse = new Promise((resolve) => (A.sseOpen = resolve));
  (async () => {
    while (!ctl.signal.aborted) {
      try {
        await oc.events((ev) => onEvent(ev), ctl.signal, () => {
          A.sseOpen();
          resync(oc);
        });
      } catch {
        /* reconnect below */
      }
      if (ctl.signal.aborted) return;
      await new Promise((r) => setTimeout(r, 1500));
    }
  })();
}

/// Events sent while the stream was down are not replayed: reload the session from the server.
async function resync(oc) {
  if (!A.tl) return;
  try {
    A.tl.load(await oc.messages(A.sessionId));
    const st = await oc.status();
    A.tl.busy = Boolean(st[A.sessionId]);
    await refreshMeta();
    bump();
  } catch {
    /* next event will catch up */
  }
}

let raf = 0;
function onEvent(ev) {
  const tl = A.tl;
  if (!tl) return;
  if (ev.type === "session.updated" && ev.properties && ev.properties.info && ev.properties.info.id === A.sessionId) setMeta(ev.properties.info);
  const before = tl.finished;
  if (!tl.apply(ev)) return;
  if (ev.type === "permission.asked" && yoloOn() && tl.perms.has(ev.properties.id)) autoApprove(ev.properties.id);
  mirrorEvent(ev);
  if (tl.finished !== before) onRunEnd();
  if (!raf)
    raf = requestAnimationFrame(() => {
      raf = 0;
      bump();
    });
}

async function ensureSession() {
  const oc = await ensureOpenCode();
  if (A.tl && A.sessionId) return oc;
  const ses = await oc.createSession();
  A.sessionId = ses.id;
  A.tl = new Timeline(ses.id);
  A.meta = ses;
  A.startedAt = Date.now();
  setPref(sessKey(), ses.id);
  return oc;
}

/// A blank start: nothing is created on the server until the first message (no empty sessions pile up).
export async function newSession() {
  R.clear();
  A.revealArm = false;
  A.confirmShare = false;
  A.sessionId = "";
  A.tl = null;
  A.meta = null;
  A.qa = null;
  A.mode = "chat";
  if (S.active) setPref(sessKey(), "");
  bump();
  A.ref.ta.focus();
}

function setMeta(info) {
  A.meta = info;
  if (A.tl) A.tl.revertAt = (info.revert && info.revert.messageID) || "";
  bump();
}

async function refreshMeta() {
  if (!A.sessionId) return;
  try {
    setMeta(await S.oc.session(A.sessionId));
  } catch {
    /* title is cosmetic */
  }
}

async function switchTo(id) {
  const oc = await ensureOpenCode();
  const tl = new Timeline(id);
  tl.load(await oc.messages(id));
  try {
    tl.busy = Boolean((await oc.status())[id]);
  } catch {
    /* idle assumed */
  }
  A.tl = tl;
  A.sessionId = id;
  R.clear();
  A.revealArm = false;
  A.scrollEnd = true;
  A.confirmShare = false;
  A.meta = null;
  A.qa = null;
  A.mode = "chat";
  setPref(sessKey(), id);
  bump();
  refreshMeta();
  A.ref.ta.focus();
}

// ── session list ──────────────────────────────────────────────────────────

let listTimer = 0;
async function loadSessions(q = "") {
  try {
    const oc = await ensureOpenCode();
    const [list, st] = await Promise.all([oc.listSessions({ search: q }), oc.status().catch(() => ({}))]);
    A.sesPanel.set({ list: list.filter((s) => s.title !== "summary draft"), busy: new Set(Object.keys(st)), current: A.sessionId, loading: false, err: "" });
  } catch (e) {
    A.sesPanel.set({ err: e.message, loading: false });
  }
}

function openSessions() {
  if (!S.active) return;
  A.sesPanel ||= sessionsPanel({
    pick: (id) => (id === A.sessionId ? closeSessions() : switchTo(id).catch((e) => A.sesPanel.set({ err: e.message }))),
    create: newSession,
    rename: async (id, title) => {
      await S.oc.rename(id, title).catch(() => {});
      if (id === A.sessionId) refreshMeta();
      loadSessions(A.sesPanel.query());
    },
    fork: async (id) => {
      try {
        await switchTo((await S.oc.fork(id)).id);
      } catch (e) {
        A.sesPanel.set({ err: e.message });
      }
    },
    remove: async (id) => {
      await S.oc.deleteSession(id).catch(() => {});
      if (id === A.sessionId) ((A.tl = null), (A.sessionId = ""), (A.meta = null), setPref(sessKey(), ""));
      loadSessions(A.sesPanel.query());
      bump();
    },
    search: (q) => (clearTimeout(listTimer), (listTimer = setTimeout(() => loadSessions(q), 200))),
    close: closeSessions,
  });
  A.mode = "sessions";
  A.sesPanel.set({ current: A.sessionId, loading: true });
  bump();
  loadSessions(A.sesPanel.query());
  A.sesPanel.focus();
}

function closeSessions() {
  A.mode = "chat";
  bump();
}

// ── slash commands that run in the panel (same names as OpenCode's own) ──

const BUILTIN = [
  { name: "new", alias: ["clear"], hint: "Start a blank session" },
  { name: "sessions", alias: ["resume", "continue"], hint: "Switch to another session" },
  { name: "compact", alias: ["summarize"], hint: "Summarize the session to free context" },
  { name: "undo", alias: [], hint: "Revert the last message and its file changes" },
  { name: "redo", alias: [], hint: "Restore what /undo reverted" },
  { name: "rename", alias: [], hint: "Rename this session: /rename <title>" },
  { name: "fork", alias: [], hint: "Continue in a copy of this session" },
  { name: "share", alias: [], hint: "Publish this session at a public link" },
  { name: "unshare", alias: [], hint: "Remove the public link" },
];
const builtinFor = (n) => BUILTIN.find((b) => b.name === n || b.alias.includes(n));

function flash(msg) {
  A.toast = msg;
  bump();
  setTimeout(() => ((A.toast = ""), paintStream()), 4000);
}

async function doShare() {
  A.confirmShare = false;
  try {
    setMeta(await S.oc.share(A.sessionId));
  } catch (e) {
    flash(e.message);
  }
  bump();
}

const safeUrl = (u) => {
  try {
    return /^https?:$/.test(new URL(u).protocol) ? u : "";
  } catch {
    return "";
  }
};

function shareCard() {
  const url = A.meta && A.meta.share && safeUrl(A.meta.share.url);
  if (url)
    return h("div", { class: "pm", "data-card": "shared" }, h("b", { text: t("ses.sharedT", "Shared: anyone with this link can read the session") }), h("div", { class: "mono", style: { fontSize: "11.5px", wordBreak: "break-all" } }, h("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: url })), h("div", { class: "crow" }, h("button", { class: "btn g sm", "data-act": "share-copy", onclick: () => navigator.clipboard.writeText(url).catch(() => {}), text: t("ses.copy", "Copy link") }), h("button", { class: "btn g sm", "data-act": "unshare", onclick: () => runBuiltin("unshare"), text: t("ses.unshare", "Remove link") })));
  if (A.confirmShare)
    return h("div", { class: "pm", "data-card": "share-confirm" }, h("b", { text: t("ses.shareQ", "Publish this session?") }), h("div", { text: t("ses.shareWarn", "The whole conversation, including code and file contents it shows, goes to OpenCode's sharing service at a public link. Anyone with the link can read it. You can remove the link later with /unshare.") }), h("div", { class: "crow" }, h("button", { class: "btn br sm", "data-act": "share-yes", onclick: doShare, text: t("ses.shareYes", "Publish link") }), h("button", { class: "btn g sm", "data-act": "share-no", onclick: () => ((A.confirmShare = false), bump()), text: t("ses.shareNo", "Cancel") })));
  return null;
}

async function configModel(oc) {
  const [providerID, modelID] = String(((await oc.config().catch(() => null)) || {}).model || "").split("/");
  return providerID && modelID ? { providerID, modelID } : null;
}

export async function runBuiltin(name, arg = "") {
  const b = builtinFor(name);
  if (!b || !S.active) return;
  try {
    const oc = await ensureOpenCode();
    if (b.name === "new") return newSession();
    if (b.name === "sessions") return openSessions();
    if (!A.tl || !A.sessionId) return flash(t("ses.none", "No session yet. Send a message first."));
    const tl = A.tl;
    switch (b.name) {
      case "compact": {
        const m = tl.model() || (await configModel(oc));
        if (!m) return flash(t("ses.nomodel", "Send one message first so the model is known."));
        tl.busy = true;
        bump();
        try {
          await oc.compact(A.sessionId, m.providerID, m.modelID);
        } finally {
          tl.busy = false;
        }
        await resync(oc);
        return flash(t("ses.compacted", "Session compacted."));
      }
      case "undo": {
        const last = tl.lastUser();
        if (!last) return flash(t("ses.nothing", "Nothing to undo."));
        setMeta(await oc.revert(A.sessionId, last.id));
        A.draft = A.ref.ta.value = Timeline.userText(last);
        return flash(t("ses.undone", "Reverted. Your message is back in the box."));
      }
      case "redo":
        setMeta(await oc.unrevert(A.sessionId));
        tl.revertAt = "";
        return bump();
      case "rename":
        if (!arg.trim()) return flash(t("ses.renameUsage", "Usage: /rename <new title>"));
        setMeta(await oc.rename(A.sessionId, arg.trim()));
        return;
      case "share":
        if (A.meta && A.meta.share && A.meta.share.url) return flash(t("ses.already", "Already shared. /unshare removes the link."));
        A.confirmShare = true;
        return bump();
      case "unshare":
        setMeta(await oc.unshare(A.sessionId).then(() => oc.session(A.sessionId)));
        return flash(t("ses.unshared", "Public link removed."));
      case "fork":
        return await switchTo((await oc.fork(A.sessionId)).id);
    }
  } catch (e) {
    flash(e.message);
  }
}

async function buildParts(text) {
  const parts = [{ type: "text", text }];
  const chips = [];
  const ctx = [];
  if (A.chips.page && S.tab) {
    chips.push(t("chip.page", "page"));
    ctx.push(`- Active tab: ${S.tab.url}${S.tab.title ? ` ("${S.tab.title}")` : ""}`);
    if (S.active) ctx.push(`- Project: ${S.active.project} (folder ${S.active.dir})`, `- Workspace root (your working folder): ${workDir()}`);
    if (A.guess) ctx.push(`- Likely source file for this page: ${A.guess}`);
  }
  if (A.chips.el && A.picked) {
    chips.push(`${t("chip.el", "element")} · ${A.picked.short}`);
    const p = A.picked;
    ctx.push(`- Selected element: ${p.selector} (${Math.round(p.rect.w)}×${Math.round(p.rect.h)})`, `  HTML: ${p.html}`, `  Computed styles: ${Object.entries(p.styles).map(([k, v]) => `${k}: ${v}`).join("; ")}`);
  }
  if (A.chips.cons && A.consoleErrors.length) {
    chips.push(t("chip.cons", "console · {n} error", { n: A.consoleErrors.length }));
    ctx.push(`- Console errors (${A.consoleErrors.length}):`, ...A.consoleErrors.map((e) => `  • ${e}`));
  }
  if (ctx.length) parts.push({ type: "text", synthetic: true, text: ["Browser context from the Ecosphere Assistant side panel:", ...ctx, "Find the element/page in the project source and change the source files (not the live DOM). Keep the change small."].join("\n") });
  if (A.chips.shot && S.tab && A.access) {
    try {
      const url = await page.downscale(await page.screenshot(S.tab.windowId));
      parts.push({ type: "file", mime: "image/png", filename: "tab.png", url });
      chips.push(t("chip.shot", "screenshot"));
    } catch {
      /* no permission or tab not capturable */
    }
    A.chips.shot = false;
  }
  if (A.chips.el && A.picked && A.picked.crop) parts.push({ type: "file", mime: "image/png", filename: "element.png", url: A.picked.crop });
  for (const f of A.attach || []) if (text.includes(`@${f}`)) parts.push({ type: "file", mime: "text/plain", filename: f.split("/").pop(), url: `file://${workDir()}/${f}` });
  A.attach = new Set();
  return { parts, chips };
}

async function send(opts = {}) {
  const text = (opts.text ?? A.draft).trim();
  if (!text || A.sending || !S.active) return;
  const slash = text.match(/^\/([\w-]+)\s*(.*)$/s);
  if (slash && builtinFor(slash[1])) {
    A.draft = A.ref.ta.value = "";
    A.pop = null;
    paintPop();
    return runBuiltin(slash[1], slash[2]);
  }
  if (A.mode === "sessions") A.mode = "chat";
  A.revealArm = true;
  A.anchorUser = true;
  A.userCount = A.ref.stream.querySelectorAll('[data-kind="user"]').length;
  A.sending = true;
  paintActions();
  try {
    const oc = await ensureSession();
    if (!A.connectedDir) await connect();
    await Promise.race([A.sse, new Promise((r) => setTimeout(r, 3000))]);
    const cmd = text.match(/^\/([\w-]+)\s*(.*)$/s);
    const known = cmd && (A.commands || (await oc.commands().catch(() => []))).some((c) => c.name === cmd[1]);
    const { parts, chips } = opts.parts ? { parts: opts.parts, chips: opts.chips || [] } : await buildParts(text);
    A.tl.chipQueue.push(chips);
    if (!opts.keepDraft) {
      A.draft = "";
      A.ref.ta.value = "";
    }
    if (known) await oc.command(A.sessionId, cmd[1], cmd[2]);
    else await oc.prompt(A.sessionId, parts, { agent: (oc.agent === "opencode" && pref("agentName", "")) || undefined, yolo: yoloOn() });
    A.tl.busy = true;
  } catch (e) {
    if (e.status === 404 && !opts.retried) {
      // the session no longer exists on the server (fresh install, wiped data): start a new one
      A.sending = false;
      A.tl = null;
      A.sessionId = "";
      setPref(sessKey(), "");
      return send({ ...opts, retried: true, text, keepDraft: true });
    }
    if (e.code === "root") {
      A.rootDismiss = false;
      paintStream();
    } else if (e instanceof TypeError) {
      // the server is gone (fetch failed): show the "OpenCode is not running" state with a restart
      S.oc = null;
      S.ocError = e.message;
      A.connectedDir = "";
      notify();
    } else if (A.tl) A.tl.error = e.message;
  }
  A.sending = false;
  bump();
}

async function stop() {
  try {
    await S.oc.abort(A.sessionId);
  } catch {
    /* already idle */
  }
}

// Shows a "Restarting…" state until the new server answers or fails, so a click never looks ignored.
// Also used when the user switches agent (menu → Agent): the old server stops, the chosen one starts.
// The last session per agent and folder (OpenCode and Claude Code ids do not mix).
const sessKey = (dir = workDir()) => (agentKind() === "claude" ? `session:claude:${dir}` : `session:${dir}`);

/// Menu → Agent: stop the current agent's server and start the chosen one with its own last session.
export async function switchAgent(kind) {
  if (kind === agentKind()) return;
  setPref("agent", kind);
  ((A.tl = null), (A.sessionId = ""), (A.meta = null), (A.commands = null), (A.mode = "chat"), (A.switching = true));
  await restartOc();
  A.switching = false;
  bump();
}

async function restartOc() {
  if (A.restarting) return;
  A.restarting = true;
  A.restartedAt = "";
  bump();
  try {
    await call("oc.stop", { dir: S.active.dir });
  } catch {}
  while (A.connecting) await new Promise((r) => setTimeout(r, 200));
  S.oc = null;
  S.ocError = "";
  A.connectedDir = "";
  await connect();
  A.restarting = false;
  A.restartedAt = S.ocError ? new Date().toLocaleTimeString() : "";
  bump();
}

function onRunEnd() {
  if (S.tab && A.access) page.readConsole(S.tab.id).then((e) => ((A.consoleErrors = e), paintChips(), paintCtx())).catch(() => {});
  locateElement();
  refreshMeta();
  if (A.qa) mirrorFlush();
}

/// Show file:line for the picked element when a grep result names it.
function locateElement() {
  if (!A.picked || A.picked.loc || !A.tl) return;
  const cls = A.picked.selector.split(" > ").pop().split(".").slice(1).map((c) => c.split(":")[0]);
  for (const it of A.tl.items()) {
    if (it.kind !== "step" || it.tool !== "grep" || !it.output) continue;
    const line = it.output.split("\n").find((l) => cls.some((c) => c && l.includes(c)) && /^[^:\s]+:\d+/.test(l));
    if (line) {
      const m = line.match(/^([^:\s]+):(\d+)/);
      A.picked.loc = `${m[1].split("/").pop()}:${m[2]}`;
      return;
    }
  }
}

// ── picker ────────────────────────────────────────────────────────────────

export async function togglePick() {
  const tab = S.tab;
  if (!tab) return;
  if (A.picking) {
    A.picking = false;
    await page.stopPicker(tab.id);
    return bump();
  }
  if (!A.access && !(await page.requestAccess(tab.url))) return;
  A.access = true;
  A.picking = true;
  bump();
  try {
    await page.startPicker(tab.id, t("picker.hint", "Click an element · Esc to cancel"));
  } catch {
    A.picking = false;
    bump();
  }
}

async function onPicked(data) {
  A.picking = false;
  A.picked = { ...data, crop: "" };
  A.chips.el = true;
  bump();
  try {
    const shot = await page.screenshot(S.tab.windowId);
    A.picked.crop = await page.crop(shot, data.rect);
  } catch {
    /* screenshot optional */
  }
  syncContext();
  bump();
}

// ── QA ────────────────────────────────────────────────────────────────────

const TAGS = { read: "read", list: "read", grep: "trace", glob: "trace", edit: "edit", write: "edit", patch: "edit", multiedit: "edit", webfetch: "note", task: "note" };
const PHASE = { pickup: "Picked up the report", read: "Reading the report and code", trace: "Tracing the cause in the code", edit: "Editing the code", test: "Testing the fix", run: "Running the estate", deploy: "Deploying", note: "Working" };
const redact = (s) => String(s).replace(/(token|key|secret|password|passwd|authorization)(["']?\s*[:=]\s*["']?)[^\s"']+/gi, "$1$2•••").replace(/Bearer\s+\S+/g, "Bearer •••").replace(/\b(sk|pk|ghp|gho)[-_][A-Za-z0-9_-]{12,}/g, "•••");

function tagFor(it) {
  if (it.tool === "bash") return /\b(test|check|lint|verify)\b/.test(it.arg) ? "test" : /deploy/.test(it.arg) ? "deploy" : /eco up|serve|dev/.test(it.arg) ? "run" : "note";
  return TAGS[it.tool] || "note";
}

function mirrorEvent(ev) {
  if (!A.qa || ev.type !== "message.part.updated") return;
  const part = ev.properties.part;
  if (part.type !== "tool" || part.state.status !== "completed" || A.mirror.seen.has(part.id)) return;
  A.mirror.seen.add(part.id);
  const it = { tool: part.tool, arg: toolArg(part.tool, part.state.input || {}, workDir()) };
  const tag = tagFor(it);
  const text = redact(`${it.tool} ${it.arg}`).slice(0, 300);
  const n = A.qa.n;
  const dir = S.active.dir;
  enqueue(async () => {
    if (A.mirror.tag !== tag) {
      if (A.mirror.tag) await call("eco.pm.qa.step", { dir, n, label: PHASE[A.mirror.tag] || "Working", done: true });
      A.mirror.tag = tag;
      await call("eco.pm.qa.step", { dir, n, label: PHASE[tag] || "Working" });
    }
    await call("eco.pm.log", { dir, tag: tag === "run" ? "note" : tag, text, qa: n });
  });
}

const enqueue = (fn) => (A.mirror.queue = A.mirror.queue.then(fn).catch(() => {}));
const mirrorFlush = () => A.mirror.queue;

export async function runQa(qa) {
  if (!S.active) return;
  const dir = S.active.dir;
  const taken = await call("eco.pm.qa.take", { dir, n: qa.number });
  await newSession();
  const oc = await ensureSession();
  const shots = [];
  for (const name of (taken.shots || []).slice(0, 3)) {
    try {
      const s = await call("qa.shot", { dir, n: qa.number, name });
      if (s.data) shots.push({ type: "file", mime: s.mime, filename: s.name, url: `data:${s.mime};base64,${s.data}` });
    } catch {}
  }
  A.qa = { n: qa.number, title: qa.title };
  A.mirror = { seen: new Set(), queue: Promise.resolve(), tag: "" };
  enqueue(() => call("eco.pm.log", { dir, tag: "pickup", text: `picked up QA #${qa.number} from the side panel`, qa: qa.number }));
  const text = t("qa.prompt", "Work on QA #{n}: {title}", { n: qa.number, title: qa.title || "" });
  const parts = [
    { type: "text", text },
    { type: "text", synthetic: true, text: `${taken.markdown}\n\nReproduce it on the local estate, fix the source, and verify. The side panel reports your progress to /project: do not run \`eco pm\` yourself.` },
    ...shots,
  ];
  await send({ text, parts, chips: [`qa #${qa.number}`, ...shots.map((s) => s.filename), (() => { try { return new URL(S.tab ? S.tab.url : "").host; } catch { return ""; } })()].filter(Boolean), keepDraft: true });
  void oc;
}

async function sendToQa() {
  if (!A.qa) return;
  const tl = A.tl;
  const last = [...tl.items()].reverse().find((i) => i.kind === "text");
  const files = [...tl.files.keys()].slice(0, 8).join(", ");
  const summary = (last ? last.text : "Done.").slice(0, 600) + (files ? `\n\nFiles: ${files}` : "");
  const { dir } = S.active;
  const n = A.qa.n;
  try {
    await mirrorFlush();
    if (A.mirror.tag) await call("eco.pm.qa.step", { dir, n, label: PHASE[A.mirror.tag] || "Working", done: true });
    await call("eco.pm.qa.done", { dir, n, summary: redact(summary) });
    A.toast = t("qa.sent", "Sent to QA #{n}: the reporter verifies it in /project.", { n });
    A.qa = null;
  } catch (e) {
    tl.error = e.message;
  }
  bump();
  S.view = "qa";
  notify();
}

// ── session summary (E) ───────────────────────────────────────────────────

export function sessionStats() {
  const tl = A.tl;
  if (!tl) return null;
  const tasks = [];
  let cur = null;
  const rows = tl.rows();
  for (const m of rows) {
    if (m.role === "user") {
      const text = [...m.parts.values()].filter((p) => p.type === "text" && !p.synthetic).map((p) => p.text).join(" ");
      if (!text.trim()) continue;
      cur = { text, at: (m.info && m.info.time && m.info.time.created) || 0, files: new Set(), reply: "" };
      tasks.push(cur);
    } else if (cur) {
      for (const p of m.parts.values()) {
        if (p.type === "tool" && p.state.status === "completed" && /^(edit|write|patch|multiedit)$/.test(p.tool)) {
          const f = p.state.input && (p.state.input.filePath || p.state.input.path);
          if (f) cur.files.add(f);
        }
        if (p.type === "text" && !p.synthetic) cur.reply = p.text;
      }
    }
  }
  return tasks;
}

async function summarize() {
  const tasks = sessionStats();
  if (!tasks || !tasks.length) return;
  A.mode = "summary";
  A.summary = { tasks, headline: "", results: [], loading: true, sent: false, err: "", links: [] };
  bump();
  const digest = tasks.map((x, i) => `${i + 1}. Request: ${x.text.slice(0, 200)}\n   Files: ${[...x.files].join(", ") || "none"}\n   Outcome: ${x.reply.slice(0, 300)}`).join("\n");
  const prompt = `Draft an executive summary of this work session for a project dashboard. Reply with ONLY a JSON object: {"headline": string (one line, plain language), "results": [{"title": string (3-6 words), "detail": string (one sentence)}]} — at most 5 results, factual, no secrets.\n\nSession:\n${digest}`;
  try {
    const oc = await ensureOpenCode();
    const ses = await oc.createSession("summary draft");
    const tmp = new Timeline(ses.id);
    const done = new Promise((resolve) => {
      const iv = setInterval(async () => {
        try {
          const st = await oc.status();
          if (!st[ses.id]) {
            clearInterval(iv);
            resolve();
          }
        } catch {}
      }, 1000);
      setTimeout(() => (clearInterval(iv), resolve()), 90000);
    });
    await oc.prompt(ses.id, [{ type: "text", text: prompt }], { yolo: yoloOn() });
    await new Promise((r) => setTimeout(r, 800));
    await done;
    tmp.load(await oc.messages(ses.id));
    const reply = tmp.items().filter((i) => i.kind === "text").map((i) => i.text).join("\n");
    oc.deleteSession(ses.id).catch(() => {});
    const json = JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1));
    A.summary.headline = String(json.headline || "");
    A.summary.results = (json.results || []).slice(0, 5).map((r) => ({ title: String(r.title || ""), detail: String(r.detail || ""), on: true }));
  } catch {
    // fall back to a deterministic draft from the session itself
    A.summary.headline = tasks[0].text.slice(0, 90);
    A.summary.results = tasks.slice(0, 5).map((x) => ({ title: x.text.slice(0, 40), detail: x.reply.split("\n")[0].slice(0, 160), on: true }));
  }
  A.summary.loading = false;
  bump();
}

function paintSummary(st) {
  const s = A.summary;
  const tasks = s.tasks;
  const first = tasks[0] && tasks[0].at;
  const mins = first ? Math.max(1, Math.round((Date.now() - first) / 60000)) : 0;
  const fileSet = new Set(tasks.flatMap((x) => [...x.files]));
  const stats = `${t("sum.session", "session")} · ${first ? new Date(first).toTimeString().slice(0, 5) : ""} · ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`} · ${tasks.length} ${t("sum.tasks", "tasks")} · ${fileSet.size} ${t("sum.files", "files")}`;
  const field = (val, on, label) => h("input", { class: "field", style: { height: "32px", fontSize: "13px" }, value: val, "aria-label": label, oninput: (e) => on(e.target.value) });
  clear(
    st,
    h("div", { class: "mono subtle", style: { fontSize: "11.5px" }, text: stats }),
    ...tasks.map((x) => h("div", { class: "card", style: { padding: "10px 12px" }, "data-task": "" }, h("div", { class: "mono subtle", style: { fontSize: "11px" }, text: `${x.at ? new Date(x.at).toTimeString().slice(0, 5) : ""} · ${x.files.size} ${t("sum.files", "files")}` }), h("b", { text: x.text.slice(0, 80) }))),
    h(
      "div",
      { class: "card", style: { padding: "12px", borderColor: "var(--brand)", display: "flex", flexDirection: "column", gap: "8px" }, "data-card": "summary" },
      h("span", { class: "lbl", text: t("sum.draft", "Executive summary · agent draft") }),
      s.loading ? h("div", { class: "run" }, led(16, true), t("sum.drafting", "drafting…")) : null,
      !s.loading && field(s.headline, (v) => (s.headline = v), t("sum.headline", "Headline")),
      ...(!s.loading ? s.results.map((r) => h("div", { class: "crow", style: { alignItems: "flex-start", flexWrap: "nowrap" } }, h("input", { type: "checkbox", checked: r.on, "aria-label": r.title, onchange: (e) => (r.on = e.target.checked) }), h("div", { class: "grow", style: { display: "flex", flexDirection: "column", gap: "4px" } }, field(r.title, (v) => (r.title = v), t("sum.title", "Result title")), field(r.detail, (v) => (r.detail = v), t("sum.detail", "Detail"))))) : []),
      S.tab && !s.loading && h("label", { class: "crow", style: { fontSize: "12.5px" } }, h("input", { type: "checkbox", "data-act": "link-page", onchange: (e) => (s.links = e.target.checked ? [{ label: "page", url: S.tab.url }] : []) }), t("sum.linkPage", "Link the current page")),
      s.err && h("div", { class: "err" }, s.err),
      s.sent && h("div", { class: "dn" }, h("span", { text: t("sum.sent", "Sent. It appears as the banner in /project Summary.") })),
      h("div", { class: "crow" }, h("button", { class: "btn br", "data-act": "send-report", disabled: s.loading || s.sent, onclick: sendReport, text: t("sum.send", "Send to /project") }), h("button", { class: "btn g", "data-act": "back-chat", onclick: () => ((A.mode = "chat"), bump()), text: t("sum.back", "Back") })),
    ),
  );
}

async function sendReport() {
  const s = A.summary;
  const results = s.results.filter((r) => r.on && r.title.trim()).map((r) => ({ title: redact(r.title.replace(/:/g, " -")), detail: redact(r.detail || "-") }));
  if (!s.headline.trim() || !results.length) return ((s.err = t("sum.need", "Add a headline and at least one result.")), bump());
  s.err = "";
  try {
    await call("eco.pm.report", { dir: S.active.dir, headline: redact(s.headline), results, links: s.links });
    s.sent = true;
  } catch (e) {
    s.err = e.message;
  }
  bump();
}
