// Organizator – board view: lists, cards, composer, filter, menus, drag & drop.
// DOM nodes for lists and cards are kept per id and reconciled, so scroll positions,
// open composers and focus survive every update.
import { h, icon, iconBtn, openMenu, toast, confirmDialog, autogrow, saveFile } from "../ui.js";
import * as M from "../model.js";
import { attachDnd } from "../dnd.js";
import { isDark, setThemeColor } from "../theme.js";
import { renderCardFace, saveIndicator, backgroundGrid, colorDot } from "./shared.js";
import { openCard } from "./card.js";
import { openLabels } from "./labels.js";

const keepFocus = (e) => e.preventDefault(); // on mousedown: buttons must not steal focus from the input

export function exportFileName(title) {
  const slug = M.clean(title, 60).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `organizator-${slug || "board"}-${M.isoDay(new Date())}.json`;
}

export function BoardView(root, boardId, app) {
  const { store } = app;
  const emptyFilter = () => ({ q: "", labels: [], hideDone: false, due: false });
  const ui = { filterOpen: false, filter: emptyFilter(), composer: null, addingList: false, editingTitle: false, pending: false };
  const board = () => M.findBoard(store.data, boardId);
  const mutate = (fn, opts) => store.commitBoard(boardId, fn, opts);

  // ---------------------------------------------------------------- skeleton
  const titleSlot = h("div.board-title-slot");
  const starBtn = iconBtn("star", "Favorit", () => mutate((b) => { b.starred = !b.starred; }));
  const filterBtn = iconBtn("filter", "Filtern (F)", () => toggleFilter());
  const header = h("header.topbar.board-top",
    iconBtn("back", "Alle Boards", () => app.navigate("#/")),
    titleSlot,
    starBtn,
    h("div.spacer"),
    saveIndicator(),
    filterBtn,
    iconBtn("sliders", "Darstellung & Daten", () => app.openSettings()),
    iconBtn("more", "Board-Menü", (e) => boardMenu(e.currentTarget)));

  const filterInput = h("input.filter-input", {
    type: "search",
    placeholder: "Karten filtern …",
    "aria-label": "Karten filtern",
    oninput: () => { ui.filter.q = filterInput.value; update(); },
    onkeydown: (e) => { if (e.key === "Escape") { e.stopPropagation(); toggleFilter(false); } },
  });
  const filterChips = h("div.filter-chips");
  const filterbar = h("div.filterbar", { hidden: true },
    h("label.filter-field", icon("search", 16), filterInput),
    filterChips,
    h("button.link.filter-reset", { type: "button", onclick: () => { ui.filter = emptyFilter(); filterInput.value = ""; update(); } }, "Zurücksetzen"));

  const listsEl = h("div.lists");
  const addListEl = h("div.add-list");
  listsEl.append(addListEl);
  const screen = h("div.screen.board-screen.bg-scope", header, filterbar, listsEl);
  root.replaceChildren(screen);

  const listEls = new Map();
  const cardEls = new Map();

  // ---------------------------------------------------------------- drag & drop, clicks
  const dnd = attachDnd(listsEl, {
    onCardDrop: (cardId, listId, beforeId) => mutate((b) => M.moveCard(b, cardId, listId, beforeId)),
    onListDrop: (listId, beforeId) => mutate((b) => M.moveList(b, listId, beforeId)),
    onEnd: () => { if (ui.pending) { ui.pending = false; update(); } },
  });

  listsEl.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (!card || !listsEl.contains(card)) return;
    const id = card.dataset.card;
    if (e.target.closest("[data-action=done]")) {
      mutate((b) => {
        const loc = M.locateCard(b, id);
        if (!loc) return false;
        loc.card.done = !loc.card.done;
        loc.card.updated = Date.now();
      });
      return;
    }
    openCard(app, boardId, id);
  });
  listsEl.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList?.contains("card")) {
      e.preventDefault();
      openCard(app, boardId, e.target.dataset.card);
    }
  });

  // ---------------------------------------------------------------- header
  function renderTitle(b) {
    if (ui.editingTitle) return;
    titleSlot.replaceChildren(h("button.board-title", { type: "button", title: "Umbenennen", onclick: editBoardTitle }, b.title));
  }

  function editBoardTitle() {
    const b = board();
    if (!b) return;
    ui.editingTitle = true;
    const input = h("input.board-title-input", { value: b.title, maxLength: 120, "aria-label": "Board-Titel" });
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      ui.editingTitle = false;
      const v = M.clean(input.value, 120);
      if (save && v && v !== board()?.title) mutate((bb) => { bb.title = v; });
      else update();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      if (e.key === "Escape") { e.stopPropagation(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
    titleSlot.replaceChildren(input);
    input.focus();
    input.select();
  }

  function boardMenu(anchor) {
    const b = board();
    if (!b) return;
    openMenu(anchor, [
      { title: "Hintergrund" },
      backgroundGrid(b.bg, (key) => mutate((bb) => { bb.bg = key; })),
      "sep",
      { icon: "tag", label: "Labels bearbeiten", onClick: () => openLabels(app, boardId) },
      { icon: "edit", label: "Umbenennen", onClick: editBoardTitle },
      { icon: "filter", label: "Karten filtern", onClick: () => toggleFilter(true) },
      { icon: "copy", label: "Board duplizieren", onClick: duplicateBoard },
      { icon: "download", label: "Board exportieren", onClick: () => saveFile(exportFileName(b.title), store.exportString(boardId)) },
      "sep",
      { icon: "trash", label: "Board löschen", danger: true, onClick: deleteBoard },
    ], { className: "board-menu" });
  }

  function duplicateBoard() {
    let copy = null;
    store.commit((d) => { copy = M.duplicateBoard(d, boardId); });
    if (copy) {
      app.navigate(`#/b/${copy.id}`);
      toast("Board dupliziert");
    }
  }

  async function deleteBoard() {
    const b = board();
    if (!b) return;
    const n = M.boardStats(b).cards;
    const ok = await confirmDialog({
      title: "Board löschen?",
      message: `„${b.title}“${n ? ` mit ${n} ${n === 1 ? "Karte" : "Karten"}` : ""} wird gelöscht.`,
      confirm: "Löschen",
      danger: true,
    });
    if (!ok) return;
    store.commit((d) => M.deleteBoard(d, boardId));
    app.navigate("#/");
    toast(`„${b.title}“ gelöscht`, { action: { label: "Rückgängig", onClick: () => store.undo() } });
  }

  // ---------------------------------------------------------------- filter
  function toggleFilter(force) {
    ui.filterOpen = force ?? !ui.filterOpen;
    if (!ui.filterOpen) {
      ui.filter = emptyFilter();
      filterInput.value = "";
    }
    update();
    if (ui.filterOpen) filterInput.focus();
  }

  function renderFilterChips(b) {
    const f = ui.filter;
    const chip = (label, on, onClick, lead) =>
      h("button.chip", { type: "button", class: on && "on", "aria-pressed": String(on), onclick: onClick }, lead, label);
    filterChips.replaceChildren(
      ...b.labels.map((l) => chip(l.name || M.COLORS[l.color].name, f.labels.includes(l.id), () => {
        f.labels = f.labels.includes(l.id) ? f.labels.filter((x) => x !== l.id) : [...f.labels, l.id];
        update();
      }, colorDot(l.color, 9))),
      chip("Bald fällig", f.due, () => { f.due = !f.due; update(); }, icon("calendar", 14)),
      chip("Erledigte ausblenden", f.hideDone, () => { f.hideDone = !f.hideDone; update(); }, icon("check", 14)));
  }

  // ---------------------------------------------------------------- lists
  function createListEl(list) {
    const titleBtn = h("button.list-title", { type: "button", onclick: () => editListTitle(list.id) });
    const count = h("span.list-count");
    const menuBtn = h("button.icon-btn.sm.list-menu-btn", { type: "button", "aria-label": "Listenmenü", title: "Listenmenü", onclick: (e) => listMenu(list.id, e.currentTarget) }, icon("more", 18));
    const head = h("header.list-head", titleBtn, count, menuBtn);
    const cards = h("div.cards", { dataset: { cards: list.id } });
    const foot = h("footer.list-foot");
    const el = h("section.list", { dataset: { list: list.id }, "aria-label": list.title }, head, cards, foot);
    el._r = { titleBtn, count, cards, foot, head };
    renderFoot(el, list.id);
    return el;
  }

  function updateList(el, list, b, s, now, seen) {
    const { titleBtn, count, cards } = el._r;
    titleBtn.textContent = list.title;
    el.setAttribute("aria-label", list.title);
    let visible = 0;
    list.cards.forEach((card, i) => {
      let c = cardEls.get(card.id);
      if (!c) {
        c = h("article.card", { tabIndex: 0, dataset: { card: card.id } });
        cardEls.set(card.id, c);
      }
      seen.add(card.id);
      if (cards.children[i] !== c) cards.insertBefore(c, cards.children[i] ?? null);
      renderCardFace(c, card, b, s, now);
      const match = M.cardMatches(card, ui.filter, b, now);
      c.hidden = !match;
      if (match) visible++;
    });
    while (cards.children.length > list.cards.length) cards.lastElementChild.remove();
    count.textContent = M.filterActive(ui.filter) ? `${visible}/${list.cards.length}` : list.cards.length ? String(list.cards.length) : "";
    el.classList.toggle("is-empty", !list.cards.length);
  }

  function editListTitle(listId) {
    const el = listEls.get(listId);
    const list = M.findList(board(), listId);
    if (!el || !list) return;
    const input = h("input.list-title-input", { value: list.title, maxLength: 120, "aria-label": "Listenname" });
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = M.clean(input.value, 120);
      input.replaceWith(el._r.titleBtn);
      if (save && v && v !== list.title) mutate((b) => { const l = M.findList(b, listId); if (l) l.title = v; });
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      if (e.key === "Escape") { e.stopPropagation(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
    el._r.titleBtn.replaceWith(input);
    input.focus();
    input.select();
  }

  function listMenu(listId, anchor) {
    const b = board();
    const i = b.lists.findIndex((l) => l.id === listId);
    if (i < 0) return;
    openMenu(anchor, [
      { icon: "plus", label: "Karte hinzufügen", onClick: () => openComposer(listId) },
      { icon: "edit", label: "Umbenennen", onClick: () => editListTitle(listId) },
      { icon: "copy", label: "Liste kopieren", onClick: () => mutate((bb) => M.duplicateList(bb, listId)) },
      { icon: "left", label: "Nach links", disabled: i === 0, onClick: () => mutate((bb) => M.shiftList(bb, listId, -1)) },
      { icon: "right", label: "Nach rechts", disabled: i === b.lists.length - 1, onClick: () => mutate((bb) => M.shiftList(bb, listId, 1)) },
      "sep",
      { icon: "trash", label: "Liste löschen", danger: true, onClick: () => deleteList(listId) },
    ]);
  }

  async function deleteList(listId) {
    const list = M.findList(board(), listId);
    if (!list) return;
    const n = list.cards.length;
    if (n && !(await confirmDialog({ title: "Liste löschen?", message: `„${list.title}“ und ${n === 1 ? "eine Karte" : `${n} Karten`} werden gelöscht.`, confirm: "Löschen", danger: true }))) return;
    mutate((b) => M.deleteList(b, listId));
    toast(`Liste „${list.title}“ gelöscht`, { action: { label: "Rückgängig", onClick: () => store.undo() } });
  }

  // ---------------------------------------------------------------- composer (new card)
  function renderFoot(el, listId) {
    if (ui.composer === listId) return;
    el._r.foot.replaceChildren(h("button.add-card", { type: "button", onclick: () => openComposer(listId) }, icon("plus", 16), "Karte hinzufügen"));
  }

  function closeComposer() {
    const id = ui.composer;
    ui.composer = null;
    const el = id && listEls.get(id);
    if (el) renderFoot(el, id);
  }

  function openComposer(listId) {
    if (ui.composer && ui.composer !== listId) closeComposer();
    const el = listEls.get(listId);
    if (!el) return;
    ui.composer = listId;
    const ta = h("textarea.composer-input", { rows: 2, maxLength: 500, placeholder: "Titel eingeben …", "aria-label": "Titel der neuen Karte" });
    const submit = () => {
      const t = ta.value.trim();
      if (!t) return ta.focus();
      mutate((b) => M.addCard(b, listId, t));
      ta.value = "";
      fit();
      ta.focus();
      el._r.cards.scrollTop = el._r.cards.scrollHeight;
    };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
      else if (e.key === "Escape") { e.stopPropagation(); closeComposer(); }
    });
    const box = h("div.composer", ta, h("div.composer-actions",
      h("button.btn.primary", { type: "button", onmousedown: keepFocus, onclick: submit }, "Hinzufügen"),
      iconBtn("x", "Abbrechen", closeComposer)));
    ta.addEventListener("blur", () => setTimeout(() => {
      if (ui.composer === listId && !box.contains(document.activeElement) && !ta.value.trim()) closeComposer();
    }, 150));
    el._r.foot.replaceChildren(box);
    const fit = autogrow(ta);
    ta.focus();
    el._r.cards.scrollTop = el._r.cards.scrollHeight;
  }

  // ---------------------------------------------------------------- add list
  function renderAddList() {
    addListEl.classList.toggle("open", ui.addingList);
    if (!ui.addingList) {
      addListEl.replaceChildren(h("button.add-list-btn", { type: "button", onclick: () => { ui.addingList = true; renderAddList(); } }, icon("plus", 16), "Liste hinzufügen"));
      return;
    }
    const input = h("input.field", { placeholder: "Name der Liste …", maxLength: 120, "aria-label": "Name der neuen Liste" });
    const close = () => { ui.addingList = false; renderAddList(); };
    const submit = () => {
      const t = input.value.trim();
      if (!t) return input.focus();
      mutate((b) => M.addList(b, t));
      input.value = "";
      input.focus();
      listsEl.scrollTo({ left: listsEl.scrollWidth, behavior: store.settings.motion ? "smooth" : "auto" });
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submit(); }
      else if (e.key === "Escape") { e.stopPropagation(); close(); }
    });
    input.addEventListener("blur", () => setTimeout(() => {
      if (ui.addingList && !addListEl.contains(document.activeElement) && !input.value.trim()) close();
    }, 150));
    addListEl.replaceChildren(input, h("div.composer-actions",
      h("button.btn.primary", { type: "button", onmousedown: keepFocus, onclick: submit }, "Liste hinzufügen"),
      iconBtn("x", "Abbrechen", close)));
    input.focus();
  }

  // ---------------------------------------------------------------- update (reconcile)
  function update() {
    const b = board();
    if (!b) return app.navigate("#/");
    if (dnd.active) { ui.pending = true; return; }
    const s = store.settings;
    const now = new Date();

    const bg = M.boardBackground(b.bg, s.bgStyle, isDark(s));
    screen.dataset.bg = bg.mode;
    screen.style.setProperty("--board-bg", bg.css || "var(--bg)");
    setThemeColor(bg.top);
    document.title = `${b.title} · Organizator`;

    renderTitle(b);
    starBtn.classList.toggle("on", b.starred);
    starBtn.replaceChildren(icon(b.starred ? "starFill" : "star", 18));
    starBtn.setAttribute("aria-pressed", String(b.starred));
    filterBtn.classList.toggle("on", ui.filterOpen || M.filterActive(ui.filter));
    filterbar.hidden = !ui.filterOpen;
    if (ui.filterOpen) renderFilterChips(b);

    const seenCards = new Set();
    b.lists.forEach((list, i) => {
      let el = listEls.get(list.id);
      if (!el) {
        el = createListEl(list);
        listEls.set(list.id, el);
      }
      if (listsEl.children[i] !== el) listsEl.insertBefore(el, listsEl.children[i] ?? addListEl);
      updateList(el, list, b, s, now, seenCards);
    });
    for (const [id, el] of listEls) {
      if (!b.lists.some((l) => l.id === id)) {
        el.remove();
        listEls.delete(id);
        if (ui.composer === id) ui.composer = null;
      }
    }
    for (const [id, el] of cardEls) if (!seenCards.has(id)) { el.remove(); cardEls.delete(id); }
    if (listsEl.lastElementChild !== addListEl) listsEl.append(addListEl);
  }

  renderAddList();
  if (!board()?.lists.length) { ui.addingList = true; renderAddList(); }

  return {
    update,
    onKey(e) {
      if (e.key === "Escape" && ui.filterOpen) { toggleFilter(false); return; }
      if (e.key === "f" || e.key === "/") { e.preventDefault(); toggleFilter(true); }
      if (e.key === "n" && board()?.lists.length) { e.preventDefault(); openComposer(board().lists[0].id); }
    },
    destroy() { dnd.cancel(); },
  };
}
