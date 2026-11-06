#!/usr/bin/env node
// Unity Developer Vault – MCP server for Claude Code.
//
// Reads a vault folder that the iOS app synchronises (iCloud Drive, Working Copy repo, GitHub
// clone, or an extracted export ZIP) and exposes it to Claude via the Model Context Protocol:
//   tools:     vault_search, vault_get, vault_list, vault_project_tree, vault_outline
//   prompts:   every prompt saved in the vault (usable as /mcp__unity-vault__<name> in Claude Code)
//   resources: vault://<path> for every note, prompt and script
//
// Zero dependencies (Node >= 18). Usage:
//   claude mcp add unity-vault -- node /path/to/server.mjs /path/to/VaultFolder
// or set UNITY_VAULT_DIR.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const VERSION = "1.0.0";
const SUPPORTED = new Set([".cs", ".md", ".markdown", ".txt"]);
const SKIP_DIRS = new Set([".git", ".vault", "node_modules", "Library", "Temp", "obj", "bin", "__MACOSX"]);

export function resolveVaultDir(argv = process.argv, env = process.env) {
  const dir = argv[2] || env.UNITY_VAULT_DIR;
  if (!dir) return null;
  return path.resolve(dir.replace(/^~(?=$|\/)/, process.env.HOME || "~"));
}

// ---------------------------------------------------------------- vault loading

export function parseFrontMatter(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return { meta: {}, body: text };
  const lines = text.split("\n");
  const meta = {};
  let end = -1;
  let listKey = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (line === "---" || line === "...") { end = i; break; }
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) { (meta[listKey] ||= []).push(unquote(item[1])); continue; }
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (value === "") { listKey = key; meta[key] = []; continue; }
    listKey = null;
    if (value.startsWith("[") && value.endsWith("]")) meta[key] = splitList(value.slice(1, -1));
    else meta[key] = unquote(value);
  }
  if (end < 0) return { meta: {}, body: text };
  let body = lines.slice(end + 1).join("\n");
  if (body.startsWith("\n")) body = body.slice(1);
  return { meta, body };
}

function unquote(s) {
  s = s.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function splitList(s) {
  const out = [];
  let cur = "", inQ = false, esc = false;
  for (const ch of s) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === "\\" && inQ) { cur += ch; esc = true; continue; }
    if (ch === '"') { inQ = !inQ; cur += ch; continue; }
    if (ch === "," && !inQ) { if (cur.trim()) out.push(unquote(cur)); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(unquote(cur));
  return out;
}

export function loadVault(root) {
  const items = [];
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, ".vault", "manifest.json"), "utf8"));
  } catch { /* optional */ }
  const metaByPath = new Map();
  if (manifest?.entries) {
    for (const [id, e] of Object.entries(manifest.entries)) metaByPath.set(e.path, { id, ...(e.meta || {}) });
  } else if (Array.isArray(manifest?.items)) {
    for (const mi of manifest.items) metaByPath.set(mi.path, mi.item);
  }

  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!SUPPORTED.has(ext) || e.name === "INDEX.md") continue;
      let raw;
      try { raw = fs.readFileSync(full, "utf8"); } catch { continue; }
      const rel = path.relative(root, full).split(path.sep).join("/");
      const folders = rel.split("/").slice(0, -1);
      const base = path.basename(e.name, ext);
      const known = metaByPath.get(rel) || {};
      let item;
      if (ext === ".cs") {
        item = {
          kind: "script", title: base, content: raw, summary: known.summary || "", category: known.category || "",
          tags: known.tags || [], status: known.status || "", unityVersion: known.unityVersion || "",
          components: known.components || [], dependencies: known.dependencies || [],
        };
      } else {
        const { meta, body } = parseFrontMatter(raw);
        item = {
          kind: meta.kind === "prompt" ? "prompt" : (ext === ".txt" && folders.some((f) => /prompt/i.test(f)) ? "prompt" : "note"),
          title: meta.title || base, content: body, summary: meta.summary || meta.description || "",
          category: meta.category || "", tags: Array.isArray(meta.tags) ? meta.tags : (meta.tags ? String(meta.tags).split(",").map((t) => t.trim()) : []),
          status: "",
        };
      }
      item.path = rel;
      item.folders = folders;
      item.project = folders[0] && folders[0] !== "Inbox" ? folders[0] : "";
      items.push(item);
    }
  };
  walk(root);
  items.sort((a, b) => a.path.localeCompare(b.path));
  return { root, items, manifest };
}

// ---------------------------------------------------------------- search

function identifierWords(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./]/g, " ").toLowerCase();
}

function stem(w) {
  if (w.length <= 4) return w;
  for (const s of ["ations", "ation", "ions", "ion", "ers", "er", "ing", "ors", "or", "ed", "es", "en", "s", "e"]) {
    if (w.endsWith(s) && w.length - s.length >= 4) return w.slice(0, -s.length);
  }
  return w;
}

function tokenize(q) {
  const terms = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(q))) terms.push((m[1] || m[2]).toLowerCase());
  return terms;
}

export function search(vault, query, { kind, project, limit = 20 } = {}) {
  const terms = tokenize(query || "");
  const results = [];
  for (const it of vault.items) {
    if (kind && it.kind !== kind) continue;
    if (project && it.project.toLowerCase() !== project.toLowerCase()) continue;
    const fields = {
      title: (it.title + " " + identifierWords(it.title)).toLowerCase(),
      tags: it.tags.join(" ").toLowerCase(),
      summary: (it.summary || "").toLowerCase(),
      category: (it.category || "").toLowerCase(),
      folder: it.folders.join(" / ").toLowerCase(),
      content: it.content.toLowerCase(),
      words: it.kind === "script" ? identifierWords(it.content) : "",
    };
    const weights = { title: 10, tags: 7, summary: 5, category: 5, folder: 4, content: 2, words: 2 };
    let score = 0;
    let ok = true;
    for (const t of terms) {
      const st = stem(t);
      let s = 0;
      for (const [f, text] of Object.entries(fields)) {
        if (text.includes(t)) s += weights[f];
        else if (st !== t && text.includes(st)) s += weights[f] * 0.6;
      }
      if (s === 0) { ok = false; break; }
      score += s;
    }
    if (!ok) continue;
    if (terms.length === 0) score = 1;
    let line = null, snippet = it.summary || "";
    if (terms.length) {
      const lines = it.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i].toLowerCase();
        if (terms.some((t) => l.includes(t) || l.includes(stem(t)))) { line = i + 1; snippet = lines[i].trim().slice(0, 200); break; }
      }
    }
    results.push({ score, item: it, line, snippet });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ---------------------------------------------------------------- outline (lightweight C# structure)

export function outline(code) {
  const out = [];
  const lines = code.split("\n");
  const typeRe = /\b(class|struct|interface|enum|record)\s+([A-Za-z_]\w*)(\s*<[^>]*>)?(\s*:\s*([^{]+))?/;
  const methodRe = /^\s*(?:\[[^\]]*\]\s*)*((?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|new|extern|unsafe|partial)\s+)*([\w<>\[\],.? ]+?)\s+([A-Za-z_]\w*)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(\{|=>|$|where)/;
  lines.forEach((l, i) => {
    const trimmed = l.trim();
    if (trimmed.startsWith("//")) return;
    const t = l.match(typeRe);
    if (t && !/\bnew\s/.test(l)) {
      out.push({ line: i + 1, kind: t[1], name: t[2], bases: t[5] ? t[5].split(",").map((s) => s.trim()).filter(Boolean) : [] });
      return;
    }
    const m = l.match(methodRe);
    if (m && !["if", "for", "foreach", "while", "switch", "return", "new", "else", "using", "catch", "lock"].includes(m[2].trim().split(" ").pop())
        && !["if", "for", "foreach", "while", "switch", "catch", "using", "lock", "nameof", "typeof"].includes(m[3])) {
      out.push({ line: i + 1, kind: "method", name: m[3], returns: m[2].trim(), params: m[5].trim() });
    }
  });
  return out;
}

// ---------------------------------------------------------------- MCP

export function slug(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "prompt";
}

const TOOLS = [
  {
    name: "vault_search",
    description: "Search the Unity Developer Vault (C# scripts, notes, game ideas, prompts). Matches titles, tags, folders, descriptions and code identifiers (CamelCase aware). Use before writing new Unity systems to reuse existing patterns.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms, e.g. 'spider leg animation' or 'enemy ai navmesh'" },
        kind: { type: "string", enum: ["script", "note", "prompt"], description: "Optional filter" },
        project: { type: "string", description: "Optional top-level folder (project) name" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "vault_get",
    description: "Read one vault entry in full (exact C# source or Markdown) together with its metadata.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Relative path as returned by vault_search/vault_list" } }, required: ["path"] },
  },
  {
    name: "vault_list",
    description: "List vault entries, optionally inside a folder and/or of one kind.",
    inputSchema: {
      type: "object",
      properties: { folder: { type: "string", description: "Folder path prefix, e.g. 'Horror Game/Scripts'" }, kind: { type: "string", enum: ["script", "note", "prompt"] } },
    },
  },
  {
    name: "vault_project_tree",
    description: "Show the folder/project structure of the vault with item counts.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "vault_outline",
    description: "Show the classes, base types and methods of a C# script in the vault (quick structural overview).",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
];

function text(t) { return { content: [{ type: "text", text: t }] }; }

function describe(it) {
  const meta = [`kind: ${it.kind}`, `path: ${it.path}`];
  if (it.project) meta.push(`project: ${it.project}`);
  if (it.category) meta.push(`category: ${it.category}`);
  if (it.tags?.length) meta.push(`tags: ${it.tags.join(", ")}`);
  if (it.status) meta.push(`status: ${it.status}`);
  if (it.unityVersion) meta.push(`unity: ${it.unityVersion}`);
  if (it.components?.length) meta.push(`components: ${it.components.join(", ")}`);
  if (it.dependencies?.length) meta.push(`dependencies: ${it.dependencies.join(", ")}`);
  if (it.summary) meta.push(`summary: ${it.summary}`);
  return meta.join("\n");
}

export function createServer(vaultDir, { reload = true } = {}) {
  let vault = vaultDir ? loadVault(vaultDir) : { root: null, items: [] };
  let loadedAt = Date.now();
  const current = () => {
    if (reload && vaultDir && Date.now() - loadedAt > 3000) { vault = loadVault(vaultDir); loadedAt = Date.now(); }
    return vault;
  };
  const findItem = (p) => {
    const v = current();
    const norm = String(p || "").replace(/^vault:\/\//, "").replace(/^\/+/, "");
    return v.items.find((i) => i.path === norm) || v.items.find((i) => i.path.toLowerCase() === norm.toLowerCase())
      || v.items.find((i) => i.title.toLowerCase() === norm.toLowerCase() || path.basename(i.path).toLowerCase() === norm.toLowerCase());
  };
  const promptMap = () => {
    const map = new Map();
    for (const it of current().items.filter((i) => i.kind === "prompt")) {
      let name = slug(it.title);
      let n = 2;
      while (map.has(name)) name = `${slug(it.title)}-${n++}`;
      map.set(name, it);
    }
    return map;
  };

  function callTool(name, args = {}) {
    const v = current();
    if (!vaultDir) return { isError: true, ...text("No vault folder configured. Pass the folder as first argument or set UNITY_VAULT_DIR.") };
    switch (name) {
      case "vault_search": {
        const res = search(v, args.query || "", { kind: args.kind, project: args.project, limit: Math.min(100, args.limit || 20) });
        if (!res.length) return text(`No results for "${args.query}". Try fewer or different terms.`);
        return text(res.map((r, i) => `${i + 1}. [${r.item.kind}] ${r.item.path}${r.line ? ` (line ${r.line})` : ""}\n   ${r.item.summary || r.snippet || ""}`.trimEnd()).join("\n"));
      }
      case "vault_get": {
        const it = findItem(args.path);
        if (!it) return { isError: true, ...text(`Not found: ${args.path}`) };
        const fence = it.kind === "script" ? "```csharp" : "```markdown";
        return text(`${describe(it)}\n\n${fence}\n${it.content}\n\`\`\``);
      }
      case "vault_list": {
        const prefix = (args.folder || "").replace(/^\/+|\/+$/g, "");
        const list = v.items.filter((i) => (!prefix || i.path.startsWith(prefix + "/")) && (!args.kind || i.kind === args.kind));
        if (!list.length) return text("No entries.");
        return text(list.map((i) => `[${i.kind}] ${i.path}${i.summary ? ` — ${i.summary}` : ""}`).join("\n"));
      }
      case "vault_project_tree": {
        const tree = {};
        for (const it of v.items) {
          let node = tree;
          for (const f of it.folders) node = (node[f] ||= { __count: 0 }), node.__count++;
        }
        const lines = [];
        const render = (node, depth) => {
          for (const [k, child] of Object.entries(node).filter(([k]) => k !== "__count").sort()) {
            lines.push(`${"  ".repeat(depth)}${k}/ (${child.__count})`);
            render(child, depth + 1);
          }
        };
        render(tree, 0);
        const counts = ["script", "note", "prompt"].map((k) => `${v.items.filter((i) => i.kind === k).length} ${k}s`).join(", ");
        return text(`Vault: ${v.root}\n${counts}\n\n${lines.join("\n") || "(no folders)"}`);
      }
      case "vault_outline": {
        const it = findItem(args.path);
        if (!it) return { isError: true, ...text(`Not found: ${args.path}`) };
        if (it.kind !== "script") return { isError: true, ...text("vault_outline only works for C# scripts.") };
        const o = outline(it.content);
        return text(o.map((e) => e.kind === "method" ? `  L${e.line} ${e.returns} ${e.name}(${e.params})` : `L${e.line} ${e.kind} ${e.name}${e.bases.length ? " : " + e.bases.join(", ") : ""}`).join("\n") || "No declarations found.");
      }
      default:
        return { isError: true, ...text(`Unknown tool: ${name}`) };
    }
  }

  function handle(msg) {
    const { id, method, params = {} } = msg;
    const ok = (result) => ({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
    switch (method) {
      case "initialize":
        return ok({
          protocolVersion: params.protocolVersion || "2025-06-18",
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: { name: "unity-developer-vault", version: VERSION },
          instructions: "Personal Unity knowledge base. Search it with vault_search before writing new Unity code and reuse tested scripts (status 'tested').",
        });
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: TOOLS });
      case "tools/call":
        try { return ok(callTool(params.name, params.arguments || {})); }
        catch (e) { return ok({ isError: true, ...text(String(e?.message || e)) }); }
      case "prompts/list":
        return ok({
          prompts: [...promptMap()].map(([name, it]) => ({
            name, title: it.title,
            description: it.summary || `Vault prompt from ${it.path}`,
            arguments: [{ name: "context", description: "Optional extra context appended to the prompt", required: false }],
          })),
        });
      case "prompts/get": {
        const it = promptMap().get(params.name);
        if (!it) return fail(-32602, `Unknown prompt: ${params.name}`);
        const extra = params.arguments?.context ? `\n\n${params.arguments.context}` : "";
        return ok({ description: it.title, messages: [{ role: "user", content: { type: "text", text: it.content + extra } }] });
      }
      case "resources/list":
        return ok({
          resources: current().items.slice(0, 1000).map((it) => ({
            uri: "vault://" + it.path, name: it.title, description: it.summary || undefined,
            mimeType: it.kind === "script" ? "text/x-csharp" : "text/markdown",
          })),
        });
      case "resources/read": {
        const it = findItem(params.uri);
        if (!it) return fail(-32602, `Unknown resource: ${params.uri}`);
        return ok({ contents: [{ uri: "vault://" + it.path, mimeType: it.kind === "script" ? "text/x-csharp" : "text/markdown", text: it.content }] });
      }
      default:
        if (id === undefined || id === null) return null; // unknown notification
        return fail(-32601, `Method not found: ${method}`);
    }
  }

  return { handle, callTool, get vault() { return current(); } };
}

// ---------------------------------------------------------------- stdio transport

const isMain = (() => {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname); } catch { return false; }
})();

if (isMain) {
  const dir = resolveVaultDir();
  if (dir && !fs.existsSync(dir)) process.stderr.write(`[unity-vault] Warning: folder does not exist: ${dir}\n`);
  const server = createServer(dir);
  process.stderr.write(`[unity-vault] MCP server ${VERSION} – vault: ${dir || "(not configured)"} – ${server.vault.items.length} entries\n`);
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
      return;
    }
    const batch = Array.isArray(msg) ? msg : [msg];
    for (const m of batch) {
      const res = server.handle(m);
      if (res) process.stdout.write(JSON.stringify(res) + "\n");
    }
  });
}
