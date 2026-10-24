// OpenCode server API client (real endpoints of `opencode serve`, verified against its OpenAPI doc).
// Loopback only, HTTP Basic auth with the helper's per-launch password (kept in memory).
export class OpenCode {
  constructor({ port, password, dir }) {
    this.base = `http://127.0.0.1:${port}`;
    this.auth = "Basic " + btoa(`opencode:${password}`);
    this.dir = dir;
  }

  url(path, q = {}) {
    const u = new URL(this.base + path);
    u.searchParams.set("directory", this.dir);
    for (const [k, v] of Object.entries(q)) if (v != null) u.searchParams.set(k, v);
    return u.toString();
  }

  async call(method, path, body, q) {
    const res = await fetch(this.url(path, q), {
      method,
      headers: { Authorization: this.auth, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw Object.assign(new Error(`OpenCode ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
    const ct = res.headers.get("content-type") || "";
    return ct.includes("json") ? res.json() : null;
  }

  health() {
    return this.call("GET", "/global/health");
  }
  createSession(title) {
    return this.call("POST", "/session", title ? { title } : {});
  }
  listSessions() {
    return this.call("GET", "/session");
  }
  messages(id) {
    return this.call("GET", `/session/${id}/message`);
  }
  status() {
    return this.call("GET", "/session/status");
  }
  pending() {
    return this.call("GET", "/permission");
  }
  /// parts: [{type:"text",text,synthetic?}, {type:"file",mime,filename,url}]
  prompt(id, parts, { agent, model } = {}) {
    return this.call("POST", `/session/${id}/prompt_async`, { parts, ...(agent ? { agent } : {}), ...(model ? { model } : {}) });
  }
  command(id, command, args) {
    return this.call("POST", `/session/${id}/command`, { command, arguments: args || "" });
  }
  deleteSession(id) {
    return this.call("DELETE", `/session/${id}`);
  }
  abort(id) {
    return this.call("POST", `/session/${id}/abort`, {});
  }
  reply(requestId, reply) {
    return this.call("POST", `/permission/${requestId}/reply`, { reply });
  }
  diff(id) {
    return this.call("GET", `/session/${id}/diff`);
  }
  findFiles(query, limit = 20) {
    return this.call("GET", "/find/file", undefined, { query, limit: String(limit) });
  }
  commands() {
    return this.call("GET", "/command");
  }
  agents() {
    return this.call("GET", "/agent");
  }
  config() {
    return this.call("GET", "/config");
  }
  providers() {
    return this.call("GET", "/config/providers");
  }

  /// Server-sent events over fetch (EventSource cannot send the auth header).
  async events(onEvent, signal, onOpen) {
    const res = await fetch(this.url("/event"), { headers: { Authorization: this.auth, Accept: "text/event-stream" }, signal });
    if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
    if (onOpen) onOpen();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += value;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (!data) continue;
        try {
          onEvent(JSON.parse(data));
        } catch {
          /* keep-alive or partial */
        }
      }
    }
  }
}
