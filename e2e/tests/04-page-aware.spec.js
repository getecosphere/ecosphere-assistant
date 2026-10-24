import { test, expect } from "../fixtures.js";

async function intoApp(app, env) {
  env.approve();
  await app.panel.reload();
  await app.panel.locator('[data-act="use-cli"]').click();
  await expect(app.panel.locator("textarea")).toBeVisible();
  await app.page.bringToFront();
  await expect(app.panel.locator('[data-card="context"]')).toContainText("library");
}
const ask = async (panel, text) => (await panel.locator("textarea").fill(text), await panel.locator("textarea").press("Enter"));

async function pick(app) {
  await app.panel.locator('[data-act="pick"]').click();
  await expect(app.page.getByText("Click an element · Esc to cancel")).toBeVisible();
  await app.page.locator(".card-cta").first().hover();
  await app.page.locator(".card-cta").first().click();
}

test("picker: highlight, click selects without clicking the page, element chip and context", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel, page } = app;
  await pick(app);
  await expect(panel.locator('[data-chip="el"]')).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator('[data-el]')).toContainText("button.card-cta");
  await expect(panel.locator('[data-el]')).toContainText("×");
  expect(await page.evaluate(() => window.__clicks)).toBe(0);
  await expect(page.locator("[data-eco-picker]")).toHaveCount(0); // overlay removed
  await expect(panel.locator(".thumb")).toHaveCSS("background-image", /data:image\/png/);
});

test("Esc cancels the picker and leaves the page untouched", async ({ app, env }) => {
  await intoApp(app, env);
  await app.panel.locator('[data-act="pick"]').click();
  await expect(app.page.getByText("Click an element")).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator("[data-eco-picker]")).toHaveCount(0);
  await expect(app.panel.locator('[data-act="pick"]')).toHaveAttribute("aria-pressed", "false");
  await expect(app.panel.locator('[data-chip="el"]')).toBeDisabled();
});

test("keyboard shortcut in the panel starts the picker", async ({ app, env }) => {
  await intoApp(app, env);
  // the real side panel never changes the active tab, so dispatch the key inside the panel only
  await app.panel.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "E", ctrlKey: true, shiftKey: true, bubbles: true })));
  await expect(app.page.getByText("Click an element")).toBeVisible();
});

test("element run: context + crop are sent, file:line appears, tab reloads with a toast", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel, page } = app;
  await pick(app);
  await ask(panel, "Make this the primary button");
  await expect(panel.locator('[data-kind="done"]')).toBeVisible();
  const prompt = env.ocReqs().find((r) => r.path.endsWith("/prompt_async"));
  const ctx = prompt.body.parts.find((p) => p.synthetic).text;
  expect(ctx).toContain("Selected element: ");
  expect(ctx).toContain("card-cta");
  expect(ctx).toContain("backgroundColor");
  expect(prompt.body.parts.some((p) => p.type === "file" && p.filename === "element.png")).toBe(true);
  await expect(panel.locator('[data-kind="user"] .chips')).toContainText("element");
  await expect(panel.locator("[data-el]")).toContainText("BookCard.tsx:42");
  await expect(panel.locator('[data-kind="diff"]')).toContainText("BookCard.tsx");
  await panel.locator('[data-act="reload-tab"]').click();
  await expect(page.getByText(/✓ reloaded/)).toBeVisible();
  await expect(panel.getByText("Tab reloaded.")).toBeVisible();
});

test("console errors: chip with count, expandable list, sent as context", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel, page } = app;
  await page.evaluate(() => window.boom());
  await panel.bringToFront();
  await page.bringToFront();
  await panel.evaluate(async () => { const a = await import("./js/app.js"); await a.refreshTab(); });
  await expect(panel.locator('[data-chip="cons"]')).toContainText("2 error");
  await panel.locator('[data-chip="cons"]').click();
  await panel.locator(".cons summary").click();
  await expect(panel.locator(".cons")).toContainText("Failed to load analytics.js");
  await ask(panel, "fix these");
  await expect(panel.locator('[data-kind="done"]')).toBeVisible();
  const prompt = env.ocReqs().find((r) => r.path.endsWith("/prompt_async"));
  expect(prompt.body.parts.find((p) => p.synthetic).text).toContain("Console errors (2)");
  expect(prompt.body.parts.find((p) => p.synthetic).text).toContain("cover 97 not found");
});

test("page context card collapses", async ({ app, env }) => {
  await intoApp(app, env);
  await app.panel.locator('[data-act="toggle-ctx"]').click();
  await expect(app.panel.locator(".ctxbody")).toHaveCount(0);
  await app.panel.locator('[data-act="toggle-ctx"]').click();
  await expect(app.panel.locator(".ctxbody")).toBeVisible();
});
