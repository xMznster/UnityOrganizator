// Persistence (IndexedDB) + all vault mutations. Every mutation is written immediately.
// Mirrors App/Services/VaultStore.swift: soft delete, revisions, cycle-free folder moves, imports never overwrite.
import { analyze } from "./core/analyzer.js";
import { csharpIdentifier, renderTemplate } from "./core/templates.js";
import { suggestedTitle } from "./core/markdown.js";

const DB_NAME = "unity-vault", DB_VERSION = 1;
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2)).toUpperCase();

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ["folders", "items", "revisions", "meta"]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const PALETTE = ["#4FD1C5", "#7AA2F7", "#C792EA", "#F7B955", "#FF7A90", "#8BD5A0", "#F78C6C", "#89DDFF"];
export const KIND = {
  note: { name: "Notiz", plural: "Notizen & Ideen", icon: "note", color: "var(--note)" },
  prompt: { name: "Prompt", plural: "Prompts", icon: "sparkles", color: "var(--prompt)" },
  script: { name: "C#-Skript", plural: "Skripte", icon: "code", color: "var(--script)" },
};
export const STATUS = {
  experimental: { name: "Experimentell", color: "var(--prompt)" },
  inDevelopment: { name: "In Entwicklung", color: "var(--amber)" },
  tested: { name: "Getestet", color: "var(--success)" },
};
export const CATEGORY_PRESETS = {
  note: ["Spielidee", "Mechanik", "Konzept", "Story", "Level Design", "Technik", "Tutorial", "Recherche", "To-do"],
  prompt: ["Code generieren", "Refactoring", "Debugging", "Shader", "Konzept", "Review", "Claude Code"],
  script: ["Player Controller", "Enemy AI", "Interactions", "Animation", "Physics", "UI", "Audio", "Camera", "Combat System", "Input System", "Save System", "Editor Tool", "Utilities", "Data / ScriptableObject", "Events", "Coroutines", "Rendering", "Scene Management", "Interfaces"],
};

class Store {
  constructor() {
    this.folders = new Map();
    this.items = new Map();
    this.revisions = new Map();
    this.meta = new Map();
    this.listeners = new Set();
    this.version = 0;
  }

  async init() {
    this.db = await openDB();
    const all = (s) => new Promise((res, rej) => { const r = this.db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const f of await all("folders")) this.folders.set(f.id, f);
    for (const i of await all("items")) this.items.set(i.id, i);
    for (const r of await all("revisions")) this.revisions.set(r.id, r);
    for (const m of await all("meta")) this.meta.set(m.id, m.value);
    try { if (navigator.storage?.persist) this.persisted = await navigator.storage.persist(); } catch { /* ignore */ }
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.version++; for (const fn of this.listeners) fn(); }

  write(storeName, value, del = false) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(storeName, "readwrite");
      const os = tx.objectStore(storeName);
      del ? os.delete(value) : os.put(value);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    }).catch((e) => { this.onError?.("Speichern fehlgeschlagen: " + e.message); });
  }
  putFolder(f) { this.folders.set(f.id, f); return this.write("folders", f); }
  putItem(i) { this.items.set(i.id, i); return this.write("items", i); }
  getMeta(k, d = null) { return this.meta.has(k) ? this.meta.get(k) : d; }
  setMeta(k, v) { this.meta.set(k, v); return this.write("meta", { id: k, value: v }); }

  // ---------- queries
  liveItems() { return [...this.items.values()].filter((i) => !i.deletedAt); }
  trashed() { return [...this.items.values()].filter((i) => i.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt); }
  children(parentId) { return [...this.folders.values()].filter((f) => (f.parentId || null) === (parentId || null)).sort((a, b) => a.sortIndex - b.sortIndex || a.name.localeCompare(b.name)); }
  roots() { return this.children(null); }
  itemsIn(folderId) { return this.liveItems().filter((i) => (i.folderId || null) === (folderId || null)); }
  path(folderId) { const out = []; let c = this.folders.get(folderId), g = 0; while (c && g++ < 64) { out.unshift(c); c = this.folders.get(c.parentId); } return out; }
  pathString(folderId) { return folderId ? this.path(folderId).map((f) => f.name).join(" / ") : "Inbox"; }
  root(folderId) { return this.path(folderId)[0] || null; }
  descendants(id) { const out = []; for (const c of this.children(id)) out.push(c, ...this.descendants(c.id)); return out; }
  isDescendant(id, ofId) { let c = this.folders.get(id)?.parentId, g = 0; while (c && g++ < 64) { if (c === ofId) return true; c = this.folders.get(c)?.parentId; } return false; }
  totalCount(id) { return this.itemsIn(id).length + this.children(id).reduce((a, c) => a + this.totalCount(c.id), 0); }
  project(item) { return item.projectName || this.root(item.folderId)?.name || ""; }
  allTags() { return [...new Set(this.liveItems().flatMap((i) => i.tags || []))].sort((a, b) => a.localeCompare(b)); }
  snapshot() {
    return {
      folders: [...this.folders.values()].map((f) => ({ id: f.id, name: f.name, parentId: f.parentId || null, isFavorite: !!f.isFavorite, sortIndex: f.sortIndex, icon: f.icon, colorHex: f.color })),
      items: this.liveItems().map((i) => ({ ...i })),
    };
  }
  revisionsOf(itemId) { return [...this.revisions.values()].filter((r) => r.itemId === itemId).sort((a, b) => b.createdAt - a.createdAt); }

  // ---------- items
  createItem(kind, { title, content = "", folderId = null, category = "" } = {}) {
    const now = Date.now();
    const item = {
      id: uid(), kind, title: title || (kind === "note" ? "Neue Notiz" : kind === "prompt" ? "Neuer Prompt" : "NewScript"), content,
      summary: "", category, tags: [], createdAt: now, modifiedAt: now, lastOpenedAt: null, isFavorite: false, folderId: folderId || null,
      deletedAt: null, originalFolderId: null, unityVersion: kind === "script" ? this.getMeta("defaultUnityVersion", "") : "",
      components: [], dependencies: [], projectName: "", status: kind === "script" ? "inDevelopment" : "",
      lastErrorCount: 0, lastWarningCount: 0, scriptKind: "",
    };
    if (kind === "script") this.refreshScriptMeta(item, true);
    this.putItem(item);
    this.emit();
    return item;
  }

  createScript(name, template, folderId) {
    const cls = csharpIdentifier(name || "NewScript");
    return this.createItem("script", { title: cls, content: renderTemplate(template, cls), folderId, category: template.category });
  }

  refreshScriptMeta(item, fillEmptyOnly) {
    if (item.kind !== "script") return;
    const r = analyze(item.content, { fileName: item.title });
    item.lastErrorCount = r.errorCount;
    item.lastWarningCount = r.warningCount;
    item.scriptKind = r.scriptKind;
    if (!fillEmptyOnly || !item.components?.length) item.components = r.detectedComponents;
    if ((!fillEmptyOnly || !item.category) && r.suggestedCategories[0]) item.category = r.suggestedCategories[0];
    if (!fillEmptyOnly || !item.dependencies?.length) {
      const defaults = new Set(["UnityEngine", "System", "System.Collections", "System.Collections.Generic", "System.Linq"]);
      const deps = r.usings.filter((u) => !defaults.has(u));
      const refs = new Set(r.referencedTypes);
      for (const o of this.liveItems()) if (o.kind === "script" && o.id !== item.id && refs.has(csharpIdentifier(o.title))) deps.push(csharpIdentifier(o.title) + ".cs");
      item.dependencies = [...new Set(deps)].sort();
    }
    return r;
  }

  updateItem(item, patch, { touch = true, silent = false } = {}) {
    Object.assign(item, patch);
    if (touch) item.modifiedAt = Date.now();
    this.putItem(item);
    if (!silent) this.emit();
  }

  setContent(item, content) {
    if (item.content === content) return;
    item.content = content;
    item.modifiedAt = Date.now();
    if ((item.title === "Neue Notiz" || item.title === "Neuer Prompt") && item.kind !== "script") {
      const t = suggestedTitle(content);
      if (t) item.title = t;
    }
    this.putItem(item);
  }

  toggleFavorite(item) { this.updateItem(item, { isFavorite: !item.isFavorite }, { touch: false }); this.toast(item.isFavorite ? "★ Zu Favoriten hinzugefügt" : "Aus Favoriten entfernt"); }

  uniqueTitle(base, folderId) {
    const names = new Set(this.itemsIn(folderId).map((i) => i.title.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    let n = 2; while (names.has(`${base} ${n}`.toLowerCase())) n++;
    return `${base} ${n}`;
  }

  duplicate(item) {
    const now = Date.now();
    const copy = { ...item, id: uid(), title: this.uniqueTitle(item.kind === "script" ? item.title + "Copy" : item.title + " (Kopie)", item.folderId),
      createdAt: now, modifiedAt: now, lastOpenedAt: null, isFavorite: false, tags: [...(item.tags || [])], components: [...(item.components || [])], dependencies: [...(item.dependencies || [])] };
    this.putItem(copy);
    this.emit();
    this.toast("Dupliziert");
    return copy;
  }

  move(items, folderId) {
    for (const i of items) { i.folderId = folderId || null; i.modifiedAt = Date.now(); this.putItem(i); }
    this.emit();
    this.toast(items.length === 1 ? `Verschoben nach ${folderId ? this.folders.get(folderId).name : "Inbox"}` : `${items.length} Einträge verschoben`);
  }

  trash(items) {
    for (const i of items) { i.originalFolderId = i.folderId; i.folderId = null; i.deletedAt = Date.now(); this.putItem(i); }
    this.emit();
    this.toast(items.length === 1 ? "In den Papierkorb verschoben" : `${items.length} Einträge im Papierkorb`, () => { for (const i of items) this.restore(i, true); this.emit(); });
  }

  restore(item, silent = false) {
    item.deletedAt = null;
    if (item.originalFolderId && this.folders.has(item.originalFolderId)) item.folderId = item.originalFolderId;
    item.originalFolderId = null;
    this.putItem(item);
    if (!silent) { this.emit(); this.toast(`Wiederhergestellt nach ${this.pathString(item.folderId)}`); }
  }

  deletePermanently(items) {
    for (const i of items) {
      this.items.delete(i.id); this.write("items", i.id, true);
      for (const r of this.revisionsOf(i.id)) { this.revisions.delete(r.id); this.write("revisions", r.id, true); }
    }
    this.emit();
  }

  // ---------- revisions
  recordRevision(item, reason) {
    const latest = this.revisionsOf(item.id)[0];
    if (latest && latest.content === item.content) return;
    const r = { id: uid(), itemId: item.id, createdAt: Date.now(), title: item.title, content: item.content, reason };
    this.revisions.set(r.id, r);
    this.write("revisions", r);
    for (const old of this.revisionsOf(item.id).slice(30)) { this.revisions.delete(old.id); this.write("revisions", old.id, true); }
  }
  restoreRevision(rev) {
    const item = this.items.get(rev.itemId);
    if (!item) return;
    this.recordRevision(item, "Vor Wiederherstellung");
    this.updateItem(item, { content: rev.content });
    this.toast("Version wiederhergestellt");
  }

  // ---------- folders
  uniqueFolderName(base, parentId, excludeId = null) {
    const name = (base || "").trim() || "Neuer Ordner";
    const names = new Set(this.children(parentId).filter((f) => f.id !== excludeId).map((f) => f.name.toLowerCase()));
    if (!names.has(name.toLowerCase())) return name;
    let n = 2; while (names.has(`${name} ${n}`.toLowerCase())) n++;
    return `${name} ${n}`;
  }
  createFolder(name, parentId = null, { icon = "folder", color = "" } = {}) {
    const sib = this.children(parentId);
    const parent = parentId ? this.folders.get(parentId) : null;
    const f = { id: uid(), name: this.uniqueFolderName(name, parentId), parentId: parentId || null, icon, color: color || parent?.color || PALETTE[sib.length % PALETTE.length],
      isFavorite: false, sortIndex: sib.reduce((m, x) => Math.max(m, x.sortIndex), -1) + 1, createdAt: Date.now(), modifiedAt: Date.now() };
    this.putFolder(f);
    this.emit();
    return f;
  }
  updateFolder(f, patch) {
    if (patch.name !== undefined) patch.name = this.uniqueFolderName(patch.name, f.parentId, f.id);
    Object.assign(f, patch, { modifiedAt: Date.now() });
    this.putFolder(f);
    this.emit();
  }
  canMoveFolder(f, targetId) {
    if (!targetId) return !!f.parentId;
    if (targetId === f.id || this.isDescendant(targetId, f.id)) return false;
    return f.parentId !== targetId;
  }
  moveFolder(f, targetId) {
    if (!this.canMoveFolder(f, targetId)) { this.onError?.("Ein Ordner kann nicht in sich selbst oder einen seiner Unterordner verschoben werden."); return false; }
    f.name = this.uniqueFolderName(f.name, targetId, f.id);
    f.parentId = targetId || null;
    f.sortIndex = this.children(targetId).reduce((m, x) => Math.max(m, x.sortIndex), -1) + 1;
    this.putFolder(f);
    this.emit();
    this.toast(`„${f.name}“ verschoben`);
    return true;
  }
  deleteFolder(f) {
    const all = [f, ...this.descendants(f.id)];
    let n = 0;
    for (const x of all) {
      for (const i of this.itemsIn(x.id)) { i.originalFolderId = null; i.folderId = null; i.deletedAt = Date.now(); this.putItem(i); n++; }
    }
    for (const x of all) { this.folders.delete(x.id); this.write("folders", x.id, true); }
    this.emit();
    this.toast(n ? `Ordner gelöscht · ${n} Einträge im Papierkorb` : "Ordner gelöscht");
  }
  duplicateFolder(f) {
    const copy = (src, parentId, rename) => {
      const nf = { ...src, id: uid(), parentId, name: rename ? this.uniqueFolderName(src.name + " Kopie", parentId) : src.name, createdAt: Date.now(), modifiedAt: Date.now(), isFavorite: false };
      this.putFolder(nf);
      for (const i of this.itemsIn(src.id)) this.putItem({ ...i, id: uid(), folderId: nf.id, createdAt: Date.now(), modifiedAt: Date.now(), tags: [...(i.tags || [])] });
      for (const c of this.children(src.id)) copy(c, nf.id, false);
      return nf;
    };
    const r = copy(f, f.parentId || null, true);
    this.emit();
    this.toast("Ordner dupliziert");
    return r;
  }
  ensurePath(names) {
    let parent = null;
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      let f = this.children(parent).find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!f) {
        const sib = this.children(parent);
        f = { id: uid(), name, parentId: parent, icon: "folder", color: parent ? this.folders.get(parent).color : PALETTE[sib.length % PALETTE.length], isFavorite: false, sortIndex: sib.length, createdAt: Date.now(), modifiedAt: Date.now() };
        this.putFolder(f);
      }
      parent = f.id;
    }
    return parent;
  }
  createStarterStructure() {
    const s = [["Horror Game", "moon", ["Ideas", "Prompts", "Scripts/Enemy AI", "Scripts/Player Controller", "Scripts/Interactions", "Documentation"]],
      ["Monster Game", "paw", ["Ideas", "Scripts", "Combat System"]], ["General Unity", "cube", ["Useful Scripts", "Tutorials", "Technical Knowledge"]],
      ["Blender", "brush", []], ["App Development", "phone", []]];
    s.forEach(([name, icon, subs], k) => {
      const id = this.ensurePath([name]);
      const f = this.folders.get(id);
      f.icon = icon; f.color = PALETTE[k % PALETTE.length]; f.sortIndex = k;
      this.putFolder(f);
      for (const sub of subs) this.ensurePath([name, ...sub.split("/")]);
    });
    this.emit();
    this.toast("Ordnerstruktur angelegt");
  }

  // ---------- import / sync
  importPlanned(planned, baseFolderId = null) {
    const base = baseFolderId ? this.path(baseFolderId).map((f) => f.name) : [];
    for (const p of planned) {
      const item = { ...this.blank(p.item.kind), ...p.item, folderId: this.ensurePath([...base, ...p.folderPath]), modifiedAt: Date.now(), deletedAt: null };
      if (item.kind === "script") this.refreshScriptMeta(item, true);
      this.putItem(item);
    }
    this.emit();
    return planned.length;
  }
  blank(kind) {
    return { summary: "", category: "", tags: [], lastOpenedAt: null, isFavorite: false, deletedAt: null, originalFolderId: null, unityVersion: "",
      components: [], dependencies: [], projectName: "", status: kind === "script" ? "inDevelopment" : "", lastErrorCount: 0, lastWarningCount: 0, scriptKind: "" };
  }
  applySync(out) {
    for (const u of out.updated) {
      const item = this.items.get(u.id);
      if (!item) continue;
      this.recordRevision(item, "Vor Sync-Aktualisierung");
      Object.assign(item, { kind: u.kind, title: u.title, content: u.content, summary: u.summary, category: u.category, tags: u.tags, isFavorite: u.isFavorite,
        unityVersion: u.unityVersion || "", components: u.components || [], dependencies: u.dependencies || [], projectName: u.projectName || "", status: u.kind === "script" ? u.status || "inDevelopment" : "", modifiedAt: Date.now() });
      if (item.kind === "script") this.refreshScriptMeta(item, true);
      this.putItem(item);
    }
    for (const c of out.created) {
      if (this.items.has(c.item.id)) continue;
      const item = { ...this.blank(c.item.kind), ...c.item, folderId: this.ensurePath(c.folderPath) };
      if (item.kind === "script") this.refreshScriptMeta(item, true);
      this.putItem(item);
    }
    for (const m of out.moved) {
      const item = this.items.get(m.itemId);
      if (!item) continue;
      item.folderId = this.ensurePath(m.folderPath);
      if (m.title) item.title = m.title;
      this.putItem(item);
    }
    for (const id of out.trashed) { const i = this.items.get(id); if (i) { i.originalFolderId = i.folderId; i.folderId = null; i.deletedAt = Date.now(); this.putItem(i); } }
    this.emit();
  }

  // ---------- backup (complete JSON incl. revisions)
  backup() {
    return { format: "unity-vault-backup", version: 1, createdAt: new Date().toISOString(), folders: [...this.folders.values()], items: [...this.items.values()], revisions: [...this.revisions.values()] };
  }

  toast(text, undo) { this.onToast?.(text, undo); }
}

export const store = new Store();
