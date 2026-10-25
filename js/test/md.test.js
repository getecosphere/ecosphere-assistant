import test from "node:test";
import assert from "node:assert";
import { parse, inline } from "../md-parse.js";
import { toolIntent } from "../session.js";

test("blocks: headings, lists (nested), fenced code, quote, rule, table", () => {
  const t = parse("## Title\n\nHello **bold** and `code`.\n\n- one\n  - nested\n- two\n\n```js\nconst a = 1;\n```\n\n> quoted\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  assert.deepEqual(t.map((b) => b.t), ["h", "p", "list", "pre", "quote", "hr", "table"]);
  assert.equal(t[0].n, 2);
  assert.deepEqual(t[2].items.map((i) => i.depth), [0, 1, 0]);
  assert.equal(t[3].v, "const a = 1;");
  assert.deepEqual(t[6].rows[0].map((c) => c[0].v), ["1", "2"]);
});

test("inline: bold, italic, code, links; unclosed markers stay literal; no HTML is ever produced", () => {
  assert.deepEqual(inline("a **b** *c* `d`").map((n) => n.t), ["text", "b", "text", "i", "text", "code"]);
  assert.deepEqual(inline("half **open"), [{ t: "text", v: "half **open" }]);
  assert.equal(inline("[x](https://e.com)")[0].href, "https://e.com");
  assert.deepEqual(inline("snake_case_name").map((n) => n.t), ["text"]);
  const p = parse("<script>alert(1)</script>")[0];
  assert.equal(p.c[0].v, "<script>alert(1)</script>");
});

test("an unterminated fence (mid-stream) is code to the end", () => {
  const t = parse("```\nline1\nline2");
  assert.equal(t[0].t, "pre");
  assert.equal(t[0].v, "line1\nline2");
});

test("tool intention: only what says why; a bare command has none", () => {
  assert.equal(toolIntent("bash", { command: "cd /x && ls" }), null);
  assert.deepEqual(toolIntent("bash", { command: "ls", description: "List the pages" }), { k: "text", a: "List the pages" });
  assert.deepEqual(toolIntent("read", { filePath: "/w/a/b.ts" }, "/w"), { k: "read", a: "a/b.ts" });
  assert.deepEqual(toolIntent("grep", { pattern: "foo" }), { k: "grep", a: "foo" });
  assert.equal(toolIntent("edit", { filePath: "x" }), null);
});
