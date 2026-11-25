// Organizator – start screen: all boards as tiles, favourites first, "new board" dialog.
import { h, icon, iconBtn, openModal, segmented } from "../ui.js";
import * as M from "../model.js";
import { isDark, setThemeColor } from "../theme.js";
import { logo, saveIndicator, backgroundGrid } from "./shared.js";

export function HomeView(root, app) {
  const { store } = app;
  const screen = h("div.screen.home-screen");
  root.replaceChildren(screen);

  function tile(b, s, dark, now) {
    const bg = M.boardBackground(b.bg, s.bgStyle, dark);
    const st = M.boardStats(b, now);
    const max = Math.max(1, ...b.lists.map((l) => l.cards.length));
    const meta = [`${st.cards} ${st.cards === 1 ? "Karte" : "Karten"}`];
    if (st.overdue) meta.push(h("span.tile-warn", `${st.overdue} überfällig`));
    return h("a.tile", { href: `#/b/${b.id}`, dataset: { bg: bg.mode }, style: { "--tile-bg": bg.css || null } },
      h("div.tile-cols", { "aria-hidden": "true" }, b.lists.slice(0, 7).map((l) => h("i", { style: { height: `${22 + (78 * l.cards.length) / max}%` } }))),
      h("div.tile-title", b.title),
      h("div.tile-meta", meta.flatMap((m, i) => (i ? [" · ", m] : [m]))),
      h("button.tile-star", {
        type: "button",
        class: b.starred && "on",
        "aria-label": b.starred ? "Aus Favoriten entfernen" : "Zu Favoriten",
        title: b.starred ? "Aus Favoriten entfernen" : "Zu Favoriten",
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          store.commitBoard(b.id, (bb) => { bb.starred = !bb.starred; });
        },
      }, icon(b.starred ? "starFill" : "star", 16)));
  }

  function update() {
    const s = store.settings;
    const dark = isDark(s);
    const now = new Date();
    const boards = store.data.boards;
    const starred = boards.filter((b) => b.starred);
    const totals = boards.reduce((t, b) => {
      const st = M.boardStats(b, now);
      return { cards: t.cards + st.cards, overdue: t.overdue + st.overdue, done: t.done + st.done };
    }, { cards: 0, overdue: 0, done: 0 });
    setThemeColor(null);
    document.title = "Organizator";
    const scroll = screen.scrollTop;

    const section = (title, list, withNew) => h("section.home-section",
      h("h2", title),
      h("div.tiles",
        list.map((b) => tile(b, s, dark, now)),
        withNew && h("button.tile.tile-new", { type: "button", onclick: () => openNewBoard(app) }, icon("plus", 18), "Neues Board")));

    const summary = boards.length
      ? [`${boards.length} ${boards.length === 1 ? "Board" : "Boards"}`, `${totals.cards} Karten`, totals.done ? `${totals.done} erledigt` : null, totals.overdue ? `${totals.overdue} überfällig` : null].filter(Boolean).join(" · ")
      : "Lege dein erstes Board an – zum Beispiel für ein Projekt, deine Woche oder Ideen.";

    screen.replaceChildren(
      h("header.topbar.home-top",
        h("div.brand", logo(26), h("span.brand-name", "Organizator")),
        h("div.spacer"),
        saveIndicator(),
        iconBtn("sliders", "Darstellung & Daten", () => app.openSettings())),
      h("main.home-main",
        h("div.home-hello", h("h1", "Deine Boards"), h("p", summary)),
        starred.length ? section("Favoriten", starred, false) : null,
        section(starred.length ? "Alle Boards" : "Boards", boards, true)));
    screen.scrollTop = scroll;
    app.refreshSaveIndicators();
  }

  return { update, onKey(e) { if (e.key === "n") { e.preventDefault(); openNewBoard(app); } } };
}

export function openNewBoard(app) {
  const { store } = app;
  const st = { title: "", bg: "sky", template: "kanban" };
  const s = store.settings;
  const preview = h("div.nb-preview");

  function drawPreview() {
    const bg = M.boardBackground(st.bg, s.bgStyle, isDark(s));
    preview.dataset.bg = bg.mode;
    preview.style.setProperty("--tile-bg", bg.css || "var(--surface-2)");
    const lists = M.TEMPLATES[st.template].lists;
    preview.replaceChildren(
      h("div.nb-title", st.title.trim() || "Neues Board"),
      h("div.nb-cols", lists.length
        ? lists.slice(0, 5).map((t, i) => h("div.nb-col", h("span", t), Array.from({ length: [2, 1, 3, 1, 2][i] }, () => h("i"))))
        : h("div.nb-empty", "Leeres Board")));
  }

  const input = h("input.field", {
    placeholder: "z. B. Projekt, Woche, Ideen …",
    maxLength: 120,
    "aria-label": "Titel des Boards",
    oninput: () => { st.title = input.value; drawPreview(); },
    onkeydown: (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); create(); } },
  });

  function create() {
    const board = M.createBoard({ ...st, title: st.title.trim() || "Neues Board" });
    store.commit((d) => { d.boards.push(board); });
    modal.close();
    app.navigate(`#/b/${board.id}`);
  }

  const modal = openModal((api) => [
    h("div.sheet-head", h("h2", "Neues Board"), iconBtn("x", "Schließen", api.close)),
    h("div.nb-body",
      preview,
      h("label.form-label", "Titel"),
      input,
      h("div.form-label", "Vorlage"),
      segmented(Object.entries(M.TEMPLATES).map(([value, t]) => ({ value, label: t.name })), st.template, (v) => { st.template = v; drawPreview(); }, { label: "Vorlage" }),
      h("div.form-label", "Hintergrund"),
      backgroundGrid(st.bg, (k) => { st.bg = k; drawPreview(); }),
      h("div.dlg-actions.mt",
        h("button.btn", { type: "button", onclick: api.close }, "Abbrechen"),
        h("button.btn.primary", { type: "button", onclick: create }, "Board erstellen"))),
  ], { className: "new-board" });
  drawPreview();
  setTimeout(() => input.focus(), 60);
}
