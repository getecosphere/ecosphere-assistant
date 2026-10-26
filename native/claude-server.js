"use strict";
// Claude Code behind the subset of the OpenCode server API the side panel uses (js/oc.js), so one panel drives either agent.
// One server per work folder, loopback only, HTTP Basic auth with the helper's per-launch password (as `opencode serve`).
// Each prompt runs `claude -p` (stream-json in and out) and its output becomes OpenCode events on GET /event.
// Tool permissions come back through the `eco` MCP tool (perm-mcp.js) and are asked in the panel, unless the user
// turned YOLO on (then the run gets --dangerously-skip-permissions).
// Run: CLAUDE_BIN=… OPENCODE_SERVER_PASSWORD=… node claude-server.js --port N   (cwd = the work folder)

const { spawn, execFile } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

const VERSION = "1.0.0";
const PORT = Number(process.argv[process.argv.indexOf("--port") + 1]) || 0;
const DIR = process.cwd();
const PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || "";
const CLAUDE = process.env.CLAUDE_BIN || "claude";
const RULES = JSON.parse(process.env.WORKSPACE_RULES || "[]");
const HOME_DIR = process.env.ECOSPHERE_ASSISTANT_HOME || path.join(os.homedir(), ".ecosphere-assistant");
const TMP = path.join(HOME_DIR, "tmp");
const TITLES = path.join(HOME_DIR, "claude-titles.json");
const PROJECT = path.join(os.homedir(), ".claude", "projects", DIR.replace(/[^a-zA-Z0-9]/g, "-"));
const PERM_TOKEN = crypto.randomBytes(18).toString("base64url");
const CONTEXT_MARK = "Browser context from the Ecosphere Assistant side panel:";
const OUT_MAX = 8000;

const rid = (p) => `${p}_${crypto.randomBytes(9).toString("hex")}`;
const clients = new Set();
function emit(type, properties) {
  const line = `data: ${JSON.stringify({ type, properties })}\n\n`;
  for (const res of clients) res.write(line);
}

// ── sessions = Claude Code transcripts of this folder (~/.claude/projects/<folder>/<id>.jsonl) ──

const fresh = new Map(); // id -> created (made here, no transcript until the first prompt)
const runs = new Map(); // id -> {child, aborted, tools: Map(callID -> part), last}
const pending = new Map(); // permission id -> {perm, input, resolve}
const always = new Set(); // "Bash:<command>" or tool name, allowed for the life of this server ("always for this project")
let model = "";

const readTitles = () => {
  try {
    return JSON.parse(fs.readFileSync(TITLES, "utf8"));
  } catch {
    return {};
  }
};
const transcript = (id) => path.join(PROJECT, `${id}.jsonl`);
const validId = (id) => /^[0-9a-f-]{36}$/.test(id);

function lines(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/// The user's own words in a transcript line, or "" (tool results, reminders and command echoes are not).
function userWords(o) {
  if (o.type !== "user" || o.isSidechain || o.isMeta) return "";
  const c = o.message && o.message.content;
  const texts = typeof c === "string" ? [c] : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text) : [];
  const t = texts.find((x) => x && !x.startsWith("<") && !x.startsWith(CONTEXT_MARK));
  return t ? t.trim() : "";
}

const firstWords = new Map(); // file -> {mtime, title}
function info(id) {
  const titles = readTitles();
  const f = transcript(id);
  let st = null;
  try {
    st = fs.statSync(f);
  } catch {
    /* not written yet */
  }
  if (!st && !fresh.has(id)) return null;
  let title = titles[id] || "";
  if (!title && st) {
    const c = firstWords.get(f);
    if (c && c.mtime === st.mtimeMs) title = c.title;
    else {
      const head = fs.readFileSync(f, "utf8").slice(0, 200000).split("\n");
      for (const l of head) {
        try {
          const w = userWords(JSON.parse(l));
          if (w) {
            title = w.split("\n")[0].slice(0, 80);
            break;
          }
        } catch {
          /* partial line */
        }
      }
      firstWords.set(f, { mtime: st.mtimeMs, title });
    }
  }
  const created = st ? st.birthtimeMs : fresh.get(id);
  return { id, title: title || "New session", directory: DIR, version: VERSION, time: { created, updated: st ? st.mtimeMs : created } };
}

function listSessions(q) {
  let ids = [];
  try {
    ids = fs.readdirSync(PROJECT).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6)).filter(validId);
  } catch {
    /* no transcripts yet */
  }
  for (const id of fresh.keys()) if (!ids.includes(id)) ids.push(id);
  let out = ids.map(info).filter(Boolean).filter((s) => s.title !== "New session" || fresh.has(s.id) || runs.has(s.id));
  if (q.search) out = out.filter((s) => s.title.toLowerCase().includes(String(q.search).toLowerCase()));
  out.sort((a, b) => b.time.updated - a.time.updated);
  return out.slice(0, Number(q.limit) || 50);
}

// ── Claude Code tools -> the OpenCode tool shapes the panel renders ──

const TOOL = { Bash: "bash", Read: "read", Edit: "edit", MultiEdit: "multiedit", Write: "write", Grep: "grep", Glob: "glob", LS: "list", WebFetch: "webfetch", Task: "task", Agent: "task", TodoWrite: "todowrite", NotebookEdit: "edit" };
const toolName = (n) => TOOL[n] || String(n || "tool").toLowerCase();

function toolInput(name, i = {}) {
  const out = { ...i };
  if (i.file_path || i.notebook_path) out.filePath = i.file_path || i.notebook_path;
  if (typeof i.old_string === "string") out.oldString = i.old_string;
  if (typeof i.new_string === "string") out.newString = i.new_string;
  if (name === "MultiEdit" && Array.isArray(i.edits)) ((out.oldString = i.edits.map((e) => e.old_string).join("\n")), (out.newString = i.edits.map((e) => e.new_string).join("\n")));
  return out;
}

function resultText(c) {
  const t = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";
  return t.length > OUT_MAX ? t.slice(0, OUT_MAX) + "\n…" : t;
}

/// Claude's structuredPatch -> the unified diff text the panel's diff card reads (state.metadata.diff).
function patchText(r) {
  const p = r && Array.isArray(r.structuredPatch) ? r.structuredPatch : null;
  return p ? p.flatMap((h) => h.lines || []).join("\n") : "";
}

const tokens = (u) => (u ? { input: u.input_tokens || 0, output: u.output_tokens || 0, reasoning: 0, cache: { read: u.cache_read_input_tokens || 0, write: u.cache_creation_input_tokens || 0 } } : undefined);

/// One transcript/stream line -> OpenCode rows/parts. `msgs` is a Map(id -> {info, parts: Map}), `tools` Map(callID -> part).
function absorb(o, sessionID, msgs, tools, live) {
  if (o.isSidechain || o.parent_tool_use_id) return;
  const now = Date.now();
  if (o.type === "assistant" && o.message) {
    const m = o.message;
    let row = msgs.get(m.id);
    if (!row) msgs.set(m.id, (row = { info: { id: m.id, sessionID, role: "assistant", providerID: "anthropic", modelID: m.model, time: { created: now } }, parts: new Map() }));
    if (m.usage) row.info.tokens = tokens(m.usage);
    if (m.model) model = m.model;
    if (live) emit("message.updated", { sessionID, info: row.info });
    for (const b of m.content || []) {
      let part = null;
      if (b.type === "text" && b.text && b.text.trim()) part = { id: `${m.id}_${row.parts.size}`, messageID: m.id, sessionID, type: "text", text: b.text };
      else if (b.type === "tool_use") {
        part = { id: b.id, callID: b.id, messageID: m.id, sessionID, type: "tool", tool: toolName(b.name), state: { status: "running", input: toolInput(b.name, b.input), time: { start: now } } };
        tools.set(b.id, part);
      }
      if (!part) continue;
      row.parts.set(part.id, part);
      if (live) emit("message.part.updated", { sessionID, part });
    }
    return;
  }
  if (o.type !== "user" || !o.message) return;
  const c = o.message.content;
  const results = Array.isArray(c) ? c.filter((b) => b.type === "tool_result") : [];
  for (const b of results) {
    const part = tools.get(b.tool_use_id);
    if (!part) continue;
    const out = resultText(b.content);
    const diff = patchText(o.toolUseResult || o.tool_use_result);
    part.state = { ...part.state, status: b.is_error ? "error" : "completed", output: out, ...(b.is_error ? { error: out } : {}), ...(diff ? { metadata: { diff } } : {}), time: { start: part.state.time.start, end: now } };
    if (live) emit("message.part.updated", { sessionID, part });
  }
  if (results.length || live) return; // a live prompt's own user message is emitted when it is sent
  const words = userWords(o);
  if (!words) return;
  const id = o.uuid || rid("msg");
  const parts = new Map();
  for (const b of typeof c === "string" ? [{ type: "text", text: c }] : c) {
    if (b.type !== "text" || !b.text) continue;
    const pid = `${id}_${parts.size}`;
    parts.set(pid, { id: pid, messageID: id, sessionID, type: "text", text: b.text, ...(b.text.startsWith(CONTEXT_MARK) ? { synthetic: true } : {}) });
  }
  msgs.set(id, { info: { id, sessionID, role: "user", time: { created: Date.parse(o.timestamp) || now } }, parts });
}

function messages(id) {
  const msgs = new Map();
  const tools = new Map();
  for (const o of lines(transcript(id))) absorb(o, id, msgs, tools, false);
  return [...msgs.values()].map((r) => ({ info: r.info, parts: [...r.parts.values()] }));
}

// ── a run: one prompt = one `claude -p` process ──

function contentBlocks(parts) {
  const out = [];
  for (const p of parts || []) {
    if (p.type === "text" && p.text) out.push({ type: "text", text: p.text });
    else if (p.type === "file" && typeof p.url === "string") {
      const m = p.url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/);
      if (m) out.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
      else if (p.url.startsWith("file://")) out.push({ type: "text", text: `@${path.relative(DIR, p.url.slice(7))}` });
    }
  }
  return out;
}

function run(id, parts, { yolo = false, visible = true, modelID = "" } = {}) {
  if (runs.has(id)) throw Object.assign(new Error("this session is already working"), { status: 409 });
  fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
  const resume = fs.existsSync(transcript(id));
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", ...(resume ? ["--resume", id] : ["--session-id", id])];
  let mcp = "";
  if (yolo) args.push("--dangerously-skip-permissions");
  else {
    mcp = path.join(TMP, `claude-mcp-${id}.json`);
    const env = { ECO_PERM_URL: `http://127.0.0.1:${PORT}/internal/perm`, ECO_PERM_TOKEN: PERM_TOKEN, ECO_SESSION: id };
    fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { eco: { command: process.execPath, args: [path.join(__dirname, "perm-mcp.js")], env } } }), { mode: 0o600 });
    args.push("--permission-mode", "default", "--mcp-config", mcp, "--permission-prompt-tool", "mcp__eco__approve");
  }
  if (modelID) args.push("--model", modelID);
  if (RULES.length) args.push("--append-system-prompt", `Read and follow the workspace rules in ${RULES.join(", ")} before you change anything.`);

  const now = Date.now();
  if (visible) {
    const uid = rid("msg");
    emit("message.updated", { sessionID: id, info: { id: uid, sessionID: id, role: "user", time: { created: now } } });
    parts.filter((p) => p.type === "text").forEach((p, i) => emit("message.part.updated", { sessionID: id, part: { id: `${uid}_${i}`, messageID: uid, sessionID: id, type: "text", text: p.text, ...(p.synthetic ? { synthetic: true } : {}) } }));
  }
  const child = spawn(CLAUDE, args, { cwd: DIR, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  const r = { child, aborted: false, tools: new Map(), msgs: new Map(), result: null, err: "" };
  runs.set(id, r);
  fresh.delete(id);
  emit("session.status", { sessionID: id, status: { type: "busy" } });
  child.stdin.end(JSON.stringify({ type: "user", message: { role: "user", content: contentBlocks(parts) } }) + "\n");
  child.stderr.on("data", (d) => (r.err = (r.err + d).slice(-2000)));
  readline.createInterface({ input: child.stdout }).on("line", (l) => {
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      return;
    }
    if (o.type === "result") r.result = o;
    else absorb(o, id, r.msgs, r.tools, true);
  });
  const done = (code) => {
    if (runs.get(id) !== r) return;
    runs.delete(id);
    if (mcp) fs.rmSync(mcp, { force: true });
    for (const [pid, p] of pending) if (p.perm.sessionID === id) (pending.delete(pid), p.resolve({ behavior: "deny", message: "The run ended." }));
    const res = r.result;
    if (r.aborted) emit("session.error", { sessionID: id, error: { name: "MessageAbortedError" } });
    else if (res ? res.is_error || res.subtype !== "success" : code !== 0)
      emit("session.error", { sessionID: id, error: { name: "UnknownError", data: { message: (res && (res.result || (res.errors || []).join("; ") || res.subtype)) || r.err.trim().split("\n").pop() || `claude exited with ${code}` } } });
    emit("session.status", { sessionID: id, status: { type: "idle" } });
    emit("session.idle", { sessionID: id });
    const i = info(id);
    if (i) emit("session.updated", { info: i });
  };
  child.on("close", done);
  child.on("error", (e) => ((r.err = e.message), done(1)));
}

// ── permissions: perm-mcp.js asks here, the panel answers on POST /permission/:id/reply ──

function permKey(tool, input) {
  return tool === "Bash" ? `Bash:${input.command || ""}` : tool;
}

function askPermission({ session, tool_name: tool, input = {}, tool_use_id: callID }) {
  if (always.has(permKey(tool, input))) return Promise.resolve({ behavior: "allow", updatedInput: input });
  const r = runs.get(session);
  const part = r && r.tools.get(callID);
  const i = toolInput(tool, input);
  const pattern = tool === "Bash" ? String(input.command || "") : String(i.filePath || input.url || input.pattern || "");
  const perm = { id: rid("per"), sessionID: session, permission: toolName(tool), patterns: pattern ? [pattern] : [], metadata: { description: input.description || "" }, ...(part ? { tool: { messageID: part.messageID, callID } } : {}) };
  return new Promise((resolve) => {
    pending.set(perm.id, { perm, input, tool, resolve });
    emit("permission.asked", perm);
  });
}

function reply(id, answer) {
  const p = pending.get(id);
  if (!p) return false;
  pending.delete(id);
  if (answer === "always") always.add(permKey(p.tool, p.input));
  emit("permission.replied", { sessionID: p.perm.sessionID, requestID: id, reply: answer });
  p.resolve(answer === "reject" ? { behavior: "deny", message: "The user rejected this step." } : { behavior: "allow", updatedInput: p.input });
  return true;
}

// ── files for @-mentions ──

let fileCache = { at: 0, list: [] };
function findFiles(query, limit) {
  const pick = (list) => list.filter((f) => f.toLowerCase().includes(String(query || "").toLowerCase())).slice(0, limit);
  if (Date.now() - fileCache.at < 30000) return Promise.resolve(pick(fileCache.list));
  return new Promise((resolve) =>
    execFile("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: DIR, maxBuffer: 32 << 20 }, (err, out) => {
      fileCache = { at: Date.now(), list: err ? [] : out.split("\n").filter(Boolean) };
      resolve(pick(fileCache.list));
    }),
  );
}

// ── HTTP ──

function body(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const json = (res, code, v) => (res.writeHead(code, { "Content-Type": "application/json" }), res.end(JSON.stringify(v)));
const NOT_HERE = (what) => ({ status: 501, message: `${what} is not available with Claude Code` });

async function route(req, res, url) {
  const m = req.method;
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  let g;
  if (m === "GET" && p === "/global/health") return { healthy: true, version: VERSION, agent: "claude" };
  if (m === "GET" && p === "/session") return listSessions(q);
  if (m === "POST" && p === "/session") {
    const id = crypto.randomUUID();
    fresh.set(id, Date.now());
    const b = await body(req);
    if (b.title) writeTitle(id, b.title);
    return info(id);
  }
  if (m === "GET" && p === "/session/status") return Object.fromEntries([...runs.keys()].map((id) => [id, { type: "busy" }]));
  if (m === "GET" && p === "/permission") return [...pending.values()].map((x) => x.perm);
  if (m === "POST" && (g = p.match(/^\/permission\/([\w-]+)\/reply$/))) return reply(g[1], (await body(req)).reply);
  if (m === "GET" && p === "/find/file") return findFiles(q.query, Number(q.limit) || 20);
  if (m === "GET" && (p === "/command" || p === "/agent")) return [];
  if (m === "GET" && p === "/config") return model ? { model: `anthropic/${model}` } : {};
  if (m === "GET" && p === "/config/providers") return { providers: [{ id: "anthropic", models: model ? { [model]: { limit: { context: /\[1m\]/.test(model) ? 1000000 : 200000 } } } : {} }] };
  if (!(g = p.match(/^\/session\/([0-9a-f-]{36})(\/[a-z_]+)?$/))) return { status: 404, message: "not found" };
  const [, id, sub = ""] = g;
  if (m === "GET" && !sub) return info(id) || { status: 404, message: "no such session" };
  if (m === "PATCH" && !sub) {
    writeTitle(id, String((await body(req)).title || "").slice(0, 200));
    const i = info(id);
    if (i) emit("session.updated", { info: i });
    return i;
  }
  if (m === "DELETE" && !sub) {
    if (runs.has(id)) return { status: 409, message: "stop the session first" };
    fs.rmSync(transcript(id), { force: true });
    fresh.delete(id);
    return true;
  }
  if (m === "GET" && sub === "/message") return messages(id);
  if (m === "GET" && sub === "/diff") return [];
  if (m === "POST" && sub === "/prompt_async") {
    const b = await body(req);
    run(id, b.parts || [], { yolo: b.yolo === true, modelID: (b.model && b.model.modelID) || "" });
    return null;
  }
  if (m === "POST" && sub === "/command") {
    const b = await body(req);
    run(id, [{ type: "text", text: `/${b.command} ${b.arguments || ""}`.trim() }], { yolo: b.yolo === true });
    return null;
  }
  if (m === "POST" && sub === "/summarize") {
    run(id, [{ type: "text", text: "/compact" }], { visible: false });
    return true;
  }
  if (m === "POST" && sub === "/abort") {
    const r = runs.get(id);
    if (r) ((r.aborted = true), r.child.kill("SIGINT"), setTimeout(() => runs.get(id) === r && r.child.kill("SIGKILL"), 3000));
    return true;
  }
  if (m === "POST" && sub === "/fork") return fork(id);
  if (sub === "/share") return NOT_HERE("Sharing a session");
  if (sub === "/revert" || sub === "/unrevert") return NOT_HERE("Undo and redo");
  return { status: 404, message: "not found" };
}

function writeTitle(id, title) {
  const t = readTitles();
  t[id] = title;
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(TITLES, JSON.stringify(t), { mode: 0o600 });
}

/// A copy of the transcript under a new id: Claude Code resumes it as its own session.
function fork(id) {
  const src = transcript(id);
  if (!fs.existsSync(src)) return { status: 404, message: "nothing to fork yet" };
  const nid = crypto.randomUUID();
  const out = fs.readFileSync(src, "utf8").split("\n").map((l) => {
    if (!l) return l;
    try {
      const o = JSON.parse(l);
      if (o.sessionId) o.sessionId = nid;
      return JSON.stringify(o);
    } catch {
      return l;
    }
  });
  fs.writeFileSync(transcript(nid), out.join("\n"));
  const base = info(id);
  writeTitle(nid, `${base ? base.title : "Session"} (fork)`);
  return info(nid);
}

function authorized(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const want = Buffer.from(`opencode:${PASSWORD}`);
  const got = Buffer.from(Buffer.from(h.slice(6), "base64").toString());
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "POST" && url.pathname === "/internal/perm") {
    const tok = Buffer.from(String(req.headers["x-eco-perm"] || ""));
    const want = Buffer.from(PERM_TOKEN);
    if (tok.length !== want.length || !crypto.timingSafeEqual(tok, want)) return json(res, 401, { message: "unauthorized" });
    return json(res, 200, await askPermission(await body(req)));
  }
  if (!authorized(req)) return json(res, 401, { message: "unauthorized" });
  if (req.method === "GET" && url.pathname === "/event") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => (clearInterval(ping), clients.delete(res)));
    return;
  }
  try {
    const out = await route(req, res, url);
    if (out && typeof out === "object" && out.status >= 400) return json(res, out.status, { message: out.message });
    if (out === null) return (res.writeHead(204), res.end());
    json(res, 200, out);
  } catch (e) {
    json(res, e.status || 500, { message: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => console.log(`claude server listening on http://127.0.0.1:${server.address().port} (${DIR})`));
  process.on("SIGTERM", () => {
    for (const r of runs.values()) r.child.kill("SIGINT");
    process.exit(0);
  });
}

module.exports = { absorb, toolInput, toolName, patchText, contentBlocks, userWords };
