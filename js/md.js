// Renders the parsed Markdown as DOM (never innerHTML). New words can fade in: `age(i)` gives the age in
// ms of the i-th word of the text (null = settled), so a re-render of a growing text keeps each word's
// fade where it was instead of restarting it.
import { h } from "./dom.js";
import { parse } from "./md-parse.js";

const safeHref = (u) => (/^(https?:\/\/|mailto:)/i.test(u) ? u : "");

function words(v, ctx) {
  const out = [];
  for (const part of v.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      out.push(part);
      continue;
    }
    const age = ctx.age(ctx.n++);
    out.push(age == null ? part : h("span", { class: "w", style: { animationDelay: `-${Math.round(age)}ms` }, text: part }));
  }
  return out;
}

function inl(nodes, ctx) {
  return nodes.map((n) => {
    switch (n.t) {
      case "text":
        return words(n.v, ctx);
      case "code":
        return h("code", { text: n.v });
      case "b":
        return h("strong", {}, inl(n.c, ctx));
      case "i":
        return h("em", {}, inl(n.c, ctx));
      case "s":
        return h("del", {}, inl(n.c, ctx));
      case "br":
        return h("br");
      case "a": {
        const href = safeHref(n.href);
        return href ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, inl(n.c, ctx)) : inl(n.c, ctx);
      }
    }
    return null;
  });
}

function list(items, ctx) {
  const mk = (it) => h(it.ordered ? "ol" : "ul");
  const root = mk(items[0]);
  const stack = [{ depth: items[0].depth, el: root, last: null }];
  for (const it of items) {
    let top = stack[stack.length - 1];
    while (it.depth < top.depth && stack.length > 1) (stack.pop(), (top = stack[stack.length - 1]));
    if (it.depth > top.depth && top.last) {
      const l = mk(it);
      top.last.append(l);
      stack.push({ depth: it.depth, el: l, last: null });
      top = stack[stack.length - 1];
    }
    const li = h("li", {}, inl(it.c, ctx));
    top.el.append(li);
    top.last = li;
  }
  return root;
}

function block(n, ctx) {
  switch (n.t) {
    case "p":
      return h("p", {}, inl(n.c, ctx));
    case "h":
      return h(`h${Math.min(6, n.n + 2)}`, { class: "mdh" }, inl(n.c, ctx));
    case "pre":
      return h("pre", { class: "mdpre" }, h("code", { text: n.v }));
    case "hr":
      return h("hr");
    case "quote":
      return h("blockquote", {}, n.c.map((b) => block(b, ctx)));
    case "list":
      return list(n.items, ctx);
    case "table":
      return h("div", { class: "mdtable" }, h("table", {}, h("thead", {}, h("tr", {}, n.head.map((c) => h("th", {}, inl(c, ctx))))), h("tbody", {}, n.rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, inl(c, ctx))))))));
  }
  return null;
}

/// -> {node, words}
export function renderMarkdown(src, age = () => null) {
  const ctx = { n: 0, age };
  const node = h("div", { class: "mdbody" }, parse(src).map((b) => block(b, ctx)));
  return { node, words: ctx.n };
}
