import { test, expect } from "../fixtures.js";

async function fresh(app, env) {
  env.setState((s) => (s.who = { signedIn: false }));
  await app.panel.evaluate(() => chrome.storage.local.set({ prefs: {} }));
  await app.panel.reload();
}

test("first run: a skippable welcome tour comes before sign-in", async ({ app, env }) => {
  await fresh(app, env);
  const { panel } = app;
  await expect(panel.locator('[data-slide="what"]')).toBeVisible();
  await expect(panel.locator('[data-view="onboarding"]')).toBeHidden();
  await panel.locator('[data-act="intro-next"]').click();
  await expect(panel.locator('[data-slide="local"]')).toContainText("Your code stays on your machine");
  await expect(panel.locator('[data-slide="local"] details')).toContainText("native messaging");
  await panel.locator('[data-act="intro-back"]').click();
  await expect(panel.locator('[data-slide="what"]')).toBeVisible();
  await panel.locator('[data-act="intro-skip"]').click();
  await expect(panel.locator('[data-view="onboarding"]')).toBeVisible();
  await panel.reload();
  await expect(panel.locator('[data-view="onboarding"]')).toBeVisible();
  await expect(panel.locator('[data-slide]')).toHaveCount(0);
});

test("the tour can be walked to the end, and replayed from the setup screen", async ({ app, env }) => {
  await fresh(app, env);
  const { panel } = app;
  for (let i = 0; i < 6; i++) await panel.locator('[data-act="intro-next"]').click();
  await expect(panel.locator('[data-slide="setup"]')).toBeVisible();
  await panel.locator('[data-act="intro-done"]').click();
  await expect(panel.locator('[data-view="onboarding"]')).toBeVisible();
  await panel.locator('.ob-foot [data-act="tour"]').click();
  await expect(panel.locator('[data-slide="what"]')).toBeVisible();
});
