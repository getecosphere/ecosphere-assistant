// t(key, english, vars): English is the inline default; other languages resolve by key from
// js/locales/<lang>.json (added later) and fall back to the English text.
let catalog = {};
let lang = "en";

export async function initLang(code) {
  lang = code || "en";
  if (lang === "en") return;
  try {
    catalog = await (await fetch(chrome.runtime.getURL(`js/locales/${lang}.json`))).json();
  } catch {
    catalog = {};
  }
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}

export function t(key, en, vars) {
  let s = catalog[key] || en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export const currentLang = () => lang;
