import path from "node:path";
import fs from "node:fs";
import { test, expect } from "../fixtures.js";

async function open(app, env, opts) {
  env.approve(opts);
  await app.panel.reload();
  await app.panel.locator('[data-act="use-cli"]').click();
  await expect(app.panel.locator("textarea")).toBeVisible();
  await app.page.bringToFront();
}

test("the panel asks where you work from; OpenCode starts only after, in that folder", async ({ app, env }) => {
  const parent = path.dirname(env.estateDir);
  fs.writeFileSync(path.join(parent, "AGENTS.md"), "# my rules\n");
  await open(app, env, { ask: true });
  const { panel } = app;
  const card = panel.locator('[data-card="root"]');
  await expect(card).toContainText("Where do you work from?");
  await expect(card.locator(`[data-root="${parent}"]`)).toContainText("AGENTS.md");
  await expect(card.locator(`[data-root="${env.estateDir}"]`)).toContainText("this project only");
  await expect(panel.locator('[data-act="root-use"]')).toBeDisabled();
  expect(fs.existsSync(path.join(env.ah, "servers.json"))).toBe(false);

  await card.locator(`[data-root="${parent}"]`).click();
  await panel.locator('[data-act="root-use"]').click();
  await expect(card).toHaveCount(0);
  await panel.locator("textarea").fill("hello from the root");
  await panel.locator("textarea").press("Enter");
  await expect(panel.locator('[data-kind="done"]')).toBeVisible();

  const prompt = env.ocReqs().find((r) => r.path.endsWith("/prompt_async"));
  expect(prompt.query.directory).toBe(parent);
  const ctx = prompt.body.parts.find((p) => p.synthetic);
  expect(ctx.text).toContain(`Workspace root (your working folder): ${parent}`);
  expect(ctx.text).toContain(`folder ${env.estateDir}`);

  await panel.locator('[data-act="account-menu"]').click();
  await expect(panel.locator('[data-act="root"]')).toContainText("code");
  await expect(panel.locator('[data-act="rules"]')).toContainText("AGENTS.md");
});

test("a chosen work folder is remembered; the menu can change it", async ({ app, env }) => {
  const parent = path.dirname(env.estateDir);
  await open(app, env, { ask: true });
  await app.panel.locator(`[data-root="${parent}"]`).click();
  await app.panel.locator('[data-act="root-use"]').click();
  await app.panel.reload();
  await expect(app.panel.locator('[data-card="root"]')).toHaveCount(0);
  await app.panel.locator('[data-act="account-menu"]').click();
  await app.panel.locator('[data-act="root"]').click();
  await expect(app.panel.locator(`[data-root="${parent}"]`)).toHaveAttribute("aria-checked", "true");
  await app.panel.locator(`[data-root="${env.estateDir}"]`).click();
  await app.panel.locator('[data-act="root-use"]').click();
  await app.panel.locator("textarea").fill("now from the estate");
  await app.panel.locator("textarea").press("Enter");
  await expect(app.panel.locator('[data-kind="done"]')).toBeVisible();
  const prompts = env.ocReqs().filter((r) => r.path.endsWith("/prompt_async"));
  expect(prompts.at(-1).query.directory).toBe(env.estateDir);
});
