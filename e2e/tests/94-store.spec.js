// Store screenshots (1280×800) composed from the REAL panel and a demo page. Demo data only
// (fictional shop.example.com, fake eco/OpenCode). Output is JPEG: opaque, accepted by the Web Store.
import { test, expect } from "../fixtures.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "store", "screenshots");

async function compose(ctx, name, headline, sub, pageShot, panelShot) {
  fs.mkdirSync(OUT, { recursive: true });
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.setContent(`<body style="margin:0;width:1280px;height:800px;background:linear-gradient(135deg,#f7f6f2,#e9e3ff);font-family:system-ui,sans-serif;color:#17141d;position:relative;overflow:hidden">
  <div style="position:absolute;left:56px;top:40px;width:1168px"><div style="font-size:34px;font-weight:800;letter-spacing:-.03em">${headline}</div><div style="font-size:17px;color:#665f6e;margin-top:6px">${sub}</div></div>
  <div style="position:absolute;left:56px;top:128px;width:1168px;height:620px;background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(23,20,29,.22);overflow:hidden;display:flex">
    <div style="flex:1;overflow:hidden;position:relative"><img src="data:image/jpeg;base64,${pageShot.toString("base64")}" style="width:760px;display:block"></div>
    <div style="width:400px;border-left:1px solid #ded9e1;overflow:hidden"><img src="data:image/jpeg;base64,${panelShot.toString("base64")}" style="width:400px;display:block"></div></div>
  <div style="position:absolute;left:56px;bottom:22px;font-size:13px;color:#665f6e">Ecosphere Assistant · getecosphere.com · demo data</div></body>`);
  await p.waitForTimeout(200);
  fs.writeFileSync(path.join(OUT, `${name}.jpg`), await p.screenshot({ type: "jpeg", quality: 92 }));
  await p.close();
}

// Opt-in (STORE=1): a normal run must not rewrite the committed screenshots.
test.skip(!process.env.STORE, "set STORE=1 to regenerate the store screenshots");
test("store screenshots", async ({ app, env, ctx }) => {
  env.approve();
  env.setState((s) => {
    s.pm = { linked: true };
    s.qa = [
      { number: 152, severity: "p0", phase: "wait", waitSeconds: 372, title: "/library still opens & comments pass the script tag" },
      { number: 149, severity: "p1", phase: "closed", title: "Language picker resets to EN on DE" },
    ];
  });
  const { panel, page } = app;
  await panel.reload();
  await panel.locator('[data-act="use-cli"]').click();
  await panel.locator("textarea").waitFor();
  await panel.setViewportSize({ width: 400, height: 620 });
  await page.setViewportSize({ width: 760, height: 620 });
  await page.bringToFront();
  const shot = async () => [await page.screenshot({ type: "jpeg", quality: 92 }), await panel.screenshot({ type: "jpeg", quality: 92 })];
  const back = () => page.bringToFront();
  await expect(panel.locator('[data-card="context"]')).toContainText("library");
  await page.evaluate(() => window.boom());
  await panel.evaluate(async () => { const a = await import("./js/app.js"); await a.refreshTab(); });
  await panel.locator('[data-act="pick"]').click();
  await page.locator(".card-cta").first().hover();
  await page.locator(".card-cta").first().click();
  await panel.locator("textarea").fill("Make this the primary button");
  await panel.locator("textarea").press("Enter");
  await expect(panel.locator('[data-kind="done"]')).toBeVisible();
  await panel.locator('[data-act="reload-tab"]').click();
  await expect(panel.getByText("Tab reloaded.")).toBeVisible();
  let [a, b] = await shot();
  await compose(ctx, "01-agent-sees-your-page", "A coding agent that sees the page you are on", "Pick an element, describe the change, reload and see it.", a, b);
  await back();
  await panel.locator("textarea").fill("fix the comments, ask me for permission");
  await panel.locator("textarea").press("Enter");
  await expect(panel.locator('[data-kind="perm"]')).toBeVisible();
  [a, b] = await shot();
  await compose(ctx, "02-you-approve-every-step", "You approve what it runs", "Once, always for this project, or reject. Diffs are shown as they happen.", a, b);
  await back();
  await panel.locator('[data-act="perm-once"]').click();
  await panel.locator('[data-tab="qa"]').click();
  await panel.locator('[data-act="capture"]').click();
  await expect(panel.locator("[data-shot] img")).toBeVisible();
  await panel.locator('[data-field="title"]').fill("Read button is hard to see on mobile");
  [a, b] = await shot();
  await compose(ctx, "03-qa-from-the-tab", "Turn the tab into a QA request", "Mark the problem, set severity, the agent can work it.", a, b);
  await back();
  await panel.locator('[data-tab="project"]').click();
  await panel.locator('[data-act="deploy"]').click();
  [a, b] = await shot();
  await compose(ctx, "04-deploy-your-local-build", "Deploy what you built on your machine", "Built locally, source not sent. Gated by your plan.", a, b);
  await back();
  await panel.locator('[data-tab="compose"]').click();
  await expect(panel.locator('[data-lxs="gateway"]')).toBeVisible();
  [a, b] = await shot();
  await compose(ctx, "05-compose-capabilities", "Compose capabilities, not YAML", "Add a signed LXS; eco merges your ecompose.yml.", a, b);
});
