import Foundation

/// The kind of a vault item. Shared between the app's persistence layer and VaultKit.
public enum VaultItemKind: String, Codable, CaseIterable, Sendable, Identifiable {
    case note
    case prompt
    case script

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .note: return "Notiz"
        case .prompt: return "Prompt"
        case .script: return "C#-Skript"
        }
    }
    public var pluralName: String {
        switch self {
        case .note: return "Notizen & Ideen"
        case .prompt: return "Prompts"
        case .script: return "Skripte"
        }
    }
    public var symbol: String {
        switch self {
        case .note: return "doc.text"
        case .prompt: return "sparkles"
        case .script: return "chevron.left.forwardslash.chevron.right"
        }
    }
    /// Default file extension when exporting.
    public var fileExtension: String {
        switch self {
        case .note, .prompt: return "md"
        case .script: return "cs"
        }
    }
}

public enum ScriptStatus: String, Codable, CaseIterable, Sendable, Identifiable {
    case experimental
    case inDevelopment
    case tested

    public var id: String { rawValue }
    public var displayName: String {
        switch self {
        case .experimental: return "Experimentell"
        case .inDevelopment: return "In Entwicklung"
        case .tested: return "Getestet"
        }
    }
    public var symbol: String {
        switch self {
        case .experimental: return "flask"
        case .inDevelopment: return "hammer"
        case .tested: return "checkmark.seal"
        }
    }
}

/// Default category suggestions per kind. Categories are free text – these are only offered as quick picks.
public enum CategoryPresets {
    public static let note = ["Spielidee", "Mechanik", "Konzept", "Story", "Level Design", "Technik", "Tutorial", "Recherche", "To-do"]
    public static let prompt = ["Code generieren", "Refactoring", "Debugging", "Shader", "Konzept", "Review", "Claude Code"]
    public static let script = ["Player Controller", "Enemy AI", "Interactions", "Animation", "Physics", "UI", "Audio",
                                "Camera", "Combat System", "Input System", "Save System", "Editor Tool", "Utilities",
                                "Data / ScriptableObject", "Events", "Coroutines", "Rendering", "Scene Management", "Interfaces"]
}

public enum TextUtil {
    /// Normalises a free-text tag: trims, removes leading '#', collapses whitespace.
    public static func normalizeTag(_ raw: String) -> String {
        var t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while t.hasPrefix("#") { t.removeFirst() }
        return t.split(whereSeparator: { $0.isWhitespace }).joined(separator: "-")
    }

    /// Parses a comma/space separated tag string.
    public static func parseTags(_ raw: String) -> [String] {
        var seen = Set<String>()
        return raw.split(whereSeparator: { $0 == "," || $0 == ";" || $0 == "\n" })
            .map { normalizeTag(String($0)) }
            .filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
    }

    /// Splits camelCase / PascalCase / snake_case identifiers into lowercase words.
    public static func identifierWords(_ s: String) -> [String] {
        var words: [String] = []
        var current = ""
        var prevLower = false
        for ch in s {
            if ch == "_" || ch == "-" || ch == " " || ch == "." {
                if !current.isEmpty { words.append(current.lowercased()); current = "" }
                prevLower = false
                continue
            }
            if ch.isUppercase && prevLower && !current.isEmpty {
                words.append(current.lowercased()); current = ""
            }
            current.append(ch)
            prevLower = ch.isLowercase || ch.isNumber
        }
        if !current.isEmpty { words.append(current.lowercased()) }
        return words
    }

    /// Converts arbitrary text to a valid C# identifier (PascalCase), e.g. "spider leg animator" -> "SpiderLegAnimator".
    public static func csharpIdentifier(from s: String) -> String {
        let parts = s.split(whereSeparator: { !($0.isLetter || $0.isNumber || $0 == "_") })
        var id = parts.map { p -> String in
            let str = String(p)
            return str.prefix(1).uppercased() + str.dropFirst()
        }.joined()
        if id.isEmpty { id = "NewScript" }
        if let f = id.first, f.isNumber { id = "_" + id }
        // ASCII only for Unity file names
        id = String(id.unicodeScalars.filter { $0.isASCII }.map(Character.init))
        return id.isEmpty ? "NewScript" : id
    }
}
