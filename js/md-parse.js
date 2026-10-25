// Small, safe Markdown parser for the agent's replies. Pure: text in, a tree out (no DOM, no HTML).
// Covers what coding agents write: headings, paragraphs, lists (nested), fenced code, inline code,
// bold/italic/strike, links, quotes, rules and pipe tables. Unclosed markers stay literal, so a
// half-streamed reply never breaks.

const INLINE = [
  { re: /`([^`\n]+)`/, make: (m) => ({ t: "code", v: m[1] }) },
  { re: /\*\*([^\n]+?)\*\*/, make: (m) => ({ t: "b", c: inline(m[1]) }) },
  { re: /__([^\n]+?)__/, make: (m) => ({ t: "b", c: inline(m[1]) }) },
  { re: /~~([^\n]+?)~~/, make: (m) => ({ t: "s", c: inline(m[1]) }) },
  { re: /\[([^\]\n]+)\]\(([^)\s]+)\)/, make: (m) => ({ t: "a", href: m[2], c: inline(m[1]) }) },
  { re: /\*([^*\s][^*\n]*?)\*/, make: (m) => ({ t: "i", c: inline(m[1]) }) },
  { re: /(?<![\w])_([^_\s][^_\n]*?)_(?![\w])/, make: (m) => ({ t: "i", c: inline(m[1]) }) },
];

export function inline(src) {
  const out = [];
  let rest = src;
  while (rest) {
    let best = null;
    for (const p of INLINE) {
      const m = p.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { m, p };
    }
    if (!best) break;
    if (best.m.index > 0) out.push({ t: "text", v: rest.slice(0, best.m.index) });
    out.push(best.p.make(best.m));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  if (rest) out.push({ t: "text", v: rest });
  return out;
}

const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function parse(src) {
  const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push({ t: "pre", lang: fence[2], v: body.join("\n") });
      continue;
    }
    const hd = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (hd) {
      out.push({ t: "h", n: hd[1].length, c: inline(hd[2]) });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push({ t: "quote", c: parse(q.join("\n")) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line).map(inline);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]).map(inline));
      out.push({ t: "table", head, rows });
      continue;
    }
    if (LI.test(line)) {
      const items = [];
      while (i < lines.length && (LI.test(lines[i]) || (/^\s+\S/.test(lines[i]) && items.length))) {
        const m = lines[i].match(LI);
        if (m) items.push({ depth: Math.floor(m[1].replace(/\t/g, "  ").length / 2), ordered: /\d/.test(m[2]), c: inline(m[3]) });
        else items[items.length - 1].c.push({ t: "text", v: " " }, ...inline(lines[i].trim()));
        i++;
      }
      out.push({ t: "list", items });
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !LI.test(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))) para.push(lines[i++]);
    if (!para.length) {
      para.push(lines[i++]);
    }
    out.push({ t: "p", c: para.flatMap((l, k) => (k ? [{ t: "br" }, ...inline(l)] : inline(l))) });
  }
  return out;
}
