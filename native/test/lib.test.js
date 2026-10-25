"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eah-"));
process.env.ECOSPHERE_ASSISTANT_HOME = path.join(tmp, "home");
process.env.HOME = tmp;
const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
process.env.PATH = bin + path.delimiter + "/usr/bin:/bin";
const calls = path.join(tmp, "calls.log");
fs.writeFileSync(
  path.join(bin, "eco"),
  `#!/bin/sh\necho "$PWD|$*" >> ${calls}\ncase "$1 $2" in\n  "whoami --json") echo '{"signedIn":true,"email":"t@example.com"}';;\n  "pm status") echo '{"linked":true,"qaWaiting":1}';;\n  *) echo ok;;\nesac\n`,
  { mode: 0o755 },
);

const lib = require("../lib");
const estate = path.join(tmp, "code", "shop");
fs.mkdirSync(estate, { recursive: true });
fs.writeFileSync(
  path.join(estate, "ecompose.yml"),
  `project: shop\nestates:\n  shop:\n    hostname: shop.example.com\n  additional:\n    - hostname: www.shop.example.com\nservices:\n  gateway:\n    lxs: gateway@3.1.0\n  auth:\n    lxs: auth@4.4.0 # pinned\n`,
);
fs.writeFileSync(path.join(estate, "eco.lock"), `version: 1\nlxs:\n  gateway:\n    name: gateway\n    status: verified\n  auth:\n    name: auth\n    status: unsigned\n`);
fs.writeFileSync(path.join(estate, "ecosystem.config.js"), `module.exports={apps:[\n {\n name: 'shop-auth', env: { SERVER_PORT: 4612 } },\n {\n name: 'shop-gateway', env: { SERVER_PORT: 20033 } }]}`);

const call = (action, args = {}, id = 1) => lib.handle({ id, action, args }, () => {});

test("rejects unknown actions, including prototype keys", async () => {
  for (const a of ["rm", "eval", "__proto__", "constructor", "toString", ""]) {
    const r = await call(a);
    assert.equal(r.ok, false, a);
    assert.equal(r.error, "unknown action");
  }
});

test("rejects folders that are not approved projects", async () => {
  const r = await call("eco.status", { dir: estate });
  assert.equal(r.ok, false);
  assert.match(r.error, /not an approved project/);
  assert.equal((await call("eco.status", { dir: "relative/dir" })).ok, false);
  assert.equal((await call("eco.status", { dir: "/etc" })).ok, false);
});

test("approve + info parse the manifest, lock and dev ports", async () => {
  assert.equal((await call("estate.approve", { dir: "/etc" })).ok, false);
  const r = await call("estate.approve", { dir: estate });
  assert.equal(r.ok, true);
  assert.equal(r.data.project, "shop");
  assert.deepEqual(r.data.hostnames, ["shop.example.com", "www.shop.example.com"]);
  assert.equal(r.data.hosting, "deploy");
  assert.deepEqual(r.data.lxs, [
    { name: "gateway", version: "3.1.0", signed: true },
    { name: "auth", version: "4.4.0", signed: false },
  ]);
  assert.deepEqual(r.data.devPorts, [20033, 4612]);
});

test("LXS names with shell metacharacters or option look-alikes never reach eco", async () => {
  const before = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "";
  for (const name of ["a;rm -rf ~", "$(id)", "x`id`", "a b", "--help", "-x", "a|b", "a&b", "a\nb", "../x", "A"]) {
    const r = await call("eco.lxs.add", { dir: estate, name });
    assert.equal(r.ok, false, name);
    assert.equal(r.rejected, true, name);
  }
  assert.equal((fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : ""), before);
  const ok = await call("eco.lxs.add", { dir: estate, name: "payment@2.4.0" });
  assert.equal(ok.ok, true);
  assert.match(fs.readFileSync(calls, "utf8"), /\|lxs add payment@2\.4\.0\n/);
});

test("free text is validated and passed as argv, never via a shell", async () => {
  for (const label of ["--done", " -x", "", "a".repeat(201)]) {
    assert.equal((await call("eco.pm.qa.step", { dir: estate, n: 3, label })).ok, false, label);
  }
  assert.equal((await call("eco.pm.qa.step", { dir: estate, n: "3;id", label: "x" })).ok, false);
  const evil = "Reproduce $(touch /tmp/pwned) ; `id` | cat";
  const r = await call("eco.pm.qa.step", { dir: estate, n: 3, label: evil, done: true });
  assert.equal(r.ok, true);
  assert.ok(fs.readFileSync(calls, "utf8").includes(`pm qa step 3 ${evil} --done`));
  assert.equal(fs.existsSync("/tmp/pwned"), false);
});

test("links and results are shaped, not concatenated from user input", async () => {
  assert.equal((await call("eco.pm.report", { dir: estate, headline: "h", links: [{ label: "a=b", url: "https://x.test" }] })).ok, false);
  assert.equal((await call("eco.pm.report", { dir: estate, headline: "h", links: [{ label: "a", url: "javascript:alert(1)" }] })).ok, false);
  assert.equal((await call("eco.pm.report", { dir: estate, headline: "h", results: [{ title: "a: b", detail: "c" }] })).ok, false);
  const ok = await call("eco.pm.report", { dir: estate, headline: "Three things", results: [{ title: "Wallet", detail: "in dock" }], links: [{ label: "site", url: "https://x.test/a" }] });
  assert.equal(ok.ok, true);
  assert.match(fs.readFileSync(calls, "utf8"), /pm report --headline Three things --result Wallet: in dock --link site=https:\/\/x\.test\/a/);
});

test("whoami resolves eco from PATH and returns JSON without secrets", async () => {
  const r = await call("eco.whoami");
  assert.equal(r.ok, true);
  assert.equal(r.data.email, "t@example.com");
  assert.ok(!JSON.stringify(r).includes("api_key"));
  assert.equal(await lib.resolveBin("eco"), path.join(bin, "eco"));
});

test("binary resolution: config wins, then PATH, then well-known dirs (Linux ~/.local/bin)", async () => {
  const alt = path.join(tmp, "alt-eco");
  fs.copyFileSync(path.join(bin, "eco"), alt);
  fs.chmodSync(alt, 0o755);
  lib.saveConfig({ ...lib.loadConfig(), eco: alt });
  assert.equal(await lib.resolveBin("eco"), alt);
  lib.saveConfig({ ...lib.loadConfig(), eco: undefined });
  const local = path.join(tmp, ".local", "bin");
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, "opencode"), "#!/bin/sh\necho 1.0.0\n", { mode: 0o755 });
  assert.equal(await lib.resolveBin("opencode"), path.join(local, "opencode"));
  assert.equal(await lib.resolveBin("definitely-not-installed-xyz"), null);
});

test("hello reports versions and never throws without eco/opencode", async () => {
  const r = await call("hello");
  assert.equal(r.ok, true);
  assert.equal(r.data.helper, lib.VERSION);
  assert.ok(["darwin", "linux"].includes(r.data.os));
});

test("pm.status maps a CLI failure to {linked:false}", async () => {
  fs.writeFileSync(path.join(bin, "eco"), `#!/bin/sh\necho "not linked yet" >&2\nexit 1\n`, { mode: 0o755 });
  const r = await call("eco.pm.status", { dir: estate });
  assert.equal(r.ok, true);
  assert.equal(r.data.linked, false);
});

test("scan finds estates a few levels deep and skips node_modules", () => {
  const nm = path.join(tmp, "code", "node_modules", "x");
  fs.mkdirSync(nm, { recursive: true });
  fs.writeFileSync(path.join(nm, "ecompose.yml"), "project: no\n");
  const found = lib.scanEstates([path.join(tmp, "code")]);
  assert.deepEqual(found, [estate]);
});

test("workspace rules: AGENTS.md of parent folders above the git root are handed to OpenCode", () => {
  fs.writeFileSync(path.join(tmp, "AGENTS.md"), "# home rules\n");
  const ws = path.join(tmp, "work");
  const repo = path.join(ws, "estates", "shop");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repo, "frontend"), { recursive: true });
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# repo rules (OpenCode finds this itself)\n");
  fs.mkdirSync(path.join(ws, ".agents"));
  fs.writeFileSync(path.join(ws, ".agents", "AGENTS.md"), "# workspace rules\n");
  fs.symlinkSync(path.join(ws, ".agents", "AGENTS.md"), path.join(ws, "AGENTS.md"));
  // from the repo root and from a subfolder: the repo's own file is excluded, parents are included outermost-first
  for (const start of [repo, path.join(repo, "frontend")]) {
    assert.deepEqual(lib.workspaceRules(start), [path.join(tmp, "AGENTS.md"), path.join(ws, "AGENTS.md")]);
  }
});

test("workspace.set: the work folder must be the project or a folder above it, below $HOME", async () => {
  await call("estate.approve", { dir: estate });
  const info = await call("estate.info", { dir: estate });
  assert.equal(info.data.root, "");
  assert.deepEqual(info.data.ancestors.map((a) => a.dir), [path.join(tmp, "code")]);
  for (const bad of [tmp, "/", os.tmpdir(), "relative/path", path.join(tmp, "missing")]) {
    const r = await call("workspace.set", { dir: estate, root: bad });
    assert.equal(r.ok, false, bad);
  }
  const ok = await call("workspace.set", { dir: estate, root: path.join(tmp, "code") });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.root, path.join(tmp, "code"));
});

test("fs.dirs lists sub-folders inside $HOME only", async () => {
  const r = await call("fs.dirs", { dir: tmp });
  assert.equal(r.ok, true);
  assert.equal(r.data.selectable, false);
  assert.ok(r.data.dirs.some((d) => d.name === "code"));
  assert.equal((await call("fs.dirs", { dir: "/etc" })).ok, false);
  assert.equal((await call("fs.dirs", { dir: path.join(tmp, "..") })).ok, false);
});
