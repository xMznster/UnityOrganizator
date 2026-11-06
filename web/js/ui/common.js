import { h, icon, badge, relTime, dateTime, sheet, menu, chip, toast, shareFiles, copyText, confirmDialog, ICON_CHOICES, download } from "./kit.js";
import { store, KIND, STATUS, CATEGORY_PRESETS, PALETTE, uid } from "../store.js";
import { fileName, exportFiles, exportZip, readZip, planImport, utf8, parseTags, normalizeTag } from "../core/files.js";
import { componentTypes } from "../core/catalog.js";
import { TEMPLATES, csharpIdentifier } from "../core/templates.js";
import { contextBundle } from "../core/claude.js";
import { stripInline } from "../core/markdown.js";
import { analyze } from "../core/analyzer.js";

export const go = (hash) => { if (location.hash !== hash) location.hash = hash; };
export const openItem = (item) => go("#/item/" + item.id);
export const openFolder = (f) => go("#/folder/" + f.id);

export function displayName(item) { return item.kind === "script" ? fileName(item) : item.title; }

export function preview(item) {
  if (item.summary) return item.summary;
  const lines = item.content.split("\n").filter((l) => l.trim());
  if (item.kind === "script") return (lines.find((l) => !/^\s*(using|\/\/)/.test(l)) || "").trim();
  return stripInline(lines[0] || "").replace(/^#+\s*/, "");
}

export function itemRow(item, { showPath = false, onClick, selectable = null } = {}) {
  const st = item.kind === "script" && item.status ? STATUS[item.status] : null;
  const row = h("div.row", { onclick: onClick || (() => openItem(item)), role: "button", tabindex: 0 },
    selectable ? h("span.select-dot" + (selectable.selected ? ".on" : ""), icon("check", 14)) : "",
    h("div.badge-wrap", badge(KIND[item.kind].icon, KIND[item.kind].color), st ? h("span.status-dot", { style: { background: st.color } }) : ""),
    h("div.row-main",
      h("div.row-title" + (item.kind === "script" ? ".mono" : ""), displayName(item), item.isFavorite ? icon("star", 11, "fav") : ""),
      h("div.row-sub", showPath ? store.pathString(item.folderId) : preview(item)),
      (item.category || item.tags?.length) ? h("div.row-meta", item.category ? h("span", item.category) : "", ...(item.tags || []).slice(0, 2).map((t) => h("span", "#" + t))) : ""),
    h("div.row-side", h("span.time", relTime(item.modifiedAt)),
      item.kind === "script" && item.lastErrorCount ? h("span.err", icon("error", 12), item.lastErrorCount) :
        item.kind === "script" && item.lastWarningCount ? h("span.warn", icon("alert", 12), item.lastWarningCount) : ""));
  return row;
}

export function folderRow(f, { onClick } = {}) {
  const subs = store.children(f.id).length;
  return h("div.row", { onclick: onClick || (() => openFolder(f)), role: "button", tabindex: 0 },
    badge(f.parentId ? "folder" : f.icon || "folder", f.color || "var(--amber)"),
    h("div.row-main", h("div.row-title", f.name, f.isFavorite ? icon("star", 11, "fav") : ""),
      h("div.row-sub.mono", `${store.totalCount(f.id)} Einträge${subs ? ` · ${subs} Ordner` : ""}`)),
    icon("chevronRight", 16, "muted"));
}

// ---------------- folder picker
export function pickFolder(title, { exclude = null, allowRoot = true, rootLabel = "Inbox (ohne Ordner)" } = {}) {
  return new Promise((resolve) => {
    let done = false;
    sheet(title, (close) => {
      const pick = (id) => { done = true; close(); resolve({ id }); };
      const list = h("div.list");
      if (allowRoot) list.append(h("div.row", { onclick: () => pick(null) }, badge(exclude ? "grid" : "inbox", "var(--accent)", 32), h("div.row-main", h("div.row-title", rootLabel))));
      const add = (f, depth) => {
        const disabled = exclude && (f.id === exclude.id || store.isDescendant(f.id, exclude.id));
        list.append(h("div.row" + (disabled ? ".disabled" : ""), { style: { paddingLeft: 14 + depth * 18 + "px" }, onclick: () => !disabled && pick(f.id) },
          badge(f.parentId ? "folder" : f.icon, f.color, 30), h("div.row-main", h("div.row-title", f.name))));
        for (const c of store.children(f.id)) add(c, depth + 1);
      };
      for (const r of store.roots()) add(r, 0);
      if (!store.roots().length) list.append(h("p.muted.pad", "Noch keine Ordner vorhanden."));
      return list;
    }, { onClose: () => { if (!done) resolve(null); } });
  });
}

// ---------------- tags
export function tagEditor(tags, onChange, suggestions = []) {
  const wrap = h("div.tag-editor");
  const input = h("input.tag-input", { placeholder: "Tag hinzufügen", autocapitalize: "off", autocorrect: "off",
    onkeydown: (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); } } });
  const sugg = h("div.chips.scroll");
  const render = () => {
    wrap.querySelectorAll(".tag-pill").forEach((n) => n.remove());
    for (const t of tags) wrap.insertBefore(h("button.tag-pill", { type: "button", onclick: () => { tags.splice(tags.indexOf(t), 1); onChange(tags); render(); } }, "#" + t, icon("x", 11)), input);
    sugg.replaceChildren(...suggestions.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()) && (!input.value || s.toLowerCase().includes(input.value.toLowerCase()))).slice(0, 14)
      .map((s) => h("button.tag-sugg", { type: "button", onclick: () => { tags.push(s); onChange(tags); input.value = ""; render(); } }, "#" + s)));
  };
  const commit = () => { for (const t of parseTags(input.value)) if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t); input.value = ""; onChange(tags); render(); };
  input.addEventListener("input", render);
  input.addEventListener("blur", () => { if (input.value.trim()) commit(); });
  wrap.append(input);
  render();
  return h("div", wrap, sugg);
}

// ---------------- metadata
export function metadataSheet(item, report = null, onDone) {
  const isScript = item.kind === "script";
  const field = (label, el, hint) => h("label.field-row", h("span.field-label", label), el, hint ? h("span.hint", hint) : "");
  const title = h("input.field" + (isScript ? ".mono" : ""), { value: item.title, autocapitalize: isScript ? "off" : "sentences", autocorrect: isScript ? "off" : "on", oninput: (e) => store.updateItem(item, { title: e.target.value }, { silent: true }) });
  const summary = h("textarea.field", { rows: 2, value: item.summary, placeholder: "Kurzbeschreibung (optional)", oninput: (e) => store.updateItem(item, { summary: e.target.value }, { silent: true }) });
  const category = h("input.field", { value: item.category, placeholder: "Kategorie", oninput: (e) => store.updateItem(item, { category: e.target.value }, { silent: true }) });
  const r = report || (isScript ? analyze(item.content, { fileName: item.title }) : null);
  const presets = [...new Set([...(r?.suggestedCategories || []), ...CATEGORY_PRESETS[item.kind]])];
  const catChips = h("div.chips.scroll", presets.map((c) => chip(c, { color: "var(--accent)", selected: item.category === c, onClick: () => { category.value = c; store.updateItem(item, { category: c }, { silent: true }); catChips.querySelectorAll(".chip").forEach((x) => x.classList.toggle("selected", x.textContent === c)); } })));
  const loc = h("button.field.as-button", { type: "button", onclick: async () => { const p = await pickFolder("Verschieben nach"); if (p) { store.move([item], p.id); loc.textContent = store.pathString(item.folderId); } } }, store.pathString(item.folderId));
  const body = h("div.form",
    field(isScript ? "Skriptname (= Klassenname)" : "Titel", title),
    isScript && r ? (() => { const main = r.types.find((t) => t.nestingDepth === 0 && (t.bases.includes("MonoBehaviour") || t.bases.includes("ScriptableObject"))); return main && main.name !== item.title ? h("button.link.left", { onclick: () => { title.value = main.name; store.updateItem(item, { title: main.name }, { silent: true }); } }, `↳ Auf Klassennamen „${main.name}“ setzen`) : ""; })() : "",
    field("Beschreibung", summary),
    field("Kategorie", category), catChips,
    field("Tags", tagEditor([...(item.tags || [])], (t) => store.updateItem(item, { tags: [...t] }, { silent: true }), store.allTags())),
    field("Ort", loc),
    h("label.toggle-row", h("span", "Favorit"), h("input", { type: "checkbox", checked: item.isFavorite, onchange: (e) => store.updateItem(item, { isFavorite: e.target.checked }, { touch: false, silent: true }) })));
  if (isScript) {
    const status = h("div.segmented", Object.entries(STATUS).map(([k, s]) => h("button" + (item.status === k ? ".on" : ""), { type: "button", onclick: (e) => { store.updateItem(item, { status: k }, { silent: true }); status.querySelectorAll("button").forEach((b) => b.classList.remove("on")); e.currentTarget.classList.add("on"); } }, s.name)));
    body.append(
      h("div.form-section", "Unity"),
      field("Status", status),
      field("Unity-Version", h("input.field", { value: item.unityVersion, placeholder: "z. B. 6000.0 LTS", autocapitalize: "off", oninput: (e) => store.updateItem(item, { unityVersion: e.target.value }, { silent: true }) })),
      field("Projekt", h("input.field", { value: item.projectName, placeholder: `leer = ${store.root(item.folderId)?.name || "Hauptordner"}`, oninput: (e) => store.updateItem(item, { projectName: e.target.value }, { silent: true }) })),
      r ? h("div.info-line", "Erkannter Typ: ", h("b", r.scriptKind)) : "",
      field("Verwendete Komponenten", tagEditor([...(item.components || [])], (t) => store.updateItem(item, { components: [...t] }, { silent: true }), [...componentTypes].sort())),
      field("Abhängigkeiten", tagEditor([...(item.dependencies || [])], (t) => store.updateItem(item, { dependencies: [...t] }, { silent: true }), [])),
      h("button.btn.secondary.wide", { onclick: () => { store.refreshScriptMeta(item, false); store.putItem(item); toast("Aus Code erkannt"); close(); setTimeout(() => metadataSheet(item, null, onDone), 300); } }, icon("wand", 16), "Komponenten, Kategorie & Abhängigkeiten erkennen"));
  }
  body.append(h("div.meta-foot.mono", `Erstellt ${dateTime(item.createdAt)} · Geändert ${dateTime(item.modifiedAt)} · ${store.revisionsOf(item.id).length} Versionen`));
  const close = sheet("Eigenschaften", body, { full: true, onClose: () => { item.modifiedAt = Date.now(); store.putItem(item); store.emit(); onDone?.(); } });
}

// ---------------- export
export function exportSheet({ itemIds = null, folderId = null, title = "Export" }) {
  const snap = store.snapshot();
  const single = itemIds && itemIds.length === 1;
  const state = { format: single ? "files" : "zip", preserve: true, frontMatter: true, manifest: true };
  const count = itemIds ? itemIds.length : folderId ? snap.items.filter((i) => i.folderId && store.path(i.folderId).some((f) => f.id === folderId)).length : snap.items.length;
  const formats = [["files", "Einzeldateien (.cs / .md)"], ["zip", "ZIP mit Ordnerstruktur"], ["unity", "Nur C# (für den Unity-Assets-Ordner)"], ["txt", "Prompts als .txt"]];
  const opts = () => ({ itemIds, rootFolder: folderId, preserveFolders: state.preserve, scriptsOnly: state.format === "unity", includeManifest: state.manifest && state.format === "zip",
    rootName: state.format === "unity" ? "Scripts" : title.replace(/[\/\\:*?"<>|]/g, " "), frontMatter: state.frontMatter, promptsAsText: state.format === "txt" });
  const build = () => {
    if (state.format === "zip" || (state.format === "unity" && !single)) {
      const bytes = exportZip(snap, opts());
      return [new File([bytes], `${opts().rootName || "UnityVault"}.zip`, { type: "application/zip" })];
    }
    const files = exportFiles(snap, { ...opts(), includeManifest: false, rootName: "", preserveFolders: false });
    return files.map((f) => new File([f.data], f.path.split("/").pop(), { type: f.path.endsWith(".cs") ? "text/plain" : "text/markdown" }));
  };
  sheet("Exportieren", () => h("div.form",
    h("div.info-line", h("b", title), ` · ${count} Einträge`),
    h("div.radio-list", formats.map(([k, label]) => h("label.radio", h("input", { type: "radio", name: "fmt", checked: state.format === k, onchange: () => (state.format = k) }), h("span", label)))),
    h("label.toggle-row", h("span", "Ordnerstruktur beibehalten (ZIP)"), h("input", { type: "checkbox", checked: state.preserve, onchange: (e) => (state.preserve = e.target.checked) })),
    h("label.toggle-row", h("span", "Metadaten als Front Matter (.md)"), h("input", { type: "checkbox", checked: state.frontMatter, onchange: (e) => (state.frontMatter = e.target.checked) })),
    h("label.toggle-row", h("span", "Manifest + INDEX.md (re-importierbar)"), h("input", { type: "checkbox", checked: state.manifest, onchange: (e) => (state.manifest = e.target.checked) })),
    h("p.hint", "C#-Dateien werden byte-genau exportiert. „Teilen“ öffnet das iOS-Teilen-Menü (AirDrop, Mail, In Dateien sichern …)."),
    h("div.row-buttons",
      h("button.btn", { onclick: async () => { const files = build(); if (!files.length) return toast("Keine passenden Einträge"); await shareFiles(files, title); } }, icon("share", 16), "Teilen"),
      h("button.btn.secondary", { onclick: () => { const files = build(); if (!files.length) return toast("Keine passenden Einträge"); for (const f of files) download(f.name, f); } }, icon("download", 16), "Herunterladen"))), { full: true });
}

// ---------------- Claude context
export function claudeContextSheet(items) {
  let task = "";
  const pre = h("pre.preview-box");
  const update = () => { const b = contextBundle(items, store.snapshot(), task); pre.textContent = b.length > 1500 ? b.slice(0, 1500) + "\n…" : b; return b; };
  update();
  sheet("Claude-Kontext", (close) => h("div.form",
    h("textarea.field", { rows: 3, placeholder: "Aufgabe für Claude (optional), z. B. „Baue darauf ein Patrouillen-System auf“", oninput: (e) => { task = e.target.value; update(); } }),
    h("p.hint", `Markdown-Dokument mit ${items.length} Einträgen inkl. Metadaten – zum Einfügen in Claude oder als Datei für Claude Code.`),
    pre,
    h("div.row-buttons",
      h("button.btn", { onclick: () => { const b = update(); copyText(b, `Kontext kopiert (${b.length} Zeichen)`); close(); } }, icon("copy", 16), "Kopieren"),
      h("button.btn.secondary", { onclick: () => shareFiles([new File([update()], "claude-context.md", { type: "text/markdown" })], "Claude-Kontext") }, icon("share", 16), "Als Datei"))), { full: true });
}

// ---------------- revisions
export function revisionsSheet(item, onRestore) {
  sheet("Versionen", (close) => {
    const revs = store.revisionsOf(item.id);
    if (!revs.length) return h("div.empty", h("h3", "Keine Versionen"), h("p.muted", "Versionen entstehen beim Bearbeiten und vor Synchronisierungen automatisch."));
    const cur = new Set(item.content.split("\n"));
    return h("div.list", revs.map((r) => {
      const lines = r.content.split("\n"), old = new Set(lines);
      const added = item.content.split("\n").filter((l) => !old.has(l)).length, removed = lines.filter((l) => !cur.has(l)).length;
      return h("div.row", { onclick: () => {
        sheet(dateTime(r.createdAt), (c2) => h("div.form", h("pre.preview-box.tall", r.content), h("button.btn.wide", { onclick: () => { store.restoreRevision(r); c2(); close(); onRestore?.(store.items.get(item.id).content); } }, icon("clock", 16), "Diese Version wiederherstellen")), { full: true });
      } }, h("div.row-main", h("div.row-title", dateTime(r.createdAt)), h("div.row-sub.mono", added || removed ? `${lines.length} Zeilen · ggü. aktuell +${added} / −${removed}` : `identisch · ${lines.length} Zeilen`)), h("span.time", r.reason));
    }));
  }, { full: true });
}

// ---------------- new script
export function newScriptSheet(folderId = null) {
  let name = "", tpl = TEMPLATES[0].id;
  const preview = h("div.hint.mono");
  sheet("Neues C#-Skript", (close) => {
    const list = h("div.list");
    const renderList = () => list.replaceChildren(...TEMPLATES.map((t) => h("div.row" + (t.id === tpl ? ".selected" : ""), { onclick: () => { tpl = t.id; renderList(); } },
      badge("code", "var(--script)", 34), h("div.row-main", h("div.row-title", t.name), h("div.row-sub", t.detail)), t.id === tpl ? icon("check", 18, "accent") : "")));
    renderList();
    const input = h("input.field.mono", { placeholder: "z. B. SpiderLegAnimator", autocapitalize: "off", autocorrect: "off", oninput: (e) => { name = e.target.value; preview.textContent = name ? `Datei: ${csharpIdentifier(name)}.cs` : ""; } });
    setTimeout(() => input.focus(), 350);
    return h("div.form", input, preview, h("p.hint", "Unity verlangt, dass Dateiname und Klassenname übereinstimmen – beides wird automatisch gesetzt."), list);
  }, { full: true, actions: h("button.link.strong", { onclick: () => { const t = TEMPLATES.find((x) => x.id === tpl); const item = store.createScript(name || "NewScript", t, folderId); document.querySelector(".sheet .link")?.click(); setTimeout(() => openItem(item), 280); } }, "Erstellen") });
}

// ---------------- folder edit
export function folderEditSheet({ folder = null, parentId = null } = {}) {
  const st = { name: folder?.name || "", icon: folder?.icon || "folder", color: folder?.color || (parentId ? store.folders.get(parentId)?.color : PALETTE[store.roots().length % PALETTE.length]) };
  sheet(folder ? "Ordner bearbeiten" : "Neuer Ordner", (close) => {
    const icons = h("div.icon-grid");
    const colors = h("div.color-row");
    const render = () => {
      icons.replaceChildren(...ICON_CHOICES.map((n) => h("button.icon-choice" + (st.icon === n ? ".on" : ""), { type: "button", style: { "--c": st.color }, onclick: () => { st.icon = n; render(); } }, icon(n, 20))));
      colors.replaceChildren(...PALETTE.map((c) => h("button.color" + (st.color === c ? ".on" : ""), { type: "button", style: { background: c }, onclick: () => { st.color = c; render(); }, "aria-label": c })));
    };
    render();
    const input = h("input.field.big", { value: st.name, placeholder: "Ordnername", oninput: (e) => (st.name = e.target.value) });
    setTimeout(() => input.focus(), 350);
    const save = () => {
      if (!st.name.trim()) return toast("Bitte einen Namen eingeben");
      if (folder) store.updateFolder(folder, { name: st.name, icon: st.icon, color: st.color });
      else store.createFolder(st.name, parentId, { icon: st.icon, color: st.color });
      close();
    };
    return h("form.form", { onsubmit: (e) => { e.preventDefault(); save(); } }, input, h("div.form-section", "Symbol"), icons, h("div.form-section", "Farbe"), colors,
      h("button.btn.wide", { type: "submit" }, folder ? "Sichern" : "Anlegen"));
  }, { full: true });
}

export function folderMenu(f) {
  menu(f.name, [
    { label: "Bearbeiten", icon: "edit", onClick: () => folderEditSheet({ folder: f }) },
    { label: "Unterordner anlegen", icon: "folderPlus", onClick: () => folderEditSheet({ parentId: f.id }) },
    { label: f.isFavorite ? "Favorit entfernen" : "Als Favorit markieren", icon: "star", onClick: () => store.updateFolder(f, { isFavorite: !f.isFavorite }) },
    { label: "Verschieben", icon: "move", onClick: async () => { const p = await pickFolder(`„${f.name}“ verschieben`, { exclude: f, rootLabel: "Oberste Ebene (Projekt)" }); if (p) store.moveFolder(f, p.id); } },
    { label: "Duplizieren", icon: "copy", onClick: () => store.duplicateFolder(f) },
    { label: "Exportieren (ZIP)", icon: "share", onClick: () => exportSheet({ folderId: f.id, title: f.name }) },
    { label: "Als Claude-Kontext", icon: "sparkles", onClick: () => claudeContextSheet(store.liveItems().filter((i) => i.folderId && store.path(i.folderId).some((x) => x.id === f.id))) },
    "-",
    { label: "Ordner löschen", icon: "trash", danger: true, onClick: async () => {
      if (await confirmDialog(`„${f.name}“ löschen?`, `Unterordner werden entfernt. ${store.totalCount(f.id)} Einträge werden in den Papierkorb verschoben und können wiederhergestellt werden.`, "Löschen", true)) { store.deleteFolder(f); if (location.hash.includes(f.id)) history.back(); }
    } },
  ]);
}

export function itemMenu(item) {
  menu(displayName(item), [
    { label: item.isFavorite ? "Favorit entfernen" : "Als Favorit markieren", icon: "star", onClick: () => store.toggleFavorite(item) },
    { label: "Verschieben", icon: "move", onClick: async () => { const p = await pickFolder("Verschieben nach"); if (p) store.move([item], p.id); } },
    { label: "Duplizieren", icon: "copy", onClick: () => store.duplicate(item) },
    { label: "Inhalt kopieren", icon: "copy", onClick: () => copyText(item.content) },
    { label: "Exportieren / Teilen", icon: "share", onClick: () => exportSheet({ itemIds: [item.id], title: item.title }) },
    { label: "Als Claude-Kontext", icon: "sparkles", onClick: () => claudeContextSheet([item]) },
    "-",
    { label: "In den Papierkorb", icon: "trash", danger: true, onClick: () => store.trash([item]) },
  ]);
}

// ---------------- import
export function importFiles(folderId = null) {
  const input = h("input", { type: "file", multiple: true, accept: ".cs,.md,.txt,.markdown,.zip,.json,text/plain,application/zip,application/json", style: { display: "none" } });
  input.addEventListener("change", async () => {
    try {
      const files = [];
      for (const f of input.files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (f.name.toLowerCase().endsWith(".zip")) {
          const entries = readZip(bytes);
          if (!entries) { toast("Komprimiertes ZIP: bitte in der Dateien-App entpacken und die Dateien wählen."); continue; }
          files.push(...entries);
        } else if (f.name.toLowerCase().endsWith(".json")) {
          await restoreBackup(bytes); input.remove(); return;
        } else files.push({ path: f.name, data: bytes });
      }
      const planned = planImport(files, uid);
      if (!planned.length) { toast("Keine unterstützten Dateien (.cs, .md, .txt)"); return; }
      toast(`${store.importPlanned(planned, folderId)} Dateien importiert`);
    } catch (e) { toast("Import fehlgeschlagen: " + e.message); }
    input.remove();
  });
  document.body.append(input);
  input.click();
}

export async function restoreBackup(bytes) {
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (data.format !== "unity-vault-backup") throw new Error("Keine Vault-Sicherung");
  const ok = await confirmDialog("Sicherung importieren?", `${data.items.length} Einträge und ${data.folders.length} Ordner werden hinzugefügt. Vorhandene Einträge mit gleicher ID werden NICHT überschrieben.`, "Importieren");
  if (!ok) return;
  let n = 0;
  for (const f of data.folders) if (!store.folders.has(f.id)) store.putFolder(f);
  for (const i of data.items) if (!store.items.has(i.id)) { store.putItem(i); n++; }
  for (const r of data.revisions || []) if (!store.revisions.has(r.id)) { store.revisions.set(r.id, r); store.write("revisions", r); }
  store.emit();
  toast(`${n} Einträge wiederhergestellt`);
}

export function bytesToFile(name, bytes, type) { return new File([bytes], name, { type }); }
export { utf8, normalizeTag };
