import { test, expect } from "../fixtures.js";
import { compare, PANEL } from "../shots.js";

test("phase 2 screenshots next to the design", async ({ app, env, ctx }) => {
  env.approve();
  const { panel } = app;
  await panel.reload();
  await panel.locator('[data-act="use-cli"]').click();
  await panel.locator("textarea").waitFor();
  await panel.setViewportSize({ width: 400, height: 822 });
  await app.page.bringToFront();
  await expect(panel.locator('[data-card="context"]')).toContainText("web/src/pages/library.tsx");
  const ta = panel.locator("textarea");
  await ta.fill("Why is the library grid heavy on mobile?");
  await ta.press("Enter");
  await expect(panel.locator('[data-kind="done"]')).toBeVisible();
  await compare(ctx, "phase2", "01-agent-answer", await panel.screenshot(), "01-B-agent-idle.png", PANEL);
  await ta.fill("fix the comments, ask me for permission");
  await ta.press("Enter");
  await expect(panel.locator('[data-kind="perm"]')).toBeVisible();
  await compare(ctx, "phase2", "02-permission", await panel.screenshot(), "02-B-agent-permission.png", PANEL);
  await panel.locator('[data-act="perm-once"]').click();
  await expect(panel.locator('[data-kind="done"]').last()).toBeVisible();
  await compare(ctx, "phase2", "03-done", await panel.screenshot(), "03-B-agent-done.png", PANEL);
});
