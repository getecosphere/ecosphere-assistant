"use strict";
// claude-server.js: Claude Code stream/transcript lines -> the OpenCode shapes the panel renders.
const test = require("node:test");
const assert = require("node:assert");
const { absorb, toolInput, toolName, patchText, contentBlocks, userWords } = require("../claude-server.js");

test("tool names and inputs map to the OpenCode shapes", () => {
  assert.strictEqual(toolName("Bash"), "bash");
  assert.strictEqual(toolName("Write"), "write");
  assert.strictEqual(toolName("mcp__x__y"), "mcp__x__y");
  assert.deepStrictEqual(toolInput("Edit", { file_path: "/a", old_string: "x", new_string: "y" }), { file_path: "/a", old_string: "x", new_string: "y", filePath: "/a", oldString: "x", newString: "y" });
});

test("an assistant tool call and its result become one tool part", () => {
  const msgs = new Map();
  const tools = new Map();
  absorb({ type: "assistant", message: { id: "m1", model: "claude-x", usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 5 }, content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/f", old_string: "a", new_string: "b" } }] } }, "s", msgs, tools, false);
  absorb({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }] }, toolUseResult: { structuredPatch: [{ lines: ["-a", "+b"] }] } }, "s", msgs, tools, false);
  const row = msgs.get("m1");
  assert.strictEqual(row.info.tokens.cache.read, 5);
  const [text, tool] = [...row.parts.values()];
  assert.strictEqual(text.text, "ok");
  assert.strictEqual(tool.tool, "edit");
  assert.strictEqual(tool.state.status, "completed");
  assert.strictEqual(tool.state.metadata.diff, "-a\n+b");
});

test("history keeps the user's words and flags the panel's browser context as synthetic", () => {
  const msgs = new Map();
  absorb({ type: "user", uuid: "u1", timestamp: "2026-10-26T00:00:00Z", message: { content: [{ type: "text", text: "fix it" }, { type: "text", text: "Browser context from the Ecosphere Assistant side panel:\n- x" }] } }, "s", msgs, new Map(), false);
  const parts = [...msgs.get("u1").parts.values()];
  assert.strictEqual(parts[0].synthetic, undefined);
  assert.strictEqual(parts[1].synthetic, true);
  assert.strictEqual(userWords({ type: "user", message: { content: "<command-name>/x</command-name>" } }), "");
  assert.strictEqual(patchText({}), "");
});

test("a screenshot part becomes an image block", () => {
  const b = contentBlocks([{ type: "text", text: "hi" }, { type: "file", mime: "image/png", url: "data:image/png;base64,AAAA" }]);
  assert.deepStrictEqual(b[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
});
