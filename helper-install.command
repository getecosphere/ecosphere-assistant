#!/bin/bash
# Ecosphere Assistant — one-time helper installer (self-contained).
# Installs the native messaging host that lets the extension start the local
# OpenCode server and deploy estates from your machine.
set -euo pipefail

INSTALL_DIR="$HOME/.ecosphere-assistant"
mkdir -p "$INSTALL_DIR"

cat > "$INSTALL_DIR/host.js" << 'HOST_EOF'
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

const ESTATE_ROOTS = [
  path.join(os.homedir(), "ar-rahman", "estates"),
  path.join(os.homedir(), "ar-rahman"),
  path.join(os.homedir(), "SuperApp"),
];

function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function deriveEstateName(ecomposeText) {
  const m = String(ecomposeText).match(/^project:\s*(.+)$/m);
  return m ? m[1].trim() : "";
}

function findEstateByHostname(hostname) {
  const needle = `hostname: ${hostname}`;
  const matches = [];
  const visited = new Set();
  function scan(dir) {
    if (visited.has(dir)) return;
    visited.add(dir);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const p = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      // ecompose.yml directly here?
      const direct = path.join(p, "ecompose.yml");
      if (fs.existsSync(direct)) {
        try {
          const text = fs.readFileSync(direct, "utf8");
          if (text.includes(needle)) {
            matches.push({ estate: deriveEstateName(text) || entry.name, directory: p });
          }
        } catch {}
        continue;
      }
      // nested layout: <project>/<project>/ecompose.yml
      try {
        for (const sub of fs.readdirSync(p, { withFileTypes: true })) {
          if (!sub.isDirectory() || sub.name.startsWith(".")) continue;
          const sp = path.join(p, sub.name);
          const nested = path.join(sp, "ecompose.yml");
          if (fs.existsSync(nested)) {
            const text = fs.readFileSync(nested, "utf8");
            if (text.includes(needle)) {
              matches.push({ estate: deriveEstateName(text) || sub.name, directory: sp });
            }
          }
        }
      } catch {}
    }
  }
  for (const root of ESTATE_ROOTS) scan(root);
  const seen = new Set();
  return matches.filter((m) => (seen.has(m.directory) ? false : (seen.add(m.directory), true)));
}

async function handleFindEstate(hostname) {
  const matches = findEstateByHostname(hostname || "");
  return { type: "find-estate", hostname, found: matches.length > 0, matches };
}

function handleDeploy(directory) {
  return new Promise((resolve) => {
    send({ type: "deploy-start" });
    const cmd = `source ~/.zshrc >/dev/null 2>&1; cd ${shellQuote(directory)} && eco up --remote`;
    const child = spawn("zsh", ["-lc", cmd], { stdio: ["ignore", "pipe", "pipe"] });
    const onData = (d) => {
      for (const line of String(d).split("\n")) {
        const l = line.trim();
        if (l) send({ type: "deploy-log", line: l });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => resolve({ type: "deploy-done", ok: code === 0, code }));
  });
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
    case "find-estate":
      track(handleFindEstate(msg.hostname));
      break;
    case "deploy":
      track(handleDeploy(msg.directory));
      break;
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
HOST_EOF
chmod +x "$INSTALL_DIR/host.js"

# Resolve a node runtime (the host is a Node script; GUI-launched processes
# have a limited PATH).
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  for c in "$HOME/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node /opt/homebrew/bin/bun; do
    if [ -x "$c" ]; then NODE_BIN="$c"; break; fi
  done
fi
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: Node.js not found. Install it from https://nodejs.org (or: brew install node), then rerun."
  read -r -n 1 -s -p "Press any key to close..."
  exit 1
fi

# Resolve opencode (optional now; the extension installs it later).
OPENCODE_BIN="$(command -v opencode 2>/dev/null || true)"
if [ -z "$OPENCODE_BIN" ]; then
  for c in "$HOME/.opencode/bin/opencode" /opt/homebrew/bin/opencode /usr/local/bin/opencode; do
    if [ -x "$c" ]; then OPENCODE_BIN="$c"; break; fi
  done
fi

# The extension ID. Unpacked dev builds carry a "key" (auto-computed); store
# builds get a Google-assigned ID, so ask for the one shown in the sidebar
# (Step 1) or in chrome://extensions.
EXT_ID="$(find "$HOME" -maxdepth 3 -name manifest.json -path '*ecosphere*' 2>/dev/null | head -1 | xargs -I{} node -e 'try{const fs=require("fs"),c=require("crypto");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(m.key){const p=Buffer.from(m.key,"base64");process.stdout.write(c.createHash("sha256").update(p).digest().slice(0,16).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""));}}catch(e){}' {} 2>/dev/null || true)"
if [ -z "$EXT_ID" ]; then
  echo ""
  echo "Paste your extension ID (shown in the sidebar's Step 1, or in chrome://extensions):"
  read -r -p "Extension ID: " EXT_ID || true
  EXT_ID="$(echo "$EXT_ID" | tr -d '[:space:]')"
  if [ -z "$EXT_ID" ]; then
    echo "No ID provided. Aborting."
    read -r -n 1 -s -p "Press any key to close..."
    exit 1
  fi
fi

# Launcher with the absolute node path.
cat > "$INSTALL_DIR/host" << EOF
#!$NODE_BIN
require("$INSTALL_DIR/host.js");
EOF
chmod +x "$INSTALL_DIR/host"

# Config.
cat > "$INSTALL_DIR/config.json" << EOF
{
  "opencode": "${OPENCODE_BIN:-opencode}",
  "defaultPort": 4096
}
EOF

HOST_NAME="com.opencode.sidebar"
mkdir -p "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" \
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts"

cat > "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "Ecosphere Assistant native host — starts the local OpenCode server and deploys estates",
  "path": "$INSTALL_DIR/host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

for dir in "Google/Chrome Canary" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Arc/User Data"; do
  cp "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json" \
    "$HOME/Library/Application Support/$dir/NativeMessagingHosts/$HOST_NAME.json" 2>/dev/null || true
done

echo ""
echo "Done! The Ecosphere Assistant helper is installed."
echo "Go back to the sidebar and click 'Check again'."
echo ""
read -r -n 1 -s -p "Press any key to close..."
