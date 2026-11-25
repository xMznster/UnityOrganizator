// Organizator – edit the labels of a board (name + colour).
import { h, icon, iconBtn, openModal, openMenu, closeMenu } from "../ui.js";
import * as M from "../model.js";

export function openLabels(app, boardId) {
  const { store } = app;
  const mutate = (fn, opts) => store.commitBoard(boardId, fn, opts);
  const body = h("div.lbl-editor");

  function nextColor(b) {
    const used = new Set(b.labels.map((l) => l.color));
    return M.COLOR_IDS.find((c) => !used.has(c)) ?? "gray";
  }

  function colorMenu(anchor, labelId) {
    const b = M.findBoard(store.data, boardId);
    const label = b?.labels.find((l) => l.id === labelId);
    if (!label) return;
    openMenu(anchor, [
      { title: "Farbe" },
      h("div.cover-grid", M.COLOR_IDS.map((id) => h("button.cover-swatch", {
        type: "button",
        class: label.color === id && "on",
        title: M.COLORS[id].name,
        "aria-label": M.COLORS[id].name,
        style: { "--c": M.COLORS[id].hex },
        onclick: () => {
          mutate((bb) => { const l = bb.labels.find((x) => x.id === labelId); if (l) l.color = id; });
          closeMenu();
          render();
        },
      }))),
    ]);
  }

  function render(focusId = null) {
    const b = M.findBoard(store.data, boardId);
    if (!b) return modal.close();
    body.replaceChildren(
      ...b.labels.map((l) => h("div.lbl-row", { dataset: { id: l.id } },
        h("button.lbl-color", { type: "button", style: { "--c": M.COLORS[l.color].hex }, "aria-label": "Farbe ändern", title: "Farbe ändern", onclick: (e) => colorMenu(e.currentTarget, l.id) }),
        h("input.field.lbl-name", {
          value: l.name,
          placeholder: `${M.COLORS[l.color].name} (ohne Namen)`,
          maxLength: 40,
          "aria-label": "Name des Labels",
          oninput: (e) => mutate((bb) => { const x = bb.labels.find((y) => y.id === l.id); if (x) x.name = M.clean(e.target.value, 40); }, { undoKey: `label:${l.id}` }),
          onkeydown: (e) => { if (e.key === "Enter") e.target.blur(); },
        }),
        iconBtn("trash", "Label löschen", () => { mutate((bb) => M.removeLabel(bb, l.id)); render(); }))),
      h("button.btn.ghost.full", {
        type: "button",
        onclick: () => {
          let added = null;
          mutate((bb) => { added = M.addLabel(bb, nextColor(bb)); });
          render(added?.id);
        },
      }, icon("plus", 16), "Label hinzufügen"));
    if (focusId) body.querySelector(`[data-id="${focusId}"] input`)?.focus();
  }

  const modal = openModal((api) => [
    h("div.sheet-head", h("h2", "Labels"), iconBtn("x", "Schließen", api.close)),
    h("p.hint.pad", "Labels gruppieren Karten und lassen sich im Board filtern. Ein Name ist optional."),
    body,
  ], { className: "small labels-modal" });
  render();
}
