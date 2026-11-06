// High-performance code editor for iOS Safari: a transparent <textarea> (native caret, selection,
// keyboard, copy/paste) over a syntax-highlight layer that renders only the visible lines.
import { lex } from "../core/lexer.js";
import { esc } from "../core/markdown.js";
import * as EA from "../core/editor-assist.js";
import { h } from "./kit.js";

const PAD_T = 12, PAD_L = 10, OVERSCAN = 40;

export class CodeEditor {
  constructor({ value = "", fontSize = 14, indentUnit = "    ", autoPair = true, lineNumbers = true, onChange, onCaret }) {
    this.fontSize = fontSize; this.indentUnit = indentUnit; this.autoPair = autoPair; this.lineNumbers = lineNumbers;
    this.onChange = onChange; this.onCaret = onCaret;
    this.tokens = []; this.lineStarts = [0]; this.diagnostics = []; this.matches = []; this.matchIndex = 0; this.bracket = null;
    this.rendered = { first: -1, last: -1, version: -1 }; this.version = 0;
    this.history = [{ value, s: 0, e: 0 }]; this.hIndex = 0; this.lastPush = 0;

    this.gutterInner = h("div.ce-gutter-inner");
    this.gutter = h("div.ce-gutter", this.gutterInner);
    this.hl = h("pre.ce-hl", { "aria-hidden": "true" });
    this.overlay = h("div.ce-overlay");
    this.curLine = h("div.ce-curline");
    this.ta = h("textarea.ce-input", { spellcheck: false, autocapitalize: "off", autocomplete: "off", autocorrect: "off", wrap: "off", "aria-label": "C#-Code", "data-gramm": "false" });
    this.ta.value = value;
    this.content = h("div.ce-content", this.curLine, this.hl, this.overlay, this.ta);
    this.scroll = h("div.ce-scroll", this.content);
    this.el = h("div.ce", this.gutter, this.scroll);

    this.ta.addEventListener("beforeinput", (e) => this.beforeInput(e));
    this.ta.addEventListener("input", (e) => this.onInput(e));
    this.ta.addEventListener("keydown", (e) => this.keydown(e));
    const sel = () => this.caretChanged();
    for (const ev of ["select", "keyup", "click", "focus"]) this.ta.addEventListener(ev, sel);
    document.addEventListener("selectionchange", () => { if (document.activeElement === this.ta) this.caretChanged(); });
    this.scroll.addEventListener("scroll", () => { this.gutterInner.style.transform = `translateY(${-this.scroll.scrollTop}px)`; this.scheduleRender(); }, { passive: true });
    new ResizeObserver(() => { this.layout(); this.render(true); }).observe(this.scroll);
    this.applyFont();
    this.textChanged(true);
  }

  // ---------------- metrics
  applyFont() {
    this.lh = Math.round(this.fontSize * 1.55);
    const font = `${this.fontSize}px ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace`;
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = font;
    this.cw = ctx.measureText("M".repeat(100)).width / 100;
    this.el.style.setProperty("--ce-font", font);
    this.el.style.setProperty("--ce-lh", this.lh + "px");
    this.el.style.setProperty("--ce-padt", PAD_T + "px");
    this.el.style.setProperty("--ce-padl", PAD_L + "px");
    this.layout();
    this.render(true);
  }
  setFontSize(px) { this.fontSize = Math.max(10, Math.min(28, px)); this.applyFont(); }
  setLineNumbers(on) { this.lineNumbers = on; this.layout(); this.render(true); }

  layout() {
    const digits = Math.max(2, String(this.lineStarts.length).length);
    const gw = this.lineNumbers ? Math.ceil(digits * this.cw * 0.9 + 24) : 0;
    this.gutter.style.width = gw + "px";
    this.gutter.style.display = this.lineNumbers ? "" : "none";
    this.scroll.style.left = gw + "px";
    let maxLen = 0;
    const v = this.ta.value;
    for (let i = 0; i < this.lineStarts.length; i++) {
      const end = i + 1 < this.lineStarts.length ? this.lineStarts[i + 1] - 1 : v.length;
      const len = end - this.lineStarts[i];
      if (len > maxLen) maxLen = len;
    }
    const w = Math.max(this.scroll.clientWidth, Math.ceil(maxLen * this.cw * 1.02) + PAD_L * 2 + 60);
    const hgt = Math.max(this.scroll.clientHeight, this.lineStarts.length * this.lh + PAD_T + Math.max(240, this.scroll.clientHeight * 0.6));
    this.content.style.width = w + "px";
    this.content.style.height = hgt + "px";
  }

  // ---------------- text pipeline
  get value() { return this.ta.value; }
  setValue(v, { keepHistory = false } = {}) {
    this.ta.value = v;
    if (!keepHistory) { this.history = [{ value: v, s: 0, e: 0 }]; this.hIndex = 0; }
    this.textChanged(true);
  }

  textChanged(immediate = false) {
    const v = this.ta.value;
    const ls = [0];
    for (let i = v.indexOf("\n"); i >= 0; i = v.indexOf("\n", i + 1)) ls.push(i + 1);
    this.lineStarts = ls;
    this.version++;
    this.layout();
    clearTimeout(this.lexTimer);
    const run = () => { this.tokens = lex(this.ta.value).tokens; this.version++; this.render(true); this.updateBracket(); };
    if (immediate || v.length < 60000) run(); else this.lexTimer = setTimeout(run, 150);
    this.render(true);
    this.caretChanged();
  }

  pushHistory(coalesce = false) {
    const now = Date.now();
    const st = { value: this.ta.value, s: this.ta.selectionStart, e: this.ta.selectionEnd };
    this.history.length = this.hIndex + 1;
    if (coalesce && now - this.lastPush < 600 && this.hIndex > 0) this.history[this.hIndex] = st;
    else { this.history.push(st); this.hIndex++; if (this.history.length > 500) { this.history.shift(); this.hIndex--; } }
    this.lastPush = coalesce ? now : 0;
  }
  get canUndo() { return this.hIndex > 0; }
  get canRedo() { return this.hIndex < this.history.length - 1; }
  restoreHistory(k) {
    const st = this.history[k];
    this.hIndex = k;
    this.ta.value = st.value;
    this.ta.setSelectionRange(st.s, st.e);
    this.textChanged();
    this.onChange?.(this.ta.value);
    this.revealCaret();
  }
  undo() { if (this.canUndo) this.restoreHistory(this.hIndex - 1); }
  redo() { if (this.canRedo) this.restoreHistory(this.hIndex + 1); }

  onInput(e) {
    this.pushHistory(e.inputType === "insertText" || e.inputType === "deleteContentBackward");
    this.textChanged();
    this.onChange?.(this.ta.value);
  }

  /** Applies an edit {from,to,insert,caret|select} as one undo step. */
  apply(edit) {
    this.ta.setRangeText(edit.insert, edit.from, edit.to, "end");
    if (edit.select) this.ta.setSelectionRange(edit.select[0], edit.select[1]);
    else if (edit.caret !== undefined) this.ta.setSelectionRange(edit.caret, edit.caret);
    this.pushHistory();
    this.textChanged();
    this.onChange?.(this.ta.value);
    this.revealCaret();
  }

  beforeInput(e) {
    const t = e.inputType, v = this.ta.value, s = this.ta.selectionStart, en = this.ta.selectionEnd;
    if (t === "historyUndo") { e.preventDefault(); this.undo(); return; }
    if (t === "historyRedo") { e.preventDefault(); this.redo(); return; }
    if (t === "insertLineBreak" || t === "insertParagraph" || (t === "insertText" && e.data === "\n")) {
      e.preventDefault(); this.apply(EA.newlineEdit(v, s, en, this.indentUnit)); return;
    }
    if (t === "insertText" && e.data && e.data.length === 1) {
      const ch = e.data, next = v[en];
      if (ch === "}" && s === en) {
        if (next === "}" && !/^[ \t]*$/.test(v.slice(v.lastIndexOf("\n", s - 1) + 1, s))) { e.preventDefault(); this.ta.setSelectionRange(s + 1, s + 1); return; }
        const ed = EA.closingBraceEdit(v, s, en, this.indentUnit);
        if (ed) { e.preventDefault(); this.apply(ed); return; }
      }
      if (!this.autoPair || s !== en) return;
      if ([")", "]", "}", '"'].includes(ch) && next === ch) { e.preventDefault(); this.ta.setSelectionRange(s + 1, s + 1); return; }
      const pair = EA.autoPair(ch, next);
      if (pair) {
        if (ch === '"' && (/\w/.test(v[s - 1] || "") || this.insideString(s))) return;
        e.preventDefault();
        this.apply({ from: s, to: en, insert: pair, caret: s + 1 });
      }
      return;
    }
    if (t === "deleteContentBackward" && this.autoPair && s === en && s > 0) {
      const a = v[s - 1], b = v[s];
      if ((a === "(" && b === ")") || (a === "[" && b === "]") || (a === "{" && b === "}") || (a === '"' && b === '"')) {
        e.preventDefault(); this.apply({ from: s - 1, to: s + 1, insert: "", caret: s - 1 });
      }
    }
  }

  insideString(pos) { return this.tokens.some((t) => (t.kind === "string" || t.kind === "comment" || t.kind === "char") && t.location < pos && pos < t.end); }

  keydown(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Tab") { e.preventDefault(); this.shift(e.shiftKey); return; }
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && e.key === "/") { e.preventDefault(); this.toggleComment(); return; }
    if (mod && e.key === "]") { e.preventDefault(); this.shift(false); return; }
    if (mod && e.key === "[") { e.preventDefault(); this.shift(true); return; }
    if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); this.onFindShortcut?.(); }
  }

  // ---------------- commands
  insert(text) {
    const s = this.ta.selectionStart, e = this.ta.selectionEnd;
    if (text === "\t") { this.shift(false); return; }
    if (text.length === 1 && s === e) {
      // run the same smart typing logic as the keyboard
      const ev = new InputEvent("beforeinput", { inputType: "insertText", data: text, cancelable: true });
      this.beforeInput(Object.assign(ev, { preventDefault() { this._handled = true; } }));
      if (this._handled) { this._handled = false; return; }
    }
    this.apply({ from: s, to: e, insert: text, caret: s + text.length });
  }
  wrap(prefix, suffix) {
    const s = this.ta.selectionStart, e = this.ta.selectionEnd, sel = this.ta.value.slice(s, e);
    this.apply({ from: s, to: e, insert: prefix + sel + suffix, caret: s + prefix.length + sel.length });
  }
  shift(outdent) {
    const s = this.ta.selectionStart, e = this.ta.selectionEnd;
    if (s === e && !outdent) { this.apply({ from: s, to: e, insert: this.indentUnit, caret: s + this.indentUnit.length }); return; }
    this.apply(EA.shiftLines(this.ta.value, s, e, this.indentUnit, outdent));
  }
  toggleComment() { this.apply(EA.toggleLineComment(this.ta.value, this.ta.selectionStart, this.ta.selectionEnd)); }
  format() {
    const f = EA.reindent(this.ta.value, this.indentUnit);
    if (f === this.ta.value) return;
    const line = this.caretLine();
    this.apply({ from: 0, to: this.ta.value.length, insert: f, caret: 0 });
    this.goTo(line, 1, false);
  }
  insertSnippet(code) {
    const s = this.ta.selectionStart, e = this.ta.selectionEnd;
    const indent = EA.lineIndent(this.ta.value, s);
    let body = code.replace(/\t/g, this.indentUnit).split("\n").map((l, i) => (i === 0 ? l : indent + l)).join("\n").replace(/    /g, this.indentUnit);
    const k = body.indexOf("$0");
    body = body.replace("$0", "");
    this.apply({ from: s, to: e, insert: body, caret: s + (k >= 0 ? k : body.length) });
  }
  moveCaret(delta) {
    const p = Math.max(0, Math.min(this.ta.value.length, (delta < 0 ? this.ta.selectionStart : this.ta.selectionEnd) + delta));
    this.ta.setSelectionRange(p, p);
    this.caretChanged();
  }

  // ---------------- caret / navigation
  lineOf(pos) { let lo = 0, hi = this.lineStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.lineStarts[m] <= pos) lo = m; else hi = m - 1; } return lo; }
  caretLine() { return this.lineOf(this.ta.selectionStart) + 1; }
  caretChanged() {
    const pos = this.ta.selectionStart;
    const li = this.lineOf(pos);
    this.curLine.style.transform = `translateY(${PAD_T + li * this.lh}px)`;
    this.curLine.style.height = this.lh + "px";
    if (this.activeLine !== li) { this.activeLine = li; this.renderGutter(); }
    this.updateBracket();
    this.onCaret?.({ line: li + 1, column: pos - this.lineStarts[li] + 1, selection: this.ta.selectionEnd - pos });
  }
  updateBracket() {
    const s = this.ta.selectionStart;
    const pair = s === this.ta.selectionEnd ? EA.bracketPair(this.tokens, s) : null;
    const key = pair ? pair.join() : "";
    if (key === (this.bracket || []).join()) return;
    this.bracket = pair;
    this.renderOverlay();
  }
  revealCaret() {
    const li = this.lineOf(this.ta.selectionStart);
    const y = PAD_T + li * this.lh, top = this.scroll.scrollTop, hgt = this.scroll.clientHeight;
    if (y < top + this.lh) this.scroll.scrollTop = Math.max(0, y - this.lh * 2);
    else if (y > top + hgt - this.lh * 3) this.scroll.scrollTop = y - hgt + this.lh * 4;
  }
  goTo(line, column = 1, select = true) {
    const li = Math.max(0, Math.min(line - 1, this.lineStarts.length - 1));
    const start = this.lineStarts[li];
    const end = li + 1 < this.lineStarts.length ? this.lineStarts[li + 1] - 1 : this.ta.value.length;
    const caret = Math.min(start + Math.max(0, column - 1), end);
    if (select) this.ta.setSelectionRange(start, end); else this.ta.setSelectionRange(caret, caret);
    this.scroll.scrollTop = Math.max(0, PAD_T + li * this.lh - this.scroll.clientHeight * 0.3);
    this.flashLine = li;
    this.caretChanged();
    this.renderOverlay();
    setTimeout(() => { this.flashLine = null; this.renderOverlay(); }, 1400);
  }
  focus() { this.ta.focus({ preventScroll: true }); }
  blur() { this.ta.blur(); }

  // ---------------- find & replace
  find(query, { caseSensitive = false, wholeWord = false, regex = false } = {}) {
    this.matches = [];
    this.matchIndex = 0;
    if (query) {
      const v = this.ta.value;
      let re;
      try { re = new RegExp((wholeWord ? "\\b" : "") + (regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) + (wholeWord ? "\\b" : ""), caseSensitive ? "g" : "gi"); }
      catch { re = null; }
      if (re) { let m; while ((m = re.exec(v)) && this.matches.length < 5000) { if (!m[0].length) { re.lastIndex++; continue; } this.matches.push([m.index, m.index + m[0].length]); } }
      const caret = this.ta.selectionStart;
      const k = this.matches.findIndex((m) => m[0] >= caret);
      this.matchIndex = k >= 0 ? k : 0;
    }
    this.renderOverlay();
    return this.matches.length;
  }
  selectMatch(delta) {
    if (!this.matches.length) return;
    this.matchIndex = (this.matchIndex + delta + this.matches.length) % this.matches.length;
    const [a, b] = this.matches[this.matchIndex];
    this.ta.setSelectionRange(a, b);
    const li = this.lineOf(a);
    this.scroll.scrollTop = Math.max(0, PAD_T + li * this.lh - this.scroll.clientHeight * 0.35);
    const x = PAD_L + this.visualCol(li, a) * this.cw;
    if (x < this.scroll.scrollLeft || x > this.scroll.scrollLeft + this.scroll.clientWidth - 40) this.scroll.scrollLeft = Math.max(0, x - 60);
    this.renderOverlay();
    this.caretChanged();
  }
  replaceCurrent(rep, query, opts) {
    if (!this.matches.length) return;
    const [a, b] = this.matches[this.matchIndex];
    this.apply({ from: a, to: b, insert: rep, caret: a + rep.length });
    this.find(query, opts);
    if (this.matches.length) this.selectMatch(0);
  }
  replaceAll(rep, query, opts) {
    if (!this.matches.length) return 0;
    const n = this.matches.length;
    let v = this.ta.value;
    for (let k = this.matches.length - 1; k >= 0; k--) { const [a, b] = this.matches[k]; v = v.slice(0, a) + rep + v.slice(b); }
    const top = this.scroll.scrollTop;
    this.apply({ from: 0, to: this.ta.value.length, insert: v, caret: Math.min(this.ta.selectionStart, v.length) });
    this.scroll.scrollTop = top;
    this.find(query, opts);
    return n;
  }

  setDiagnostics(d) { this.diagnostics = d || []; this.renderGutter(); this.renderOverlay(); }

  // ---------------- rendering
  scheduleRender() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = null; this.render(); }); }
  visibleRange() {
    const first = Math.max(0, Math.floor((this.scroll.scrollTop - PAD_T) / this.lh) - OVERSCAN);
    const last = Math.min(this.lineStarts.length - 1, first + Math.ceil(this.scroll.clientHeight / this.lh) + OVERSCAN * 2);
    return [first, last];
  }
  render(force = false) {
    const [first, last] = this.visibleRange();
    const r = this.rendered;
    if (!force && r.version === this.version && first >= r.first && last <= r.last) return;
    const a = Math.max(0, first - OVERSCAN), b = Math.min(this.lineStarts.length - 1, last + OVERSCAN);
    this.rendered = { first: a, last: b, version: this.version };
    const v = this.ta.value;
    const from = this.lineStarts[a], to = b + 1 < this.lineStarts.length ? this.lineStarts[b + 1] : v.length;
    let html = "", pos = from;
    const toks = this.tokens;
    let lo = 0, hi = toks.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (toks[m].end <= from) lo = m + 1; else hi = m; }
    for (let k = lo; k < toks.length; k++) {
      const t = toks[k];
      if (t.location >= to) break;
      const s = Math.max(t.location, from), e = Math.min(t.end, to);
      if (s > pos) html += esc(v.slice(pos, s));
      if (t.end > v.length) break;
      const txt = esc(v.slice(s, e));
      html += t.kind === "whitespace" || t.kind === "identifier" ? txt : `<span class="tk-${t.kind}">${txt}</span>`;
      pos = e;
    }
    if (pos < to) html += esc(v.slice(pos, to));
    this.hl.innerHTML = html + "\n";
    this.hl.style.transform = `translateY(${PAD_T + a * this.lh}px)`;
    this.renderGutter();
    this.renderOverlay();
  }
  renderGutter() {
    if (!this.lineNumbers) return;
    const { first, last } = this.rendered;
    if (first < 0) return;
    const sev = {};
    const rank = { error: 0, warning: 1, info: 2 };
    for (const d of this.diagnostics) if (sev[d.line] === undefined || rank[d.severity] < rank[sev[d.line]]) sev[d.line] = d.severity;
    let html = "";
    for (let i = first; i <= last; i++) html += `<div class="${i === this.activeLine ? "active " : ""}${sev[i + 1] ? "m-" + sev[i + 1] : ""}">${i + 1}</div>`;
    this.gutterInner.innerHTML = `<div style="height:${PAD_T + first * this.lh}px"></div>` + html;
  }
  visualCol(li, pos) {
    const start = this.lineStarts[li];
    let col = 0;
    const v = this.ta.value;
    for (let k = start; k < pos; k++) col = v[k] === "\t" ? col + 4 - (col % 4) : col + 1;
    return col;
  }
  box(a, b, cls) {
    const li = this.lineOf(a);
    const x1 = this.visualCol(li, a), x2 = this.visualCol(li, Math.max(a + 1, b));
    return `<div class="${cls}" style="transform:translate(${PAD_L + x1 * this.cw}px,${PAD_T + li * this.lh}px);width:${Math.max(1, x2 - x1) * this.cw}px;height:${this.lh}px"></div>`;
  }
  renderOverlay() {
    const { first, last } = this.rendered;
    if (first < 0) return;
    const lo = this.lineStarts[first], hi = last + 1 < this.lineStarts.length ? this.lineStarts[last + 1] : this.ta.value.length;
    let html = "";
    if (this.flashLine !== null && this.flashLine !== undefined) html += `<div class="ce-flash" style="transform:translateY(${PAD_T + this.flashLine * this.lh}px);height:${this.lh}px"></div>`;
    this.matches.forEach((m, k) => { if (m[1] >= lo && m[0] <= hi) html += this.box(m[0], m[1], k === this.matchIndex ? "ce-match current" : "ce-match"); });
    if (this.bracket) for (const p of this.bracket) if (p >= lo && p <= hi) html += this.box(p, p + 1, "ce-bracket");
    for (const d of this.diagnostics) {
      const li = d.line - 1;
      if (li < first || li > last || li >= this.lineStarts.length) continue;
      const ls = this.lineStarts[li], le = li + 1 < this.lineStarts.length ? this.lineStarts[li + 1] - 1 : this.ta.value.length;
      let a = Math.min(ls + Math.max(0, d.column - 1), le), b = a + 1;
      const tok = this.tokens.find((t) => t.location <= a && a < t.end && t.kind !== "whitespace");
      if (tok) { a = tok.location; b = Math.min(tok.end, le); }
      if (b <= a) b = a + 1;
      html += this.box(a, b, "ce-squiggle sev-" + d.severity);
    }
    this.overlay.innerHTML = html;
  }
}
