// Claude artefacts: Agent Skills and context bundles (port of ClaudeBridge.swift). No network.
import { fileName, folderPath, uniquePath, utf8 } from "./files.js";
import { analyze } from "./analyzer.js";
import { identifierWords } from "./search.js";

const KIND_NAME = { note: "Notiz", prompt: "Prompt", script: "C#-Skript" };
const STATUS_NAME = { experimental: "Experimentell", inDevelopment: "In Entwicklung", tested: "Getestet" };

export function normalizedSkillName(raw) {
  let s = identifierWords(raw).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (s || "unity-vault-skill").slice(0, 64);
}

/** returns {path: Uint8Array} */
export function skillFiles({ name, description, instructions }, items, snapshot) {
  const n = normalizedSkillName(name);
  const files = {}, refs = [], used = new Set();
  for (const it of [...items].sort((a, b) => a.title.localeCompare(b.title))) {
    const dir = it.kind === "script" ? "scripts" : it.kind === "prompt" ? "prompts" : "reference";
    const f = uniquePath(`${dir}/${fileName(it)}`, used);
    used.add(f.toLowerCase());
    files[`${n}/${f}`] = utf8(it.content);
    const details = [];
    if (it.summary) details.push(it.summary.replace(/\n/g, " "));
    if (it.kind === "script") {
      const r = analyze(it.content, { fileName: it.title });
      const ti = r.types.filter((t) => t.nestingDepth === 0).map((t) => (t.bases.length ? `${t.name} : ${t.bases.join(", ")}` : t.name));
      if (ti.length) details.push("Typen: " + ti.join("; "));
      if (it.status) details.push("Status: " + (STATUS_NAME[it.status] || it.status));
      if (it.unityVersion) details.push("Unity " + it.unityVersion);
    }
    const folder = folderPath(snapshot.folders, it.folderId).join(" / ");
    if (folder) details.push("Ordner: " + folder);
    if (it.tags?.length) details.push("Tags: " + it.tags.join(", "));
    refs.push(`- [\`${f}\`](${encodeURI(f)})${details.length ? " — " + details.join(" · ") : ""}`);
  }
  let desc = (description || "").replace(/\n/g, " ").trim() || "Referenzmaterial aus dem Unity Developer Vault. Verwenden, wenn an Unity-Skripten gearbeitet wird, die zu diesen Themen passen.";
  if (desc.length > 1024) desc = desc.slice(0, 1021) + "...";
  let md = `---\nname: ${n}\ndescription: ${JSON.stringify(desc)}\n---\n\n# ${name}\n\n`;
  if ((instructions || "").trim()) md += instructions.trim() + "\n\n";
  else md += "Diese Skill bündelt erprobte Skripte, Prompts und Notizen aus meinem Unity Developer Vault.\n\n## Vorgehen\n\n1. Lies zuerst die passenden Dateien unten, bevor du neuen Code schreibst.\n2. Übernimm Namenskonventionen, Architektur und Muster aus `scripts/`.\n3. Skripte mit Status *Getestet* sind die bevorzugte Referenz; *Experimentell* nur als Ideenquelle.\n4. Unity verlangt: Dateiname == Klassenname für MonoBehaviours/ScriptableObjects.\n\n";
  md += `## Inhalte (${items.length})\n\n${refs.join("\n")}\n`;
  files[`${n}/SKILL.md`] = utf8(md);
  return files;
}

export function contextBundle(items, snapshot, task = "") {
  let md = "# Kontext aus meinem Unity Developer Vault\n\n";
  if (task.trim()) md += `## Aufgabe\n\n${task.trim()}\n\n`;
  md += `Die folgenden ${items.length} Einträge dienen als Referenz.\n\n`;
  for (const it of items) {
    md += `---\n\n## ${KIND_NAME[it.kind]}: ${it.title}\n\n`;
    const meta = [];
    const folder = folderPath(snapshot.folders, it.folderId).join(" / ");
    if (folder) meta.push("Ordner: " + folder);
    if (it.category) meta.push("Kategorie: " + it.category);
    if (it.tags?.length) meta.push("Tags: " + it.tags.join(", "));
    if (it.kind === "script" && it.status) meta.push("Status: " + (STATUS_NAME[it.status] || it.status));
    if (it.unityVersion) meta.push("Unity: " + it.unityVersion);
    if (meta.length) md += `_${meta.join(" · ")}_\n\n`;
    if (it.summary) md += `> ${it.summary}\n\n`;
    md += it.kind === "script" ? "```csharp\n" + it.content + "\n```\n\n" : it.content + "\n\n";
  }
  return md;
}

export const CLAUDE_MD_SNIPPET = `## Unity Developer Vault

Über den MCP-Server \`unity-vault\` ist meine persönliche Wissenssammlung verfügbar
(Skripte, Prompts, Notizen). Bevor du neue Unity-Systeme schreibst:

1. \`vault_search\` mit passenden Begriffen aufrufen (z. B. "enemy ai navmesh").
2. Relevante Treffer mit \`vault_get\` lesen und deren Muster übernehmen.
3. Gespeicherte Prompts stehen als MCP-Prompts (\`/mcp__unity-vault__…\`) zur Verfügung.
`;
