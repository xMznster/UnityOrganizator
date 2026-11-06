// Two-way sync engine + remotes (port of SyncEngine.swift / Remotes.swift).
// In the PWA the remote is a GitHub repository (Git Data API → one commit per sync).
import { gitBlobId, utf8, fromUtf8, render, parseFile, SYNCED_EXT, safeName, fileName, folderPath, splitFrontMatter } from "./files.js";

export const MANIFEST_PATH = ".vault/manifest.json";

export function isSyncable(path) {
  const comps = path.split("/");
  if (comps.some((c) => c.startsWith("."))) return false;
  const ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "";
  return SYNCED_EXT.has(ext) && comps[comps.length - 1] !== "INDEX.md";
}

const metaFor = (item) => (item.kind === "script" ? { ...item, content: "" } : null);
const shortDate = (d) => { const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}`; };

/**
 * snapshot: {folders:[{id,name,parentId}], items:[item]} (live items only)
 * previouslySynced: Set of item ids synced from this device last time, or null on first sync.
 */
export async function sync(remote, snapshot, previouslySynced, { device = "iPhone", now = () => Date.now(), newId }) {
  const out = { updated: [], created: [], moved: [], trashed: [], conflicts: [], pushed: [], deletedRemote: [], log: [], manifest: null };
  const listing = await remote.list();
  let manifest = { format: "unity-developer-vault-sync", version: 1, entries: {}, folders: [] };
  if (listing[MANIFEST_PATH]) {
    try { manifest = JSON.parse(fromUtf8(await remote.read(MANIFEST_PATH))); } catch { out.log.push("⚠︎ Manifest unlesbar – starte neue Zuordnung (es wird nichts gelöscht)."); }
  }
  manifest.entries ||= {};
  const remoteFiles = Object.fromEntries(Object.entries(listing).filter(([p]) => isSyncable(p)));
  const writes = new Map(), deletes = [], newEntries = {};
  const claimed = new Set(), used = new Set(Object.values(manifest.entries).map((e) => e.path.toLowerCase()));
  const liveIds = new Set(snapshot.items.map((i) => i.id));
  const tracked = new Set(Object.values(manifest.entries).map((e) => e.path));
  const untracked = new Map(Object.entries(remoteFiles).filter(([p]) => !tracked.has(p)));
  const byBlob = new Map();
  for (const [p, b] of untracked) { if (!byBlob.has(b)) byBlob.set(b, []); byBlob.get(b).push(p); }

  const desired = (item, current) => {
    const dirs = folderPath(snapshot.folders, item.folderId).map((d) => safeName(d));
    const dir = item.folderId ? dirs.join("/") : "Inbox";
    const name = fileName(item);
    const base = dir ? `${dir}/${name}` : name;
    if (current) {
      const cd = current.includes("/") ? current.slice(0, current.lastIndexOf("/")) : "";
      const cn = current.split("/").pop(), cBase = cn.replace(/\.[^.]+$/, ""), want = name.replace(/\.[^.]+$/, "");
      if (cd === dir && (cBase === want || cBase.startsWith(want + " (")) && cn.split(".").pop() === name.split(".").pop()) return current;
    }
    let cand = base;
    for (let n = 2; used.has(cand.toLowerCase()) || (untracked.has(cand) && remoteFiles[cand]); n++) cand = base.replace(/(\.[^.]+)$/, ` (${n})$1`);
    return cand;
  };
  const entry = (path, remoteBlob, appBlob, item) => ({ path, remoteBlob, appBlob, kind: item.kind, meta: metaFor(item) });
  const push = (path, bytes) => { used.add(path.toLowerCase()); writes.set(path, bytes); claimed.add(path); out.pushed.push(path); };

  for (const item of [...snapshot.items].sort((a, b) => a.createdAt - b.createdAt)) {
    const bytes = utf8(render(item));
    const appBlob = await gitBlobId(bytes);
    const e = manifest.entries[item.id];
    if (!e) { const p = desired(item, null); push(p, bytes); newEntries[item.id] = entry(p, appBlob, appBlob, item); continue; }
    const appChanged = appBlob !== e.appBlob;
    const rb = remoteFiles[e.path];
    if (rb) {
      const remoteChanged = rb !== e.remoteBlob;
      if (!appChanged && !remoteChanged) {
        const target = desired(item, e.path);
        if (target !== e.path) { push(target, bytes); deletes.push(e.path); newEntries[item.id] = entry(target, appBlob, appBlob, item); }
        else { claimed.add(e.path); newEntries[item.id] = { ...e, kind: item.kind, meta: metaFor(item) }; }
      } else if (appChanged && !remoteChanged) {
        const target = desired(item, e.path);
        push(target, bytes);
        if (target !== e.path) deletes.push(e.path);
        newEntries[item.id] = entry(target, appBlob, appBlob, item);
      } else if (!appChanged && remoteChanged) {
        const updated = parseFile(e.path, fromUtf8(await remote.read(e.path)), item, now());
        updated.id = item.id; updated.folderId = item.folderId;
        out.updated.push(updated);
        claimed.add(e.path);
        newEntries[item.id] = entry(e.path, rb, await gitBlobId(utf8(render(updated))), updated);
        out.log.push(`↓ ${e.path} aktualisiert`);
      } else if (rb === appBlob) {
        claimed.add(e.path);
        newEntries[item.id] = entry(e.path, appBlob, appBlob, item);
      } else {
        const copy = parseFile(e.path, fromUtf8(await remote.read(e.path)), item, now());
        copy.id = newId(); copy.title = `${item.title} (Konflikt ${shortDate(new Date(now()))})`; copy.createdAt = now(); copy.folderId = null;
        out.created.push({ item: copy, folderPath: folderPath(snapshot.folders, item.folderId), reason: "Konflikt" });
        out.conflicts.push(e.path);
        const target = desired(item, e.path);
        push(target, bytes);
        if (target !== e.path) deletes.push(e.path);
        newEntries[item.id] = entry(target, appBlob, appBlob, item);
        out.log.push(`⚠︎ Konflikt in ${e.path}: beide Versionen behalten`);
      }
    } else {
      const movedTo = (byBlob.get(e.remoteBlob) || []).find((p) => untracked.has(p));
      if (movedTo) {
        untracked.delete(movedTo);
        const comps = movedTo.split("/");
        let fp = comps.slice(0, -1);
        if (fp.length === 1 && fp[0] === "Inbox") fp = [];
        out.moved.push({ itemId: item.id, folderPath: fp, title: item.kind === "script" ? comps[comps.length - 1].replace(/\.[^.]+$/, "") : null });
        used.add(movedTo.toLowerCase()); claimed.add(movedTo);
        if (appChanged) { writes.set(movedTo, bytes); out.pushed.push(movedTo); }
        newEntries[item.id] = appChanged ? entry(movedTo, appBlob, appBlob, item) : { ...e, path: movedTo, meta: metaFor(item) };
        out.log.push(`↔︎ ${e.path} → ${movedTo}`);
      } else if (appChanged) {
        const target = desired(item, e.path);
        push(target, bytes);
        newEntries[item.id] = entry(target, appBlob, appBlob, item);
        out.log.push(`↑ ${target} wiederhergestellt (am PC gelöscht, in der App geändert)`);
      } else {
        out.trashed.push(item.id);
        out.log.push(`🗑 ${e.path} wurde am PC gelöscht → Papierkorb`);
      }
    }
  }

  const restore = new Map();
  for (const [key, e] of Object.entries(manifest.entries)) {
    if (liveIds.has(key)) continue;
    const rb = remoteFiles[e.path];
    if (!rb || claimed.has(e.path)) continue;
    const deletedInApp = previouslySynced ? previouslySynced.has(key) : false;
    if (!deletedInApp) { untracked.set(e.path, rb); restore.set(e.path, { id: key, meta: e.meta }); out.log.push(`↓ ${e.path} wiederhergestellt`); continue; }
    if (rb === e.remoteBlob) { deletes.push(e.path); out.deletedRemote.push(e.path); }
    else { untracked.set(e.path, rb); out.log.push(`↓ ${e.path} wurde am PC geändert, aber in der App gelöscht → wiederhergestellt`); }
  }

  for (const [path, blob] of [...untracked].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (claimed.has(path) || writes.has(path)) continue;
    const text = fromUtf8(await remote.read(path));
    let item = parseFile(path, text, null, now());
    item.id = newId();
    const r = restore.get(path);
    if (r) {
      item.id = r.id;
      if (r.meta && item.kind === "script") item = { ...r.meta, content: item.content, title: item.title, id: r.id, folderId: null };
    } else if (item.fmId && !liveIds.has(item.fmId) && !newEntries[item.fmId]) item.id = item.fmId;
    delete item.fmId;
    if (item.kind === "script" && !item.status) item.status = "inDevelopment";
    const comps = path.split("/");
    let fp = comps.slice(0, -1);
    if (fp.length === 1 && fp[0] === "Inbox") fp = [];
    out.created.push({ item, folderPath: fp, reason: "Neu am PC" });
    used.add(path.toLowerCase());
    newEntries[item.id] = entry(path, blob, await gitBlobId(utf8(render(item))), item);
    out.log.push(`↓ ${path} neu`);
  }

  const del = [...new Set(deletes)].filter((p) => !writes.has(p)).sort();
  manifest.entries = newEntries;
  manifest.lastSync = new Date(now()).toISOString();
  manifest.device = device;
  manifest.folders = snapshot.folders;
  writes.set(MANIFEST_PATH, utf8(JSON.stringify(manifest, null, 2)));
  out.manifest = manifest;
  await remote.apply(writes, del, `Vault-Sync von ${device}: ${out.pushed.length} geändert, ${del.length} gelöscht`);
  out.log.unshift(`✓ Synchronisiert mit ${remote.displayName}`);
  out.summary = `↑ ${out.pushed.length} gesendet · ↓ ${out.updated.length + out.created.length} empfangen · ${out.moved.length} verschoben · ${out.trashed.length} gelöscht · ${out.conflicts.length} Konflikte`;
  return out;
}

export class MemoryRemote {
  constructor(files = {}) { this.files = new Map(Object.entries(files)); this.displayName = "Speicher"; this.commits = []; }
  async list() { const o = {}; for (const [p, d] of this.files) o[p] = await gitBlobId(d); return o; }
  async read(p) { if (!this.files.has(p)) throw new Error("missing " + p); return this.files.get(p); }
  async apply(writes, deletes, msg) { for (const d of deletes) this.files.delete(d); for (const [p, d] of writes) this.files.set(p, d); this.commits.push(msg); }
}

const b64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0));

/** GitHub remote via the Git Data API (works in browsers; token needs "Contents: Read and write"). */
export class GitHubRemote {
  constructor({ owner, repo, branch = "main", directory = "" }, token, fetchImpl = (...a) => fetch(...a)) {
    this.cfg = { owner, repo, branch: branch || "main", directory };
    this.token = token;
    this.fetch = fetchImpl;
    this.displayName = `github.com/${owner}/${repo}@${this.cfg.branch}`;
    this.prefix = directory.replace(/^[\/ ]+|[\/ ]+$/g, "") ? directory.replace(/^[\/ ]+|[\/ ]+$/g, "") + "/" : "";
    this.blobs = new Map();
  }
  get repoPath() { return `/repos/${this.cfg.owner}/${this.cfg.repo}`; }
  async req(method, path, body) {
    const r = await this.fetch("https://api.github.com" + path, {
      method, headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, cache: "no-store",
    });
    let json = null;
    try { json = await r.json(); } catch { /* empty */ }
    return { status: r.status, json };
  }
  check({ status, json }, ok = [200, 201]) {
    if (ok.includes(status)) return json;
    const msg = json?.message || "Unbekannter Fehler";
    if (status === 401) throw new Error(`Token ungültig oder abgelaufen (${msg})`);
    if (status === 403 || status === 404) throw new Error(`Kein Zugriff auf ${this.cfg.owner}/${this.cfg.repo} – Token-Berechtigung „Contents: Read and write“ prüfen (${msg})`);
    throw new Error(`HTTP ${status}: ${msg}`);
  }
  async list() {
    this.blobs.clear(); this.head = null; this.baseTree = null;
    const ref = await this.req("GET", `${this.repoPath}/git/ref/heads/${this.cfg.branch}`);
    if (ref.status === 404 || ref.status === 409) return {};
    this.head = this.check(ref).object.sha;
    this.baseTree = this.check(await this.req("GET", `${this.repoPath}/git/commits/${this.head}`)).tree.sha;
    const tree = this.check(await this.req("GET", `${this.repoPath}/git/trees/${this.baseTree}?recursive=1`));
    if (tree.truncated) throw new Error("Repository zu groß für einen Tree-Abruf – bitte ein Unterverzeichnis verwenden.");
    const out = {};
    for (const e of tree.tree) if (e.type === "blob" && e.path.startsWith(this.prefix)) { const rel = e.path.slice(this.prefix.length); out[rel] = e.sha; this.blobs.set(rel, e.sha); }
    return out;
  }
  async read(path) {
    const sha = this.blobs.get(path);
    if (!sha) throw new Error("Datei nicht im Repository: " + path);
    return unb64(this.check(await this.req("GET", `${this.repoPath}/git/blobs/${sha}`)).content);
  }
  async apply(writes, deletes, message) {
    if (!this.head) await this.initEmpty();
    const tree = [];
    for (const [path, data] of [...writes].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (this.blobs.get(path) === await gitBlobId(data)) continue;
      const blob = this.check(await this.req("POST", `${this.repoPath}/git/blobs`, { content: b64(data), encoding: "base64" }));
      tree.push({ path: this.prefix + path, mode: "100644", type: "blob", sha: blob.sha });
    }
    for (const p of deletes) if (this.blobs.has(p)) tree.push({ path: this.prefix + p, mode: "100644", type: "blob", sha: null });
    if (!tree.length) return;
    const t = this.check(await this.req("POST", `${this.repoPath}/git/trees`, { tree, ...(this.baseTree ? { base_tree: this.baseTree } : {}) }));
    const c = this.check(await this.req("POST", `${this.repoPath}/git/commits`, { message, tree: t.sha, parents: this.head ? [this.head] : [] }));
    const r = await this.req("PATCH", `${this.repoPath}/git/refs/heads/${this.cfg.branch}`, { sha: c.sha, force: false });
    if (r.status === 422 || r.status === 409) { const e = new Error("Das Repository wurde während der Synchronisierung verändert. Bitte erneut synchronisieren."); e.retry = true; throw e; }
    this.check(r);
    this.head = c.sha; this.baseTree = t.sha;
  }
  async initEmpty() {
    const readme = "# Unity Developer Vault\n\nDieses Repository wird von der App *Unity Developer Vault* synchronisiert.\n";
    const r = await this.req("PUT", `${this.repoPath}/contents/${this.prefix}.vault/README.md`, { message: "Vault initialisieren", content: b64(utf8(readme)), branch: this.cfg.branch });
    if (r.status === 422) {
      const repo = this.check(await this.req("GET", this.repoPath));
      const base = this.check(await this.req("GET", `${this.repoPath}/git/ref/heads/${repo.default_branch || "main"}`));
      this.check(await this.req("POST", `${this.repoPath}/git/refs`, { ref: `refs/heads/${this.cfg.branch}`, sha: base.object.sha }));
    } else this.check(r);
    await this.list();
    if (!this.head) throw new Error("Branch konnte nicht angelegt werden");
  }
}

export { splitFrontMatter };
