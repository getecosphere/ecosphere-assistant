import { test, expect } from "../fixtures.js";

async function intoApp(app, env) {
  env.approve();
  await app.panel.reload();
  await app.panel.locator('[data-act="use-cli"]').click();
  await expect(app.panel.locator('[data-tab="agent"]')).toBeVisible();
  await expect(app.panel.locator("textarea")).toBeVisible();
  await app.page.bringToFront();
}

async function ask(panel, text) {
  await panel.locator("textarea").fill(text);
  await panel.locator("textarea").press("Enter");
}

test("send a prompt: auth'd session, context chip, steps, done card", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await expect(panel.locator('[data-card="context"]')).toContainText(`localhost:${env.pagePort}/library`);
  await expect(panel.locator('[data-card="context"]')).toContainText("web/src/pages/library.tsx");
  await ask(panel, "Why is the library grid heavy on mobile?");
  await expect(panel.locator('[data-kind="user"]')).toContainText("Why is the library grid heavy");
  await expect(panel.locator('[data-kind="user"] .chips')).toContainText("page");
  await expect(panel.locator('[data-kind="step"]').first()).toContainText("read");
  await expect(panel.locator('[data-kind="text"]').last()).toContainText("lazy loading");
  await expect(panel.locator('[data-kind="done"]')).toBeVisible();
  const reqs = env.ocReqs();
  const prompt = reqs.find((r) => r.path.endsWith("/prompt_async"));
  expect(prompt.query.directory).toBe(env.estateDir);
  expect(prompt.body.parts[0]).toMatchObject({ type: "text", text: "Why is the library grid heavy on mobile?" });
  const ctx = prompt.body.parts.find((p) => p.synthetic);
  expect(ctx.text).toContain(`Active tab: http://localhost:${env.pagePort}/library`);
  expect(ctx.text).toContain("Likely source file for this page: web/src/pages/library.tsx");
  await expect(panel.locator("[data-status]")).toHaveText("ready");
});

test("the helper's OpenCode server needs its per-launch password (panel holds none in storage)", async ({ app, env }) => {
  await intoApp(app, env);
  await ask(app.panel, "hello");
  await expect(app.panel.locator('[data-kind="done"]')).toBeVisible();
  const store = JSON.stringify(await app.panel.evaluate(() => Promise.all([chrome.storage.local.get(null), chrome.storage.session.get(null)])));
  const servers = JSON.parse(await (await import("node:fs")).promises.readFile(env.ah + "/servers.json", "utf8"));
  const pw = Object.values(servers)[0].password;
  expect(pw.length).toBeGreaterThan(16);
  expect(store).not.toContain(pw);
});

test("LED animates only while the agent is working", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await expect(panel.locator(".ph .led.run")).toHaveCount(0);
  await ask(panel, "slow please");
  await expect(panel.locator(".ph .led.run")).toHaveCount(1);
  await expect(panel.locator("[data-status]")).toHaveText("working");
  await panel.locator('[data-act="stop"]').click();
  await expect(panel.locator(".ph .led.run")).toHaveCount(0);
});

for (const [answer, act, done] of [["once", "perm-once", "allowed once"], ["always", "perm-always", "always allowed"], ["reject", "perm-reject", "rejected"]]) {
  test(`permission card: ${answer}`, async ({ app, env }) => {
    await intoApp(app, env);
    const { panel } = app;
    await ask(panel, "fix the comments, ask me for permission");
    await expect(panel.locator('[data-kind="diff"]')).toContainText("comments/src/render.rs");
    await expect(panel.locator('[data-kind="diff"] .dl-add')).toContainText("escape_html");
    const card = panel.locator('[data-kind="perm"]');
    await expect(card).toContainText("eco up dev");
    await expect(panel.locator("[data-status]")).toHaveText("permission needed");
    await panel.locator(`[data-act="${act}"]`).click();
    await expect(card).toContainText(done);
    await expect(panel.locator('[data-kind="done"]')).toBeVisible();
    await expect(panel.locator('[data-kind="text"]').last()).toContainText(answer === "reject" ? "not run" : "back online");
    const reply = env.ocReqs().find((r) => r.path.includes("/permission/") && r.path.endsWith("/reply"));
    expect(reply.body.reply).toBe(answer);
  });
}

test("Stop aborts the session", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await ask(panel, "do something slow");
  await panel.locator('[data-act="stop"]').click();
  await expect(panel.getByText("Stopped.")).toBeVisible();
  expect(env.ocReqs().some((r) => r.path.endsWith("/abort"))).toBe(true);
  await expect(panel.locator('[data-act="stop"]')).toHaveCount(0);
});

test("attachments: screenshot chip sends an image part", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await panel.locator('[data-chip="shot"]').click();
  await ask(panel, "what is wrong in this screenshot?");
  await expect(panel.locator('[data-kind="done"]')).toBeVisible();
  const prompt = env.ocReqs().find((r) => r.path.endsWith("/prompt_async"));
  const file = prompt.body.parts.find((p) => p.type === "file");
  expect(file.mime).toBe("image/png");
  expect(file.url).toMatch(/^data:image\/png;base64,/);
  await expect(panel.locator('[data-chip="shot"]')).toHaveAttribute("aria-pressed", "false");
});

test("/ commands and @ files complete in the composer", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await panel.locator("textarea").fill("/rev");
  await expect(panel.locator('[data-pop="cmd"]')).toContainText("/review");
  await panel.locator("textarea").press("Enter");
  await expect(panel.locator("textarea")).toHaveValue("/review ");
  await panel.locator("textarea").fill("look at @librar");
  await expect(panel.locator('[data-pop="file"]')).toContainText("web/src/pages/library.tsx");
  await panel.locator("textarea").press("Enter");
  await expect(panel.locator("textarea")).toHaveValue("look at @web/src/pages/library.tsx ");
  await panel.locator("textarea").press("Enter");
  await expect(panel.locator('[data-kind="user"]')).toBeVisible();
  const prompt = env.ocReqs().find((r) => r.path.endsWith("/prompt_async"));
  expect(prompt.body.parts.some((p) => p.type === "file" && p.url === `file://${env.estateDir}/web/src/pages/library.tsx`)).toBe(true);
});

test("Shift+Enter inserts a newline, Enter sends", async ({ app, env }) => {
  await intoApp(app, env);
  const ta = app.panel.locator("textarea");
  await ta.fill("line one");
  await ta.press("Shift+Enter");
  await ta.type("line two");
  await expect(ta).toHaveValue("line one\nline two");
});

test("OpenCode down → clear state with a restart that works", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await ask(panel, "first");
  await expect(panel.locator('[data-kind="done"]')).toBeVisible();
  const fs = await import("node:fs");
  for (const s of Object.values(JSON.parse(fs.readFileSync(env.ah + "/servers.json", "utf8")))) { if (s.label) (await import("node:child_process")).spawnSync("launchctl", ["remove", s.label]); if (s.pid > 1) try { process.kill(s.pid, "SIGKILL"); } catch {} }
  await ask(panel, "second");
  await expect(panel.locator('[data-err="opencode"]')).toBeVisible();
  await expect(panel.locator("[data-status]")).toHaveText("agent offline");
  await panel.locator('[data-act="restart-oc"]').click();
  await expect(panel.locator('[data-err="opencode"]')).toHaveCount(0);
  await ask(panel, "third");
  await expect(panel.locator('[data-kind="user"]').last()).toContainText("third");
  await expect(panel.locator('[data-kind="done"]')).toBeVisible();
});

test("a reopened panel resumes the project's session history", async ({ app, env }) => {
  await intoApp(app, env);
  await ask(app.panel, "remember me");
  await expect(app.panel.locator('[data-kind="done"]')).toBeVisible();
  await app.panel.reload();
  await app.panel.locator('[data-tab="agent"]').waitFor();
  await expect(app.panel.locator('[data-kind="user"]')).toContainText("remember me");
});
