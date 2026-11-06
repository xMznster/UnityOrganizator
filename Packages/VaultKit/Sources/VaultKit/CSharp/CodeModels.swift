import Foundation

public enum DiagnosticSeverity: String, Codable, Sendable, CaseIterable, Comparable {
    case error, warning, info

    var rank: Int { self == .error ? 0 : (self == .warning ? 1 : 2) }
    public static func < (a: Self, b: Self) -> Bool { a.rank < b.rank }
}

/// Where a diagnostic came from. This is shown in the UI so the user always knows *what kind*
/// of check produced the finding (local heuristic vs. real compiler).
public enum DiagnosticSource: String, Codable, Sendable, CaseIterable {
    /// Lexical analysis (strings, comments, characters).
    case lexer
    /// Structural syntax analysis (brackets, statements, declarations).
    case syntax
    /// General C# semantic heuristics.
    case csharp
    /// Unity-specific rules.
    case unity
    /// A real compiler (Roslyn on the PC companion).
    case compiler

    public var displayName: String {
        switch self {
        case .lexer: return "Lexer"
        case .syntax: return "Syntax"
        case .csharp: return "C#-Analyse"
        case .unity: return "Unity-Regeln"
        case .compiler: return "Roslyn-Compiler"
        }
    }
}

public struct CodeDiagnostic: Codable, Sendable, Hashable, Identifiable {
    public var severity: DiagnosticSeverity
    public var source: DiagnosticSource
    public var ruleID: String
    public var message: String
    public var line: Int
    public var column: Int
    public var suggestion: String?

    public var id: String { "\(ruleID):\(line):\(column):\(message.hashValue)" }

    public init(severity: DiagnosticSeverity, source: DiagnosticSource, ruleID: String, message: String,
                line: Int, column: Int, suggestion: String? = nil) {
        self.severity = severity
        self.source = source
        self.ruleID = ruleID
        self.message = message
        self.line = line
        self.column = column
        self.suggestion = suggestion
    }
}

public enum TypeDeclKind: String, Codable, Sendable {
    case `class`, `struct`, interface, `enum`, record
}

public struct FieldOutline: Codable, Sendable, Hashable {
    public var name: String
    public var typeName: String
    public var line: Int
    public var modifiers: [String]
    public var attributes: [String]
}

public struct MethodOutline: Codable, Sendable, Hashable {
    public var name: String
    public var returnType: String
    public var parameterTypes: [String]
    public var line: Int
    public var modifiers: [String]
    /// Significant-token index range of the body (exclusive of braces), if any.
    public var bodyStart: Int
    public var bodyEnd: Int
    public var hasBody: Bool { bodyEnd > bodyStart || isBlockBody }
    public var isBlockBody: Bool
    public var isCoroutine: Bool { returnType == "IEnumerator" || returnType.hasSuffix(".IEnumerator") }
}

public struct TypeOutline: Codable, Sendable, Hashable {
    public var name: String
    public var kind: TypeDeclKind
    public var bases: [String]
    public var line: Int
    public var methods: [MethodOutline] = []
    public var fields: [FieldOutline] = []
    public var properties: [FieldOutline] = []
    public var nestingDepth: Int = 0
}

/// Classification of what a script is, from Unity's perspective.
public enum UnityScriptKind: String, Codable, Sendable, CaseIterable {
    case monoBehaviour = "MonoBehaviour"
    case scriptableObject = "ScriptableObject"
    case editorScript = "Editor-Skript"
    case stateMachineBehaviour = "StateMachineBehaviour"
    case interface = "Interface"
    case staticUtility = "Statische Utility"
    case dataStruct = "Struct / Daten"
    case enumeration = "Enum"
    case plainClass = "Reines C#"
    case empty = "Leer"
}

/// A single check category the analyzer ran, used for the transparent "what was checked" panel.
public struct AnalysisCheck: Codable, Sendable, Hashable {
    public var name: String
    public var detail: String
    public var performed: Bool
}

public struct AnalysisReport: Sendable {
    public var diagnostics: [CodeDiagnostic]
    public var types: [TypeOutline]
    public var usings: [String]
    public var declaredNamespaces: [String]
    public var scriptKind: UnityScriptKind
    public var suggestedCategories: [String]
    public var detectedComponents: [String]
    public var referencedTypes: [String]
    public var checks: [AnalysisCheck]
    public var lineCount: Int
    public var tokenCount: Int
    public var durationMs: Double

    public var errorCount: Int { diagnostics.filter { $0.severity == .error }.count }
    public var warningCount: Int { diagnostics.filter { $0.severity == .warning }.count }
    public var infoCount: Int { diagnostics.filter { $0.severity == .info }.count }
    public var declaredTypeNames: [String] { types.map(\.name) }
}
