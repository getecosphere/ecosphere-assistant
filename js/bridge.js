// Native messaging to the helper. One long-lived port; requests are multiplexed by id.
// Frames from the helper: {id, ok, data|error} (final) and {id, event, ...} (streamed).
const HOST = "com.ecosphere.assistant";

let port = null;
let seq = 0;
const waiting = new Map(); // id -> {resolve, reject, onEvent}
const listeners = new Set();
export let state = "unknown"; // unknown | online | offline

function setState(s) {
  if (state === s) return;
  state = s;
  for (const l of listeners) l(s);
}

export const onState = (fn) => (listeners.add(fn), () => listeners.delete(fn));

function open() {
  if (port) return port;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch {
    setState("offline");
    return null;
  }
  port.onMessage.addListener((m) => {
    setState("online");
    const w = waiting.get(m.id);
    if (!w) return;
    if (m.event) return w.onEvent && w.onEvent(m);
    waiting.delete(m.id);
    if (m.ok) w.resolve(m.data);
    else w.reject(Object.assign(new Error(m.error || "helper error"), { rejected: m.rejected }));
  });
  port.onDisconnect.addListener(() => {
    const err = (chrome.runtime.lastError && chrome.runtime.lastError.message) || "helper disconnected";
    port = null;
    setState("offline");
    for (const [id, w] of waiting) {
      waiting.delete(id);
      w.reject(Object.assign(new Error(err), { offline: true }));
    }
  });
  return port;
}

/// request("eco.pm.status", {dir}) -> data. opts.onEvent receives streamed frames.
export function request(action, args = {}, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = open();
    if (!p) return reject(Object.assign(new Error("helper not installed"), { offline: true }));
    const id = ++seq;
    waiting.set(id, { resolve, reject, onEvent: opts.onEvent });
    try {
      p.postMessage({ id, action, args });
    } catch (e) {
      waiting.delete(id);
      reject(Object.assign(e, { offline: true }));
    }
    if (opts.idOut) opts.idOut(id);
  });
}

export function cancel(target) {
  const p = open();
  if (p) p.postMessage({ id: ++seq, action: "cancel", target });
}

export function reconnect() {
  if (port) {
    try {
      port.disconnect();
    } catch {}
    port = null;
  }
  state = "unknown";
  return request("hello");
}
