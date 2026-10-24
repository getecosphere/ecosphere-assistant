// Agent tab: our own chat UI on the OpenCode server API, aware of the page you are on.
import { h, clear, svg, ICON } from "./dom.js";
import { t } from "./i18n.js";
import { led, setRunning } from "./led.js";
import { S, call, notify, subscribe, ensureOpenCode, flags } from "./app.js";
import { pref, setPref } from "./prefs.js";
import { Timeline, toolArg } from "./session.js";
import * as page from "./page.js";
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
  A.ref.bar = h("div", { class: "sesbar" });
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
    A.guess = files[0] || "";
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
  const dir = S.active ? shortDir(S.active.dir) : "";
  let title = t("agent.ready", "Agent ready");
  let sub = `opencode · ${dir}`;
  let chip = h("span", { class: "chip c-mut", text: "idle" });
  if (wait) ((title = t("agent.waiting", "Agent is waiting for your permission")), (sub = `${A.tl.stepCount} ${t("agent.steps", "steps")} · ${dir}`), (chip = h("span", { class: "chip c-w", text: t("status.perm", "permission needed") })));
  else if (busy) ((title = t("agent.working", "Agent is working · {n} steps", { n: A.tl.stepCount })), (sub = `opencode · ${dir}`), (chip = h("span", { class: "chip c-br", text: t("status.working", "working") })));
  if (S.ocError) ((title = t("agent.down", "OpenCode is not running")), (chip = h("span", { class: "chip c-bad", text: "down" })));
  const l = led(26, Boolean(busy && !wait));
  A.ref.stripLed = l;
  clear(s, l, h("div", { class: "grow" }, h("b", { text: title }), h("div", { class: "sub", text: sub })), chip, h("div", { class: "progress" + (busy && !wait ? " ind" : ""), style: wait ? { width: "50%" } : {} }));
}

function paintBar() {
  const b = A.ref.bar;
  if (!b) return;
  const n = A.tl ? A.tl.contextTokens() : 0;
  const big = n >= 100000;
  clear(
    b,
    h("button", { class: "sesbtn", "data-act": "sessions", "aria-haspopup": "dialog", "aria-expanded": String(A.mode === "sessions"), title: t("ses.open", "Sessions"), onclick: () => (A.mode === "sessions" ? closeSessions() : openSessions()) }, h("span", { class: "t", "data-session-title": "", text: A.meta ? sessionTitle(A.meta) : t("ses.new", "New session") }), h("span", { text: "▾" })),
    n > 0 && h("span", { class: "cc" + (big ? " on" : ""), "data-ctx": "", title: t("ses.ctx", "Size of the conversation sent to the model. A smaller context costs fewer tokens: /compact summarizes it."), text: `ctx ${fmtTokens(n)}` }),
    big && h("button", { class: "btn g sm", "data-act": "compact", onclick: () => runBuiltin("compact"), text: t("ses.compact", "Compact") }),
    h("span", { class: "grow" }),
    h("button", { class: "btn g sm", "data-act": "new-session", onclick: newSession, text: "+ " + t("ses.newShort", "New") }),
  );
}

function paintStream() {
  const st = A.ref.stream;
  if (!st) return;
  const nearBottom = st.scrollHeight - st.scrollTop - st.clientHeight < 80;
  if (A.mode === "summary") return paintSummary(st);
  if (A.mode === "sessions") return clear(st, A.sesPanel.el);
  const tl = A.tl;
  const kids = [];
  A.ref.ctxHost = h("div");
  kids.push(A.ref.ctxHost);
  if (!A.tl || A.tl.items().length === 0) kids.push(suggestions());
  if (S.ocError) kids.push(h("div", { class: "err", "data-err": "opencode" }, t("agent.downMsg", "Could not reach the local OpenCode server: {e}", { e: S.ocError }), h("button", { class: "btn g", "data-act": "restart-oc", onclick: restartOc, text: t("agent.restart", "Restart OpenCode") })));
  if (!tl || tl.items().length === 0) {
    if (S.active) kids.push(h("div", { class: "mt", text: t("agent.connected", "Connected to {p} · {dir}.", { p: S.active.project, dir: shortDir(S.active.dir) }) }));
  }
  if (tl) {
    for (const it of tl.items()) kids.push(renderItem(it));
    if (A.toast) kids.push(h("div", { class: "pm", style: { background: "var(--ok-wash)", borderColor: "var(--ok-line)" } }, A.toast));
    if (!tl.busy && tl.finished > 0 && tl.stepCount + tl.items().length > 0 && !tl.error && !tl.stopped) kids.push(doneCard());
    if (tl.error) kids.push(h("div", { class: "err", "data-err": "run" }, tl.error));
    if (tl.stopped) kids.push(h("div", { class: "mt subtle", text: t("agent.stopped", "Stopped.") }));
    if (tl.busy && !tl.waitingForPermission) kids.push(h("div", { class: "run" }, led(16, true), t("agent.thinking", "working…")));
  }
  clear(st, ...kids);
  paintCtx();
  if (nearBottom) st.scrollTop = st.scrollHeight;
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

function renderItem(it) {
  switch (it.kind) {
    case "user":
      return h("div", { class: "mu", "data-kind": "user" }, it.text, it.chips.length > 0 && h("div", { class: "chips" }, ...it.chips.map((c) => h("span", { text: c }))));
    case "text":
      return h("div", { class: "mt", "data-kind": "text", text: it.text });
    case "step": {
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
  const label = { once: t("perm.once.done", "allowed once"), always: t("perm.always.done", "always allowed for this project"), reject: t("perm.reject.done", "rejected") }[answered];
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

function paintActions() {
  const a = A.ref.actions;
  if (!a) return;
  const busy = A.tl && A.tl.busy;
  clear(a, h("span", { class: "mono subtle", style: { fontSize: "11.5px" }, text: `opencode · ${pref("agentName", "build")}` }), h("span", { class: "grow" }), busy && h("button", { class: "btn g", "data-act": "stop", onclick: stop, text: t("agent.stop", "Stop") }), h("button", { class: "btn br", "data-act": "send", disabled: A.sending, onclick: send, text: t("agent.send", "Send") + " ↵" }));
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
  const dir = S.active.dir;
  if (A.connectedDir === dir) return;
  if (A.connectedDir) ((A.tl = null), (A.sessionId = ""), (A.meta = null), (A.qa = null), (A.picked = null), (A.mode = "chat"));
  A.connecting = true;
  try {
    const oc = await ensureOpenCode();
    A.connectedDir = dir;
    if (!A.tl) A.sessionId = pref(`session:${dir}`, "");
    if (!A.tl && A.sessionId) {
      try {
        const tl = new Timeline(A.sessionId);
        tl.load(await oc.messages(A.sessionId));
        A.tl = tl;
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
  setPref(`session:${S.active.dir}`, ses.id);
  return oc;
}

/// A blank start: nothing is created on the server until the first message (no empty sessions pile up).
export async function newSession() {
  A.sessionId = "";
  A.tl = null;
  A.meta = null;
  A.qa = null;
  A.mode = "chat";
  if (S.active) setPref(`session:${S.active.dir}`, "");
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
  A.meta = null;
  A.qa = null;
  A.mode = "chat";
  setPref(`session:${S.active.dir}`, id);
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
      if (id === A.sessionId) ((A.tl = null), (A.sessionId = ""), (A.meta = null), setPref(`session:${S.active.dir}`, ""));
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
];
const builtinFor = (n) => BUILTIN.find((b) => b.name === n || b.alias.includes(n));

function flash(msg) {
  A.toast = msg;
  bump();
  setTimeout(() => ((A.toast = ""), paintStream()), 4000);
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
    if (S.active) ctx.push(`- Project: ${S.active.project} (${S.active.dir})`);
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
  for (const f of A.attach || []) if (text.includes(`@${f}`)) parts.push({ type: "file", mime: "text/plain", filename: f.split("/").pop(), url: `file://${S.active.dir}/${f}` });
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
    else await oc.prompt(A.sessionId, parts, { agent: pref("agentName", "") || undefined });
    A.tl.busy = true;
  } catch (e) {
    if (e.status === 404 && !opts.retried) {
      // the session no longer exists on the server (fresh install, wiped data): start a new one
      A.sending = false;
      A.tl = null;
      A.sessionId = "";
      setPref(`session:${S.active.dir}`, "");
      return send({ ...opts, retried: true, text, keepDraft: true });
    }
    if (e instanceof TypeError) {
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

async function restartOc() {
  try {
    await call("oc.stop", { dir: S.active.dir });
  } catch {}
  S.oc = null;
  S.ocError = "";
  A.connectedDir = "";
  notify();
  connect();
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
  const it = { tool: part.tool, arg: toolArg(part.tool, part.state.input || {}, S.active.dir) };
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
    await oc.prompt(ses.id, [{ type: "text", text: prompt }]);
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
