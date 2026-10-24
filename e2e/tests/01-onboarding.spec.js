import { test, expect } from "../fixtures.js";
import fs from "node:fs";
import path from "node:path";

const step = (panel, id) => panel.locator(`[data-step="${id}"]`);

test("CLI already signed in → confirm, pick the project matching the tab, land in the app", async ({ app, env }) => {
  const { panel } = app;
  await expect(step(panel, "login")).toHaveClass(/cur/);
  await expect(panel.locator('[data-act="use-cli"]')).toContainText("tester@example.com");
  await panel.locator('[data-act="use-cli"]').click();
  await expect(step(panel, "login")).toHaveClass(/done/);
  await expect(step(panel, "helper")).toHaveClass(/done/);
  await expect(step(panel, "opencode")).toHaveClass(/done/);
  await expect(step(panel, "project")).toHaveClass(/cur/);
  const opt = panel.locator(`[data-dir="${env.estateDir}"]`);
  await expect(opt).toContainText("matches this tab");
  await expect(opt).toHaveAttribute("aria-checked", "true");
  await panel.locator('[data-act="approve"]').click();
  await expect(panel.locator('[data-tab="agent"]')).toBeVisible();
  await expect(panel.locator(".projbtn")).toContainText("shop");
  expect(env.ecoCalls().some((c) => c.args.join(" ") === "whoami --json")).toBe(true);
  // signed in = the CLI is signed in: no token anywhere in extension storage
  const store = await panel.evaluate(() => chrome.storage.local.get(null));
  expect(JSON.stringify(store)).not.toMatch(/token|apikey|api_key/i);
});

test("not signed in → Google device login shows the link and finishes when the CLI is signed in", async ({ app, env }) => {
  env.setState((s) => (s.who = { signedIn: false }));
  await app.panel.reload();
  const { panel } = app;
  await expect(panel.locator('[data-act="use-cli"]')).toHaveCount(0);
  await panel.locator('[data-act="google"]').click();
  await expect(panel.locator(`a[href="http://127.0.0.1:1/device/abc123"]`)).toHaveText("Open the sign-in page");
  await expect(panel.locator('[data-step="login"]')).not.toContainText("127.0.0.1");
  fs.writeFileSync(env.statePath + ".login", "1");
  await expect(step(panel, "login")).toHaveClass(/done/);
  expect(env.ecoCalls().some((c) => c.args[0] === "login")).toBe(true);
  expect(env.ecoCalls().some((c) => c.args[0] === "login" && c.args.length > 1)).toBe(false);
});

test("no helper → shows the one-line install and the extension id, then recovers", async ({ app, env }) => {
  const manifest = path.join(env.profile, "NativeMessagingHosts", "com.ecosphere.assistant.json");
  const saved = fs.readFileSync(manifest, "utf8");
  fs.rmSync(manifest);
  await app.panel.reload();
  const { panel } = app;
  await expect(step(panel, "helper")).toHaveClass(/cur/);
  await expect(panel.locator("[data-cmd]")).toContainText("helper-install.sh");
  await expect(step(panel, "helper")).toContainText(app.id);
  fs.writeFileSync(manifest, saved);
  await panel.locator('[data-act="recheck-helper"]').click();
  await expect(step(panel, "helper")).toHaveClass(/done/);
});

test("no OpenCode → offers the install step", async ({ app, env }) => {
  fs.rmSync(path.join(env.bin, "opencode"));
  const cfgFile = path.join(env.ah, "config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
  delete cfg.opencode;
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  await app.panel.reload();
  await app.panel.locator('[data-act="use-cli"]').click();
  await expect(step(app.panel, "opencode")).toHaveClass(/cur/);
  await expect(app.panel.locator('[data-act="install-oc"]')).toBeVisible();
});

test("no old iframes, no password form, no exposed port input", async ({ app }) => {
  const { panel } = app;
  await expect(panel.locator("iframe")).toHaveCount(0);
  await expect(panel.locator('input[type="password"]')).toHaveCount(0);
  await expect(panel.locator('input[type="number"]')).toHaveCount(0);
});
