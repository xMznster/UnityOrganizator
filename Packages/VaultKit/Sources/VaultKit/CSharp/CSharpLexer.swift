import Foundation

/// Token categories produced by `CSharpLexer`.
public enum CSharpTokenKind: String, Sendable, Codable {
    case keyword
    case contextualKeyword
    case identifier
    case typeName
    case methodName
    case number
    case string
    case char
    case comment
    case docComment
    case preprocessor
    case punctuation
    case `operator`
    case attribute
    case whitespace
    case invalid
}

/// A lexical token. Ranges are expressed in UTF-16 code units so they map 1:1 onto `NSRange`
/// (which is what UIKit / TextKit use).
public struct CSharpToken: Sendable, Equatable {
    public var kind: CSharpTokenKind
    public var location: Int
    public var length: Int
    /// 1-based line number of the token start.
    public var line: Int
    /// 1-based column (UTF-16 units) of the token start.
    public var column: Int
    /// The token text (only populated for non-trivia tokens to save memory).
    public var text: String

    public var end: Int { location + length }
    public var range: NSRange { NSRange(location: location, length: length) }

    public var isTrivia: Bool {
        switch kind {
        case .whitespace, .comment, .docComment, .preprocessor: return true
        default: return false
        }
    }
}

/// A problem found while lexing (e.g. an unterminated string).
public struct LexicalIssue: Sendable, Equatable {
    public var message: String
    public var location: Int
    public var line: Int
    public var column: Int
    public var ruleID: String
}

public struct CSharpLexResult: Sendable {
    public var tokens: [CSharpToken]
    public var issues: [LexicalIssue]
    /// UTF-16 offsets of line starts (index 0 = line 1).
    public var lineStarts: [Int]

    /// Tokens that are not whitespace/comments/preprocessor directives.
    public var significantTokens: [CSharpToken] { tokens.filter { !$0.isTrivia } }

    public func line(forOffset offset: Int) -> Int {
        var lo = 0, hi = lineStarts.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if lineStarts[mid] <= offset { lo = mid } else { hi = mid - 1 }
        }
        return lo + 1
    }
}

/// A fast, allocation-light C# lexer that works on UTF-16 code units.
///
/// It understands everything a C# 11 / Unity script can contain: verbatim, interpolated and raw
/// string literals, char literals, numeric literals with suffixes, nested generic brackets,
/// doc comments, preprocessor directives and attributes.
public struct CSharpLexer {
    public static let keywords: Set<String> = [
        "abstract", "as", "base", "bool", "break", "byte", "case", "catch", "char", "checked",
        "class", "const", "continue", "decimal", "default", "delegate", "do", "double", "else",
        "enum", "event", "explicit", "extern", "false", "finally", "fixed", "float", "for",
        "foreach", "goto", "if", "implicit", "in", "int", "interface", "internal", "is", "lock",
        "long", "namespace", "new", "null", "object", "operator", "out", "override", "params",
        "private", "protected", "public", "readonly", "ref", "return", "sbyte", "sealed",
        "short", "sizeof", "stackalloc", "static", "string", "struct", "switch", "this", "throw",
        "true", "try", "typeof", "uint", "ulong", "unchecked", "unsafe", "ushort", "using",
        "virtual", "void", "volatile", "while"
    ]

    public static let contextualKeywords: Set<String> = [
        "add", "and", "alias", "ascending", "async", "await", "by", "descending", "dynamic",
        "equals", "file", "from", "get", "global", "group", "init", "into", "join", "let",
        "managed", "nameof", "nint", "not", "notnull", "nuint", "on", "or", "orderby", "partial",
        "record", "remove", "required", "scoped", "select", "set", "unmanaged", "value", "var",
        "when", "where", "with", "yield"
    ]

    public static let builtinTypeKeywords: Set<String> = [
        "bool", "byte", "char", "decimal", "double", "float", "int", "long", "object", "sbyte",
        "short", "string", "uint", "ulong", "ushort", "void", "var", "dynamic", "nint", "nuint"
    ]

    public init() {}

    // MARK: - Character helpers

    @inline(__always) static func isIdentStart(_ c: UInt16) -> Bool {
        (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c == 95 || c > 127
    }
    @inline(__always) static func isIdentPart(_ c: UInt16) -> Bool {
        isIdentStart(c) || (c >= 48 && c <= 57)
    }
    @inline(__always) static func isDigit(_ c: UInt16) -> Bool { c >= 48 && c <= 57 }
    @inline(__always) static func isHex(_ c: UInt16) -> Bool {
        isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
    }
    @inline(__always) static func isWhitespace(_ c: UInt16) -> Bool {
        c == 32 || c == 9 || c == 10 || c == 13 || c == 11 || c == 12 || c == 0xA0 || c == 0xFEFF
    }

    // MARK: - Lexing

    public func lex(_ source: String) -> CSharpLexResult {
        let u = Array(source.utf16)
        return lex(utf16: u)
    }

    public func lex(utf16 u: [UInt16]) -> CSharpLexResult {
        var tokens: [CSharpToken] = []
        tokens.reserveCapacity(u.count / 4)
        var issues: [LexicalIssue] = []
        var lineStarts: [Int] = [0]
        let n = u.count
        var i = 0
        var line = 1
        var lineStart = 0
        var atLineStart = true // only whitespace seen since last newline (for preprocessor)

        func text(_ a: Int, _ b: Int) -> String {
            String(decoding: u[a..<b], as: UTF16.self)
        }

        // Advances over a newline at index `j`, updating bookkeeping. Returns new index.
        func noteNewlines(from a: Int, to b: Int) {
            var k = a
            while k < b {
                let c = u[k]
                if c == 10 {
                    line += 1; lineStart = k + 1; lineStarts.append(k + 1)
                } else if c == 13 {
                    if k + 1 < b && u[k + 1] == 10 { k += 1 }
                    line += 1; lineStart = k + 1; lineStarts.append(k + 1)
                }
                k += 1
            }
        }

        func push(_ kind: CSharpTokenKind, _ start: Int, _ end: Int, startLine: Int, startCol: Int, keepText: Bool = true) {
            tokens.append(CSharpToken(kind: kind, location: start, length: end - start,
                                      line: startLine, column: startCol,
                                      text: keepText ? text(start, end) : ""))
        }

        while i < n {
            let c = u[i]
            let start = i
            let startLine = line
            let startCol = i - lineStart + 1

            // Whitespace
            if CSharpLexer.isWhitespace(c) {
                var j = i
                var sawNewline = false
                while j < n && CSharpLexer.isWhitespace(u[j]) {
                    if u[j] == 10 || u[j] == 13 { sawNewline = true }
                    j += 1
                }
                noteNewlines(from: i, to: j)
                push(.whitespace, start, j, startLine: startLine, startCol: startCol, keepText: false)
                if sawNewline { atLineStart = true }
                i = j
                continue
            }

            // Preprocessor directive
            if c == 35 /* # */ && atLineStart {
                var j = i
                while j < n && u[j] != 10 && u[j] != 13 { j += 1 }
                push(.preprocessor, start, j, startLine: startLine, startCol: startCol)
                i = j
                continue
            }
            atLineStart = false

            // Comments
            if c == 47 /* / */ && i + 1 < n {
                if u[i + 1] == 47 {
                    var j = i
                    while j < n && u[j] != 10 && u[j] != 13 { j += 1 }
                    let isDoc = i + 2 < n && u[i + 2] == 47 && !(i + 3 < n && u[i + 3] == 47)
                    push(isDoc ? .docComment : .comment, start, j, startLine: startLine, startCol: startCol, keepText: false)
                    i = j
                    continue
                }
                if u[i + 1] == 42 {
                    var j = i + 2
                    var closed = false
                    while j < n {
                        if u[j] == 42 && j + 1 < n && u[j + 1] == 47 { j += 2; closed = true; break }
                        j += 1
                    }
                    if !closed {
                        issues.append(LexicalIssue(message: "Block-Kommentar wird nicht geschlossen (*/ fehlt).",
                                                   location: start, line: startLine, column: startCol, ruleID: "LEX003"))
                    }
                    let isDoc = i + 2 < n && u[i + 2] == 42 && !(i + 3 < n && u[i + 3] == 47)
                    noteNewlines(from: i, to: j)
                    push(isDoc ? .docComment : .comment, start, j, startLine: startLine, startCol: startCol, keepText: false)
                    i = j
                    continue
                }
            }

            // String literal prefixes: @"..", $"..", $@"..", @$"..", raw """..."""
            if c == 34 || ((c == 64 || c == 36) && i + 1 < n) {
                var j = i
                var verbatim = false
                var interpolated = false
                var dollarCount = 0
                while j < n && (u[j] == 64 || u[j] == 36) && j - i < 6 {
                    if u[j] == 64 { verbatim = true } else { interpolated = true; dollarCount += 1 }
                    j += 1
                }
                if j < n && u[j] == 34 {
                    let end = lexString(u, from: j, verbatim: verbatim, interpolated: interpolated,
                                        dollarCount: max(1, dollarCount), issues: &issues,
                                        line: startLine, column: startCol, start: start)
                    noteNewlines(from: i, to: end)
                    push(.string, start, end, startLine: startLine, startCol: startCol)
                    i = end
                    continue
                } else if c == 64 && j < n && CSharpLexer.isIdentStart(u[j]) && j == i + 1 {
                    // @identifier (verbatim identifier)
                    var k = j
                    while k < n && CSharpLexer.isIdentPart(u[k]) { k += 1 }
                    push(.identifier, start, k, startLine: startLine, startCol: startCol)
                    i = k
                    continue
                }
                // fallthrough: lone @ or $ handled as punctuation below
            }

            // Char literal
            if c == 39 /* ' */ {
                var j = i + 1
                var closed = false
                while j < n {
                    let d = u[j]
                    if d == 92 { j += 2; continue }
                    if d == 39 { j += 1; closed = true; break }
                    if d == 10 || d == 13 { break }
                    j += 1
                }
                j = min(j, n)
                if !closed {
                    issues.append(LexicalIssue(message: "Zeichenliteral wird nicht geschlossen (' fehlt).",
                                               location: start, line: startLine, column: startCol, ruleID: "LEX002"))
                } else if j - i == 2 {
                    issues.append(LexicalIssue(message: "Leeres Zeichenliteral ''.",
                                               location: start, line: startLine, column: startCol, ruleID: "LEX004"))
                }
                push(.char, start, j, startLine: startLine, startCol: startCol)
                i = j
                continue
            }

            // Numbers
            if CSharpLexer.isDigit(c) || (c == 46 && i + 1 < n && CSharpLexer.isDigit(u[i + 1])) {
                var j = i
                if c == 48 && i + 1 < n && (u[i + 1] == 120 || u[i + 1] == 88) { // 0x
                    j += 2
                    while j < n && (CSharpLexer.isHex(u[j]) || u[j] == 95) { j += 1 }
                } else if c == 48 && i + 1 < n && (u[i + 1] == 98 || u[i + 1] == 66) { // 0b
                    j += 2
                    while j < n && (u[j] == 48 || u[j] == 49 || u[j] == 95) { j += 1 }
                } else {
                    while j < n && (CSharpLexer.isDigit(u[j]) || u[j] == 95) { j += 1 }
                    if j < n && u[j] == 46 && j + 1 < n && CSharpLexer.isDigit(u[j + 1]) {
                        j += 1
                        while j < n && (CSharpLexer.isDigit(u[j]) || u[j] == 95) { j += 1 }
                    }
                    if j < n && (u[j] == 101 || u[j] == 69) { // exponent
                        var k = j + 1
                        if k < n && (u[k] == 43 || u[k] == 45) { k += 1 }
                        if k < n && CSharpLexer.isDigit(u[k]) {
                            j = k
                            while j < n && CSharpLexer.isDigit(u[j]) { j += 1 }
                        }
                    }
                }
                // suffixes f F d D m M u U l L
                let suffixes: Set<UInt16> = [102, 70, 100, 68, 109, 77, 117, 85, 108, 76]
                while j < n && suffixes.contains(u[j]) { j += 1 }
                push(.number, start, j, startLine: startLine, startCol: startCol)
                i = j
                continue
            }

            // Identifiers & keywords
            if CSharpLexer.isIdentStart(c) {
                var j = i
                while j < n && CSharpLexer.isIdentPart(u[j]) { j += 1 }
                let word = text(i, j)
                let kind: CSharpTokenKind
                if CSharpLexer.keywords.contains(word) { kind = .keyword }
                else if CSharpLexer.contextualKeywords.contains(word) { kind = .contextualKeyword }
                else { kind = .identifier }
                tokens.append(CSharpToken(kind: kind, location: start, length: j - i, line: startLine, column: startCol, text: word))
                i = j
                continue
            }

            // Operators (longest match first)
            if let len = CSharpLexer.operatorLength(u, i) {
                push(.operator, start, i + len, startLine: startLine, startCol: startCol)
                i += len
                continue
            }

            // Punctuation
            switch c {
            case 123, 125, 40, 41, 91, 93, 59, 44, 46, 58:
                push(.punctuation, start, i + 1, startLine: startLine, startCol: startCol)
                i += 1
                continue
            default:
                break
            }

            // Unknown character
            issues.append(LexicalIssue(message: "Unerwartetes Zeichen '\(text(i, i + 1))'.",
                                       location: start, line: startLine, column: startCol, ruleID: "LEX005"))
            push(.invalid, start, i + 1, startLine: startLine, startCol: startCol)
            i += 1
        }

        var result = CSharpLexResult(tokens: tokens, issues: issues, lineStarts: lineStarts)
        CSharpLexer.classifyIdentifiers(&result)
        return result
    }

    private static let operators: [[UInt16]] = [
        ">>>=", "<<=", ">>=", ">>>", "??=", "...", "=>", "==", "!=", "<=", ">=", "&&", "||",
        "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "->", "??", "::", "..",
        "+", "-", "*", "/", "%", "&", "|", "^", "!", "~", "=", "<", ">", "?", "@", "$"
    ].map { Array($0.utf16) }

    static func operatorLength(_ u: [UInt16], _ i: Int) -> Int? {
        // Never merge ">>" here: it breaks nested generics (List<List<int>>). The parser
        // re-combines adjacent '>' tokens when it needs shift operators.
        for op in operators {
            if op.count == 1 {
                if u[i] == op[0] { return 1 }
                continue
            }
            if i + op.count <= u.count {
                var ok = true
                for k in 0..<op.count where u[i + k] != op[k] { ok = false; break }
                if ok {
                    if op.first == 62 && op.count >= 3 && op[1] == 62 { continue } // >>>, >>= family: keep '>' split
                    return op.count
                }
            }
        }
        return nil
    }

    /// Lexes a string literal starting at the opening quote `q`. Returns end index (exclusive).
    private func lexString(_ u: [UInt16], from q: Int, verbatim: Bool, interpolated: Bool, dollarCount: Int,
                           issues: inout [LexicalIssue], line: Int, column: Int, start: Int) -> Int {
        let n = u.count
        // Raw string literal: three or more quotes.
        var quoteRun = 0
        while q + quoteRun < n && u[q + quoteRun] == 34 { quoteRun += 1 }
        if quoteRun >= 3 {
            var j = q + quoteRun
            while j < n {
                if u[j] == 34 {
                    var run = 0
                    while j + run < n && u[j + run] == 34 { run += 1 }
                    if run >= quoteRun { return j + run }
                    j += run
                } else { j += 1 }
            }
            issues.append(LexicalIssue(message: "Raw-String-Literal wird nicht geschlossen.", location: start,
                                       line: line, column: column, ruleID: "LEX001"))
            return n
        }

        var j = q + 1
        var braceDepth = 0
        while j < n {
            let d = u[j]
            if interpolated && braceDepth > 0 {
                // Inside an interpolation hole: skip nested strings, track braces.
                if d == 123 { braceDepth += 1 }
                else if d == 125 { braceDepth -= 1 }
                else if d == 34 {
                    // nested simple string
                    var k = j + 1
                    while k < n && u[k] != 34 && u[k] != 10 { if u[k] == 92 { k += 1 }; k += 1 }
                    j = k
                } else if (d == 10 || d == 13) && !verbatim {
                    break
                }
                j += 1
                continue
            }
            if !verbatim && d == 92 { j += 2; continue } // escape
            if d == 34 {
                if verbatim && j + 1 < n && u[j + 1] == 34 { j += 2; continue } // "" escape
                return j + 1
            }
            if interpolated && d == 123 {
                if j + 1 < n && u[j + 1] == 123 { j += 2; continue } // {{ escape
                braceDepth = 1
                j += 1
                continue
            }
            if !verbatim && (d == 10 || d == 13) { break }
            j += 1
        }
        issues.append(LexicalIssue(message: "String-Literal wird nicht geschlossen (\" fehlt).", location: start,
                                   line: line, column: column, ruleID: "LEX001"))
        return min(j, n)
    }

    /// Second pass: refines identifiers into type names, method names and attributes.
    static func classifyIdentifiers(_ result: inout CSharpLexResult) {
        let toks = result.tokens
        var sigIdx: [Int] = []
        sigIdx.reserveCapacity(toks.count / 2)
        for (k, t) in toks.enumerated() where !t.isTrivia { sigIdx.append(k) }

        // Collect types declared in this file.
        var declared = Set<String>()
        for s in 0..<sigIdx.count {
            let t = toks[sigIdx[s]]
            if (t.kind == .keyword && ["class", "struct", "interface", "enum", "delegate"].contains(t.text))
                || (t.kind == .contextualKeyword && t.text == "record") {
                // name follows (for delegate: after return type)
                var k = s + 1
                if t.text == "delegate" {
                    while k + 1 < sigIdx.count && toks[sigIdx[k + 1]].text != "(" && toks[sigIdx[k + 1]].text != ";" { k += 1 }
                }
                if k < sigIdx.count, toks[sigIdx[k]].kind == .identifier { declared.insert(toks[sigIdx[k]].text) }
            }
        }

        var bracketDepth = 0
        var attributeDepth: Int? = nil
        for s in 0..<sigIdx.count {
            let idx = sigIdx[s]
            let t = toks[idx]
            if t.text == "[" {
                bracketDepth += 1
                // An attribute section starts with '[' when the previous significant token ends a
                // statement / member or another attribute, or starts the file.
                let prev = s > 0 ? toks[sigIdx[s - 1]].text : ";"
                if attributeDepth == nil && (s == 0 || [";", "{", "}", "]"].contains(prev)) {
                    attributeDepth = bracketDepth
                }
                continue
            }
            if t.text == "]" {
                if attributeDepth == bracketDepth { attributeDepth = nil }
                bracketDepth = max(0, bracketDepth - 1)
                continue
            }
            guard t.kind == .identifier else { continue }
            let prev = s > 0 ? toks[sigIdx[s - 1]] : nil
            let next = s + 1 < sigIdx.count ? toks[sigIdx[s + 1]] : nil

            if let ad = attributeDepth, ad == bracketDepth,
               prev.map({ $0.text == "[" || $0.text == "," }) ?? false {
                result.tokens[idx].kind = .attribute
                continue
            }
            if declared.contains(t.text) || UnityCatalog.knownTypes.contains(t.text) {
                result.tokens[idx].kind = .typeName
                continue
            }
            if next?.text == "(" {
                if prev?.text == "new" { result.tokens[idx].kind = .typeName }
                else { result.tokens[idx].kind = .methodName }
                continue
            }
            if let p = prev, p.text == "new" || p.text == ":" && isTypeLike(t.text) {
                result.tokens[idx].kind = .typeName
                continue
            }
            // Generic method call: Foo<T>(
            if next?.text == "<", isTypeLike(t.text) {
                result.tokens[idx].kind = .typeName
                continue
            }
            // "Type name" declarations: PascalCase identifier followed by another identifier.
            if let nx = next, nx.kind == .identifier || nx.kind == .contextualKeyword, isTypeLike(t.text),
               prev?.text != "." {
                result.tokens[idx].kind = .typeName
            }
        }
    }

    static func isTypeLike(_ s: String) -> Bool {
        guard let f = s.unicodeScalars.first else { return false }
        return CharacterSet.uppercaseLetters.contains(f)
    }
}
