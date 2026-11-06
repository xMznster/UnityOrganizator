import { h, icon, badge, relTime, sheet, menu, chip, toast, sectionHeader, empty, confirmDialog } from "./kit.js";
import { store, KIND, STATUS } from "../store.js";
import { go, openItem, openFolder, itemRow, folderRow, displayName, preview, pickFolder, newScriptSheet, folderEditSheet, folderMenu, itemMenu, importFiles, exportSheet, claudeContextSheet } from "./common.js";
import { highlightCSharp, suggestedTitle } from "../core/markdown.js";
import { analyze } from "../core/analyzer.js";
import { lex } from "../core/lexer.js";
import { SearchIndex } from "../core/search.js";
import { esc } from "../core/markdown.js";

export function screen({ title, large = false, back = false, actions = [] }) {
  const content = h("div.screen-content");
  const head = h("header.screen-head" + (large ? ".large" : ""),
    back ? h("button.icon-btn", { onclick: () => history.length > 1 ? history.back() : go("#/home"), "aria-label": "Zurück" }, icon("back", 22)) : h("span"),
    h("h1.screen-title", title),
    h("div.head-actions", actions));
  return { root: h("section.screen", head, content), content, head };
}

function codePeek(code, lines = 5) {
  const all = code.split("\n");
  const start = Math.max(0, all.findIndex((l) => l.trim() && !l.trim().startsWith("using")));
  return h("pre.peek", { html: highlightCSharp(all.slice(start, start + lines).join("\n")) });
}

// ---------------- Dashboard
export function dashboard() {
  const { root, content } = screen({ title: "", actions: [] });
  root.classList.add("dashboard");
  const items = store.liveItems().sort((a, b) => b.modifiedAt - a.modifiedAt);
  const scripts = items.filter((i) => i.kind === "script"), notes = items.filter((i) => i.kind === "note"), prompts = items.filter((i) => i.kind === "prompt");
  const projects = store.roots(), favorites = items.filter((i) => i.isFavorite);
  const last = items.filter((i) => i.lastOpenedAt).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
  const hour = new Date().getHours();
  const greet = hour >= 5 && hour < 11 ? "Guten Morgen" : hour < 17 ? "Hallo" : hour < 22 ? "Guten Abend" : "Late-Night-Dev";
  const errorScripts = scripts.filter((s) => s.lastErrorCount > 0).length;
  const totalLines = scripts.reduce((a, s) => a + s.content.split("\n").length, 0);

  content.append(
    h("div.hero",
      h("div", h("div.eyebrow", "UNITY DEVELOPER VAULT"), h("h1.greet", greet), h("div.muted", new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }))),
      h("div.logo", icon("braces", 24))),
    h("div.stats",
      stat(scripts.length, "Skripte", "code", "var(--script)", () => go("#/search?kind=script")),
      stat(notes.length, "Ideen & Notizen", "note", "var(--note)", () => go("#/search?kind=note")),
      stat(prompts.length, "Prompts", "sparkles", "var(--prompt)", () => go("#/search?kind=prompt")),
      stat(projects.length, "Projekte", "grid", "var(--amber)", () => go("#/vault"))),
    h("div.card.health", icon(errorScripts ? "error" : "seal", 18, errorScripts ? "err" : "ok"),
      h("span", errorScripts ? `${errorScripts} Skript${errorScripts === 1 ? "" : "e"} mit Fehlern` : "Alle Skripte ohne Syntaxfehler"), h("span.spacer"), h("span.mono.muted.small", `${totalLines} Zeilen C#`)),
    sectionHeader("Schnellzugriff"),
    h("div.quick",
      quick("Neue Notiz", "Idee festhalten", "edit", "var(--note)", () => openItem(store.createItem("note"))),
      quick("Neues Skript", "Aus Vorlage", "code", "var(--script)", () => newScriptSheet(null)),
      quick("Neuer Prompt", "Für Claude", "sparkles", "var(--prompt)", () => openItem(store.createItem("prompt"))),
      quick("Aus Zwischenablage", "C# wird erkannt", "copy", "var(--accent)", captureClipboard)),
    h("div.row-buttons",
      h("button.btn.secondary", { onclick: () => importFiles(null) }, icon("download", 16), "Importieren"),
      h("button.btn.secondary", { onclick: () => folderEditSheet({}) }, icon("folderPlus", 16), "Neues Projekt")));

  if (!items.length && !projects.length) {
    content.append(h("div.card.welcome", h("h3", "Willkommen in deinem Vault"),
      h("p.muted", "Alles wird lokal auf deinem iPhone gespeichert und funktioniert offline. Lege eigene Projekte an oder starte mit einer Ordnerstruktur für Horror Game, Monster Game, General Unity, Blender und App Development – alles frei umbenennbar."),
      h("div.row-buttons", h("button.btn", { onclick: () => store.createStarterStructure() }, "Startstruktur anlegen"), h("button.btn.secondary", { onclick: () => folderEditSheet({}) }, "Eigenes Projekt"))));
  }
  if (last) {
    content.append(h("button.card.continue", { onclick: () => openItem(last) },
      h("div.continue-head", h("span.eyebrow", "WEITERARBEITEN"), h("span.mono.muted.small", relTime(last.lastOpenedAt))),
      h("div.continue-title", badge(KIND[last.kind].icon, KIND[last.kind].color, 32), h("div", h("div.row-title" + (last.kind === "script" ? ".mono" : ""), displayName(last)), h("div.row-sub", store.pathString(last.folderId)))),
      last.kind === "script" ? codePeek(last.content, 6) : h("p.muted.clamp3", preview(last))));
  }
  if (scripts.length) {
    content.append(sectionHeader("Zuletzt bearbeitete Skripte", scripts.length), h("div.hscroll", scripts.slice(0, 8).map((s) =>
      h("button.card.script-card", { onclick: () => openItem(s) },
        h("div.row-title.mono", icon("code", 12, "script"), displayName(s)), codePeek(s.content, 4),
        h("div.script-foot", s.status ? h("span", h("i.dot", { style: { background: STATUS[s.status].color } }), STATUS[s.status].name) : "", h("span.spacer"),
          s.lastErrorCount ? h("span.err.small", icon("error", 11), s.lastErrorCount) : "")))));
  }
  const others = items.filter((i) => i.kind !== "script").slice(0, 5);
  if (others.length) content.append(sectionHeader("Zuletzt bearbeitete Notizen & Prompts"), h("div.list.card-list", others.map((i) => itemRow(i, { showPath: true }))));
  if (favorites.length) content.append(sectionHeader("Favoriten", favorites.length), h("div.hscroll", favorites.slice(0, 12).map((f) =>
    h("button.card.fav-chip", { onclick: () => openItem(f) }, icon(KIND[f.kind].icon, 16), h("span", f.title), icon("star", 10, "fav")))));
  if (projects.length) content.append(sectionHeader("Meine Projekte", projects.length), h("div.project-grid", projects.map((p) =>
    h("button.card.project", { onclick: () => openFolder(p), style: { "--c": p.color } }, h("div.project-top", icon(p.icon || "folder", 20), p.isFavorite ? icon("star", 11, "fav") : ""),
      h("div.row-title", p.name), h("div.mono.muted.small", `${store.totalCount(p.id)} Einträge · ${store.children(p.id).length} Ordner`)))));
  if (scripts.length) {
    const n = (k) => scripts.filter((s) => (s.status || "inDevelopment") === k).length;
    content.append(sectionHeader("Skript-Status"), h("div.card",
      h("div.status-bar", Object.keys(STATUS).map((k) => h("i", { style: { flex: n(k) || 0, background: STATUS[k].color } }))),
      h("div.status-legend", Object.entries(STATUS).map(([k, s]) => h("span", h("i.dot", { style: { background: s.color } }), `${s.name} ${n(k)}`)))));
  }
  const lastSync = store.getMeta("sync.lastDate");
  content.append(sectionHeader("PC-Workflow"), h("button.card.row-card", { onclick: () => go("#/workflow") }, badge("refresh", "var(--info)"),
    h("div.row-main", h("div.row-title", store.getMeta("github.owner") ? "GitHub-Synchronisierung" : "Synchronisierung & Export"),
      h("div.row-sub", lastSync ? `Zuletzt ${relTime(lastSync)}` : "GitHub-Sync, ZIP-Export, Claude-Skills")), icon("chevronRight", 16, "muted")));
  return { root, tab: "home" };
}

function stat(value, label, ic, color, onClick) {
  return h("button.card.stat", { onclick: onClick }, badge(ic, color, 36), h("div", h("div.stat-value", String(value)), h("div.stat-label", label)));
}
function quick(title, sub, ic, color, onClick) {
  return h("button.quick-action", { style: { "--c": color }, onclick: onClick }, icon(ic, 20), h("div", h("div.qa-title", title), h("div.qa-sub", sub)));
}

async function captureClipboard() {
  let text = "";
  try { text = await navigator.clipboard.readText(); } catch { /* permission denied */ }
  if (!text || !text.trim()) {
    const { prompt } = await import("./kit.js");
    text = await prompt("Text einfügen", { placeholder: "Hier einfügen (lange tippen → Einsetzen)", label: "Übernehmen" });
    if (!text) return;
  }
  const r = analyze(text);
  const toks = lex(text).tokens.filter((t) => t.kind !== "whitespace");
  const kwRatio = toks.filter((t) => t.kind === "keyword").length / Math.max(1, toks.length);
  if (r.types.length || text.includes("using UnityEngine") || (kwRatio > 0.08 && text.includes(";") && text.includes("{"))) {
    const name = r.types.find((t) => t.nestingDepth === 0)?.name || "ClipboardScript";
    openItem(store.createItem("script", { title: name, content: text }));
  } else {
    const lower = text.toLowerCase();
    const isPrompt = /claude|^you are|^du bist|schreibe ein|write a/.test(lower);
    openItem(store.createItem(isPrompt ? "prompt" : "note", { title: suggestedTitle(text) || "Aus Zwischenablage", content: text }));
  }
}

// ---------------- Vault root
export function vaultRoot() {
  const { root, content } = screen({ title: "Vault", large: true, actions: [
    h("button.icon-btn", { onclick: () => menu("Neu", [
      { label: "Neues Projekt", icon: "folderPlus", onClick: () => folderEditSheet({}) },
      { label: "Neue Notiz (Inbox)", icon: "note", onClick: () => openItem(store.createItem("note")) },
      { label: "Neuer Prompt (Inbox)", icon: "sparkles", onClick: () => openItem(store.createItem("prompt")) },
      { label: "Neues Skript (Inbox)", icon: "code", onClick: () => newScriptSheet(null) },
      "-",
      { label: "Dateien importieren", icon: "download", onClick: () => importFiles(null) },
      { label: "Startstruktur anlegen", icon: "grid", onClick: () => store.createStarterStructure() },
    ]), "aria-label": "Neu" }, icon("plus", 24))] });
  const inbox = store.itemsIn(null), fav = store.liveItems().filter((i) => i.isFavorite), trash = store.trashed();
  const projects = store.roots();
  content.append(
    h("div.list.card-list",
      h("div.row", { onclick: () => go("#/inbox") }, badge("inbox", "var(--accent)"), h("div.row-main", h("div.row-title", "Inbox"), h("div.row-sub.mono", "Einträge ohne Ordner")), h("span.count", inbox.length)),
      h("div.row", { onclick: () => go("#/favorites") }, badge("star", "var(--amber)"), h("div.row-main", h("div.row-title", "Favoriten")), h("span.count", fav.length))),
    sectionHeader("Projekte", projects.length));
  if (!projects.length) content.append(h("div.card", h("p.muted", "Noch keine Projekte. Lege eigene Ordner an oder starte mit der vorgeschlagenen Struktur."),
    h("div.row-buttons", h("button.btn", { onclick: () => folderEditSheet({}) }, "Projekt anlegen"), h("button.btn.secondary", { onclick: () => store.createStarterStructure() }, "Startstruktur"))));
  else content.append(h("div.list.card-list", projects.map((p, k) => {
    const row = folderRow(p);
    row.append(h("button.icon-btn.small", { onclick: (e) => { e.stopPropagation(); folderMenu(p); }, "aria-label": "Aktionen" }, icon("more", 18)));
    if (k > 0) row.prepend(h("button.reorder", { onclick: (e) => { e.stopPropagation(); const prev = projects[k - 1]; const a = prev.sortIndex; store.updateFolder(prev, { sortIndex: p.sortIndex }); store.updateFolder(p, { sortIndex: a === p.sortIndex ? a - 1 : a }); }, "aria-label": "Nach oben" }, "↑"));
    return row;
  })));
  content.append(h("div.list.card-list.mt", h("div.row", { onclick: () => go("#/trash") }, badge("trash", "var(--text2)"), h("div.row-main", h("div.row-title", "Papierkorb")), h("span.count", trash.length))));
  return { root, tab: "vault" };
}

// ---------------- Folder
const selection = new Set();
export function folderView(id) {
  const f = store.folders.get(id);
  if (!f) return notFound();
  const sortMode = store.getMeta("folder.sort", "modified");
  const filter = store.getMeta("folder.filter", "");
  const selecting = folderView.selecting === id;
  const { root, content } = screen({ title: f.name, back: true, actions: [
    h("button.icon-btn", { onclick: () => menu(f.name, [
      { label: "Sortierung: " + ({ modified: "Zuletzt geändert", name: "Name", kind: "Typ", created: "Erstellt" }[sortMode]), icon: "list", onClick: () => menu("Sortieren nach", ["modified", "name", "kind", "created"].map((m) => ({ label: { modified: "Zuletzt geändert", name: "Name", kind: "Typ", created: "Erstellt" }[m], icon: m === sortMode ? "check" : null, onClick: () => { store.setMeta("folder.sort", m); store.emit(); } }))) },
      { label: "Filter: " + (filter ? KIND[filter].plural : "Alle Typen"), icon: "filter", onClick: () => menu("Anzeigen", [{ label: "Alle Typen", icon: !filter ? "check" : null, onClick: () => { store.setMeta("folder.filter", ""); store.emit(); } }, ...Object.entries(KIND).map(([k, v]) => ({ label: v.plural, icon: filter === k ? "check" : null, onClick: () => { store.setMeta("folder.filter", k); store.emit(); } }))]) },
      { label: selecting ? "Auswahl beenden" : "Mehrere auswählen", icon: "check", onClick: () => { folderView.selecting = selecting ? null : id; selection.clear(); store.emit(); } },
      "-",
      { label: "Ordner-Aktionen …", icon: "more", onClick: () => folderMenu(f) },
    ]), "aria-label": "Mehr" }, icon("more", 22)),
    h("button.icon-btn", { onclick: () => menu("Neu in " + f.name, [
      { label: "Notiz / Idee", icon: "note", onClick: () => openItem(store.createItem("note", { folderId: f.id })) },
      { label: "Prompt", icon: "sparkles", onClick: () => openItem(store.createItem("prompt", { folderId: f.id })) },
      { label: "C#-Skript", icon: "code", onClick: () => newScriptSheet(f.id) },
      "-",
      { label: "Unterordner", icon: "folderPlus", onClick: () => folderEditSheet({ parentId: f.id }) },
      { label: "Dateien importieren", icon: "download", onClick: () => importFiles(f.id) },
    ]), "aria-label": "Neu" }, icon("plus", 24))] });
  const crumbs = store.path(f.id);
  if (crumbs.length > 1) content.append(h("div.crumbs", crumbs.slice(0, -1).map((c) => h("button.link", { onclick: () => openFolder(c) }, c.name + " /"))));
  const kids = store.children(f.id);
  if (kids.length) content.append(sectionHeader("Ordner", kids.length), h("div.list.card-list", kids.map((c) => { const r = folderRow(c); r.append(h("button.icon-btn.small", { onclick: (e) => { e.stopPropagation(); folderMenu(c); } }, icon("more", 18))); return r; })));
  let items = store.itemsIn(f.id);
  if (filter) items = items.filter((i) => i.kind === filter);
  const sorters = { modified: (a, b) => b.modifiedAt - a.modifiedAt, name: (a, b) => a.title.localeCompare(b.title), kind: (a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title), created: (a, b) => b.createdAt - a.createdAt };
  items.sort(sorters[sortMode]);
  content.append(sectionHeader("Einträge", items.length));
  if (!items.length) content.append(empty("note", "Leer", `Erstelle Notizen, Prompts oder Skripte in „${f.name}“.`, { label: "Neue Notiz", onClick: () => openItem(store.createItem("note", { folderId: f.id })) }));
  else content.append(h("div.list.card-list", items.map((i) => {
    if (selecting) return itemRow(i, { selectable: { selected: selection.has(i.id) }, onClick: () => { selection.has(i.id) ? selection.delete(i.id) : selection.add(i.id); store.emit(); } });
    const r = itemRow(i);
    r.append(h("button.icon-btn.small", { onclick: (e) => { e.stopPropagation(); itemMenu(i); }, "aria-label": "Aktionen" }, icon("more", 18)));
    return r;
  })));
  if (selecting) {
    const sel = items.filter((i) => selection.has(i.id));
    root.append(h("div.selection-bar", h("span", `${sel.length} ausgewählt`), h("span.spacer"),
      h("button.icon-btn", { disabled: !sel.length, onclick: async () => { const p = await pickFolder("Verschieben nach"); if (p) { store.move(sel, p.id); selection.clear(); folderView.selecting = null; store.emit(); } }, "aria-label": "Verschieben" }, icon("move", 20)),
      h("button.icon-btn", { disabled: !sel.length, onclick: () => exportSheet({ itemIds: sel.map((i) => i.id), title: f.name }), "aria-label": "Exportieren" }, icon("share", 20)),
      h("button.icon-btn", { disabled: !sel.length, onclick: () => claudeContextSheet(sel), "aria-label": "Claude" }, icon("sparkles", 20)),
      h("button.icon-btn", { disabled: !sel.length, onclick: () => { sel.forEach((i) => store.duplicate(i)); }, "aria-label": "Duplizieren" }, icon("copy", 20)),
      h("button.icon-btn.danger", { disabled: !sel.length, onclick: () => { store.trash(sel); selection.clear(); }, "aria-label": "Löschen" }, icon("trash", 20))));
  }
  return { root, tab: "vault" };
}

export function inboxView() {
  const { root, content } = screen({ title: "Inbox", back: true });
  const items = store.itemsIn(null).sort((a, b) => b.modifiedAt - a.modifiedAt);
  if (!items.length) content.append(empty("inbox", "Inbox ist leer", "Schnell erfasste Notizen, Prompts und Skripte ohne Ordner landen hier."));
  else content.append(h("p.hint.pad", "Tipp: ⋯ → Verschieben, um Einträge in Projekte einzusortieren."), h("div.list.card-list", items.map((i) => { const r = itemRow(i); r.append(h("button.icon-btn.small", { onclick: (e) => { e.stopPropagation(); itemMenu(i); } }, icon("more", 18))); return r; })));
  return { root, tab: "vault" };
}

export function favoritesView() {
  const { root, content } = screen({ title: "Favoriten", back: true });
  const folders = [...store.folders.values()].filter((f) => f.isFavorite), items = store.liveItems().filter((i) => i.isFavorite).sort((a, b) => b.modifiedAt - a.modifiedAt);
  if (!folders.length && !items.length) content.append(empty("star", "Keine Favoriten", "Markiere wichtige Skripte, Prompts und Ordner mit dem Stern."));
  if (folders.length) content.append(sectionHeader("Ordner"), h("div.list.card-list", folders.map((f) => folderRow(f))));
  if (items.length) content.append(sectionHeader("Einträge"), h("div.list.card-list", items.map((i) => itemRow(i, { showPath: true }))));
  return { root, tab: "vault" };
}

export function trashView() {
  const items = store.trashed();
  const { root, content } = screen({ title: "Papierkorb", back: true, actions: items.length ? [h("button.link.danger", { onclick: async () => { if (await confirmDialog("Papierkorb leeren?", `${items.length} Einträge werden endgültig gelöscht. Dies kann nicht rückgängig gemacht werden.`, "Endgültig löschen", true)) { store.deletePermanently(items); toast("Papierkorb geleert"); } } }, "Leeren")] : [] });
  if (!items.length) content.append(empty("trash", "Papierkorb ist leer", "Gelöschte Einträge bleiben hier, bis du sie endgültig entfernst."));
  else content.append(h("div.list.card-list", items.map((i) => itemRow(i, { onClick: () => menu(displayName(i), [
    { label: "Wiederherstellen", icon: "undo", onClick: () => store.restore(i) },
    { label: "Endgültig löschen", icon: "trash", danger: true, onClick: async () => { if (await confirmDialog("Endgültig löschen?", "Dies kann nicht rückgängig gemacht werden.", "Löschen", true)) store.deletePermanently([i]); } },
  ]) }))));
  return { root, tab: "vault" };
}

export function notFound() {
  const { root, content } = screen({ title: "Nicht gefunden", back: true });
  content.append(empty("alert", "Nicht gefunden", "Dieser Eintrag existiert nicht mehr (evtl. gelöscht).", { label: "Zur Startseite", onClick: () => go("#/home") }));
  return { root, tab: "home" };
}

// ---------------- Search
const searchState = { text: "", mode: "smart", kinds: new Set(), projects: new Set(), categories: new Set(), tags: new Set(), statuses: new Set(), favoritesOnly: false, caseSensitive: false };
let index = null, indexVersion = -1;
function ensureIndex() {
  if (indexVersion === store.version && index) return index;
  const docs = store.liveItems().map((i) => ({ id: i.id, kind: i.kind, title: i.title, summary: i.summary, content: i.content, tags: i.tags, category: i.category,
    folderPath: store.path(i.folderId).map((f) => f.name), project: store.project(i), status: i.status, isFavorite: i.isFavorite, modifiedAt: i.modifiedAt }))
    .concat([...store.folders.values()].map((f) => ({ id: f.id, kind: "folder", title: f.name, summary: "", content: "", tags: [], category: "", folderPath: store.path(f.parentId).map((x) => x.name), project: store.root(f.id)?.name, isFavorite: f.isFavorite, modifiedAt: f.modifiedAt })));
  index = new SearchIndex(docs);
  indexVersion = store.version;
  return index;
}

export function searchView(params) {
  if (params.get("kind")) { searchState.kinds = new Set([params.get("kind")]); }
  const { root, content } = screen({ title: "Suche", large: true });
  const input = h("input.search-input", { type: "search", placeholder: "z. B. Spider Leg Animation", value: searchState.text, autocapitalize: "off", autocorrect: "off", enterkeyhint: "search" });
  const results = h("div");
  const chips = h("div.chips.scroll");
  const run = () => {
    const idx = ensureIndex();
    searchState.text = input.value;
    const hasFilters = searchState.projects.size || searchState.categories.size || searchState.tags.size || searchState.statuses.size || searchState.favoritesOnly;
    chips.replaceChildren(
      ...[["Alle", null], ["Skripte", "script"], ["Notizen", "note"], ["Prompts", "prompt"], ["Ordner", "folder"]].map(([l, k]) =>
        chip(l, { color: "var(--accent)", selected: k ? searchState.kinds.has(k) && searchState.kinds.size === 1 : !searchState.kinds.size, onClick: () => { searchState.kinds = k ? new Set([k]) : new Set(); run(); } })),
      chip(searchState.mode === "exact" ? "Code-Fragment (exakt)" : "Intelligent", { color: "var(--prompt)", selected: searchState.mode === "exact", iconName: "code", onClick: () => { searchState.mode = searchState.mode === "exact" ? "smart" : "exact"; run(); } }),
      chip(hasFilters ? "Filter aktiv" : "Filter", { color: "var(--amber)", selected: !!hasFilters, iconName: "filter", onClick: () => filterSheet(idx, run) }));
    if (!input.value.trim() && !hasFilters) {
      results.replaceChildren(sectionHeader("Wissensbasis", idx.count),
        h("div.card", h("p.muted", "Durchsucht Titel, Inhalte, C#-Code (auch CamelCase wie SpiderLegAnimator), Beschreibungen, Tags, Kategorien und Ordnernamen gleichzeitig."),
          h("p.hint", "„Code-Fragment“ findet exakte Ausschnitte wie GetComponent<Rigidbody>(). Anführungszeichen suchen Phrasen.")),
        h("div.chips.wrap", idx.tagCounts().slice(0, 30).map(([t, c]) => chip(`#${t} ${c}`, { onClick: () => { searchState.tags = new Set([t]); run(); } }))));
      return;
    }
    const hits = idx.search({ ...searchState, text: input.value });
    results.replaceChildren(sectionHeader("Treffer", hits.length),
      hits.length ? h("div.list.card-list", hits.map(hitRow)) : empty("search", "Keine Treffer", "Andere Begriffe oder weniger Filter versuchen."));
  };
  let t;
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 140); });
  content.append(h("div.search-wrap", icon("search", 18, "muted"), input), chips, results);
  run();
  return { root, tab: "search", onShow: () => { if (!input.value) setTimeout(() => input.focus(), 50); }, keepOnStore: false };
}

function hitRow(hit) {
  const FIELD = { title: "TITEL", tags: "TAG", summary: "BESCHREIBUNG", category: "KATEGORIE", folder: "ORDNER", content: "TEXT", code: "CODE" };
  let title, path, onClick, ic, color;
  if (hit.kind === "folder") {
    const f = store.folders.get(hit.id); if (!f) return "";
    title = f.name; path = store.pathString(f.parentId); onClick = () => openFolder(f); ic = "folder"; color = "var(--amber)";
  } else {
    const i = store.items.get(hit.id); if (!i) return "";
    title = displayName(i); path = store.pathString(i.folderId); onClick = () => openItem(i); ic = KIND[i.kind].icon; color = KIND[i.kind].color;
  }
  let snip = "", pos = 0;
  for (const [a, b] of hit.ranges) { if (a < pos) continue; snip += esc(hit.snippet.slice(pos, a)) + "<mark>" + esc(hit.snippet.slice(a, b)) + "</mark>"; pos = b; }
  snip += esc(hit.snippet.slice(pos));
  return h("div.row.hit", { onclick: onClick }, badge(ic, color, 34), h("div.row-main",
    h("div.row-title" + (hit.kind === "script" ? ".mono" : ""), title), h("div.row-sub.small", path),
    hit.snippet ? h("div.snippet" + (hit.kind === "script" ? ".mono" : ""), hit.line ? h("span.ln", String(hit.line)) : "", h("span", { html: snip })) : "",
    h("div.fields", hit.fields.map((f) => h("span", FIELD[f])), hit.count > 1 ? h("span.plain", hit.count + "×") : "")));
}

function filterSheet(idx, run) {
  const docs = idx.entries.map((e) => e.d);
  const projects = [...new Set(docs.map((d) => d.project).filter(Boolean))].sort();
  const cats = [...new Set(docs.map((d) => d.category).filter(Boolean))].sort();
  const group = (title, values, set, label = (x) => x) => values.length ? [h("div.form-section", title), h("div.chips.wrap", values.map((v) => { const c = chip(label(v), { color: "var(--accent)", selected: set.has(v), onClick: () => { set.has(v) ? set.delete(v) : set.add(v); c.classList.toggle("selected"); run(); } }); return c; }))] : [];
  sheet("Filter", () => h("div.form",
    h("label.toggle-row", h("span", "Nur Favoriten"), h("input", { type: "checkbox", checked: searchState.favoritesOnly, onchange: (e) => { searchState.favoritesOnly = e.target.checked; run(); } })),
    h("label.toggle-row", h("span", "Groß-/Kleinschreibung (Code-Fragment)"), h("input", { type: "checkbox", checked: searchState.caseSensitive, onchange: (e) => { searchState.caseSensitive = e.target.checked; run(); } })),
    ...group("Projekt", projects, searchState.projects),
    ...group("Kategorie", cats, searchState.categories),
    ...group("Skript-Status", Object.keys(STATUS), searchState.statuses, (k) => STATUS[k].name),
    ...group("Tags (alle müssen passen)", idx.tagCounts().map(([t]) => t), searchState.tags),
    h("button.btn.secondary.wide", { onclick: () => { for (const k of ["projects", "categories", "tags", "statuses"]) searchState[k].clear(); searchState.favoritesOnly = false; run(); document.querySelector(".sheet .link")?.click(); } }, "Filter zurücksetzen")), { full: true });
}
