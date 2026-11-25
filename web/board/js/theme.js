// Organizator – applies the appearance settings as CSS custom properties on <html>.

export const ACCENTS = [
  { name: "Indigo", hex: "#5E6AD2" },
  { name: "Blau", hex: "#2F7DE1" },
  { name: "Türkis", hex: "#0F9B8E" },
  { name: "Grün", hex: "#2F9E5B" },
  { name: "Gold", hex: "#D99A0B" },
  { name: "Orange", hex: "#EA6A22" },
  { name: "Rot", hex: "#E0484E" },
  { name: "Pink", hex: "#D6409F" },
  { name: "Violett", hex: "#8E4EC6" },
  { name: "Graphit", hex: "#3F3F46" },
];

export const FONTS = {
  system: { name: "System", stack: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  rounded: { name: "Rund", stack: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Quicksand", -apple-system, system-ui, sans-serif' },
  serif: { name: "Serif", stack: 'ui-serif, "New York", "Iowan Old Style", "Charter", Georgia, "Times New Roman", serif' },
  mono: { name: "Mono", stack: 'ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace' },
};

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
export const isDark = (s) => s.theme === "dark" || (s.theme === "system" && darkQuery.matches);
export const onSystemThemeChange = (fn) => darkQuery.addEventListener?.("change", fn);

const rgb = (hex) => { const v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const toHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
export function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));

/** Very dark accents become light in dark mode (and vice versa) so they stay visible. */
export function effectiveAccent(hex, dark) {
  const l = luminance(hex);
  if (dark && l < 0.06) return mix(hex, "#FFFFFF", 0.78);
  if (dark && l < 0.12) return mix(hex, "#FFFFFF", 0.3);
  if (!dark && l > 0.6) return mix(hex, "#000000", 0.35);
  return hex;
}

export function applySettings(s) {
  const root = document.documentElement;
  const dark = isDark(s);
  const accent = effectiveAccent(s.accent, dark);
  const set = (k, v) => root.style.setProperty(k, v);
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.density = s.density;
  root.dataset.cardStyle = s.cardStyle;
  root.dataset.labels = s.labelStyle;
  root.dataset.motion = s.motion ? "on" : "off";
  root.style.colorScheme = dark ? "dark" : "light";
  set("--accent", accent);
  set("--accent-ink", luminance(accent) > 0.45 ? "#111114" : "#FFFFFF");
  set("--font", FONTS[s.font]?.stack ?? FONTS.system.stack);
  set("--fs", s.fontSize + "px");
  set("--r", s.radius + "px");
  set("--list-w", s.listWidth + "px");
  setThemeColor(null);
}

/** Browser/status bar color: the board background on a board, otherwise the app background. */
export function setThemeColor(color) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  meta.setAttribute("content", color || bg || "#F7F7F5");
}
