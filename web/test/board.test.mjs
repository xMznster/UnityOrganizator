// Tests for the Organizator board app (web/board): data model, autosave, undo, backups, import/export.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../board/js/model.js";
import { Store, DEFAULT_SETTINGS, normalizeSettings } from "../board/js/store.js";

class MemoryStorage {
  constructor(limit = Infinity) { this.map = new Map(); this.limit = limit; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    const size = [...this.map].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0) + String(v).length;
    if (size > this.limit) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
    this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
}

const titles = (list) => list.cards.map((c) => c.title);

function sampleBoard() {
  const b = M.createBoard({ title: "Projekt", template: "kanban" });
  const [todo, doing] = b.lists;
  for (const t of ["A", "B", "C"]) M.addCard(b, todo.id, t);
  M.addCard(b, doing.id, "D");
  return b;
}

test("createBoard uses templates, default labels and valid backgrounds", () => {
  const b = M.createBoard({ title: "  Woche  ", template: "week", bg: "nope" });
  assert.equal(b.title, "Woche");
  assert.equal(b.bg, "none");
  assert.equal(b.lists.length, 6);
  assert.equal(b.labels.length, 6);
  assert.equal(M.createBoard({ template: "empty" }).lists.length, 0);
  assert.equal(M.createBoard().title, "Neues Board");
});

test("addCard trims titles and ignores empty ones", () => {
  const b = sampleBoard();
  const todo = b.lists[0];
  assert.equal(M.addCard(b, todo.id, "   "), null);
  assert.equal(M.addCard(b, todo.id, "  Hallo \n Welt ").title, "Hallo Welt");
  M.addCard(b, todo.id, "Oben", { top: true });
  assert.equal(todo.cards[0].title, "Oben");
});

test("moveCard reorders within a list and moves across lists", () => {
  const b = sampleBoard();
  const [todo, doing, done] = b.lists;
  const [a, , c] = todo.cards;
  assert.equal(M.moveCard(b, c.id, todo.id, a.id), true);
  assert.deepEqual(titles(todo), ["C", "A", "B"]);
  assert.equal(M.moveCard(b, a.id, doing.id, null), true);
  assert.deepEqual(titles(todo), ["C", "B"]);
  assert.deepEqual(titles(doing), ["D", "A"]);
  assert.equal(M.moveCard(b, a.id, done.id, "does-not-exist"), true, "unknown target → end of list");
  assert.deepEqual(titles(done), ["A"]);
});

test("moveCard reports no-ops", () => {
  const b = sampleBoard();
  const todo = b.lists[0];
  const [a, bb] = todo.cards;
  assert.equal(M.moveCard(b, a.id, todo.id, bb.id), false, "already in front of B");
  assert.equal(M.moveCard(b, todo.cards[2].id, todo.id, null), false, "already last");
  assert.equal(M.moveCard(b, a.id, todo.id, a.id), false);
  assert.equal(M.moveCard(b, "missing", todo.id, null), false);
});

test("moveList, shiftList, duplicateList and deleteList", () => {
  const b = sampleBoard();
  const [todo, doing, done] = b.lists;
  assert.equal(M.moveList(b, done.id, todo.id), true);
  assert.deepEqual(b.lists.map((l) => l.title), ["Erledigt", "To-do", "In Arbeit"]);
  assert.equal(M.moveList(b, todo.id, doing.id), false, "no-op");
  assert.equal(M.shiftList(b, done.id, -1), false, "already first");
  assert.equal(M.shiftList(b, done.id, 1), true);
  assert.deepEqual(b.lists.map((l) => l.title), ["To-do", "Erledigt", "In Arbeit"]);
  const copy = M.duplicateList(b, todo.id);
  assert.equal(copy.title, "To-do (Kopie)");
  assert.deepEqual(titles(copy), ["A", "B", "C"]);
  assert.notEqual(copy.cards[0].id, todo.cards[0].id);
  assert.equal(M.deleteList(b, copy.id).id, copy.id);
  assert.equal(b.lists.length, 3);
});

test("duplicateBoard gives fresh ids and remaps labels", () => {
  const data = { version: 1, boards: [sampleBoard()] };
  const src = data.boards[0];
  M.toggleLabel(src.lists[0].cards[0], src.labels[2].id);
  const copy = M.duplicateBoard(data, src.id);
  assert.equal(data.boards.length, 2);
  assert.equal(copy.title, "Projekt (Kopie)");
  assert.notEqual(copy.id, src.id);
  const card = copy.lists[0].cards[0];
  assert.equal(card.labels.length, 1);
  assert.equal(card.labels[0], copy.labels[2].id);
  assert.notEqual(card.labels[0], src.labels[2].id);
});

test("removeLabel strips the label from all cards", () => {
  const b = sampleBoard();
  const label = b.labels[0];
  for (const c of b.lists[0].cards) M.toggleLabel(c, label.id);
  assert.equal(M.removeLabel(b, label.id), true);
  assert.ok(b.lists[0].cards.every((c) => !c.labels.includes(label.id)));
});

test("dueInfo states and German labels", () => {
  const now = new Date(2026, 10, 25, 15, 0);
  const card = (due, done = false) => ({ due, done });
  assert.deepEqual(M.dueInfo(card("2026-11-25"), now), { days: 0, state: "soon", label: "Heute" });
  assert.equal(M.dueInfo(card("2026-11-26"), now).label, "Morgen");
  assert.equal(M.dueInfo(card("2026-11-24"), now).state, "overdue");
  assert.equal(M.dueInfo(card("2026-11-24", true), now).state, "done");
  assert.equal(M.dueInfo(card("2026-12-03"), now).label, "3. Dez.");
  assert.equal(M.dueInfo(card("2027-01-09"), now).label, "9. Jan. 2027");
  assert.equal(M.dueInfo(card(null), now), null);
});

test("cardMatches: text (accent-insensitive), labels, due, hide done", () => {
  const b = sampleBoard();
  const c = b.lists[0].cards[0];
  c.title = "Café planen";
  c.desc = "Tische bestellen";
  b.labels[0].name = "Wichtig";
  M.toggleLabel(c, b.labels[0].id);
  assert.equal(M.cardMatches(c, { q: "cafe" }, b), true);
  assert.equal(M.cardMatches(c, { q: "tische cafe" }, b), true);
  assert.equal(M.cardMatches(c, { q: "wichtig" }, b), true, "label names are searchable");
  assert.equal(M.cardMatches(c, { q: "kuchen" }, b), false);
  assert.equal(M.cardMatches(c, { labels: [b.labels[1].id] }, b), false);
  assert.equal(M.cardMatches(c, { labels: [b.labels[1].id, b.labels[0].id] }, b), true);
  assert.equal(M.cardMatches(c, { due: true }, b), false);
  c.due = M.isoDay(new Date());
  assert.equal(M.cardMatches(c, { due: true }, b), true);
  c.done = true;
  assert.equal(M.cardMatches(c, { hideDone: true }, b), false);
  assert.equal(M.filterActive({ q: " " }), false);
});

test("normalizeData repairs broken input and rejects foreign files", () => {
  assert.throws(() => M.normalizeData({ hello: 1 }), /Organizator/);
  assert.throws(() => M.normalizeData(null));
  const data = M.normalizeData({
    data: {
      boards: [
        { id: "b1", title: "", bg: "sky", labels: [{ id: "l1", color: "red" }, { id: "l1", color: "pink" }], lists: [
          { id: "x", title: "Liste", cards: [
            { id: "c1", title: "  Karte  ", labels: ["l1", "l1", "zzz"], due: "2026-13-45", checklist: [{ text: "" }, { text: "ok", done: 1 }], cover: "nope" },
            "garbage",
            { id: "c1", title: "Duplikat" },
          ] },
        ] },
        42,
      ],
    },
  });
  assert.equal(data.boards.length, 1);
  const b = data.boards[0];
  assert.equal(b.title, "Board");
  assert.equal(b.labels.length, 2);
  assert.notEqual(b.labels[0].id, b.labels[1].id, "duplicate ids are replaced");
  const [c1, c2] = b.lists[0].cards;
  assert.equal(c1.title, "Karte");
  assert.equal(c1.due, null);
  assert.equal(c1.cover, null);
  assert.deepEqual(c1.checklist.map((i) => [i.text, i.done]), [["ok", false]]);
  assert.equal(c1.labels.length, 1);
  assert.notEqual(c2.id, c1.id);
});

test("mergeData adds boards with fresh ids without touching existing ones", () => {
  const data = { version: 1, boards: [sampleBoard()] };
  const incoming = { version: 1, boards: [data.boards[0]] };
  assert.equal(M.mergeData(data, structuredClone(incoming)), 1);
  assert.equal(data.boards.length, 2);
  assert.notEqual(data.boards[0].id, data.boards[1].id);
});

test("welcomeData is valid and survives normalisation unchanged", () => {
  const w = M.welcomeData();
  assert.deepEqual(M.normalizeData(JSON.parse(JSON.stringify(w))), w);
  assert.ok(M.countCards(w) >= 5);
});

test("boardBackground modes", () => {
  assert.equal(M.boardBackground("none").mode, "none");
  assert.equal(M.boardBackground("sky", "soft", false).mode, "soft");
  assert.equal(M.boardBackground("sky", "vivid", true).mode, "vivid");
  assert.match(M.boardBackground("dusk", "vivid", false).css, /^linear-gradient/);
  assert.match(M.backgroundSwatch("sky"), /hsl/);
});

// ---------------------------------------------------------------- store

function makeStore(storage = new MemoryStorage(), t = { now: 1_000_000 }) {
  return new Store({ storage, now: () => t.now, saveDelay: 5 }).load();
}

test("first start seeds the welcome board and saves it", () => {
  const storage = new MemoryStorage();
  const s = makeStore(storage);
  assert.equal(s.firstRun, true);
  assert.equal(s.data.boards[0].title, "Erste Schritte");
  assert.ok(storage.getItem("organizator.data"));
  const again = makeStore(storage);
  assert.equal(again.firstRun, false);
  assert.deepEqual(again.data, s.data);
});

test("commit autosaves; flush persists immediately", () => {
  const storage = new MemoryStorage();
  const s = makeStore(storage);
  const id = s.data.boards[0].id;
  s.commitBoard(id, (b) => { b.title = "Neu"; });
  assert.equal(s.dirty, true);
  s.flush();
  assert.equal(s.dirty, false);
  assert.equal(JSON.parse(storage.getItem("organizator.data")).boards[0].title, "Neu");
});

test("undo/redo and typing coalescing", () => {
  const s = makeStore();
  const id = s.data.boards[0].id;
  s.commitBoard(id, (b) => { b.title = "A"; }, { undoKey: "title" });
  s.commitBoard(id, (b) => { b.title = "AB"; }, { undoKey: "title" });
  s.commitBoard(id, (b) => { b.title = "ABC"; }, { undoKey: "title" });
  assert.equal(s.undoStack.length, 1, "one undo step for one typing burst");
  s.undo();
  assert.equal(s.data.boards[0].title, "Erste Schritte");
  s.redo();
  assert.equal(s.data.boards[0].title, "ABC");
  assert.equal(s.commit(() => false), false);
  s.commit(() => {}); // no change → no undo step
  assert.equal(s.undoStack.length, 1);
  s.flush();
});

test("deleting is undoable", () => {
  const s = makeStore();
  const b = s.data.boards[0];
  const card = b.lists[0].cards[0];
  s.commitBoard(b.id, (bb) => M.deleteCard(bb, card.id) ? true : false);
  assert.equal(M.locateCard(s.data.boards[0], card.id), null);
  s.undo();
  assert.ok(M.locateCard(s.data.boards[0], card.id));
  s.flush();
});

test("settings are validated and persisted", () => {
  const storage = new MemoryStorage();
  const s = makeStore(storage);
  s.setSettings({ theme: "dark", fontSize: 99, accent: "#abcdef", density: "weird", radius: -3 });
  assert.equal(s.settings.theme, "dark");
  assert.equal(s.settings.fontSize, 19);
  assert.equal(s.settings.radius, 0);
  assert.equal(s.settings.accent, "#ABCDEF");
  assert.equal(s.settings.density, DEFAULT_SETTINGS.density);
  assert.equal(makeStore(storage).settings.theme, "dark");
  assert.deepEqual(normalizeSettings("junk"), { ...DEFAULT_SETTINGS });
  s.flush();
});

test("export → import (merge and replace)", () => {
  const a = makeStore();
  a.setSettings({ accent: "#112233" });
  const text = a.exportString();
  const parsed = JSON.parse(text);
  assert.equal(parsed.app, "organizator");
  assert.equal(parsed.settings.accent, "#112233");

  const b = makeStore();
  const before = b.data.boards.length;
  b.importString(text, "merge");
  assert.equal(b.data.boards.length, before + a.data.boards.length);
  assert.notEqual(b.data.boards[0].id, b.data.boards[1].id);

  const c = makeStore();
  c.commit((d) => { d.boards.push(M.createBoard({ title: "Extra" })); });
  c.importString(text, "replace");
  assert.equal(c.data.boards.length, a.data.boards.length);
  assert.equal(c.settings.accent, "#112233");
  assert.ok(c.snapshots().some((s) => s.label === "Vor Import"), "safety snapshot before import");
  c.undo();
  assert.equal(c.data.boards.at(-1).title, "Extra");

  const one = JSON.parse(a.exportString(a.data.boards[0].id));
  assert.equal(one.data.boards.length, 1);
  assert.equal(one.settings, undefined);
  assert.throws(() => c.importString("not json"), /JSON/);
  assert.throws(() => c.importString('{"x":1}'), /Organizator/);
  for (const s of [a, b, c]) s.flush();
});

test("snapshots: daily auto snapshot, restore, delete, limits", () => {
  const t = { now: 1_000_000 };
  const s = makeStore(new MemoryStorage(), t);
  assert.ok(s.maybeAutoSnapshot());
  assert.equal(s.maybeAutoSnapshot(), null, "only once per day");
  t.now += 21 * 3600 * 1000;
  assert.ok(s.maybeAutoSnapshot());

  const manual = s.createSnapshot("Vor dem Umbau");
  const id = s.data.boards[0].id;
  s.commitBoard(id, (b) => { b.title = "Geändert"; });
  s.restoreSnapshot(manual.id);
  assert.equal(s.data.boards[0].title, "Erste Schritte");
  assert.ok(s.snapshots().some((x) => x.label === "Vor Wiederherstellung"));
  s.undo();
  assert.equal(s.data.boards[0].title, "Geändert");

  s.deleteSnapshot(manual.id);
  assert.ok(!s.snapshots().some((x) => x.id === manual.id));
  for (let i = 0; i < 25; i++) { t.now += 1000; s.createSnapshot(`M${i}`); }
  assert.ok(s.snapshots().filter((x) => !x.auto).length <= 15);
  s.flush();
});

test("quota exceeded: old snapshots are dropped so the board data still saves", () => {
  const storage = new MemoryStorage(60_000);
  const t = { now: 1_000_000 };
  const s = makeStore(storage, t);
  for (let i = 0; i < 12; i++) { t.now += 1000; s.createSnapshot(`S${i}`); }
  const big = "x".repeat(4000);
  s.commitBoard(s.data.boards[0].id, (b) => { b.lists[0].cards[0].desc = big; });
  assert.equal(s.flush(), true);
  assert.equal(JSON.parse(storage.getItem("organizator.data")).boards[0].lists[0].cards[0].desc, big);
});

test("corrupt storage is kept aside and the app still starts", () => {
  const storage = new MemoryStorage();
  storage.setItem("organizator.data", "{broken");
  const s = makeStore(storage);
  assert.ok(s.loadError);
  assert.equal(storage.getItem("organizator.corrupt"), "{broken");
  assert.ok(s.data.boards.length >= 1);
});
