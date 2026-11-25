// Organizator – bootstrap: storage, routing (#/ and #/b/<id>), global shortcuts, autosave lifecycle.
import { Store } from "./store.js";
import { findBoard } from "./model.js";
import { applySettings, onSystemThemeChange } from "./theme.js";
import { closeMenu, topModal, toast } from "./ui.js";
import { HomeView } from "./views/home.js";
import { BoardView } from "./views/board.js";
import { openSettings } from "./views/settings.js";
import { updateSaveIndicators } from "./views/shared.js";

function pickStorage() {
  try {
    const k = "organizator.test";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return { storage: localStorage, persistent: true };
  } catch {
    const m = new Map();
    return { storage: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }, persistent: false };
  }
}

const { storage, persistent } = pickStorage();
const store = new Store({ storage }).load();
const root = document.getElementById("app");
let view = null;

const app = {
  store,
  navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  },
  openSettings: (tab) => openSettings(app, tab),
  refreshSaveIndicators: () => updateSaveIndicators(store),
};

function route() {
  closeMenu();
  view?.destroy?.();
  const m = location.hash.match(/^#\/b\/([\w-]+)/);
  if (m && findBoard(store.data, m[1])) {
    view = BoardView(root, m[1], app);
  } else {
    if (location.hash && location.hash !== "#/") history.replaceState(null, "", "#/");
    view = HomeView(root, app);
  }
  view.update();
  app.refreshSaveIndicators();
}

store.subscribe((info) => {
  if (info.kind === "settings") applySettings(store.settings);
  if (info.kind === "settings" || info.kind === "data") view?.update(info);
  if (info.kind === "status" || info.kind === "data") app.refreshSaveIndicators();
});

// ------------------------------------------------------------------ keyboard
addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (e.key === "Escape") {
    if (closeMenu()) return e.preventDefault();
    const m = topModal();
    if (m) { e.preventDefault(); m.close(); return; }
    view?.onKey?.(e);
    return;
  }
  if (mod && key === "s") {
    e.preventDefault();
    store.flush();
    toast(store.saveError ?? "Gespeichert");
    return;
  }
  if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  if (mod && (key === "z" || key === "y")) {
    e.preventDefault();
    const redo = key === "y" || e.shiftKey;
    if (redo ? store.redo() : store.undo()) toast(redo ? "Wiederhergestellt" : "Rückgängig gemacht");
    return;
  }
  if (!mod && !e.altKey && !topModal() && !document.querySelector(".menu-layer")) view?.onKey?.(e);
});

// ------------------------------------------------------------------ lifecycle: never lose a change
addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") store.flush();
  else view?.update({ kind: "data", origin: "resume" }); // refresh "Heute"/"Morgen" labels
});
addEventListener("pagehide", () => store.flush());
addEventListener("beforeunload", () => store.flush());
addEventListener("storage", (e) => {
  if (e.key === store.keys.data && e.newValue) store.reloadFrom(e.newValue);
  if (e.key === store.keys.settings && e.newValue) {
    try { store.setSettings(JSON.parse(e.newValue)); } catch { /* ignore */ }
  }
});
onSystemThemeChange(() => {
  if (store.settings.theme !== "system") return;
  applySettings(store.settings);
  view?.update({ kind: "settings" });
});
addEventListener("hashchange", route);

// ------------------------------------------------------------------ start
applySettings(store.settings);
store.maybeAutoSnapshot();
route();
document.getElementById("splash")?.remove();
navigator.storage?.persist?.().catch(() => {});
if (!persistent) toast("Speichern ist in diesem Browser-Modus nicht möglich – bitte eine Sicherung exportieren.", { duration: 9000, kind: "error" });
else if (store.loadError) toast(store.loadError, { duration: 9000, kind: "error" });

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

window.organizator = app; // handy for debugging in the console
