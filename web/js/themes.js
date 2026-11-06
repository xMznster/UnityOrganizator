// Theme system: app themes (UI colors) and code themes (syntax colors) are independent.
// Every theme is a set of CSS custom properties applied to <html>.

const ui = (o) => o;

export const APP_THEMES = {
  "vault-dark": ui({ name: "Vault Dark", dark: true, bg: "#090B0F", surface: "#10131A", surface2: "#161A23", hi: "#1D2230", stroke: "#232836", stroke2: "#323949", text: "#E8EAF0", text2: "#8A93A6", text3: "#596173", accent: "#4FD1C5", amber: "#F7B955", error: "#FF5C6C", warning: "#F7B955", info: "#6CB6FF", success: "#5BD69A", note: "#7AA2F7", prompt: "#C792EA", script: "#8BD5A0", code: "vault-night" }),
  "vault-light": ui({ name: "Vault Light", dark: false, bg: "#F3F4F7", surface: "#FFFFFF", surface2: "#F8F9FB", hi: "#EDEFF4", stroke: "#E1E4EA", stroke2: "#CDD2DB", text: "#14171F", text2: "#5B6372", text3: "#99A0AD", accent: "#0E9488", amber: "#C27C0E", error: "#D92D3F", warning: "#B7791F", info: "#2F6FDB", success: "#18925A", note: "#3B6FE0", prompt: "#8B4FC9", script: "#1E9A4F", code: "vault-day" }),
  "github-dark": ui({ name: "GitHub Dark", dark: true, bg: "#0D1117", surface: "#161B22", surface2: "#1C2128", hi: "#21262D", stroke: "#30363D", stroke2: "#3D444D", text: "#E6EDF3", text2: "#9198A1", text3: "#6E7681", accent: "#4493F8", amber: "#D29922", error: "#F85149", warning: "#D29922", info: "#58A6FF", success: "#3FB950", note: "#58A6FF", prompt: "#BC8CFF", script: "#3FB950", code: "github-dark" }),
  "github-dimmed": ui({ name: "GitHub Dimmed", dark: true, bg: "#22272E", surface: "#2D333B", surface2: "#323942", hi: "#373E47", stroke: "#444C56", stroke2: "#545D68", text: "#ADBAC7", text2: "#768390", text3: "#636E7B", accent: "#539BF5", amber: "#C69026", error: "#E5534B", warning: "#C69026", info: "#6CB6FF", success: "#57AB5A", note: "#6CB6FF", prompt: "#B083F0", script: "#57AB5A", code: "github-dimmed" }),
  "github-light": ui({ name: "GitHub Light", dark: false, bg: "#F6F8FA", surface: "#FFFFFF", surface2: "#F6F8FA", hi: "#EFF2F5", stroke: "#D1D9E0", stroke2: "#C1CAD3", text: "#1F2328", text2: "#59636E", text3: "#818B98", accent: "#0969DA", amber: "#9A6700", error: "#D1242F", warning: "#9A6700", info: "#0969DA", success: "#1A7F37", note: "#0969DA", prompt: "#8250DF", script: "#1A7F37", code: "github-light" }),
  "github-hc": ui({ name: "GitHub High Contrast", dark: true, bg: "#010409", surface: "#0A0C10", surface2: "#151B23", hi: "#272B33", stroke: "#7A828E", stroke2: "#9EA7B3", text: "#FFFFFF", text2: "#D1D7E0", text3: "#B7BDC8", accent: "#71B7FF", amber: "#F0B72F", error: "#FF6A69", warning: "#F0B72F", info: "#71B7FF", success: "#26CD4D", note: "#71B7FF", prompt: "#CB9EFF", script: "#26CD4D", code: "github-hc" }),
  "unity-pro": ui({ name: "Unity Editor (Pro)", dark: true, bg: "#191919", surface: "#282828", surface2: "#2E2E2E", hi: "#3C3C3C", stroke: "#1A1A1A", stroke2: "#4A4A4A", text: "#D2D2D2", text2: "#9A9A9A", text3: "#6E6E6E", accent: "#3A79BB", amber: "#E0B341", error: "#E06C75", warning: "#E0B341", info: "#4C9BE8", success: "#8BC34A", note: "#4C9BE8", prompt: "#B38FE0", script: "#8BC34A", code: "visual-studio" }),
  "dracula": ui({ name: "Dracula", dark: true, bg: "#21222C", surface: "#282A36", surface2: "#2F3241", hi: "#343746", stroke: "#3B3E51", stroke2: "#4B4F66", text: "#F8F8F2", text2: "#A4A6B5", text3: "#6272A4", accent: "#BD93F9", amber: "#F1FA8C", error: "#FF5555", warning: "#FFB86C", info: "#8BE9FD", success: "#50FA7B", note: "#8BE9FD", prompt: "#FF79C6", script: "#50FA7B", code: "dracula" }),
  "nord": ui({ name: "Nord", dark: true, bg: "#242933", surface: "#2E3440", surface2: "#353C4A", hi: "#3B4252", stroke: "#434C5E", stroke2: "#4C566A", text: "#ECEFF4", text2: "#A3ABBA", text3: "#6E7A91", accent: "#88C0D0", amber: "#EBCB8B", error: "#BF616A", warning: "#EBCB8B", info: "#81A1C1", success: "#A3BE8C", note: "#81A1C1", prompt: "#B48EAD", script: "#A3BE8C", code: "nord" }),
  "tokyo-night": ui({ name: "Tokyo Night", dark: true, bg: "#16161E", surface: "#1A1B26", surface2: "#1F2030", hi: "#24283B", stroke: "#292E42", stroke2: "#3B4261", text: "#C0CAF5", text2: "#8089B3", text3: "#565F89", accent: "#7AA2F7", amber: "#E0AF68", error: "#F7768E", warning: "#E0AF68", info: "#7DCFFF", success: "#9ECE6A", note: "#7AA2F7", prompt: "#BB9AF7", script: "#9ECE6A", code: "tokyo-night" }),
  "catppuccin": ui({ name: "Catppuccin Mocha", dark: true, bg: "#11111B", surface: "#1E1E2E", surface2: "#24243A", hi: "#313244", stroke: "#313244", stroke2: "#45475A", text: "#CDD6F4", text2: "#A6ADC8", text3: "#7F849C", accent: "#CBA6F7", amber: "#F9E2AF", error: "#F38BA8", warning: "#FAB387", info: "#89B4FA", success: "#A6E3A1", note: "#89B4FA", prompt: "#F5C2E7", script: "#A6E3A1", code: "catppuccin" }),
  "one-dark": ui({ name: "One Dark", dark: true, bg: "#1E2127", surface: "#282C34", surface2: "#2C313A", hi: "#333842", stroke: "#3A3F4B", stroke2: "#4B5263", text: "#ABB2BF", text2: "#848B98", text3: "#5C6370", accent: "#61AFEF", amber: "#E5C07B", error: "#E06C75", warning: "#D19A66", info: "#56B6C2", success: "#98C379", note: "#61AFEF", prompt: "#C678DD", script: "#98C379", code: "one-dark" }),
  "monokai": ui({ name: "Monokai", dark: true, bg: "#1E1F1C", surface: "#272822", surface2: "#2E2F29", hi: "#3E3D32", stroke: "#3B3C35", stroke2: "#49483E", text: "#F8F8F2", text2: "#B4B2A6", text3: "#75715E", accent: "#A6E22E", amber: "#E6DB74", error: "#F92672", warning: "#FD971F", info: "#66D9EF", success: "#A6E22E", note: "#66D9EF", prompt: "#AE81FF", script: "#A6E22E", code: "monokai" }),
  "gruvbox": ui({ name: "Gruvbox Dark", dark: true, bg: "#1D2021", surface: "#282828", surface2: "#32302F", hi: "#3C3836", stroke: "#3C3836", stroke2: "#504945", text: "#EBDBB2", text2: "#BDAE93", text3: "#928374", accent: "#FE8019", amber: "#FABD2F", error: "#FB4934", warning: "#FABD2F", info: "#83A598", success: "#B8BB26", note: "#83A598", prompt: "#D3869B", script: "#B8BB26", code: "gruvbox" }),
  "solarized-dark": ui({ name: "Solarized Dark", dark: true, bg: "#00212B", surface: "#002B36", surface2: "#073642", hi: "#0A3F4C", stroke: "#0E4452", stroke2: "#1D5664", text: "#EEE8D5", text2: "#93A1A1", text3: "#657B83", accent: "#2AA198", amber: "#B58900", error: "#DC322F", warning: "#CB4B16", info: "#268BD2", success: "#859900", note: "#268BD2", prompt: "#6C71C4", script: "#859900", code: "solarized-dark" }),
  "solarized-light": ui({ name: "Solarized Light", dark: false, bg: "#EEE8D5", surface: "#FDF6E3", surface2: "#F7F0DC", hi: "#EAE3CC", stroke: "#DDD6C1", stroke2: "#CFC8B3", text: "#073642", text2: "#586E75", text3: "#93A1A1", accent: "#2AA198", amber: "#B58900", error: "#DC322F", warning: "#CB4B16", info: "#268BD2", success: "#859900", note: "#268BD2", prompt: "#6C71C4", script: "#859900", code: "solarized-light" }),
  "rose-pine-dawn": ui({ name: "Rosé Pine Dawn", dark: false, bg: "#FAF4ED", surface: "#FFFAF3", surface2: "#F8F1EA", hi: "#F2E9E1", stroke: "#DFDAD9", stroke2: "#CECACD", text: "#575279", text2: "#797593", text3: "#9893A5", accent: "#D7827E", amber: "#EA9D34", error: "#B4637A", warning: "#EA9D34", info: "#286983", success: "#56949F", note: "#286983", prompt: "#907AA9", script: "#56949F", code: "rose-pine-dawn" }),
};

const code = (o) => o;
// keys: bg, text, gutter, gutterActive, cur, keyword, type, method, string, number, comment, pre, op, punct, invalid
export const CODE_THEMES = {
  "vault-night": code({ name: "Vault Night", dark: true, bg: "#0C0F15", text: "#D8DEE9", gutter: "#3A4152", gutterActive: "#9AA4B8", keyword: "#C678DD", type: "#4FD1C5", method: "#82AAFF", string: "#C3E88D", number: "#F78C6C", comment: "#5C6678", pre: "#FFCB6B", op: "#89DDFF", punct: "#8F9BB3", invalid: "#FF5C6C" }),
  "vault-day": code({ name: "Vault Day", dark: false, bg: "#FBFBFC", text: "#24292F", gutter: "#B4BAC4", gutterActive: "#4B5563", keyword: "#A626A4", type: "#0E8A82", method: "#4078F2", string: "#50A14F", number: "#C2410C", comment: "#9CA3AF", pre: "#986801", op: "#0184BC", punct: "#5B6372", invalid: "#D92D3F" }),
  "github-dark": code({ name: "GitHub Dark", dark: true, bg: "#0D1117", text: "#E6EDF3", gutter: "#6E7681", gutterActive: "#E6EDF3", keyword: "#FF7B72", type: "#FFA657", method: "#D2A8FF", string: "#A5D6FF", number: "#79C0FF", comment: "#8B949E", pre: "#FF7B72", op: "#FF7B72", punct: "#E6EDF3", invalid: "#FFA198" }),
  "github-dimmed": code({ name: "GitHub Dimmed", dark: true, bg: "#22272E", text: "#ADBAC7", gutter: "#636E7B", gutterActive: "#ADBAC7", keyword: "#F47067", type: "#F69D50", method: "#DCBDFB", string: "#96D0FF", number: "#6CB6FF", comment: "#768390", pre: "#F47067", op: "#F47067", punct: "#ADBAC7", invalid: "#FF938A" }),
  "github-light": code({ name: "GitHub Light", dark: false, bg: "#FFFFFF", text: "#1F2328", gutter: "#8C959F", gutterActive: "#1F2328", keyword: "#CF222E", type: "#953800", method: "#8250DF", string: "#0A3069", number: "#0550AE", comment: "#6E7781", pre: "#CF222E", op: "#CF222E", punct: "#1F2328", invalid: "#82071E" }),
  "github-hc": code({ name: "GitHub High Contrast", dark: true, bg: "#0A0C10", text: "#F0F3F6", gutter: "#9EA7B3", gutterActive: "#FFFFFF", keyword: "#FF9492", type: "#FFB757", method: "#DBB7FF", string: "#ADDCFF", number: "#91CBFF", comment: "#BDC4CC", pre: "#FF9492", op: "#FF9492", punct: "#F0F3F6", invalid: "#FFB1AF" }),
  "visual-studio": code({ name: "Visual Studio Dark", dark: true, bg: "#1E1E1E", text: "#DCDCDC", gutter: "#2B91AF", gutterActive: "#C8C8C8", keyword: "#569CD6", type: "#4EC9B0", method: "#DCDCAA", string: "#D69D85", number: "#B5CEA8", comment: "#57A64A", pre: "#9B9B9B", op: "#B4B4B4", punct: "#B4B4B4", invalid: "#F44747" }),
  "rider": code({ name: "Rider Dark", dark: true, bg: "#262626", text: "#BDBDBD", gutter: "#5C5C5C", gutterActive: "#A8A8A8", keyword: "#6C95EB", type: "#C191FF", method: "#39CC9B", string: "#C9A26D", number: "#ED94C0", comment: "#85C46C", pre: "#787878", op: "#BDBDBD", punct: "#BDBDBD", invalid: "#FF5647" }),
  "dracula": code({ name: "Dracula", dark: true, bg: "#282A36", text: "#F8F8F2", gutter: "#6272A4", gutterActive: "#F8F8F2", keyword: "#FF79C6", type: "#8BE9FD", method: "#50FA7B", string: "#F1FA8C", number: "#BD93F9", comment: "#6272A4", pre: "#FF79C6", op: "#FF79C6", punct: "#F8F8F2", invalid: "#FF5555" }),
  "nord": code({ name: "Nord", dark: true, bg: "#2E3440", text: "#D8DEE9", gutter: "#4C566A", gutterActive: "#D8DEE9", keyword: "#81A1C1", type: "#8FBCBB", method: "#88C0D0", string: "#A3BE8C", number: "#B48EAD", comment: "#616E88", pre: "#5E81AC", op: "#81A1C1", punct: "#ECEFF4", invalid: "#BF616A" }),
  "tokyo-night": code({ name: "Tokyo Night", dark: true, bg: "#1A1B26", text: "#A9B1D6", gutter: "#3B4261", gutterActive: "#737AA2", keyword: "#BB9AF7", type: "#2AC3DE", method: "#7AA2F7", string: "#9ECE6A", number: "#FF9E64", comment: "#565F89", pre: "#7DCFFF", op: "#89DDFF", punct: "#9ABDF5", invalid: "#F7768E" }),
  "catppuccin": code({ name: "Catppuccin Mocha", dark: true, bg: "#1E1E2E", text: "#CDD6F4", gutter: "#45475A", gutterActive: "#B4BEFE", keyword: "#CBA6F7", type: "#F9E2AF", method: "#89B4FA", string: "#A6E3A1", number: "#FAB387", comment: "#6C7086", pre: "#F5C2E7", op: "#89DCEB", punct: "#9399B2", invalid: "#F38BA8" }),
  "one-dark": code({ name: "One Dark", dark: true, bg: "#282C34", text: "#ABB2BF", gutter: "#495162", gutterActive: "#ABB2BF", keyword: "#C678DD", type: "#E5C07B", method: "#61AFEF", string: "#98C379", number: "#D19A66", comment: "#5C6370", pre: "#C678DD", op: "#56B6C2", punct: "#ABB2BF", invalid: "#E06C75" }),
  "monokai": code({ name: "Monokai", dark: true, bg: "#272822", text: "#F8F8F2", gutter: "#75715E", gutterActive: "#F8F8F2", keyword: "#F92672", type: "#66D9EF", method: "#A6E22E", string: "#E6DB74", number: "#AE81FF", comment: "#75715E", pre: "#F92672", op: "#F92672", punct: "#F8F8F2", invalid: "#F92672" }),
  "gruvbox": code({ name: "Gruvbox Dark", dark: true, bg: "#282828", text: "#EBDBB2", gutter: "#665C54", gutterActive: "#EBDBB2", keyword: "#FB4934", type: "#FABD2F", method: "#B8BB26", string: "#B8BB26", number: "#D3869B", comment: "#928374", pre: "#8EC07C", op: "#FE8019", punct: "#EBDBB2", invalid: "#FB4934" }),
  "solarized-dark": code({ name: "Solarized Dark", dark: true, bg: "#002B36", text: "#93A1A1", gutter: "#586E75", gutterActive: "#93A1A1", keyword: "#859900", type: "#B58900", method: "#268BD2", string: "#2AA198", number: "#D33682", comment: "#586E75", pre: "#CB4B16", op: "#859900", punct: "#93A1A1", invalid: "#DC322F" }),
  "solarized-light": code({ name: "Solarized Light", dark: false, bg: "#FDF6E3", text: "#586E75", gutter: "#93A1A1", gutterActive: "#586E75", keyword: "#859900", type: "#B58900", method: "#268BD2", string: "#2AA198", number: "#D33682", comment: "#93A1A1", pre: "#CB4B16", op: "#859900", punct: "#586E75", invalid: "#DC322F" }),
  "rose-pine-dawn": code({ name: "Rosé Pine Dawn", dark: false, bg: "#FFFAF3", text: "#575279", gutter: "#9893A5", gutterActive: "#575279", keyword: "#286983", type: "#56949F", method: "#D7827E", string: "#EA9D34", number: "#907AA9", comment: "#9893A5", pre: "#B4637A", op: "#286983", punct: "#797593", invalid: "#B4637A" }),
};

let storeRef = null;
export function bindStore(s) { storeRef = s; }

function hexToRgb(hex) { const v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }

export function resolveAppTheme(id) {
  if (id === "system" || !id) return matchMedia("(prefers-color-scheme: dark)").matches ? "vault-dark" : "vault-light";
  return APP_THEMES[id] ? id : "vault-dark";
}

export function applyThemes() {
  const appId = resolveAppTheme(storeRef?.getMeta("theme.app", "vault-dark") ?? "vault-dark");
  const a = APP_THEMES[appId];
  let codeId = storeRef?.getMeta("theme.code", "match") ?? "match";
  if (codeId === "match" || !CODE_THEMES[codeId]) codeId = a.code;
  const c = CODE_THEMES[codeId];
  const root = document.documentElement;
  const set = (k, v) => root.style.setProperty(k, v);
  for (const k of ["bg", "surface", "surface2", "hi", "stroke", "stroke2", "text", "text2", "text3", "accent", "amber", "error", "warning", "info", "success", "note", "prompt", "script"]) set("--" + k, a[k]);
  set("--on-accent", luminance(a.accent) > 0.45 ? "#081014" : "#FFFFFF");
  root.style.colorScheme = a.dark ? "dark" : "light";
  root.dataset.theme = a.dark ? "dark" : "light";
  const [r, g, b] = hexToRgb(a.accent);
  set("--ce-bg", c.bg); set("--ce-text", c.text); set("--ce-gutter", c.gutter); set("--ce-gutter-active", c.gutterActive);
  set("--ce-cur", c.dark ? `rgba(${r},${g},${b},.07)` : `rgba(${r},${g},${b},.08)`);
  const map = { keyword: "--tk-keyword", type: "--tk-type", method: "--tk-method", string: "--tk-string", number: "--tk-number", comment: "--tk-comment", pre: "--tk-pre", op: "--tk-op", punct: "--tk-punct", invalid: "--tk-invalid" };
  for (const [k, v] of Object.entries(map)) set(v, c[k]);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", a.bg);
}

function luminance(hex) { const [r, g, b] = hexToRgb(hex).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
