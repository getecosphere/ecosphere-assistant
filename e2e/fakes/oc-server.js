// Fake OpenCode server: the endpoints and event shapes the panel uses (see the real OpenAPI doc),
// replaying scripted event streams. Requests are logged to $FAKE_OC_LOG.
const http = require("http");
const fs = require("fs");

exports.start = (port) => {
  const password = process.env.OPENCODE_SERVER_PASSWORD || "";
  // launchd starts the server without the test env: the fixture puts oc.log next to its fake $HOME
  const logFile = process.env.FAKE_OC_LOG || require("path").join(process.env.HOME, "..", "oc.log");
  const log = (o) => fs.appendFileSync(logFile, JSON.stringify(o) + "\n");
  const sessions = new Map(); // id -> {id, messages: [{info, parts}]}
  const sse = new Set();
  const perms = new Map(); // id -> resolve
  let n = 0;
  let evt = 0;
  let aborted = false;
  const busy = new Set();

  const emit = (type, properties) => {
    const data = JSON.stringify({ id: `evt_${++evt}`, type, properties });
    for (const r of sse) r.write(`data: ${data}\n\n`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nid = (p) => `${p}_${String(++n).padStart(4, "0")}`;

  function addMessage(ses, role, extra = {}) {
    const info = { id: nid(role === "user" ? "msg_u" : "msg_a"), sessionID: ses.id, role, time: { created: Date.now() }, ...extra };
    const m = { info, parts: [] };
    ses.messages.push(m);
    emit("message.updated", { sessionID: ses.id, info });
    return m;
  }
  function addPart(ses, m, part) {
    const p = { id: nid("prt"), sessionID: ses.id, messageID: m.info.id, ...part };
    m.parts.push(p);
    emit("message.part.updated", { sessionID: ses.id, part: p, time: Date.now() });
    return p;
  }
  function setPart(ses, p, patch) {
    Object.assign(p, patch);
    emit("message.part.updated", { sessionID: ses.id, part: p, time: Date.now() });
  }
  async function say(ses, m, text) {
    const p = addPart(ses, m, { type: "text", text: "" });
    for (const chunk of text.match(/.{1,24}/gs)) {
      p.text += chunk;
      emit("message.part.delta", { sessionID: ses.id, messageID: m.info.id, partID: p.id, field: "text", delta: chunk });
      await sleep(15);
    }
    setPart(ses, p, { text, time: { start: 1, end: 2 } });
  }
  async function tool(ses, m, name, input, output, metadata) {
    const callID = nid("call");
    const p = addPart(ses, m, { type: "tool", tool: name, callID, state: { status: "running", input, time: { start: Date.now() } } });
    await sleep(60);
    setPart(ses, p, { state: { status: "completed", input, output: output || "", metadata: metadata || {}, time: { start: Date.now() - 400, end: Date.now() } } });
    return callID;
  }
  async function askPermission(ses, m, input, permission, pattern) {
    const callID = nid("call");
    const p = addPart(ses, m, { type: "tool", tool: "bash", callID, state: { status: "pending", input } });
    const id = nid("per");
    emit("permission.asked", { id, sessionID: ses.id, permission, patterns: [pattern], metadata: { description: "Restart the local estate so it can be tested in this tab." }, always: [pattern], tool: { messageID: m.info.id, callID } });
    const reply = await new Promise((r) => perms.set(id, r));
    emit("permission.replied", { sessionID: ses.id, requestID: id, reply });
    if (reply === "reject") return false;
    setPart(ses, p, { state: { status: "completed", input, output: "6/6 online", metadata: {}, time: { start: Date.now() - 900, end: Date.now() } } });
    return true;
  }

  const DIFF = "--- a/web/src/components/BookCard.tsx\n+++ b/web/src/components/BookCard.tsx\n@@ -42,3 +42,4 @@\n   <Card>\n-  <Button variant=\"soft\">Baca</Button>\n+  <Button variant=\"primary\">\n+    Baca sekarang</Button>\n   </Card>";

  async function run(ses, text, hasEl) {
    aborted = false;
    busy.add(ses.id);
    emit("session.status", { sessionID: ses.id, status: { type: "busy" } });
    const m = addMessage(ses, "assistant", { providerID: "anthropic", modelID: "claude-sonnet-5-5", tokens: { input: 5, output: 40, reasoning: 0, cache: { read: 52000, write: 0 } } });
    const stopped = () => aborted;
    try {
      if (/Draft an executive summary/.test(text)) {
        await say(ses, m, JSON.stringify({ headline: "Library cards now use the primary button", results: [{ title: "Primary card button", detail: "BookCard uses the brand variant." }, { title: "Console errors checked", detail: "Both errors come from a missing analytics script." }] }));
      } else if (/Work on QA/.test(text)) {
        await say(ses, m, "I picked up the report, read the screenshot, and will reproduce on the local estate.");
        await tool(ses, m, "read", { filePath: "/qa/screenshot" }, "ok");
        await tool(ses, m, "grep", { pattern: "library" }, "web/src/pages/library.tsx:12: export default function Library");
        await tool(ses, m, "edit", { filePath: "web/src/pages/library.tsx", oldString: "route('/library')", newString: "notFound()" }, "", { diff: DIFF });
        await tool(ses, m, "bash", { command: "cargo test" }, "12/12 ok");
        await say(ses, m, "/library is a 404 now and comments are escaped.");
      } else if (/permission/i.test(text)) {
        await tool(ses, m, "read", { filePath: "web/src/pages/library.tsx" }, "ok");
        await tool(ses, m, "edit", { filePath: "comments/src/render.rs", oldString: "html.push_str(&c.body);", newString: "html.push_str(&escape_html(&c.body));" }, "", {});
        if (!(await askPermission(ses, m, { command: "eco up dev" }, "bash", "eco up dev"))) await say(ses, m, "OK, I will not run it. Test manually with eco up dev.");
        else await say(ses, m, "The estate is back online.");
      } else if (/slow/i.test(text)) {
        await say(ses, m, "Working on it…");
        for (let i = 0; i < 200 && !stopped(); i++) await sleep(50);
      } else if (hasEl) {
        await tool(ses, m, "grep", { pattern: "card-cta" }, "web/src/components/BookCard.tsx:42:  <Button className=\"card-cta\">Baca</Button>");
        await tool(ses, m, "edit", { filePath: "web/src/components/BookCard.tsx", oldString: "variant=\"soft\"", newString: "variant=\"primary\"" }, "", { diff: DIFF });
        await say(ses, m, "The button is now primary.");
      } else {
        await tool(ses, m, "read", { filePath: "web/src/pages/library.tsx" }, "ok");
        await say(ses, m, "All covers load at once. I can add lazy loading.");
      }
    } finally {
      busy.delete(ses.id);
      if (stopped()) emit("session.error", { sessionID: ses.id, error: { name: "MessageAbortedError", data: { message: "aborted" } } });
      emit("session.status", { sessionID: ses.id, status: { type: "idle" } });
      emit("session.idle", { sessionID: ses.id });
    }
  }

  const body = (req) => new Promise((r) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => { try { r(s ? JSON.parse(s) : {}); } catch { r({}); } }); });
  const json = (res, code, v) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };

  http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Methods": "GET, HEAD, PUT, PATCH, POST, DELETE" }); return res.end(); }
    if (password && req.headers.authorization !== "Basic " + Buffer.from(`opencode:${password}`).toString("base64")) { res.writeHead(401); return res.end("unauthorized"); }
    const p = u.pathname;
    const b = req.method === "POST" || req.method === "PATCH" ? await body(req) : {};
    log({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body: b });
    if (p === "/global/health") return json(res, 200, { healthy: true, version: "1.18.35-fake" });
    if (p === "/event") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`data: ${JSON.stringify({ id: "evt_0", type: "server.connected", properties: {} })}\n\n`);
      sse.add(res);
      req.on("close", () => sse.delete(res));
      return;
    }
    const view = (x) => ({ id: x.id, title: x.title || "New session - fake", directory: u.searchParams.get("directory"), time: x.time, tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 1000, write: 0 } }, summary: { files: 0 }, ...(x.revert ? { revert: x.revert } : {}), ...(x.share ? { share: { url: x.share } } : {}) });
    if (p === "/session" && req.method === "POST") { const id = nid("ses"); const x = { id, messages: [], title: b.title, time: { created: Date.now(), updated: Date.now() } }; sessions.set(id, x); return json(res, 200, view(x)); }
    if (p === "/session" && req.method === "GET") { const q = (u.searchParams.get("search") || "").toLowerCase(); return json(res, 200, [...sessions.values()].filter((x) => !q || (x.title || "").toLowerCase().includes(q)).sort((a, b) => b.time.updated - a.time.updated).map(view)); }
    if (p === "/session/status") return json(res, 200, Object.fromEntries([...busy].map((id) => [id, { type: "busy" }])));
    let m = p.match(/^\/session\/([^/]+)(?:\/(\w+))?$/);
    if (m) {
      const ses = sessions.get(m[1]);
      if (!ses) return json(res, 404, { error: "no session" });
      if (!m[2] && req.method === "GET") return json(res, 200, view(ses));
      if (!m[2] && req.method === "PATCH") { ses.title = b.title; return json(res, 200, view(ses)); }
      if (m[2] === "fork") { const id = nid("ses"); const x = { id, messages: JSON.parse(JSON.stringify(ses.messages)), title: `${ses.title} (fork #1)`, time: { created: Date.now(), updated: Date.now() } }; sessions.set(id, x); return json(res, 200, view(x)); }
      if (m[2] === "share") { if (req.method === "POST") ses.share = `https://share.example/s/${ses.id}`; else delete ses.share; return json(res, 200, view(ses)); }
      if (m[2] === "summarize") { addMessage(ses, "assistant", { summary: true }); return json(res, 200, true); }
      if (m[2] === "revert") { ses.revert = { messageID: b.messageID }; return json(res, 200, view(ses)); }
      if (m[2] === "unrevert") { delete ses.revert; return json(res, 200, view(ses)); }
      if (!m[2] && req.method === "DELETE") { sessions.delete(m[1]); return json(res, 200, true); }
      if (m[2] === "message") return json(res, 200, ses.messages);
      if (m[2] === "prompt_async" || m[2] === "command") {
        const parts = b.parts || [{ type: "text", text: `/${b.command} ${b.arguments || ""}` }];
        if (!ses.title || /^New session/.test(ses.title)) ses.title = (b.parts ? b.parts[0].text : "").slice(0, 40) || "session";
        ses.time.updated = Date.now();
        const um = addMessage(ses, "user");
        for (const part of parts) addPart(ses, um, part.type === "file" ? { ...part } : part);
        const text = parts.filter((x) => x.type === "text").map((x) => x.text).join("\n");
        res.writeHead(204); res.end();
        run(ses, text, /Selected element/.test(text));
        return;
      }
      if (m[2] === "abort") { aborted = true; return json(res, 200, true); }
      if (m[2] === "diff") return json(res, 200, []);
    }
    m = p.match(/^\/permission\/([^/]+)\/reply$/);
    if (m) { const r = perms.get(m[1]); perms.delete(m[1]); if (r) r(b.reply); return json(res, 200, true); }
    if (p === "/permission") return json(res, 200, []);
    if (p === "/find/file") return json(res, 200, /librar/i.test(u.searchParams.get("query") || "") ? ["web/src/pages/library.tsx", "web/src/pages/library.test.tsx"] : []);
    if (p === "/command") return json(res, 200, [{ name: "init", description: "create AGENTS.md" }, { name: "review", description: "review changes" }]);
    if (p === "/agent") return json(res, 200, [{ name: "build" }, { name: "plan" }]);
    if (p === "/config") return json(res, 200, {});
    if (p === "/config/providers") return json(res, 200, { providers: [], default: {} });
    json(res, 404, { error: `fake: ${req.method} ${p}` });
  }).listen(port, "127.0.0.1");
};
