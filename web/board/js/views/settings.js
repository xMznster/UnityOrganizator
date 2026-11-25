// Organizator – settings: appearance (with live preview) and data (autosave, backups, import/export).
import { h, icon, iconBtn, openModal, segmented, toggle, slider, toast, confirmDialog, promptDialog, dialog, saveFile, pickFile, relTime, fmtDateTime, fmtBytes } from "../ui.js";
import * as M from "../model.js";
import { ACCENTS, FONTS, isDark } from "../theme.js";
import { renderCardFace } from "./shared.js";

export function openSettings(app, startTab = "look") {
  const { store } = app;
  let tab = startTab;
  const set = (patch) => store.setSettings(patch);
  const body = h("div.settings-body");
  const preview = h("div.preview.bg-scope");
  const tabs = h("div.settings-tabs");

  // ---------------------------------------------------------------- preview
  function drawPreview() {
    const s = store.settings;
    const bg = M.boardBackground("sky", s.bgStyle, isDark(s));
    preview.dataset.bg = bg.mode;
    preview.style.setProperty("--board-bg", bg.css);
    const now = new Date();
    const board = { labels: [{ id: "a", color: "green", name: "Design" }, { id: "b", color: "purple", name: "Idee" }, { id: "c", color: "blue", name: "Web" }] };
    const cards = [
      { id: "p1", title: "Farben und Schrift ausprobieren", desc: "Notiz", labels: ["a", "b"], due: M.isoDay(M.addDays(now, 1)), done: false, checklist: [{ done: true }, { done: true }, { done: false }], cover: null },
      { id: "p2", title: "Vorschau ansehen", desc: "", labels: ["c"], due: null, done: true, checklist: [], cover: null },
    ];
    preview.replaceChildren(h("div.list.preview-list",
      h("header.list-head", h("span.list-title", "Vorschau"), h("span.list-count", "2")),
      h("div.cards", cards.map((c) => renderCardFace(h("article.card"), c, board, s, now)))));
  }

  // ---------------------------------------------------------------- building blocks
  const group = (title, ...rows) => h("section.group", h("h3.group-title", title), h("div.group-box", rows));
  const row = (label, control, hint) => h("div.row", h("div.row-text", h("div.row-label", label), hint && h("div.row-hint", hint)), control);

  function accentPicker() {
    const wrap = h("div.swatches");
    const mark = (hex) => {
      const known = ACCENTS.some((a) => a.hex.toLowerCase() === hex.toLowerCase());
      for (const b of wrap.querySelectorAll(".swatch")) {
        const on = b.dataset.hex ? b.dataset.hex.toLowerCase() === hex.toLowerCase() : !known;
        b.classList.toggle("on", on);
      }
      custom.style.setProperty("--c", hex);
    };
    const colorInput = h("input", { type: "color", value: store.settings.accent, "aria-label": "Eigene Akzentfarbe", oninput: (e) => { set({ accent: e.target.value }); mark(e.target.value); } });
    const custom = h("label.swatch.custom", { title: "Eigene Farbe" }, colorInput);
    wrap.append(...ACCENTS.map((a) => h("button.swatch", {
      type: "button",
      title: a.name,
      "aria-label": a.name,
      dataset: { hex: a.hex },
      style: { "--c": a.hex },
      onclick: () => { set({ accent: a.hex }); colorInput.value = a.hex.toLowerCase(); mark(a.hex); },
    })), custom);
    mark(store.settings.accent);
    return wrap;
  }

  // ---------------------------------------------------------------- panes
  function lookPane() {
    const s = store.settings;
    return [
      preview,
      group("Erscheinungsbild",
        row("Modus", segmented([
          { value: "light", label: "Hell", icon: "sun" },
          { value: "dark", label: "Dunkel", icon: "moon" },
          { value: "system", label: "Auto", icon: "auto" },
        ], s.theme, (v) => set({ theme: v }), { label: "Modus" })),
        row("Akzentfarbe", accentPicker()),
        row("Board-Hintergründe", segmented([{ value: "soft", label: "Sanft" }, { value: "vivid", label: "Kräftig" }], s.bgStyle, (v) => set({ bgStyle: v }), { label: "Board-Hintergründe" }))),
      group("Schrift",
        row("Schriftart", segmented(Object.entries(FONTS).map(([value, f]) => ({ value, label: f.name, style: { fontFamily: f.stack } })), s.font, (v) => set({ font: v }), { label: "Schriftart" })),
        row("Größe", slider({ min: 13, max: 19, value: s.fontSize, onInput: (v) => set({ fontSize: v }) }))),
      group("Layout",
        row("Dichte", segmented([{ value: "compact", label: "Kompakt" }, { value: "normal", label: "Normal" }, { value: "airy", label: "Luftig" }], s.density, (v) => set({ density: v }), { label: "Dichte" })),
        row("Karten", segmented([{ value: "shadow", label: "Schatten" }, { value: "border", label: "Rahmen" }, { value: "flat", label: "Flach" }], s.cardStyle, (v) => set({ cardStyle: v }), { label: "Kartenstil" })),
        row("Ecken", slider({ min: 0, max: 18, value: s.radius, onInput: (v) => set({ radius: v }) })),
        row("Listenbreite", slider({ min: 240, max: 360, step: 10, value: s.listWidth, onInput: (v) => set({ listWidth: v }) }))),
      group("Auf Karten anzeigen",
        row("Labels", segmented([{ value: "bars", label: "Balken" }, { value: "names", label: "Mit Namen" }], s.labelStyle, (v) => set({ labelStyle: v }), { label: "Labels" })),
        row("Fälligkeitsdatum", toggle(s.showDue, (v) => set({ showDue: v }), "Fälligkeitsdatum")),
        row("Checklisten-Fortschritt", toggle(s.showChecklist, (v) => set({ showChecklist: v }), "Checklisten-Fortschritt")),
        row("Hinweis auf Beschreibung", toggle(s.showDesc, (v) => set({ showDesc: v }), "Hinweis auf Beschreibung"))),
      group("Bewegung",
        row("Animationen", toggle(s.motion, (v) => set({ motion: v }), "Animationen"), "Übergänge und Einblendungen")),
      h("button.btn.ghost.full.mt", { type: "button", onclick: () => { store.resetSettings(); draw(); toast("Darstellung zurückgesetzt"); } }, icon("undo", 16), "Darstellung zurücksetzen"),
    ];
  }

  function dataPane() {
    const snaps = store.snapshots();
    const boards = store.data.boards.length;
    const cards = M.countCards(store.data);
    const err = store.saveError;
    return [
      h("div.status-card", { class: err && "error" },
        h("div.status-icon", icon(err ? "alert" : "cloud", 22)),
        h("div.status-main",
          h("div.status-title", err ? "Speichern fehlgeschlagen" : "Automatisch gespeichert"),
          h("div.status-sub", err ?? `Offline auf diesem Gerät · zuletzt ${relTime(store.lastSaved)}`),
          h("div.status-sub", `${boards} ${boards === 1 ? "Board" : "Boards"} · ${cards} Karten · ${fmtBytes(store.usage())} belegt`)),
        h("button.btn.sm", { type: "button", onclick: () => { store.flush(); toast(store.saveError ? store.saveError : "Gespeichert"); } }, icon("save", 15), "Jetzt speichern")),
      group("Sicherung als Datei",
        h("p.hint", "Exportiere alle Boards inklusive Design als JSON-Datei – zum Aufbewahren oder um sie auf ein anderes Gerät zu übertragen."),
        h("div.btn-row",
          h("button.btn", { type: "button", onclick: doExport }, icon("download", 16), "Exportieren"),
          h("button.btn", { type: "button", onclick: doImport }, icon("upload", 16), "Importieren"))),
      group("Sicherungspunkte",
        h("p.hint", "Schnappschüsse im Speicher der App. Einmal täglich wird automatisch einer angelegt, außerdem vor jedem Import und jeder Wiederherstellung."),
        h("button.btn.primary", { type: "button", onclick: newSnapshot }, icon("save", 16), "Sicherungspunkt erstellen"),
        snaps.length ? h("ul.snap-list", snaps.map(snapRow)) : h("p.empty", "Noch keine Sicherungspunkte.")),
      group("Zurücksetzen",
        h("p.hint", "Löscht alle Boards. Vorher wird automatisch ein Sicherungspunkt angelegt."),
        h("button.btn.danger", { type: "button", onclick: resetAll }, icon("trash", 16), "Alle Boards löschen")),
    ];
  }

  function snapRow(snap) {
    return h("li.snap",
      h("span.snap-icon", icon(snap.auto ? "history" : "save", 16)),
      h("div.snap-main",
        h("div.snap-title", snap.label),
        h("div.snap-sub", `${fmtDateTime(snap.created)} · ${snap.boards} ${snap.boards === 1 ? "Board" : "Boards"} · ${snap.cards} Karten`)),
      h("button.btn.sm", { type: "button", onclick: () => restore(snap) }, "Wiederherstellen"),
      iconBtn("trash", "Sicherungspunkt löschen", () => { store.deleteSnapshot(snap.id); }, { class: "sm" }));
  }

  // ---------------------------------------------------------------- data actions
  async function doExport() {
    store.flush();
    const ok = await saveFile(`organizator-sicherung-${M.isoDay(new Date())}.json`, store.exportString());
    if (ok) toast("Sicherung exportiert");
  }

  async function doImport() {
    const file = await pickFile();
    if (!file) return;
    let text, parsed;
    try {
      text = await file.text();
      parsed = store.inspectImport(text);
    } catch (e) {
      return toast(e.message || "Datei konnte nicht gelesen werden", { kind: "error" });
    }
    const mode = await dialog({
      title: "Sicherung importieren",
      message: `„${file.name}“ enthält ${parsed.boards} ${parsed.boards === 1 ? "Board" : "Boards"} mit ${parsed.cards} Karten. Hinzufügen behält deine bisherigen Boards. Ersetzen tauscht alles aus – auch die Darstellung, falls enthalten.`,
      buttons: [{ label: "Abbrechen", value: null }, { label: "Ersetzen", value: "replace", kind: "danger" }, { label: "Hinzufügen", value: "merge", kind: "primary" }],
    });
    if (!mode) return;
    store.importString(text, mode);
    draw();
    toast(mode === "replace" ? "Daten ersetzt" : `${parsed.boards} ${parsed.boards === 1 ? "Board" : "Boards"} importiert`, { action: { label: "Rückgängig", onClick: () => store.undo() } });
  }

  async function newSnapshot() {
    const name = await promptDialog({ title: "Sicherungspunkt erstellen", placeholder: "Name (optional), z. B. Vor dem Umbau", confirm: "Erstellen" });
    if (name === null) return;
    const snap = store.createSnapshot(M.clean(name, 80) || "Sicherungspunkt");
    toast(snap ? "Sicherungspunkt erstellt" : "Nicht genug Speicherplatz", { kind: snap ? "" : "error" });
  }

  async function restore(snap) {
    const ok = await confirmDialog({
      title: "Wiederherstellen?",
      message: `Deine Boards werden auf den Stand vom ${fmtDateTime(snap.created)} zurückgesetzt. Der aktuelle Stand wird vorher als Sicherungspunkt gespeichert.`,
      confirm: "Wiederherstellen",
    });
    if (!ok) return;
    try {
      store.restoreSnapshot(snap.id);
      toast("Wiederhergestellt", { action: { label: "Rückgängig", onClick: () => store.undo() } });
    } catch (e) {
      toast(e.message, { kind: "error" });
    }
  }

  async function resetAll() {
    const ok = await confirmDialog({ title: "Alle Boards löschen?", message: "Alle Boards, Listen und Karten werden gelöscht. Ein Sicherungspunkt wird vorher angelegt.", confirm: "Alles löschen", danger: true });
    if (!ok) return;
    store.resetAll();
    app.navigate("#/");
    toast("Alle Boards gelöscht", { action: { label: "Rückgängig", onClick: () => store.undo() } });
  }

  // ---------------------------------------------------------------- frame
  function draw() {
    tabs.replaceChildren(segmented([{ value: "look", label: "Darstellung", icon: "sliders" }, { value: "data", label: "Daten", icon: "save" }], tab, (v) => { tab = v; draw(); }, { label: "Bereich" }));
    body.replaceChildren(...(tab === "look" ? lookPane() : dataPane()));
    if (tab === "look") drawPreview();
  }

  const unsub = store.subscribe((info) => {
    if (info.kind === "settings" && tab === "look") drawPreview();
    if (tab === "data" && (info.kind === "snapshots" || info.kind === "data" || (info.kind === "status" && !store.dirty))) draw();
  });

  openModal((api) => [
    h("div.sheet-sticky", h("div.sheet-head", h("h2", "Einstellungen"), iconBtn("x", "Schließen", api.close)), tabs),
    body,
  ], { className: "settings-modal", onClose: unsub });
  draw();
}
