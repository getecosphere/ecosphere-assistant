import test from "node:test";
import assert from "node:assert";
import { Timeline, toolItem, diffLines } from "../session.js";

const ev = (type, properties) => ({ id: "evt", type, properties });
const S = "ses_1";

test("a streamed answer becomes user + text items; deltas append", () => {
  const t = new Timeline(S);
  t.chipQueue.push(["page"]);
  t.apply(ev("message.updated", { sessionID: S, info: { id: "msg_u1", role: "user" } }));
  t.apply(ev("message.part.updated", { sessionID: S, part: { id: "p1", messageID: "msg_u1", type: "text", text: "hi" } }));
  t.apply(ev("message.updated", { sessionID: S, info: { id: "msg_a1", role: "assistant" } }));
  t.apply(ev("message.part.updated", { sessionID: S, part: { id: "p2", messageID: "msg_a1", type: "text", text: "Hel" } }));
  t.apply(ev("message.part.delta", { sessionID: S, messageID: "msg_a1", partID: "p2", field: "text", delta: "lo" }));
  assert.deepEqual(t.items().map((i) => [i.kind, i.text]), [["user", "hi"], ["text", "Hello"]]);
  assert.deepEqual(t.items()[0].chips, ["page"]);
});

test("synthetic context parts are never shown", () => {
  const t = new Timeline(S);
  t.apply(ev("message.updated", { sessionID: S, info: { id: "u", role: "user" } }));
  t.apply(ev("message.part.updated", { sessionID: S, part: { id: "a", messageID: "u", type: "text", text: "visible" } }));
  t.apply(ev("message.part.updated", { sessionID: S, part: { id: "b", messageID: "u", type: "text", text: "hidden ctx", synthetic: true } }));
  assert.equal(t.items().length, 1);
});

test("events of other sessions are ignored", () => {
  const t = new Timeline(S);
  assert.equal(t.apply(ev("session.status", { sessionID: "other", status: { type: "busy" } })), false);
  assert.equal(t.busy, false);
});

test("busy → idle bumps finished once; abort marks stopped, not an error", () => {
  const t = new Timeline(S);
  t.apply(ev("session.status", { sessionID: S, status: { type: "busy" } }));
  assert.equal(t.busy, true);
  t.apply(ev("session.error", { sessionID: S, error: { name: "MessageAbortedError", data: { message: "x" } } }));
  t.apply(ev("session.status", { sessionID: S, status: { type: "idle" } }));
  t.apply(ev("session.idle", { sessionID: S }));
  assert.equal(t.stopped, true);
  assert.equal(t.error, null);
  assert.equal(t.finished, 1);
});

test("permission card sits right after its tool call and tracks the answer", () => {
  const t = new Timeline(S);
  t.apply(ev("message.updated", { sessionID: S, info: { id: "a", role: "assistant" } }));
  t.apply(ev("message.part.updated", { sessionID: S, part: { id: "t1", messageID: "a", type: "tool", tool: "bash", callID: "c1", state: { status: "pending", input: { command: "eco up dev" } } } }));
  t.apply(ev("message.part.updated", { sessionID: S, part: { id: "t2", messageID: "a", type: "tool", tool: "read", callID: "c2", state: { status: "completed", input: { filePath: "x" } } } }));
  t.apply(ev("permission.asked", { id: "per1", sessionID: S, permission: "bash", patterns: ["eco up dev"], metadata: {}, always: [], tool: { messageID: "a", callID: "c1" } }));
  assert.deepEqual(t.items().map((i) => i.kind), ["step", "perm", "step"]);
  assert.equal(t.waitingForPermission, true);
  t.apply(ev("permission.replied", { sessionID: S, requestID: "per1", reply: "once" }));
  assert.equal(t.waitingForPermission, false);
});

test("edit tools render as diff cards from the unified diff, else from old/new", () => {
  const withMd = { id: "e", tool: "edit", state: { status: "completed", input: { filePath: "/p/a.ts" }, metadata: { diff: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n ctx" } } };
  const it = toolItem(withMd, "/p");
  assert.equal(it.kind, "diff");
  assert.equal(it.file, "a.ts");
  assert.deepEqual([it.plus, it.minus], [1, 1]);
  const bare = diffLines({ state: { metadata: {} } }, { oldString: "a\nb", newString: "c" });
  assert.deepEqual(bare, [["-", "a"], ["-", "b"], ["+", "c"]]);
});

test("tool args are readable and todo tools are hidden", () => {
  const t = new Timeline(S);
  t.apply(ev("message.updated", { sessionID: S, info: { id: "a", role: "assistant" } }));
  t.apply(ev("message.part.updated", { sessionID: S, part: { id: "g", messageID: "a", type: "tool", tool: "grep", callID: "1", state: { status: "completed", input: { pattern: "card-cta" } } } }));
  t.apply(ev("message.part.updated", { sessionID: S, part: { id: "z", messageID: "a", type: "tool", tool: "todowrite", callID: "2", state: { status: "completed", input: {} } } }));
  assert.deepEqual(t.items().map((i) => i.arg), ["card-cta"]);
});

test("history load reproduces the timeline", () => {
  const t = new Timeline(S);
  t.load([{ info: { id: "u", role: "user" }, parts: [{ id: "p", messageID: "u", type: "text", text: "earlier" }] }, { info: { id: "a", role: "assistant" }, parts: [{ id: "q", messageID: "a", type: "text", text: "answer" }] }]);
  assert.deepEqual(t.items().map((i) => i.text), ["earlier", "answer"]);
});

test("/undo hides the reverted tail; context size and model come from the newest assistant message", () => {
  const t = new Timeline(S);
  const user = (id, text) => {
    t.apply(ev("message.updated", { sessionID: S, info: { id, role: "user" } }));
    t.apply(ev("message.part.updated", { sessionID: S, part: { id: `p_${id}`, messageID: id, type: "text", text } }));
  };
  const bot = (id, text, tokens) => {
    t.apply(ev("message.updated", { sessionID: S, info: { id, role: "assistant", providerID: "anthropic", modelID: "m1", tokens } }));
    t.apply(ev("message.part.updated", { sessionID: S, part: { id: `p_${id}`, messageID: id, type: "text", text } }));
  };
  user("u1", "one");
  bot("a1", "A1", { input: 5, output: 10, reasoning: 0, cache: { read: 100, write: 0 } });
  user("u2", "two");
  bot("a2", "A2", { input: 7, output: 20, reasoning: 3, cache: { read: 200, write: 50 } });
  assert.equal(t.contextTokens(), 280);
  assert.deepEqual(t.model(), { providerID: "anthropic", modelID: "m1" });
  assert.equal(t.lastUser().id, "u2");
  t.revertAt = "u2";
  assert.deepEqual(t.items().map((i) => i.text), ["one", "A1"]);
  assert.equal(t.lastUser().id, "u1");
  assert.equal(t.contextTokens(), 115);
  t.revertAt = "";
  assert.equal(t.items().length, 4);
});
