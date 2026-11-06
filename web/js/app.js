import { store } from "./store.js";
import { h, icon, toast } from "./ui/kit.js";
import { dashboard, vaultRoot, folderView, inboxView, favoritesView, trashView, searchView, notFound } from "./ui/views-main.js";
import { itemEditor } from "./ui/editors.js";
import { workflowView, syncView, compilerView, settingsView, runSync } from "./ui/views-workflow.js";
import { applyThemes, bindStore } from "./themes.js";

window.APP_VERSION = "1.0.0";

const TABS = [
  ["home", "Home", "grid", "#/home"],
  ["vault", "Vault", "folder", "#/vault"],
  ["search", "Suche", "search", "#/search"],
  ["workflow", "PC & Claude", "desktop", "#/workflow"],
  ["settings", "Einstellungen", "settings", "#/settings"],
];

let current = null;

function route() {
  const raw = location.hash.slice(1) || "/home";
  const [path, query] = raw.split("?");
  const params = new URLSearchParams(query || "");
  const parts = path.split("/").filter(Boolean);
  switch (parts[0]) {
    case "home": return dashboard();
    case "vault": return vaultRoot();
    case "folder": return folderView(parts[1]);
    case "item": return itemEditor(parts[1]);
    case "inbox": return inboxView();
    case "favorites": return favoritesView();
    case "trash": return trashView();
    case "search": return searchView(params);
    case "workflow": return workflowView();
    case "sync": return syncView();
    case "compiler": return compilerView();
    case "settings": return settingsView();
    default: return notFound();
  }
}

function render({ keepScroll = false } = {}) {
  const view = document.getElementById("view");
  const prevScroll = keepScroll ? view.querySelector(".screen-content")?.scrollTop : 0;
  if (current?.onHide && !keepScroll) current.onHide();
  const next = route();
  current = next;
  view.replaceChildren(next.root);
  document.body.classList.toggle("editing", !!next.editing);
  for (const b of document.querySelectorAll("#tabbar button")) b.classList.toggle("active", b.dataset.tab === next.tab);
  if (keepScroll && prevScroll) { const c = view.querySelector(".screen-content"); if (c) c.scrollTop = prevScroll; }
  next.onShow?.();
}

function buildTabbar() {
  const bar = document.getElementById("tabbar");
  bar.replaceChildren(...TABS.map(([id, label, ic, hash]) => h("button", { "data-tab": id, onclick: () => { if (location.hash === hash) render(); else location.hash = hash; }, "aria-label": label }, icon(ic, 23), h("span", label))));
}

// Keep editor toolbars above the iOS keyboard.
function trackViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb", kb + "px");
    document.documentElement.style.setProperty("--vvh", vv.height + "px");
    document.documentElement.style.setProperty("--vvtop", vv.offsetTop + "px");
    document.body.classList.toggle("keyboard", kb > 80);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}

async function main() {
  bindStore(store);
  applyThemes();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyThemes());
  buildTabbar();
  trackViewport();
  try {
    await store.init();
  } catch (e) {
    document.getElementById("view").replaceChildren(h("div.empty", h("h3", "Speicher nicht verfügbar"), h("p.muted", "IndexedDB konnte nicht geöffnet werden (privates Surfen?). " + e.message)));
    return;
  }
  applyThemes();
  store.onToast = (t, undo) => toast(t, undo);
  store.onError = (t) => toast("⚠︎ " + t);
  let pending = false;
  store.subscribe(() => {
    if (current?.keepOnStore || pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; if (!current?.keepOnStore) render({ keepScroll: true }); });
  });
  window.addEventListener("hashchange", () => render());
  // Flush editors when the app goes to the background.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") current?.onHide?.(); });
  window.addEventListener("pagehide", () => current?.onHide?.());
  render();
  document.getElementById("splash")?.remove();
  if (store.getMeta("sync.onLaunch", false)) runSync({ quiet: true });
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) toast("Update verfügbar – App neu öffnen", () => location.reload()); });
      });
    }).catch(() => {});
  }
}

main();
