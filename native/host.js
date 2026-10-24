#!/usr/bin/env node
"use strict";
// Chrome native messaging host: 4-byte little-endian length + JSON, both directions.
// Requests {id, action, args}; replies {id, ok, data|error}; streamed frames {id, event, ...}.

const { handle } = require("./lib");

function send(msg) {
  const data = Buffer.from(JSON.stringify(msg), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(data.length, 0);
  process.stdout.write(Buffer.concat([header, data]));
}

let buffer = Buffer.alloc(0);
let pending = 0;
let closed = false;

function maybeExit() {
  if (closed && pending === 0) process.exit(0);
}

function onMessage(body) {
  let msg;
  try {
    msg = JSON.parse(body);
  } catch {
    return send({ ok: false, error: "invalid json" });
  }
  pending++;
  handle(msg, send)
    .then(send)
    .finally(() => {
      pending--;
      maybeExit();
    });
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (len > 1024 * 1024) process.exit(1);
    if (buffer.length < 4 + len) break;
    const body = buffer.subarray(4, 4 + len).toString("utf8");
    buffer = buffer.subarray(4 + len);
    onMessage(body);
  }
});

process.stdin.on("end", () => {
  closed = true;
  maybeExit();
});
