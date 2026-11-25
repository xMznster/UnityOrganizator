// Organizator – pieces shared by several views.
import { h, icon, relTime } from "../ui.js";
import { COLORS, BACKGROUNDS, backgroundSwatch, dueInfo, checklistProgress } from "../model.js";

/** Renders the front of a card into `el` (an <article class="card">). */
export function renderCardFace(el, card, board, s, now = new Date()) {
  const kids = [];
  if (card.cover) kids.push(h("div.card-cover", { style: { "--c": COLORS[card.cover].hex } }));
  const labels = card.labels.map((id) => board.labels.find((l) => l.id === id)).filter(Boolean);
  if (labels.length) {
    kids.push(h("div.card-labels", labels.map((l) => {
      const c = COLORS[l.color].hex;
      return s.labelStyle === "names" && l.name
        ? h("span.lbl-pill", { style: { "--c": c } }, l.name)
        : h("span.lbl-bar", { style: { "--c": c }, title: l.name || COLORS[l.color].name });
    })));
  }
  kids.push(h("div.card-main",
    h("button.card-done", { type: "button", class: card.done && "on", "aria-label": card.done ? "Als offen markieren" : "Als erledigt markieren", dataset: { action: "done" } }, icon("check", 12)),
    h("div.card-title", card.title)));
  const badges = [];
  if (s.showDue && card.due) {
    const d = dueInfo(card, now);
    badges.push(h("span.badge.due", { class: d.state, title: "Fällig" }, icon("calendar", 13), d.label));
  }
  if (s.showChecklist && card.checklist.length) {
    const p = checklistProgress(card);
    badges.push(h("span.badge.check", { class: p.done === p.total && "complete", title: "Checkliste" }, icon("checklist", 13), `${p.done}/${p.total}`));
  }
  if (s.showDesc && card.desc.trim()) badges.push(h("span.badge", { title: "Hat eine Beschreibung" }, icon("text", 13)));
  if (badges.length) kids.push(h("div.card-badges", badges));
  el.classList.toggle("done", card.done);
  el.classList.toggle("has-cover", !!card.cover);
  el.setAttribute("aria-label", card.title);
  el.replaceChildren(...kids);
  return el;
}

export function logo(size = 26) {
  const style = { width: size + "px", height: size + "px", padding: Math.round(size * 0.24) + "px", gap: Math.max(2, Math.round(size * 0.08)) + "px" };
  return h("span.logo", { style, "aria-hidden": "true" }, h("i"), h("i"), h("i"));
}

/** "Gespeichert" indicator – app.js keeps every instance up to date. */
export function saveIndicator() {
  return h("span.save-ind", { role: "status", "aria-live": "polite" }, icon("check", 14), h("span.save-txt", "Gespeichert"));
}

export function updateSaveIndicators(store) {
  for (const el of document.querySelectorAll(".save-ind")) {
    const state = store.saveError ? "error" : store.dirty ? "saving" : "saved";
    el.dataset.state = state;
    el.title = store.saveError ?? (store.lastSaved ? `Lokal gespeichert ${relTime(store.lastSaved)}` : "");
    el.querySelector(".save-txt").textContent = state === "error" ? "Nicht gespeichert" : state === "saving" ? "Speichert …" : "Gespeichert";
  }
}

/** Grid of board background swatches. */
export function backgroundGrid(current, onPick) {
  const grid = h("div.bg-grid");
  const draw = (sel) => grid.replaceChildren(...Object.entries(BACKGROUNDS).map(([key, bg]) =>
    h("button.bg-swatch", {
      type: "button",
      title: bg.name,
      "aria-label": bg.name,
      "aria-pressed": String(key === sel),
      class: [key === sel && "on", key === "none" && "neutral"],
      style: { background: backgroundSwatch(key) || null },
      onclick: () => { draw(key); onPick(key); },
    }, key === sel && icon("check", 14))));
  draw(current);
  return grid;
}

export function colorDot(colorId, size = 12) {
  return h("span.dot", { style: { "--c": COLORS[colorId]?.hex ?? "transparent", width: size + "px", height: size + "px" } });
}
