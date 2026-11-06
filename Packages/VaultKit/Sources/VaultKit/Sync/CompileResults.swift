import Foundation

/// Result format of the PC companion (`vault-compiler`): HTTP response of `POST /compile` and
/// content of `.vault/compile-results.json`.
public struct CompileResults: Codable, Sendable {
    public static let path = ".vault/compile-results.json"
    public var compiledAt: Date
    public var unityPath: String?
    public var success: Bool
    public var diagnostics: [Entry]

    public struct Entry: Codable, Sendable {
        public var file: String
        public var line: Int
        public var column: Int
        public var severity: String
        public var id: String
        public var message: String
    }

    /// Real compiler diagnostics grouped by file path.
    public var diagnosticsByFile: [String: [CodeDiagnostic]] {
        var out: [String: [CodeDiagnostic]] = [:]
        for e in diagnostics {
            let sev: DiagnosticSeverity = e.severity == "error" ? .error : (e.severity == "warning" ? .warning : .info)
            out[e.file, default: []].append(CodeDiagnostic(severity: sev, source: .compiler, ruleID: e.id, message: e.message, line: e.line, column: e.column))
        }
        return out
    }

    public static func decode(_ data: Data) throws -> CompileResults {
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return try dec.decode(CompileResults.self, from: data)
    }
}
