// Pure reducer: OpenCode events -> the list the panel renders. No DOM here (unit-testable).
const EDIT_TOOLS = new Set(["edit", "write", "patch", "multiedit"]);
const HIDDEN_TOOLS = new Set(["todowrite", "todoread"]);

export class Timeline {
  constructor(sessionID) {
    this.sessionID = sessionID;
    this.messages = new Map(); // id -> {id, role, order, parts: Map}
    this.order = 0;
    this.perms = new Map(); // permission request id -> {req, answer}
    this.busy = false;
    this.error = null;
    this.stopped = false;
    this.chipQueue = []; // chips for user prompts sent from this panel, in order
    this.userChips = new Map(); // user message id -> chips
    this.files = new Map(); // path -> {additions, deletions}
    this.finished = 0; // bumps every time a run ends
    this.revertAt = ""; // /undo: messages from this one on are hidden until /redo
  }

  /// Visible messages in order (after an /undo the reverted tail is hidden).
  rows() {
    const cut = this.revertAt && this.messages.get(this.revertAt) ? this.messages.get(this.revertAt).order : Infinity;
    return [...this.messages.values()].filter((m) => m.order < cut).sort((a, b) => a.order - b.order);
  }

  static userText(m) {
    return [...m.parts.values()].filter((x) => x.type === "text" && !x.synthetic).map((x) => x.text).join("\n");
  }

  lastUser() {
    return this.rows().reverse().find((m) => m.role === "user" && Timeline.userText(m).trim()) || null;
  }

  /// Size of the conversation the model last saw (input + cache + output), from the newest assistant message.
  contextTokens() {
    for (const m of this.rows().reverse()) {
      const k = m.role === "assistant" && m.info && m.info.tokens;
      if (k) return (k.input || 0) + (k.output || 0) + (k.reasoning || 0) + ((k.cache && k.cache.read) || 0) + ((k.cache && k.cache.write) || 0);
    }
    return 0;
  }

  /// {providerID, modelID} of the newest assistant message.
  model() {
    for (const m of this.rows().reverse()) if (m.role === "assistant" && m.info && m.info.providerID) return { providerID: m.info.providerID, modelID: m.info.modelID };
    return null;
  }

  msg(id) {
    let m = this.messages.get(id);
    if (!m) this.messages.set(id, (m = { id, role: "assistant", order: this.order++, parts: new Map() }));
    return m;
  }

  /// Returns true when something visible changed.
  apply(ev) {
    const p = ev && ev.properties;
    if (!p) return false;
    if (p.sessionID && p.sessionID !== this.sessionID) return false;
    switch (ev.type) {
      case "message.updated": {
        const info = p.info;
        const m = this.msg(info.id);
        m.role = info.role;
        m.info = info;
        if (info.role === "user" && !this.userChips.has(info.id)) this.userChips.set(info.id, this.chipQueue.shift() || []);
        if (info.role === "assistant" && info.error && info.error.name !== "MessageAbortedError") this.error = (info.error.data && info.error.data.message) || info.error.name;
        return true;
      }
      case "message.part.updated": {
        const part = p.part;
        const m = this.msg(part.messageID);
        m.parts.set(part.id, part);
        this.trackFiles(part);
        return true;
      }
      case "message.part.delta": {
        const part = this.msg(p.messageID).parts.get(p.partID);
        if (!part) return false;
        part[p.field] = (part[p.field] || "") + p.delta;
        return true;
      }
      case "message.part.removed":
        this.messages.get(p.messageID)?.parts.delete(p.partID);
        return true;
      case "session.status": {
        const busy = p.status && p.status.type !== "idle";
        if (busy && !this.busy) this.stopped = false;
        const changed = busy !== this.busy;
        this.busy = busy;
        if (!busy && changed) this.finished++;
        return changed;
      }
      case "session.idle": {
        const changed = this.busy;
        this.busy = false;
        if (changed) this.finished++;
        return changed;
      }
      case "session.error": {
        const e = p.error;
        if (e && e.name === "MessageAbortedError") this.stopped = true;
        else this.error = (e && e.data && e.data.message) || (e && e.name) || "error";
        if (this.busy) this.finished++;
        this.busy = false;
        return true;
      }
      case "session.diff":
        for (const d of p.diff || []) this.files.set(d.file, { additions: d.additions, deletions: d.deletions });
        return true;
      case "permission.asked":
        this.perms.set(p.id, { req: p, answer: null });
        return true;
      case "permission.replied": {
        const cur = this.perms.get(p.requestID || p.id);
        if (cur) cur.answer = p.reply;
        return true;
      }
      default:
        return false;
    }
  }

  trackFiles(part) {
    if (part.type !== "tool" || !EDIT_TOOLS.has(part.tool) || part.state.status !== "completed") return;
    const f = part.state.input && (part.state.input.filePath || part.state.input.path);
    if (f) this.files.set(f, this.files.get(f) || { additions: 0, deletions: 0 });
  }

  /// Seed from GET /session/:id/message so a reopened panel shows history.
  load(list) {
    for (const row of list || []) {
      const info = row.info;
      const m = this.msg(info.id);
      m.role = info.role;
      m.info = info;
      for (const part of row.parts || []) {
        m.parts.set(part.id, part);
        this.trackFiles(part);
      }
    }
  }

  /// Render items in order.
  items() {
    const out = [];
    const rows = this.rows();
    const permByCall = new Map();
    for (const [, v] of this.perms) if (v.req.tool) permByCall.set(v.req.tool.callID, v);
    const used = new Set();
    for (const m of rows) {
      if (m.role === "user") {
        const text = Timeline.userText(m);
        if (text.trim()) out.push({ kind: "user", id: m.id, text, chips: this.userChips.get(m.id) || [] });
        continue;
      }
      for (const part of m.parts.values()) {
        if (part.type === "text" && part.text && part.text.trim() && !part.synthetic) out.push({ kind: "text", id: part.id, text: part.text });
        else if (part.type === "tool" && !HIDDEN_TOOLS.has(part.tool)) {
          out.push(toolItem(part));
          const pv = permByCall.get(part.callID);
          if (pv) (used.add(pv), out.push({ kind: "perm", id: pv.req.id, req: pv.req, answer: pv.answer }));
        }
      }
    }
    for (const [, v] of this.perms) if (!used.has(v)) out.push({ kind: "perm", id: v.req.id, req: v.req, answer: v.answer });
    return out;
  }

  get waitingForPermission() {
    return [...this.perms.values()].some((v) => !v.answer);
  }

  get stepCount() {
    let n = 0;
    for (const m of this.messages.values()) for (const p of m.parts.values()) if (p.type === "tool" && !HIDDEN_TOOLS.has(p.tool)) n++;
    return n;
  }
}

const rel = (p, dir) => (typeof p === "string" && dir && p.startsWith(dir + "/") ? p.slice(dir.length + 1) : p);

export function toolItem(part, dir = "") {
  const st = part.state || {};
  const input = st.input || {};
  const status = st.status || "pending";
  if (EDIT_TOOLS.has(part.tool) && (status === "completed" || status === "running")) {
    const file = rel(input.filePath || input.path || "", dir);
    const lines = diffLines(part, input);
    const plus = lines.filter((l) => l[0] === "+").length;
    const minus = lines.filter((l) => l[0] === "-").length;
    return { kind: "diff", id: part.id, file, plus, minus, lines: lines.slice(0, 12), more: Math.max(0, lines.length - 12), status };
  }
  const intent = toolIntent(part.tool, input, dir);
  const meta = st.time && st.time.end && st.time.start ? `${((st.time.end - st.time.start) / 1000).toFixed(1)}s` : "";
  return { kind: "step", id: part.id, tool: part.tool, arg: toolArg(part.tool, input, dir), intent, meta, status, error: st.error, output: st.output };
}

export function toolArg(tool, input, dir) {
  switch (tool) {
    case "edit":
    case "write":
    case "patch":
    case "multiedit":
      return rel(input.filePath || input.path || "", dir);
    case "read":
    case "list":
      return rel(input.filePath || input.path || "", dir);
    case "grep":
    case "glob":
      return String(input.pattern || "") + (input.path ? ` · ${rel(input.path, dir)}` : "");
    case "bash":
      return String(input.command || "").split("\n")[0];
    case "webfetch":
      return String(input.url || "");
    case "task":
      return String(input.description || "");
    default:
      return Object.values(input).filter((v) => typeof v === "string").join(" ").slice(0, 120);
  }
}

/// Unified diff rows [sign, text]; from the tool's own unified diff when present, else old/new strings.
export function diffLines(part, input) {
  const md = part.state && part.state.metadata;
  const unified = md && (md.diff || (md.filediff && md.filediff.patch));
  if (typeof unified === "string" && unified.trim()) {
    return unified.split("\n").filter((l) => !/^(Index:|===|---|\+\+\+|@@|\\)/.test(l)).filter((l) => l.length).map((l) => [l[0] === "+" || l[0] === "-" ? l[0] : " ", l.slice(1)]);
  }
  const rows = [];
  if (typeof input.oldString === "string") for (const l of input.oldString.split("\n")) rows.push(["-", l]);
  const next = typeof input.newString === "string" ? input.newString : input.content;
  if (typeof next === "string") for (const l of next.split("\n")) rows.push(["+", l]);
  return rows;
}

/// A short "results" list for the done card.
export function results(tl) {
  const out = [];
  const files = tl.files.size;
  if (files) out.push({ key: "files", n: files });
  return out;
}

/// What a tool call is for, in a form the panel translates: {k, a}. null when the tool gave no intention
/// (a bare shell command says nothing a user can use).
export function toolIntent(tool, input, dir = "") {
  const file = rel(input.filePath || input.path || "", dir);
  switch (tool) {
    case "bash":
      return typeof input.description === "string" && input.description.trim() ? { k: "text", a: input.description.trim() } : null;
    case "task":
      return { k: "text", a: String(input.description || "") || "subtask" };
    case "read":
      return file ? { k: "read", a: file } : null;
    case "list":
      return { k: "list", a: file || "." };
    case "grep":
      return input.pattern ? { k: "grep", a: String(input.pattern) } : null;
    case "glob":
      return input.pattern ? { k: "glob", a: String(input.pattern) } : null;
    case "webfetch":
      try {
        return { k: "fetch", a: new URL(String(input.url)).host };
      } catch {
        return null;
      }
    default:
      return null;
  }
}
