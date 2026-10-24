import { test, expect } from "../fixtures.js";

const QA = [
  { number: 152, severity: "p0", phase: "wait", waitSeconds: 372, title: "/library still opens & comments pass the script tag", reporter: { name: "QA Team" } },
  { number: 149, severity: "p1", phase: "closed", title: "Language picker resets to EN on DE" },
];

async function intoApp(app, env, { pm = true, tier } = {}) {
  env.approve();
  env.setState((s) => {
    s.pm = { linked: pm };
    s.qa = QA;
    if (tier) s.who.tier = tier;
  });
  await app.panel.reload();
  await app.panel.locator('[data-act="use-cli"]').click();
  await expect(app.panel.locator("textarea")).toBeVisible();
  await app.page.bringToFront();
}
const calls = (env, ...head) => env.ecoCalls().filter((c) => head.every((h, i) => c.args[i] === h));

test("with /project linked the QA and Project tabs appear, with the waiting badge", async ({ app, env }) => {
  await intoApp(app, env);
  await expect(app.panel.locator('[data-tab="qa"]')).toBeVisible();
  await expect(app.panel.locator('[data-tab="project"]')).toBeVisible();
  await app.panel.locator('[data-tab="qa"]').click();
  await expect(app.panel.locator('[data-badge]')).toHaveText("1");
  await expect(app.panel.locator('[data-qa="152"]')).toContainText("#152 · p0");
  await expect(app.panel.locator('[data-qa="152"]')).toContainText("waiting 06:12");
  await expect(app.panel.locator('[data-qa="149"]')).toContainText("closed");
  await expect(app.panel.locator('[data-qa="149"] [data-act="work"]')).toHaveCount(0);
});

test("Work on it: takes the QA, opens an agent session with the report, mirrors steps, then sends it to QA", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await panel.locator('[data-tab="qa"]').click();
  await panel.locator('[data-qa="152"] [data-act="work"]').click();
  await expect(panel.locator('[data-tab="agent"]')).toHaveAttribute("aria-selected", "true");
  await expect(panel.locator('[data-kind="user"]')).toContainText("Work on QA #152");
  await expect(panel.locator('[data-kind="user"] .chips')).toContainText("qa #152");
  await expect(panel.locator('[data-kind="user"] .chips')).toContainText("library.png");
  expect(calls(env, "pm", "qa", "take", "152")).toHaveLength(1);
  const prompt = env.ocReqs().find((r) => r.path.endsWith("/prompt_async"));
  expect(prompt.body.parts.find((p) => p.synthetic).text).toContain("Screenshots: .eco/qa/152/library.png");
  expect(prompt.body.parts.some((p) => p.type === "file" && p.filename === "library.png")).toBe(true);
  await expect(panel.locator('[data-kind="done"]')).toContainText("QA #152 is ready to verify");
  await expect.poll(() => calls(env, "pm", "qa", "step").length).toBeGreaterThan(1);
  await expect.poll(() => calls(env, "pm", "log").length).toBeGreaterThanOrEqual(4);
  const logs = calls(env, "pm", "log");
  expect(logs[0].args).toEqual(["pm", "log", "pickup", "picked up QA #152 from the side panel", "--qa", "152"]);
  await expect.poll(() => calls(env, "pm", "log").some((l) => l.args[2] === "edit" && l.args.includes("--qa"))).toBe(true);
  await expect.poll(() => calls(env, "pm", "log").some((l) => l.args[2] === "test")).toBe(true);
  expect(logs.length).toBeGreaterThan(0);
  await panel.locator('[data-act="send-qa"]').click();
  await expect.poll(() => calls(env, "pm", "qa", "step").some((c) => c.args.includes("--done"))).toBe(true);
  await expect(panel.locator('[data-tab="qa"]')).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => calls(env, "pm", "qa", "done", "152").length).toBe(1);
  const done = calls(env, "pm", "qa", "done", "152")[0].args;
  expect(done[5]).toContain("/library is a 404 now");
  expect(done[5]).toContain("web/src/pages/library.tsx");
});

test("capture the tab into a QA: box, title, severity, url + browser attached", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await panel.locator('[data-tab="qa"]').click();
  await panel.locator('[data-act="capture"]').click();
  const shot = panel.locator('[data-shot]');
  await expect(shot.locator("img")).toBeVisible();
  const b = await shot.boundingBox();
  await panel.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.2);
  await panel.mouse.down();
  await panel.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.5, { steps: 4 });
  await panel.mouse.up();
  await expect(shot.locator(".box")).toBeVisible();
  await panel.locator('[data-field="title"]').fill("Read button is hard to see on mobile");
  await panel.locator('[data-sev="p0"]').click();
  await panel.locator('[data-act="send-qa-new"]').click();
  await expect(panel.locator('[data-card="capture"]')).toHaveCount(0);
  const c = calls(env, "pm", "qa", "new");
  expect(c).toHaveLength(1);
  const a = c[0].args;
  const val = (f) => a[a.indexOf(f) + 1];
  expect(val("--title")).toBe("Read button is hard to see on mobile");
  expect(val("--severity")).toBe("p0");
  expect(val("--url")).toBe(`http://localhost:${env.pagePort}/library`);
  expect(val("--ua")).toMatch(/Chrome|HeadlessChrome/);
  expect(val("--box").split(",")).toHaveLength(4);
  expect(val("--box").split(",").every((n) => Number(n) >= 0)).toBe(true);
  expect(val("--shot")).toMatch(/qa-[0-9a-f]+\.png$/);
});

test("capture: an eco without `pm qa new` gets a clear message", async ({ app, env }) => {
  await intoApp(app, env);
  env.setState((s) => (s.qaNewUnsupported = true));
  const { panel } = app;
  await panel.locator('[data-tab="qa"]').click();
  await panel.locator('[data-act="capture"]').click();
  await panel.locator('[data-field="title"]').fill("x");
  await panel.locator('[data-act="send-qa-new"]').click();
  await expect(panel.locator('[data-card="capture"]')).toContainText("needs a newer eco");
});

test("Project: hosting card, deploy confirm, live log, done", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await panel.locator('[data-tab="project"]').click();
  const card = panel.locator('[data-card="hosting"]');
  await expect(card).toContainText("shop.example.com");
  await expect(card).toContainText("live 835706f");
  await expect(card).toContainText("Platform");
  await panel.locator('[data-act="deploy"]').click();
  await expect(panel.locator('[data-confirm="deploy"]')).toContainText("2 commits not deployed yet");
  await expect(panel.locator('[data-confirm="deploy"]')).toContainText("source not sent");
  expect(calls(env, "deploy")).toHaveLength(0);
  await panel.locator('[data-act="deploy-go"]').click();
  await expect(panel.locator('[data-log="deploy"]')).toContainText("shipping release");
  await expect(panel.locator('[data-done="ok"]')).toBeVisible();
  expect(calls(env, "deploy")).toHaveLength(1);
  expect(calls(env, "deploy")[0].cwd.endsWith("shop")).toBe(true);
});

test("Project: a failed deploy shows the error state", async ({ app, env }) => {
  await intoApp(app, env);
  env.setState((s) => (s.deployFails = true));
  await app.panel.locator('[data-tab="project"]').click();
  await app.panel.locator('[data-act="deploy"]').click();
  await app.panel.locator('[data-act="deploy-go"]').click();
  await expect(app.panel.locator('[data-done="fail"]')).toBeVisible();
});

test("Project: free account sees the locked card with the early-access waitlist, never a deploy button", async ({ app, env }) => {
  await intoApp(app, env, { tier: "local" });
  await app.panel.locator('[data-tab="project"]').click();
  await expect(app.panel.locator('[data-locked]')).toContainText("paid plans");
  await expect(app.panel.locator('[data-act="waitlist"]')).toBeVisible();
  await expect(app.panel.locator('[data-act="deploy"]')).toHaveCount(0);
});

test("Summarize session: agent drafts, user edits and unticks, eco pm report gets the args", async ({ app, env }) => {
  await intoApp(app, env);
  const { panel } = app;
  await panel.locator("textarea").fill("Make the library button primary");
  await panel.locator("textarea").press("Enter");
  await expect(panel.locator('[data-kind="done"]')).toBeVisible();
  await panel.locator('[data-act="summarize"]').click();
  const card = panel.locator('[data-card="summary"]');
  await expect(card.locator("input.field").first()).toHaveValue("Library cards now use the primary button");
  await expect(panel.locator("[data-task]")).toHaveCount(1);
  await card.locator("input.field").first().fill("Library buttons use the brand color");
  await card.locator('input[type="checkbox"]').nth(1).uncheck();
  await panel.locator('[data-act="send-report"]').click();
  await expect(card).toContainText("Sent.");
  const r = calls(env, "pm", "report");
  expect(r).toHaveLength(1);
  expect(r[0].args).toEqual(["pm", "report", "--headline", "Library buttons use the brand color", "--result", "Primary card button: BookCard uses the brand variant."]);
  // the draft came from a scratch session that was deleted afterwards
  expect(env.ocReqs().some((q) => q.method === "DELETE" && q.path.startsWith("/session/"))).toBe(true);
});
