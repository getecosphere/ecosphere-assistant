// Non-secret UI preferences only (theme, dock hint, last project, onboarding progress).
// Never a token, key or credential: signed in means the eco CLI on this machine is signed in.
const KEY = "prefs";
let cache = {};

export async function loadPrefs() {
  try {
    cache = (await chrome.storage.local.get(KEY))[KEY] || {};
  } catch {
    cache = {};
  }
  return cache;
}

export const pref = (k, d) => (cache[k] === undefined ? d : cache[k]);

export function setPref(k, v) {
  cache = { ...cache, [k]: v };
  chrome.storage.local.set({ [KEY]: cache }).catch(() => {});
}

export function applyTheme() {
  const th = pref("theme", "system");
  if (th === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", th);
}
