// Block-level Markdown parser + safe HTML renderer (port of MarkdownParser.swift).
import { lex } from "./lexer.js";

export function parse(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0, para = [];
  const flush = () => { if (para.length) { blocks.push({ type: "paragraph", text: para.join("\n") }); para = []; } };
  while (i < lines.length) {
    const line = lines[i], tr = line.trim();
    if (tr.startsWith("```") || tr.startsWith("~~~")) {
      flush();
      const fence = tr.slice(0, 3), lang = tr.slice(3).trim().toLowerCase();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i++]);
      i++;
      blocks.push({ type: "code", language: lang, code: code.join("\n") });
      continue;
    }
    if (!tr) { flush(); i++; continue; }
    const h = tr.match(/^(#{1,6})(\s+(.*))?$/);
    if (h) { flush(); blocks.push({ type: "heading", level: h[1].length, text: (h[3] || "").trim() }); i++; continue; }
    if (/^([-*_])(\s*\1){2,}\s*$/.test(tr)) { flush(); blocks.push({ type: "divider" }); i++; continue; }
    if (tr.startsWith(">")) {
      flush();
      const q = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) q.push(lines[i++].trim().slice(1).replace(/^ /, ""));
      const m = q[0].match(/^\[!(\w+)\]\s*(.*)$/);
      if (m) blocks.push({ type: "callout", kind: m[1].toLowerCase(), text: [m[2], ...q.slice(1)].filter(Boolean).join("\n") });
      else blocks.push({ type: "quote", text: q.join("\n") });
      continue;
    }
    if (tr.startsWith("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1])) {
      flush();
      const row = (r) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const header = row(tr);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(row(lines[i++]));
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const lm = listMarker(line);
    if (lm) {
      flush();
      const items = [];
      while (i < lines.length) {
        const m = listMarker(lines[i]);
        if (!m || (m.ordered !== lm.ordered && m.indent === 0)) break;
        let text = m.text, checked = null;
        const t = text.match(/^\[( |x|X)\]\s?(.*)$/);
        if (t) { checked = t[1] !== " "; text = t[2]; }
        items.push({ text, indent: m.indent, checked });
        i++;
        while (i < lines.length && lines[i].trim() && !listMarker(lines[i]) && lines[i].startsWith("  ")) items[items.length - 1].text += " " + lines[i++].trim();
      }
      blocks.push(lm.ordered ? { type: "ordered", start: lm.number, items } : { type: "bullets", items });
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return blocks;
}

function listMarker(line) {
  const m = line.match(/^([ \t]*)([-*+]|(\d{1,9})[.)])\s+(.*)$/);
  if (!m) return null;
  const indent = Math.floor(m[1].replace(/\t/g, "    ").length / 2);
  return { ordered: !!m[3], number: m[3] ? parseInt(m[3], 10) : 0, indent, text: m[4] };
}

export const stripInline = (s) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*|__|~~|`/g, "");

export function suggestedTitle(source) {
  for (const b of parse(source)) {
    if (b.type === "heading" && b.text) return stripInline(b.text);
    if (b.type === "paragraph") { const s = stripInline(b.text.split("\n")[0]).trim(); if (s) return s.slice(0, 60); }
  }
  return null;
}

export function plainText(source) {
  return parse(source).map((b) => {
    switch (b.type) {
      case "heading": case "paragraph": case "quote": return stripInline(b.text);
      case "bullets": return b.items.map((it) => "  ".repeat(it.indent) + (it.checked === null ? "• " : it.checked ? "☑ " : "☐ ") + stripInline(it.text)).join("\n");
      case "ordered": return b.items.map((it, k) => `${b.start + k}. ${stripInline(it.text)}`).join("\n");
      case "code": return b.code;
      case "callout": return b.kind.toUpperCase() + ": " + stripInline(b.text);
      case "table": return [b.header, ...b.rows].map((r) => r.join("\t")).join("\n");
      default: return "———";
    }
  }).join("\n\n");
}

// ---------------- HTML rendering (everything escaped first → XSS safe)

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function inline(s) {
  let h = esc(s);
  const codes = [];
  h = h.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  h = h.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
  h = h.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  h = h.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  h = h.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/\u0000(\d+)\u0000/g, (_, k) => `<code>${codes[+k]}</code>`);
  return h.replace(/\n/g, "<br>");
}

export function highlightCSharp(code) {
  const { tokens } = lex(code);
  let out = "", pos = 0;
  for (const t of tokens) {
    if (t.location > pos) out += esc(code.slice(pos, t.location));
    const txt = esc(code.slice(t.location, t.end));
    out += t.kind === "whitespace" || t.kind === "identifier" ? txt : `<span class="tk-${t.kind}">${txt}</span>`;
    pos = t.end;
  }
  return out + esc(code.slice(pos));
}

export function renderHTML(source) {
  return parse(source).map((b) => {
    switch (b.type) {
      case "heading": return `<h${b.level}>${inline(b.text)}</h${b.level}>`;
      case "paragraph": return `<p>${inline(b.text)}</p>`;
      case "bullets": return `<ul>${b.items.map((it) => `<li class="${it.checked === null ? "" : it.checked ? "task done" : "task"}" style="margin-left:${it.indent * 18}px">${it.checked === null ? "" : `<span class="box">${it.checked ? "✓" : ""}</span>`}${inline(it.text)}</li>`).join("")}</ul>`;
      case "ordered": return `<ol start="${b.start}">${b.items.map((it) => `<li style="margin-left:${it.indent * 18}px">${inline(it.text)}</li>`).join("")}</ol>`;
      case "code": {
        const cs = ["csharp", "cs", "c#", "unity", ""].includes(b.language);
        return `<div class="codeblock"><div class="codeblock-head"><span>${esc(b.language || "code")}</span><button class="copy-code" data-code="${esc(b.code)}">Kopieren</button></div><pre><code>${cs ? highlightCSharp(b.code) : esc(b.code)}</code></pre></div>`;
      }
      case "quote": return `<blockquote>${inline(b.text)}</blockquote>`;
      case "callout": return `<div class="callout callout-${esc(b.kind)}"><b>${esc(b.kind.toUpperCase())}</b><div>${inline(b.text)}</div></div>`;
      case "table": return `<div class="table-wrap"><table><thead><tr>${b.header.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      default: return "<hr>";
    }
  }).join("\n");
}
