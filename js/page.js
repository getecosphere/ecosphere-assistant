// Page awareness: the active tab, per-origin permission, console errors, element picker, screenshots.
// Everything is on demand (activeTab / scripting + a host permission asked for at first use).
const CONSOLE_KEY = "__ecoConsole";

export async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab && tab.url && /^https?:/.test(tab.url) ? tab : null;
}

export const originOf = (url) => {
  try {
    return new URL(url).origin + "/*";
  } catch {
    return "";
  }
};

export async function hasAccess(url) {
  const o = originOf(url);
  if (!o) return false;
  try {
    return await chrome.permissions.contains({ origins: [o] });
  } catch {
    return false;
  }
}

/// Must run inside a user gesture (a click in the panel).
export async function requestAccess(url) {
  const o = originOf(url);
  if (!o) return false;
  try {
    return await chrome.permissions.request({ origins: [o] });
  } catch {
    return false;
  }
}

export const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url || "");

/// Console errors since the panel connected: hooked in the page's own world.
export async function hookConsole(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (key) => {
      if (window[key]) return;
      const list = (window[key] = []);
      const push = (text) => {
        list.push(String(text).slice(0, 300));
        if (list.length > 20) list.shift();
      };
      const orig = console.error;
      console.error = function (...a) {
        push(a.map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
        return orig.apply(this, a);
      };
      addEventListener("error", (e) => push(`${e.message} (${(e.filename || "").split("/").pop()}:${e.lineno})`));
      addEventListener("unhandledrejection", (e) => push(`Unhandled rejection: ${(e.reason && e.reason.message) || e.reason}`));
    },
    args: [CONSOLE_KEY],
  });
}

export async function readConsole(tabId) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: (key) => window[key] || [], args: [CONSOLE_KEY] });
  return (r && r.result) || [];
}

export async function startPicker(tabId, hint) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["page/picker.js"] });
  await chrome.tabs.sendMessage(tabId, { type: "picker:start", hint }).catch(() => {});
}

export const stopPicker = (tabId) => chrome.tabs.sendMessage(tabId, { type: "picker:stop" }).catch(() => {});
/// A small confirmation shown inside the page itself (it survives a reload because we inject after it).
export const toast = (tabId, text) =>
  chrome.scripting
    .executeScript({
      target: { tabId },
      func: (msg) => {
        const t = document.createElement("div");
        t.setAttribute("data-eco-picker", "");
        t.textContent = msg;
        Object.assign(t.style, { position: "fixed", zIndex: 2147483647, right: "16px", bottom: "16px", padding: "8px 12px", borderRadius: "10px", background: "#e0f2e8", color: "#14532d", font: "600 12.5px system-ui,sans-serif", boxShadow: "0 6px 20px rgba(0,0,0,.15)" });
        document.documentElement.append(t);
        setTimeout(() => t.remove(), 2600);
      },
      args: [text],
    })
    .catch(() => {});

export async function reloadTab(tabId) {
  await new Promise((resolve) => {
    const done = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(done);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(done);
    chrome.tabs.reload(tabId);
    setTimeout(() => (chrome.tabs.onUpdated.removeListener(done), resolve()), 15000);
  });
}

/// captureVisibleTab needs activeTab or <all_urls> (a per-site host permission is not enough).
/// activeTab covers the tab the user invoked us on; otherwise ask once, inside a user gesture.
export async function screenshot(windowId) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  } catch (e) {
    if (!/<all_urls>|activeTab/.test(String(e.message))) throw e;
    if (!(await chrome.permissions.request({ origins: ["<all_urls>"] }))) throw e;
    return chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  }
}

/// Crop a screenshot data URL to the picked rect (device pixels), with a little margin.
export async function crop(dataUrl, rect) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  const k = img.width / rect.vw;
  const m = 8;
  const x = Math.max(0, (rect.x - m) * k);
  const y = Math.max(0, (rect.y - m) * k);
  const w = Math.min(img.width - x, (rect.w + m * 2) * k);
  const hgt = Math.min(img.height - y, (rect.h + m * 2) * k);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(hgt));
  c.getContext("2d").drawImage(img, x, y, w, hgt, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

export async function downscale(dataUrl, maxW = 1280) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  if (img.width <= maxW) return dataUrl;
  const c = document.createElement("canvas");
  c.width = maxW;
  c.height = Math.round((img.height * maxW) / img.width);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

/// Which approved project owns this tab? hostname of a deploy, or the dev gateway port on localhost.
export function matchEstate(url, estates) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (isLocal(url)) {
    const port = Number(u.port);
    return estates.find((e) => (e.devPorts || []).includes(port)) || null;
  }
  const host = u.hostname.toLowerCase();
  return estates.find((e) => (e.hostnames || []).some((x) => x.toLowerCase() === host)) || estates.find((e) => e.serve && host === `${e.serve}.getecosphere.app`) || null;
}

/// <meta name="ecosphere-estate"> when we may read the page; hostname matching covers the rest.
export async function readEstateMeta(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => (document.querySelector('meta[name="ecosphere-estate"]') || {}).content || "" });
    return (r && r.result) || "";
  } catch {
    return "";
  }
}
