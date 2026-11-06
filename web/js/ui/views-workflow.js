import { h, icon, badge, sheet, chip, toast, sectionHeader, copyText, relTime, dateTime, shareFiles, download } from "./kit.js";
import { store, KIND, uid } from "../store.js";
import { screen } from "./views-main.js";
import { exportSheet, importFiles, go } from "./common.js";
import { sync, GitHubRemote } from "../core/sync.js";
import { ZipWriter, utf8, fromUtf8 } from "../core/files.js";
import { skillFiles, normalizedSkillName, contextBundle, CLAUDE_MD_SNIPPET } from "../core/claude.js";
import { highlightCSharp, esc } from "../core/markdown.js";

const row = (ic, color, title, sub, onClick) => h("div.row", { onclick: onClick }, badge(ic, color), h("div.row-main", h("div.row-title", title), h("div.row-sub", sub)), icon("chevronRight", 16, "muted"));

// ---------------- sync service
export async function runSync({ quiet = false } = {}) {
  const cfg = { owner: store.getMeta("github.owner", ""), repo: store.getMeta("github.repo", ""), branch: store.getMeta("github.branch", "main"), directory: store.getMeta("github.dir", "") };
  const token = store.getMeta("github.token", "");
  if (!cfg.owner || !cfg.repo || !token) { if (!quiet) toast("GitHub-Sync ist noch nicht eingerichtet"); return null; }
  if (!navigator.onLine) { if (!quiet) toast("Offline – Synchronisierung später möglich"); return null; }
  if (runSync.busy) return null;
  runSync.busy = true;
  store.emit();
  const key = `sync.ids.${cfg.owner}/${cfg.repo}@${cfg.branch}/${cfg.directory}`;
  try {
    const remote = new GitHubRemote(cfg, token);
    const prev = store.getMeta(key, null);
    const go = () => sync(remote, store.snapshot(), prev ? new Set(prev) : null, { device: "iPhone", newId: uid });
    let out;
    try { out = await go(); } catch (e) { if (e.retry) out = await go(); else throw e; }
    store.applySync(out);
    await store.setMeta(key, Object.keys(out.manifest.entries));
    await store.setMeta("sync.lastDate", Date.now());
    await store.setMeta("sync.lastResult", out.summary);
    await store.setMeta("sync.log", out.log.slice(0, 80));
    await store.setMeta("sync.error", null);
    // Real compiler results committed by the PC companion
    try {
      const listing = await remote.list();
      if (listing[".vault/compile-results.json"]) {
        const res = JSON.parse(fromUtf8(await remote.read(".vault/compile-results.json")));
        const byPath = Object.fromEntries(Object.entries(out.manifest.entries).map(([id, e]) => [e.path, id]));
        for (const [path, id] of Object.entries(byPath)) {
          const it = store.items.get(id);
          if (!it || it.kind !== "script") continue;
          const diags = res.diagnostics.filter((d) => d.file === path).map((d) => ({ severity: d.severity === "error" ? "error" : "warning", source: "compiler", ruleID: d.id, message: d.message, line: d.line, column: d.column, suggestion: null }));
          store.updateItem(it, { compilerResult: JSON.stringify(diags), compiledAt: res.compiledAt }, { touch: false, silent: true });
        }
      }
    } catch { /* optional */ }
    if (!quiet) toast("Synchronisiert · " + out.summary);
    return out;
  } catch (e) {
    await store.setMeta("sync.error", e.message);
    if (!quiet) toast("Sync fehlgeschlagen: " + e.message);
    return null;
  } finally {
    runSync.busy = false;
    store.emit();
  }
}

// ---------------- workflow hub
export function workflowView() {
  const { root, content } = screen({ title: "PC & Claude", large: true });
  const configured = store.getMeta("github.owner") && store.getMeta("github.token");
  const last = store.getMeta("sync.lastDate");
  content.append(
    sectionHeader("iPhone ⇄ PC"),
    h("div.list.card-list",
      row("github", "var(--info)", "GitHub-Synchronisierung", configured ? `${store.getMeta("github.owner")}/${store.getMeta("github.repo")} · ${last ? "zuletzt " + relTime(last) : "noch nie"}` : "Zwei-Wege-Sync mit einem Repository – am PC git pull", () => go("#/sync")),
      configured ? h("div.row", { onclick: () => runSync() }, badge("refresh", "var(--accent)"), h("div.row-main", h("div.row-title", runSync.busy ? "Synchronisiere …" : "Jetzt synchronisieren"),
        h("div.row-sub.mono.small", store.getMeta("sync.error") ? "⚠︎ " + store.getMeta("sync.error") : store.getMeta("sync.lastResult", "")))) : ""),
    sectionHeader("Export & Import"),
    h("div.list.card-list",
      row("share", "var(--amber)", "Gesamten Vault exportieren", "ZIP mit Ordnerstruktur, .cs-Dateien, Markdown & Manifest", () => exportSheet({ title: "UnityVault" })),
      row("download", "var(--script)", "Importieren", ".cs, .md, .txt, Vault-ZIP oder Sicherung (.json)", () => importFiles(null)),
      row("seal", "var(--success)", "Komplette Sicherung", "Alles inkl. Versionen als JSON – zur Wiederherstellung", () => {
        const name = `UnityVault-Backup-${new Date().toISOString().slice(0, 10)}.json`;
        shareFiles([new File([JSON.stringify(store.backup())], name, { type: "application/json" })], name);
      })),
    h("p.hint.pad", "Einzelne Skripte, Ordner und Projekte exportierst du über ihr ⋯-Menü."),
    sectionHeader("Kompilierung"),
    h("div.list.card-list", row("hammer", "var(--error)", "PC-Compiler (Roslyn)", "Echte Kompilierung gegen deine Unity-Installation", () => go("#/compiler"))),
    sectionHeader("Claude"),
    h("div.list.card-list",
      row("wand", "var(--prompt)", "Claude Skill erzeugen", "Aus Ordnern ein Agent-Skill-Paket (SKILL.md) bauen", skillBuilder),
      row("note", "var(--info)", "Kontext-Paket aus Favoriten", "Alle Favoriten als ein Markdown-Dokument", () => import("./common.js").then((m) => m.claudeContextSheet(store.liveItems().filter((i) => i.isFavorite)))),
      row("desktop", "var(--accent)", "MCP-Server für Claude Code", "Claude durchsucht deinen Vault am PC", mcpSheet)));
  return { root, tab: "workflow" };
}

export function syncView() {
  const { root, content } = screen({ title: "GitHub-Sync", back: true });
  const f = (key, label, ph, def = "") => h("label.field-row", h("span.field-label", label), h("input.field.mono", { value: store.getMeta(key, def), placeholder: ph, autocapitalize: "off", autocorrect: "off", onchange: (e) => store.setMeta(key, e.target.value.trim()) }));
  const token = h("input.field.mono", { type: "password", placeholder: store.getMeta("github.token") ? "•••••••• (gespeichert)" : "github_pat_…", autocapitalize: "off", autocorrect: "off" });
  const log = store.getMeta("sync.log", []);
  content.append(
    h("div.card", h("p.muted", "Synchronisiert deinen Vault mit einem GitHub-Repository über die GitHub-API. Jede Synchronisierung wird ein Commit. Am PC: git clone / git pull – jedes Skript ist eine echte .cs-Datei in deiner Ordnerstruktur.")),
    h("div.form",
      f("github.owner", "Besitzer", "z. B. xMznster"), f("github.repo", "Repository", "z. B. unity-vault"), f("github.branch", "Branch", "main", "main"), f("github.dir", "Unterordner (optional)", "z. B. vault"),
      h("label.field-row", h("span.field-label", "Personal Access Token"), token),
      h("p.hint", "Fine-grained Token (github.com → Settings → Developer settings) mit „Contents: Read and write“ nur für dieses Repository. Er wird nur lokal in der App auf diesem iPhone gespeichert."),
      h("div.row-buttons",
        h("button.btn.secondary", { onclick: async () => { if (!token.value.trim()) return toast("Token eingeben"); await store.setMeta("github.token", token.value.trim()); token.value = ""; token.placeholder = "•••••••• (gespeichert)"; toast("Token gespeichert"); } }, icon("key", 16), "Token speichern"),
        h("button.btn", { disabled: runSync.busy, onclick: () => runSync() }, icon("refresh", 16), runSync.busy ? "Läuft …" : "Jetzt synchronisieren")),
      h("label.toggle-row", h("span", "Beim App-Start synchronisieren"), h("input", { type: "checkbox", checked: store.getMeta("sync.onLaunch", false), onchange: (e) => store.setMeta("sync.onLaunch", e.target.checked) })),
      store.getMeta("sync.lastDate") ? h("div.info-line", "Letzte Synchronisierung: ", h("b", dateTime(store.getMeta("sync.lastDate")))) : "",
      store.getMeta("sync.error") ? h("p.err", "⚠︎ " + store.getMeta("sync.error")) : "",
      store.getMeta("sync.lastResult") ? h("p.mono.small.muted", store.getMeta("sync.lastResult")) : ""),
    log.length ? [sectionHeader("Protokoll"), h("pre.preview-box", log.join("\n"))] : "",
    sectionHeader("So funktioniert es"),
    h("div.card", h("ul.bullets",
      h("li", "Zwei-Wege-Abgleich: Änderungen am iPhone und am PC werden zusammengeführt."),
      h("li", "Konflikte (beide Seiten geändert): beide Versionen bleiben erhalten – nichts wird überschrieben."),
      h("li", "Am PC gelöschte Dateien landen in der App im Papierkorb."),
      h("li", "Vor jeder Übernahme vom PC wird automatisch eine Version gesichert."),
      h("li", "Neu eingerichtetes Gerät: Inhalte werden aus dem Repository wiederhergestellt, nicht gelöscht."))));
  return { root, tab: "workflow" };
}

export function compilerView() {
  const { root, content } = screen({ title: "PC-Compiler", back: true });
  const url = h("input.field.mono", { value: store.getMeta("compiler.url", ""), placeholder: "https://mein-pc.tailnet.ts.net", autocapitalize: "off", autocorrect: "off", inputmode: "url", onchange: (e) => store.setMeta("compiler.url", e.target.value.trim()) });
  const token = h("input.field.mono", { type: "password", value: store.getMeta("compiler.token", ""), placeholder: "Zugriffsschlüssel (optional)", onchange: (e) => store.setMeta("compiler.token", e.target.value) });
  const status = h("p.small");
  content.append(
    h("div.form", h("label.field-row", h("span.field-label", "Adresse des PC-Companions"), url), h("label.field-row", h("span.field-label", "Schlüssel"), token),
      h("button.btn.secondary.wide", { onclick: async () => {
        status.textContent = "Teste …"; status.className = "small muted";
        try {
          const u = url.value.trim().replace(/\/+$/, "");
          if (location.protocol === "https:" && u.startsWith("http:")) throw new Error("HTTP wird von Safari in einer HTTPS-App blockiert – HTTPS-Adresse verwenden.");
          const r = await fetch(u + "/health", { headers: token.value ? { Authorization: `Bearer ${token.value}` } : {} });
          status.textContent = r.ok ? "✓ Verbunden: " + (await r.text()).slice(0, 160) : "HTTP " + r.status; status.className = r.ok ? "small ok" : "small err";
        } catch (e) { status.textContent = "Nicht erreichbar: " + e.message; status.className = "small err"; }
      } }, icon("desktop", 16), "Verbindung testen"), status),
    sectionHeader("Einrichtung"),
    h("div.card", h("ol.bullets",
      h("li", "Auf dem PC .NET 8 installieren, Repository klonen."),
      h("li", h("code", "dotnet run --project companion/VaultCompiler -c Release -- serve --token GEHEIM")),
      h("li", "Safari erlaubt aus dieser HTTPS-App nur HTTPS-Ziele. Am einfachsten mit Tailscale: ", h("code", "tailscale serve 5199"), " – die angezeigte https://…ts.net-Adresse oben eintragen."),
      h("li", "Ohne HTTPS: am PC ", h("code", "vault-compiler watch <Git-Klon des Vaults>"), " laufen lassen und die Ergebnisdatei committen – sie wird beim GitHub-Sync übernommen."))),
    sectionHeader("Warum nicht direkt auf dem iPhone?"),
    h("div.card", h("p.muted", "iOS/Safari kann keinen C#-Compiler mit den Unity-Assemblies ausführen (kein JIT, keine Unity-DLLs auf dem Gerät). Die App analysiert lokal Syntax, Struktur und Unity-Regeln; echte Compilerfehler (Typen, Methoden, Overloads) liefert Roslyn auf deinem PC.")));
  return { root, tab: "workflow" };
}

function mcpSheet() {
  const cmd = 'claude mcp add unity-vault -- node /pfad/zu/UnityOrganizator/companion/mcp-server/server.mjs "/pfad/zum/Vault-Klon"';
  sheet("MCP-Server für Claude Code", () => h("div.form",
    h("p.muted", "Der MCP-Server läuft auf deinem PC und liest den per GitHub synchronisierten Vault (git clone). Claude Code kann damit deine Skripte durchsuchen und lesen und deine Prompts als Slash-Befehle verwenden – ohne Cloud-Dienst."),
    h("pre.preview-box", cmd),
    h("button.btn.secondary.wide", { onclick: () => copyText(cmd, "Befehl kopiert") }, icon("copy", 16), "Befehl kopieren"),
    h("p.mono.small.muted", "Tools: vault_search, vault_get, vault_list, vault_project_tree, vault_outline · Prompts: jeder gespeicherte Prompt"),
    h("button.btn.secondary.wide", { onclick: () => copyText(CLAUDE_MD_SNIPPET, "CLAUDE.md-Abschnitt kopiert") }, icon("copy", 16), "CLAUDE.md-Abschnitt kopieren"),
    h("p.hint", "Eine direkte Verbindung vom iPhone zu Claude wird bewusst nicht vorgetäuscht. Die App liefert Daten in Formaten, die Claude heute versteht (Skills, Markdown, MCP über das Repository).")), { full: true });
}

function skillBuilder() {
  const st = { name: "", description: "", instructions: "", folders: new Set(), kinds: new Set(["note", "prompt", "script"]), onlyTested: false };
  const countEl = h("b", "0");
  const items = () => {
    const ids = new Set();
    for (const fid of st.folders) { ids.add(fid); for (const d of store.descendants(fid)) ids.add(d.id); }
    return store.liveItems().filter((i) => i.folderId && ids.has(i.folderId) && st.kinds.has(i.kind) && !(st.onlyTested && i.kind === "script" && i.status !== "tested"));
  };
  const update = () => { countEl.textContent = String(items().length); };
  const build = () => {
    if (!st.name.trim()) { toast("Bitte einen Namen eingeben"); return null; }
    const list = items();
    if (!list.length) { toast("Keine Einträge ausgewählt"); return null; }
    const files = skillFiles(st, list, store.snapshot());
    const z = new ZipWriter();
    for (const p of Object.keys(files).sort()) z.add(p, files[p]);
    return new File([z.toBytes()], normalizedSkillName(st.name) + ".zip", { type: "application/zip" });
  };
  sheet("Claude Skill erzeugen", () => {
    const folderList = h("div.list");
    const addFolder = (f, depth) => {
      folderList.append(h("label.toggle-row", { style: { paddingLeft: 4 + depth * 16 + "px" } }, h("span", f.name), h("input", { type: "checkbox", onchange: (e) => { e.target.checked ? st.folders.add(f.id) : st.folders.delete(f.id); update(); } })));
      for (const c of store.children(f.id)) addFolder(c, depth + 1);
    };
    for (const r of store.roots()) addFolder(r, 0);
    const nameHint = h("p.hint.mono");
    return h("div.form",
      h("input.field", { placeholder: "Name, z. B. Horror Enemy Patterns", oninput: (e) => { st.name = e.target.value; nameHint.textContent = st.name ? "Ordner: " + normalizedSkillName(st.name) : ""; } }), nameHint,
      h("textarea.field", { rows: 2, placeholder: "Wann soll Claude die Skill verwenden?", oninput: (e) => (st.description = e.target.value) }),
      h("textarea.field", { rows: 3, placeholder: "Eigene Anweisungen (optional)", oninput: (e) => (st.instructions = e.target.value) }),
      h("div.form-section", "Quellen"), store.roots().length ? folderList : h("p.muted", "Lege zuerst Ordner an."),
      h("div.form-section", "Inhalte"),
      ...Object.entries(KIND).map(([k, v]) => h("label.toggle-row", h("span", v.plural), h("input", { type: "checkbox", checked: true, onchange: (e) => { e.target.checked ? st.kinds.add(k) : st.kinds.delete(k); update(); } }))),
      h("label.toggle-row", h("span", "Nur getestete Skripte"), h("input", { type: "checkbox", onchange: (e) => { st.onlyTested = e.target.checked; update(); } })),
      h("div.info-line", "Ausgewählt: ", countEl, " Einträge"),
      h("div.row-buttons",
        h("button.btn", { onclick: () => { const f = build(); if (f) shareFiles([f], f.name); } }, icon("share", 16), "Teilen"),
        h("button.btn.secondary", { onclick: () => { const f = build(); if (f) download(f.name, f); } }, icon("download", 16), "Herunterladen")),
      h("p.hint", "Entpacken nach ~/.claude/skills/ (persönlich) oder .claude/skills/ im Unity-Projekt. Claude Code lädt die Skill automatisch, wenn die Beschreibung zur Aufgabe passt."));
  }, { full: true });
}

// ---------------- settings
export function settingsView() {
  const { root, content } = screen({ title: "Einstellungen", large: true });
  const sel = (key, label, options, def, onChange) => h("label.field-row.inline", h("span.field-label", label), h("select.field", { onchange: (e) => { store.setMeta(key, e.target.value); onChange?.(e.target.value); } },
    options.map(([v, l]) => h("option", { value: v, selected: store.getMeta(key, def) === v }, l))));
  const tog = (key, label, def) => h("label.toggle-row", h("span", label), h("input", { type: "checkbox", checked: store.getMeta(key, def), onchange: (e) => store.setMeta(key, e.target.checked) }));
  const num = (key, label, def, min, max) => h("label.field-row.inline", h("span.field-label", label), h("input.field.num", { type: "number", min, max, value: store.getMeta(key, def), onchange: (e) => store.setMeta(key, Math.max(min, Math.min(max, +e.target.value || def))) }));
  const items = store.liveItems();
  const scripts = items.filter((i) => i.kind === "script");
  const demo = h("pre.peek.big", { html: highlightCSharp("void Update()\n{\n    // Vorschau\n    transform.Rotate(0f, 90f * Time.deltaTime, 0f);\n}") });
  content.append(
    sectionHeader("Darstellung"),
    h("div.form", sel("appearance", "App-Design", [["dark", "Dunkel"], ["light", "Hell"], ["system", "System"]], "dark", (v) => applyTheme(v)),
      sel("editor.theme", "Editor-Theme", [["night", "Vault Night (dunkel)"], ["day", "Vault Day (hell)"]], "night")),
    sectionHeader("Code-Editor"),
    h("div.form", num("editor.fontSize", "Schriftgröße (pt)", 14, 10, 28), num("editor.tabWidth", "Einrückung (Leerzeichen)", 4, 2, 8), tog("editor.useTabs", "Tabs statt Leerzeichen", false),
      tog("editor.autoPair", "Klammern & Anführungszeichen automatisch schließen", true), tog("editor.lineNumbers", "Zeilennummern", true), tog("editor.liveAnalysis", "Live-Analyse beim Tippen", true), demo),
    sectionHeader("Unity"),
    h("div.form", h("label.field-row", h("span.field-label", "Standard-Unity-Version für neue Skripte"), h("input.field", { value: store.getMeta("defaultUnityVersion", ""), placeholder: "z. B. 6000.0 LTS", onchange: (e) => store.setMeta("defaultUnityVersion", e.target.value) }))),
    sectionHeader("Daten"),
    h("div.card", h("div.kv", h("span", "Skripte"), h("b", `${scripts.length} (${scripts.reduce((a, s) => a + s.content.split("\n").length, 0)} Zeilen)`)),
      h("div.kv", h("span", "Notizen"), h("b", String(items.filter((i) => i.kind === "note").length))),
      h("div.kv", h("span", "Prompts"), h("b", String(items.filter((i) => i.kind === "prompt").length))),
      h("div.kv", h("span", "Ordner"), h("b", `${store.folders.size} (${store.roots().length} Projekte)`)),
      h("div.kv", h("span", "Dauerhafter Speicher"), h("b", store.persisted ? "aktiv" : "vom Browser verwaltet")),
      h("p.hint", "Alle Inhalte liegen lokal auf diesem iPhone (IndexedDB) und sind offline verfügbar. Änderungen werden automatisch gespeichert. Tipp: regelmäßig synchronisieren oder eine Sicherung exportieren."),
      h("button.btn.secondary.wide", { onclick: () => go("#/trash") }, icon("trash", 16), "Papierkorb")),
    sectionHeader("Über"),
    h("div.card", h("div.kv", h("span", "App"), h("b", "Unity Developer Vault")), h("div.kv", h("span", "Version"), h("b", window.APP_VERSION || "1.0")),
      h("p.hint", "Web-App (PWA): zum Home-Bildschirm hinzufügen über Teilen → „Zum Home-Bildschirm“. Analyse-Engine, Suche, Export und Sync sind dieselben getesteten Module wie im Swift-Kern (VaultKit).")));
  return { root, tab: "settings" };
}

export function applyTheme(mode = store.getMeta("appearance", "dark")) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#090B0F" : "#F3F4F7");
}
