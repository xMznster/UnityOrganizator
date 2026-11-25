// Organizator – data model. Pure functions without DOM access (shared by the app and the tests).
//
// data  = { version, boards: [Board] }
// Board = { id, title, bg, starred, created, updated, labels: [Label], lists: [List] }
// List  = { id, title, cards: [Card] }
// Card  = { id, title, desc, labels: [labelId], due: "YYYY-MM-DD" | null, done, checklist: [Item], cover: colorId | null, created, updated }

export const DATA_VERSION = 1;

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`).replace(/-/g, "").slice(0, 14);

export const COLORS = {
  green: { name: "Grün", hex: "#30A46C" },
  yellow: { name: "Gelb", hex: "#E2A50D" },
  orange: { name: "Orange", hex: "#F0782F" },
  red: { name: "Rot", hex: "#E5484D" },
  purple: { name: "Lila", hex: "#8E4EC6" },
  blue: { name: "Blau", hex: "#3E7BE6" },
  teal: { name: "Türkis", hex: "#12A594" },
  pink: { name: "Pink", hex: "#D6409F" },
  gray: { name: "Grau", hex: "#8B8D98" },
};
export const COLOR_IDS = Object.keys(COLORS);

// Board backgrounds are defined by hue only, so every one of them works in light/dark and soft/vivid.
export const BACKGROUNDS = {
  none: { name: "Neutral", hues: null },
  sky: { name: "Himmel", hues: [212, 224] },
  lagoon: { name: "Lagune", hues: [186, 200] },
  sage: { name: "Salbei", hues: [148, 166] },
  sand: { name: "Sand", hues: [40, 30] },
  peach: { name: "Pfirsich", hues: [20, 8] },
  rose: { name: "Rosé", hues: [346, 330] },
  lavender: { name: "Lavendel", hues: [262, 248] },
  slate: { name: "Schiefer", hues: [215, 228], sat: 0.32 },
  dawn: { name: "Morgenrot", hues: [30, 335] },
  ocean: { name: "Ozean", hues: [190, 245] },
  forest: { name: "Wald", hues: [135, 188] },
  dusk: { name: "Abend", hues: [255, 320] },
};

/** CSS for a board background. mode: "none" | "soft" | "vivid" (vivid = light text on top). */
export function boardBackground(key, style = "soft", dark = false) {
  const bg = BACKGROUNDS[key];
  if (!bg?.hues) return { mode: "none", css: "", top: null };
  const [a, b] = bg.hues;
  const s = (v) => Math.round(v * (bg.sat ?? 1));
  let c1, c2, angle;
  if (style === "vivid") {
    angle = 135;
    [c1, c2] = dark ? [`hsl(${a} ${s(40)}% 27%)`, `hsl(${b} ${s(40)}% 19%)`] : [`hsl(${a} ${s(62)}% 55%)`, `hsl(${b} ${s(60)}% 45%)`];
  } else {
    angle = 160;
    [c1, c2] = dark ? [`hsl(${a} ${s(26)}% 14%)`, `hsl(${b} ${s(26)}% 10%)`] : [`hsl(${a} ${s(62)}% 94%)`, `hsl(${b} ${s(56)}% 89%)`];
  }
  return { mode: style === "vivid" ? "vivid" : "soft", css: `linear-gradient(${angle}deg, ${c1}, ${c2})`, top: c1 };
}

/** Saturated preview used for swatches, independent of the current style. */
export function backgroundSwatch(key) {
  const bg = BACKGROUNDS[key];
  if (!bg?.hues) return "";
  const [a, b] = bg.hues;
  const s = (v) => Math.round(v * (bg.sat ?? 1));
  return `linear-gradient(135deg, hsl(${a} ${s(64)}% 62%), hsl(${b} ${s(60)}% 50%))`;
}

export const TEMPLATES = {
  kanban: { name: "Kanban", lists: ["To-do", "In Arbeit", "Erledigt"] },
  project: { name: "Projekt", lists: ["Ideen", "Geplant", "In Arbeit", "Review", "Fertig"] },
  week: { name: "Woche", lists: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Wochenende"] },
  empty: { name: "Leer", lists: [] },
};

const DEFAULT_LABELS = ["green", "yellow", "orange", "red", "purple", "blue"];

// ---------------------------------------------------------------- helpers

export const clean = (s, max = 500) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const str = (s, max) => (typeof s === "string" ? s.slice(0, max) : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const validDate = (v) => (typeof v === "string" && DATE_RE.test(v) && isoDay(parseDay(v)) === v ? v : null); // rejects 2026-13-45

export function parseDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function isoDay(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
export function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

const MONTHS = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];
export function formatDay(iso, now = new Date()) {
  const d = parseDay(iso);
  const base = `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Due state of a card: { days, state: "done" | "overdue" | "soon" | "later", label } or null. */
export function dueInfo(card, now = new Date()) {
  if (!card.due) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((parseDay(card.due) - today) / 86400000);
  const state = card.done ? "done" : days < 0 ? "overdue" : days <= 1 ? "soon" : "later";
  const label = days === 0 ? "Heute" : days === 1 ? "Morgen" : days === -1 ? "Gestern" : formatDay(card.due, now);
  return { days, state, label };
}

// ---------------------------------------------------------------- factories

export function createCard(title, now = Date.now()) {
  return { id: uid(), title: clean(title), desc: "", labels: [], due: null, done: false, checklist: [], cover: null, created: now, updated: now };
}

export function createList(title) {
  return { id: uid(), title: clean(title, 120) || "Liste", cards: [] };
}

export function createBoard({ title = "", bg = "sky", template = "kanban", now = Date.now() } = {}) {
  return {
    id: uid(),
    title: clean(title, 120) || "Neues Board",
    bg: BACKGROUNDS[bg] ? bg : "none",
    starred: false,
    created: now,
    updated: now,
    labels: DEFAULT_LABELS.map((color) => ({ id: uid(), color, name: "" })),
    lists: (TEMPLATES[template]?.lists ?? []).map(createList),
  };
}

export const emptyData = () => ({ version: DATA_VERSION, boards: [] });

/** First-run content: a short, hands-on tour. */
export function welcomeData(now = Date.now()) {
  const board = createBoard({ title: "Erste Schritte", bg: "sky", template: "empty", now });
  const [green, yellow, , , purple, blue] = board.labels;
  green.name = "Tipp";
  blue.name = "Bedienung";
  purple.name = "Design";
  yellow.name = "Wichtig";
  const today = new Date(now);
  const list = (title, cards) => {
    const l = createList(title);
    l.cards = cards.map((c) => Object.assign(createCard(c.title, now), c, { title: clean(c.title) }));
    return l;
  };
  board.lists = [
    list("Los geht's", [
      { title: "Tippe auf eine Karte, um sie zu öffnen", labels: [blue.id], desc: "In einer Karte kannst du eine Beschreibung schreiben, Labels setzen, ein Fälligkeitsdatum wählen, Checklisten anlegen und eine Farbe vergeben." },
      { title: "Karten verschieben: ziehen – auf dem Handy kurz gedrückt halten", labels: [blue.id] },
      { title: "Neue Karte: „Karte hinzufügen“ unten in jeder Liste", labels: [green.id] },
    ]),
    list("Anpassen", [
      {
        title: "Design einstellen: oben rechts auf das Regler-Symbol",
        labels: [purple.id],
        cover: "purple",
        checklist: [
          { id: uid(), text: "Hell, Dunkel oder automatisch wählen", done: false },
          { id: uid(), text: "Akzentfarbe aussuchen", done: false },
          { id: uid(), text: "Schrift, Größe und Dichte testen", done: false },
        ],
      },
      { title: "Hintergrund des Boards: Menü „⋯“ oben rechts", labels: [purple.id] },
      { title: "Diese Karte ist morgen fällig", labels: [yellow.id], due: isoDay(addDays(today, 1)) },
    ]),
    list("Erledigt", [
      { title: "Alles wird automatisch gespeichert", done: true, labels: [green.id], desc: "Deine Boards liegen offline auf diesem Gerät. Unter Einstellungen → Daten kannst du Sicherungen exportieren, importieren und Sicherungspunkte wiederherstellen." },
    ]),
  ];
  return { version: DATA_VERSION, boards: [board] };
}

// ---------------------------------------------------------------- lookups

export const findBoard = (data, id) => data.boards.find((b) => b.id === id) ?? null;
export const findList = (board, id) => board.lists.find((l) => l.id === id) ?? null;

export function locateCard(board, cardId) {
  for (const list of board.lists) {
    const index = list.cards.findIndex((c) => c.id === cardId);
    if (index >= 0) return { list, index, card: list.cards[index] };
  }
  return null;
}

export function boardStats(board, now = new Date()) {
  let cards = 0, done = 0, overdue = 0;
  for (const l of board.lists) for (const c of l.cards) {
    cards++;
    if (c.done) done++;
    else if (c.due && dueInfo(c, now).state === "overdue") overdue++;
  }
  return { cards, done, overdue, lists: board.lists.length };
}

export const countCards = (data) => data.boards.reduce((n, b) => n + b.lists.reduce((m, l) => m + l.cards.length, 0), 0);

// ---------------------------------------------------------------- board operations (mutate in place)

export function addList(board, title) {
  const t = clean(title, 120);
  if (!t) return null;
  const list = createList(t);
  board.lists.push(list);
  return list;
}

export function moveList(board, listId, beforeId = null) {
  const from = board.lists.findIndex((l) => l.id === listId);
  if (from < 0 || beforeId === listId) return false;
  if ((board.lists[from + 1]?.id ?? null) === beforeId) return false;
  const [list] = board.lists.splice(from, 1);
  let to = beforeId ? board.lists.findIndex((l) => l.id === beforeId) : -1;
  if (to < 0) to = board.lists.length;
  board.lists.splice(to, 0, list);
  return true;
}

export function shiftList(board, listId, delta) {
  const i = board.lists.findIndex((l) => l.id === listId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= board.lists.length) return false;
  const [list] = board.lists.splice(i, 1);
  board.lists.splice(j, 0, list);
  return true;
}

export function deleteList(board, listId) {
  const i = board.lists.findIndex((l) => l.id === listId);
  return i < 0 ? null : board.lists.splice(i, 1)[0];
}

export function duplicateList(board, listId) {
  const i = board.lists.findIndex((l) => l.id === listId);
  if (i < 0) return null;
  const src = board.lists[i];
  const copy = { id: uid(), title: clean(`${src.title} (Kopie)`, 120), cards: src.cards.map(cloneCard) };
  board.lists.splice(i + 1, 0, copy);
  return copy;
}

export function addCard(board, listId, title, { top = false, now = Date.now() } = {}) {
  const list = findList(board, listId);
  const t = clean(title);
  if (!list || !t) return null;
  const card = createCard(t, now);
  if (top) list.cards.unshift(card); else list.cards.push(card);
  return card;
}

/** Moves a card in front of `beforeId` in `toListId` (null = end). Returns false if nothing changed. */
export function moveCard(board, cardId, toListId, beforeId = null) {
  const from = locateCard(board, cardId);
  const to = findList(board, toListId);
  if (!from || !to || beforeId === cardId) return false;
  if (from.list === to && (from.list.cards[from.index + 1]?.id ?? null) === beforeId) return false;
  from.list.cards.splice(from.index, 1);
  let i = beforeId ? to.cards.findIndex((c) => c.id === beforeId) : -1;
  if (i < 0) i = to.cards.length;
  to.cards.splice(i, 0, from.card);
  return true;
}

export function deleteCard(board, cardId) {
  const loc = locateCard(board, cardId);
  return loc ? loc.list.cards.splice(loc.index, 1)[0] : null;
}

function cloneCard(card, labelMap = null) {
  return {
    ...card,
    id: uid(),
    labels: labelMap ? card.labels.map((id) => labelMap.get(id)).filter(Boolean) : [...card.labels],
    checklist: card.checklist.map((i) => ({ ...i, id: uid() })),
  };
}

export function duplicateCard(board, cardId, now = Date.now()) {
  const loc = locateCard(board, cardId);
  if (!loc) return null;
  const copy = { ...cloneCard(loc.card), title: clean(`${loc.card.title} (Kopie)`), created: now, updated: now };
  loc.list.cards.splice(loc.index + 1, 0, copy);
  return copy;
}

/** Deep copy with fresh ids everywhere (label references are remapped). */
export function cloneBoard(board, now = Date.now()) {
  const labelMap = new Map();
  const labels = board.labels.map((l) => {
    const id = uid();
    labelMap.set(l.id, id);
    return { ...l, id };
  });
  return {
    ...board,
    id: uid(),
    created: now,
    updated: now,
    labels,
    lists: board.lists.map((l) => ({ id: uid(), title: l.title, cards: l.cards.map((c) => cloneCard(c, labelMap)) })),
  };
}

export function duplicateBoard(data, boardId, now = Date.now()) {
  const i = data.boards.findIndex((b) => b.id === boardId);
  if (i < 0) return null;
  const copy = cloneBoard(data.boards[i], now);
  copy.title = clean(`${copy.title} (Kopie)`, 120);
  copy.starred = false;
  data.boards.splice(i + 1, 0, copy);
  return copy;
}

export function deleteBoard(data, boardId) {
  const i = data.boards.findIndex((b) => b.id === boardId);
  return i < 0 ? null : data.boards.splice(i, 1)[0];
}

// ---------------------------------------------------------------- labels & checklist

export function addLabel(board, color = "gray", name = "") {
  const label = { id: uid(), color: COLORS[color] ? color : "gray", name: clean(name, 40) };
  board.labels.push(label);
  return label;
}

export function removeLabel(board, labelId) {
  const i = board.labels.findIndex((l) => l.id === labelId);
  if (i < 0) return false;
  board.labels.splice(i, 1);
  for (const l of board.lists) for (const c of l.cards) c.labels = c.labels.filter((id) => id !== labelId);
  return true;
}

export function toggleLabel(card, labelId) {
  const i = card.labels.indexOf(labelId);
  if (i >= 0) card.labels.splice(i, 1); else card.labels.push(labelId);
}

export function addCheckItem(card, text) {
  const t = clean(text, 300);
  if (!t) return null;
  const item = { id: uid(), text: t, done: false };
  card.checklist.push(item);
  return item;
}

export const checklistProgress = (card) => ({ done: card.checklist.filter((i) => i.done).length, total: card.checklist.length });

// ---------------------------------------------------------------- filter

const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function filterActive(f) {
  return !!(f && (f.q?.trim() || f.labels?.length || f.hideDone || f.due));
}

/** f = { q, labels: [labelId], hideDone, due } – labels match if the card has any of them. */
export function cardMatches(card, f, board, now = new Date()) {
  if (!filterActive(f)) return true;
  if (f.hideDone && card.done) return false;
  if (f.labels?.length && !f.labels.some((id) => card.labels.includes(id))) return false;
  if (f.due) {
    const d = dueInfo(card, now);
    if (!d || d.state === "done" || d.days > 7) return false;
  }
  const q = fold(f.q?.trim() ?? "");
  if (q) {
    const names = card.labels.map((id) => board?.labels.find((l) => l.id === id)?.name ?? "");
    const hay = fold([card.title, card.desc, ...card.checklist.map((i) => i.text), ...names].join(" "));
    if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
  }
  return true;
}

// ---------------------------------------------------------------- validation, import, merge

/** Validates and repairs data from storage or an import file. Throws if it is not Organizator data. */
export function normalizeData(raw) {
  const src = isObj(raw) && isObj(raw.data) && Array.isArray(raw.data.boards) ? raw.data : raw;
  if (!isObj(src) || !Array.isArray(src.boards)) throw new Error("Keine gültigen Organizator-Daten gefunden.");
  const seen = new Set();
  const fresh = (id) => {
    const v = typeof id === "string" && /^[\w-]{1,64}$/.test(id) && !seen.has(id) ? id : uid();
    seen.add(v);
    return v;
  };
  const now = Date.now();
  const boards = src.boards.filter(isObj).map((b) => {
    const labelMap = new Map();
    const labels = arr(b.labels).filter(isObj).map((l) => {
      const id = fresh(l.id);
      labelMap.set(l.id, id);
      return { id, color: COLORS[l.color] ? l.color : "gray", name: clean(l.name, 40) };
    });
    return {
      id: fresh(b.id),
      title: clean(b.title, 120) || "Board",
      bg: BACKGROUNDS[b.bg] ? b.bg : "none",
      starred: b.starred === true,
      created: num(b.created, now),
      updated: num(b.updated, now),
      labels,
      lists: arr(b.lists).filter(isObj).map((l) => ({
        id: fresh(l.id),
        title: clean(l.title, 120) || "Liste",
        cards: arr(l.cards).filter(isObj).map((c) => ({
          id: fresh(c.id),
          title: clean(c.title) || "Karte",
          desc: str(c.desc, 20000),
          labels: [...new Set(arr(c.labels).map((id) => labelMap.get(id)).filter(Boolean))],
          due: validDate(c.due),
          done: c.done === true,
          checklist: arr(c.checklist).filter(isObj)
            .map((i) => ({ id: fresh(i.id), text: clean(i.text, 300), done: i.done === true }))
            .filter((i) => i.text),
          cover: COLORS[c.cover] ? c.cover : null,
          created: num(c.created, now),
          updated: num(c.updated, now),
        })),
      })),
    };
  });
  return { version: DATA_VERSION, boards };
}

/** Appends all boards of `incoming` with fresh ids, so nothing existing is ever overwritten. */
export function mergeData(data, incoming, now = Date.now()) {
  const added = incoming.boards.map((b) => ({ ...cloneBoard(b, now), starred: b.starred }));
  data.boards.push(...added);
  return added.length;
}
