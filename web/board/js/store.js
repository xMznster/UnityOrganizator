// Organizator – state, autosave, undo/redo, backup points, import/export.
// Storage is injected (localStorage in the browser, a Map-backed fake in tests).
import { normalizeData, mergeData, welcomeData, emptyData, countCards, uid, DATA_VERSION } from "./model.js";

export const DEFAULT_SETTINGS = Object.freeze({
  theme: "system", // light | dark | system
  accent: "#5E6AD2",
  bgStyle: "soft", // soft | vivid
  font: "system", // system | rounded | serif | mono
  fontSize: 15,
  density: "normal", // compact | normal | airy
  radius: 10,
  listWidth: 280,
  cardStyle: "shadow", // shadow | border | flat
  labelStyle: "bars", // bars | names
  showDue: true,
  showChecklist: true,
  showDesc: true,
  motion: true,
});

const CHOICES = {
  theme: ["light", "dark", "system"],
  bgStyle: ["soft", "vivid"],
  font: ["system", "rounded", "serif", "mono"],
  density: ["compact", "normal", "airy"],
  cardStyle: ["shadow", "border", "flat"],
  labelStyle: ["bars", "names"],
};
const RANGES = { fontSize: [13, 19], radius: [0, 18], listWidth: [240, 360] };

export function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return s;
  for (const [k, v] of Object.entries(CHOICES)) if (v.includes(raw[k])) s[k] = raw[k];
  for (const [k, [lo, hi]] of Object.entries(RANGES)) if (Number.isFinite(raw[k])) s[k] = Math.min(hi, Math.max(lo, Math.round(raw[k])));
  for (const k of ["showDue", "showChecklist", "showDesc", "motion"]) if (typeof raw[k] === "boolean") s[k] = raw[k];
  if (typeof raw.accent === "string" && /^#[0-9a-f]{6}$/i.test(raw.accent)) s.accent = raw.accent.toUpperCase();
  return s;
}

const MAX_UNDO = 80;
const MAX_AUTO_SNAPSHOTS = 7;
const MAX_MANUAL_SNAPSHOTS = 15;
const AUTO_SNAPSHOT_EVERY = 20 * 3600 * 1000;

export class Store {
  constructor({ storage, prefix = "organizator", now = () => Date.now(), saveDelay = 300 } = {}) {
    this.storage = storage;
    this.now = now;
    this.saveDelay = saveDelay;
    this.keys = { data: `${prefix}.data`, settings: `${prefix}.settings`, snaps: `${prefix}.snapshots`, corrupt: `${prefix}.corrupt` };
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.lastUndoKey = null;
    this.lastUndoAt = 0;
    this.dirty = false;
    this.timer = null;
    this.lastSaved = null;
    this.saveError = null;
    this.firstRun = false;
    this.data = emptyData();
    this.settings = { ...DEFAULT_SETTINGS };
  }

  // ------------------------------------------------------------ load & save

  load() {
    const raw = this.read(this.keys.data);
    let data = null;
    if (raw) {
      try {
        data = normalizeData(JSON.parse(raw));
      } catch {
        this.write(this.keys.corrupt, raw); // never lose unreadable content
        this.loadError = "Gespeicherte Daten waren beschädigt und wurden gesichert.";
      }
    }
    if (!data) {
      data = welcomeData(this.now());
      this.firstRun = !raw;
    }
    this.data = data;
    try {
      this.settings = normalizeSettings(JSON.parse(this.read(this.keys.settings) ?? "null"));
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    if (!raw) { this.dirty = true; this.flush(); } else this.lastSaved = this.now();
    return this;
  }

  read(key) {
    try { return this.storage.getItem(key); } catch { return null; }
  }

  write(key, value, retry = true) {
    try {
      this.storage.setItem(key, value);
      return true;
    } catch (e) {
      // Quota exceeded: free space by dropping the oldest backup points, then retry.
      if (retry && key !== this.keys.snaps && this.pruneOldestSnapshot()) return this.write(key, value, true);
      this.lastWriteError = e;
      return false;
    }
  }

  scheduleSave() {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.saveDelay);
    this.emit({ kind: "status" });
  }

  /** Writes pending changes immediately. */
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return true;
    const ok = this.write(this.keys.data, JSON.stringify(this.data));
    if (ok) {
      this.dirty = false;
      this.lastSaved = this.now();
      this.saveError = null;
    } else {
      this.saveError = "Speicher voll – bitte eine Sicherung exportieren.";
    }
    this.emit({ kind: "status" });
    return ok;
  }

  /** Another tab changed the data. */
  reloadFrom(raw) {
    try {
      this.data = normalizeData(JSON.parse(raw));
      this.undoStack = [];
      this.redoStack = [];
      this.emit({ kind: "data", origin: "external" });
    } catch { /* ignore broken writes */ }
  }

  // ------------------------------------------------------------ events

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(info) {
    for (const fn of [...this.listeners]) fn(info);
  }

  // ------------------------------------------------------------ mutations

  /**
   * Runs fn(data). Every real change is undoable and autosaved.
   * undoKey: consecutive commits with the same key (e.g. typing) form one undo step.
   */
  commit(fn, { undoKey = null, origin = null } = {}) {
    const before = JSON.stringify(this.data);
    const result = fn(this.data);
    if (result === false || JSON.stringify(this.data) === before) return result;
    const t = this.now();
    const coalesce = undoKey && undoKey === this.lastUndoKey && t - this.lastUndoAt < 6000;
    if (!coalesce) {
      this.undoStack.push(before);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastUndoKey = undoKey;
    this.lastUndoAt = t;
    this.changed(origin);
    return result;
  }

  /** Same as commit, scoped to one board; bumps its `updated` timestamp. */
  commitBoard(boardId, fn, opts) {
    return this.commit((data) => {
      const board = data.boards.find((b) => b.id === boardId);
      if (!board) return false;
      const r = fn(board, data);
      if (r !== false) board.updated = this.now();
      return r;
    }, opts);
  }

  replaceData(data, origin = "replace") {
    this.undoStack.push(JSON.stringify(this.data));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.lastUndoKey = null;
    this.data = data;
    this.changed(origin);
  }

  changed(origin) {
    this.scheduleSave();
    this.emit({ kind: "data", origin });
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.data));
    this.data = JSON.parse(this.undoStack.pop());
    this.lastUndoKey = null;
    this.changed("undo");
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.data));
    this.data = JSON.parse(this.redoStack.pop());
    this.lastUndoKey = null;
    this.changed("redo");
    return true;
  }

  // ------------------------------------------------------------ settings

  setSettings(patch) {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    this.write(this.keys.settings, JSON.stringify(this.settings));
    this.emit({ kind: "settings" });
  }

  resetSettings() {
    this.setSettings({ ...DEFAULT_SETTINGS });
  }

  // ------------------------------------------------------------ backup points (local snapshots)

  snapshots() {
    try {
      const list = JSON.parse(this.read(this.keys.snaps) ?? "[]");
      return Array.isArray(list) ? list.filter((s) => s && typeof s.data === "string").sort((a, b) => b.created - a.created) : [];
    } catch {
      return [];
    }
  }

  writeSnapshots(list) {
    while (list.length) {
      if (this.write(this.keys.snaps, JSON.stringify(list), false)) return true;
      list.pop(); // too big: drop the oldest and try again
    }
    this.write(this.keys.snaps, "[]", false);
    return false;
  }

  createSnapshot(label = "Sicherungspunkt", { auto = false } = {}) {
    this.flush();
    const snap = {
      id: uid(),
      created: this.now(),
      label: String(label).slice(0, 80),
      auto,
      boards: this.data.boards.length,
      cards: countCards(this.data),
      data: JSON.stringify(this.data),
    };
    const list = [snap, ...this.snapshots()];
    const autos = list.filter((s) => s.auto).slice(0, MAX_AUTO_SNAPSHOTS);
    const manual = list.filter((s) => !s.auto).slice(0, MAX_MANUAL_SNAPSHOTS);
    const kept = [...autos, ...manual].sort((a, b) => b.created - a.created);
    const ok = this.writeSnapshots(kept);
    this.emit({ kind: "snapshots" });
    return ok && this.snapshots().some((s) => s.id === snap.id) ? snap : null;
  }

  /** Creates one automatic backup point per day (called on start). */
  maybeAutoSnapshot() {
    if (!this.data.boards.length) return null;
    const last = this.snapshots().find((s) => s.auto);
    if (last && this.now() - last.created < AUTO_SNAPSHOT_EVERY) return null;
    return this.createSnapshot("Automatisch", { auto: true });
  }

  restoreSnapshot(id) {
    const snap = this.snapshots().find((s) => s.id === id);
    if (!snap) throw new Error("Sicherungspunkt nicht gefunden.");
    const data = normalizeData(JSON.parse(snap.data));
    this.createSnapshot("Vor Wiederherstellung", { auto: true });
    this.replaceData(data, "restore");
    return data;
  }

  deleteSnapshot(id) {
    this.writeSnapshots(this.snapshots().filter((s) => s.id !== id));
    this.emit({ kind: "snapshots" });
  }

  pruneOldestSnapshot() {
    const list = this.snapshots();
    if (!list.length) return false;
    list.pop();
    this.write(this.keys.snaps, JSON.stringify(list), false);
    return true;
  }

  // ------------------------------------------------------------ export / import

  exportString(boardId = null) {
    const boards = boardId ? this.data.boards.filter((b) => b.id === boardId) : this.data.boards;
    const payload = { app: "organizator", version: DATA_VERSION, exported: new Date(this.now()).toISOString(), data: { version: DATA_VERSION, boards } };
    if (!boardId) payload.settings = this.settings;
    return JSON.stringify(payload, null, 2);
  }

  /** Parses a backup without applying it. */
  inspectImport(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("Die Datei ist keine gültige Sicherung (kein JSON).");
    }
    const data = normalizeData(raw);
    return { raw, data, boards: data.boards.length, cards: countCards(data) };
  }

  /** mode: "merge" (add boards) or "replace" (replace everything, incl. design settings if contained). */
  importString(text, mode = "merge") {
    const parsed = this.inspectImport(text);
    this.createSnapshot("Vor Import", { auto: true });
    if (mode === "replace") {
      this.replaceData(parsed.data, "import");
      if (parsed.raw?.settings) this.setSettings(normalizeSettings(parsed.raw.settings));
    } else {
      this.commit((d) => mergeData(d, parsed.data, this.now()), { origin: "import" });
    }
    return parsed;
  }

  resetAll() {
    this.createSnapshot("Vor dem Zurücksetzen", { auto: true });
    this.replaceData(emptyData(), "reset");
  }

  /** Approximate bytes used by this app in storage. */
  usage() {
    let bytes = 0;
    for (const k of [this.keys.data, this.keys.settings, this.keys.snaps]) bytes += (this.read(k)?.length ?? 0) * 2;
    return bytes;
  }
}
