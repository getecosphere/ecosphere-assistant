// Loads the unpacked extension in Chromium next to a test page, with a test native-messaging host
// that runs the REAL helper against a FAKE `eco` and a FAKE `opencode` (never the real account).
import { test as base, chromium, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXT = path.resolve(here, "..");
const HOST = "com.ecosphere.assistant";

export function extensionId() {
  const key = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")).key;
  const hex = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Library · Remote Worker</title>
<style>body{font:16px system-ui;margin:0}header{padding:18px 32px;border-bottom:1px solid #eee;font-weight:700}main{padding:30px 32px}
.card{display:inline-flex;flex-direction:column;gap:10px;width:220px;border:1px solid #eee;border-radius:12px;padding:14px;margin:0 12px 12px 0}
.img{height:96px;border-radius:8px;background:#f1eef4}.card-cta{align-self:flex-start;height:30px;padding:0 14px;border:0;border-radius:8px;background:#f1eef4;font-weight:600}</style></head>
<body><header>Remote Worker</header><main><div style="color:#8d8493;font:12px monospace">/library</div><h1 style="margin:4px 0">Library</h1>
<p>Ebook dan catatan kursus untuk member.</p>
<div class="card"><div class="img"></div><button class="card-cta" type="button">Baca</button></div>
<div class="card"><div class="img"></div><button class="card-cta" type="button">Baca</button></div></main>
<script>window.__clicks=0;document.addEventListener("click",()=>window.__clicks++);window.boom=()=>{console.error("Failed to load analytics.js");setTimeout(()=>{throw new Error("cover 97 not found")},10)}</script></body></html>`;

function serve(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE);
    });
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

const freePort = () =>
  new Promise((resolve) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

export const test = base.extend({
  env: async ({}, use) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "eah-e2e-"));
    const home = path.join(root, "home");
    const bin = path.join(root, "bin");
    const ah = path.join(root, "assistant-home");
    const profile = path.join(root, "profile");
    // Test copy of the extension: <all_urls> is optional in the real manifest (asked at first screenshot)
    // and a headless run cannot click the browser's permission prompt, so it is pre-granted here only.
    const extDir = path.join(root, "extension");
    fs.cpSync(EXT, extDir, { recursive: true, filter: (src) => !/\/(e2e|\.git|node_modules|docs|store)(\/|$)/.test(src.slice(EXT.length)) });
    const mf = JSON.parse(fs.readFileSync(path.join(extDir, "manifest.json"), "utf8"));
    mf.host_permissions.push("<all_urls>");
    fs.writeFileSync(path.join(extDir, "manifest.json"), JSON.stringify(mf));
    for (const d of [home, bin, ah, path.join(profile, "NativeMessagingHosts")]) fs.mkdirSync(d, { recursive: true });
    for (const f of ["eco", "opencode", "oc-server.js"]) fs.symlinkSync(path.join(here, "fakes", f), path.join(bin, f));

    const pagePort = await freePort();
    const srv = await serve(pagePort);
    const estateDir = path.join(home, "code", "shop");
    fs.mkdirSync(estateDir, { recursive: true });
    fs.writeFileSync(path.join(estateDir, "ecompose.yml"), `project: shop\nestates:\n  shop:\n    hostname: shop.example.com\nservices:\n  gateway:\n    lxs: gateway@3.1.0\n  auth:\n    lxs: auth@4.4.0\n`);
    fs.writeFileSync(path.join(estateDir, "eco.lock"), `version: 1\nlxs:\n  gateway:\n    name: gateway\n    status: verified\n  auth:\n    name: auth\n    status: verified\n`);
    fs.writeFileSync(path.join(estateDir, "ecosystem.config.js"), `module.exports={apps:[{\n name: 'shop-gateway', env: { SERVER_PORT: ${pagePort} } }]}`);
    fs.mkdirSync(path.join(estateDir, "web", "src", "pages"), { recursive: true });

    const statePath = path.join(root, "state.json");
    const ecoLog = path.join(root, "eco.log");
    const ocLog = path.join(root, "oc.log");
    fs.writeFileSync(ecoLog, "");
    fs.writeFileSync(ocLog, "");
    const state = {
      who: { signedIn: true, email: "tester@example.com", apiUrl: "http://fake", tier: "platform" },
      loginUrl: "http://127.0.0.1:1/device/abc123",
      plan: { label: "Platform", granted: "platform" },
      status: { project: "shop", deployed: true, live: "835706f4f90d", head: "ed67029727f6", upToDate: false, ahead: 2, liveDirty: false },
      pm: { linked: false },
      qa: [],
    };
    fs.writeFileSync(statePath, JSON.stringify(state));

    const wrapper = path.join(root, "host-wrapper.sh");
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh\nexport PATH="${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin"\nexport HOME="${home}"\nexport SHELL=/bin/sh\nexport ECOSPHERE_ASSISTANT_HOME="${ah}"\nexport FAKE_STATE="${statePath}" FAKE_ECO_LOG="${ecoLog}" FAKE_OC_LOG="${ocLog}"\nunset ECO_API_KEY ECO_API_URL OPENCODE_SERVER_PASSWORD\nexec "${process.execPath}" "${path.join(EXT, "native", "host.js")}"\n`,
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(profile, "NativeMessagingHosts", `${HOST}.json`),
      JSON.stringify({ name: HOST, description: "test host", path: wrapper, type: "stdio", allowed_origins: [`chrome-extension://${extensionId()}/`] }),
    );
    // Hard guard: the helper must resolve the FAKE binaries, never a real account.
    fs.writeFileSync(path.join(ah, "config.json"), JSON.stringify({ eco: path.join(bin, "eco"), opencode: path.join(bin, "opencode"), shellPath: "" }));

    const e = {
      root, home, bin, ah, profile, extDir, pagePort, estateDir, statePath, ecoLog, ocLog, srv,
      setState(fn) {
        const s = JSON.parse(fs.readFileSync(statePath, "utf8"));
        fn(s);
        fs.writeFileSync(statePath, JSON.stringify(s));
      },
      approve() {
        const cfg = JSON.parse(fs.readFileSync(path.join(ah, "config.json"), "utf8"));
        cfg.estates = [estateDir];
        fs.writeFileSync(path.join(ah, "config.json"), JSON.stringify(cfg));
      },
      ecoCalls: () => fs.readFileSync(ecoLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
      ocReqs: () => fs.readFileSync(ocLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
      prefs: (p) => p,
    };
    await use(e);
    try {
      const servers = JSON.parse(fs.readFileSync(path.join(ah, "servers.json"), "utf8"));
      for (const s of Object.values(servers)) try { process.kill(s.pid, "SIGKILL"); } catch {}
    } catch {}
    srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  },

  ctx: async ({ env }, use) => {
    const ctx = await chromium.launchPersistentContext(env.profile, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${env.extDir}`, `--load-extension=${env.extDir}`],
    });
    await use(ctx);
    await ctx.close();
  },

  // The side-panel page opened as a tab, with the test page brought to the front: the panel then
  // sees the test page as the active tab, exactly like a docked side panel next to it.
  app: async ({ ctx, env }, use) => {
    const id = extensionId();
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${env.pagePort}/library`);
    const panel = await ctx.newPage();
    await panel.setViewportSize({ width: 400, height: 860 });
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await page.bringToFront();
    await use({ page, panel, id });
  },
});

export { expect };
