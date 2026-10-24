import { test, expect } from "../fixtures.js";

async function intoApp(app, env) {
  env.approve();
  await app.panel.reload();
  await app.panel.locator('[data-act="use-cli"]').click();
  await expect(app.panel.locator("textarea")).toBeVisible();
  await app.page.bringToFront();
}
const ask = async (panel, text) => {
  await panel.locator("textarea").fill(text);
  await panel.locator("textarea").press("Enter");
};
const done = (panel, n) => expect(panel.locator('[data-kind="done"]')).toHaveCount(n);

test("blank start: nothing is created until the first message; titles and context show in the bar", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await expect(panel.locator("[data-session-title]")).toHaveText("New session");
  expect(env.ocReqs().some((r) => r.method === "POST" && r.path === "/session")).toBe(false);
  await ask(panel, "Why is the library grid heavy on mobile?");
  await done(panel, 1);
  await expect(panel.locator("[data-session-title]")).toContainText("Why is the library grid");
  await expect(panel.locator("[data-ctx]")).toContainText("ctx 52k");
});

test("new session, list, switch, search, rename, fork, delete", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await ask(panel, "first topic");
  await done(panel, 1);
  await panel.locator('[data-act="new-session"]').click();
  await expect(panel.locator('[data-kind="user"]')).toHaveCount(0);
  await expect(panel.locator("[data-session-title]")).toHaveText("New session");
  await ask(panel, "second topic");
  await expect(panel.locator('[data-kind="user"]')).toContainText("second topic");
  await done(panel, 1);

  await panel.locator('[data-act="sessions"]').click();
  const rows = panel.locator("[data-session]");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("second topic");
  await expect(rows.first()).toContainText("tok");
  await panel.locator(".sesq").first().fill("first");
  await expect(rows).toHaveCount(1);
  await rows.first().locator(".sesmain").click();
  await expect(panel.locator('[data-kind="user"]')).toContainText("first topic");
  await expect(panel.locator("[data-session-title]")).toContainText("first topic");

  await panel.locator('[data-act="sessions"]').click();
  await panel.locator(".sesq").first().fill("");
  await expect(panel.locator("[data-session]")).toHaveCount(2);
  await panel.locator('[data-session]').filter({ hasText: "first topic" }).locator('[data-act="ses-rename"]').click();
  await panel.locator('.sesrow input').fill("Library speed");
  await panel.locator('.sesrow input').press("Enter");
  await expect(panel.locator("[data-session]").filter({ hasText: "Library speed" })).toHaveCount(1);

  await panel.locator('[data-session]').filter({ hasText: "Library speed" }).locator('[data-act="ses-fork"]').click();
  await expect(panel.locator("[data-session-title]")).toContainText("fork");
  await expect(panel.locator('[data-kind="user"]')).toContainText("first topic");

  await panel.locator('[data-act="sessions"]').click();
  await expect(panel.locator("[data-session]")).toHaveCount(3);
  const forkRow = panel.locator("[data-session]").filter({ hasText: "fork" });
  await forkRow.locator('[data-act="ses-del"]').click();
  await forkRow.locator('[data-act="ses-del-yes"]').click();
  await expect(panel.locator("[data-session]")).toHaveCount(2);
  await expect(panel.locator("[data-session-title]")).toHaveText("New session");
});

test("slash commands: /new, /sessions, /rename, /undo, /redo, /compact, popover lists them with server commands", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  const ta = panel.locator("textarea");
  await ta.fill("/");
  const pop = panel.locator('[data-pop="cmd"]');
  for (const c of ["/share", "/new", "/sessions", "/compact", "/undo", "/redo", "/rename", "/fork", "/init"]) await expect(pop).toContainText(c);
  await ta.fill("");

  await ask(panel, "Why is the library grid heavy on mobile?");
  await done(panel, 1);
  await ask(panel, "/rename Grid weight");
  await expect(panel.locator("[data-session-title]")).toHaveText("Grid weight");

  await ask(panel, "/undo");
  await expect(panel.locator('[data-kind="user"]')).toHaveCount(0);
  await expect(ta).toHaveValue("Why is the library grid heavy on mobile?");
  await ask(panel, "/redo");
  await expect(panel.locator('[data-kind="user"]')).toHaveCount(1);

  await ask(panel, "/compact");
  await expect.poll(() => env.ocReqs().some((r) => r.path.endsWith("/summarize") && r.body.providerID === "anthropic" && r.body.modelID === "claude-sonnet-5-5"))
    .toBe(true);
  await expect(panel.locator(".pm")).toContainText("compacted");

  await ask(panel, "/sessions");
  await expect(panel.locator('[data-view="sessions"]')).toBeVisible();
  await panel.locator('[data-act="ses-close"]').click();
  await ask(panel, "/new");
  await expect(panel.locator("[data-session-title]")).toHaveText("New session");
  expect(env.ocReqs().filter((r) => r.path.endsWith("/prompt_async") && /^\/(new|undo|redo|compact|sessions|rename)/.test((r.body.parts[0] || {}).text || ""))).toHaveLength(0);
});

test("the session is remembered per project across a panel reload", async ({ app, env }) => {
  await intoApp(app, env);
  await ask(app.panel, "remember me");
  await done(app.panel, 1);
  await app.panel.reload();
  await expect(app.panel.locator('[data-kind="user"]')).toContainText("remember me");
  await expect(app.panel.locator("[data-session-title]")).toContainText("remember me");
});

test("/share asks first, then shows the link; /unshare removes it", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await ask(panel, "share me");
  await done(panel, 1);
  await ask(panel, "/share");
  await expect(panel.locator('[data-card="share-confirm"]')).toContainText("Anyone with the link can read it");
  expect(env.ocReqs().some((r) => r.path.endsWith("/share"))).toBe(false);
  await panel.locator('[data-act="share-no"]').click();
  await expect(panel.locator('[data-card="share-confirm"]')).toHaveCount(0);
  expect(env.ocReqs().some((r) => r.path.endsWith("/share"))).toBe(false);

  await ask(panel, "/share");
  await panel.locator('[data-act="share-yes"]').click();
  await expect(panel.locator('[data-card="shared"] a')).toHaveAttribute("href", /^https:\/\/share\.example\/s\/ses_/);
  await expect(panel.locator("[data-shared]")).toBeVisible();
  await panel.locator('[data-act="unshare"]').click();
  await expect(panel.locator('[data-card="shared"]')).toHaveCount(0);
  await expect(panel.locator("[data-shared]")).toHaveCount(0);
});
