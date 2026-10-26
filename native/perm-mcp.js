"use strict";
// The `eco` MCP server Claude Code asks before a tool runs (--permission-prompt-tool mcp__eco__approve).
// stdio JSON-RPC, one tool `approve({ tool_name, input, tool_use_id })`. The question goes to claude-server.js, which
// shows it in the side panel; the answer goes back as text JSON: {"behavior":"allow","updatedInput":…} or {"behavior":"deny",…}.
// Env (from the run's mcp config, mode 0600): ECO_PERM_URL, ECO_PERM_TOKEN, ECO_SESSION.

const http = require("http");
const { ECO_PERM_URL = "", ECO_PERM_TOKEN = "", ECO_SESSION = "" } = process.env;
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");

function decide(args) {
  return new Promise((resolve) => {
    const deny = (message) => resolve({ behavior: "deny", message });
    const body = JSON.stringify({ session: ECO_SESSION, tool_name: args.tool_name, input: args.input || {}, tool_use_id: args.tool_use_id });
    const req = http.request(ECO_PERM_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-Eco-Perm": ECO_PERM_TOKEN } }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        try {
          if (res.statusCode === 200) return resolve(JSON.parse(b));
        } catch {
          /* fall through */
        }
        deny(`The side panel answered ${res.statusCode}.`);
      });
    });
    req.on("error", () => deny("The side panel is not reachable, so nobody could approve this."));
    req.end(body);
  });
}

let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: (m.params && m.params.protocolVersion) || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "eco", version: "1.0" } } });
    else if (m.method === "tools/list")
      send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "approve", description: "Asks the user in the Ecosphere side panel whether a tool may run.", inputSchema: { type: "object", properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } }, required: ["tool_name", "input"] } }] } });
    else if (m.method === "tools/call") decide((m.params && m.params.arguments) || {}).then((r) => send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: JSON.stringify(r) }] } }));
    else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result: {} });
  }
});
process.stdin.on("end", () => process.exit(0));
