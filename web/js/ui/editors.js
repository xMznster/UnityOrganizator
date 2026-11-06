import { h, icon, badge, sheet, menu, chip, toast, copyText, debounce, relTime, dateTime } from "./kit.js";
import { store, KIND, STATUS } from "../store.js";
import { CodeEditor } from "./code-editor.js";
import { analyze, SOURCE_NAMES } from "../core/analyzer.js";
import { messages as UNITY_MESSAGES } from "../core/catalog.js";
import { SNIPPETS } from "../core/templates.js";
import { renderHTML, plainText } from "../core/markdown.js";
import * as EA from "../core/editor-assist.js";
import { fileName } from "../core/files.js";
import { metadataSheet, exportSheet, claudeContextSheet, revisionsSheet, displayName, go } from "./common.js";
import { notFound } from "./views-main.js";

function accessoryBar(buttons) {
  const bar = h("div.accessory", h("div.accessory-scroll", buttons.map(([label, fn, aria]) =>
    h("button.acc-key", { type: "button", "aria-label": aria || label, onpointerdown: (e) => e.preventDefault(), onclick: fn }, typeof label === "string" ? label : label))));
  return bar;
}

const SEV_ICON = { error: "error", warning: "alert", info: "info" };

// ======================================================================= C# script editor
export function scriptEditor(id) {
  const item = store.items.get(id);
  if (!item || item.deletedAt) return notFound();
  const S = {
    fontSize: store.getMeta("editor.fontSize", 14), tabWidth: store.getMeta("editor.tabWidth", 4), useTabs: store.getMeta("editor.useTabs", false),
    autoPair: store.getMeta("editor.autoPair", true), lineNumbers: store.getMeta("editor.lineNumbers", true), live: store.getMeta("editor.liveAnalysis", true),
  };
  const openedContent = item.content;
  store.recordRevision(item, "Beim Öffnen");
  store.updateItem(item, { lastOpenedAt: Date.now() }, { touch: false, silent: true });
  let report = null;
  let caretEl = null;
  let compiler = { diags: JSON.parse(item.compilerResult || "[]"), at: item.compiledAt || null, error: null, busy: false };

  const titleBtn = h("button.title-btn", { onclick: () => metadataSheet(item, report, () => { titleText.textContent = fileName(item); pathText.textContent = store.pathString(item.folderId); runAnalysisCall(0); }) });
  const titleText = h("span.mono", fileName(item)), pathText = h("span.small.muted", store.pathString(item.folderId));
  titleBtn.append(h("span.title-line", icon("code", 12, "script"), titleText), pathText);

  const editor = new CodeEditor({ value: item.content, fontSize: S.fontSize, indentUnit: S.useTabs ? "\t" : " ".repeat(S.tabWidth), autoPair: S.autoPair, lineNumbers: S.lineNumbers,
    onChange: (v) => { save(v); if (S.live) runAnalysisCall(800); updateUndo(); },
    onCaret: (c) => { if (caretEl) caretEl.textContent = `Ln ${c.line}, Sp ${c.column}`; } });
  editor.onFindShortcut = () => toggleFind(true);

  const save = debounce((v) => {
    store.setContent(item, v);
    if (compiler.diags.length) { compiler = { diags: [], at: null, error: null, busy: false }; store.updateItem(item, { compilerResult: null, compiledAt: null }, { touch: false, silent: true }); }
  }, 600);

  const _ra = debounce(() => {
    report = analyze(editor.value, { fileName: item.title });
    editor.setDiagnostics([...report.diagnostics, ...compiler.diags]);
    if (item.lastErrorCount !== report.errorCount || item.lastWarningCount !== report.warningCount || item.scriptKind !== report.scriptKind)
      store.updateItem(item, { lastErrorCount: report.errorCount, lastWarningCount: report.warningCount, scriptKind: report.scriptKind }, { touch: false, silent: true });
    renderStatus();
  }, 0);
  const runAnalysisDelayed = debounce(() => _ra.flush(), 800);
  function runAnalysisCall(ms) { ms ? runAnalysisDelayed() : _ra.flush(); }

  // status bar
  const diagBtn = h("button.status-diag", { onclick: () => analysisSheet() });
  caretEl = h("span.mono.small.muted", "Ln 1, Sp 1");
  const status = h("div.status-bar", diagBtn, h("span.spacer"), caretEl,
    h("button.icon-btn.small", { onclick: () => outlineSheet(), "aria-label": "Struktur" }, icon("outline", 18)),
    h("button.icon-btn.small", { onclick: () => snippetSheet(), "aria-label": "Snippets" }, icon("plus", 18)));
  function renderStatus() {
    const e = (report?.errorCount || 0) + compiler.diags.filter((d) => d.severity === "error").length;
    const w = (report?.warningCount || 0) + compiler.diags.filter((d) => d.severity === "warning").length;
    const i = report?.infoCount || 0;
    diagBtn.setAttribute("aria-label", `Analyse: ${e} Fehler, ${w} Warnungen`);
    diagBtn.replaceChildren(
      !e && !w ? h("span.ok", icon("seal", 15)) : "",
      e ? h("span.err", icon("error", 14), e) : "", w ? h("span.warn", icon("alert", 14), w) : "", i ? h("span.inf", icon("info", 14), i) : "",
      report && report.scriptKind !== "Leer" ? h("span.muted", report.scriptKind) : "");
  }

  // find bar
  const find = { query: "", rep: "", opts: { caseSensitive: false, wholeWord: false, regex: false }, showReplace: false };
  const findCount = h("span.mono.small.muted");
  const findInput = h("input.field.mono.compact", { placeholder: "Suchen", autocapitalize: "off", autocorrect: "off", enterkeyhint: "search",
    oninput: (e) => { find.query = e.target.value; const n = editor.find(find.query, find.opts); findCount.textContent = find.query ? `${n ? editor.matchIndex + 1 : 0}/${n}` : ""; },
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); nav(1); } } });
  const nav = (d) => { editor.selectMatch(d); findCount.textContent = `${editor.matches.length ? editor.matchIndex + 1 : 0}/${editor.matches.length}`; };
  const repInput = h("input.field.mono.compact", { placeholder: "Ersetzen durch", autocapitalize: "off", autocorrect: "off", oninput: (e) => (find.rep = e.target.value) });
  const repRow = h("div.find-row.hidden", repInput,
    h("button.link.strong", { onclick: () => { editor.replaceCurrent(find.rep, find.query, find.opts); nav(0); } }, "Ersetzen"),
    h("button.link.strong", { onclick: () => { const n = editor.replaceAll(find.rep, find.query, find.opts); toast(`${n} ersetzt`); findCount.textContent = "0/0"; } }, "Alle"));
  const optChip = (label, key) => { const c = chip(label, { color: "var(--accent)", selected: find.opts[key], onClick: () => { find.opts[key] = !find.opts[key]; c.classList.toggle("selected"); findInput.dispatchEvent(new Event("input")); } }); return c; };
  const findBar = h("div.find-bar.hidden",
    h("div.find-row", findInput, findCount,
      h("button.icon-btn.small", { onclick: () => nav(-1), "aria-label": "Vorheriger Treffer" }, icon("back", 18)),
      h("button.icon-btn.small.flip", { onclick: () => nav(1), "aria-label": "Nächster Treffer" }, icon("back", 18)),
      h("button.icon-btn.small", { onclick: () => toggleFind(false), "aria-label": "Suche schließen" }, icon("x", 18))),
    h("div.chips", optChip("Aa", "caseSensitive"), optChip("Wort", "wholeWord"), optChip(".*", "regex"),
      chip("Ersetzen", { color: "var(--prompt)", onClick: (e) => { find.showReplace = !find.showReplace; repRow.classList.toggle("hidden", !find.showReplace); e.currentTarget.classList.toggle("selected"); } })),
    repRow);
  function toggleFind(on) {
    findBar.classList.toggle("hidden", !on);
    if (on) setTimeout(() => findInput.focus(), 50); else { editor.find(""); findCount.textContent = ""; }
  }

  // keyboard accessory
  const undoBtn = h("button.acc-key", { type: "button", "aria-label": "Rückgängig", onpointerdown: (e) => e.preventDefault(), onclick: () => editor.undo() }, icon("undo", 16));
  const redoBtn = h("button.acc-key", { type: "button", "aria-label": "Wiederholen", onpointerdown: (e) => e.preventDefault(), onclick: () => editor.redo() }, icon("redo", 16));
  function updateUndo() { undoBtn.disabled = !editor.canUndo; redoBtn.disabled = !editor.canRedo; }
  const keys = [["⇥", () => editor.shift(false), "Einrücken"], ["⇤", () => editor.shift(true), "Ausrücken"], ["{ }", () => editor.wrap("{", "}")], ["( )", () => editor.wrap("(", ")")],
    [";", () => editor.insert(";")], ["=", () => editor.insert(" = ")], ["< >", () => editor.wrap("<", ">")], ["[ ]", () => editor.wrap("[", "]")], ['"', () => editor.insert('"')],
    [".", () => editor.insert(".")], [",", () => editor.insert(", ")], [":", () => editor.insert(":")], ["=>", () => editor.insert(" => ")], ["!", () => editor.insert("!")],
    ["&&", () => editor.insert(" && ")], ["||", () => editor.insert(" || ")], ["+", () => editor.insert("+")], ["-", () => editor.insert("-")], ["*", () => editor.insert("*")],
    ["/", () => editor.insert("/")], ["_", () => editor.insert("_")], ["?", () => editor.insert("?")], ["'", () => editor.insert("'")], ["#", () => editor.insert("#")],
    ["◀", () => editor.moveCaret(-1), "Cursor links"], ["▶", () => editor.moveCaret(1), "Cursor rechts"]];
  const acc = accessoryBar(keys);
  acc.querySelector(".accessory-scroll").append(undoBtn, redoBtn, h("button.acc-key", { type: "button", onpointerdown: (e) => e.preventDefault(), onclick: () => editor.blur(), "aria-label": "Tastatur ausblenden" }, icon("keyboardDown", 16)));
  editor.ta.addEventListener("focus", () => acc.classList.add("show"));
  editor.ta.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== editor.ta) acc.classList.remove("show"); }, 100));

  const moreBtn = h("button.icon-btn", { "aria-label": "Mehr", onclick: () => menu(fileName(item), [
    { label: "Rückgängig", icon: "undo", disabled: !editor.canUndo, onClick: () => editor.undo() },
    { label: "Wiederholen", icon: "redo", disabled: !editor.canRedo, onClick: () => editor.redo() },
    "-",
    { label: "Snippet einfügen", icon: "plus", onClick: snippetSheet },
    { label: "Dokument formatieren", icon: "list", onClick: () => editor.format() },
    { label: "Kommentar umschalten", icon: "code", onClick: () => editor.toggleComment() },
    { label: "Gesamten Code kopieren", icon: "copy", onClick: () => copyText(editor.value, "Code kopiert") },
    { label: `Schrift größer (${editor.fontSize + 1} pt)`, icon: "plus", onClick: () => { editor.setFontSize(editor.fontSize + 1); store.setMeta("editor.fontSize", editor.fontSize); } },
    { label: `Schrift kleiner (${editor.fontSize - 1} pt)`, icon: "outline", onClick: () => { editor.setFontSize(editor.fontSize - 1); store.setMeta("editor.fontSize", editor.fontSize); } },
    "-",
    { label: "Eigenschaften", icon: "info", onClick: () => titleBtn.click() },
    { label: "Als .cs exportieren / teilen", icon: "share", onClick: () => { flush(); exportSheet({ itemIds: [item.id], title: item.title }); } },
    { label: "Als Claude-Kontext", icon: "sparkles", onClick: () => { flush(); claudeContextSheet([item]); } },
    { label: "Versionen", icon: "clock", onClick: () => { flush(); revisionsSheet(item, (c) => editor.setValue(c)); } },
    { label: item.isFavorite ? "Favorit entfernen" : "Als Favorit markieren", icon: "star", onClick: () => store.toggleFavorite(item) },
    { label: "Duplizieren", icon: "copy", onClick: () => { flush(); store.duplicate(item); } },
  ]) }, icon("more", 22));

  const head = h("header.screen-head.editor-head",
    h("button.icon-btn", { onclick: () => history.length > 1 ? history.back() : go("#/home"), "aria-label": "Zurück" }, icon("back", 22)),
    titleBtn,
    h("div.head-actions", h("button.icon-btn", { onclick: () => toggleFind(findBar.classList.contains("hidden")), "aria-label": "Suchen und Ersetzen" }, icon("search", 20)), moreBtn));
  const root = h("section.screen.editor-screen.code-theme-" + store.getMeta("editor.theme", "night"), head, findBar, editor.el, status, acc);

  function flush() {
    save.flush(editor.value);
    if (item.content !== openedContent) store.recordRevision(item, "Bearbeitung");
    store.refreshScriptMeta(item, true);
    store.putItem(item);
  }

  // ---------- sheets
  function analysisSheet() {
    runAnalysisCall(0);
    let tab = 0;
    sheet("Code-Analyse", (close) => {
      const body = h("div");
      const jump = (d) => { close(); setTimeout(() => { editor.goTo(d.line, d.column, false); }, 300); };
      const diagRow = (d) => h("div.diag", { onclick: () => jump(d) },
        h("span.diag-icon.sev-" + d.severity, icon(SEV_ICON[d.severity], 16)),
        h("div.diag-main", h("div", d.message), d.suggestion ? h("div.diag-sugg", "→ " + d.suggestion) : "",
          h("div.diag-meta.mono", `Zeile ${d.line} · ${d.ruleID} · ${SOURCE_NAMES[d.source]}`)));
      const render = () => {
        body.replaceChildren();
        if (tab === 0) {
          body.append(h("div.summary-tiles",
            tile(report.errorCount, "Fehler", "var(--error)"), tile(report.warningCount, "Warnungen", "var(--warning)"), tile(report.infoCount, "Hinweise", "var(--info)"), tile(report.lineCount, "Zeilen", "var(--text2)")));
          if (!report.diagnostics.length) body.append(h("div.card.ok-card", icon("seal", 18), h("span", "Keine Probleme in der lokalen Analyse gefunden.")), h("p.hint", "Lokal geprüft: Syntax, Struktur, C#-Heuristiken und Unity-Regeln. Eine echte Kompilierung gegen die Unity-Assemblies erfolgt über den PC-Companion."));
          for (const src of ["lexer", "syntax", "csharp", "unity"]) {
            const list = report.diagnostics.filter((d) => d.source === src);
            if (list.length) body.append(h("div.form-section", `${SOURCE_NAMES[src]} (${list.length})`), h("div.diag-list", list.map(diagRow)));
          }
          const url = store.getMeta("compiler.url", "");
          body.append(h("div.form-section", "Echte Kompilierung (Roslyn auf dem PC)"));
          if (compiler.busy) body.append(h("p.muted", "Kompiliere auf dem PC …"));
          if (compiler.error) body.append(h("p.err", compiler.error));
          if (compiler.at && !compiler.busy) body.append(compiler.diags.length ? h("div.diag-list", compiler.diags.map(diagRow)) : h("div.card.ok-card", icon("seal", 18), h("span", `Erfolgreich kompiliert (${relTime(Date.parse(compiler.at))})`)));
          body.append(h("button.btn.secondary.wide", { disabled: !url || compiler.busy, onclick: async () => { await compileOnPC(); render(); } }, icon("desktop", 16), url ? "Jetzt auf dem PC kompilieren" : "PC-Compiler unter „PC & Claude“ einrichten"),
            h("p.hint", "Im Browser/auf iOS kann kein C#-Compiler mit Unity-Referenzen laufen. Der PC-Companion (companion/VaultCompiler) kompiliert mit Roslyn gegen deine Unity-Installation. Alternativ: Ergebnisse über die GitHub-Synchronisierung."));
        } else {
          body.append(h("div.diag-list", report.checks.map((c) => h("div.diag", h("span.diag-icon" + (c.performed ? ".sev-ok" : ".sev-off"), icon(c.performed ? "check" : "x", 16)), h("div.diag-main", h("div", h("b", c.name)), h("div.diag-meta", c.detail))))),
            h("div.diag", h("span.diag-icon" + (compiler.at ? ".sev-ok" : ".sev-off"), icon(compiler.at ? "check" : "clock", 16)), h("div.diag-main", h("div", h("b", "Roslyn-Kompilierung (PC)")), h("div.diag-meta", compiler.at ? "Zuletzt: " + dateTime(Date.parse(compiler.at)) : "Noch nicht ausgeführt"))),
            h("p.hint", "Die lokale Analyse ist eine eigene Implementierung (Lexer + fehlertoleranter Parser + Regelwerk). Sie erkennt Syntaxfehler und typische Unity-Probleme, ersetzt aber keinen Compiler: Tippfehler in Methodennamen fremder Klassen oder falsche Typen findet nur der Roslyn-Compiler."));
        }
      };
      const seg = h("div.segmented.wide", h("button.on", { onclick: (e) => { tab = 0; seg.children[0].classList.add("on"); seg.children[1].classList.remove("on"); render(); } }, "Probleme"),
        h("button", { onclick: () => { tab = 1; seg.children[1].classList.add("on"); seg.children[0].classList.remove("on"); render(); } }, "Was wurde geprüft?"));
      render();
      return h("div.form", seg, body);
    }, { full: true });
  }
  const tile = (v, l, c) => h("div.tile", h("div.tile-v", { style: { color: c } }, String(v)), h("div.tile-l", l));

  async function compileOnPC() {
    flush();
    const url = store.getMeta("compiler.url", "").trim();
    compiler.busy = true; compiler.error = null;
    try {
      if (location.protocol === "https:" && url.startsWith("http:")) throw new Error("Safari blockiert HTTP-Aufrufe aus einer HTTPS-App. Der Compiler muss über HTTPS erreichbar sein (siehe Hinweis unter PC & Claude → PC-Compiler).");
      const proj = store.root(item.folderId);
      const others = store.liveItems().filter((o) => o.kind === "script" && o.id !== item.id && (!proj || store.root(o.folderId)?.id === proj.id));
      const main = fileName(item), used = new Set([main.toLowerCase()]);
      const files = [{ path: main, content: item.content }];
      for (const o of others) { let p = fileName(o); let n = 2; while (used.has(p.toLowerCase())) p = p.replace(/(\.cs)$/, ` (${n++})$1`); used.add(p.toLowerCase()); files.push({ path: p, content: o.content }); }
      const token = store.getMeta("compiler.token", "");
      const res = await fetch(url.replace(/\/+$/, "") + "/compile", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ files }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const r = await res.json();
      compiler.diags = r.diagnostics.filter((d) => d.file === main).map((d) => ({ severity: d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "info", source: "compiler", ruleID: d.id, message: d.message, line: d.line, column: d.column, suggestion: null }));
      compiler.at = r.compiledAt;
      store.updateItem(item, { compilerResult: JSON.stringify(compiler.diags), compiledAt: r.compiledAt }, { touch: false, silent: true });
      editor.setDiagnostics([...report.diagnostics, ...compiler.diags]);
      renderStatus();
    } catch (e) { compiler.error = e.message.includes("Failed to fetch") || e.message.includes("Load failed") ? "PC-Compiler nicht erreichbar: " + e.message : e.message; }
    compiler.busy = false;
  }

  function outlineSheet() {
    runAnalysisCall(0);
    sheet("Struktur", (close) => {
      const jump = (line) => { close(); setTimeout(() => editor.goTo(line, 1, false), 300); };
      const row = (ic, color, title, detail, line) => h("div.row.outline-row", { onclick: () => jump(line) }, h("span.outline-icon", { style: { color } }, ic), h("div.row-main", h("div.row-title.mono.small", title), detail ? h("div.row-sub.mono.small", detail) : ""), h("span.time", String(line)));
      if (!report.types.length) return h("div.empty", h("h3", "Keine Struktur"), h("p.muted", "Sobald das Skript Typen und Methoden enthält, erscheinen sie hier."));
      return h("div.list", report.types.map((t) => [
        h("div.form-section", `${t.kind} ${t.name}`),
        row(t.kind[0].toUpperCase(), "var(--accent)", t.name, t.bases.length ? ": " + t.bases.join(", ") : t.kind, t.line),
        ...t.fields.map((f) => row("F", "var(--info)", f.name, f.typeName, f.line)),
        ...t.properties.map((p) => row("P", "var(--prompt)", p.name, p.typeName, p.line)),
        ...t.methods.map((m) => row(UNITY_MESSAGES[m.name] ? "⚡" : "M", UNITY_MESSAGES[m.name] ? "var(--amber)" : "var(--script)", `${m.name}(${m.parameterTypes.join(", ")})`, m.returnType, m.line)),
      ]), report.usings.length ? [h("div.form-section", "using"), h("pre.preview-box", report.usings.join("\n"))] : "");
    }, { full: true });
  }

  function snippetSheet() {
    sheet("Snippet einfügen", (close) => h("div.list", SNIPPETS.map((s) => h("div.row", { onclick: () => { close(); setTimeout(() => { editor.insertSnippet(s.code); editor.focus(); }, 280); } },
      h("div.row-main", h("div.row-title", s.title), h("pre.snippet-pre", s.code.replace("$0", "▍")))))), { full: true });
  }

  setTimeout(() => { runAnalysisCall(0); updateUndo(); }, 0);
  return {
    root, tab: null, editing: true, keepOnStore: true,
    onHide: () => { flush(); store.emit(); },
    onShow: () => editor.render(true),
  };
}

// ======================================================================= Notes & prompts
export function noteEditor(id) {
  const item = store.items.get(id);
  if (!item || item.deletedAt) return notFound();
  const openedContent = item.content;
  store.recordRevision(item, "Beim Öffnen");
  store.updateItem(item, { lastOpenedAt: Date.now() }, { touch: false, silent: true });
  let mode = item.content ? "preview" : "edit";

  const save = debounce((v) => { store.setContent(item, v); if (titleInput.value !== item.title && document.activeElement !== titleInput) titleInput.value = item.title; stats(); }, 500);
  const ta = h("textarea.note-input", { value: item.content, placeholder: item.kind === "prompt" ? "Prompt schreiben … (Markdown möglich)" : "Schreiben … # Überschrift, - Liste, ```csharp für Code", spellcheck: true,
    oninput: () => { save(ta.value); pushHist(); } });
  // own undo history for the note
  const hist = [item.content]; let hi = 0, lastT = 0;
  const pushHist = () => { const now = Date.now(); hist.length = hi + 1; if (now - lastT < 700 && hi > 0) hist[hi] = ta.value; else { hist.push(ta.value); hi++; } lastT = now; };
  const restore = (k) => { hi = k; ta.value = hist[k]; save(ta.value); };
  ta.addEventListener("beforeinput", (e) => {
    if (e.inputType === "historyUndo") { e.preventDefault(); if (hi > 0) restore(hi - 1); return; }
    if (e.inputType === "historyRedo") { e.preventDefault(); if (hi < hist.length - 1) restore(hi + 1); return; }
    if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") {
      const s = ta.selectionStart, cont = EA.listContinuation(ta.value, s);
      if (cont === null) return;
      e.preventDefault();
      if (cont === "") { const ls = ta.value.lastIndexOf("\n", s - 1) + 1; ta.setRangeText("", ls, s, "end"); }
      else ta.setRangeText("\n" + cont, s, ta.selectionEnd, "end");
      ta.dispatchEvent(new Event("input"));
    }
  });
  const wrapSel = (pre, suf) => { const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e); ta.setRangeText(pre + sel + suf, s, e, "end"); ta.setSelectionRange(s + pre.length + sel.length, s + pre.length + sel.length); ta.dispatchEvent(new Event("input")); };
  const linePrefix = (p) => { const s = ta.selectionStart, ls = ta.value.lastIndexOf("\n", s - 1) + 1; ta.setRangeText(p, ls, ls, "preserve"); ta.setSelectionRange(s + p.length, s + p.length); ta.dispatchEvent(new Event("input")); };
  const ins = (t) => { ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, "end"); ta.dispatchEvent(new Event("input")); };

  const previewEl = h("div.md-preview");
  previewEl.addEventListener("click", (e) => { const b = e.target.closest(".copy-code"); if (b) copyText(b.dataset.code, "Code kopiert"); });
  const titleInput = h("textarea.note-title", { rows: 1, value: item.title, placeholder: item.kind === "prompt" ? "Prompt-Titel" : "Titel",
    oninput: (e) => { store.updateItem(item, { title: e.target.value.replace(/\n/g, " ") }, { silent: true }); autosize(); } });
  const autosize = () => { titleInput.style.height = "auto"; titleInput.style.height = titleInput.scrollHeight + "px"; };
  const chipsRow = h("button.note-chips", { onclick: () => metadataSheet(item, null, renderChips) });
  function renderChips() {
    chipsRow.replaceChildren(h("span.chip.static", { style: { "--c": KIND[item.kind].color } }, icon(KIND[item.kind].icon, 12), KIND[item.kind].name),
      item.category ? h("span.chip.static", item.category) : "", ...(item.tags || []).slice(0, 3).map((t) => h("span.tag", "#" + t)),
      !item.category && !(item.tags || []).length ? h("span.link", "Kategorie & Tags hinzufügen") : "");
    titleInput.value = item.title; autosize();
  }
  renderChips();
  const seg = h("div.segmented.wide");
  const body = h("div.note-body");
  const statsEl = h("span.mono.small.muted");
  const stats = () => { const words = ta.value.split(/\s+/).filter(Boolean).length; statsEl.textContent = `${words} Wörter · ${ta.value.length} Zeichen · gespeichert ${relTime(item.modifiedAt)}`; };
  function setMode(m) {
    mode = m;
    seg.replaceChildren(h("button" + (m === "edit" ? ".on" : ""), { onclick: () => setMode("edit") }, "Bearbeiten"), h("button" + (m === "preview" ? ".on" : ""), { onclick: () => setMode("preview") }, "Vorschau"));
    if (m === "edit") { body.replaceChildren(ta); setTimeout(() => ta.focus({ preventScroll: true }), 60); }
    else { save.flush(ta.value); previewEl.innerHTML = ta.value.trim() ? renderHTML(ta.value) : '<p class="muted">Noch kein Inhalt. Wechsle zu „Bearbeiten“, um zu schreiben.</p>'; body.replaceChildren(previewEl); }
  }
  const acc = accessoryBar([["H1", () => linePrefix("# ")], ["H2", () => linePrefix("## ")], ["H3", () => linePrefix("### ")], ["B", () => wrapSel("**", "**"), "Fett"], ["I", () => wrapSel("*", "*"), "Kursiv"],
    ["`", () => wrapSel("`", "`"), "Code"], ["```", () => wrapSel("```csharp\n", "\n```"), "Codeblock"], ["•", () => linePrefix("- "), "Liste"], ["1.", () => linePrefix("1. "), "Nummerierte Liste"],
    ["☐", () => linePrefix("- [ ] "), "Checkliste"], [">", () => linePrefix("> "), "Zitat"], ["Link", () => wrapSel("[", "](https://)")], ["—", () => ins("\n---\n"), "Trennlinie"],
    ["↶", () => { if (hi > 0) restore(hi - 1); }, "Rückgängig"], ["↷", () => { if (hi < hist.length - 1) restore(hi + 1); }, "Wiederholen"], ["⌄", () => ta.blur(), "Tastatur ausblenden"]]);
  ta.addEventListener("focus", () => acc.classList.add("show"));
  ta.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== ta) acc.classList.remove("show"); }, 100));

  const flush = () => { save.flush(ta.value); if (item.content !== openedContent) store.recordRevision(item, "Bearbeitung"); };
  const head = h("header.screen-head.editor-head",
    h("button.icon-btn", { onclick: () => history.length > 1 ? history.back() : go("#/home"), "aria-label": "Zurück" }, icon("back", 22)),
    h("div.title-btn", h("span.small.muted", store.pathString(item.folderId))),
    h("div.head-actions",
      h("button.icon-btn" + (item.isFavorite ? ".fav-on" : ""), { onclick: (e) => { store.toggleFavorite(item); e.currentTarget.classList.toggle("fav-on", item.isFavorite); }, "aria-label": "Favorit" }, icon("star", 20)),
      h("button.icon-btn", { "aria-label": "Mehr", onclick: () => menu(item.title, [
        { label: "Text kopieren", icon: "copy", onClick: () => copyText(ta.value, item.kind === "prompt" ? "Prompt kopiert – bereit für Claude" : "Text kopiert") },
        { label: "Als reinen Text kopieren", icon: "note", onClick: () => copyText(plainText(ta.value), "Als reiner Text kopiert") },
        { label: "Eigenschaften", icon: "info", onClick: () => metadataSheet(item, null, renderChips) },
        { label: "Exportieren / Teilen", icon: "share", onClick: () => { flush(); exportSheet({ itemIds: [item.id], title: item.title }); } },
        { label: "Als Claude-Kontext", icon: "sparkles", onClick: () => { flush(); claudeContextSheet([item]); } },
        { label: "Versionen", icon: "clock", onClick: () => { flush(); revisionsSheet(item, (c) => { ta.value = c; setMode(mode); }); } },
        { label: "Duplizieren", icon: "copy", onClick: () => { flush(); store.duplicate(item); } },
        { label: item.kind === "prompt" ? "In Notiz umwandeln" : "In Prompt umwandeln", icon: "refresh", onClick: () => { store.updateItem(item, { kind: item.kind === "prompt" ? "note" : "prompt" }); renderChips(); } },
      ]) }, icon("more", 22))));
  const bottom = h("div.status-bar", statsEl, h("span.spacer"),
    item.kind === "prompt" ? h("button.btn.small.prompt", { onclick: () => copyText(ta.value, "Prompt kopiert – bereit für Claude") }, icon("copy", 14), "Kopieren") : "");
  const root = h("section.screen.editor-screen.note-screen", head, h("div.note-head", titleInput, chipsRow, seg), body, bottom, acc);
  setMode(mode);
  stats();
  setTimeout(autosize, 0);
  return { root, tab: null, editing: true, keepOnStore: true, onHide: () => { flush(); store.emit(); } };
}

export function itemEditor(id) {
  const item = store.items.get(id);
  if (!item) return notFound();
  return item.kind === "script" ? scriptEditor(id) : noteEditor(id);
}
