"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// Runs install.sh as if on Linux (a `uname` shim) and as macOS, in a throwaway HOME.
function install(osName) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "inst-"));
  const shim = path.join(home, "shim");
  fs.mkdirSync(shim);
  fs.writeFileSync(path.join(shim, "uname"), `#!/bin/sh\necho ${osName}\n`, { mode: 0o755 });
  const cfg = osName === "Linux" ? path.join(home, ".config", "google-chrome") : path.join(home, "Library", "Application Support", "Google", "Chrome");
  fs.mkdirSync(cfg, { recursive: true });
  const env = { PATH: `${shim}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: home };
  execFileSync("/bin/bash", [path.join(__dirname, "..", "install.sh")], { env, stdio: "pipe" });
  return { home, manifest: path.join(cfg, "NativeMessagingHosts", "com.ecosphere.assistant.json") };
}

for (const osName of ["Linux", "Darwin"]) {
  test(`installer registers the host on ${osName}`, () => {
    const { home, manifest } = install(osName);
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    assert.equal(m.name, "com.ecosphere.assistant");
    assert.equal(m.path, path.join(home, ".ecosphere-assistant", "host"));
    assert.match(m.allowed_origins[0], /^chrome-extension:\/\/[a-p]{32}\/$/);
    assert.ok(fs.existsSync(path.join(home, ".ecosphere-assistant", "lib.js")));
  });
}
