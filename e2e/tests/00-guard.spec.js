import { test, expect } from "../fixtures.js";
import { extensionId } from "../fixtures.js";
import fs from "node:fs";
import path from "node:path";

// Refuse to run against anything real: the helper must resolve the fake eco, and no real key is in reach.
test("e2e uses only fakes (never the real eco account)", async ({ env }) => {
  expect(process.env.ECO_API_KEY ?? "").toBe("");
  const cfg = JSON.parse(fs.readFileSync(path.join(env.ah, "config.json"), "utf8"));
  expect(cfg.eco.startsWith(env.root)).toBe(true);
  expect(fs.realpathSync(cfg.eco).endsWith(path.join("e2e", "fakes", "eco"))).toBe(true);
  expect(env.home.startsWith(env.root)).toBe(true);
});

test("extension id from the pinned key matches what the installer registers", async ({ ctx }) => {
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  expect(new URL(sw.url()).host).toBe(extensionId());
});
