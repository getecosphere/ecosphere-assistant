// Injected on demand (chrome.scripting) into the active tab. Highlights the hovered element,
// reports the clicked one to the side panel, Esc cancels. Leaves no trace when stopped.
(() => {
  if (window.__ecoPicker) return window.__ecoPicker.start();
  const STYLES = ["color", "backgroundColor", "fontSize", "fontWeight", "fontFamily", "padding", "margin", "borderRadius", "display", "width", "height"];
  let box, label, hint, on = false, cur = null;

  const css = (el, s) => Object.assign(el.style, s);
  const mk = (tag, s) => {
    const el = document.createElement(tag);
    el.setAttribute("data-eco-picker", "");
    css(el, s);
    return el;
  };

  function selectorOf(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) {
        parts.unshift(`${s}#${CSS.escape(n.id)}`);
        break;
      }
      const cls = [...n.classList].slice(0, 2).map((c) => "." + CSS.escape(c)).join("");
      s += cls;
      if (!cls && n.parentElement) {
        const same = [...n.parentElement.children].filter((c) => c.tagName === n.tagName);
        if (same.length > 1) s += `:nth-of-type(${same.indexOf(n) + 1})`;
      }
      parts.unshift(s);
    }
    return parts.join(" > ");
  }

  const short = (el) => {
    const cls = [...el.classList].slice(0, 2).map((c) => "." + c).join("");
    return el.tagName.toLowerCase() + cls;
  };

  function move(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.hasAttribute("data-eco-picker")) return;
    cur = el;
    const r = el.getBoundingClientRect();
    css(box, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    label.textContent = `${short(el)} · ${Math.round(r.width)}×${Math.round(r.height)}`;
    css(label, { display: "block", left: Math.max(4, r.left) + "px", top: Math.max(4, r.top - 24) + "px" });
  }

  function pick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!cur) return;
    const el = cur;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const styles = {};
    for (const k of STYLES) styles[k] = cs[k];
    const html = el.outerHTML.length > 2000 ? el.outerHTML.slice(0, 2000) + "…" : el.outerHTML;
    stop();
    chrome.runtime.sendMessage({
      type: "picker:picked",
      data: {
        selector: selectorOf(el),
        short: short(el),
        text: (el.innerText || "").trim().slice(0, 120),
        html,
        styles,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height, dpr: window.devicePixelRatio, vw: innerWidth, vh: innerHeight },
        url: location.href,
      },
    });
  }

  function key(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stop();
      chrome.runtime.sendMessage({ type: "picker:cancel" });
    }
  }

  const swallow = (e) => {
    if (on) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  function start() {
    if (on) return;
    on = true;
    box = mk("div", { position: "fixed", zIndex: 2147483646, pointerEvents: "none", border: "2px solid #5b3fd6", borderRadius: "4px", background: "rgba(91,63,214,.08)", display: "none", boxSizing: "border-box" });
    label = mk("div", { position: "fixed", zIndex: 2147483647, pointerEvents: "none", padding: "2px 6px", borderRadius: "5px", background: "#5b3fd6", color: "#fff", font: "500 11px ui-monospace,Menlo,monospace", display: "none", whiteSpace: "nowrap" });
    hint = mk("div", { position: "fixed", zIndex: 2147483647, pointerEvents: "none", left: "50%", top: "14px", transform: "translateX(-50%)", padding: "8px 14px", borderRadius: "999px", background: "#17141d", color: "#f5f2fa", font: "600 13px system-ui,sans-serif" });
    hint.textContent = window.__ecoPickerHint || "Click an element · Esc to cancel";
    document.documentElement.append(box, label, hint);
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", pick, true);
    for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup"]) document.addEventListener(t, swallow, true);
    document.addEventListener("keydown", key, true);
  }

  function stop() {
    if (!on) return;
    on = false;
    cur = null;
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("click", pick, true);
    for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup"]) document.removeEventListener(t, swallow, true);
    document.removeEventListener("keydown", key, true);
    box.remove();
    label.remove();
    hint.remove();
  }

  function toast(text) {
    const t = mk("div", { position: "fixed", zIndex: 2147483647, right: "16px", bottom: "16px", padding: "8px 12px", borderRadius: "10px", background: "#e0f2e8", color: "#14532d", font: "600 12.5px system-ui,sans-serif", boxShadow: "0 6px 20px rgba(0,0,0,.15)" });
    t.textContent = text;
    document.documentElement.append(t);
    setTimeout(() => t.remove(), 2600);
  }

  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.type === "picker:start") {
      window.__ecoPickerHint = m.hint;
      start();
      if (m.hint && hint) hint.textContent = m.hint;
    } else if (m && m.type === "picker:stop") stop();
    else if (m && m.type === "page:toast") toast(m.text);
  });

  window.__ecoPicker = { start, stop };
  start();
})();
