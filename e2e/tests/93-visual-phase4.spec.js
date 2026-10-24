import { test, expect } from "../fixtures.js";
import { compare, PANEL } from "../shots.js";

test("phase 4 screenshots next to the design", async ({ app, env, ctx }) => {
  env.approve();
  env.setState((s) => {
    s.pm = { linked: true };
    s.qa = [
      { number: 152, severity: "p0", phase: "wait", waitSeconds: 372, title: "/library still opens & comments pass the script tag" },
      { number: 149, severity: "p1", phase: "closed", title: "Language picker resets to EN on DE" },
      { number: 139, severity: "p0", phase: "closed", title: "Frequent logouts: session expired (401)" },
    ];
  });
  const { panel, page } = app;
  await panel.reload();
  await panel.locator('[data-act="use-cli"]').click();
  await panel.locator("textarea").waitFor();
  await panel.setViewportSize({ width: 400, height: 822 });
  await page.bringToFront();
  await panel.locator('[data-tab="qa"]').click();
  await panel.locator('[data-act="capture"]').click();
  const shot = panel.locator("[data-shot]");
  await expect(shot.locator("img")).toBeVisible();
  const b = await shot.boundingBox();
  await panel.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.3);
  await panel.mouse.down();
  await panel.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.55, { steps: 3 });
  await panel.mouse.up();
  await panel.locator('[data-field="title"]').fill("Read button is hard to see on mobile");
  await compare(ctx, "phase4", "04-qa-capture", await panel.screenshot(), "04-B-qa-capture.png", PANEL);
  await page.bringToFront();
  await panel.locator('[data-tab="project"]').click();
  await panel.locator('[data-act="deploy"]').click();
  await expect(panel.locator('[data-confirm="deploy"]')).toBeVisible();
  await compare(ctx, "phase4", "05-proyek-deploy", await panel.screenshot(), "05-B-proyek-deploy.png", PANEL);
  await page.bringToFront();
  await panel.locator('[data-tab="agent"]').click();
  await panel.locator("textarea").fill("Make the library button primary");
  await panel.locator("textarea").press("Enter");
  await expect(panel.locator('[data-kind="done"]')).toBeVisible();
  await panel.locator('[data-act="summarize"]').click();
  await expect(panel.locator('[data-card="summary"] input.field').first()).toHaveValue(/primary/);
  await compare(ctx, "phase4", "11-summary", await panel.screenshot(), "11-E-summary.png", PANEL);
  await page.bringToFront();
});
