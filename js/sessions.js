// Sessions list: the panel's version of OpenCode's session picker (switch, search, rename, fork, delete).
import { h, clear } from "./dom.js";
import { t } from "./i18n.js";

export const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

export const sessionTitle = (s) => (s && s.title && !/^(new session|child session)/i.test(s.title) ? s.title : t("ses.untitled", "New session"));

function ago(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 1) return t("ses.now", "just now");
  if (m < 60) return t("ses.min", "{n} min ago", { n: m });
  if (m < 1440) return t("ses.hour", "{n} h ago", { n: Math.round(m / 60) });
  return t("ses.day", "{n} d ago", { n: Math.round(m / 1440) });
}

const tokensOf = (k) => (k ? (k.input || 0) + (k.output || 0) + (k.reasoning || 0) + ((k.cache && k.cache.read) || 0) + ((k.cache && k.cache.write) || 0) : 0);

/// actions: {pick(id), create(), rename(id, title), fork(id), remove(id), search(q), close()}
export function sessionsPanel(actions) {
  const st = { list: [], busy: new Set(), current: "", confirm: "", renaming: "", loading: true, err: "" };
  const q = h("input", { class: "sesq", type: "search", "aria-label": t("ses.search", "Search sessions"), placeholder: t("ses.search", "Search sessions"), oninput: () => actions.search(q.value.trim()) });
  const list = h("div", { class: "seslist", role: "list" });
  const el = h(
    "div",
    { class: "sespanel", "data-view": "sessions" },
    h("div", { class: "seshead" }, h("b", { text: t("ses.title", "Sessions") }), h("span", { class: "grow" }), h("button", { class: "btn br", "data-act": "ses-new", onclick: actions.create, text: "+ " + t("ses.new", "New session") }), h("button", { class: "btn g", "data-act": "ses-close", "aria-label": t("ses.close", "Close"), onclick: actions.close, text: "✕" })),
    q,
    list,
  );

  const icon = (act, label, text, fn) => h("button", { class: "ib", "data-act": act, title: label, "aria-label": label, onclick: (e) => (e.stopPropagation(), fn()), text });

  function row(s) {
    const cur = s.id === st.current;
    const k = tokensOf(s.tokens);
    const meta = [ago((s.time && (s.time.updated || s.time.created)) || Date.now()), k ? `${fmtTokens(k)} tok` : "", s.summary && s.summary.files ? `${s.summary.files} files` : ""].filter(Boolean).join(" · ");
    if (st.renaming === s.id) {
      const inp = h("input", {
        class: "sesq",
        value: sessionTitle(s),
        "aria-label": t("ses.rename", "Rename session"),
        onkeydown: (e) => {
          if (e.key === "Enter" && inp.value.trim()) ((st.renaming = ""), actions.rename(s.id, inp.value.trim()));
          if (e.key === "Escape") ((st.renaming = ""), render());
        },
      });
      queueMicrotask(() => (inp.focus(), inp.select()));
      return h("div", { class: "sesrow", "data-session": s.id }, inp);
    }
    const tail =
      st.confirm === s.id
        ? [h("span", { class: "subtle mono", style: { fontSize: "11px" }, text: t("ses.sure", "Delete?") }), h("button", { class: "btn g sm", "data-act": "ses-del-yes", onclick: () => ((st.confirm = ""), actions.remove(s.id)), text: t("ses.yes", "Delete") }), h("button", { class: "btn g sm", onclick: () => ((st.confirm = ""), render()), text: t("ses.no", "Keep") })]
        : [icon("ses-rename", t("ses.rename", "Rename session"), "✎", () => ((st.renaming = s.id), render())), icon("ses-fork", t("ses.fork", "Fork session"), "⑂", () => actions.fork(s.id)), icon("ses-del", t("ses.delete", "Delete session"), "✕", () => ((st.confirm = s.id), render()))];
    return h(
      "div",
      { class: "sesrow" + (cur ? " cur" : ""), role: "listitem", "data-session": s.id },
      h("button", { class: "sesmain", "aria-current": cur ? "true" : "false", onclick: () => actions.pick(s.id) }, h("span", { class: "t" }, st.busy.has(s.id) && h("span", { class: "dot", title: t("ses.running", "running") }), sessionTitle(s)), h("span", { class: "m", text: meta })),
      ...tail,
    );
  }

  function render() {
    if (st.err) return clear(list, h("div", { class: "err", text: st.err }));
    if (st.loading && !st.list.length) return clear(list, h("div", { class: "mt subtle", text: t("ses.loading", "Loading sessions…") }));
    if (!st.list.length) return clear(list, h("div", { class: "mt subtle", "data-empty": "", text: t("ses.empty", "No sessions yet. Send a message to start one.") }));
    clear(list, ...st.list.map(row));
  }
  render();

  return {
    el,
    focus: () => q.focus(),
    set(patch) {
      Object.assign(st, patch);
      render();
    },
    query: () => q.value.trim(),
  };
}
