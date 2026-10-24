"use strict";
// Ecosphere Assistant helper — the only bridge between the side panel and this machine.
// Everything is a fixed action with validated arguments; there is no free-form shell.
// The panel never sees an API key: account actions are `eco` commands that use the CLI's own login.

const { spawn, execFile } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const VERSION = "2.0.0";
const HOME_DIR = process.env.ECOSPHERE_ASSISTANT_HOME || path.join(os.homedir(), ".ecosphere-assistant");
const CONFIG_PATH = path.join(HOME_DIR, "config.json");
const SERVERS_PATH = path.join(HOME_DIR, "servers.json");

// ── config ────────────────────────────────────────────────────────────────

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: mode || 0o644 });
  fs.renameSync(tmp, file);
}

const loadConfig = () => readJson(CONFIG_PATH, {});
const saveConfig = (c) => writeJson(CONFIG_PATH, c);

// ── validation ────────────────────────────────────────────────────────────

const RE = {
  lxs: /^[a-z0-9][a-z0-9._-]*(@[A-Za-z0-9._-]+)?$/,
  tag: /^[a-z][a-z0-9_-]{0,23}$/,
  severity: /^p[0-2]$/,
};

class Reject extends Error {}

function bad(msg) {
  throw new Reject(msg);
}

const isAbs = (p) => typeof p === "string" && path.isAbsolute(p) && !p.includes("\0");

/// `text` values are passed as argv (never through a shell), but a leading dash would be
/// read as an option by the CLI, so it is refused.
function text(v, name, max = 4000) {
  if (typeof v !== "string" || !v.trim()) bad(`${name} is required`);
  if (v.length > max || v.includes("\0")) bad(`${name} is invalid`);
  if (v.trim().startsWith("-")) bad(`${name} must not start with "-"`);
  return v.trim();
}

function integer(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 1e9) bad(`${name} must be a positive integer`);
  return n;
}

function match(v, re, name) {
  if (typeof v !== "string" || !re.test(v)) bad(`${name} is invalid`);
  return v;
}

function listOf(v, name, each, max = 20) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) bad(`${name} is invalid`);
  return v.map(each);
}

// ── estates (folders with an ecompose.yml) ────────────────────────────────

function parseManifest(dir) {
  let src = "";
  try {
    src = fs.readFileSync(path.join(dir, "ecompose.yml"), "utf8");
  } catch {
    return null;
  }
  const lines = src.split("\n").map((l) => l.replace(/\s+#.*$/, ""));
  const project = ((lines.find((l) => /^project:\s*\S/.test(l)) || "").split(":")[1] || "").trim().replace(/^["']|["']$/g, "");
  const hostnames = [...new Set(lines.map((l) => (l.match(/^\s*(?:-\s*)?hostname:\s*["']?([A-Za-z0-9.-]+)["']?\s*$/) || [])[1]).filter(Boolean))];
  const lxs = [];
  for (const l of lines) {
    const m = l.match(/^\s+lxs:\s*["']?([a-z0-9][a-z0-9._-]*)@([A-Za-z0-9._-]+)["']?\s*$/);
    if (m) lxs.push({ name: m[1], version: m[2] });
  }
  let serveSub = "";
  const si = lines.findIndex((l) => /^serve:\s*$/.test(l));
  if (si >= 0) serveSub = (lines.slice(si + 1, si + 6).map((l) => (l.match(/^\s+subdomain:\s*["']?([a-z0-9-]+)/) || [])[1]).find(Boolean)) || "";
  let services = 0;
  const sv = lines.findIndex((l) => /^services:\s*$/.test(l));
  if (sv >= 0) {
    for (const l of lines.slice(sv + 1)) {
      if (/^\S/.test(l)) break;
      if (/^  [A-Za-z0-9_-]+:\s*$/.test(l)) services++;
    }
  }
  return { project: project || path.basename(dir), hostnames, lxs, serveSub, services };
}

function lockStatus(dir) {
  const out = {};
  let cur = null;
  try {
    for (const l of fs.readFileSync(path.join(dir, "eco.lock"), "utf8").split("\n")) {
      const k = l.match(/^  ([a-z0-9][a-z0-9._-]*):\s*$/);
      if (k) cur = k[1];
      const s = l.match(/^    status:\s*(\S+)/);
      if (s && cur) out[cur] = s[1];
    }
  } catch {
    /* no lock yet */
  }
  return out;
}

function devPorts(dir) {
  const ports = [];
  try {
    const src = fs.readFileSync(path.join(dir, "ecosystem.config.js"), "utf8");
    // the gateway first: that is the origin the browser opens
    const blocks = src.split(/\n\s*\{\s*\n/).filter((b) => /SERVER_PORT\s*:\s*\d+/.test(b));
    blocks.sort((a, b) => Number(/name:\s*["'][^"']*gateway/.test(b)) < Number(/name:\s*["'][^"']*gateway/.test(a)) ? -1 : 1);
    for (const b of blocks) ports.push(Number(b.match(/SERVER_PORT\s*:\s*(\d+)/)[1]));
  } catch {
    /* not running dev yet */
  }
  return [...new Set(ports)];
}

function estateInfo(dir) {
  const m = parseManifest(dir);
  if (!m) return null;
  const lock = lockStatus(dir);
  return {
    dir,
    project: m.project,
    hostnames: m.hostnames,
    hosting: m.hostnames.length ? "deploy" : "serve",
    serve: m.serveSub,
    services: m.services,
    rules: workspaceRules(dir),
    devPorts: devPorts(dir),
    lxs: m.lxs.map((x) => ({ ...x, signed: lock[x.name] === "verified" })),
  };
}

const SCAN_SKIP = new Set(["node_modules", ".git", "target", "dist", "build", ".cache", "Library", "Applications", "Pictures", "Movies", "Music"]);

function scanEstates(roots, depth = 3) {
  const found = [];
  const seen = new Set();
  const walk = (dir, d) => {
    if (seen.has(dir) || found.length > 200) return;
    seen.add(dir);
    if (fs.existsSync(path.join(dir, "ecompose.yml"))) {
      found.push(dir);
      return;
    }
    if (d === 0) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && !SCAN_SKIP.has(e.name)) walk(path.join(dir, e.name), d - 1);
    }
  };
  for (const r of roots) if (fs.existsSync(r)) walk(r, depth);
  return found;
}

const defaultRoots = () => {
  const h = os.homedir();
  return [path.join(h, "ar-rahman", "estates"), path.join(h, "code"), path.join(h, "dev"), path.join(h, "projects"), path.join(h, "src"), path.join(h, "Documents"), h];
};

function approved() {
  return loadConfig().estates || [];
}

/// A directory the panel may act on: it has to be an approved estate.
function estateDir(v) {
  if (!isAbs(v)) bad("dir must be an absolute path");
  const dir = path.resolve(v);
  if (!approved().includes(dir)) bad("this folder is not an approved project");
  if (!fs.existsSync(path.join(dir, "ecompose.yml"))) bad("no ecompose.yml in this folder");
  return dir;
}

// ── binaries ──────────────────────────────────────────────────────────────

const isExec = (p) => {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

function onPath(name, searchPath) {
  for (const d of String(searchPath || "").split(path.delimiter)) {
    if (d && isExec(path.join(d, name))) return path.join(d, name);
  }
  return null;
}

function wellKnown(name) {
  const h = os.homedir();
  return [path.join(h, ".local", "bin"), path.join(h, ".opencode", "bin"), path.join(h, ".cargo", "bin"), path.join(h, "node", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map((d) => path.join(d, name)).find(isExec) || null;
}

/// The login shell's PATH, probed once and cached in config.json (Chrome starts the helper
/// with a minimal PATH). Markers drop any noise a shell rc prints.
function probeShellPath() {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || "/bin/sh";
    execFile(shell, ["-lc", 'printf "__P__%s__P__" "$PATH"'], { timeout: 5000 }, (err, out) => {
      const m = !err && String(out).match(/__P__(.*)__P__/s);
      resolve(m ? m[1] : "");
    });
  });
}

let pathCache = null;
async function searchPath() {
  if (pathCache) return pathCache;
  const cfg = loadConfig();
  if (!cfg.shellPath) {
    cfg.shellPath = await probeShellPath();
    saveConfig(cfg);
  }
  pathCache = [process.env.PATH, cfg.shellPath].filter(Boolean).join(path.delimiter);
  return pathCache;
}

async function resolveBin(name) {
  const cfg = loadConfig();
  if (cfg[name] && isExec(cfg[name])) return cfg[name];
  const direct = onPath(name, process.env.PATH) || wellKnown(name);
  if (direct) return direct;
  return onPath(name, await searchPath());
}

async function childEnv() {
  return { ...process.env, PATH: await searchPath(), NO_COLOR: "1", FORCE_COLOR: "0" };
}

// ── running commands ──────────────────────────────────────────────────────

const jobs = new Map(); // request id -> child (streamed actions can be cancelled)

function runCmd(bin, args, opts = {}) {
  return new Promise(async (resolve) => {
    const env = await childEnv();
    let child;
    try {
      child = spawn(bin, args, { cwd: opts.cwd, env: { ...env, ...(opts.env || {}) }, stdio: ["ignore", "pipe", "pipe"], detached: false });
    } catch (e) {
      return resolve({ code: -1, stdout: "", stderr: String(e.message || e) });
    }
    if (opts.id != null) jobs.set(opts.id, child);
    let stdout = "";
    let stderr = "";
    let buf = "";
    const feed = (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\s+$/, "");
        buf = buf.slice(i + 1);
        if (line.trim() && opts.onLine) opts.onLine(line);
      }
    };
    child.stdout.on("data", (d) => ((stdout += d), feed(String(d))));
    child.stderr.on("data", (d) => ((stderr += d), feed(String(d))));
    const timer = opts.timeout ? setTimeout(() => child.kill("SIGTERM"), opts.timeout) : null;
    child.on("error", (e) => resolve({ code: -1, stdout, stderr: stderr + String(e.message || e) }));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (opts.id != null) jobs.delete(opts.id);
      if (buf.trim() && opts.onLine) opts.onLine(buf.trim());
      resolve({ code, stdout, stderr });
    });
  });
}

function cancel(id) {
  const c = jobs.get(id);
  if (!c) return false;
  c.kill("SIGTERM");
  return true;
}

async function eco(args, opts) {
  const bin = await resolveBin("eco");
  if (!bin) throw new Reject("eco is not installed (https://getecosphere.com/install)");
  return runCmd(bin, args, opts);
}

function parseJsonOut(r, what) {
  try {
    return JSON.parse(r.stdout.trim().split("\n").filter(Boolean).pop() || "");
  } catch {
    throw new Reject((r.stderr || r.stdout || `${what} failed`).trim().slice(0, 400));
  }
}

const firstLine = (r) => (r.stderr || r.stdout || "").trim().split("\n").filter(Boolean).pop() || "failed";

// ── OpenCode: one local server per project, loopback only, per-launch password ──

function health(port, password, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const headers = password ? { Authorization: "Basic " + Buffer.from(`opencode:${password}`).toString("base64") } : {};
    const req = http.get({ host: "127.0.0.1", port, path: "/global/health", headers, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => (req.destroy(), resolve(false)));
    req.on("error", () => resolve(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = require("net").createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/// OpenCode reads AGENTS.md from the working folder up to the git root only. A workspace that keeps
/// its rules in a parent folder (e.g. ~/ar-rahman/AGENTS.md above many estate repos) would never be
/// read, so those parent files are handed to the server as extra `instructions` (up to $HOME).
function workspaceRules(dir) {
  const home = os.homedir();
  let root = dir;
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) {
      root = d;
      break;
    }
    if (path.dirname(d) === d) break;
  }
  const found = [];
  const seen = new Set();
  for (let d = path.dirname(root); d.startsWith(home) && found.length < 4; d = path.dirname(d)) {
    const f = path.join(d, "AGENTS.md");
    try {
      const real = fs.realpathSync(f);
      if (!seen.has(real)) found.unshift(f), seen.add(real);
    } catch {
      /* none here */
    }
    if (d === home) break;
  }
  return found;
}

const sh = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

/// On macOS the server must NOT be a child of Chrome: files a Chrome child creates get
/// com.apple.quarantine, and OpenCode (a Bun binary) unpacks a native .dylib into $TMPDIR at start,
/// which Gatekeeper then refuses ("... .dylib Not Opened"). A launchd job has no such parent. The
/// per-launch password goes into an owner-only script, never into argv (ps shows argv to every user).
async function spawnServer(bin, dir, port, password) {
  const tmp = path.join(HOME_DIR, "tmp");
  fs.mkdirSync(tmp, { recursive: true, mode: 0o700 });
  const logFile = path.join(HOME_DIR, "opencode-server.log");
  const env = await childEnv();
  const rules = workspaceRules(dir);
  const cfg = rules.length ? JSON.stringify({ instructions: rules }) : "";
  if (process.platform === "darwin") {
    const label = `com.ecosphere.assistant.opencode.${port}`;
    const script = path.join(HOME_DIR, `run-${port}.sh`);
    fs.writeFileSync(
      script,
      `#!/bin/sh\ncd ${sh(dir)} || exit 1\nexport OPENCODE_SERVER_PASSWORD=${sh(password)} OPENCODE_SERVER_USERNAME=opencode TMPDIR=${sh(tmp)} PATH=${sh(env.PATH)} HOME=${sh(os.homedir())}${cfg ? ` OPENCODE_CONFIG_CONTENT=${sh(cfg)}` : ""}\nexec ${sh(bin)} serve --hostname 127.0.0.1 --port ${port}\n`,
      { mode: 0o700 },
    );
    const r = await runCmd("launchctl", ["submit", "-l", label, "-o", logFile, "-e", logFile, "--", "/bin/sh", script]);
    if (r.code !== 0) throw new Reject(`could not start OpenCode: ${firstLine(r)}`);
    return { pid: 0, label, script };
  }
  const log = fs.openSync(logFile, "a");
  const child = spawn(bin, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: dir, env: { ...env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: "opencode", TMPDIR: tmp, ...(cfg ? { OPENCODE_CONFIG_CONTENT: cfg } : {}) }, detached: true, stdio: ["ignore", log, log] });
  child.unref();
  return { pid: child.pid };
}

async function launchdPid(label) {
  const r = await runCmd("launchctl", ["list", label], { timeout: 5000 });
  const m = r.stdout.match(/"PID"\s*=\s*(\d+)/);
  return m ? Number(m[1]) : 0;
}

const starting = new Map();
function ocStart(dir) {
  if (!starting.has(dir)) starting.set(dir, ocStartOnce(dir).finally(() => starting.delete(dir)));
  return starting.get(dir);
}

async function ocStartOnce(dir) {
  const servers = readJson(SERVERS_PATH, {});
  const cur = servers[dir];
  if (cur && (await health(cur.port, cur.password))) return { port: cur.port, password: cur.password, reused: true };
  const bin = await resolveBin("opencode");
  if (!bin) throw new Reject("opencode is not installed");
  const port = await freePort();
  const password = crypto.randomBytes(18).toString("base64url");
  fs.mkdirSync(HOME_DIR, { recursive: true });
  const log = fs.openSync(path.join(HOME_DIR, "opencode-server.log"), "a");
  const started = await spawnServer(bin, dir, port, password);
  servers[dir] = { pid: started.pid, port, password, label: started.label, script: started.script };
  writeJson(SERVERS_PATH, servers, 0o600);
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await health(port, password, 1200)) {
      if (started.label) {
        servers[dir].pid = await launchdPid(started.label);
        writeJson(SERVERS_PATH, servers, 0o600);
      }
      return { port, password, reused: false };
    }
  }
  throw new Reject("OpenCode did not become healthy");
}

async function ocStop(dir) {
  const servers = readJson(SERVERS_PATH, {});
  const cur = servers[dir];
  if (cur && cur.label) {
    await runCmd("launchctl", ["remove", cur.label], { timeout: 5000 });
    if (cur.script) fs.rmSync(cur.script, { force: true });
  } else if (cur && cur.pid > 1) {
    try {
      process.kill(cur.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  delete servers[dir];
  writeJson(SERVERS_PATH, servers, 0o600);
}

async function ocInstall(emit) {
  const script = path.join(os.tmpdir(), `opencode-install-${process.pid}.sh`);
  const dl = await runCmd("curl", ["-fsSL", "https://opencode.ai/install", "-o", script], { onLine: emit });
  if (dl.code !== 0) throw new Reject("could not download the OpenCode installer");
  await runCmd("bash", [script], { onLine: emit });
  try {
    fs.unlinkSync(script);
  } catch {
    /* gone */
  }
  pathCache = null;
  const bin = await resolveBin("opencode");
  if (!bin) throw new Reject("the installer finished but opencode was not found");
  const cfg = loadConfig();
  cfg.opencode = bin;
  saveConfig(cfg);
  return { path: bin };
}

async function version(bin, args = ["--version"]) {
  if (!bin) return null;
  const r = await runCmd(bin, args, { timeout: 5000 });
  return r.code === 0 ? r.stdout.trim().split("\n")[0] : null;
}

// ── the allowlist ─────────────────────────────────────────────────────────
// Each action: validate(args) -> clean args (throws Reject), run(clean, ctx) -> data.
// ctx = { id, emit(event) } where emit streams {event, ...} frames for the same request id.

const ACTIONS = {
  async hello() {
    const [ecoBin, ocBin] = await Promise.all([resolveBin("eco"), resolveBin("opencode")]);
    return {
      helper: VERSION,
      os: process.platform,
      arch: process.arch,
      eco: ecoBin ? { path: ecoBin, version: await version(ecoBin, ["--version"]) } : null,
      opencode: ocBin ? { path: ocBin, version: await version(ocBin) } : null,
      estates: approved().length,
    };
  },

  async "eco.whoami"() {
    const r = await eco(["whoami", "--json"], { timeout: 15000 });
    return parseJsonOut(r, "eco whoami");
  },

  async "eco.login"(_a, ctx) {
    let sent = false;
    const r = await eco(["login"], {
      id: ctx.id,
      timeout: 330000,
      onLine: (line) => {
        const url = line.match(/https?:\/\/\S+/);
        if (url && !sent) {
          sent = true;
          ctx.emit({ event: "url", url: url[0] });
        }
        ctx.emit({ event: "log", line });
      },
    });
    if (r.code !== 0) throw new Reject(firstLine(r));
    return { ok: true };
  },

  async "eco.logout"() {
    const r = await eco(["logout"], { timeout: 15000 });
    if (r.code !== 0) throw new Reject(firstLine(r));
    return { ok: true };
  },

  async "eco.plan"() {
    const r = await eco(["plan", "--json"], { timeout: 20000 });
    return parseJsonOut(r, "eco plan");
  },

  async "eco.status"(a) {
    const r = await eco(["status", "--json"], { cwd: estateDir(a.dir), timeout: 30000 });
    return parseJsonOut(r, "eco status");
  },

  async "eco.deploy"(a, ctx) {
    const r = await eco(["deploy"], { cwd: estateDir(a.dir), id: ctx.id, onLine: (line) => ctx.emit({ event: "log", line }) });
    if (r.code !== 0) throw new Reject(`deploy failed (exit ${r.code})`);
    return { ok: true };
  },

  async "eco.up.dev"(a, ctx) {
    // `eco up dev` stays attached streaming logs; the panel stops listening once the estate is online.
    const r = await eco(["up", "dev"], { cwd: estateDir(a.dir), id: ctx.id, timeout: 600000, onLine: (line) => ctx.emit({ event: "log", line }) });
    return { ok: r.code === 0, code: r.code };
  },

  async "eco.lxs.add"(a) {
    const r = await eco(["lxs", "add", match(a.name, RE.lxs, "name")], { cwd: estateDir(a.dir), timeout: 180000 });
    if (r.code !== 0) throw new Reject(firstLine(r));
    return { ok: true, output: r.stdout.trim().slice(-800) };
  },

  async "eco.lxs.remove"(a) {
    const r = await eco(["lxs", "remove", match(a.name, RE.lxs, "name")], { cwd: estateDir(a.dir), timeout: 60000 });
    if (r.code !== 0) throw new Reject(firstLine(r));
    return { ok: true };
  },

  async "eco.pm.status"(a) {
    const r = await eco(["pm", "status", "--json"], { cwd: estateDir(a.dir), timeout: 20000 });
    if (r.code !== 0) return { linked: false, reason: firstLine(r) };
    return parseJsonOut(r, "eco pm status");
  },

  async "eco.pm.link"(a) {
    const r = await eco(["pm", "link"], { cwd: estateDir(a.dir), timeout: 60000 });
    if (r.code !== 0) throw new Reject(firstLine(r));
    return { ok: true, output: r.stdout.trim() };
  },

  async "eco.pm.qa"(a) {
    const r = await eco(["pm", "qa", "--json"], { cwd: estateDir(a.dir), timeout: 20000 });
    if (r.code !== 0) throw new Reject(firstLine(r));
    return { items: parseJsonOut(r, "eco pm qa") };
  },

  async "eco.pm.qa.take"(a) {
    const dir = estateDir(a.dir);
    const r = await eco(["pm", "qa", "take", String(integer(a.n, "n"))], { cwd: dir, timeout: 60000 });
    if (r.code !== 0) throw new Reject(firstLine(r));
    return { markdown: r.stdout, shots: qaShotNames(dir, a.n) };
  },

  async "qa.shot"(a) {
    return qaShot(estateDir(a.dir), a.n, a.name);
  },

  async "eco.pm.qa.new"(a) {
    const dir = estateDir(a.dir);
    const args = ["pm", "qa", "new", "--title", text(a.title, "title", 200), "--severity", match(a.severity, RE.severity, "severity")];
    if (a.url) {
      if (!/^https?:\/\/[^\s]+$/.test(String(a.url)) || String(a.url).length > 500) bad("url is invalid");
      args.push("--url", a.url);
    }
    for (const [flag, v] of [["--ua", a.ua], ["--os", a.os], ["--viewport", a.viewport]]) if (v) args.push(flag, text(String(v), flag, 300));
    if (a.box) {
      const b = [a.box.x, a.box.y, a.box.w, a.box.h].map((n) => Math.round(Number(n)));
      if (b.some((n) => !Number.isFinite(n) || n < 0 || n > 100000)) bad("box is invalid");
      args.push("--box", b.join(","));
    }
    let tmp = "";
    if (a.shot) {
      const m = String(a.shot).match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
      if (!m || m[1].length > 12 * 1024 * 1024) bad("screenshot is invalid");
      fs.mkdirSync(path.join(HOME_DIR, "tmp"), { recursive: true });
      tmp = path.join(HOME_DIR, "tmp", `qa-${crypto.randomBytes(6).toString("hex")}.png`);
      fs.writeFileSync(tmp, Buffer.from(m[1], "base64"), { mode: 0o600 });
      args.push("--shot", tmp);
    }
    try {
      const r = await eco(args, { cwd: dir, timeout: 90000 });
      if (r.code !== 0) throw new Reject(firstLine(r));
      return { ok: true, output: r.stdout.trim() };
    } finally {
      if (tmp) fs.rmSync(tmp, { force: true });
    }
  },

  async "eco.pm.qa.step"(a) {
    const args = ["pm", "qa", "step", String(integer(a.n, "n")), text(a.label, "label", 200)];
    if (a.done) args.push("--done");
    const r = await eco(args, { cwd: estateDir(a.dir), timeout: 20000 });
    if (r.code !== 0) throw new Reject(firstLine(r));
    return { ok: true };
  },

  async "eco.pm.log"(a) {
    const args = ["pm", "log", match(a.tag, RE.tag, "tag"), text(a.text, "text", 400)];
    if (a.qa != null) args.push("--qa", String(integer(a.qa, "qa")));
    const r = await eco(args, { cwd: estateDir(a.dir), timeout: 20000 });
    if (r.code !== 0) throw new Reject(firstLine(r));
    return { ok: true };
  },

  async "eco.pm.qa.done"(a) {
    const args = ["pm", "qa", "done", String(integer(a.n, "n")), "--summary", text(a.summary, "summary")];
    for (const l of listOf(a.links, "links", linkArg)) args.push("--link", l);
    const r = await eco(args, { cwd: estateDir(a.dir), timeout: 60000 });
    if (r.code !== 0) throw new Reject(firstLine(r));
    return { ok: true };
  },

  async "eco.pm.report"(a) {
    const args = ["pm", "report", "--headline", text(a.headline, "headline", 200)];
    for (const x of listOf(a.results, "results", resultArg)) args.push("--result", x);
    for (const l of listOf(a.links, "links", linkArg)) args.push("--link", l);
    const r = await eco(args, { cwd: estateDir(a.dir), timeout: 60000 });
    if (r.code !== 0) throw new Reject(firstLine(r));
    return { ok: true };
  },

  async "lxs.catalog"() {
    // Read-only listing of the registry mirrors `eco` keeps under ~/.eco/registries/<owner>/<repo>/<lxs>/<version>.
    const root = path.join(os.homedir(), ".eco", "registries");
    const semver = (v) => v.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : 0));
    const cmp = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
    const out = new Map();
    const dirs = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name); } catch { return []; } };
    for (const owner of dirs(root)) for (const repo of dirs(path.join(root, owner))) for (const name of dirs(path.join(root, owner, repo))) {
      if (!RE.lxs.test(name)) continue;
      const latest = dirs(path.join(root, owner, repo, name)).sort(cmp).pop();
      if (latest) out.set(name, { name, version: latest, registry: `${owner}/${repo}` });
    }
    return { lxs: [...out.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  },

  async "estate.scan"() {
    const cfg = loadConfig();
    const dirs = scanEstates([...(cfg.roots || []), ...defaultRoots()]);
    return { estates: dirs.map(estateInfo).filter(Boolean) };
  },

  async "estate.approve"(a) {
    if (!isAbs(a.dir)) bad("dir must be an absolute path");
    const dir = path.resolve(a.dir);
    if (!fs.existsSync(path.join(dir, "ecompose.yml"))) bad("no ecompose.yml in this folder");
    const cfg = loadConfig();
    cfg.estates = [...new Set([...(cfg.estates || []), dir])];
    saveConfig(cfg);
    return estateInfo(dir);
  },

  async "estate.forget"(a) {
    const dir = estateDir(a.dir);
    const cfg = loadConfig();
    cfg.estates = (cfg.estates || []).filter((d) => d !== dir);
    saveConfig(cfg);
    return { ok: true };
  },

  async "estate.list"() {
    return { estates: approved().map(estateInfo).filter(Boolean) };
  },

  async "estate.info"(a) {
    return estateInfo(estateDir(a.dir));
  },

  async "oc.start"(a) {
    return ocStart(estateDir(a.dir));
  },

  async "oc.stop"(a) {
    await ocStop(estateDir(a.dir));
    return { ok: true };
  },

  async "oc.install"(_a, ctx) {
    return ocInstall((line) => ctx.emit({ event: "log", line }));
  },
};

function linkArg(l) {
  if (!l || typeof l !== "object") bad("link is invalid");
  const label = text(l.label, "link label", 80);
  if (label.includes("=")) bad("link label is invalid");
  if (!/^https?:\/\/[^\s]+$/.test(String(l.url || ""))) bad("link url is invalid");
  return `${label}=${l.url}`;
}

function resultArg(r) {
  if (!r || typeof r !== "object") bad("result is invalid");
  const title = text(r.title, "result title", 120);
  if (title.includes(":")) bad("result title must not contain ':'");
  return `${title}: ${text(r.detail || "-", "result detail", 400)}`;
}

const SHOT_RE = /^[\w.-]+\.(png|jpe?g|webp)$/i;
const MAX_SHOT = 700 * 1024; // native messaging caps a host reply at 1 MB, base64 adds a third

function qaShotNames(dir, n) {
  try {
    return fs.readdirSync(path.join(dir, ".eco", "qa", String(n))).filter((f) => SHOT_RE.test(f)).slice(0, 8);
  } catch {
    return [];
  }
}

function qaShot(dir, n, name) {
  if (!SHOT_RE.test(String(name))) bad("name is invalid");
  const file = path.join(dir, ".eco", "qa", String(integer(n, "n")), name);
  const size = fs.statSync(file).size;
  if (size > MAX_SHOT) return { name, tooLarge: true };
  const ext = path.extname(name).slice(1).toLowerCase().replace("jpg", "jpeg");
  return { name, mime: `image/${ext}`, data: fs.readFileSync(file).toString("base64") };
}

/// Dispatch one request frame. Streams via emit(), returns the final frame.
async function handle(msg, emit) {
  const id = msg && msg.id;
  try {
    if (!msg || typeof msg !== "object") bad("invalid request");
    if (msg.action === "cancel") return { id, ok: cancel(msg.target) };
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, msg.action) ? ACTIONS[msg.action] : null;
    if (!fn) bad("unknown action");
    const data = await fn(msg.args || {}, { id, emit: (e) => emit({ id, ...e }) });
    return { id, ok: true, data };
  } catch (e) {
    return { id, ok: false, error: String((e && e.message) || e), rejected: e instanceof Reject };
  }
}

module.exports = { workspaceRules, handle, ACTIONS, parseManifest, estateInfo, scanEstates, resolveBin, text, integer, match, Reject, RE, HOME_DIR, VERSION, loadConfig, saveConfig };
