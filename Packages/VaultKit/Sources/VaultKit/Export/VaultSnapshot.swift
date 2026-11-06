import Foundation

/// A persistence-independent copy of the vault, used for export, import and sync.
/// The app converts its SwiftData models into this snapshot (and applies results back).
public struct SnapshotFolder: Codable, Sendable, Hashable, Identifiable {
    public var id: UUID
    public var name: String
    public var parentID: UUID?
    public var isFavorite: Bool
    public var sortIndex: Int
    public var icon: String
    public var colorHex: String

    public init(id: UUID = UUID(), name: String, parentID: UUID? = nil, isFavorite: Bool = false,
                sortIndex: Int = 0, icon: String = "folder", colorHex: String = "") {
        self.id = id; self.name = name; self.parentID = parentID; self.isFavorite = isFavorite
        self.sortIndex = sortIndex; self.icon = icon; self.colorHex = colorHex
    }
}

public struct SnapshotItem: Codable, Sendable, Hashable, Identifiable {
    public var id: UUID
    public var kind: VaultItemKind
    public var title: String
    public var content: String
    public var summary: String
    public var category: String
    public var tags: [String]
    public var createdAt: Date
    public var modifiedAt: Date
    public var isFavorite: Bool
    public var folderID: UUID?
    // Script metadata
    public var unityVersion: String
    public var components: [String]
    public var dependencies: [String]
    public var projectName: String
    public var status: ScriptStatus?

    public init(id: UUID = UUID(), kind: VaultItemKind, title: String, content: String = "", summary: String = "",
                category: String = "", tags: [String] = [], createdAt: Date = Date(), modifiedAt: Date = Date(),
                isFavorite: Bool = false, folderID: UUID? = nil, unityVersion: String = "", components: [String] = [],
                dependencies: [String] = [], projectName: String = "", status: ScriptStatus? = nil) {
        self.id = id; self.kind = kind; self.title = title; self.content = content; self.summary = summary
        self.category = category; self.tags = tags; self.createdAt = createdAt; self.modifiedAt = modifiedAt
        self.isFavorite = isFavorite; self.folderID = folderID; self.unityVersion = unityVersion
        self.components = components; self.dependencies = dependencies; self.projectName = projectName; self.status = status
    }
}

public struct VaultSnapshot: Codable, Sendable {
    public var folders: [SnapshotFolder]
    public var items: [SnapshotItem]

    public init(folders: [SnapshotFolder], items: [SnapshotItem]) {
        self.folders = folders
        self.items = items
    }

    /// Folder names from the root down to (and including) `folderID`.
    public func path(of folderID: UUID?) -> [String] {
        var out: [String] = []
        var current = folderID
        var guardCount = 0
        let byID = Dictionary(uniqueKeysWithValues: folders.map { ($0.id, $0) })
        while let id = current, let f = byID[id], guardCount < 64 {
            out.insert(f.name, at: 0)
            current = f.parentID
            guardCount += 1
        }
        return out
    }

    /// IDs of `folderID` and all of its descendants.
    public func subtree(of folderID: UUID) -> Set<UUID> {
        var result: Set<UUID> = [folderID]
        var queue = [folderID]
        while let id = queue.popLast() {
            for f in folders where f.parentID == id && !result.contains(f.id) {
                result.insert(f.id); queue.append(f.id)
            }
        }
        return result
    }
}

// MARK: - File naming

public enum FileNaming {
    static let illegal = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters).union(.newlines)

    /// A safe file/folder name for Windows, macOS, Linux and Git.
    public static func safeName(_ raw: String, fallback: String = "Unbenannt") -> String {
        var s = raw.components(separatedBy: illegal).joined(separator: " ")
        s = s.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
        s = s.trimmingCharacters(in: CharacterSet(charactersIn: " ."))
        if s.count > 100 { s = String(s.prefix(100)).trimmingCharacters(in: .whitespaces) }
        let reserved: Set<String> = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "LPT1", "LPT2"]
        if reserved.contains(s.uppercased()) { s = "_" + s }
        return s.isEmpty ? fallback : s
    }

    /// File name (with extension) for an item.
    public static func fileName(for item: SnapshotItem, promptsAsText: Bool = false) -> String {
        switch item.kind {
        case .script:
            let t = item.title.trimmingCharacters(in: .whitespaces)
            let base = t.hasSuffix(".cs") ? String(t.dropLast(3)) : t
            let isIdentifier = !base.isEmpty && base.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") } && !(base.first?.isNumber ?? true)
            return (isIdentifier ? base : TextUtil.csharpIdentifier(from: base)) + ".cs"
        case .prompt:
            return safeName(item.title) + (promptsAsText ? ".txt" : ".md")
        case .note:
            return safeName(item.title) + ".md"
        }
    }
}

// MARK: - Front matter & codec

public enum FileCodec {

    public struct Options: Sendable {
        /// Write YAML front matter with metadata into Markdown files.
        public var frontMatter: Bool = true
        /// Export prompts as plain .txt instead of Markdown.
        public var promptsAsText: Bool = false
        public init(frontMatter: Bool = true, promptsAsText: Bool = false) {
            self.frontMatter = frontMatter; self.promptsAsText = promptsAsText
        }
    }

    static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func yamlString(_ s: String) -> String {
        var out = "\""
        for ch in s.unicodeScalars {
            switch ch {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default: out.unicodeScalars.append(ch)
            }
        }
        return out + "\""
    }

    /// Renders an item to file bytes. C# scripts are written byte-for-byte as stored.
    public static func render(_ item: SnapshotItem, options: Options = Options()) -> Data {
        switch item.kind {
        case .script:
            return Data(item.content.utf8)
        case .prompt where options.promptsAsText:
            return Data(item.content.utf8)
        case .note, .prompt:
            guard options.frontMatter else { return Data(item.content.utf8) }
            var fm = "---\n"
            fm += "title: \(yamlString(item.title))\n"
            fm += "kind: \(item.kind.rawValue)\n"
            if !item.category.isEmpty { fm += "category: \(yamlString(item.category))\n" }
            if !item.tags.isEmpty { fm += "tags: [\(item.tags.map(yamlString).joined(separator: ", "))]\n" }
            if !item.summary.isEmpty { fm += "summary: \(yamlString(item.summary))\n" }
            if item.isFavorite { fm += "favorite: true\n" }
            fm += "created: \(iso.string(from: item.createdAt))\n"
            fm += "id: \(item.id.uuidString)\n"
            fm += "---\n\n"
            return Data((fm + item.content).utf8)
        }
    }

    public struct FrontMatter: Sendable {
        public var values: [String: String] = [:]
        public var lists: [String: [String]] = [:]
    }

    /// Splits a Markdown document into front matter and body.
    public static func splitFrontMatter(_ text: String) -> (FrontMatter?, String) {
        let normalized = text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
        guard normalized.hasPrefix("---\n") || normalized.hasPrefix("---\r\n") else { return (nil, text) }
        let lines = normalized.components(separatedBy: "\n")
        var fm = FrontMatter()
        var end = -1
        var currentListKey: String? = nil
        for i in 1..<lines.count {
            let line = lines[i].trimmingCharacters(in: CharacterSet(charactersIn: "\r"))
            if line == "---" || line == "..." { end = i; break }
            if line.hasPrefix("  - ") || line.hasPrefix("- "), let key = currentListKey {
                let v = line.trimmingCharacters(in: .whitespaces).dropFirst(2)
                fm.lists[key, default: []].append(unquote(String(v)))
                continue
            }
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            if value.isEmpty { currentListKey = key; continue }
            currentListKey = nil
            if value.hasPrefix("[") && value.hasSuffix("]") {
                fm.lists[key] = splitInlineList(String(value.dropFirst().dropLast()))
            } else {
                fm.values[key] = unquote(value)
            }
        }
        guard end > 0 else { return (nil, text) }
        var body = lines[(end + 1)...].joined(separator: "\n")
        // Remove the single blank separator line written by `render`.
        if body.hasPrefix("\n") { body.removeFirst() } else if body.hasPrefix("\r\n") { body.removeFirst(2) }
        return (fm, body)
    }

    static func splitInlineList(_ s: String) -> [String] {
        var items: [String] = []
        var current = ""
        var inQuote = false
        var escape = false
        for ch in s {
            if escape { current.append(ch); escape = false; continue }
            if ch == "\\" && inQuote { current.append(ch); escape = true; continue }
            if ch == "\"" { inQuote.toggle(); current.append(ch); continue }
            if ch == "," && !inQuote { items.append(unquote(current.trimmingCharacters(in: .whitespaces))); current = ""; continue }
            current.append(ch)
        }
        let last = current.trimmingCharacters(in: .whitespaces)
        if !last.isEmpty { items.append(unquote(last)) }
        return items.filter { !$0.isEmpty }
    }

    static func unquote(_ s: String) -> String {
        let t = s.trimmingCharacters(in: .whitespaces)
        if t.count >= 2 && t.hasPrefix("'") && t.hasSuffix("'") { return String(t.dropFirst().dropLast()).replacingOccurrences(of: "''", with: "'") }
        guard t.count >= 2, t.hasPrefix("\""), t.hasSuffix("\"") else { return t }
        var out = ""
        var escape = false
        for ch in t.dropFirst().dropLast() {
            if escape {
                switch ch {
                case "n": out.append("\n")
                case "r": out.append("\r")
                case "t": out.append("\t")
                default: out.append(ch)
                }
                escape = false
            } else if ch == "\\" { escape = true } else { out.append(ch) }
        }
        return out
    }

    /// Parses file bytes back into an item. `existing` provides metadata that is not stored in the file
    /// (e.g. script status) and the identity.
    public static func parse(path: String, data: Data, existing: SnapshotItem?, now: Date = Date()) -> SnapshotItem {
        let fileName = (path as NSString).lastPathComponent
        let ext = (fileName as NSString).pathExtension.lowercased()
        let base = (fileName as NSString).deletingPathExtension
        let text = String(decoding: data, as: UTF8.self)
        var item = existing ?? SnapshotItem(kind: ext == "cs" ? .script : .note, title: base, createdAt: now, modifiedAt: now)
        item.modifiedAt = now
        switch ext {
        case "cs":
            item.kind = .script
            item.content = text
            item.title = base
            if item.status == nil { item.status = .inDevelopment }
        case "md", "markdown":
            let (fm, body) = splitFrontMatter(text)
            item.content = body
            if let fm {
                if let t = fm.values["title"], !t.isEmpty { item.title = t } else if existing == nil { item.title = base }
                if let k = fm.values["kind"], let kind = VaultItemKind(rawValue: k), kind != .script { item.kind = kind }
                if let c = fm.values["category"] { item.category = c }
                if let s = fm.values["summary"] ?? fm.values["description"] { item.summary = s }
                if let tags = fm.lists["tags"] { item.tags = tags.map(TextUtil.normalizeTag).filter { !$0.isEmpty } }
                else if let tagStr = fm.values["tags"] { item.tags = TextUtil.parseTags(tagStr) }
                if let fav = fm.values["favorite"] { item.isFavorite = fav == "true" }
                if existing == nil, let c = fm.values["created"], let d = iso.date(from: c) { item.createdAt = d }
            } else {
                if existing == nil || existing?.kind == .script { item.kind = .note }
                if existing == nil { item.title = MarkdownParser.suggestedTitle(body).map { $0 == base ? $0 : base } ?? base }
            }
        default: // txt and others
            item.content = text
            if existing == nil { item.title = base; item.kind = .note }
        }
        return item
    }

    public static let syncedExtensions: Set<String> = ["cs", "md", "markdown", "txt"]
}
