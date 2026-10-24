// Shared state for the panel. Views read S and call the helpers; subscribe() re-renders on change.
import * as bridge from "./bridge.js";
import { OpenCode } from "./oc.js";
import { pref, setPref } from "./prefs.js";
import { activeTab, matchEstate, isLocal } from "./page.js";

export const S = {
  helper: null, // hello payload when the helper answers
  helperError: "",
  who: null, // {signedIn, email, tier}
  estates: [], // approved projects
  active: null, // the estate the panel works on
  tab: null, // active browser tab {id, url, windowId}
  tabEstate: null, // estate that owns that tab
  oc: null,
  ocError: "",
  pm: null, // eco pm status of the active project
  view: "agent",
};

const subs = new Set();
export const subscribe = (fn) => (subs.add(fn), () => subs.delete(fn));
export const notify = () => subs.forEach((fn) => fn());

export const flags = () => ({ pm: pref("pm", false) || Boolean(S.pm && S.pm.linked) });

export const call = (action, args, opts) => bridge.request(action, args, opts);

export async function refreshHelper() {
  try {
    S.helper = await call("hello");
    S.helperError = "";
  } catch (e) {
    S.helper = null;
    S.helperError = e.message;
  }
  notify();
  return S.helper;
}

export async function refreshWho() {
  try {
    S.who = await call("eco.whoami");
  } catch {
    S.who = null;
  }
  notify();
  return S.who;
}

export async function refreshEstates() {
  try {
    S.estates = (await call("estate.list")).estates;
  } catch {
    S.estates = [];
  }
  if (S.active && !S.estates.find((e) => e.dir === S.active.dir)) S.active = null;
  if (!S.active && S.estates.length) {
    const last = pref("project", "");
    S.active = S.estates.find((e) => e.dir === last) || S.estates[0];
  }
  notify();
}

export async function refreshPm() {
  S.pm = null;
  if (S.active) {
    try {
      S.pm = await call("eco.pm.status", { dir: S.active.dir });
    } catch {
      S.pm = null;
    }
  }
  notify();
}

/// The folder the agent works from: the one the user chose (often a parent of the estate), never guessed.
export const workDir = (e = S.active) => (e ? e.root || e.dir : "");
/// True while there is a folder above the estate to choose from and the user has not chosen yet.
export const needsRoot = (e = S.active) => Boolean(e && !e.root && e.ancestors && e.ancestors.length);

export async function setRoot(root) {
  await call("workspace.set", { dir: S.active.dir, root });
  const dir = S.active.dir;
  S.oc = null;
  S.ocError = "";
  S.rootAsk = false;
  await refreshEstates();
  S.active = S.estates.find((e) => e.dir === dir) || S.active;
  notify();
}

export async function selectProject(dir, { auto = false } = {}) {
  const e = S.estates.find((x) => x.dir === dir);
  if (!e || (S.active && S.active.dir === dir)) return;
  if (S.oc && S.oc.dir !== workDir(e)) S.oc = null;
  S.active = e;
  S.ocError = "";
  if (!auto) setPref("project", dir);
  notify();
  refreshPm();
}

/// The active tab, and which project owns it. A matching project is switched to automatically.
export async function refreshTab() {
  const tab = await activeTab().catch(() => null);
  S.tab = tab ? { id: tab.id, url: tab.url, windowId: tab.windowId, title: tab.title } : null;
  S.tabEstate = tab ? matchEstate(tab.url, S.estates) : null;
  if (S.tabEstate && (!S.active || S.active.dir !== S.tabEstate.dir)) await selectProject(S.tabEstate.dir, { auto: true });
  notify();
}

/// Starts (or reuses) this project's OpenCode server through the helper and returns the client.
let ocStarting = null;
export async function ensureOpenCode() {
  if (!S.active) throw new Error("no project");
  if (needsRoot()) throw Object.assign(new Error("choose the folder you work from first"), { code: "root" });
  const dir = workDir();
  if (S.oc && S.oc.dir === dir) return S.oc;
  // one start at a time: concurrent callers share it (two servers would split session and events)
  if (!ocStarting || ocStarting.dir !== dir) {
    const p = (async () => {
      try {
        const { port, password } = await call("oc.start", { dir: S.active.dir });
        const oc = new OpenCode({ port, password, dir });
        await oc.health();
        S.oc = oc;
        S.ocError = "";
        return oc;
      } catch (e) {
        S.oc = null;
        S.ocError = e.message;
        throw e;
      } finally {
        ocStarting = null;
        notify();
      }
    })();
    ocStarting = Object.assign(p, { dir });
  }
  return ocStarting;
}

export const gateTier = () => {
  const t = (S.who && S.who.tier) || "";
  return t && !["local", "free", "serve"].includes(t) ? "paid" : "free";
};

export { isLocal };
