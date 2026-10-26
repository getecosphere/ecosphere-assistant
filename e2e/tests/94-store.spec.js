// Store graphics: screenshots (1280×800) composed from the REAL panel and a demo page, plus the two promo tiles.
// Demo data only (fictional shop.example.com, fake eco/OpenCode). Output is opaque JPEG (the Web Store rejects alpha).
// Brand: P4 LED mark, Manrope, ink #17141d (rules/brand.md). Max 5 screenshots; the first is the brand slide.
import { test, expect } from "../fixtures.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "store", "screenshots");
const font = fs.readFileSync(path.join(ROOT, "fonts", "manrope-latin-400-800.woff2")).toString("base64");

const PAT = ["VBBB", "V...", "VGG.", "V...", "VCCC"];
const COL = { V: "#7048F5", B: "#2B8CF5", G: "#18B47B", C: "#F2593A" };
function mark(px) {
  const pad = px * 0.08, pitch = (px - pad * 2) / 5, r = (pitch * 0.84) / 2;
  let s = "";
  PAT.forEach((row, y) => [...row].forEach((g, x) => {
    const cx = pad + pitch * 0.5 + x * pitch + pitch / 2, cy = pad + y * pitch + pitch / 2;
    s += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${g === "." ? "rgba(23,20,29,.08)" : COL[g]}"/>`;
  }));
  return `<svg width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" aria-label="Ecosphere">${s}</svg>`;
}

const BASE = `@font-face{font-family:Manrope;src:url(data:font/woff2;base64,${font});font-weight:400 800}
*{box-sizing:border-box;margin:0}body{font-family:Manrope,system-ui,sans-serif;color:#17141d;position:relative;overflow:hidden;background:linear-gradient(135deg,#f9f8fc,#e9e3ff)}`;
const agentLogo = (kind, px) => `<img src="data:image/svg+xml;base64,${fs.readFileSync(path.join(ROOT, "icons", "agents", `${kind}.svg`)).toString("base64")}" style="width:${px}px;height:${px}px;display:block;border-radius:${px * 0.18}px">`;
const worksWith = (px, fs_) => `<div style="display:flex;align-items:center;gap:${px * 0.5}px;font-size:${fs_}px;font-weight:600;color:#3b3545">
  <span style="color:#665f6e;font-weight:500">Works with</span>
  <span style="display:flex;align-items:center;gap:${px * 0.3}px">${agentLogo("opencode", px)}OpenCode</span>
  <span style="display:flex;align-items:center;gap:${px * 0.3}px">${agentLogo("claude", px)}Claude Code</span></div>`;
const img = (buf, w) => `<img src="data:image/jpeg;base64,${buf.toString("base64")}" style="width:${w}px;display:block">`;

async function render(ctx, name, w, h, html) {
  fs.mkdirSync(OUT, { recursive: true });
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(`<style>${BASE}html,body{width:${w}px;height:${h}px}</style>${html}`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(150);
  fs.writeFileSync(path.join(OUT, `${name}.jpg`), await p.screenshot({ type: "jpeg", quality: 93 }));
  await p.close();
}

const PANELS = path.join(ROOT, "store", "panels");
const save = (n, buf) => (fs.mkdirSync(PANELS, { recursive: true }), fs.writeFileSync(path.join(PANELS, `${n}.jpg`), buf));

const compose = (ctx, name, headline, sub, pageShot, panelShot) =>
  render(ctx, name, 1280, 800, `
  <div style="position:absolute;left:56px;top:34px;display:flex;align-items:center;gap:16px">${mark(58)}
    <div><div style="font-size:34px;font-weight:800;letter-spacing:-.035em">${headline}</div><div style="font-size:17px;color:#665f6e;margin-top:4px">${sub}</div></div></div>
  <div style="position:absolute;left:56px;top:128px;width:1168px;height:620px;background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(23,20,29,.22);overflow:hidden;display:flex">
    <div style="flex:1;overflow:hidden">${img(pageShot, 760)}</div>
    <div style="width:400px;border-left:1px solid #ded9e1;overflow:hidden">${img(panelShot, 400)}</div></div>
  <div style="position:absolute;left:56px;bottom:20px;font-size:13px;color:#665f6e">Ecosphere Assistant · getecosphere.com · demo data</div>`);

const brandSlide = (ctx) =>
  render(ctx, "00-brand", 1280, 800, `
  <div style="position:absolute;left:120px;top:150px">${mark(250)}</div>
  <div style="position:absolute;left:440px;top:196px;width:720px">
    <div style="font-size:78px;font-weight:800;letter-spacing:-.045em;line-height:1">Ecosphere<br>Assistant</div>
    <div style="font-size:28px;line-height:1.35;color:#3b3545;margin-top:26px;max-width:640px">A coding agent that sees the page you are on, and your project, in Chrome’s side panel.</div>
    <div style="margin-top:34px">${worksWith(34, 22)}</div></div>
  <div style="position:absolute;left:120px;bottom:60px;font-size:20px;font-weight:700;color:#7048F5">getecosphere.com</div>
  <div style="position:absolute;right:120px;bottom:60px;font-size:16px;color:#665f6e">Runs on your machine · Your code stays local</div>`);

const promoSmall = (ctx) =>
  render(ctx, "promo-small", 440, 280, `
  <div style="position:absolute;left:34px;top:46px">${mark(96)}</div>
  <div style="position:absolute;left:150px;top:62px;font-size:31px;font-weight:800;letter-spacing:-.04em;line-height:1.02">Ecosphere<br>Assistant</div>
  <div style="position:absolute;left:34px;top:160px;width:372px;font-size:17px;line-height:1.4;color:#3b3545">A coding agent that sees the page you are on.</div>
  <div style="position:absolute;left:34px;top:206px">${worksWith(18, 13)}</div>
  <div style="position:absolute;left:34px;bottom:20px;font-size:12px;color:#665f6e">getecosphere.com</div>`);

const promoMarquee = (ctx, panelShot) =>
  render(ctx, "promo-marquee", 1400, 560, `
  <div style="position:absolute;left:80px;top:72px">${mark(120)}</div>
  <div style="position:absolute;left:80px;top:214px;width:700px">
    <div style="font-size:64px;font-weight:800;letter-spacing:-.045em;line-height:1">Ecosphere Assistant</div>
    <div style="font-size:26px;line-height:1.38;color:#3b3545;margin-top:20px">Pick an element on your page, say what to change, and a local coding agent does it. You approve every step.</div>
    <div style="margin-top:26px">${worksWith(28, 19)}</div></div>
  <div style="position:absolute;right:90px;top:56px;width:400px;height:560px;background:#fff;border-radius:16px 16px 0 0;box-shadow:0 24px 60px rgba(23,20,29,.25);overflow:hidden">${img(panelShot, 400)}</div>
  <div style="position:absolute;left:80px;bottom:34px;font-size:15px;color:#665f6e">getecosphere.com · runs on your machine</div>`);

// Opt-in (STORE=1): a normal run must not rewrite the committed graphics.
test("store graphics", async ({ app, env, ctx }) => {
  test.skip(!process.env.STORE, "set STORE=1 to regenerate the store graphics");
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
  const shot = async () => [await page.screenshot({ type: "jpeg", quality: 93 }), await panel.screenshot({ type: "jpeg", quality: 93 })];
  const back = () => page.bringToFront();
  const ask = async (text) => {
    await panel.locator("textarea").fill(text);
    await panel.locator("textarea").press("Enter");
  };

  await expect(panel.locator('[data-card="context"]')).toContainText("library");
  await page.evaluate(() => window.boom());
  await panel.evaluate(async () => { const a = await import("./js/app.js"); await a.refreshTab(); });
  await panel.locator('[data-act="pick"]').click();
  await page.locator(".card-cta").first().hover();
  await page.locator(".card-cta").first().click();
  await ask("Make this the primary button");
  await expect(panel.locator('[data-kind="done"]')).toBeVisible();
  await panel.locator('[data-act="reload-tab"]').click();
  await expect(panel.getByText("Tab reloaded.")).toBeVisible();
  let [a, b] = await shot();
  await compose(ctx, "01-agent-sees-your-page", "A coding agent that sees your page", "Pick an element, describe the change, reload and see it.", a, b);
  save("page", b);
  await promoSmall(ctx);
  await promoMarquee(ctx, b);
  await back();

  await ask("fix the comments, ask me for permission");
  await expect(panel.locator('[data-kind="perm"]')).toBeVisible();
  [a, b] = await shot();
  await compose(ctx, "02-you-approve-every-step", "You approve what it runs", "Once, always for this project, or reject. Diffs are shown as they happen.", a, b);
  save("approve", b);
  await back();
  await panel.locator('[data-act="perm-once"]').click();

  // sessions: a few topics, then the list
  await panel.locator('[data-act="new-session"]').click();
  await ask("Why is the library grid heavy on mobile?");
  await expect(panel.locator('[data-kind="done"]')).toHaveCount(1);
  await panel.locator('[data-act="new-session"]').click();
  await ask("Add a dark mode toggle to the header");
  await expect(panel.locator('[data-kind="done"]')).toHaveCount(1);
  await panel.locator('[data-act="sessions"]').click();
  await expect(panel.locator("[data-session]")).not.toHaveCount(0);
  [a, b] = await shot();
  await compose(ctx, "03-sessions-and-context", "Start fresh, keep your tokens", "Blank sessions, a list to switch back, and a meter that shows how full the context is.", a, b);
  save("sessions", b);
  await back();
  await panel.locator('[data-act="ses-close"]').click();

  await panel.locator('[data-tab="qa"]').click();
  await expect(panel.locator('[data-qa="152"]')).toBeVisible();
  [a, b] = await shot();
  await compose(ctx, "04-qa-requests", "Work QA requests from /project", "Take a waiting request; the agent reproduces and fixes it, you verify.", a, b);
  save("qa", b);
  await brandSlide(ctx);
});
