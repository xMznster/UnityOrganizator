// Tiny UI toolkit: h() DOM builder, icons, sheets, toasts, dialogs, formatting.

export function h(tag, props = {}, ...children) {
  if (props === null || typeof props !== "object" || props instanceof Node || Array.isArray(props)) { children.unshift(props); props = {}; }
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className += (el.className ? " " : "") + v;
    else if (k === "style" && typeof v === "object") { for (const [sk, sv] of Object.entries(v)) sk.startsWith("--") ? el.style.setProperty(sk, sv) : (el.style[sk] = sv); }
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "value") el.value = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  note: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  code: '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  share: '<path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  download: '<path d="M12 3v13M7 11l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V8M7 13l5-5 5 5M5 3h14"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  tag: '<path d="M20 12 12 20l-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  move: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m11 13h6m-2-2 2 2-2 2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.7-4.3L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.3L20 16m0 4v-4h-4"/>',
  wand: '<path d="m4 20 12-12M14 6l4 4M17 3v2M21 7h-2M19 3l-1 1"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
  github: '<path d="M9 19c-4 1.3-4-2-6-2.5m12 4.5v-3.5a3 3 0 0 0-.9-2.4c3-.3 6.1-1.5 6.1-6.7a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.1-.3-3.7 1.4a12.6 12.6 0 0 0-6.6 0C5.8 2.1 4.7 2.4 4.7 2.4a4.8 4.8 0 0 0-.1 3.6 5.2 5.2 0 0 0-1.4 3.6c0 5.2 3.1 6.4 6.1 6.7a3 3 0 0 0-.9 2.4V21"/>',
  seal: '<path d="M12 2l2.4 2.1 3.2-.3.7 3.1 2.8 1.6-1.3 2.9 1.3 2.9-2.8 1.6-.7 3.1-3.2-.3L12 22l-2.4-2.1-3.2.3-.7-3.1-2.8-1.6 1.3-2.9-1.3-2.9 2.8-1.6.7-3.1 3.2.3z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  paw: '<circle cx="6" cy="10" r="2"/><circle cx="10" cy="5.5" r="2"/><circle cx="14" cy="5.5" r="2"/><circle cx="18" cy="10" r="2"/><path d="M8 17c0-3 2-5 4-5s4 2 4 5a2.5 2.5 0 0 1-4 2 2.5 2.5 0 0 1-4-2z"/>',
  cube: '<path d="M12 3 3 7.5v9L12 21l9-4.5v-9z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  brush: '<path d="M14 4l6 6-8 8-3-3z"/><path d="M9 15c-3 0-5 2-5 5 3 0 5-2 5-5z"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  game: '<rect x="2" y="7" width="20" height="10" rx="4"/><path d="M7 10v4M5 12h4M15 11h.01M18 13h.01"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1 1 2 2 3 4 0-3 0-5 0-7z"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-5a2 2 0 0 0-2 2"/><path d="M20 4v14h-5a2 2 0 0 0-2 2"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  hammer: '<path d="m14 7 3-3 3 3-3 3M17 10 6 21l-3-3L14 7"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 7V4M5 11h2M17 11h2M5 17h2M17 17h2M9 4l1 3M15 4l-1 3"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.5 12.5 9-9M16 7l3 3"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  keyboardDown: '<rect x="2" y="4" width="20" height="11" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M7 11h10M9 19l3 2 3-2"/>',
  outline: '<path d="M4 6h16M8 12h12M12 18h8"/>',
};
export const ICON_CHOICES = ["folder", "moon", "paw", "cube", "game", "brush", "phone", "brain", "flame", "bolt", "eye", "map", "hammer", "book", "sparkles", "bug", "code", "note", "star", "key"];

export function icon(name, size = 20, cls = "") {
  const s = h("span.icon" + (cls ? "." + cls : ""));
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.folder}</svg>`;
  return s;
}

export const badge = (name, color, size = 38) =>
  h("span.badge", { style: { width: size + "px", height: size + "px", color, background: `color-mix(in srgb, ${color} 15%, transparent)` } }, icon(name, Math.round(size * 0.5)));

// ---------- formatting
const rtf = new Intl.RelativeTimeFormat("de", { numeric: "auto", style: "short" });
export function relTime(ts) {
  if (!ts) return "";
  const s = (ts - Date.now()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
  return "gerade eben";
}
export const dateTime = (ts) => new Date(ts).toLocaleString("de-DE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// ---------- overlays
const layer = () => document.getElementById("overlay");

/** Bottom sheet. content: Node or (close) => Node. Returns close(). */
export function sheet(title, content, { actions = null, full = false, onClose } = {}) {
  const backdrop = h("div.sheet-backdrop");
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    panel.classList.remove("open"); backdrop.classList.remove("open");
    setTimeout(() => { backdrop.remove(); panel.remove(); onClose?.(); }, 260);
  };
  const body = h("div.sheet-body");
  const panel = h("div.sheet" + (full ? ".full" : ""), { role: "dialog", "aria-label": title },
    h("div.sheet-grabber"),
    h("div.sheet-head", h("button.link", { onclick: close }, "Schließen"), h("div.sheet-title", title), h("div.sheet-actions", actions || "")),
    body);
  body.append(typeof content === "function" ? content(close) : content);
  backdrop.addEventListener("click", close);
  layer().append(backdrop, panel);
  requestAnimationFrame(() => { backdrop.classList.add("open"); panel.classList.add("open"); });
  return close;
}

/** Action menu (iOS-style). items: [{label, icon, danger, onClick} | "-"] */
export function menu(title, items) {
  sheet(title, (close) => h("div.menu", items.filter(Boolean).map((it) => it === "-" ? h("div.menu-sep") :
    h("button.menu-item" + (it.danger ? ".danger" : ""), { disabled: it.disabled, onclick: () => { close(); setTimeout(() => it.onClick(), 120); } }, it.icon ? icon(it.icon, 20) : "", h("span", it.label)))));
}

export function confirmDialog(title, message, confirmLabel = "OK", danger = false) {
  return new Promise((resolve) => {
    const close = sheet(title, (c) => h("div.dialog", h("p.muted", message),
      h("div.row-buttons",
        h("button.btn.secondary", { onclick: () => { c(); resolve(false); } }, "Abbrechen"),
        h("button.btn" + (danger ? ".danger" : ""), { onclick: () => { c(); resolve(true); } }, confirmLabel))), { onClose: () => resolve(false) });
    void close;
  });
}

export function prompt(title, { value = "", placeholder = "", label = "OK", mono = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = h("input.field" + (mono ? ".mono" : ""), { value, placeholder, autocapitalize: mono ? "off" : "sentences", autocorrect: mono ? "off" : "on", spellcheck: !mono });
    const finish = (v, c) => { if (done) return; done = true; c(); resolve(v); };
    sheet(title, (c) => {
      const form = h("form.dialog", { onsubmit: (e) => { e.preventDefault(); finish(input.value.trim(), c); } }, input, h("div.row-buttons",
        h("button.btn.secondary", { type: "button", onclick: () => finish(null, c) }, "Abbrechen"), h("button.btn", { type: "submit" }, label)));
      setTimeout(() => input.focus(), 300);
      return form;
    }, { onClose: () => { if (!done) { done = true; resolve(null); } } });
  });
}

export function toast(text, undo) {
  const t = h("div.toast", h("span", text), undo ? h("button.link", { onclick: () => { undo(); t.remove(); } }, "Rückgängig") : "");
  document.getElementById("toasts").append(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, undo ? 4500 : 2200);
}

export function sectionHeader(title, count, action) {
  return h("div.section-header", h("span.slashes", "//"), h("span.section-title", title.toUpperCase()), count !== undefined && count !== null ? h("span.section-count", String(count)) : "",
    h("span.section-line"), action ? h("button.link", { onclick: action.onClick }, action.label) : "");
}

export function chip(text, { color = "var(--text2)", selected = false, onClick, iconName } = {}) {
  return h("button.chip" + (selected ? ".selected" : ""), { style: { "--c": color }, onclick: onClick, type: "button" }, iconName ? icon(iconName, 13) : "", text);
}

export function empty(iconName, title, message, action) {
  return h("div.empty", h("div.empty-icon", icon(iconName, 30)), h("h3", title), h("p.muted", message), action ? h("button.btn", { onclick: action.onClick }, action.label) : "");
}

export function download(name, data, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** iOS share sheet with real files (falls back to download). */
export async function shareFiles(files, title) {
  try {
    if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, title }); return true; }
  } catch (e) { if (e.name === "AbortError") return false; }
  for (const f of files) download(f.name, f);
  return true;
}

export async function copyText(text, msg = "Kopiert") {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch {
    const ta = h("textarea", { value: text, style: { position: "fixed", opacity: "0" } });
    document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast(msg);
  }
}

export function debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; d.cancel = () => clearTimeout(t); return d; }
