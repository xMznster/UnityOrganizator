// Pure editing helpers for the code editor (port of EditorAssist.swift). Offsets are string indices.
import { lex } from "./lexer.js";

const lineStartOf = (text, pos) => text.lastIndexOf("\n", pos - 1) + 1;
const lineEndOf = (text, pos) => { const i = text.indexOf("\n", pos); return i < 0 ? text.length : i; };

export function lineIndent(text, pos) {
  const s = lineStartOf(text, pos);
  let e = s;
  while (e < text.length && (text[e] === " " || text[e] === "\t")) e++;
  return text.slice(s, e);
}

/** Edit = {from, to, insert, caret} */
export function newlineEdit(text, from, to, unit) {
  const indent = lineIndent(text, from);
  const ls = lineStartOf(text, from);
  let p = from - 1, prev = "";
  while (p >= ls) { if (text[p] !== " " && text[p] !== "\t") { prev = text[p]; break; } p--; }
  let q = to, next = "";
  while (q < text.length) { const c = text[q]; if (c === " " || c === "\t") { q++; continue; } if (c !== "\n") next = c; break; }
  const opens = prev === "{" || prev === "(" || prev === "[";
  const pair = (prev === "{" && next === "}") || (prev === "(" && next === ")") || (prev === "[" && next === "]");
  if (opens && pair) {
    const inner = "\n" + indent + unit;
    return { from, to, insert: inner + "\n" + indent, caret: from + inner.length };
  }
  const ins = "\n" + indent + (opens ? unit : "");
  return { from, to, insert: ins, caret: from + ins.length };
}

export function matchingOpenBrace(text, before) {
  const { tokens } = lex(text.slice(0, before));
  let depth = 0;
  for (let k = tokens.length - 1; k >= 0; k--) {
    const t = tokens[k];
    if (t.kind !== "punctuation") continue;
    if (t.text === "}") depth++;
    else if (t.text === "{") { if (depth === 0) return t.location; depth--; }
  }
  return null;
}

export function closingBraceEdit(text, from, to, unit) {
  const ls = lineStartOf(text, from);
  const before = text.slice(ls, from);
  if (!before || !/^[ \t]*$/.test(before)) return null;
  const open = matchingOpenBrace(text, from);
  let target;
  if (open !== null) target = lineIndent(text, open);
  else target = before.endsWith(unit) ? before.slice(0, -unit.length) : before.endsWith("\t") ? before.slice(0, -1) : before;
  return { from: ls, to, insert: target + "}", caret: ls + target.length + 1 };
}

export function bracketPair(tokens, caret) {
  let idx = -1;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind !== "punctuation" || !"()[]{}".includes(t.text)) continue;
    if (t.location === caret - 1) { idx = k; break; }
    if (t.location === caret) idx = k;
    if (t.location > caret) break;
  }
  if (idx < 0) return null;
  const pairs = { "(": ")", "[": "]", "{": "}", ")": "(", "]": "[", "}": "{" };
  const s = tokens[idx].text, target = pairs[s], forward = "([{".includes(s);
  let depth = 0;
  for (let k = forward ? idx + 1 : idx - 1; forward ? k < tokens.length : k >= 0; k += forward ? 1 : -1) {
    const t = tokens[k];
    if (t.kind !== "punctuation") continue;
    if (t.text === s) depth++;
    else if (t.text === target) {
      if (depth === 0) return forward ? [tokens[idx].location, t.location] : [t.location, tokens[idx].location];
      depth--;
    }
  }
  return null;
}

function linesRange(text, from, to) {
  const s = lineStartOf(text, from);
  let e = lineEndOf(text, Math.max(from, to - (to > from && text[to - 1] === "\n" ? 1 : 0)));
  return [s, e];
}

export function toggleLineComment(text, from, to) {
  const [s, e] = linesRange(text, from, to);
  const parts = text.slice(s, e).split("\n");
  const nonEmpty = parts.filter((l) => l.trim());
  const all = nonEmpty.length > 0 && nonEmpty.every((l) => l.trim().startsWith("//"));
  const minIndent = Math.min(...nonEmpty.map((l) => l.match(/^[ \t]*/)[0].length), Infinity);
  const out = parts.map((l) => {
    if (!l.trim()) return l;
    if (all) return l.replace(/\/\/ ?/, "");
    return l.slice(0, minIndent) + "// " + l.slice(minIndent);
  }).join("\n");
  return { from: s, to: e, insert: out, select: [s, s + out.length] };
}

export function shiftLines(text, from, to, unit, outdent) {
  const [s, e] = linesRange(text, from, to);
  const out = text.slice(s, e).split("\n").map((l) => {
    if (outdent) return l.startsWith(unit) ? l.slice(unit.length) : l.startsWith("\t") ? l.slice(1) : l.replace(/^ +/, "");
    return l ? unit + l : l;
  }).join("\n");
  return { from: s, to: e, insert: out, select: [s, s + out.length] };
}

export function autoPair(ch, nextChar) {
  if (nextChar && /[A-Za-z0-9_]/.test(nextChar)) return null;
  return { "(": "()", "[": "[]", "{": "{}", '"': '""' }[ch] || null;
}

export function reindent(source, unit) {
  const { tokens, lineStarts } = lex(source);
  const lineCount = lineStarts.length;
  const depthAt = new Array(lineCount + 2).fill(0);
  const firstClose = new Array(lineCount + 2).fill(false);
  const seen = new Array(lineCount + 2).fill(false);
  const protectedLines = new Set();
  const stack = [];
  const depth = () => new Set(stack).size;
  let cur = 1;
  for (const t of tokens) {
    if (t.kind === "whitespace") continue;
    while (cur < t.line) { cur++; depthAt[cur] = depth(); }
    if (t.kind === "comment" || t.kind === "docComment" || t.kind === "string") {
      const n = source.slice(t.location, t.end).split("\n").length;
      for (let l = t.line + 1; l < t.line + n; l++) protectedLines.add(l);
    }
    if (!seen[t.line]) { seen[t.line] = true; if (t.kind === "punctuation" && ")]}".includes(t.text)) firstClose[t.line] = true; }
    if (t.kind === "punctuation") {
      if ("([{".includes(t.text)) stack.push(t.line);
      else if (")]}".includes(t.text)) stack.pop();
    }
  }
  while (cur < lineCount) { cur++; depthAt[cur] = depth(); }
  return source.split("\n").map((line, i) => {
    const no = i + 1;
    if (protectedLines.has(no)) return line;
    const tr = line.trim();
    if (!tr) return "";
    if (tr.startsWith("#")) return tr;
    let d = depthAt[no] || 0;
    if (firstClose[no]) d = Math.max(0, d - 1);
    return unit.repeat(d) + tr;
  }).join("\n");
}

/** Markdown list continuation: returns marker for next line, "" to end list, null if not a list. */
export function listContinuation(text, pos) {
  const line = text.slice(lineStartOf(text, pos), pos);
  const m = line.match(/^([ \t]*)(- \[[ xX]\] |[-*+] |(\d+)\. )(.*)$/);
  if (!m) return null;
  if (!m[4]) return "";
  if (m[3]) return m[1] + (parseInt(m[3], 10) + 1) + ". ";
  return m[1] + (m[2].startsWith("- [") ? "- [ ] " : m[2]);
}
