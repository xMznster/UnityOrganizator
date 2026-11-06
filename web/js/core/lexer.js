// C# lexer (port of CSharpLexer.swift). Offsets are UTF-16 code units = JS string indices.
import { knownTypes } from "./catalog.js";

export const keywords = new Set(["abstract", "as", "base", "bool", "break", "byte", "case", "catch", "char", "checked",
  "class", "const", "continue", "decimal", "default", "delegate", "do", "double", "else", "enum", "event", "explicit",
  "extern", "false", "finally", "fixed", "float", "for", "foreach", "goto", "if", "implicit", "in", "int", "interface",
  "internal", "is", "lock", "long", "namespace", "new", "null", "object", "operator", "out", "override", "params",
  "private", "protected", "public", "readonly", "ref", "return", "sbyte", "sealed", "short", "sizeof", "stackalloc",
  "static", "string", "struct", "switch", "this", "throw", "true", "try", "typeof", "uint", "ulong", "unchecked",
  "unsafe", "ushort", "using", "virtual", "void", "volatile", "while"]);

export const contextualKeywords = new Set(["add", "and", "alias", "ascending", "async", "await", "by", "descending",
  "dynamic", "equals", "file", "from", "get", "global", "group", "init", "into", "join", "let", "managed", "nameof",
  "nint", "not", "notnull", "nuint", "on", "or", "orderby", "partial", "record", "remove", "required", "scoped",
  "select", "set", "unmanaged", "value", "var", "when", "where", "with", "yield"]);

export const builtinTypeKeywords = new Set(["bool", "byte", "char", "decimal", "double", "float", "int", "long", "object",
  "sbyte", "short", "string", "uint", "ulong", "ushort", "void", "var", "dynamic", "nint", "nuint"]);

const OPS = [">>>=", "<<=", "??=", "...", "=>", "==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=",
  "/=", "%=", "&=", "|=", "^=", "->", "??", "::", "..", "+", "-", "*", "/", "%", "&", "|", "^", "!", "~", "=", "<", ">", "?", "@", "$"];

const isIdentStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c > 127;
const isIdentPart = (c) => isIdentStart(c) || (c >= 48 && c <= 57);
const isDigit = (c) => c >= 48 && c <= 57;
const isHex = (c) => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isWS = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 || c === 0xa0 || c === 0xfeff;

export const TRIVIA = new Set(["whitespace", "comment", "docComment", "preprocessor"]);

/** @returns {{tokens: Array<{kind,location,length,line,column,text,end}>, issues: Array, lineStarts: number[]}} */
export function lex(src) {
  const n = src.length;
  const tokens = [];
  const issues = [];
  const lineStarts = [0];
  let i = 0, line = 1, lineStart = 0, atLineStart = true;
  const cc = (k) => src.charCodeAt(k);

  const noteNewlines = (a, b) => {
    for (let k = a; k < b; k++) {
      const c = cc(k);
      if (c === 10) { line++; lineStart = k + 1; lineStarts.push(k + 1); }
      else if (c === 13) {
        if (k + 1 < b && cc(k + 1) === 10) k++;
        line++; lineStart = k + 1; lineStarts.push(k + 1);
      }
    }
  };
  const push = (kind, start, end, sl, sc, keepText = true) =>
    tokens.push({ kind, location: start, length: end - start, end, line: sl, column: sc, text: keepText ? src.slice(start, end) : "" });
  const issue = (message, location, l, c, ruleID) => issues.push({ message, location, line: l, column: c, ruleID });

  const lexString = (q, verbatim, interpolated, start, sl, sc) => {
    let run = 0;
    while (q + run < n && cc(q + run) === 34) run++;
    if (run >= 3) {
      let j = q + run;
      while (j < n) {
        if (cc(j) === 34) {
          let r = 0;
          while (j + r < n && cc(j + r) === 34) r++;
          if (r >= run) return j + r;
          j += r;
        } else j++;
      }
      issue("Raw-String-Literal wird nicht geschlossen.", start, sl, sc, "LEX001");
      return n;
    }
    let j = q + 1, depth = 0;
    while (j < n) {
      const d = cc(j);
      if (interpolated && depth > 0) {
        if (d === 123) depth++;
        else if (d === 125) depth--;
        else if (d === 34) { let k = j + 1; while (k < n && cc(k) !== 34 && cc(k) !== 10) { if (cc(k) === 92) k++; k++; } j = k; }
        else if ((d === 10 || d === 13) && !verbatim) break;
        j++; continue;
      }
      if (!verbatim && d === 92) { j += 2; continue; }
      if (d === 34) {
        if (verbatim && j + 1 < n && cc(j + 1) === 34) { j += 2; continue; }
        return j + 1;
      }
      if (interpolated && d === 123) {
        if (j + 1 < n && cc(j + 1) === 123) { j += 2; continue; }
        depth = 1; j++; continue;
      }
      if (!verbatim && (d === 10 || d === 13)) break;
      j++;
    }
    issue('String-Literal wird nicht geschlossen (" fehlt).', start, sl, sc, "LEX001");
    return Math.min(j, n);
  };

  while (i < n) {
    const c = cc(i), start = i, sl = line, sc = i - lineStart + 1;
    if (isWS(c)) {
      let j = i, nl = false;
      while (j < n && isWS(cc(j))) { if (cc(j) === 10 || cc(j) === 13) nl = true; j++; }
      noteNewlines(i, j);
      push("whitespace", start, j, sl, sc, false);
      if (nl) atLineStart = true;
      i = j; continue;
    }
    if (c === 35 && atLineStart) {
      let j = i; while (j < n && cc(j) !== 10 && cc(j) !== 13) j++;
      push("preprocessor", start, j, sl, sc);
      i = j; continue;
    }
    atLineStart = false;
    if (c === 47 && i + 1 < n) {
      if (cc(i + 1) === 47) {
        let j = i; while (j < n && cc(j) !== 10 && cc(j) !== 13) j++;
        const doc = i + 2 < n && cc(i + 2) === 47 && !(i + 3 < n && cc(i + 3) === 47);
        push(doc ? "docComment" : "comment", start, j, sl, sc, false);
        i = j; continue;
      }
      if (cc(i + 1) === 42) {
        let j = i + 2, closed = false;
        while (j < n) { if (cc(j) === 42 && j + 1 < n && cc(j + 1) === 47) { j += 2; closed = true; break; } j++; }
        if (!closed) issue("Block-Kommentar wird nicht geschlossen (*/ fehlt).", start, sl, sc, "LEX003");
        noteNewlines(i, j);
        push("comment", start, j, sl, sc, false);
        i = j; continue;
      }
    }
    if (c === 34 || ((c === 64 || c === 36) && i + 1 < n)) {
      let j = i, verbatim = false, interp = false;
      while (j < n && (cc(j) === 64 || cc(j) === 36) && j - i < 6) { if (cc(j) === 64) verbatim = true; else interp = true; j++; }
      if (j < n && cc(j) === 34) {
        const end = lexString(j, verbatim, interp, start, sl, sc);
        noteNewlines(i, end);
        push("string", start, end, sl, sc);
        i = end; continue;
      } else if (c === 64 && j === i + 1 && j < n && isIdentStart(cc(j))) {
        let k = j; while (k < n && isIdentPart(cc(k))) k++;
        push("identifier", start, k, sl, sc);
        i = k; continue;
      }
    }
    if (c === 39) {
      let j = i + 1, closed = false;
      while (j < n) {
        const d = cc(j);
        if (d === 92) { j += 2; continue; }
        if (d === 39) { j++; closed = true; break; }
        if (d === 10 || d === 13) break;
        j++;
      }
      j = Math.min(j, n);
      if (!closed) issue("Zeichenliteral wird nicht geschlossen (' fehlt).", start, sl, sc, "LEX002");
      else if (j - i === 2) issue("Leeres Zeichenliteral ''.", start, sl, sc, "LEX004");
      push("char", start, j, sl, sc);
      i = j; continue;
    }
    if (isDigit(c) || (c === 46 && i + 1 < n && isDigit(cc(i + 1)))) {
      let j = i;
      if (c === 48 && i + 1 < n && (cc(i + 1) === 120 || cc(i + 1) === 88)) { j += 2; while (j < n && (isHex(cc(j)) || cc(j) === 95)) j++; }
      else if (c === 48 && i + 1 < n && (cc(i + 1) === 98 || cc(i + 1) === 66)) { j += 2; while (j < n && (cc(j) === 48 || cc(j) === 49 || cc(j) === 95)) j++; }
      else {
        while (j < n && (isDigit(cc(j)) || cc(j) === 95)) j++;
        if (j < n && cc(j) === 46 && j + 1 < n && isDigit(cc(j + 1))) { j++; while (j < n && (isDigit(cc(j)) || cc(j) === 95)) j++; }
        if (j < n && (cc(j) === 101 || cc(j) === 69)) {
          let k = j + 1;
          if (k < n && (cc(k) === 43 || cc(k) === 45)) k++;
          if (k < n && isDigit(cc(k))) { j = k; while (j < n && isDigit(cc(j))) j++; }
        }
      }
      while (j < n && "fFdDmMuUlL".includes(src[j])) j++;
      push("number", start, j, sl, sc);
      i = j; continue;
    }
    if (isIdentStart(c)) {
      let j = i; while (j < n && isIdentPart(cc(j))) j++;
      const w = src.slice(i, j);
      const kind = keywords.has(w) ? "keyword" : contextualKeywords.has(w) ? "contextualKeyword" : "identifier";
      tokens.push({ kind, location: start, length: j - i, end: j, line: sl, column: sc, text: w });
      i = j; continue;
    }
    let opLen = 0;
    for (const op of OPS) {
      if (src.startsWith(op, i)) {
        if (op[0] === ">" && op.length >= 3 && op[1] === ">") continue;
        opLen = op.length; break;
      }
    }
    if (opLen) { push("operator", start, i + opLen, sl, sc); i += opLen; continue; }
    if ("{}()[];,.:".includes(src[i])) { push("punctuation", start, i + 1, sl, sc); i++; continue; }
    issue(`Unerwartetes Zeichen '${src[i]}'.`, start, sl, sc, "LEX005");
    push("invalid", start, i + 1, sl, sc);
    i++;
  }
  const result = { tokens, issues, lineStarts };
  classifyIdentifiers(result);
  return result;
}

export const isTypeLike = (s) => s.length > 0 && s[0] >= "A" && s[0] <= "Z";

function classifyIdentifiers(result) {
  const toks = result.tokens;
  const sig = [];
  for (let k = 0; k < toks.length; k++) if (!TRIVIA.has(toks[k].kind)) sig.push(k);
  const declared = new Set();
  for (let s = 0; s < sig.length; s++) {
    const t = toks[sig[s]];
    if ((t.kind === "keyword" && ["class", "struct", "interface", "enum", "delegate"].includes(t.text)) || (t.kind === "contextualKeyword" && t.text === "record")) {
      let k = s + 1;
      if (t.text === "delegate") while (k + 1 < sig.length && toks[sig[k + 1]].text !== "(" && toks[sig[k + 1]].text !== ";") k++;
      if (k < sig.length && toks[sig[k]].kind === "identifier") declared.add(toks[sig[k]].text);
    }
  }
  let bracketDepth = 0, attrDepth = null;
  for (let s = 0; s < sig.length; s++) {
    const idx = sig[s], t = toks[idx];
    if (t.text === "[" && t.kind === "punctuation") {
      bracketDepth++;
      const prev = s > 0 ? toks[sig[s - 1]].text : ";";
      if (attrDepth === null && (s === 0 || [";", "{", "}", "]"].includes(prev))) attrDepth = bracketDepth;
      continue;
    }
    if (t.text === "]" && t.kind === "punctuation") {
      if (attrDepth === bracketDepth) attrDepth = null;
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (t.kind !== "identifier") continue;
    const prev = s > 0 ? toks[sig[s - 1]] : null;
    const next = s + 1 < sig.length ? toks[sig[s + 1]] : null;
    if (attrDepth !== null && attrDepth === bracketDepth && prev && (prev.text === "[" || prev.text === ",")) { t.kind = "attribute"; continue; }
    if (declared.has(t.text) || knownTypes.has(t.text)) { t.kind = "typeName"; continue; }
    if (next && next.text === "(") { t.kind = prev && prev.text === "new" ? "typeName" : "methodName"; continue; }
    if (prev && (prev.text === "new" || (prev.text === ":" && isTypeLike(t.text)))) { t.kind = "typeName"; continue; }
    if (next && next.text === "<" && isTypeLike(t.text)) { t.kind = "typeName"; continue; }
    if (next && (next.kind === "identifier" || next.kind === "contextualKeyword") && isTypeLike(t.text) && !(prev && prev.text === ".")) t.kind = "typeName";
  }
}
