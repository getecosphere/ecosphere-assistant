import { test, expect } from "../fixtures.js";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

async function intoApp(app, env) {
  env.approve();
  await app.panel.reload();
  await app.panel.locator('[data-act="use-cli"]').click();
  await expect(app.panel.locator('[data-tab="agent"]')).toBeVisible();
}

test("manifest keeps permissions narrow: no <all_urls>, no content script, no old hosts", async () => {
  const m = JSON.parse(fs.readFileSync(path.resolve("..", "manifest.json"), "utf8"));
  expect(m.content_scripts).toBeUndefined();
  expect(m.permissions.sort()).toEqual(["activeTab", "nativeMessaging", "scripting", "sidePanel", "storage", "tabs"]);
  expect(m.host_permissions.sort()).toEqual(["http://127.0.0.1/*", "http://localhost/*", "https://getecosphere.com/*"]);
  expect(m.optional_host_permissions).toEqual(["<all_urls>"]); // asked at first screenshot, never at install
  expect(JSON.stringify({ ...m, optional_host_permissions: [] })).not.toMatch(/project\.getecosphere|jogjaitcamp|downloads|<all_urls>/);
});

test("header, tabs (QA/Project hidden until /project is on), project switcher and LED", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await expect(panel.locator('[data-tab="agent"]')).toHaveAttribute("aria-selected", "true");
  await expect(panel.locator('[data-tab="compose"]')).toBeVisible();
  await expect(panel.locator('[data-tab="qa"]')).toHaveCount(0);
  await expect(panel.locator('[data-tab="project"]')).toHaveCount(0);
  await expect(panel.locator(".ph .led")).toHaveCount(1);
  await expect(panel.locator('[data-status]')).toHaveText("ready");
  await panel.locator('[data-act="project-menu"]').click();
  await expect(panel.locator('[data-project="shop"]')).toBeVisible();
  await panel.keyboard.press("Escape");
  await expect(panel.locator('[data-menu="project"]')).toHaveCount(0);
});

test("project auto-switch follows the active tab (localhost:<dev port>)", async ({ app, env }) => {
  await intoApp(app, env);
  // a second approved estate; the tab on shop's dev port must pick shop
  const other = path.join(env.home, "code", "other");
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, "ecompose.yml"), "project: other\nservices:\n  gateway:\n    lxs: gateway@3.1.0\n");
  await app.panel.evaluate(async (dir) => { const m = await import("./js/bridge.js"); await m.request("estate.approve", { dir }); const a = await import("./js/app.js"); await a.refreshEstates(); await a.selectProject(dir); }, other);
  await expect(app.panel.locator(".projbtn")).toContainText("other");
  await app.page.bringToFront();
  await app.page.reload();
  await expect(app.panel.locator(".projbtn")).toContainText("shop");
});

test("dock menu explains Chrome owns the side and opens Appearance settings", async ({ app, env, ctx }) => {
  await intoApp(app, env);
  const { panel } = app;
  await panel.locator('[data-act="account-menu"]').click();
  await expect(panel.locator('[data-menu="account"]')).toContainText("Chrome keeps the panel side");
  const opened = ctx.waitForEvent("page");
  await panel.locator('[data-dock="left"]').click();
  const p = await opened;
  await expect.poll(() => p.url()).toMatch(/chrome:\/\/settings\/appearance|chrome-error|about:blank/);
  const prefs = await panel.evaluate(() => chrome.storage.local.get("prefs"));
  expect(prefs.prefs.dock).toBe("left");
});

test("theme toggle and sign out (eco logout) return to onboarding", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await panel.locator('[data-act="account-menu"]').click();
  await panel.locator('[data-act="theme"]').click();
  await expect(panel.locator("html")).toHaveAttribute("data-theme", "light");
  await panel.locator('[data-act="signout"]').click();
  await expect(panel.locator('[data-step="login"]')).toHaveClass(/cur/);
  await expect.poll(() => env.ecoCalls().some((c) => c.args[0] === "logout")).toBe(true);
});

test("compose: LXS list from ecompose.yml + eco.lock, add and remove go through eco", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await panel.locator('[data-tab="compose"]').click();
  await expect(panel.locator('[data-lxs="gateway"]')).toContainText("3.1.0");
  await expect(panel.locator('[data-lxs="gateway"]')).toContainText("signed");
  await panel.locator('[data-field="lxs"]').fill("payment@2.4.0");
  await panel.locator('[data-field="lxs"]').press("Enter");
  await expect(panel.locator('[data-lxs="payment"]')).toBeVisible();
  expect(env.ecoCalls().some((c) => c.args.join(" ") === "lxs add payment@2.4.0" && c.cwd.endsWith("shop"))).toBe(true);
  await panel.locator('[data-lxs="payment"] .rm').click();
  await expect(panel.locator('[data-lxs="payment"]')).toHaveCount(0);
  await panel.locator('[data-act="up-dev"]').click();
  await expect(panel.locator('[data-log="compose"]')).toContainText("6/6 services online");
  await expect(panel.locator('[data-act="up-dev"]')).toBeEnabled();
});

test("keyboard-only: tabs and the composer are reachable", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await panel.locator('[data-tab="agent"]').focus();
  await panel.keyboard.press("Tab");
  await panel.keyboard.press("Enter");
  await expect(panel.locator('[data-tab="compose"]')).toHaveAttribute("aria-selected", "true");
  await panel.locator('[data-tab="agent"]').focus();
  await panel.keyboard.press("Enter");
  await panel.locator("textarea").focus();
  await expect(panel.locator("textarea")).toBeFocused();
});

for (const scheme of ["light", "dark"]) {
  test(`a11y (axe, ${scheme}): onboarding and app have no violations`, async ({ app, env }) => {
    await app.panel.emulateMedia({ colorScheme: scheme });
    let r = await new AxeBuilder({ page: app.panel }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
    await intoApp(app, env);
    await app.panel.emulateMedia({ colorScheme: scheme });
    r = await new AxeBuilder({ page: app.panel }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });
}

test("workspace rules above the project repo are listed in the menu (they are passed to OpenCode)", async ({ app, env }) => {
  const fs2 = await import("node:fs");
  fs2.writeFileSync(path.join(env.home, "AGENTS.md"), "# workspace rules\n");
  await intoApp(app, env);
  await app.panel.locator('[data-act="account-menu"]').click();
  await expect(app.panel.locator('[data-act="rules"]')).toContainText("1 · ");
  await expect(app.panel.locator('[data-act="rules"]')).toHaveAttribute("title", path.join(env.home, "AGENTS.md"));
});
