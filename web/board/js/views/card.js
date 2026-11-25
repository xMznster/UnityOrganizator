// Organizator – card detail (dialog on desktop, bottom sheet on phones). Every change is saved immediately.
import { h, icon, iconBtn, openModal, openMenu, closeMenu, toast, autogrow, fmtDateTime } from "../ui.js";
import * as M from "../model.js";
import { openLabels } from "./labels.js";

export function openCard(app, boardId, cardId) {
  const { store } = app;
  const get = () => {
    const b = M.findBoard(store.data, boardId);
    const loc = b && M.locateCard(b, cardId);
    return loc ? { b, ...loc } : null;
  };
  if (!get()) return;

  let self = false;
  const mutate = (fn, opts) => {
    self = true;
    try {
      return store.commitBoard(boardId, (b) => {
        const loc = M.locateCard(b, cardId);
        if (!loc) return false;
        const r = fn(loc.card, b, loc);
        if (r !== false) loc.card.updated = Date.now();
        return r;
      }, opts);
    } finally {
      self = false;
    }
  };
  let showChecklist = false;

  // ---------------------------------------------------------------- elements
  const cover = h("div.cm-cover");
  const doneBtn = h("button.cm-done", { type: "button", onclick: () => { mutate((c) => { c.done = !c.done; }); renderTop(); } }, icon("check", 14));
  const title = h("textarea.cm-title", {
    rows: 1,
    maxLength: 500,
    "aria-label": "Titel",
    oninput: () => {
      const v = M.clean(title.value);
      if (v) mutate((c) => { c.title = v; }, { undoKey: `title:${cardId}` });
    },
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } },
    onblur: () => { const g = get(); if (g && !M.clean(title.value)) { title.value = g.card.title; fitTitle(); } },
  });
  const listSel = h("select.cm-select", {
    "aria-label": "Liste",
    onchange: () => { mutate((c, b) => M.moveCard(b, cardId, listSel.value, null)); renderTop(); },
  });
  const sub = h("div.cm-sub", h("span", "in Liste"), h("span.select-wrap", listSel, icon("chevronDown", 14)));
  const pill = (ic, label, onClick) => h("button.pill", { type: "button", onclick: onClick }, icon(ic, 15), label);
  const actions = h("div.cm-actions",
    pill("tag", "Labels", (e) => labelMenu(e.currentTarget)),
    pill("calendar", "Datum", (e) => dateMenu(e.currentTarget)),
    pill("checklist", "Checkliste", () => { showChecklist = true; renderChecklist(true); }),
    pill("droplet", "Farbe", (e) => coverMenu(e.currentTarget)));
  const meta = h("dl.cm-meta");
  const desc = h("textarea.cm-desc", {
    placeholder: "Beschreibung hinzufügen …",
    rows: 3,
    maxLength: 20000,
    "aria-label": "Beschreibung",
    oninput: () => mutate((c) => { c.desc = desc.value; }, { undoKey: `desc:${cardId}` }),
  });
  const checklist = h("section.cm-section.cm-checklist");
  const info = h("span.cm-info");

  const modal = openModal((api) => [
    cover,
    h("div.cm-body",
      h("div.cm-head", doneBtn, title, iconBtn("x", "Schließen", api.close, { class: "cm-close" })),
      sub,
      actions,
      meta,
      h("section.cm-section", h("h4.cm-h", icon("text", 16), "Beschreibung"), desc),
      checklist),
    h("footer.cm-foot",
      info,
      h("div.spacer"),
      h("button.btn.ghost.sm", { type: "button", onclick: duplicate }, icon("copy", 15), "Duplizieren"),
      h("button.btn.danger.sm", { type: "button", onclick: remove }, icon("trash", 15), "Löschen")),
  ], { className: "card-modal", onClose: () => { unsub(); closeMenu(); } });

  const fitTitle = autogrow(title);
  const fitDesc = autogrow(desc);

  // ---------------------------------------------------------------- sections
  function renderTop() {
    const g = get();
    if (!g) return;
    const { card, b, list } = g;
    cover.hidden = !card.cover;
    if (card.cover) cover.style.setProperty("--c", M.COLORS[card.cover].hex);
    doneBtn.classList.toggle("on", card.done);
    doneBtn.setAttribute("aria-label", card.done ? "Als offen markieren" : "Als erledigt markieren");
    doneBtn.title = card.done ? "Erledigt" : "Als erledigt markieren";
    if (document.activeElement !== title && title.value !== card.title) { title.value = card.title; fitTitle(); }
    listSel.replaceChildren(...b.lists.map((l) => h("option", { value: l.id, selected: l.id === list.id }, l.title)));
    listSel.value = list.id;
    info.textContent = `Erstellt ${fmtDateTime(card.created)}`;
  }

  function renderMeta() {
    const g = get();
    if (!g) return;
    const { card, b } = g;
    const rows = [];
    const labels = card.labels.map((id) => b.labels.find((l) => l.id === id)).filter(Boolean);
    if (labels.length) {
      rows.push(h("dt", "Labels"), h("dd",
        labels.map((l) => h("span.label-chip", { style: { "--c": M.COLORS[l.color].hex } }, l.name || M.COLORS[l.color].name)),
        h("button.chip-add", { type: "button", "aria-label": "Labels ändern", onclick: (e) => labelMenu(e.currentTarget) }, icon("plus", 14))));
    }
    if (card.due) {
      const d = M.dueInfo(card);
      const state = { overdue: "Überfällig", soon: "Bald fällig", done: "Erledigt", later: "" }[d.state];
      rows.push(h("dt", "Fällig"), h("dd",
        h("button.due-chip", { type: "button", class: d.state, onclick: (e) => dateMenu(e.currentTarget) }, icon("calendar", 14), d.label, d.days !== 0 && d.days !== 1 && d.days !== -1 ? "" : ` · ${M.formatDay(card.due)}`),
        state && h("span.due-state", { class: d.state }, state)));
    }
    meta.hidden = !rows.length;
    meta.replaceChildren(...rows);
  }

  function renderChecklist(focusAdd = false) {
    const g = get();
    if (!g) return;
    const { card } = g;
    if (!card.checklist.length && !showChecklist) {
      checklist.hidden = true;
      checklist.replaceChildren();
      return;
    }
    checklist.hidden = false;
    const p = M.checklistProgress(card);
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    const add = h("input.check-add", {
      placeholder: "Punkt hinzufügen …",
      maxLength: 300,
      "aria-label": "Neuer Checklisten-Punkt",
      onkeydown: (e) => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          if (!add.value.trim()) return;
          mutate((c) => M.addCheckItem(c, add.value));
          renderChecklist(true);
        }
      },
    });
    const items = card.checklist.map((item) => h("li.check-item", { class: item.done && "done" },
      h("button.check-box", {
        type: "button",
        class: item.done && "on",
        role: "checkbox",
        "aria-checked": String(item.done),
        "aria-label": item.text,
        onclick: () => {
          mutate((c) => { const it = c.checklist.find((x) => x.id === item.id); if (it) it.done = !it.done; });
          renderChecklist();
        },
      }, icon("check", 12)),
      h("input.check-text", {
        value: item.text,
        maxLength: 300,
        "aria-label": "Checklisten-Punkt",
        oninput: (e) => {
          const v = M.clean(e.target.value, 300);
          if (v) mutate((c) => { const it = c.checklist.find((x) => x.id === item.id); if (it) it.text = v; }, { undoKey: `check:${item.id}` });
        },
        onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); add.focus(); } },
        onblur: (e) => { if (!M.clean(e.target.value)) renderChecklist(); },
      }),
      iconBtn("x", "Punkt entfernen", () => {
        mutate((c) => { c.checklist = c.checklist.filter((x) => x.id !== item.id); });
        renderChecklist();
      }, { class: "sm check-del", size: 15 })));
    checklist.replaceChildren(
      h("h4.cm-h", icon("checklist", 16), "Checkliste", p.total ? h("span.cm-h-meta", `${p.done}/${p.total}`) : null),
      p.total ? h("div.progress", h("div.progress-bar", { class: pct === 100 && "full", style: { width: pct + "%" } })) : null,
      h("ul.check-items", items),
      h("div.check-add-row", icon("plus", 16), add));
    if (focusAdd) add.focus();
  }

  function renderAll() {
    renderTop();
    renderMeta();
    if (!checklist.contains(document.activeElement)) renderChecklist();
    const g = get();
    if (g && document.activeElement !== desc && desc.value !== g.card.desc) { desc.value = g.card.desc; fitDesc(); }
  }

  // ---------------------------------------------------------------- popovers
  function labelMenu(anchor) {
    const items = () => {
      const g = get();
      if (!g) return [];
      return [
        { title: "Labels" },
        ...g.b.labels.map((l) => {
          const on = g.card.labels.includes(l.id);
          return h("button.menu-item.label-option", {
            type: "button",
            "aria-pressed": String(on),
            onclick: () => {
              mutate((c) => M.toggleLabel(c, l.id));
              menu.render(items());
              renderMeta();
            },
          }, h("span.label-swatch", { style: { "--c": M.COLORS[l.color].hex } }, l.name || M.COLORS[l.color].name),
          on ? icon("check", 16, "label-check") : h("span.label-check"));
        }),
        "sep",
        { icon: "edit", label: "Labels bearbeiten …", onClick: () => openLabels(app, boardId) },
      ];
    };
    const menu = openMenu(anchor, items(), { className: "label-menu" });
  }

  function dateMenu(anchor) {
    const g = get();
    if (!g) return;
    const today = new Date();
    const set = (iso) => { mutate((c) => { c.due = iso; }); renderMeta(); };
    const input = h("input.field.date-input", {
      type: "date",
      value: g.card.due ?? "",
      "aria-label": "Datum wählen",
      onchange: () => { set(M.validDate(input.value)); },
    });
    openMenu(anchor, [
      { title: "Fälligkeitsdatum" },
      { icon: "calendar", label: "Heute", hint: M.formatDay(M.isoDay(today)), onClick: () => set(M.isoDay(today)) },
      { icon: "calendar", label: "Morgen", hint: M.formatDay(M.isoDay(M.addDays(today, 1))), onClick: () => set(M.isoDay(M.addDays(today, 1))) },
      { icon: "calendar", label: "In einer Woche", hint: M.formatDay(M.isoDay(M.addDays(today, 7))), onClick: () => set(M.isoDay(M.addDays(today, 7))) },
      h("div.menu-field", input),
      g.card.due ? "sep" : null,
      g.card.due ? { icon: "x", label: "Datum entfernen", danger: true, onClick: () => set(null) } : null,
    ], { className: "date-menu" });
  }

  function coverMenu(anchor) {
    const g = get();
    if (!g) return;
    const grid = h("div.cover-grid",
      h("button.cover-swatch.none", { type: "button", class: !g.card.cover && "on", title: "Keine Farbe", "aria-label": "Keine Farbe", onclick: () => pick(null) }, icon("x", 14)),
      M.COLOR_IDS.map((id) => h("button.cover-swatch", { type: "button", class: g.card.cover === id && "on", title: M.COLORS[id].name, "aria-label": M.COLORS[id].name, style: { "--c": M.COLORS[id].hex }, onclick: () => pick(id) })));
    function pick(id) {
      mutate((c) => { c.cover = id; });
      closeMenu();
      renderTop();
    }
    openMenu(anchor, [{ title: "Kartenfarbe" }, grid], { className: "cover-menu" });
  }

  // ---------------------------------------------------------------- actions
  function duplicate() {
    let copy = null;
    self = true;
    try { store.commitBoard(boardId, (b) => { copy = M.duplicateCard(b, cardId); return copy ? true : false; }); } finally { self = false; }
    if (copy) toast("Kopie erstellt", { action: { label: "Öffnen", onClick: () => { modal.close(); openCard(app, boardId, copy.id); } } });
  }

  function remove() {
    modal.close();
    store.commitBoard(boardId, (b) => (M.deleteCard(b, cardId) ? true : false));
    toast("Karte gelöscht", { action: { label: "Rückgängig", onClick: () => store.undo() } });
  }

  // External changes (undo, other tab, label edits) refresh the dialog.
  const unsub = store.subscribe((info) => {
    if (info.kind !== "data" || self) return;
    if (!get()) return modal.close();
    renderAll();
  });

  renderAll();
}
