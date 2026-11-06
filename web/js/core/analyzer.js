// On-device C#/Unity analyzer (port of CSharpAnalyzer.swift).
// Stages: lexer → bracket matching → recovering structural parser → C# heuristics → Unity rules.
// It does NOT resolve symbols against Unity assemblies and does NOT emit IL (see PC companion).
import { lex, TRIVIA, builtinTypeKeywords, isTypeLike } from "./lexer.js";
import * as U from "./catalog.js";

export const CHECKS = [
  { name: "Lexikalische Analyse", detail: "Strings, Zeichen, Kommentare, ungültige Zeichen", performed: true },
  { name: "Klammerstruktur", detail: "( ) [ ] { } inkl. Position fehlender Klammern", performed: true },
  { name: "Syntaxstruktur", detail: "Deklarationen, Anweisungen, fehlende Semikolons, Code außerhalb von Methoden", performed: true },
  { name: "C#-Heuristiken", detail: "Zuweisung in Bedingung, leere Anweisungen/catch, Endlosschleifen, doppelte Member, fehlende usings", performed: true },
  { name: "Unity-Regeln", detail: "Message-Signaturen, Performance in Update, CS1612, Coroutines, UnityEditor, Dateiname", performed: true },
  { name: "Typauflösung gegen Unity-DLLs", detail: "Nur mit PC-Companion (Roslyn) möglich", performed: false },
  { name: "IL-Kompilierung", detail: "Im Browser/auf iOS nicht möglich – PC-Companion verwenden", performed: false },
];

export const SOURCE_NAMES = { lexer: "Lexer", syntax: "Syntax", csharp: "C#-Analyse", unity: "Unity-Regeln", compiler: "Roslyn-Compiler" };
const RANK = { error: 0, warning: 1, info: 2 };

const MODIFIERS = new Set(["public", "private", "protected", "internal", "static", "readonly", "const", "virtual", "override",
  "abstract", "sealed", "extern", "unsafe", "volatile", "async", "partial", "new", "required", "file", "ref", "fixed"]);
const STATEMENT_KW = new Set(["if", "for", "foreach", "while", "do", "switch", "return", "break", "continue", "throw", "try", "goto",
  "public", "private", "protected", "internal", "static", "readonly", "const", "void", "int", "float", "bool", "string", "double",
  "long", "byte", "char", "object", "decimal", "short", "uint", "ulong", "class", "struct", "enum", "interface", "using", "this",
  "base", "namespace", "abstract", "virtual", "override", "sealed", "lock", "unsafe", "fixed", "checked", "unchecked", "delegate", "event"]);
const CONTEXT_STARTERS = new Set(["var", "await", "yield", "async", "partial", "dynamic"]);
const CONTROL_KW = new Set(["if", "while", "for", "foreach", "using", "lock", "fixed", "switch", "catch"]);
const NAME_KINDS = new Set(["identifier", "typeName", "methodName"]);

// Ctx kinds: ns | type(i) | enum | prop(i) | stmt | expr
const ctx = { ns: { k: "ns" }, stmt: { k: "stmt" }, expr: { k: "expr" }, enm: { k: "enum" } };
const checksSemicolons = (c) => c.k !== "enum" && c.k !== "expr";

export function analyze(source, { fileName = null, maxPerRule = 25 } = {}) {
  const t0 = Date.now();
  const lx = lex(source);
  const w = new Worker(lx, fileName);
  w.run();
  let diags = w.diagnostics.sort((a, b) => a.line - b.line || RANK[a.severity] - RANK[b.severity] || a.column - b.column);
  const per = {};
  diags = diags.filter((d) => (per[d.ruleID] = (per[d.ruleID] || 0) + 1) <= maxPerRule);
  const kind = w.scriptKind();
  return {
    diagnostics: diags,
    types: w.types,
    usings: [...w.usings].sort(),
    declaredNamespaces: w.declaredNamespaces,
    scriptKind: kind,
    suggestedCategories: w.suggestCategories(kind),
    detectedComponents: w.detectComponents(),
    referencedTypes: w.referencedTypes(),
    checks: CHECKS,
    lineCount: lx.lineStarts.length,
    tokenCount: w.t.length,
    durationMs: Date.now() - t0,
    get errorCount() { return this.diagnostics.filter((d) => d.severity === "error").length; },
    get warningCount() { return this.diagnostics.filter((d) => d.severity === "warning").length; },
    get infoCount() { return this.diagnostics.filter((d) => d.severity === "info").length; },
  };
}

export function editDistance(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

class Worker {
  constructor(lx, fileName) {
    this.lx = lx;
    this.fileName = fileName;
    this.t = lx.tokens.filter((x) => !TRIVIA.has(x.kind));
    this.match = new Int32Array(this.t.length).fill(-1);
    this.diagnostics = [];
    this.types = [];
    this.usings = new Set();
    this.declaredNamespaces = [];
  }
  text(i) { return i >= 0 && i < this.t.length ? this.t[i].text : ""; }
  report(severity, source, ruleID, message, tok, suggestion = null) {
    this.diagnostics.push({ severity, source, ruleID, message, line: tok ? tok.line : Math.max(1, this.lx.lineStarts.length), column: tok ? tok.column : 1, suggestion });
  }
  diag(severity, source, ruleID, message, line, column = 1, suggestion = null) {
    this.diagnostics.push({ severity, source, ruleID, message, line, column, suggestion });
  }

  run() {
    for (const is of this.lx.issues) this.diag("error", "lexer", is.ruleID, is.message, is.line, is.column);
    this.matchBrackets();
    this.collectUsings();
    this.parseBlock(0, this.t.length, ctx.ns);
    this.csharpRules();
    this.unityRules();
  }

  // ---------------- brackets
  matchBrackets() {
    const stack = [];
    const pairs = { ")": "(", "]": "[", "}": "{" };
    for (let i = 0; i < this.t.length; i++) {
      const tk = this.t[i];
      if (tk.kind !== "punctuation") continue;
      const s = tk.text;
      if (s === "(" || s === "[" || s === "{") { stack.push(i); continue; }
      const open = pairs[s];
      if (!open) continue;
      const top = stack[stack.length - 1];
      if (top !== undefined && this.t[top].text === open) { stack.pop(); this.match[top] = i; this.match[i] = top; continue; }
      let deep = -1;
      for (let k = stack.length - 1; k >= 0; k--) if (this.t[stack[k]].text === open) { deep = k; break; }
      if (deep >= 0) {
        for (const k of stack.slice(deep + 1)) this.reportUnclosed(k);
        const o = stack[deep];
        stack.length = deep;
        this.match[o] = i; this.match[i] = o;
      } else {
        this.report("error", "syntax", "SYN001", `Unerwartete '${s}' – es gibt keine passende öffnende '${open}'.`, tk,
          `Überzählige '${s}' entfernen oder die fehlende '${open}' ergänzen.`);
      }
    }
    for (const k of stack) this.reportUnclosed(k);
  }
  reportUnclosed(k) {
    const open = this.t[k].text;
    const close = open === "(" ? ")" : open === "[" ? "]" : "}";
    let hint = "";
    if (open === "{") { const l = this.guessMissingBraceLine(k); if (l) hint = ` Vermutlich fehlt sie vor Zeile ${l}.`; }
    this.report("error", "syntax", "SYN002", `'${open}' wird nicht geschlossen – es fehlt eine '${close}'.${hint}`, this.t[k], `Passende '${close}' ergänzen.`);
  }
  indentation(line) { const tok = this.t.find((x) => x.line === line); return tok ? tok.column - 1 : 0; }
  guessMissingBraceLine(k) {
    const indent = this.indentation(this.t[k].line);
    let last = this.t[k].line;
    for (let j = k + 1; j < this.t.length; j++) {
      const tok = this.t[j];
      if (tok.line === last) continue;
      last = tok.line;
      const ind = this.indentation(tok.line);
      if ((ind <= indent && tok.text !== "}") || ind < indent) return tok.line;
    }
    return null;
  }

  // ---------------- usings
  collectUsings() {
    const t = this.t;
    for (let i = 0; i < t.length; i++) {
      if (t[i].text === "using" && (i === 0 || [";", "}", "{"].includes(this.text(i - 1)))) {
        let j = i + 1;
        if (this.text(j) === "static") j++;
        if (this.text(j) === "global") j++;
        let parts = [], ok = true, alias = false;
        while (j < t.length && this.text(j) !== ";") {
          const s = this.text(j);
          if (s === "=") { alias = true; parts = []; }
          else if (s === "." || s === "::" || s === "<" || s === ">" || s === ",") { /* skip */ }
          else if (NAME_KINDS.has(t[j].kind) || t[j].kind === "contextualKeyword") parts.push(s);
          else { ok = false; break; }
          j++;
        }
        if (ok && parts.length && this.text(j) === ";") { if (!alias) this.usings.add(parts.join(".")); i = j; }
      }
      if (t[i] && t[i].text === "namespace") {
        let j = i + 1; const parts = [];
        while (j < t.length && (t[j].kind !== "punctuation" || t[j].text === ".")) { if (t[j].text !== ".") parts.push(t[j].text); j++; }
        if (parts.length) this.declaredNamespaces.push(parts.join("."));
      }
    }
  }
  namespaceImported(ns) {
    if (this.usings.has(ns)) return true;
    return this.declaredNamespaces.some((d) => d === ns || d.startsWith(ns + "."));
  }

  // ---------------- parser helpers
  canEnd(a) {
    if (NAME_KINDS.has(a.kind) || a.kind === "number" || a.kind === "string" || a.kind === "char") return true;
    if (a.kind === "keyword") return ["true", "false", "null", "this", "base"].includes(a.text);
    if (a.kind === "contextualKeyword") return a.text === "value";
    return [")", "]", "++", "--"].includes(a.text);
  }
  canStart(b) {
    if (NAME_KINDS.has(b.kind)) return true;
    if (b.kind === "keyword") return STATEMENT_KW.has(b.text);
    if (b.kind === "contextualKeyword") return CONTEXT_STARTERS.has(b.text);
    return false;
  }
  skipAttributes(from, to) {
    let j = from;
    while (j < to && this.text(j) === "[" && this.match[j] > j && this.match[j] < to) j = this.match[j] + 1;
    return j;
  }
  looksComplete(from, upTo) {
    let j = this.skipAttributes(from, upTo + 1);
    if (j > upTo) return false;
    if (["return", "throw", "yield", "break", "continue", "goto", "await"].includes(this.text(j)))
      return upTo > j || this.text(j) === "break" || this.text(j) === "continue";
    let units = 0, angle = 0;
    for (; j <= upTo; j++) {
      const s = this.text(j), k = this.t[j].kind;
      if (s === "=" || s === ")" || s === "]" || s === "++" || s === "--") return true;
      if (k === "number" || k === "string" || k === "char") return true;
      if (s === "<") angle++;
      else if (s === ">") angle = Math.max(0, angle - 1);
      else if (angle === 0 && !MODIFIERS.has(s) && (NAME_KINDS.has(k) || (k === "keyword" && builtinTypeKeywords.has(s)) || s === "var")) {
        if (!(j > from && this.text(j - 1) === ".")) units++;
      }
    }
    return units >= 2;
  }
  isExpressionBlock(i, stmtStart, paren, bracket) {
    if (paren > 0 || bracket > 0) return true;
    if (i <= stmtStart) return false;
    const p = this.text(i - 1);
    if (["=>", "=", "return", ",", "?", "??", "(", "[", "new", "delegate", "with", "switch", ":"].includes(p)) {
      if (p === "switch" && i - 1 === stmtStart) return false;
      return true;
    }
    if (p === ")" && this.match[i - 1] > 0 && this.text(this.match[i - 1] - 1) === "delegate") return true;
    let j = i - 1, angle = 0;
    while (j >= stmtStart) {
      const s = this.text(j), k = this.t[j].kind;
      if (s === ")" || s === "]") { if (this.match[j] < 0) return false; j = this.match[j] - 1; continue; }
      if (s === ">") { angle++; j--; continue; }
      if (s === "<") { angle--; j--; continue; }
      if (s === "new") return true;
      if (s === "." || (s === "," && angle > 0) || s === "?") { j--; continue; }
      if (NAME_KINDS.has(k) || (k === "keyword" && builtinTypeKeywords.has(s))) { j--; continue; }
      return false;
    }
    return false;
  }

  // ---------------- parser
  parseBlock(from, to, c) {
    let stmtStart = from, i = from, paren = 0, bracket = 0, prevBlockWasDo = false, propertyInit = false;
    const firstWord = (s) => { let k = s; while (k < to && this.text(k) === "else") k++; return k; };
    while (i < to) {
      const tok = this.t[i], s = tok.text;
      if (tok.kind === "punctuation" && s === "{") {
        const close = this.match[i] > i ? Math.min(this.match[i], to) : to;
        if ((!checksSemicolons(c) && c.k === "expr") || this.isExpressionBlock(i, stmtStart, paren, bracket)) {
          const prev = this.text(i - 1);
          const lambda = prev === "=>" || prev === "delegate" || (prev === ")" && this.match[i - 1] > 0 && this.text(this.match[i - 1] - 1) === "delegate");
          this.parseBlock(i + 1, close, lambda ? ctx.stmt : ctx.expr);
          i = close + 1;
          continue;
        }
        const hf = this.skipAttributes(stmtStart, i);
        const cont = this.handleStatementBlock(stmtStart, i, i, close, c);
        const fw = firstWord(hf);
        prevBlockWasDo = fw < i && this.text(fw) === "do" && fw === i - 1;
        i = close + 1; paren = 0; bracket = 0;
        propertyInit = cont && i < to && this.text(i) === "=";
        stmtStart = i;
        continue;
      }
      if (tok.kind === "punctuation" && s === "}") { i++; stmtStart = i; paren = 0; bracket = 0; continue; }
      if (tok.kind === "punctuation" && s === ";") {
        if (paren > 0 && this.text(firstWord(stmtStart)) === "for") { i++; continue; }
        if (!propertyInit) this.handleStatement(stmtStart, i, true, c, prevBlockWasDo);
        propertyInit = false; prevBlockWasDo = false; paren = 0; bracket = 0;
        i++; stmtStart = i;
        continue;
      }
      if (s === "(") paren++; else if (s === ")") paren = Math.max(0, paren - 1);
      else if (s === "[") bracket++; else if (s === "]") bracket = Math.max(0, bracket - 1);

      if (checksSemicolons(c) && paren === 0 && bracket === 0 && i + 1 < to && i >= stmtStart) {
        const b = this.t[i + 1];
        if (b.line > tok.line && b.text !== "{" && this.canEnd(tok) && this.canStart(b)) {
          const fw = firstWord(stmtStart);
          if (s === ")" && CONTROL_KW.has(this.text(fw)) && this.text(fw + 1) === "(" && this.match[fw + 1] === i) stmtStart = i + 1;
          else if (s === "]" && this.skipAttributes(stmtStart, i + 1) === i + 1) stmtStart = i + 1;
          else if (this.looksComplete(stmtStart, i)) {
            this.report("error", "syntax", "SYN010", "';' erwartet – die Anweisung endet ohne Semikolon.", tok, `Am Ende von Zeile ${tok.line} ein ';' ergänzen.`);
            stmtStart = i + 1;
          }
        }
      }
      i++;
    }
    if (stmtStart < to) this.handleStatement(stmtStart, to, false, c, prevBlockWasDo);
  }

  handleStatement(from, to, terminated, c, prevBlockWasDo) {
    if (from >= to) return;
    if (!terminated) {
      if (checksSemicolons(c)) {
        const last = this.t[to - 1];
        if (last.text !== ":") this.report("error", "syntax", "SYN011", "';' erwartet vor dem Blockende.", last, `Nach '${last.text}' in Zeile ${last.line} ein ';' ergänzen.`);
      }
      return;
    }
    if (c.k === "type") this.handleMember(from, to, c.i);
    else if (c.k === "stmt") this.checkControl(from, to, true, prevBlockWasDo);
    else if (c.k === "ns") {
      const k = this.skipAttributes(from, to);
      if (k >= to) return;
      let allowed = ["using", "extern", "global", "namespace"].includes(this.text(k));
      for (let q = from; q < to && !allowed; q++) if (["delegate", "record", "class", "struct", "interface", "enum"].includes(this.text(q))) allowed = true;
      if (!allowed) this.report("error", "syntax", "SYN020", "Code außerhalb eines Typs. In Unity muss jeder Code in einer Klasse/Struktur stehen.", this.t[k], "Den Code in eine Klasse (z. B. MonoBehaviour) verschieben.");
    }
  }

  handleMember(from, to, ti) {
    let k = this.skipAttributes(from, to);
    const attrs = this.attributeNames(from, k);
    const mods = [];
    while (k < to && MODIFIERS.has(this.text(k))) { mods.push(this.text(k)); k++; }
    if (k >= to) return;
    const first = this.text(k);
    if (["delegate", "event", "using", "operator", "implicit", "explicit"].includes(first)) {
      if (first === "event") this.addField(k + 1, to, ti, [...mods, "event"], attrs);
      return;
    }
    let paren = -1, assign = -1, arrow = -1, angle = 0;
    for (let j = k; j < to; j++) {
      const s = this.text(j);
      if (s === "<") angle++; else if (s === ">") angle = Math.max(0, angle - 1);
      if (s === "=" && assign < 0 && angle === 0) assign = j;
      if (s === "=>" && arrow < 0) arrow = j;
      if (s === "(" && paren < 0 && assign < 0 && arrow < 0) paren = j;
      if ((s === "(" || s === "[") && this.match[j] > j) j = this.match[j];
    }
    const SYN021 = (sugg) => this.report("error", "syntax", "SYN021", "Anweisung im Klassenrumpf – ausführbarer Code muss in einer Methode stehen.", this.t[k], sugg);
    if (paren >= 0) {
      const nameIdx = this.nameIndexBefore(paren, k);
      let q0 = nameIdx;
      while (q0 - 2 >= k && this.text(q0 - 1) === ".") q0 -= 2;
      const hasReturn = q0 > k;
      const isCtor = !hasReturn && this.text(nameIdx) === this.types[ti].name;
      if (!hasReturn && !isCtor) { SYN021(arrow < 0 ? "Den Aufruf in eine Methode wie Start() oder Awake() verschieben." : "Den Aufruf in eine Methode verschieben."); return; }
      const m = { name: this.text(nameIdx), returnType: this.joinTokens(k, hasReturn ? q0 : k), parameterTypes: this.parameterTypes(paren),
        line: this.t[nameIdx].line, modifiers: mods, bodyStart: 0, bodyEnd: 0, isBlockBody: false };
      if (arrow >= 0) { m.bodyStart = arrow + 1; m.bodyEnd = to; }
      this.types[ti].methods.push(m);
      return;
    }
    const declEnd = assign >= 0 ? assign : arrow >= 0 ? arrow : to;
    let units = 0; angle = 0;
    for (let q = k; q < declEnd; q++) {
      const s = this.text(q), kd = this.t[q].kind;
      if (s === "<") angle++; else if (s === ">") angle = Math.max(0, angle - 1);
      else if (angle === 0 && (NAME_KINDS.has(kd) || (kd === "keyword" && builtinTypeKeywords.has(s)) || kd === "contextualKeyword") && !(q > k && this.text(q - 1) === ".")) units++;
    }
    if (units < 2) { SYN021("Zuweisungen/Aufrufe in eine Methode verschieben oder einen Typ angeben."); return; }
    if (arrow >= 0 && assign < 0) this.addField(k, arrow, ti, mods, attrs, true);
    else this.addField(k, declEnd, ti, mods, attrs);
  }

  attributeNames(from, to) {
    const out = [];
    for (let j = from; j < to; j++) {
      if ((this.text(j) === "[" || this.text(j) === ",") && j + 1 < to && ["attribute", "identifier", "typeName"].includes(this.t[j + 1].kind)) out.push(this.text(j + 1));
    }
    return out;
  }
  addField(from, to, ti, mods, attrs, isProperty = false) {
    if (to - 1 < from) return;
    let nameIdx = to - 1;
    while (nameIdx > from && !(NAME_KINDS.has(this.t[nameIdx].kind) || this.t[nameIdx].kind === "contextualKeyword")) nameIdx--;
    let a = 0;
    for (let q = from; q < to; q++) {
      const s = this.text(q);
      if (s === "<") a++; else if (s === ">") a--;
      else if (s === "," && a <= 0) { if (q - 1 > from) nameIdx = q - 1; break; }
    }
    const f = { name: this.text(nameIdx), typeName: this.joinTokens(from, nameIdx), line: this.t[nameIdx].line, modifiers: mods, attributes: attrs };
    (isProperty ? this.types[ti].properties : this.types[ti].fields).push(f);
  }
  joinTokens(a, b) {
    let out = "";
    for (let q = a; q < b; q++) {
      const s = this.text(q);
      if (out && /[\w>\]]$/.test(out) && /^[A-Za-z_]/.test(s)) out += " ";
      out += s;
    }
    return out;
  }
  nameIndexBefore(paren, lower) {
    let j = paren - 1;
    if (this.text(j) === ">") {
      let depth = 0;
      while (j >= lower) {
        if (this.text(j) === ">") depth++;
        else if (this.text(j) === "<") { depth--; if (depth === 0) { j--; break; } }
        j--;
      }
    }
    return Math.max(lower, j);
  }
  parameterTypes(open) {
    if (this.match[open] <= open) return [];
    const close = this.match[open];
    const out = [];
    let start = open + 1, depth = 0;
    const flush = (end) => {
      if (end <= start) return;
      let a = this.skipAttributes(start, end);
      while (a < end && ["ref", "out", "in", "params", "this", "scoped", "readonly"].includes(this.text(a))) a++;
      let e = end;
      for (let q = a; q < end; q++) if (this.text(q) === "=") { e = q; break; }
      if (e - 1 > a) e--;
      out.push(this.joinTokens(a, e));
    };
    for (let q = open + 1; q < close; q++) {
      const s = this.text(q);
      if (s === "(" || s === "[" || s === "<") depth++;
      else if (s === ")" || s === "]" || s === ">") depth--;
      else if (s === "," && depth === 0) { flush(q); start = q + 1; }
    }
    flush(close);
    return out;
  }

  /** returns true for property-like blocks (initializer may follow) */
  handleStatementBlock(hFrom, hTo, open, close, c) {
    const h0 = this.skipAttributes(hFrom, hTo);
    let typeKw = -1;
    for (let q = h0; q < hTo; q++) {
      const s = this.text(q);
      if (s === "(" || s === "where" || s === "=") break;
      if ((this.t[q].kind === "keyword" && ["class", "struct", "interface", "enum"].includes(s)) || (s === "record" && this.t[q].kind === "contextualKeyword")) { typeKw = q; break; }
    }
    if (typeKw >= 0) {
      const kindText = this.text(typeKw);
      const nameIdx = typeKw + 1 < hTo && ["struct", "class"].includes(this.text(typeKw + 1)) ? typeKw + 2 : typeKw + 1;
      const bases = [];
      for (let colon = nameIdx; colon < hTo; colon++) {
        if (this.text(colon) !== ":") continue;
        let angle = 0, current = null;
        for (let r = colon + 1; r < hTo; r++) {
          const s = this.text(r);
          if (s === "where" && angle === 0) break;
          if (s === "(" && this.match[r] > r) { r = this.match[r]; continue; }
          if (s === "<") angle++; else if (s === ">") angle--;
          else if (s === "," && angle === 0) { if (current) bases.push(current); current = null; }
          else if (angle === 0 && s !== "." && NAME_KINDS.has(this.t[r].kind)) current = s;
        }
        if (current) bases.push(current);
        break;
      }
      const outline = { name: nameIdx < hTo ? this.text(nameIdx) : "?", kind: kindText, bases, line: this.t[typeKw].line,
        methods: [], fields: [], properties: [], nestingDepth: c.k === "type" ? this.types[c.i].nestingDepth + 1 : 0 };
      this.types.push(outline);
      const idx = this.types.length - 1;
      this.parseBlock(open + 1, close, kindText === "enum" ? ctx.enm : { k: "type", i: idx });
      return false;
    }
    if (this.text(h0) === "namespace" || (this.text(h0) === "file" && this.text(h0 + 1) === "namespace")) {
      this.parseBlock(open + 1, close, ctx.ns);
      return false;
    }
    if (c.k === "type") {
      let k = h0; const mods = [];
      while (k < hTo && MODIFIERS.has(this.text(k))) { mods.push(this.text(k)); k++; }
      if (k >= hTo) {
        this.report("error", "syntax", "SYN022", "Unerwarteter Block im Klassenrumpf – fehlt eine Methodendeklaration?", this.t[open], "Einen Methodenkopf wie 'void Start()' vor '{' ergänzen.");
        this.parseBlock(open + 1, close, ctx.stmt);
        return false;
      }
      let paren = -1, angle = 0;
      for (let r = k; r < hTo; r++) {
        const s = this.text(r);
        if (s === "<") angle++; else if (s === ">") angle--;
        if (s === "(" && angle <= 0) { paren = r; break; }
        if (s === "[" && this.match[r] > r) r = this.match[r];
      }
      if (paren >= 0 && this.text(k) !== "event") {
        const nameIdx = this.nameIndexBefore(paren, k);
        this.types[c.i].methods.push({ name: this.text(nameIdx), returnType: this.joinTokens(k, nameIdx), parameterTypes: this.parameterTypes(paren),
          line: this.t[nameIdx].line, modifiers: mods, bodyStart: open + 1, bodyEnd: close, isBlockBody: true });
        this.parseBlock(open + 1, close, ctx.stmt);
        return false;
      }
      const isEvent = this.text(k) === "event";
      this.addField(isEvent ? k + 1 : k, hTo, c.i, mods, this.attributeNames(hFrom, h0), !isEvent);
      this.parseBlock(open + 1, close, { k: "prop", i: c.i });
      return true;
    }
    if (c.k === "prop") { this.parseBlock(open + 1, close, ctx.stmt); return false; }
    if (c.k === "stmt") { this.checkControl(hFrom, hTo, false, false); this.parseBlock(open + 1, close, ctx.stmt); return false; }
    if (c.k === "ns") {
      let hasParen = false;
      for (let q = h0; q < hTo; q++) if (this.text(q) === "(") hasParen = true;
      if (hasParen) this.report("error", "syntax", "SYN020", "Methode außerhalb einer Klasse. In C#/Unity müssen Methoden in einem Typ stehen.", this.t[h0 < hTo ? h0 : open], "Die Methode in eine Klasse verschieben.");
      else if (hTo === hFrom) this.report("error", "syntax", "SYN022", "Unerwarteter Block außerhalb eines Typs.", this.t[open]);
      this.parseBlock(open + 1, close, ctx.stmt);
      return false;
    }
    this.parseBlock(open + 1, close, ctx.expr);
    return false;
  }

  checkControl(from, to, terminated, prevBlockWasDo) {
    let k = from;
    while (k < to && this.text(k) === "else") k++;
    if (k >= to) return;
    const kw = this.text(k);
    if (this.t[k].kind !== "keyword" || !["if", "while", "for", "foreach", "switch"].includes(kw)) return;
    if (this.text(k + 1) !== "(") { this.report("error", "syntax", "SYN030", `Nach '${kw}' wird '(' erwartet.`, this.t[k], `Bedingung in Klammern setzen: ${kw} (…)`); return; }
    const open = k + 1;
    if (this.match[open] <= open) return;
    const close = this.match[open];
    if (terminated && close === to - 1 && kw !== "switch" && !(kw === "while" && prevBlockWasDo))
      this.report("warning", "csharp", "CS0642", `Mögliche falsche leere Anweisung: ';' direkt nach '${kw} (…)'.`, this.t[close], "Das ';' nach der Bedingung entfernen.");
    if (terminated && close + 1 < to) this.checkControl(close + 1, to, true, false);
    if (kw === "if" || kw === "while") {
      let depth = 0;
      for (let q = open; q <= close; q++) {
        const s = this.text(q);
        if (s === "(" || s === "[") depth++; else if (s === ")" || s === "]") depth--;
        else if (s === "=" && depth === 1) { this.report("warning", "csharp", "CSA001", "Zuweisung '=' in der Bedingung – meinten Sie den Vergleich '=='?", this.t[q], "'=' durch '==' ersetzen."); break; }
      }
    }
  }

  // ---------------- C# rules
  csharpRules() {
    const t = this.t;
    for (let i = 0; i < t.length; i++) {
      const s = t[i].text;
      if (s === "catch") {
        let j = i + 1;
        if (this.text(j) === "(" && this.match[j] > j) j = this.match[j] + 1;
        if (this.text(j) === "when" && this.text(j + 1) === "(" && this.match[j + 1] > j) j = this.match[j + 1] + 1;
        if (this.text(j) === "{" && this.match[j] === j + 1) this.report("warning", "csharp", "CSA002", "Leerer catch-Block verschluckt Fehler unbemerkt.", t[i], "Mindestens Debug.LogException(e) aufrufen.");
      }
      if (s === "while" && this.text(i + 1) === "(" && this.text(i + 2) === "true" && this.text(i + 3) === ")" && this.text(i + 4) === "{" && this.match[i + 4] > i + 4) {
        let exits = false;
        for (let q = i + 5; q < this.match[i + 4]; q++) if (["break", "return", "yield", "throw", "goto"].includes(this.text(q))) { exits = true; break; }
        if (!exits) this.report("warning", "unity", "CSA003", "Endlosschleife ohne break/return/yield – friert Unity im Play Mode ein.", t[i], "In einer Coroutine 'yield return null;' einfügen oder eine Abbruchbedingung ergänzen.");
      }
    }
    const seenTypes = {};
    for (const ty of this.types.filter((x) => x.nestingDepth === 0)) {
      if (seenTypes[ty.name]) this.diag("error", "csharp", "CS0101", `Der Typ '${ty.name}' ist bereits definiert (Zeile ${seenTypes[ty.name]}).`, ty.line, 1, "Einen der Typen umbenennen.");
      else seenTypes[ty.name] = ty.line;
    }
    for (const ty of this.types) {
      const seen = {};
      for (const m of ty.methods) {
        const sig = `${m.name}(${m.parameterTypes.join(",")})`;
        if (seen[sig]) this.diag("error", "csharp", "CS0111", `'${ty.name}' definiert bereits einen Member '${m.name}' mit denselben Parametertypen (Zeile ${seen[sig]}).`, m.line, 1, "Methode umbenennen oder entfernen.");
        else seen[sig] = m.line;
      }
      const fs = {};
      for (const f of [...ty.fields, ...ty.properties]) {
        if (fs[f.name]) this.diag("error", "csharp", "CS0102", `'${ty.name}' enthält bereits eine Definition für '${f.name}' (Zeile ${fs[f.name]}).`, f.line);
        else fs[f.name] = f.line;
      }
    }
    this.missingUsings();
  }

  missingUsings() {
    const declared = new Set(this.types.map((x) => x.name));
    const reported = new Set();
    const t = this.t;
    for (let i = 0; i < t.length; i++) {
      const tok = t[i];
      if (!(NAME_KINDS.has(tok.kind) || tok.kind === "attribute")) continue;
      const name = tok.text;
      const ns = U.typeNamespaces[name];
      if (!ns || reported.has(name) || declared.has(name) || U.ambiguousTypes.has(name)) continue;
      const prev = this.text(i - 1), next = this.text(i + 1);
      if (i > 0 && (prev === "." || prev === "::")) continue;
      if (next === ":" && prev !== "?") continue;
      if (tok.kind === "methodName" && prev !== "new" && U.messages[name]) continue;
      if (tok.kind === "methodName" && prev !== "new" && prev !== "typeof" && !(name === "Action" || name === "Func")) continue;
      let req = ns;
      if ((name === "IEnumerator" || name === "IEnumerable") && next === "<") req = "System.Collections.Generic";
      if (this.namespaceImported(req)) continue;
      if (req === "UnityEditor" && name === "Editor" && prev !== ":") continue;
      if ((name === "Undo" || name === "Selection" || name === "Handles") && next !== ".") continue;
      reported.add(name);
      const core = req === "UnityEngine" || req.startsWith("System.Collections");
      this.report(core ? "error" : "warning", "csharp", "CS0246", `Typ '${name}' nicht gefunden – fehlt 'using ${req};'?`, tok, `Am Dateianfang 'using ${req};' ergänzen.`);
    }
    if (!this.namespaceImported("System.Linq")) {
      for (let i = 1; i < t.length; i++) {
        if (t[i].kind === "methodName" && U.linqMethods.has(t[i].text) && this.text(i - 1) === ".") {
          if (["Mathf", "Math", "Physics", "Physics2D", "Vector3", "Vector2", "Quaternion", "Color", "Time", "this", "base", "Enumerable"].includes(this.text(i - 2))) continue;
          this.report("warning", "csharp", "CS1061", `'${t[i].text}()' ist eine LINQ-Methode – fehlt 'using System.Linq;'?`, t[i], "'using System.Linq;' ergänzen.");
          break;
        }
      }
    }
  }

  // ---------------- Unity rules
  derives(type, bases, depth = 0) {
    if (depth > 8) return false;
    for (const b of type.bases) {
      if (bases.has(b)) return true;
      const parent = this.types.find((x) => x.name === b);
      if (parent && this.derives(parent, bases, depth + 1)) return true;
    }
    return false;
  }
  isBehaviour(ty) { return this.derives(ty, U.behaviourBases); }
  tokenAtLine(line) { return this.t.find((x) => x.line === line); }

  unityRules() {
    const t = this.t;
    const behaviours = this.types.filter((x) => this.isBehaviour(x));
    const behaviourNames = new Set(behaviours.map((x) => x.name));
    const scriptables = this.types.filter((x) => this.derives(x, new Set(["ScriptableObject"])));
    const editors = this.types.filter((x) => this.derives(x, U.editorBases));
    for (const ty of behaviours) {
      const coroutines = new Set(ty.methods.filter((m) => isCoroutine(m)).map((m) => m.name));
      for (const m of ty.methods) {
        this.checkMessageSignature(m);
        if (U.frameMessages.has(m.name) && m.parameterTypes.length === 0 && m.isBlockBody) this.checkFrameMethod(m);
        if (isCoroutine(m) && hasBody(m)) {
          let y = false;
          for (let q = m.bodyStart; q < m.bodyEnd; q++) if (this.text(q) === "yield") { y = true; break; }
          if (!y) this.report("warning", "unity", "UNITY041", `Coroutine '${m.name}' gibt IEnumerator zurück, enthält aber kein 'yield'.`, this.tokenAtLine(m.line), "Mindestens ein 'yield return null;' einfügen.");
        }
        if (hasBody(m)) this.checkDirectCoroutineCalls(m, coroutines);
      }
      for (const f of ty.fields) if (f.attributes.includes("SerializeField") && f.modifiers.includes("public"))
        this.diag("info", "unity", "UNITY072", `[SerializeField] ist bei public-Feldern überflüssig ('${f.name}').`, f.line, 1, "Feld private machen oder Attribut entfernen.");
    }
    let legacy = false;
    for (let i = 0; i < t.length; i++) {
      const s = t[i].text;
      if (U.structProperties.has(s) && this.text(i - 1) === "." && this.text(i + 1) === "." && U.structFields.has(this.text(i + 2)) && ["=", "+=", "-=", "*=", "/=", "++", "--"].includes(this.text(i + 3))) {
        const base = this.text(i - 2);
        this.report("error", "unity", "CS1612", `Der Rückgabewert von '${base}.${s}' kann nicht geändert werden, da er keine Variable ist (Struct-Kopie).`, t[i + 2],
          `Zwischenvariable verwenden: var p = ${base}.${s}; p.${this.text(i + 2)} ${this.text(i + 3)} …; ${base}.${s} = p;`);
      }
      if (s === "tag" && t[i].kind !== "string" && (["==", "!="].includes(this.text(i + 1)) || ["==", "!="].includes(this.text(i - 1))))
        this.report("warning", "unity", "UNITY021", "Tag-Vergleich mit '==' erzeugt Garbage – CompareTag() ist schneller.", t[i], 'other.CompareTag("Player") verwenden.');
      if (s === "new" && this.text(i + 2) === "(") {
        const tn = this.text(i + 1);
        if (behaviourNames.has(tn) || U.componentTypes.has(tn) || tn === "MonoBehaviour")
          this.report("warning", "unity", "UNITY031", `'${tn}' ist eine Komponente und darf nicht mit 'new' erzeugt werden.`, t[i], `gameObject.AddComponent<${tn}>() verwenden.`);
        else if (scriptables.some((x) => x.name === tn) || tn === "ScriptableObject")
          this.report("warning", "unity", "UNITY032", `ScriptableObjects werden mit ScriptableObject.CreateInstance<${tn}>() erzeugt, nicht mit 'new'.`, t[i]);
      }
      if (s === "StartCoroutine" && this.text(i + 1) === "(" && t[i + 2] && t[i + 2].kind === "string")
        this.report("info", "unity", "UNITY040", "StartCoroutine mit String ist langsam und nicht typsicher.", t[i], "StartCoroutine(MeineCoroutine()) verwenden.");
      if (s === "Input" && this.text(i + 1) === "." && U.legacyInputCalls.has(this.text(i + 2)) && !legacy) {
        legacy = true;
        this.report("info", "unity", "UNITY020", `Altes Input Manager API (Input.${this.text(i + 2)}). Mit 'Active Input Handling = Input System Package' wirft dies zur Laufzeit Exceptions.`, t[i],
          "Für das neue Input System: Keyboard.current / InputAction verwenden oder 'Both' aktivieren.");
      }
    }
    this.checkUnityEditor(editors.length > 0);
    const fileName = (this.fileName || "").trim();
    if (fileName) {
      const top = [...behaviours, ...scriptables, ...editors].filter((x) => x.nestingDepth === 0);
      if (top.length && !top.some((x) => x.name === fileName))
        this.diag("warning", "unity", "UNITY070", `Skriptname '${fileName}' entspricht keinem Klassennamen (${top.map((x) => x.name).join(", ")}). Unity kann die Komponente sonst nicht hinzufügen.`,
          top[0].line, 1, `Skript in '${top[0].name}' umbenennen.`);
    }
    const topBehaviours = behaviours.filter((x) => x.nestingDepth === 0);
    if (topBehaviours.length > 1)
      this.diag("info", "unity", "UNITY071", "Mehrere MonoBehaviours in einer Datei – Unity kann nur die Klasse mit dem Dateinamen als Komponente verwenden.", behaviours[1].line);
  }

  checkMessageSignature(m) {
    if (m.modifiers.includes("override")) return;
    const name = m.name;
    const sigs = U.messages[name];
    if (sigs) {
      const params = m.parameterTypes.map((p) => p.split(".").pop());
      if (!sigs.some((s) => s.length === params.length && s.every((x, i) => x === params[i]))) {
        let expected = sigs[0].join(", ") || "keine Parameter";
        let hint = `Erwartet: ${name}(${expected}).`;
        if (name.startsWith("OnTrigger") || name.startsWith("OnCollision")) {
          const is2D = name.endsWith("2D");
          if (params[0] && params[0].endsWith("2D") && !is2D) hint = `Für 2D-Physik heißt die Methode ${name}2D(${params[0]}).`;
          if (params[0] === "Collider" && name.startsWith("OnCollision")) hint = "OnCollision… erhält 'Collision', nicht 'Collider'.";
          if (params[0] === "Collision" && name.startsWith("OnTrigger")) hint = "OnTrigger… erhält 'Collider', nicht 'Collision'.";
        }
        this.report("warning", "unity", "UNITY002", `Falsche Signatur für Unity-Message '${name}' – Unity ruft sie so nicht auf. ${hint}`, this.tokenAtLine(m.line), hint);
      }
      if (m.returnType === "IEnumerator" && !U.coroutineMessages.has(name))
        this.report("warning", "unity", "UNITY003", `'${name}' kann keine Coroutine sein – Unity ignoriert den IEnumerator-Rückgabewert.`, this.tokenAtLine(m.line), "Rückgabetyp 'void' verwenden und eine separate Coroutine starten.");
      return;
    }
    if (m.returnType !== "void" && m.returnType !== "IEnumerator") return;
    const lower = name.toLowerCase();
    for (const msg of Object.keys(U.messages)) {
      if (msg.toLowerCase() === lower) {
        this.report("warning", "unity", "UNITY001", `'${name}' wird von Unity nie aufgerufen – Groß-/Kleinschreibung beachten: '${msg}'.`, this.tokenAtLine(m.line), `In '${msg}' umbenennen.`);
        return;
      }
    }
    for (const msg of Object.keys(U.messages)) {
      if (msg.length < 5 || Math.abs(msg.length - name.length) > 2 || msg[0].toLowerCase() !== lower[0]) continue;
      const d = editDistance(lower, msg.toLowerCase());
      if (d > 0 && d <= (msg.length >= 9 ? 2 : 1)) {
        this.report("warning", "unity", "UNITY001", `'${name}' sieht aus wie ein Tippfehler von Unity-Message '${msg}' – sie wird nie aufgerufen.`, this.tokenAtLine(m.line), `In '${msg}' umbenennen.`);
        return;
      }
    }
  }

  checkFrameMethod(m) {
    const t = this.t;
    if (m.bodyEnd <= m.bodyStart) {
      this.report("info", "unity", "UNITY010", `Leere '${m.name}()'-Methode verursacht unnötigen Aufruf-Overhead pro Frame.`, this.tokenAtLine(m.line), "Leere Methode entfernen.");
      return;
    }
    const done = new Set();
    for (let i = m.bodyStart; i < m.bodyEnd; i++) {
      const s = this.text(i);
      const label = U.expensiveFrameCalls[s];
      if (label && (this.text(i + 1) === "(" || this.text(i + 1) === "<") && !done.has(s)) {
        if (!(s === "AddComponent" && m.name !== "Update")) {
          done.add(s);
          this.report("warning", "unity", "UNITY011", `${label} in ${m.name}() ist teuer, da es jeden Frame ausgeführt wird.`, t[i], "Ergebnis in Awake()/Start() zwischenspeichern (cachen).");
        }
      }
      if (s === "Find" && this.text(i - 1) === "." && this.text(i - 2) === "GameObject" && !done.has("Find")) {
        done.add("Find");
        this.report("warning", "unity", "UNITY011", `GameObject.Find in ${m.name}() durchsucht jeden Frame die ganze Szene.`, t[i], "Referenz in Start() cachen oder per [SerializeField] zuweisen.");
      }
      if (s === "main" && this.text(i - 1) === "." && this.text(i - 2) === "Camera" && !done.has("cam")) {
        done.add("cam");
        this.report("info", "unity", "UNITY012", `Camera.main in ${m.name}() – in älteren Unity-Versionen ein FindWithTag-Aufruf pro Frame.`, t[i], "Kamera in Start() cachen.");
      }
      if (s === "Log" && this.text(i - 1) === "." && this.text(i - 2) === "Debug" && !done.has("log")) {
        done.add("log");
        this.report("info", "unity", "UNITY017", `Debug.Log in ${m.name}() kostet jeden Frame Performance und flutet die Konsole.`, t[i]);
      }
      if (U.rigidbodyCalls.has(s) && this.text(i - 1) === "." && (m.name === "Update" || m.name === "LateUpdate") && !done.has("rb")) {
        done.add("rb");
        this.report("info", "unity", "UNITY013", `Physik-Aufruf '${s}' in ${m.name}() – Physik sollte in FixedUpdate() laufen.`, t[i], "Eingaben in Update() lesen, Kräfte in FixedUpdate() anwenden.");
      }
      if (m.name === "FixedUpdate" && s === "Input" && this.text(i + 1) === "." && ["GetKeyDown", "GetKeyUp", "GetButtonDown", "GetButtonUp", "GetMouseButtonDown", "GetMouseButtonUp"].includes(this.text(i + 2)) && !done.has("fi")) {
        done.add("fi");
        this.report("warning", "unity", "UNITY015", `Input.${this.text(i + 2)} in FixedUpdate() verpasst Eingaben, da FixedUpdate nicht jeden Frame läuft.`, t[i], "Eingabe in Update() lesen und in einem Feld speichern.");
      }
      if (m.name === "Update" && ["SetBool", "SetFloat", "SetTrigger", "SetInteger"].includes(s) && this.text(i + 1) === "(" && t[i + 2] && t[i + 2].kind === "string" && !done.has("ah")) {
        done.add("ah");
        this.report("info", "unity", "UNITY016", `Animator.${s} mit String in Update() – Parameter-Hash mit Animator.StringToHash cachen.`, t[i]);
      }
    }
    if (m.name === "Update" || m.name === "LateUpdate") {
      let st = m.bodyStart;
      for (let i = m.bodyStart; i < m.bodyEnd; i++) {
        const s = this.text(i);
        if (s === ";") {
          let moves = false, usesDelta = false, deltaVar = false;
          for (let q = st; q < i; q++) {
            const x = this.text(q);
            if ((x === "Translate" || x === "Rotate") && this.text(q - 1) === ".") moves = true;
            if (x === "position" && this.text(q - 1) === "." && (this.text(q + 1) === "+=" || this.text(q + 1) === "-=")) moves = true;
            if (["deltaTime", "smoothDeltaTime", "unscaledDeltaTime", "MoveTowards", "Lerp", "SmoothDamp"].includes(x)) usesDelta = true;
            if (t[q].kind === "identifier" && x.toLowerCase().includes("delta")) deltaVar = true;
          }
          if (moves && !usesDelta && !deltaVar)
            this.report("info", "unity", "UNITY014", `Bewegung in ${m.name}() ohne Time.deltaTime ist von der Framerate abhängig.`, t[st], "Mit Time.deltaTime multiplizieren.");
          st = i + 1;
        } else if (s === "{" || s === "}") st = i + 1;
      }
    }
  }

  checkDirectCoroutineCalls(m, coroutines) {
    if (!coroutines.size) return;
    for (let i = m.bodyStart; i < m.bodyEnd; i++) {
      if (!coroutines.has(this.text(i)) || this.text(i + 1) !== "(") continue;
      const prev = this.text(i - 1);
      const atStart = [";", "{", "}"].includes(prev) || (prev === "." && this.text(i - 2) === "this" && [";", "{", "}"].includes(this.text(i - 3)));
      if (!atStart || this.match[i + 1] <= i + 1 || this.text(this.match[i + 1] + 1) !== ";") continue;
      this.report("warning", "unity", "UNITY042", `Coroutine '${this.text(i)}()' wird direkt aufgerufen und deshalb nie ausgeführt.`, this.t[i], `StartCoroutine(${this.text(i)}(…)) verwenden.`);
    }
  }

  checkUnityEditor(hasEditorClass) {
    const stack = [];
    for (const tok of this.lx.tokens) {
      if (tok.kind === "preprocessor") {
        const d = tok.text.trim();
        if (d.startsWith("#if")) stack.push(d.includes("UNITY_EDITOR") && !d.includes("!UNITY_EDITOR"));
        else if (d.startsWith("#elif") || d.startsWith("#else")) { if (stack.length) stack[stack.length - 1] = false; }
        else if (d.startsWith("#endif")) stack.pop();
      } else if (tok.text === "UnityEditor") {
        if (stack.includes(true)) continue;
        if (hasEditorClass) this.diag("info", "unity", "UNITY051", "Editor-Skript: Die Datei muss in einem Ordner namens 'Editor' liegen, sonst schlägt der Player-Build fehl.", tok.line, tok.column);
        else this.diag("warning", "unity", "UNITY050", "UnityEditor ist in Player-Builds nicht verfügbar – der Build schlägt fehl.", tok.line, tok.column, "Mit '#if UNITY_EDITOR … #endif' umschließen oder in einen Editor-Ordner verschieben.");
        return;
      }
    }
  }

  // ---------------- classification
  scriptKind() {
    const top = this.types.filter((x) => x.nestingDepth === 0);
    if (!top.length) return "Leer";
    if (top.some((x) => this.derives(x, U.editorBases))) return "Editor-Skript";
    if (top.some((x) => this.derives(x, new Set(["StateMachineBehaviour"])))) return "StateMachineBehaviour";
    if (top.some((x) => this.isBehaviour(x))) return "MonoBehaviour";
    if (top.some((x) => this.derives(x, new Set(["ScriptableObject"])))) return "ScriptableObject";
    if (top.every((x) => x.kind === "interface")) return "Interface";
    if (top.every((x) => x.kind === "enum")) return "Enum";
    if (top.every((x) => x.kind === "struct" || x.kind === "record")) return "Struct / Daten";
    const c = top.find((x) => x.kind === "class");
    if (c && c.methods.length && c.methods.every((m) => m.modifiers.includes("static"))) return "Statische Utility";
    return "Reines C#";
  }
  suggestCategories(kind) {
    const words = new Set(this.t.map((x) => x.text));
    const has = (l) => l.some((w) => words.has(w));
    const cats = [];
    if (has(["NavMeshAgent", "NavMesh", "SetDestination"]) || this.types.some((x) => x.name.includes("Enemy") || x.name.includes("AI"))) cats.push("Enemy AI");
    if (has(["CharacterController", "PlayerInput"]) || this.types.some((x) => x.name.includes("Player"))) cats.push("Player Controller");
    if (has(["Animator", "SetTrigger", "SetBool", "OnAnimatorIK", "AnimationCurve"])) cats.push("Animation");
    if (has(["OnTriggerEnter", "OnTriggerEnter2D", "Interact", "IInteractable"])) cats.push("Interactions");
    if (has(["Rigidbody", "Rigidbody2D", "AddForce", "Physics", "Raycast"])) cats.push("Physics");
    if (has(["Canvas", "Image", "Button", "TextMeshProUGUI", "Slider"])) cats.push("UI");
    if (has(["AudioSource", "AudioClip", "AudioMixer"])) cats.push("Audio");
    if (has(["Camera", "CinemachineVirtualCamera"]) && !cats.includes("Player Controller")) cats.push("Camera");
    if (has(["Damage", "TakeDamage", "Health", "Attack", "hitPoints"])) cats.push("Combat System");
    if (has(["InputAction", "Keyboard", "Gamepad", "InputSystem"])) cats.push("Input System");
    if (has(["SaveData", "PlayerPrefs", "JsonUtility", "File"])) cats.push("Save System");
    if (has(["Shader", "Material", "MaterialPropertyBlock", "Volume"])) cats.push("Rendering");
    if (has(["SceneManager", "LoadSceneAsync"])) cats.push("Scene Management");
    const lead = { "Editor-Skript": "Editor Tool", ScriptableObject: "Data / ScriptableObject", Interface: "Interfaces", "Statische Utility": "Utilities" }[kind];
    if (lead) cats.unshift(lead);
    if (has(["event", "Action", "UnityEvent", "delegate"])) cats.push("Events");
    if (has(["IEnumerator", "StartCoroutine"])) cats.push("Coroutines");
    return [...new Set(cats)];
  }
  detectComponents() {
    const found = new Set();
    this.t.forEach((tok, i) => {
      if (!U.componentTypes.has(tok.text)) return;
      const prev = this.text(i - 1), next = this.text(i + 1);
      if (prev === "<" || (prev === "(" && this.text(i - 2) === "typeof") || /^[A-Za-z_]/.test(next) || next === "[" || next === ">") found.add(tok.text);
    });
    return [...found].sort();
  }
  referencedTypes() {
    const out = new Set();
    const declared = new Set(this.types.map((x) => x.name));
    this.t.forEach((tok, i) => {
      if ((tok.kind === "typeName" || tok.kind === "identifier") && isTypeLike(tok.text) && this.text(i - 1) !== "." && !declared.has(tok.text) && !U.knownTypes.has(tok.text)) out.add(tok.text);
    });
    return [...out].sort();
  }
}

const isCoroutine = (m) => m.returnType === "IEnumerator" || m.returnType.endsWith(".IEnumerator");
const hasBody = (m) => m.bodyEnd > m.bodyStart || m.isBlockBody;
