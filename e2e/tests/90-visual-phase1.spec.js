import { test, expect } from "../fixtures.js";
import { compare, PANEL } from "../shots.js";

test("phase 1 screenshots next to the design", async ({ app, env, ctx }) => {
  const { panel } = app;
  await panel.setViewportSize({ width: 400, height: 900 });
  await expect(panel.locator('[data-act="use-cli"]')).toBeVisible();
  await compare(ctx, "phase1", "12-onboarding-login", await panel.screenshot(), "12-F-onboarding-login.png", [0, 0, 400, 900]);
  await panel.locator('[data-act="use-cli"]').click();
  await expect(panel.locator('[data-act="approve"]')).toBeVisible();
  await compare(ctx, "phase1", "14-onboarding-project", await panel.screenshot(), "14-F-onboarding-project.png", [0, 0, 400, 900]);
  await panel.locator('[data-act="approve"]').click();
  await panel.locator('[data-tab="compose"]').click();
  await expect(panel.locator('[data-lxs="gateway"]')).toBeVisible();
  await compare(ctx, "phase1", "06-compose", await panel.screenshot(), "06-B-compose.png", PANEL);
  await panel.locator('[data-act="account-menu"]').click();
  await compare(ctx, "phase1", "07-menu", await panel.screenshot(), "07-B-menu-dock-left.png", [0, 79, 400, 821]);
});
