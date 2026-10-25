// Welcome tour: what the extension does, step by step, for a first-time user (novice to expert).
// Shown before sign-in until it is finished or skipped; the avatar menu replays it.
import { h, clear } from "./dom.js";
import { t } from "./i18n.js";
import { led } from "./led.js";
import { S, notify } from "./app.js";
import { setPref } from "./prefs.js";

const ui = { i: 0 };
const mod = /Mac/.test(navigator.userAgent) ? "⌘⇧E" : "Ctrl+Shift+E";

const flow = () =>
  h(
    "div",
    { class: "flow", "aria-hidden": "true" },
    h("div", {}, h("b", { text: t("in.f.panel", "This panel") }), h("span", { text: t("in.f.panelS", "what you see and click") })),
    h("i", { text: "→" }),
    h("div", {}, h("b", { text: t("in.f.helper", "Helper") }), h("span", { text: t("in.f.helperS", "small program on your computer") })),
    h("i", { text: "→" }),
    h("div", {}, h("b", { text: "OpenCode" }), h("span", { text: t("in.f.agent", "the AI coding agent") }), h("b", { class: "sub2", text: "eco" }), h("span", { text: t("in.f.eco", "your Ecosphere account") })),
  );

const slides = () => [
  {
    id: "what",
    title: t("in.what.t", "Meet your coding agent"),
    body: [t("in.what.p", "Ecosphere Assistant sits beside the web page you are looking at. Point at something on the page, say what you want (\"make this button bigger\", \"why is this page slow?\"), and an AI coding agent changes the source code on your own computer. No terminal needed.")],
    points: [t("in.what.1", "New to coding? Describe what you want in plain words. The agent does the typing."), t("in.what.2", "Experienced? It is OpenCode with your page, console errors and project rules as context, plus sessions, undo and permissions.")],
    expert: t("in.what.x", "A Manifest V3 side panel. The agent is an OpenCode server on 127.0.0.1; this panel is its interface and talks to its HTTP API."),
  },
  {
    id: "local",
    title: t("in.local.t", "Your code stays on your machine"),
    diagram: flow,
    body: [t("in.local.p", "The panel talks to a small helper program on your computer. The helper starts the agent (OpenCode) and runs the eco tool for your account. The panel never uploads your files."), t("in.local.p2", "What you type, and the code the agent reads to answer you, goes to the AI model provider your OpenCode is set up with. This is how every AI coding agent works.")],
    expert: t("in.local.x", "Chrome native messaging host com.ecosphere.assistant with a fixed allowlist of actions and no shell. OpenCode listens on 127.0.0.1 with a random password per launch (started through launchd on macOS). The extension stores no tokens: signed in means the eco CLI here is signed in."),
  },
  {
    id: "page",
    title: t("in.page.t", "It sees the page you are on"),
    points: [
      t("in.page.1", "Page context: the address of the tab and our best guess of the source file behind it."),
      t("in.page.2", "Pick an element ({k}): click anything on the page. The agent gets its HTML, styles and a picture of it.", { k: mod }),
      t("in.page.3", "Console errors: red errors from the page can be attached to your message."),
      t("in.page.4", "Screenshot: attach what the tab looks like right now."),
      t("in.page.5", "After a change, press Reload tab to see the result."),
    ],
    expert: t("in.page.x", "Element data is read on demand with activeTab and scripting; no content script runs on your pages. A screenshot needs a one-time permission for the site."),
  },
  {
    id: "sessions",
    title: t("in.ses.t", "Sessions: one topic, one conversation"),
    body: [t("in.ses.p", "A session is one conversation with the agent. Start a new one for each topic: it costs less and the agent stays focused.")],
    points: [
      t("in.ses.1", "The session title and + New: start, switch, search, rename, fork or delete sessions."),
      t("in.ses.2", "The ctx chip shows how big the conversation is. Hover it to learn what it means and when to press Compact."),
      t("in.ses.3", "Type / for commands: /new /sessions /compact /undo /redo /rename /fork /share."),
      t("in.ses.4", "Work folder: the folder you normally start your agent from. Its sessions and its AGENTS.md rules apply."),
    ],
    expert: t("in.ses.x", "These are OpenCode's own sessions, per working directory, so they match the ones you open in its terminal."),
  },
  {
    id: "control",
    title: t("in.ctl.t", "You stay in control"),
    body: [t("in.ctl.p", "The agent asks before it does something risky, and you can stop or undo it at any time.")],
    points: [
      t("in.ctl.1", "Permission cards: allow once, always for this project, or reject."),
      t("in.ctl.2", "Stop halts the agent. /undo reverts its last change."),
      t("in.ctl.3", "Steps (avatar menu): show only what the agent intends, nothing, or every command."),
      t("in.ctl.4", "Nothing is deployed unless you confirm it in the Project tab."),
      t("in.ctl.5", "Sharing a session publishes it at a public link, so it always asks first."),
    ],
  },
  {
    id: "tabs",
    title: t("in.tabs.t", "Build and ship from the panel"),
    points: [
      t("in.tabs.1", "Agent: the conversation."),
      t("in.tabs.2", "Compose: add or remove building blocks (LXS) of your project and run it locally."),
      t("in.tabs.3", "QA: turn what you see on the page into a bug report, or let the agent work on waiting requests."),
      t("in.tabs.4", "Project: hosting, plan and deploying the version built on your machine, always with a confirmation."),
    ],
    body: [t("in.tabs.p", "QA and Project appear once your project is linked to your /project dashboard.")],
  },
  {
    id: "setup",
    title: t("in.setup.t", "Setup takes a few quick steps"),
    points: [
      t("in.setup.1", "Sign in with Google. This uses the eco tool on this computer; the panel never sees your password."),
      t("in.setup.2", "Install the helper: one line in a terminal."),
      t("in.setup.3", "OpenCode, the agent: installed for you."),
      t("in.setup.4", "Pick your project folder."),
      t("in.setup.5", "Link to /project (optional)."),
    ],
    body: [t("in.setup.p", "You can stop at any point: this panel remembers where you were. The tour is always available from the avatar menu.")],
  },
];

export function finishIntro() {
  setPref("introDone", true);
  S.intro = false;
  ui.i = 0;
  notify();
}

export function mountIntro(root) {
  const el = h("div", { class: "intro" });
  root.append(el);
  return () => paint(el);
}

function paint(el) {
  const list = slides();
  ui.i = Math.max(0, Math.min(ui.i, list.length - 1));
  const s = list[ui.i];
  const last = ui.i === list.length - 1;
  const go = (d) => () => ((ui.i += d), notify(), requestAnimationFrame(() => el.querySelector("h2")?.focus()));
  clear(
    el,
    h("div", { class: "progress ob-prog", role: "progressbar", "aria-label": t("in.progress", "Tour progress"), "aria-valuemin": "1", "aria-valuemax": String(list.length), "aria-valuenow": String(ui.i + 1) }, h("i", { style: { width: `${Math.round(((ui.i + 1) / list.length) * 100)}%` } })),
    h("div", { class: "in-card", "data-slide": s.id, "aria-live": "polite" },
      ui.i === 0 && h("div", { class: "in-led" }, led(56, true)),
      h("div", { class: "in-n", text: t("in.n", "{i} of {n}", { i: ui.i + 1, n: list.length }) }),
      h("h2", { tabindex: "-1", text: s.title }),
      s.diagram && s.diagram(),
      ...(s.body || []).map((p) => h("p", { text: p })),
      s.points && h("ul", {}, ...s.points.map((p) => h("li", { text: p }))),
      s.expert && h("details", { class: "in-x" }, h("summary", { text: t("in.expert", "For experts") }), h("p", { text: s.expert })),
    ),
    h("div", { class: "in-nav" },
      h("button", { class: "btn g", "data-act": "intro-skip", onclick: finishIntro, text: t("in.skip", "Skip tour") }),
      h("span", { class: "grow" }),
      ui.i > 0 && h("button", { class: "btn g", "data-act": "intro-back", onclick: go(-1), text: t("in.back", "Back") }),
      h("button", { class: "btn br", "data-act": last ? "intro-done" : "intro-next", onclick: last ? finishIntro : go(1), text: last ? t("in.start", "Start setup") : t("in.next", "Next") }),
    ),
  );
}

export const replayIntro = () => {
  ui.i = 0;
  S.intro = true;
  notify();
};
