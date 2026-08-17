#!/usr/bin/env node
"use strict";

const { spawn, execFile } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.json");
const LOG_PATH = path.join(__dirname, "opencode-server.log");
const PID_PATH = path.join(__dirname, "server.pid");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function send(msg) {
  const data = Buffer.from(JSON.stringify(msg), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(data.length, 0);
  process.stdout.write(header);
  process.stdout.write(data);
}

function checkHealth(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/global/health", timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findOpenCode() {
  const config = loadConfig();
  const home = os.homedir();
  const candidates = [
    config.opencode,
    path.join(home, ".opencode", "bin", "opencode"),
    "/opt/homebrew/bin/opencode",
    "/usr/local/bin/opencode",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      /* not here */
    }
  }
  return null;
}

function whichOpenCode() {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", "command -v opencode"]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => resolve(out.trim() || null));
  });
}

function getVersion(bin) {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 4000 }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim().split("\n")[0]);
    });
  });
}

function defaultDirectory() {
  const config = loadConfig();
  if (config.directory && fs.existsSync(config.directory)) return config.directory;
  return os.homedir();
}

function startServer(port, directory) {
  const config = loadConfig();
  const cmd = config.opencode || "opencode";
  const out = fs.openSync(LOG_PATH, "a");
  const cwd = directory || defaultDirectory();
  const child = spawn(cmd, ["serve", "--port", String(port)], {
    cwd,
    detached: true,
    stdio: ["ignore", out, out],
  });
  fs.writeFileSync(PID_PATH, String(child.pid));
  child.unref();
  return { pid: child.pid, cwd };
}

async function handleStart(port, directory) {
  if (await checkHealth(port)) {
    return { type: "start", ok: true, alreadyRunning: true, port };
  }
  if (directory && !fs.existsSync(directory)) {
    return { type: "start", ok: false, error: `directory not found: ${directory}` };
  }
  let spawned;
  try {
    spawned = startServer(port, directory);
  } catch (err) {
    return { type: "start", ok: false, error: String((err && err.message) || err) };
  }
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    if (await checkHealth(port)) {
      return { type: "start", ok: true, alreadyRunning: false, pid: spawned.pid, port, cwd: spawned.cwd };
    }
  }
  return { type: "start", ok: false, pid: spawned.pid, port, error: "server did not become healthy" };
}

async function handleStop() {
  try {
    const pid = parseInt(fs.readFileSync(PID_PATH, "utf8"), 10);
    if (Number.isFinite(pid) && pid > 1) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* no pid file */
  }
  return { type: "stop", ok: true };
}

function handleInstall() {
  return new Promise((resolve) => {
    send({ type: "install-start" });
    const script = path.join(os.tmpdir(), "opencode-install.sh");

    const onChunk = (d) => {
      for (const line of String(d).split("\n")) {
        const l = line.trim();
        if (l) send({ type: "install-log", line: l });
      }
    };

    const download = spawn("curl", ["-fsSL", "https://opencode.ai/install", "-o", script]);
    download.stderr.on("data", onChunk);
    download.on("close", (code) => {
      if (code !== 0) {
        resolve({ type: "install-done", ok: false, error: "failed to download the installer" });
        return;
      }
      const run = spawn("bash", [script]);
      run.stdout.on("data", onChunk);
      run.stderr.on("data", onChunk);
      run.on("close", async () => {
        const bin = findOpenCode() || (await whichOpenCode());
        if (bin) {
          const config = loadConfig();
          config.opencode = bin;
          saveConfig(config);
          resolve({
            type: "install-done",
            ok: true,
            path: bin,
            version: await getVersion(bin),
          });
        } else {
          resolve({
            type: "install-done",
            ok: false,
            error: "installer finished but opencode was not found",
          });
        }
      });
    });
  });
}

async function handleStatus() {
  let bin = findOpenCode();
  let version = null;
  if (!bin) bin = await whichOpenCode();
  if (bin) version = await getVersion(bin);
  return {
    type: "status",
    ok: true,
    opencodeInstalled: Boolean(bin),
    opencodePath: bin,
    opencodeVersion: version,
    defaultPort: loadConfig().defaultPort || 4096,
    defaultDirectory: defaultDirectory(),
  };
}

let buffer = Buffer.alloc(0);
let pending = 0;
let stdinClosed = false;

function maybeExit() {
  if (stdinClosed && pending === 0) process.exit(0);
}

function track(promise) {
  pending++;
  promise
    .then(send)
    .catch((err) => send({ ok: false, error: String((err && err.message) || err) }))
    .finally(() => {
      pending--;
      maybeExit();
    });
}

function handleChunk() {
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (buffer.length < 4 + len) break;
    const body = buffer.slice(4, 4 + len).toString("utf8");
    buffer = buffer.slice(4 + len);
    processMessage(body);
  }
}

function processMessage(body) {
  let msg;
  try {
    msg = JSON.parse(body);
  } catch {
    send({ ok: false, error: "invalid json" });
    return;
  }
  switch (msg.type) {
    case "status":
      track(handleStatus());
      break;
    case "install-opencode":
      track(handleInstall());
      break;
    case "start": {
      const port = Number(msg.port) || loadConfig().defaultPort || 4096;
      track(handleStart(port, msg.directory));
      break;
    }
    case "stop":
      track(handleStop());
      break;
    case "ping":
      send({ type: "ping", ok: true });
      break;
    default:
      send({ ok: false, error: "unknown type" });
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  handleChunk();
});

process.stdin.on("end", () => {
  stdinClosed = true;
  maybeExit();
});
