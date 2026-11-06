import Foundation

/// Generates artefacts that Claude / Claude Code can consume directly. Nothing here talks to a
/// network service – the outputs are files (Agent Skills, context bundles, CLAUDE.md snippets)
/// that work with Claude Code today. Live access to the vault is provided by the MCP server in
/// `companion/mcp-server`, which reads the synced vault folder on the PC.
public enum ClaudeBridge {

    public struct SkillSpec: Sendable {
        /// lowercase-hyphenated skill name (validated with `normalizedSkillName`).
        public var name: String
        /// What the skill does and when Claude should use it (shown to Claude for triggering).
        public var description: String
        /// Optional extra instructions written by the user.
        public var instructions: String
        public init(name: String, description: String, instructions: String = "") {
            self.name = name; self.description = description; self.instructions = instructions
        }
    }

    /// Agent Skill names must be lowercase letters, digits and hyphens (max 64 chars).
    public static func normalizedSkillName(_ raw: String) -> String {
        let words = TextUtil.identifierWords(raw).joined(separator: "-")
        var s = String(words.lowercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) && $0.isASCII || $0 == "-" }.map(Character.init))
        while s.contains("--") { s = s.replacingOccurrences(of: "--", with: "-") }
        s = s.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        if s.isEmpty { s = "unity-vault-skill" }
        return String(s.prefix(64))
    }

    /// Builds a Claude Agent Skill directory (`<name>/SKILL.md` + `reference/…`) from vault items.
    /// Returns relative paths → file contents.
    public static func skillFiles(spec: SkillSpec, items: [SnapshotItem], snapshot: VaultSnapshot) -> [String: Data] {
        let name = normalizedSkillName(spec.name)
        var files: [String: Data] = [:]
        var refLines: [String] = []
        var usedNames = Set<String>()
        for item in items.sorted(by: { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }) {
            let dir: String
            switch item.kind {
            case .script: dir = "scripts"
            case .prompt: dir = "prompts"
            case .note: dir = "reference"
            }
            var file = "\(dir)/" + FileNaming.fileName(for: item)
            file = ZipWriter.uniquePath(file, used: usedNames)
            usedNames.insert(file.lowercased())
            let data: Data = item.kind == .script ? Data(item.content.utf8) : Data(item.content.utf8)
            files["\(name)/\(file)"] = data
            var line = "- [`\(file)`](\(file.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? file))"
            let folder = snapshot.path(of: item.folderID).joined(separator: " / ")
            var details: [String] = []
            if !item.summary.isEmpty { details.append(item.summary.replacingOccurrences(of: "\n", with: " ")) }
            if item.kind == .script {
                let report = CSharpAnalyzer().analyze(item.content, options: .init(fileName: item.title))
                let typeInfo = report.types.filter { $0.nestingDepth == 0 }.map { t in
                    t.bases.isEmpty ? t.name : "\(t.name) : \(t.bases.joined(separator: ", "))"
                }
                if !typeInfo.isEmpty { details.append("Typen: " + typeInfo.joined(separator: "; ")) }
                if let st = item.status { details.append("Status: \(st.displayName)") }
                if !item.unityVersion.isEmpty { details.append("Unity \(item.unityVersion)") }
            }
            if !folder.isEmpty { details.append("Ordner: \(folder)") }
            if !item.tags.isEmpty { details.append("Tags: " + item.tags.joined(separator: ", ")) }
            if !details.isEmpty { line += " — " + details.joined(separator: " · ") }
            refLines.append(line)
        }
        var desc = spec.description.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        if desc.isEmpty { desc = "Referenzmaterial aus dem Unity Developer Vault. Verwenden, wenn an Unity-Skripten gearbeitet wird, die zu diesen Themen passen." }
        if desc.count > 1024 { desc = String(desc.prefix(1021)) + "..." }
        var md = "---\nname: \(name)\ndescription: \(FileCodec.yamlString(desc))\n---\n\n"
        md += "# \(spec.name)\n\n"
        if !spec.instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            md += spec.instructions.trimmingCharacters(in: .whitespacesAndNewlines) + "\n\n"
        } else {
            md += "Diese Skill bündelt erprobte Skripte, Prompts und Notizen aus meinem Unity Developer Vault.\n\n"
            md += "## Vorgehen\n\n"
            md += "1. Lies zuerst die passenden Dateien unten, bevor du neuen Code schreibst.\n"
            md += "2. Übernimm Namenskonventionen, Architektur und Muster aus `scripts/`.\n"
            md += "3. Skripte mit Status *Getestet* sind die bevorzugte Referenz; *Experimentell* nur als Ideenquelle.\n"
            md += "4. Unity verlangt: Dateiname == Klassenname für MonoBehaviours/ScriptableObjects.\n\n"
        }
        md += "## Inhalte (\(items.count))\n\n" + refLines.joined(separator: "\n") + "\n"
        files["\(name)/SKILL.md"] = Data(md.utf8)
        return files
    }

    /// A single Markdown document with the selected items, ready to paste into a Claude chat
    /// or to save as a context file for Claude Code.
    public static func contextBundle(items: [SnapshotItem], snapshot: VaultSnapshot, task: String = "") -> String {
        var md = "# Kontext aus meinem Unity Developer Vault\n\n"
        if !task.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            md += "## Aufgabe\n\n\(task.trimmingCharacters(in: .whitespacesAndNewlines))\n\n"
        }
        md += "Die folgenden \(items.count) Einträge dienen als Referenz.\n\n"
        for item in items {
            let folder = snapshot.path(of: item.folderID).joined(separator: " / ")
            md += "---\n\n## \(item.kind.displayName): \(item.title)\n\n"
            var meta: [String] = []
            if !folder.isEmpty { meta.append("Ordner: \(folder)") }
            if !item.category.isEmpty { meta.append("Kategorie: \(item.category)") }
            if !item.tags.isEmpty { meta.append("Tags: \(item.tags.joined(separator: ", "))") }
            if let s = item.status, item.kind == .script { meta.append("Status: \(s.displayName)") }
            if !item.unityVersion.isEmpty { meta.append("Unity: \(item.unityVersion)") }
            if !meta.isEmpty { md += "_" + meta.joined(separator: " · ") + "_\n\n" }
            if !item.summary.isEmpty { md += "> \(item.summary)\n\n" }
            if item.kind == .script {
                md += "```csharp\n\(item.content)\n```\n\n"
            } else {
                md += item.content + "\n\n"
            }
        }
        return md
    }

    /// Snippet for a project's CLAUDE.md that tells Claude Code how to use the vault MCP server.
    public static func claudeMDSnippet(serverName: String = "unity-vault") -> String {
        """
        ## Unity Developer Vault

        Über den MCP-Server `\(serverName)` ist meine persönliche Wissenssammlung verfügbar
        (Skripte, Prompts, Notizen). Bevor du neue Unity-Systeme schreibst:

        1. `vault_search` mit passenden Begriffen aufrufen (z. B. "enemy ai navmesh").
        2. Relevante Treffer mit `vault_get` lesen und deren Muster übernehmen.
        3. Gespeicherte Prompts stehen als MCP-Prompts (`/mcp__\(serverName)__…`) zur Verfügung.
        """
    }
}
