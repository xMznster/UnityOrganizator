// Organizator – tiny UI kit: element builder, icons, modals, menus, toasts, dialogs, form controls.

export function h(tag, props, ...kids) {
  if (props == null || typeof props !== "object" || props instanceof Node || Array.isArray(props)) {
    kids.unshift(props);
    props = {};
  }
  const [name, ...cls] = tag.split(".");
  const el = document.createElement(name || "div");
  if (cls.length) el.className = cls.join(" ");
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") {
      for (const c of [].concat(v)) if (c) el.classList.add(...String(c).split(" ").filter(Boolean));
    } else if (k === "style") {
      if (typeof v === "string") el.style.cssText += v;
      else for (const [p, val] of Object.entries(v)) {
        if (val != null) el.style.setProperty(p.startsWith("--") ? p : p.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()), val);
      }
    } else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "ref") v(el);
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && !k.includes("-") && k !== "list" && k !== "form") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  appendKids(el, kids);
  return el;
}

function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue;
    el.append(k instanceof Node ? k : String(k));
  }
}

// ------------------------------------------------------------------ icons (24×24, stroke)

const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  back: '<path d="M14.5 18l-6-6 6-6"/>',
  chevronDown: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  sliders: '<path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9"/><circle cx="15" cy="7.5" r="2.2"/><circle cx="9" cy="16.5" r="2.2"/>',
  star: '<path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/>',
  starFill: '<path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  filter: '<path d="M4 6.5h16M7 12h10M10 17.5h4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  checklist: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/>',
  text: '<path d="M4 6.5h16M4 12h16M4 17.5h10"/>',
  tag: '<path d="M3.8 12.4V5.3c0-.8.7-1.5 1.5-1.5h7.1l7.9 7.9c.6.6.6 1.5 0 2.1l-7 7c-.6.6-1.5.6-2.1 0z"/><circle cx="8.3" cy="8.3" r="1.3"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 11.6a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7M9.5 7V4.5h5V7"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
  upload: '<path d="M12 19V8M7.5 12.5L12 8l4.5 4.5M5 4h14"/>',
  droplet: '<path d="M12 3.5s6 6.3 6 10.6a6 6 0 0 1-12 0c0-4.3 6-10.6 6-10.6z"/>',
  undo: '<path d="M9 14.5L4 9.5l5-5"/><path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4.5H8"/><path d="M12 8v4.3l2.8 1.7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z"/>',
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
  left: '<path d="M19 12H5.5M11 6l-6 6 6 6"/>',
  right: '<path d="M5 12h13.5M13 6l6 6-6 6"/>',
  edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 8.5l3 3"/>',
  save: '<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 18.5z"/>',
  board: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M9.2 8v5M14.8 8v8"/>',
  list: '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.5" cy="6.5" r=".9" fill="currentColor"/><circle cx="4.5" cy="12" r=".9" fill="currentColor"/><circle cx="4.5" cy="17.5" r=".9" fill="currentColor"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.3v.2"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M3.5 10h17"/>',
};

export function icon(name, size = 18, cls = "") {
  const span = document.createElement("span");
  span.className = "icon" + (cls ? " " + cls : "");
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] ?? ""}</svg>`;
  return span;
}

export const iconBtn = (name, label, onClick, extra = {}) =>
  h("button.icon-btn", { type: "button", "aria-label": label, title: label, onclick: onClick, ...extra }, icon(name, extra.size ?? 18));

// ------------------------------------------------------------------ environment

export const isNarrow = () => matchMedia("(max-width: 640px)").matches;
export const isTouch = () => matchMedia("(pointer: coarse)").matches;
const motionOn = () => document.documentElement.dataset.motion !== "off";

// ------------------------------------------------------------------ modal stack

const modals = [];

export function openModal(build, { className = "", onClose } = {}) {
  const prevFocus = document.activeElement;
  const root = h("div.modal-root");
  const backdrop = h("div.modal-backdrop");
  const panel = h("div.modal", { role: "dialog", "aria-modal": "true", class: className });
  root.append(backdrop, panel);
  let closed = false;
  const api = {
    root,
    panel,
    close() {
      if (closed) return;
      closed = true;
      modals.splice(modals.indexOf(api), 1);
      if (!modals.length) document.body.classList.remove("has-modal");
      root.classList.add("closing");
      if (motionOn()) setTimeout(() => root.remove(), 170); else root.remove();
      onClose?.();
      if (!isTouch() && prevFocus?.isConnected) prevFocus.focus?.({ preventScroll: true });
    },
  };
  backdrop.addEventListener("click", () => api.close());
  root.addEventListener("click", (e) => { if (e.target === root) api.close(); });
  appendKids(panel, [build(api)]);
  document.body.append(root);
  document.body.classList.add("has-modal");
  modals.push(api);
  return api;
}

export const topModal = () => modals[modals.length - 1] ?? null;

// ------------------------------------------------------------------ popover menu (action sheet on phones)

let menu = null;

export function closeMenu() {
  if (!menu) return false;
  const m = menu;
  menu = null;
  m.layer.remove();
  m.onClose?.();
  return true;
}

/**
 * items: { icon, label, onClick, danger, disabled, active, hint, keepOpen } | "sep" | { title } | Node
 */
export function openMenu(anchor, items, { onClose, className = "" } = {}) {
  closeMenu();
  const el = h("div.menu", { role: "menu", class: className });
  const render = (list) => el.replaceChildren(...list.filter(Boolean).map((it) => {
    if (it === "sep") return h("div.menu-sep");
    if (it instanceof Node) return it;
    if (it.title) return h("div.menu-title", it.title);
    return h("button.menu-item", {
      type: "button",
      role: "menuitem",
      disabled: !!it.disabled,
      class: [it.danger && "danger", it.active && "active"],
      onclick: (e) => {
        if (!it.keepOpen) closeMenu();
        it.onClick?.(e);
      },
    }, it.icon && icon(it.icon, 17), h("span.menu-label", it.label), it.hint && h("span.menu-hint", it.hint));
  }));
  render(items);
  const sheet = isNarrow();
  const layer = h("div.menu-layer", { class: sheet && "sheet" }, el);
  layer.addEventListener("pointerdown", (e) => {
    if (e.target === layer) {
      e.preventDefault();
      closeMenu();
    }
  });
  document.body.append(layer);
  menu = { layer, el, onClose, render };
  if (!sheet && anchor) placeNear(el, anchor);
  el.querySelector("input, button:not([disabled])")?.focus({ preventScroll: true });
  return menu;
}

function placeNear(el, anchor) {
  const r = anchor.getBoundingClientRect();
  const m = el.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight, pad = 8;
  let left = Math.min(Math.max(pad, r.left), vw - m.width - pad);
  if (r.left + m.width > vw - pad) left = Math.max(pad, r.right - m.width);
  let top = r.bottom + 6;
  if (top + m.height > vh - pad) top = Math.max(pad, r.top - m.height - 6);
  el.style.left = left + "px";
  el.style.top = top + "px";
}

// ------------------------------------------------------------------ toasts

export function toast(message, { action, duration = 4200, kind = "" } = {}) {
  const host = document.getElementById("toasts");
  if (!host) return;
  let timer;
  const remove = () => {
    clearTimeout(timer);
    el.classList.add("out");
    setTimeout(() => el.remove(), motionOn() ? 200 : 0);
  };
  const el = h("div.toast", { role: "status", class: kind },
    h("span.toast-msg", message),
    action && h("button.toast-btn", { type: "button", onclick: () => { action.onClick(); remove(); } }, action.label));
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  timer = setTimeout(remove, duration);
  return remove;
}

// ------------------------------------------------------------------ dialogs

/** buttons: [{ label, value, kind: "primary" | "danger" | "" }] → resolves the value, or null if dismissed. */
export function dialog({ title, message, buttons = [{ label: "OK", value: true, kind: "primary" }], input = null }) {
  return new Promise((resolve) => {
    let field = null;
    openModal((api) => {
      const done = (value) => {
        resolve(input && value !== null && value !== false ? field.value : value);
        api.close();
      };
      if (input) {
        field = h("input.field", {
          type: "text",
          value: input.value ?? "",
          placeholder: input.placeholder ?? "",
          maxLength: input.maxLength ?? 200,
          onkeydown: (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); done(buttons.at(-1).value); } },
        });
        setTimeout(() => { field.focus(); field.select(); }, 30);
      }
      return h("div.dlg",
        h("h3.dlg-title", title),
        message && h("p.dlg-msg", message),
        field,
        h("div.dlg-actions", buttons.map((b) => h("button.btn", { type: "button", class: b.kind, onclick: () => done(b.value) }, b.label))));
    }, { className: "small", onClose: () => resolve(null) });
  });
}

export async function confirmDialog({ title, message, confirm = "OK", danger = false }) {
  return (await dialog({ title, message, buttons: [{ label: "Abbrechen", value: false }, { label: confirm, value: true, kind: danger ? "danger" : "primary" }] })) === true;
}

export async function promptDialog({ title, value = "", placeholder = "", confirm = "Speichern" }) {
  const v = await dialog({ title, input: { value, placeholder }, buttons: [{ label: "Abbrechen", value: null }, { label: confirm, value: true, kind: "primary" }] });
  return typeof v === "string" ? v : null;
}

// ------------------------------------------------------------------ form controls

/** Segmented control. options: [{ value, label, icon, style }] */
export function segmented(options, value, onChange, { label } = {}) {
  const el = h("div.seg", { role: "radiogroup", "aria-label": label });
  const btns = options.map((o) => h("button.seg-btn", {
    type: "button",
    role: "radio",
    "aria-checked": String(o.value === value),
    class: o.value === value && "on",
    style: o.style,
    onclick: () => {
      for (const b of btns) { b.classList.toggle("on", b === btn(o)); b.setAttribute("aria-checked", String(b === btn(o))); }
      onChange(o.value);
    },
  }, o.icon && icon(o.icon, 15), o.label && h("span", o.label)));
  const btn = (o) => btns[options.indexOf(o)];
  el.append(...btns);
  return el;
}

export function toggle(checked, onChange, label) {
  const input = h("input", { type: "checkbox", checked, onchange: () => onChange(input.checked), "aria-label": label });
  return h("label.switch", input, h("span.switch-track", h("span.switch-knob")));
}

export function slider({ min, max, step = 1, value, unit = "px", onInput }) {
  const out = h("span.slider-val", `${value} ${unit}`.trim());
  const input = h("input.slider", {
    type: "range", min, max, step, value,
    oninput: () => { out.textContent = `${input.value} ${unit}`.trim(); onInput(Number(input.value)); },
  });
  return h("div.slider-wrap", input, out);
}

export function autogrow(ta) {
  const fit = () => {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + 2 + "px";
  };
  ta.addEventListener("input", fit);
  requestAnimationFrame(fit);
  return fit;
}

// ------------------------------------------------------------------ files

export async function saveFile(name, text, type = "application/json") {
  const blob = new Blob([text], { type });
  if (isTouch() && typeof File === "function" && navigator.canShare) {
    const file = new File([blob], name, { type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return true;
      } catch (e) {
        if (e?.name === "AbortError") return false;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name, style: "display:none" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

export function pickFile(accept = "application/json,.json") {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept, style: "position:fixed;left:-999px;top:0;opacity:0" });
    input.addEventListener("change", () => { resolve(input.files?.[0] ?? null); input.remove(); }, { once: true });
    document.body.append(input);
    input.click();
  });
}

export function relTime(ts, now = Date.now()) {
  if (!ts) return "–";
  const s = Math.round((now - ts) / 1000);
  if (s < 10) return "gerade eben";
  if (s < 60) return `vor ${s} Sek.`;
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `vor ${hrs} Std.`;
  return new Date(ts).toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const fmtDateTime = (ts) => new Date(ts).toLocaleString("de-DE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(n / 1024 / 1024).toFixed(2).replace(".", ",")} MB`;
}
