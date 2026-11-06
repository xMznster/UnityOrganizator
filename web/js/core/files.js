// ZIP (stored), CRC32, git blob ids, file naming, front-matter codec, export & import planning.
// Port of ZipWriter.swift, Hashing.swift, VaultSnapshot.swift (FileNaming/FileCodec) and ExportBuilder.swift.
import { suggestedTitle } from "./markdown.js";
import { csharpIdentifier } from "./templates.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
export const utf8 = (s) => enc.encode(s);
export const fromUtf8 = (b) => dec.decode(b);

// ---------------- hashing
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export async function sha1Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Git object id of a blob (`git hash-object`). */
export async function gitBlobId(bytes) {
  const head = utf8(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  return sha1Hex(all);
}

// ---------------- zip
export function uniquePath(p, used) {
  if (!used.has(p.toLowerCase())) return p;
  const slash = p.lastIndexOf("/"), dot = p.lastIndexOf(".");
  const hasExt = dot > slash + 1;
  const base = hasExt ? p.slice(0, dot) : p, ext = hasExt ? p.slice(dot) : "";
  for (let n = 2; ; n++) { const c = `${base} (${n})${ext}`; if (!used.has(c.toLowerCase())) return c; }
}

export class ZipWriter {
  constructor() { this.entries = []; this.used = new Set(); }
  add(path, data, date = new Date()) {
    let p = path.replace(/\\/g, "/").replace(/^\/+/, "");
    p = uniquePath(p, this.used);
    this.used.add(p.toLowerCase());
    this.entries.push({ path: p, data: typeof data === "string" ? utf8(data) : data, date });
    return p;
  }
  addDirectory(path) {
    const p = path.endsWith("/") ? path : path + "/";
    if (this.used.has(p.toLowerCase())) return;
    this.used.add(p.toLowerCase());
    this.entries.push({ path: p, data: new Uint8Array(0), date: new Date() });
  }
  toBytes() {
    const chunks = [], central = [];
    let offset = 0;
    const dos = (d) => {
      const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      return [time, date];
    };
    for (const e of this.entries) {
      const name = utf8(e.path), crc = crc32(e.data), [time, date] = dos(e.date), isDir = e.path.endsWith("/");
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, e.data.length, true); lh.setUint32(22, e.data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, e.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 0x031e, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, e.data.length, true); ch.setUint32(24, e.data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(38, isDir ? ((0o040755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + e.data.length;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, this.entries.length, true); end.setUint16(10, this.entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
    let p = 0;
    for (const c of all) { out.set(c, p); p += c.length; }
    return out;
  }
}

/** Reads stored (uncompressed) ZIPs; returns null for compressed archives. */
export function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) return null;
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = fromUtf8(bytes.subarray(p + 46, p + 46 + nl));
    if (method !== 0) return null;
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    if (!name.endsWith("/")) out.push({ path: name, data: bytes.slice(start, start + size) });
    p += 46 + nl + xl + cl;
  }
  return out;
}

// ---------------- naming
export function safeName(raw, fallback = "Unbenannt") {
  let s = String(raw).replace(/[\/\\:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").replace(/^[ .]+|[ .]+$/g, "");
  if (s.length > 100) s = s.slice(0, 100).trim();
  if (/^(CON|PRN|AUX|NUL|COM1|COM2|COM3|LPT1|LPT2)$/i.test(s)) s = "_" + s;
  return s || fallback;
}

export function fileName(item, promptsAsText = false) {
  if (item.kind === "script") {
    let base = item.title.trim().replace(/\.cs$/, "");
    const ok = /^[A-Za-z_][A-Za-z0-9_]*$/.test(base);
    return (ok ? base : csharpIdentifier(base)) + ".cs";
  }
  return safeName(item.title) + (item.kind === "prompt" && promptsAsText ? ".txt" : ".md");
}

// ---------------- front matter codec
const yq = (s) => JSON.stringify(String(s));

export function render(item, { frontMatter = true, promptsAsText = false } = {}) {
  if (item.kind === "script" || (item.kind === "prompt" && promptsAsText) || !frontMatter) return item.content;
  let fm = "---\n";
  fm += `title: ${yq(item.title)}\nkind: ${item.kind}\n`;
  if (item.category) fm += `category: ${yq(item.category)}\n`;
  if (item.tags?.length) fm += `tags: [${item.tags.map(yq).join(", ")}]\n`;
  if (item.summary) fm += `summary: ${yq(item.summary)}\n`;
  if (item.isFavorite) fm += "favorite: true\n";
  fm += `created: ${new Date(item.createdAt).toISOString().replace(/\.\d+Z$/, "Z")}\nid: ${item.id}\n---\n\n`;
  return fm + item.content;
}

function unquote(s) {
  s = s.trim();
  if (s.length >= 2 && s[0] === '"' && s.endsWith('"')) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
  if (s.length >= 2 && s[0] === "'" && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}
function splitList(s) {
  const out = []; let cur = "", q = false, esc = false;
  for (const ch of s) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === "\\" && q) { cur += ch; esc = true; continue; }
    if (ch === '"') { q = !q; cur += ch; continue; }
    if (ch === "," && !q) { if (cur.trim()) out.push(unquote(cur)); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(unquote(cur));
  return out;
}

export function splitFrontMatter(text) {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!t.startsWith("---\n") && !t.startsWith("---\r\n")) return { meta: null, body: text };
  const lines = t.split("\n");
  const meta = {};
  let end = -1, listKey = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (line === "---" || line === "...") { end = i; break; }
    const it = line.match(/^\s*-\s+(.*)$/);
    if (it && listKey) { meta[listKey].push(unquote(it[1])); continue; }
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (!v) { listKey = k; meta[k] = []; continue; }
    listKey = null;
    meta[k] = v.startsWith("[") && v.endsWith("]") ? splitList(v.slice(1, -1)) : unquote(v);
  }
  if (end < 0) return { meta: null, body: text };
  let body = lines.slice(end + 1).join("\n");
  if (body.startsWith("\n")) body = body.slice(1);
  return { meta, body };
}

export const normalizeTag = (t) => String(t).trim().replace(/^#+/, "").split(/\s+/).filter(Boolean).join("-");
export const parseTags = (s) => [...new Map(String(s).split(/[,;\n]/).map(normalizeTag).filter(Boolean).map((t) => [t.toLowerCase(), t])).values()];

export function parseFile(path, text, existing = null, now = Date.now()) {
  const name = path.split("/").pop();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  const base = dot >= 0 ? name.slice(0, dot) : name;
  const item = existing ? { ...existing } : { id: null, kind: ext === "cs" ? "script" : "note", title: base, content: "", summary: "", category: "", tags: [],
    createdAt: now, modifiedAt: now, isFavorite: false, folderId: null, unityVersion: "", components: [], dependencies: [], projectName: "", status: ext === "cs" ? "inDevelopment" : "" };
  item.modifiedAt = now;
  if (ext === "cs") { item.kind = "script"; item.content = text; item.title = base; if (!item.status) item.status = "inDevelopment"; }
  else if (ext === "md" || ext === "markdown") {
    const { meta, body } = splitFrontMatter(text);
    item.content = body;
    if (meta) {
      if (meta.title) item.title = meta.title; else if (!existing) item.title = base;
      if (meta.kind === "note" || meta.kind === "prompt") item.kind = meta.kind;
      if (meta.category !== undefined) item.category = meta.category;
      if (meta.summary !== undefined || meta.description !== undefined) item.summary = meta.summary ?? meta.description;
      if (Array.isArray(meta.tags)) item.tags = meta.tags.map(normalizeTag).filter(Boolean); else if (meta.tags) item.tags = parseTags(meta.tags);
      if (meta.favorite) item.isFavorite = meta.favorite === "true";
      if (!existing && meta.created && !isNaN(Date.parse(meta.created))) item.createdAt = Date.parse(meta.created);
      if (!existing && meta.id) item.fmId = meta.id;
    } else {
      if (!existing || existing.kind === "script") item.kind = "note";
      if (!existing) item.title = base || suggestedTitle(body) || "Notiz";
    }
  } else { item.content = text; if (!existing) { item.title = base; item.kind = "note"; } }
  return item;
}

export const SYNCED_EXT = new Set(["cs", "md", "markdown", "txt"]);

// ---------------- export
export function folderPath(folders, id) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = [];
  let cur = id, guard = 0;
  while (cur && byId.has(cur) && guard++ < 64) { const f = byId.get(cur); out.unshift(f.name); cur = f.parentId; }
  return out;
}
export function subtree(folders, id) {
  const set = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const f of folders) if (f.parentId && set.has(f.parentId) && !set.has(f.id)) { set.add(f.id); grew = true; } }
  return set;
}

/** snapshot: {folders, items}; returns [{path, data(Uint8Array), itemId}] */
export function exportFiles(snapshot, { itemIds = null, rootFolder = null, preserveFolders = true, scriptsOnly = false, includeManifest = true,
  rootName = "UnityVault", frontMatter = true, promptsAsText = false } = {}) {
  let items = snapshot.items;
  if (itemIds) { const s = new Set(itemIds); items = items.filter((i) => s.has(i.id)); }
  if (rootFolder) { const t = subtree(snapshot.folders, rootFolder); items = items.filter((i) => i.folderId && t.has(i.folderId)); }
  if (scriptsOnly) items = items.filter((i) => i.kind === "script");
  items = [...items].sort((a, b) => a.createdAt - b.createdAt);
  const strip = rootFolder ? Math.max(0, folderPath(snapshot.folders, rootFolder).length - 1) : 0;
  const prefix = rootName ? safeName(rootName) + "/" : "";
  const used = new Set(), out = [], manifestItems = [];
  for (const it of items) {
    let dirs = preserveFolders ? folderPath(snapshot.folders, it.folderId).slice(strip).map((d) => safeName(d)) : [];
    if (preserveFolders && !it.folderId && !scriptsOnly) dirs = ["Inbox"];
    let p = prefix + (dirs.length ? dirs.join("/") + "/" : "") + fileName(it, promptsAsText);
    p = uniquePath(p, used);
    used.add(p.toLowerCase());
    out.push({ path: p, data: utf8(render(it, { frontMatter, promptsAsText })), itemId: it.id });
    manifestItems.push({ path: p.slice(prefix.length), item: it });
  }
  if (includeManifest && !scriptsOnly) {
    const folders = rootFolder ? snapshot.folders.filter((f) => subtree(snapshot.folders, rootFolder).has(f.id)) : snapshot.folders;
    out.push({ path: prefix + ".vault/manifest.json", data: utf8(JSON.stringify({ format: "unity-developer-vault", version: 1, exportedAt: new Date().toISOString(), folders, items: manifestItems }, null, 2)) });
    out.push({ path: prefix + "INDEX.md", data: utf8(indexMarkdown(rootName, manifestItems)) });
  }
  return out;
}

const KIND_PLURAL = { note: "Notizen & Ideen", prompt: "Prompts", script: "Skripte" };
function indexMarkdown(rootName, items) {
  let md = `# ${rootName || "Unity Developer Vault"} – Index\n\nExportiert am ${new Date().toISOString()}. ${items.length} Einträge.\n\n`;
  for (const k of ["note", "prompt", "script"]) {
    const g = items.filter((m) => m.item.kind === k);
    if (!g.length) continue;
    md += `## ${KIND_PLURAL[k]} (${g.length})\n\n| Datei | Kategorie | Tags | Beschreibung |\n|---|---|---|---|\n`;
    for (const m of g) md += `| [${m.path}](${encodeURI(m.path)}) | ${m.item.category || ""} | ${(m.item.tags || []).join(", ")} | ${(m.item.summary || "").replace(/[|\n]/g, " ")} |\n`;
    md += "\n";
  }
  return md;
}

export function exportZip(snapshot, opts = {}) {
  const z = new ZipWriter();
  for (const f of exportFiles(snapshot, opts)) z.add(f.path, f.data, new Date(snapshot.items.find((i) => i.id === f.itemId)?.modifiedAt || Date.now()));
  if (opts.preserveFolders !== false && !opts.scriptsOnly) {
    const prefix = (opts.rootName ?? "UnityVault") ? safeName(opts.rootName ?? "UnityVault") + "/" : "";
    const ids = opts.rootFolder ? subtree(snapshot.folders, opts.rootFolder) : new Set(snapshot.folders.map((f) => f.id));
    const strip = opts.rootFolder ? Math.max(0, folderPath(snapshot.folders, opts.rootFolder).length - 1) : 0;
    for (const id of ids) { const p = folderPath(snapshot.folders, id).slice(strip).map((d) => safeName(d)).join("/"); if (p) z.addDirectory(prefix + p); }
  }
  return z.toBytes();
}

/** Plans an import; every item gets a NEW id (imports never overwrite). files: [{path, data}] */
export function planImport(files, newId) {
  const paths = files.map((f) => f.path);
  const firsts = new Set(paths.map((p) => p.split("/").filter(Boolean)).filter((c) => c.length > 1).map((c) => c[0]));
  let root = firsts.size === 1 && paths.every((p) => p.split("/").length > 1) ? [...firsts][0] + "/" : "";
  if (!paths.includes(root + ".vault/manifest.json")) root = "";
  const meta = new Map();
  const mf = files.find((f) => f.path.endsWith(".vault/manifest.json"));
  if (mf) { try { for (const mi of JSON.parse(fromUtf8(mf.data)).items || []) meta.set(mi.path, mi.item); } catch { /* ignore */ } }
  const out = [];
  for (const f of files) {
    const rel = root && f.path.startsWith(root) ? f.path.slice(root.length) : f.path;
    const comps = rel.split("/").filter(Boolean);
    const name = comps[comps.length - 1];
    if (!name || comps.some((c) => c.startsWith(".") || c === "__MACOSX")) continue;
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    if (!SYNCED_EXT.has(ext) || rel === "INDEX.md") continue;
    let item = parseFile(rel, fromUtf8(f.data), null);
    const m = meta.get(rel);
    if (m) item = { ...m, content: item.content, title: item.kind === "script" ? item.title : m.title };
    item.id = newId();
    item.folderId = null;
    delete item.fmId;
    let folder = comps.slice(0, -1);
    if (folder.length === 1 && folder[0] === "Inbox") folder = [];
    out.push({ item, folderPath: folder });
  }
  return out;
}
