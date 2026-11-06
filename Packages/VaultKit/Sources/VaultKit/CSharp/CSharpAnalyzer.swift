import Foundation

/// Static analysis engine for C# / Unity scripts that runs fully on-device.
///
/// What it does (and what it deliberately does not do) is reported in `AnalysisReport.checks`:
/// 1. Lexical analysis (unterminated strings / comments / invalid characters)
/// 2. Bracket structure with error recovery and a "probably missing here" hint
/// 3. A recovering structural parser (namespaces, types, members, statements) that detects
///    missing semicolons, statements outside methods, malformed control statements …
/// 4. C# heuristics (assignment in condition, empty statements, empty catch, infinite loops,
///    duplicate members, missing `using` directives for well-known types)
/// 5. Unity rules (message signatures, per-frame performance traps, CS1612 struct property
///    assignment, coroutine pitfalls, UnityEditor in player builds, file/class name …)
///
/// It does **not** resolve symbols against the Unity assemblies and does **not** emit IL —
/// that is what the PC companion (real Roslyn compilation) is for.
public final class CSharpAnalyzer {

    public struct Options: Sendable {
        /// The script's file name without extension (Unity requires class name == file name).
        public var fileName: String?
        /// Maximum diagnostics per rule to avoid flooding the UI.
        public var maxPerRule: Int = 25
        public init(fileName: String? = nil) { self.fileName = fileName }
    }

    public init() {}

    public func analyze(_ source: String, options: Options = Options()) -> AnalysisReport {
        let started = Date()
        let lex = CSharpLexer().lex(source)
        let worker = Worker(lex: lex, options: options)
        worker.run()
        var diags = worker.diagnostics
        // Stable ordering: by line, then severity.
        diags.sort { ($0.line, $0.severity.rank, $0.column) < ($1.line, $1.severity.rank, $1.column) }
        // Limit per rule.
        var perRule: [String: Int] = [:]
        diags = diags.filter { d in
            perRule[d.ruleID, default: 0] += 1
            return perRule[d.ruleID]! <= options.maxPerRule
        }
        let kind = worker.scriptKind()
        return AnalysisReport(
            diagnostics: diags,
            types: worker.types,
            usings: worker.usings.sorted(),
            declaredNamespaces: worker.declaredNamespaces,
            scriptKind: kind,
            suggestedCategories: worker.suggestCategories(kind: kind),
            detectedComponents: worker.detectComponents(),
            referencedTypes: worker.referencedTypes(),
            checks: Worker.checkList,
            lineCount: lex.lineStarts.count,
            tokenCount: worker.t.count,
            durationMs: Date().timeIntervalSince(started) * 1000
        )
    }
}

// MARK: - Worker

final class Worker {
    let lex: CSharpLexResult
    let options: CSharpAnalyzer.Options
    /// Significant tokens.
    let t: [CSharpToken]
    /// Matching bracket index for ( [ { and ) ] }, -1 if unmatched.
    var match: [Int]
    var diagnostics: [CodeDiagnostic] = []
    var types: [TypeOutline] = []
    var usings = Set<String>()
    var declaredNamespaces: [String] = []

    static let checkList: [AnalysisCheck] = [
        AnalysisCheck(name: "Lexikalische Analyse", detail: "Strings, Zeichen, Kommentare, ungültige Zeichen", performed: true),
        AnalysisCheck(name: "Klammerstruktur", detail: "( ) [ ] { } inkl. Position fehlender Klammern", performed: true),
        AnalysisCheck(name: "Syntaxstruktur", detail: "Deklarationen, Anweisungen, fehlende Semikolons, Code außerhalb von Methoden", performed: true),
        AnalysisCheck(name: "C#-Heuristiken", detail: "Zuweisung in Bedingung, leere Anweisungen/catch, Endlosschleifen, doppelte Member, fehlende usings", performed: true),
        AnalysisCheck(name: "Unity-Regeln", detail: "Message-Signaturen, Performance in Update, CS1612, Coroutines, UnityEditor, Dateiname", performed: true),
        AnalysisCheck(name: "Typauflösung gegen Unity-DLLs", detail: "Nur mit PC-Companion (Roslyn) möglich", performed: false),
        AnalysisCheck(name: "IL-Kompilierung", detail: "Auf iOS nicht möglich (kein JIT/keine Unity-Assemblies) – PC-Companion verwenden", performed: false)
    ]

    init(lex: CSharpLexResult, options: CSharpAnalyzer.Options) {
        self.lex = lex
        self.options = options
        self.t = lex.tokens.filter { !$0.isTrivia }
        self.match = Array(repeating: -1, count: t.count)
    }

    func report(_ sev: DiagnosticSeverity, _ src: DiagnosticSource, _ rule: String, _ msg: String,
                at tok: CSharpToken?, suggestion: String? = nil) {
        let line = tok?.line ?? max(1, lex.lineStarts.count)
        let col = tok?.column ?? 1
        diagnostics.append(CodeDiagnostic(severity: sev, source: src, ruleID: rule, message: msg,
                                          line: line, column: col, suggestion: suggestion))
    }

    func run() {
        for issue in lex.issues {
            diagnostics.append(CodeDiagnostic(severity: .error, source: .lexer, ruleID: issue.ruleID,
                                              message: issue.message, line: issue.line, column: issue.column))
        }
        matchBrackets()
        collectUsings()
        parseBlock(from: 0, to: t.count, ctx: .namespaceBody)
        csharpRules()
        unityRules()
    }

    // MARK: Helpers

    @inline(__always) func text(_ i: Int) -> String { i >= 0 && i < t.count ? t[i].text : "" }

    static let modifiers: Set<String> = ["public", "private", "protected", "internal", "static", "readonly", "const",
                                         "virtual", "override", "abstract", "sealed", "extern", "unsafe", "volatile",
                                         "async", "partial", "new", "required", "file", "ref", "fixed"]

    // MARK: 1. Brackets

    func matchBrackets() {
        var stack: [Int] = []
        let pairs: [String: String] = [")": "(", "]": "[", "}": "{"]
        for i in 0..<t.count {
            let s = t[i].text
            guard t[i].kind == .punctuation else { continue }
            if s == "(" || s == "[" || s == "{" { stack.append(i); continue }
            guard let open = pairs[s] else { continue }
            if let top = stack.last, t[top].text == open {
                stack.removeLast(); match[top] = i; match[i] = top
            } else if let deep = stack.lastIndex(where: { t[$0].text == open }) {
                // Everything above `deep` was never closed.
                for k in stack[(deep + 1)...] {
                    reportUnclosed(k)
                }
                let top = stack[deep]
                stack.removeSubrange(deep...)
                match[top] = i; match[i] = top
            } else {
                report(.error, .syntax, "SYN001", "Unerwartete '\(s)' – es gibt keine passende öffnende '\(open)'.", at: t[i],
                       suggestion: "Überzählige '\(s)' entfernen oder die fehlende '\(open)' ergänzen.")
            }
        }
        for k in stack { reportUnclosed(k) }
    }

    func reportUnclosed(_ k: Int) {
        let open = t[k].text
        let close = open == "(" ? ")" : (open == "[" ? "]" : "}")
        var hint = ""
        if open == "{" , let line = guessMissingBraceLine(openIndex: k) {
            hint = " Vermutlich fehlt sie vor Zeile \(line)."
        }
        report(.error, .syntax, "SYN002", "'\(open)' wird nicht geschlossen – es fehlt eine '\(close)'.\(hint)", at: t[k],
               suggestion: "Passende '\(close)' ergänzen.")
    }

    /// Uses indentation to estimate where a missing closing brace belongs.
    func guessMissingBraceLine(openIndex k: Int) -> Int? {
        let openLine = t[k].line
        // Indentation of the line containing the '{' (or the header line before it).
        let indent = indentation(ofLine: openLine)
        var lastLine = openLine
        for j in (k + 1)..<t.count {
            let tok = t[j]
            if tok.line == lastLine { continue }
            lastLine = tok.line
            let ind = indentation(ofLine: tok.line)
            if ind <= indent && tok.text != "}" { return tok.line }
            if ind < indent { return tok.line }
        }
        return nil
    }

    func indentation(ofLine line: Int) -> Int {
        // Count leading whitespace by looking at the first significant token on that line.
        // Columns are 1-based so first token column - 1 == indentation width (tabs count 1).
        if let tok = t.first(where: { $0.line == line }) { return tok.column - 1 }
        return 0
    }

    // MARK: 2. Usings / namespaces

    func collectUsings() {
        var i = 0
        while i < t.count {
            if t[i].text == "using" && (i == 0 || [";", "}", "{"].contains(text(i - 1))) {
                var j = i + 1
                if text(j) == "static" { j += 1 }
                if text(j) == "global" { j += 1 }
                var parts: [String] = []
                var ok = true
                var alias = false
                while j < t.count && text(j) != ";" {
                    let s = text(j)
                    if s == "=" { alias = true; parts = [] }
                    else if s == "." || s == "::" { }
                    else if t[j].kind == .identifier || t[j].kind == .typeName || t[j].kind == .methodName || t[j].kind == .contextualKeyword { parts.append(s) }
                    else if s == "<" || s == ">" || s == "," { }
                    else { ok = false; break }
                    j += 1
                }
                if ok && !parts.isEmpty && text(j) == ";" {
                    if !alias { usings.insert(parts.joined(separator: ".")) }
                    i = j
                }
            }
            if t[i].text == "namespace" {
                var j = i + 1
                var parts: [String] = []
                while j < t.count, t[j].kind != .punctuation || t[j].text == "." {
                    if t[j].text != "." { parts.append(t[j].text) }
                    j += 1
                }
                if !parts.isEmpty {
                    declaredNamespaces.append(parts.joined(separator: "."))
                }
            }
            i += 1
        }
    }

    func namespaceImported(_ ns: String) -> Bool {
        if usings.contains(ns) { return true }
        for d in declaredNamespaces where d == ns || d.hasPrefix(ns + ".") { return true }
        return false
    }

    // MARK: 3. Structural parser

    indirect enum Ctx {
        case namespaceBody
        case typeBody(Int)
        case enumBody
        case propertyBody(Int)
        case statements
        case expression

        var checksSemicolons: Bool {
            switch self {
            case .enumBody, .expression: return false
            default: return true
            }
        }
        var isTypeBody: Bool { if case .typeBody = self { return true }; return false }
        var typeIndex: Int? {
            switch self {
            case .typeBody(let i), .propertyBody(let i): return i
            default: return nil
            }
        }
    }

    static let statementKeywords: Set<String> = [
        "if", "for", "foreach", "while", "do", "switch", "return", "break", "continue", "throw", "try", "goto",
        "public", "private", "protected", "internal", "static", "readonly", "const", "void", "int", "float", "bool",
        "string", "double", "long", "byte", "char", "object", "decimal", "short", "uint", "ulong", "class", "struct",
        "enum", "interface", "using", "this", "base", "namespace", "abstract", "virtual", "override", "sealed", "lock",
        "unsafe", "fixed", "checked", "unchecked", "delegate", "event"
    ]
    static let contextualStarters: Set<String> = ["var", "await", "yield", "async", "partial", "dynamic"]
    static let controlKeywords: Set<String> = ["if", "while", "for", "foreach", "using", "lock", "fixed", "switch", "catch"]

    func canEnd(_ a: CSharpToken) -> Bool {
        switch a.kind {
        case .identifier, .typeName, .methodName, .number, .string, .char: return true
        case .keyword: return ["true", "false", "null", "this", "base"].contains(a.text)
        case .contextualKeyword: return a.text == "value"
        default: return [")", "]", "++", "--"].contains(a.text)
        }
    }

    func canStart(_ b: CSharpToken) -> Bool {
        switch b.kind {
        case .identifier, .typeName, .methodName: return true
        case .keyword: return Worker.statementKeywords.contains(b.text)
        case .contextualKeyword: return Worker.contextualStarters.contains(b.text)
        default: return false
        }
    }

    /// Index of the first token after leading attribute sections.
    func skipAttributes(_ from: Int, _ to: Int) -> Int {
        var j = from
        while j < to && text(j) == "[" && match[j] > j && match[j] < to { j = match[j] + 1 }
        return j
    }

    /// Whether `from...upTo` (inclusive) contains enough to be a complete statement/member.
    func looksComplete(_ from: Int, _ upTo: Int) -> Bool {
        var j = skipAttributes(from, upTo + 1)
        if j > upTo { return false }
        if ["return", "throw", "yield", "break", "continue", "goto", "await"].contains(text(j)) { return upTo > j || text(j) == "break" || text(j) == "continue" }
        var units = 0
        var angle = 0
        while j <= upTo {
            let s = text(j)
            if s == "=" || s == ")" || s == "]" || s == "++" || s == "--" { return true }
            if [CSharpTokenKind.number, .string, .char].contains(t[j].kind) { return true }
            if s == "<" { angle += 1 }
            else if s == ">" { angle = max(0, angle - 1) }
            else if angle == 0 && !Worker.modifiers.contains(s) &&
                        (t[j].kind == .identifier || t[j].kind == .typeName || t[j].kind == .methodName ||
                         (t[j].kind == .keyword && CSharpLexer.builtinTypeKeywords.contains(s)) || s == "var") {
                if !(j > from && text(j - 1) == ".") { units += 1 }
            }
            j += 1
        }
        return units >= 2
    }

    /// Decides whether the '{' at `i` opens an expression (lambda, initializer, switch expression)
    /// rather than a statement/declaration block.
    func isExpressionBlock(at i: Int, stmtStart: Int, paren: Int, bracket: Int) -> Bool {
        if paren > 0 || bracket > 0 { return true }
        guard i > stmtStart else { return false }
        let p = text(i - 1)
        if ["=>", "=", "return", ",", "?", "??", "(", "[", "new", "delegate", "with", "switch", ":"].contains(p) {
            // ':' only for ternaries — `class A : B {` ends with an identifier, so ':' directly before '{' is
            // a ternary/named argument.
            if p == "switch" && i - 1 == stmtStart { return false }
            return true
        }
        // anonymous method `delegate (int x) {`
        if p == ")" , match[i - 1] >= 0, match[i - 1] > 0, text(match[i - 1] - 1) == "delegate" { return true }
        // `new Foo {`, `new Foo(...) {`, `new int[] {`, `new() {`, `new List<int> {`
        var j = i - 1
        var angle = 0
        while j >= stmtStart {
            let s = text(j)
            if s == ")" || s == "]" {
                guard match[j] >= 0 else { return false }
                j = match[j] - 1; continue
            }
            if s == ">" { angle += 1; j -= 1; continue }
            if s == "<" { angle -= 1; j -= 1; continue }
            if s == "new" { return true }
            if s == "." || s == "," && angle > 0 || s == "?" { j -= 1; continue }
            if t[j].kind == .identifier || t[j].kind == .typeName || t[j].kind == .methodName ||
                (t[j].kind == .keyword && CSharpLexer.builtinTypeKeywords.contains(s)) {
                j -= 1; continue
            }
            return false
        }
        return false
    }

    func parseBlock(from: Int, to: Int, ctx: Ctx) {
        var stmtStart = from
        var i = from
        var paren = 0
        var bracket = 0
        var prevBlockWasDo = false
        var propertyInitializer = false

        func firstWord(_ s: Int) -> Int {
            var k = s
            while k < to && text(k) == "else" { k += 1 }
            return k
        }

        while i < to {
            let tok = t[i]
            let s = tok.text

            if tok.kind == .punctuation && s == "{" {
                let close = match[i] > i ? min(match[i], to) : to
                if !ctx.checksSemicolons && ctx.isExpressionLike || isExpressionBlock(at: i, stmtStart: stmtStart, paren: paren, bracket: bracket) {
                    let prev = text(i - 1)
                    let lambda = prev == "=>" || prev == "delegate" ||
                        (prev == ")" && match[i - 1] > 0 && text(match[i - 1] - 1) == "delegate")
                    parseBlock(from: i + 1, to: close, ctx: lambda ? .statements : .expression)
                    i = close + 1
                    continue
                }
                let headerFirst = skipAttributes(stmtStart, i)
                let continuation = handleStatementBlock(headerFrom: stmtStart, headerTo: i, open: i, close: close, ctx: ctx)
                prevBlockWasDo = firstWord(headerFirst) < i && text(firstWord(headerFirst)) == "do" && firstWord(headerFirst) == i - 1
                i = close + 1
                paren = 0; bracket = 0
                // property initializer `{ get; set; } = value;` – the statement continues.
                propertyInitializer = continuation && i < to && text(i) == "="
                stmtStart = i
                continue
            }
            if tok.kind == .punctuation && s == "}" {
                i += 1; stmtStart = i; paren = 0; bracket = 0
                continue
            }
            if tok.kind == .punctuation && s == ";" {
                let fw = firstWord(stmtStart)
                if paren > 0 && text(fw) == "for" {
                    i += 1; continue
                }
                if !propertyInitializer {
                    handleStatement(from: stmtStart, to: i, terminated: true, ctx: ctx, prevBlockWasDo: prevBlockWasDo)
                }
                propertyInitializer = false
                prevBlockWasDo = false
                paren = 0; bracket = 0
                i += 1
                stmtStart = i
                continue
            }
            if s == "(" { paren += 1 } else if s == ")" { paren = max(0, paren - 1) }
            else if s == "[" { bracket += 1 } else if s == "]" { bracket = max(0, bracket - 1) }

            // Missing-semicolon heuristic between this token (A) and the next (B).
            if ctx.checksSemicolons, paren == 0, bracket == 0, i + 1 < to, i >= stmtStart {
                let b = t[i + 1]
                if b.line > tok.line && b.text != "{" && canEnd(tok) && canStart(b) {
                    let fw = firstWord(stmtStart)
                    // Control header followed by an embedded statement: `if (x)\n Foo();`
                    if s == ")" && Worker.controlKeywords.contains(text(fw)) && text(fw + 1) == "(" && match[fw + 1] == i {
                        stmtStart = i + 1
                    } else if s == "]" && skipAttributes(stmtStart, i + 1) == i + 1 {
                        // only attributes so far: `[SerializeField]\n private float x;`
                        stmtStart = i + 1
                    } else if looksComplete(stmtStart, i) {
                        report(.error, .syntax, "SYN010", "';' erwartet – die Anweisung endet ohne Semikolon.", at: tok,
                               suggestion: "Am Ende von Zeile \(tok.line) ein ';' ergänzen.")
                        stmtStart = i + 1
                    }
                }
            }
            i += 1
        }
        if stmtStart < to {
            handleStatement(from: stmtStart, to: to, terminated: false, ctx: ctx, prevBlockWasDo: prevBlockWasDo)
        }
    }

    /// Handles a `;`-terminated (or unterminated) statement/member covering tokens `from..<to`.
    func handleStatement(from: Int, to: Int, terminated: Bool, ctx: Ctx, prevBlockWasDo: Bool) {
        guard from < to else { return }
        if !terminated {
            if ctx.checksSemicolons {
                let last = t[to - 1]
                // A lone label `name:` or attributes at end of block are not worth reporting.
                if last.text != ":" {
                    report(.error, .syntax, "SYN011", "';' erwartet vor dem Blockende.", at: last,
                           suggestion: "Nach '\(last.text)' in Zeile \(last.line) ein ';' ergänzen.")
                }
            }
            return
        }
        switch ctx {
        case .typeBody(let ti):
            handleMember(from: from, to: to, typeIndex: ti)
        case .statements:
            checkControlStatement(from: from, to: to, terminatedBySemicolon: true, prevBlockWasDo: prevBlockWasDo)
        case .namespaceBody:
            let k = skipAttributes(from, to)
            guard k < to else { return } // assembly attributes
            let first = text(k)
            let allowed = ["using", "extern", "global", "namespace"].contains(first) ||
                (from..<to).contains { ["delegate", "record", "class", "struct", "interface", "enum"].contains(text($0)) }
            if !allowed {
                report(.error, .syntax, "SYN020", "Code außerhalb eines Typs. In Unity muss jeder Code in einer Klasse/Struktur stehen.",
                       at: t[k], suggestion: "Den Code in eine Klasse (z. B. MonoBehaviour) verschieben.")
            }
        default:
            break
        }
    }

    /// A `;`-terminated member inside a type body: field, event, delegate, abstract/interface method,
    /// expression-bodied member, or an illegal statement.
    func handleMember(from: Int, to: Int, typeIndex: Int) {
        var k = skipAttributes(from, to)
        let attrs = attributeNames(from: from, to: k)
        var mods: [String] = []
        while k < to && Worker.modifiers.contains(text(k)) { mods.append(text(k)); k += 1 }
        guard k < to else { return }
        let first = text(k)
        if ["delegate", "event", "using", "operator", "implicit", "explicit"].contains(first) {
            if first == "event" { addField(from: k + 1, to: to, typeIndex: typeIndex, mods: mods + ["event"], attrs: attrs) }
            return
        }
        // Find the top-level '(' and '=' / '=>'
        var paren = -1, assign = -1, arrow = -1
        var angle = 0
        var j = k
        while j < to {
            let s = text(j)
            if s == "<" { angle += 1 } else if s == ">" { angle = max(0, angle - 1) }
            if s == "=" && assign < 0 && angle == 0 { assign = j }
            if s == "=>" && arrow < 0 { arrow = j }
            if s == "(" && paren < 0 && assign < 0 && arrow < 0 { paren = j }
            if (s == "(" || s == "[") && match[j] > j { j = match[j] }
            j += 1
        }
        if paren >= 0 {
            // Method declaration (abstract/interface/extern/partial or expression bodied)?
            let nameIdx = nameIndexBefore(paren, lowerBound: k)
            // Strip a qualified prefix (`Debug.Log`, `IFoo.Bar`) to see if a return type remains.
            var q0 = nameIdx
            while q0 - 2 >= k && text(q0 - 1) == "." { q0 -= 2 }
            let returnTokens = q0 > k ? (k..<q0) : (k..<k)
            let isCtor = returnTokens.isEmpty && text(nameIdx) == types[typeIndex].name
            if returnTokens.isEmpty && !isCtor && arrow < 0 {
                report(.error, .syntax, "SYN021", "Anweisung im Klassenrumpf – ausführbarer Code muss in einer Methode stehen.",
                       at: t[k], suggestion: "Den Aufruf in eine Methode wie Start() oder Awake() verschieben.")
                return
            }
            if returnTokens.isEmpty && !isCtor && arrow >= 0 && text(nameIdx) != types[typeIndex].name {
                report(.error, .syntax, "SYN021", "Anweisung im Klassenrumpf – ausführbarer Code muss in einer Methode stehen.",
                       at: t[k], suggestion: "Den Aufruf in eine Methode verschieben.")
                return
            }
            var m = MethodOutline(name: text(nameIdx), returnType: joinTokens(returnTokens), parameterTypes: parameterTypes(open: paren),
                                  line: t[nameIdx].line, modifiers: mods, bodyStart: 0, bodyEnd: 0, isBlockBody: false)
            if arrow >= 0 { m.bodyStart = arrow + 1; m.bodyEnd = to }
            types[typeIndex].methods.append(m)
            return
        }
        // Field or expression-bodied property.
        let declEnd = assign >= 0 ? assign : (arrow >= 0 ? arrow : to)
        // Count "units" (type + name) before '='.
        var units = 0
        angle = 0
        for q in k..<declEnd {
            let s = text(q)
            if s == "<" { angle += 1 } else if s == ">" { angle = max(0, angle - 1) }
            else if angle == 0 && (t[q].kind == .identifier || t[q].kind == .typeName || t[q].kind == .methodName ||
                                    (t[q].kind == .keyword && CSharpLexer.builtinTypeKeywords.contains(s)) || t[q].kind == .contextualKeyword)
                        && !(q > k && text(q - 1) == ".") {
                units += 1
            }
        }
        if units < 2 {
            report(.error, .syntax, "SYN021", "Anweisung im Klassenrumpf – ausführbarer Code muss in einer Methode stehen.",
                   at: t[k], suggestion: "Zuweisungen/Aufrufe in eine Methode verschieben oder einen Typ angeben.")
            return
        }
        if arrow >= 0 && assign < 0 {
            addField(from: k, to: arrow, typeIndex: typeIndex, mods: mods, attrs: attrs, isProperty: true)
        } else {
            addField(from: k, to: declEnd, typeIndex: typeIndex, mods: mods, attrs: attrs)
        }
    }

    func attributeNames(from: Int, to: Int) -> [String] {
        var names: [String] = []
        var j = from
        while j < to {
            if text(j) == "[" || text(j) == "," , j + 1 < to, t[j + 1].kind == .attribute || t[j + 1].kind == .identifier || t[j + 1].kind == .typeName {
                names.append(text(j + 1))
            }
            j += 1
        }
        return names
    }

    func addField(from: Int, to: Int, typeIndex: Int, mods: [String], attrs: [String], isProperty: Bool = false) {
        guard to - 1 >= from else { return }
        // Name = last identifier before `to`; type = tokens before name.
        var nameIdx = to - 1
        while nameIdx > from && !(t[nameIdx].kind == .identifier || t[nameIdx].kind == .typeName || t[nameIdx].kind == .methodName || t[nameIdx].kind == .contextualKeyword) { nameIdx -= 1 }
        // Multiple declarators: `int a, b;` → take first
        if let comma = (from..<to).first(where: { text($0) == "," && !insideAngles(from: from, index: $0) }), comma - 1 > from {
            nameIdx = comma - 1
        }
        let f = FieldOutline(name: text(nameIdx), typeName: joinTokens(from..<nameIdx), line: t[nameIdx].line, modifiers: mods, attributes: attrs)
        if isProperty { types[typeIndex].properties.append(f) } else { types[typeIndex].fields.append(f) }
    }

    func insideAngles(from: Int, index: Int) -> Bool {
        var a = 0
        for q in from..<index { if text(q) == "<" { a += 1 } else if text(q) == ">" { a -= 1 } }
        return a > 0
    }

    func joinTokens(_ r: Range<Int>) -> String {
        var out = ""
        for q in r {
            let s = text(q)
            if !out.isEmpty, let last = out.last, (last.isLetter || last.isNumber || last == "_" || last == ">" || last == "]"),
               let f = s.first, (f.isLetter || f == "_") {
                out += " "
            }
            out += s
        }
        return out
    }

    /// Given the index of a top-level '(' returns the index of the name token before it
    /// (skipping generic parameter lists like `Foo<T>(`).
    func nameIndexBefore(_ paren: Int, lowerBound: Int) -> Int {
        var j = paren - 1
        if text(j) == ">" {
            var depth = 0
            while j >= lowerBound {
                if text(j) == ">" { depth += 1 } else if text(j) == "<" { depth -= 1; if depth == 0 { j -= 1; break } }
                j -= 1
            }
        }
        return max(lowerBound, j)
    }

    func parameterTypes(open: Int) -> [String] {
        guard match[open] > open else { return [] }
        let close = match[open]
        var result: [String] = []
        var start = open + 1
        var depth = 0
        var q = open + 1
        func flush(_ end: Int) {
            guard end > start else { return }
            var a = skipAttributes(start, end)
            while a < end && ["ref", "out", "in", "params", "this", "scoped", "readonly"].contains(text(a)) { a += 1 }
            var e = end
            if let eq = (a..<end).first(where: { text($0) == "=" }) { e = eq }
            // drop the parameter name (last identifier)
            if e - 1 > a { e -= 1 }
            result.append(joinTokens(a..<e))
        }
        while q < close {
            let s = text(q)
            if s == "(" || s == "[" || s == "<" { depth += 1 }
            else if s == ")" || s == "]" || s == ">" { depth -= 1 }
            else if s == "," && depth == 0 { flush(q); start = q + 1 }
            q += 1
        }
        flush(close)
        return result
    }

    /// Returns true when the block's header was a property-like member (so `= value;` may follow).
    @discardableResult
    func handleStatementBlock(headerFrom: Int, headerTo: Int, open: Int, close: Int, ctx: Ctx) -> Bool {
        let h0 = skipAttributes(headerFrom, headerTo)
        // Type declaration?
        var typeKw = -1
        var q = h0
        while q < headerTo {
            let s = text(q)
            if s == "(" || s == "where" || s == "=" { break }
            if t[q].kind == .keyword && ["class", "struct", "interface", "enum"].contains(s) { typeKw = q; break }
            if s == "record" && t[q].kind == .contextualKeyword { typeKw = q; break }
            q += 1
        }
        if typeKw >= 0 {
            let kindText = text(typeKw)
            var kind = TypeDeclKind(rawValue: kindText) ?? .class
            if kindText == "record" { kind = .record }
            let nameIdx = typeKw + 1 < headerTo && (text(typeKw + 1) == "struct" || text(typeKw + 1) == "class") ? typeKw + 2 : typeKw + 1
            var bases: [String] = []
            if let colon = (nameIdx..<headerTo).first(where: { text($0) == ":" }) {
                var angle = 0
                var current: String? = nil
                var r = colon + 1
                while r < headerTo {
                    let s = text(r)
                    if s == "where" && angle == 0 { break }
                    if s == "(" && match[r] > r { r = match[r] + 1; continue }
                    if s == "<" { angle += 1 } else if s == ">" { angle -= 1 }
                    else if s == "," && angle == 0 { if let c = current { bases.append(c) }; current = nil }
                    else if angle == 0 && s != "." && (t[r].kind == .identifier || t[r].kind == .typeName || t[r].kind == .methodName) { current = s }
                    r += 1
                }
                if let c = current { bases.append(c) }
            }
            var outline = TypeOutline(name: nameIdx < headerTo ? text(nameIdx) : "?", kind: kind, bases: bases, line: t[typeKw].line)
            if case .typeBody(let parent) = ctx { outline.nestingDepth = types[parent].nestingDepth + 1 }
            if kind == .record, let p = (nameIdx..<headerTo).first(where: { text($0) == "(" }) {
                for pt in parameterTypes(open: p) { _ = pt }
            }
            types.append(outline)
            let idx = types.count - 1
            parseBlock(from: open + 1, to: close, ctx: kind == .enum ? .enumBody : .typeBody(idx))
            return false
        }
        if text(h0) == "namespace" || (h0 < headerTo && text(h0) == "file" && text(h0 + 1) == "namespace") {
            parseBlock(from: open + 1, to: close, ctx: .namespaceBody)
            return false
        }

        switch ctx {
        case .typeBody(let ti):
            var k = h0
            var mods: [String] = []
            while k < headerTo && Worker.modifiers.contains(text(k)) { mods.append(text(k)); k += 1 }
            if k >= headerTo {
                report(.error, .syntax, "SYN022", "Unerwarteter Block im Klassenrumpf – fehlt eine Methodendeklaration?",
                       at: t[open], suggestion: "Einen Methodenkopf wie 'void Start()' vor '{' ergänzen.")
                parseBlock(from: open + 1, to: close, ctx: .statements)
                return false
            }
            // method: top-level '(' in header
            var paren = -1
            var r = k
            var angle = 0
            while r < headerTo {
                let s = text(r)
                if s == "<" { angle += 1 } else if s == ">" { angle -= 1 }
                if s == "(" && angle <= 0 { paren = r; break }
                if s == "[" && match[r] > r { r = match[r] }
                r += 1
            }
            if paren >= 0 && text(k) != "event" {
                let nameIdx = nameIndexBefore(paren, lowerBound: k)
                let ret = joinTokens(k..<nameIdx)
                let m = MethodOutline(name: text(nameIdx), returnType: ret, parameterTypes: parameterTypes(open: paren),
                                      line: t[nameIdx].line, modifiers: mods, bodyStart: open + 1, bodyEnd: close, isBlockBody: true)
                types[ti].methods.append(m)
                parseBlock(from: open + 1, to: close, ctx: .statements)
                return false
            }
            // property / indexer / event with accessors
            let isEvent = text(k) == "event"
            let f0 = isEvent ? k + 1 : k
            addField(from: f0, to: headerTo, typeIndex: ti, mods: mods, attrs: attributeNames(from: headerFrom, to: h0), isProperty: !isEvent)
            parseBlock(from: open + 1, to: close, ctx: .propertyBody(ti))
            return true
        case .propertyBody:
            parseBlock(from: open + 1, to: close, ctx: .statements)
            return false
        case .statements:
            checkControlStatement(from: headerFrom, to: headerTo, terminatedBySemicolon: false, prevBlockWasDo: false)
            parseBlock(from: open + 1, to: close, ctx: .statements)
            return false
        case .namespaceBody:
            if (h0..<headerTo).contains(where: { text($0) == "(" }) {
                report(.error, .syntax, "SYN020", "Methode außerhalb einer Klasse. In C#/Unity müssen Methoden in einem Typ stehen.",
                       at: t[h0 < headerTo ? h0 : open], suggestion: "Die Methode in eine Klasse verschieben.")
            } else if headerTo == headerFrom {
                report(.error, .syntax, "SYN022", "Unerwarteter Block außerhalb eines Typs.", at: t[open])
            }
            parseBlock(from: open + 1, to: close, ctx: .statements)
            return false
        case .enumBody, .expression:
            parseBlock(from: open + 1, to: close, ctx: .expression)
            return false
        }
    }

    /// Checks control statements (`if`, `while`, …). `from..<to` is the statement (when
    /// `terminatedBySemicolon`) or a block header.
    func checkControlStatement(from: Int, to: Int, terminatedBySemicolon: Bool, prevBlockWasDo: Bool) {
        var k = from
        while k < to && text(k) == "else" { k += 1 }
        guard k < to else { return }
        let kw = text(k)
        guard t[k].kind == .keyword, ["if", "while", "for", "foreach", "switch"].contains(kw) else {
            // `do` already handled; nothing else to check here.
            return
        }
        if text(k + 1) != "(" {
            report(.error, .syntax, "SYN030", "Nach '\(kw)' wird '(' erwartet.", at: t[k],
                   suggestion: "Bedingung in Klammern setzen: \(kw) (…)")
            return
        }
        let open = k + 1
        guard match[open] > open else { return }
        let close = match[open]
        // Empty statement: `if (x);`
        if terminatedBySemicolon && close == to - 1 && kw != "switch" && !(kw == "while" && prevBlockWasDo) {
            report(.warning, .csharp, "CS0642", "Mögliche falsche leere Anweisung: ';' direkt nach '\(kw) (…)'.", at: t[close],
                   suggestion: "Das ';' nach der Bedingung entfernen.")
        }
        if close == to - 1 && !terminatedBySemicolon && kw != "switch" { /* block follows */ }
        // Embedded statement after control header: re-check it (e.g. `if (a) if (b);`)
        if terminatedBySemicolon && close + 1 < to {
            checkControlStatement(from: close + 1, to: to, terminatedBySemicolon: true, prevBlockWasDo: false)
        }
        // Assignment in condition (depth 1 '=')
        if kw == "if" || kw == "while" {
            var depth = 0
            var q = open
            while q <= close {
                let s = text(q)
                if s == "(" || s == "[" { depth += 1 } else if s == ")" || s == "]" { depth -= 1 }
                else if s == "=" && depth == 1 {
                    report(.warning, .csharp, "CSA001", "Zuweisung '=' in der Bedingung – meinten Sie den Vergleich '=='?", at: t[q],
                           suggestion: "'=' durch '==' ersetzen.")
                    break
                }
                q += 1
            }
        }
    }

    // MARK: 4. C# rules (post pass)

    func csharpRules() {
        for i in 0..<t.count {
            let s = t[i].text
            // Empty catch block
            if s == "catch" {
                var j = i + 1
                if text(j) == "(" && match[j] > j { j = match[j] + 1 }
                if text(j) == "when" && text(j + 1) == "(" && match[j + 1] > j { j = match[j + 1] + 1 }
                if text(j) == "{" && match[j] == j + 1 {
                    report(.warning, .csharp, "CSA002", "Leerer catch-Block verschluckt Fehler unbemerkt.", at: t[i],
                           suggestion: "Mindestens Debug.LogException(e) aufrufen.")
                }
            }
            // while(true) without exit
            if s == "while" && text(i + 1) == "(" && text(i + 2) == "true" && text(i + 3) == ")" && text(i + 4) == "{" && match[i + 4] > i + 4 {
                let body = (i + 5)..<match[i + 4]
                let exits = body.contains { ["break", "return", "yield", "throw", "goto"].contains(text($0)) }
                if !exits {
                    report(.warning, .unity, "CSA003", "Endlosschleife ohne break/return/yield – friert Unity im Play Mode ein.", at: t[i],
                           suggestion: "In einer Coroutine 'yield return null;' einfügen oder eine Abbruchbedingung ergänzen.")
                }
            }
        }
        // Duplicate members & types
        var seenTypes: [String: Int] = [:]
        for ty in types where ty.nestingDepth == 0 {
            if let first = seenTypes[ty.name] {
                diagnostics.append(CodeDiagnostic(severity: .error, source: .csharp, ruleID: "CS0101",
                                                  message: "Der Typ '\(ty.name)' ist bereits definiert (Zeile \(first)).",
                                                  line: ty.line, column: 1, suggestion: "Einen der Typen umbenennen."))
            } else { seenTypes[ty.name] = ty.line }
        }
        for ty in types {
            var seen: [String: Int] = [:]
            for m in ty.methods {
                let sig = m.name + "(" + m.parameterTypes.joined(separator: ",") + ")"
                if let first = seen[sig] {
                    diagnostics.append(CodeDiagnostic(severity: .error, source: .csharp, ruleID: "CS0111",
                                                      message: "'\(ty.name)' definiert bereits einen Member '\(m.name)' mit denselben Parametertypen (Zeile \(first)).",
                                                      line: m.line, column: 1, suggestion: "Methode umbenennen oder entfernen."))
                } else { seen[sig] = m.line }
            }
            var fieldSeen: [String: Int] = [:]
            for f in ty.fields + ty.properties {
                if let first = fieldSeen[f.name] {
                    diagnostics.append(CodeDiagnostic(severity: .error, source: .csharp, ruleID: "CS0102",
                                                      message: "'\(ty.name)' enthält bereits eine Definition für '\(f.name)' (Zeile \(first)).",
                                                      line: f.line, column: 1))
                } else { fieldSeen[f.name] = f.line }
            }
        }
        missingUsings()
    }

    func missingUsings() {
        let declared = Set(types.map(\.name))
        var reported = Set<String>()
        for i in 0..<t.count {
            let tok = t[i]
            guard tok.kind == .typeName || tok.kind == .identifier || tok.kind == .methodName || tok.kind == .attribute else { continue }
            let name = tok.text
            guard let ns = UnityCatalog.typeNamespaces[name], !reported.contains(name), !declared.contains(name),
                  !UnityCatalog.ambiguousTypes.contains(name) else { continue }
            if i > 0 && (text(i - 1) == "." || text(i - 1) == "::") { continue }
            // member declarations named like a type (e.g. `void Reset()`), labels, named args
            if text(i + 1) == ":" && text(i - 1) != "?" { continue }
            if tok.kind == .methodName && !(text(i - 1) == "new") && UnityCatalog.messages[name] != nil { continue }
            if tok.kind == .methodName && text(i - 1) != "new" && text(i - 1) != "typeof" && !(name == "Action" || name == "Func") { continue }
            // generic arity: IEnumerator<T> lives in System.Collections.Generic
            var requiredNS = ns
            if (name == "IEnumerator" || name == "IEnumerable") && text(i + 1) == "<" { requiredNS = "System.Collections.Generic" }
            if namespaceImported(requiredNS) { continue }
            if requiredNS == "UnityEditor" && name == "Editor" && !namespaceImported("UnityEditor") && text(i - 1) != ":" { continue }
            if (name == "Undo" || name == "Selection" || name == "Handles") && text(i + 1) != "." { continue }
            reported.insert(name)
            let core = requiredNS == "UnityEngine" || requiredNS.hasPrefix("System.Collections")
            report(core ? .error : .warning, .csharp, "CS0246",
                   "Typ '\(name)' nicht gefunden – fehlt 'using \(requiredNS);'?", at: tok,
                   suggestion: "Am Dateianfang 'using \(requiredNS);' ergänzen.")
        }
        // LINQ
        if !namespaceImported("System.Linq") {
            for i in 1..<max(1, t.count) where t[i].kind == .methodName && UnityCatalog.linqMethods.contains(t[i].text) && text(i - 1) == "." {
                let base = text(i - 2)
                if ["Mathf", "Math", "Physics", "Physics2D", "Vector3", "Vector2", "Quaternion", "Color", "Time", "this", "base", "Enumerable"].contains(base) { continue }
                if t[i].text == "First" || t[i].text == "Last" { if text(i + 1) == "(" && text(i + 2) == ")" { /* ok typical linq */ } }
                report(.warning, .csharp, "CS1061", "'\(t[i].text)()' ist eine LINQ-Methode – fehlt 'using System.Linq;'?", at: t[i],
                       suggestion: "'using System.Linq;' ergänzen.")
                break
            }
        }
    }

    // MARK: 5. Unity rules

    /// Resolves whether a type derives (transitively within this file) from one of `bases`.
    func derives(_ type: TypeOutline, from bases: Set<String>, depth: Int = 0) -> Bool {
        if depth > 8 { return false }
        for b in type.bases {
            if bases.contains(b) { return true }
            if let parent = types.first(where: { $0.name == b }), derives(parent, from: bases, depth: depth + 1) { return true }
        }
        return false
    }

    func isBehaviour(_ ty: TypeOutline) -> Bool { derives(ty, from: UnityCatalog.behaviourBases) }

    func unityRules() {
        let behaviours = types.filter { isBehaviour($0) }
        let behaviourNames = Set(behaviours.map(\.name))
        let scriptables = types.filter { derives($0, from: ["ScriptableObject"]) }
        let editors = types.filter { derives($0, from: UnityCatalog.editorBases) }

        for ty in behaviours {
            var coroutines = Set<String>()
            for m in ty.methods where m.isCoroutine { coroutines.insert(m.name) }
            for m in ty.methods {
                checkMessageSignature(m, in: ty)
                if UnityCatalog.frameMessages.contains(m.name) && m.parameterTypes.isEmpty && m.isBlockBody {
                    checkFrameMethod(m)
                }
                if m.isCoroutine && m.hasBody {
                    let hasYield = (m.bodyStart..<m.bodyEnd).contains { text($0) == "yield" }
                    if !hasYield {
                        report(.warning, .unity, "UNITY041", "Coroutine '\(m.name)' gibt IEnumerator zurück, enthält aber kein 'yield'.",
                               at: tokenAtLine(m.line), suggestion: "Mindestens ein 'yield return null;' einfügen.")
                    }
                }
                if m.hasBody {
                    checkDirectCoroutineCalls(m, coroutines: coroutines)
                }
            }
            for f in ty.fields where f.attributes.contains("SerializeField") && f.modifiers.contains("public") {
                diagnostics.append(CodeDiagnostic(severity: .info, source: .unity, ruleID: "UNITY072",
                                                  message: "[SerializeField] ist bei public-Feldern überflüssig ('\(f.name)').",
                                                  line: f.line, column: 1, suggestion: "Feld private machen oder Attribut entfernen."))
            }
        }

        // Whole-file token rules
        var reportedLegacyInput = false
        for i in 0..<t.count {
            let s = t[i].text
            // CS1612: transform.position.x = 5
            if UnityCatalog.structProperties.contains(s), text(i - 1) == ".", text(i + 1) == ".",
               UnityCatalog.structFields.contains(text(i + 2)),
               ["=", "+=", "-=", "*=", "/=", "++", "--"].contains(text(i + 3)) {
                let base = text(i - 2)
                report(.error, .unity, "CS1612",
                       "Der Rückgabewert von '\(base).\(s)' kann nicht geändert werden, da er keine Variable ist (Struct-Kopie).",
                       at: t[i + 2],
                       suggestion: "Zwischenvariable verwenden: var p = \(base).\(s); p.\(text(i + 2)) \(text(i + 3)) …; \(base).\(s) = p;")
            }
            // tag comparison
            if s == "tag" && t[i].kind != .string && (["==", "!="].contains(text(i + 1)) || ["==", "!="].contains(text(i - 1))) {
                report(.warning, .unity, "UNITY021", "Tag-Vergleich mit '==' erzeugt Garbage – CompareTag() ist schneller.", at: t[i],
                       suggestion: "other.CompareTag(\"Player\") verwenden.")
            }
            // new MonoBehaviour / ScriptableObject
            if s == "new", text(i + 2) == "(" {
                let typeName = text(i + 1)
                if behaviourNames.contains(typeName) || UnityCatalog.componentTypes.contains(typeName) || typeName == "MonoBehaviour" {
                    report(.warning, .unity, "UNITY031", "'\(typeName)' ist eine Komponente und darf nicht mit 'new' erzeugt werden.", at: t[i],
                           suggestion: "gameObject.AddComponent<\(typeName)>() verwenden.")
                } else if scriptables.contains(where: { $0.name == typeName }) || typeName == "ScriptableObject" {
                    report(.warning, .unity, "UNITY032", "ScriptableObjects werden mit ScriptableObject.CreateInstance<\(typeName)>() erzeugt, nicht mit 'new'.", at: t[i])
                }
            }
            // StartCoroutine("Name")
            if s == "StartCoroutine" && text(i + 1) == "(" && i + 2 < t.count && t[i + 2].kind == .string {
                report(.info, .unity, "UNITY040", "StartCoroutine mit String ist langsam und nicht typsicher.", at: t[i],
                       suggestion: "StartCoroutine(MeineCoroutine()) verwenden.")
            }
            // legacy input
            if s == "Input" && text(i + 1) == "." && UnityCatalog.legacyInputCalls.contains(text(i + 2)) && !reportedLegacyInput {
                reportedLegacyInput = true
                report(.info, .unity, "UNITY020", "Altes Input Manager API (Input.\(text(i + 2))). Mit 'Active Input Handling = Input System Package' wirft dies zur Laufzeit Exceptions.", at: t[i],
                       suggestion: "Für das neue Input System: Keyboard.current / InputAction verwenden oder 'Both' aktivieren.")
            }
        }

        // UnityEditor usage outside #if UNITY_EDITOR
        checkUnityEditorUsage(hasEditorClass: !editors.isEmpty)

        // File name
        if let fileName = options.fileName?.trimmingCharacters(in: .whitespaces), !fileName.isEmpty {
            let unityTypes = behaviours + scriptables + editors
            let topLevel = unityTypes.filter { $0.nestingDepth == 0 }
            if !topLevel.isEmpty && !topLevel.contains(where: { $0.name == fileName }) {
                let names = topLevel.map(\.name).joined(separator: ", ")
                diagnostics.append(CodeDiagnostic(severity: .warning, source: .unity, ruleID: "UNITY070",
                                                  message: "Skriptname '\(fileName)' entspricht keinem Klassennamen (\(names)). Unity kann die Komponente sonst nicht hinzufügen.",
                                                  line: topLevel[0].line, column: 1,
                                                  suggestion: "Skript in '\(topLevel[0].name)' umbenennen."))
            }
        }
        if behaviours.filter({ $0.nestingDepth == 0 }).count > 1 {
            diagnostics.append(CodeDiagnostic(severity: .info, source: .unity, ruleID: "UNITY071",
                                              message: "Mehrere MonoBehaviours in einer Datei – Unity kann nur die Klasse mit dem Dateinamen als Komponente verwenden.",
                                              line: behaviours[1].line, column: 1))
        }
    }

    func tokenAtLine(_ line: Int) -> CSharpToken? { t.first { $0.line == line } }

    func checkMessageSignature(_ m: MethodOutline, in ty: TypeOutline) {
        let name = m.name
        let ret = m.returnType
        if m.modifiers.contains("override") { return }
        if let sigs = UnityCatalog.messages[name] {
            let params = m.parameterTypes.map { $0.components(separatedBy: ".").last ?? $0 }
            if !sigs.contains(params) {
                var expected = sigs.first.map { $0.joined(separator: ", ") } ?? ""
                if expected.isEmpty { expected = "keine Parameter" }
                var hint = "Erwartet: \(name)(\(expected))."
                if name.hasPrefix("OnTrigger") || name.hasPrefix("OnCollision") {
                    let is2D = name.hasSuffix("2D")
                    if params.first?.hasSuffix("2D") == true && !is2D { hint = "Für 2D-Physik heißt die Methode \(name)2D(\(params[0]))." }
                    if params.first == "Collider" && name.hasPrefix("OnCollision") { hint = "OnCollision… erhält 'Collision', nicht 'Collider'." }
                    if params.first == "Collision" && name.hasPrefix("OnTrigger") { hint = "OnTrigger… erhält 'Collider', nicht 'Collision'." }
                }
                report(.warning, .unity, "UNITY002", "Falsche Signatur für Unity-Message '\(name)' – Unity ruft sie so nicht auf. \(hint)",
                       at: tokenAtLine(m.line), suggestion: hint)
            }
            if ret == "IEnumerator" && !UnityCatalog.coroutineMessages.contains(name) {
                report(.warning, .unity, "UNITY003", "'\(name)' kann keine Coroutine sein – Unity ignoriert den IEnumerator-Rückgabewert.",
                       at: tokenAtLine(m.line), suggestion: "Rückgabetyp 'void' verwenden und eine separate Coroutine starten.")
            }
            return
        }
        // Misspelled / wrong case message names
        guard ret == "void" || ret == "IEnumerator" else { return }
        let lower = name.lowercased()
        for msg in UnityCatalog.messages.keys {
            if msg.lowercased() == lower {
                report(.warning, .unity, "UNITY001", "'\(name)' wird von Unity nie aufgerufen – Groß-/Kleinschreibung beachten: '\(msg)'.",
                       at: tokenAtLine(m.line), suggestion: "In '\(msg)' umbenennen.")
                return
            }
        }
        for msg in UnityCatalog.messages.keys where msg.count >= 5 && abs(msg.count - name.count) <= 2 && msg.first?.lowercased() == lower.first.map(String.init) {
            let d = Worker.editDistance(lower, msg.lowercased())
            if d > 0 && d <= (msg.count >= 9 ? 2 : 1) {
                report(.warning, .unity, "UNITY001", "'\(name)' sieht aus wie ein Tippfehler von Unity-Message '\(msg)' – sie wird nie aufgerufen.",
                       at: tokenAtLine(m.line), suggestion: "In '\(msg)' umbenennen.")
                return
            }
        }
    }

    func checkFrameMethod(_ m: MethodOutline) {
        let body = m.bodyStart..<m.bodyEnd
        if body.isEmpty {
            report(.info, .unity, "UNITY010", "Leere '\(m.name)()'-Methode verursacht unnötigen Aufruf-Overhead pro Frame.",
                   at: tokenAtLine(m.line), suggestion: "Leere Methode entfernen.")
            return
        }
        var reportedCalls = Set<String>()
        for i in body {
            let s = text(i)
            if let label = UnityCatalog.expensiveFrameCalls[s], text(i + 1) == "(" || text(i + 1) == "<", !reportedCalls.contains(s) {
                if s == "AddComponent" && m.name != "Update" { continue }
                reportedCalls.insert(s)
                report(.warning, .unity, "UNITY011", "\(label) in \(m.name)() ist teuer, da es jeden Frame ausgeführt wird.", at: t[i],
                       suggestion: "Ergebnis in Awake()/Start() zwischenspeichern (cachen).")
            }
            if s == "Find" && text(i - 1) == "." && text(i - 2) == "GameObject" && !reportedCalls.contains("Find") {
                reportedCalls.insert("Find")
                report(.warning, .unity, "UNITY011", "GameObject.Find in \(m.name)() durchsucht jeden Frame die ganze Szene.", at: t[i],
                       suggestion: "Referenz in Start() cachen oder per [SerializeField] zuweisen.")
            }
            if s == "main" && text(i - 1) == "." && text(i - 2) == "Camera" && !reportedCalls.contains("Camera.main") {
                reportedCalls.insert("Camera.main")
                report(.info, .unity, "UNITY012", "Camera.main in \(m.name)() – in älteren Unity-Versionen ein FindWithTag-Aufruf pro Frame.", at: t[i],
                       suggestion: "Kamera in Start() cachen.")
            }
            if s == "Log" && text(i - 1) == "." && text(i - 2) == "Debug" && !reportedCalls.contains("Debug.Log") {
                reportedCalls.insert("Debug.Log")
                report(.info, .unity, "UNITY017", "Debug.Log in \(m.name)() kostet jeden Frame Performance und flutet die Konsole.", at: t[i])
            }
            if UnityCatalog.rigidbodyCalls.contains(s) && text(i - 1) == "." && (m.name == "Update" || m.name == "LateUpdate") && !reportedCalls.contains("rb") {
                reportedCalls.insert("rb")
                report(.info, .unity, "UNITY013", "Physik-Aufruf '\(s)' in \(m.name)() – Physik sollte in FixedUpdate() laufen.", at: t[i],
                       suggestion: "Eingaben in Update() lesen, Kräfte in FixedUpdate() anwenden.")
            }
            if m.name == "FixedUpdate" && s == "Input" && text(i + 1) == "." && ["GetKeyDown", "GetKeyUp", "GetButtonDown", "GetButtonUp", "GetMouseButtonDown", "GetMouseButtonUp"].contains(text(i + 2)) && !reportedCalls.contains("fixedInput") {
                reportedCalls.insert("fixedInput")
                report(.warning, .unity, "UNITY015", "Input.\(text(i + 2)) in FixedUpdate() verpasst Eingaben, da FixedUpdate nicht jeden Frame läuft.", at: t[i],
                       suggestion: "Eingabe in Update() lesen und in einem Feld speichern.")
            }
            if m.name == "Update" && (s == "SetBool" || s == "SetFloat" || s == "SetTrigger" || s == "SetInteger") && text(i + 1) == "(" && i + 2 < t.count && t[i + 2].kind == .string && !reportedCalls.contains("animhash") {
                reportedCalls.insert("animhash")
                report(.info, .unity, "UNITY016", "Animator.\(s) mit String in Update() – Parameter-Hash mit Animator.StringToHash cachen.", at: t[i])
            }
        }
        // frame-rate dependent movement
        if m.name == "Update" || m.name == "LateUpdate" {
            var stmtStart = m.bodyStart
            for i in body {
                if text(i) == ";" {
                    let stmt = stmtStart..<i
                    let moves = stmt.contains { (text($0) == "Translate" || text($0) == "Rotate") && text($0 - 1) == "." } ||
                        stmt.contains { text($0) == "position" && text($0 - 1) == "." && (text($0 + 1) == "+=" || text($0 + 1) == "-=") }
                    let usesDelta = stmt.contains { text($0) == "deltaTime" || text($0) == "smoothDeltaTime" || text($0) == "unscaledDeltaTime" } ||
                        stmt.contains { text($0) == "MoveTowards" || text($0) == "Lerp" || text($0) == "SmoothDamp" }
                    // only literal-ish movement: skip if a variable that may already contain deltaTime is used
                    if moves && !usesDelta {
                        let hasVariableOnly = stmt.contains { t[$0].kind == .identifier && text($0).lowercased().contains("delta") }
                        if !hasVariableOnly {
                            report(.info, .unity, "UNITY014", "Bewegung in \(m.name)() ohne Time.deltaTime ist von der Framerate abhängig.", at: t[stmtStart],
                                   suggestion: "Mit Time.deltaTime multiplizieren.")
                        }
                    }
                    stmtStart = i + 1
                } else if text(i) == "{" || text(i) == "}" {
                    stmtStart = i + 1
                }
            }
        }
    }

    func checkDirectCoroutineCalls(_ m: MethodOutline, coroutines: Set<String>) {
        guard !coroutines.isEmpty else { return }
        for i in m.bodyStart..<m.bodyEnd where coroutines.contains(text(i)) && text(i + 1) == "(" {
            let prev = text(i - 1)
            let atStatementStart = [";", "{", "}"].contains(prev) || (prev == "." && text(i - 2) == "this" && [";", "{", "}"].contains(text(i - 3)))
            guard atStatementStart, match[i + 1] > i + 1, text(match[i + 1] + 1) == ";" else { continue }
            report(.warning, .unity, "UNITY042", "Coroutine '\(text(i))()' wird direkt aufgerufen und deshalb nie ausgeführt.", at: t[i],
                   suggestion: "StartCoroutine(\(text(i))(…)) verwenden.")
        }
    }

    func checkUnityEditorUsage(hasEditorClass: Bool) {
        var conditionStack: [Bool] = [] // true = inside UNITY_EDITOR guard
        let all = lex.tokens
        var k = 0
        var reported = false
        while k < all.count {
            let tok = all[k]
            if tok.kind == .preprocessor {
                let dir = tok.text.trimmingCharacters(in: .whitespaces)
                if dir.hasPrefix("#if") { conditionStack.append(dir.contains("UNITY_EDITOR") && !dir.contains("!UNITY_EDITOR")) }
                else if dir.hasPrefix("#elif") || dir.hasPrefix("#else") { if !conditionStack.isEmpty { conditionStack[conditionStack.count - 1] = false } }
                else if dir.hasPrefix("#endif") { _ = conditionStack.popLast() }
            } else if tok.text == "UnityEditor" && !reported {
                let guarded = conditionStack.contains(true)
                if !guarded {
                    reported = true
                    if hasEditorClass {
                        diagnostics.append(CodeDiagnostic(severity: .info, source: .unity, ruleID: "UNITY051",
                                                          message: "Editor-Skript: Die Datei muss in einem Ordner namens 'Editor' liegen, sonst schlägt der Player-Build fehl.",
                                                          line: tok.line, column: tok.column))
                    } else {
                        diagnostics.append(CodeDiagnostic(severity: .warning, source: .unity, ruleID: "UNITY050",
                                                          message: "UnityEditor ist in Player-Builds nicht verfügbar – der Build schlägt fehl.",
                                                          line: tok.line, column: tok.column,
                                                          suggestion: "Mit '#if UNITY_EDITOR … #endif' umschließen oder in einen Editor-Ordner verschieben."))
                    }
                }
            }
            k += 1
        }
    }

    static func editDistance(_ a: String, _ b: String) -> Int {
        let a = Array(a), b = Array(b)
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var prev = Array(0...b.count)
        var cur = Array(repeating: 0, count: b.count + 1)
        for i in 1...a.count {
            cur[0] = i
            for j in 1...b.count {
                cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1))
                if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                    cur[j] = min(cur[j], prev[j - 1]) // transposition (approximate)
                }
            }
            swap(&prev, &cur)
        }
        return prev[b.count]
    }

    // MARK: 6. Classification

    func scriptKind() -> UnityScriptKind {
        let top = types.filter { $0.nestingDepth == 0 }
        guard !top.isEmpty else { return .empty }
        if top.contains(where: { derives($0, from: UnityCatalog.editorBases) }) { return .editorScript }
        if top.contains(where: { derives($0, from: ["StateMachineBehaviour"]) }) { return .stateMachineBehaviour }
        if top.contains(where: { isBehaviour($0) }) { return .monoBehaviour }
        if top.contains(where: { derives($0, from: ["ScriptableObject"]) }) { return .scriptableObject }
        if top.allSatisfy({ $0.kind == .interface }) { return .interface }
        if top.allSatisfy({ $0.kind == .enum }) { return .enumeration }
        if top.allSatisfy({ $0.kind == .struct || $0.kind == .record }) { return .dataStruct }
        // static utility: class whose methods are all static
        if let c = top.first(where: { $0.kind == .class }), !c.methods.isEmpty, c.methods.allSatisfy({ $0.modifiers.contains("static") }) {
            return .staticUtility
        }
        return .plainClass
    }

    func suggestCategories(kind: UnityScriptKind) -> [String] {
        var cats: [String] = []
        let words = Set(t.map(\.text))
        func has(_ any: [String]) -> Bool { any.contains { words.contains($0) } }
        if has(["NavMeshAgent", "NavMesh", "SetDestination"]) || types.contains(where: { $0.name.contains("Enemy") || $0.name.contains("AI") }) { cats.append("Enemy AI") }
        if has(["CharacterController", "PlayerInput"]) || types.contains(where: { $0.name.contains("Player") }) { cats.append("Player Controller") }
        if has(["Animator", "SetTrigger", "SetBool", "OnAnimatorIK", "AnimationCurve"]) { cats.append("Animation") }
        if has(["OnTriggerEnter", "OnTriggerEnter2D", "Interact", "IInteractable"]) { cats.append("Interactions") }
        if has(["Rigidbody", "Rigidbody2D", "AddForce", "Physics", "Raycast"]) { cats.append("Physics") }
        if has(["Canvas", "Image", "Button", "TextMeshProUGUI", "Slider"]) { cats.append("UI") }
        if has(["AudioSource", "AudioClip", "AudioMixer"]) { cats.append("Audio") }
        if has(["Camera", "Cinemachine", "CinemachineVirtualCamera"]) && !cats.contains("Player Controller") { cats.append("Camera") }
        if has(["Damage", "TakeDamage", "Health", "Attack", "hitPoints"]) { cats.append("Combat System") }
        if has(["InputAction", "Keyboard", "Gamepad", "InputSystem"]) { cats.append("Input System") }
        if has(["SaveData", "PlayerPrefs", "JsonUtility", "File"]) { cats.append("Save System") }
        if has(["Shader", "Material", "MaterialPropertyBlock", "Volume"]) { cats.append("Rendering") }
        if has(["SceneManager", "LoadSceneAsync"]) { cats.append("Scene Management") }
        switch kind {
        case .editorScript: cats.insert("Editor Tool", at: 0)
        case .scriptableObject: cats.insert("Data / ScriptableObject", at: 0)
        case .interface: cats.insert("Interfaces", at: 0)
        case .staticUtility: cats.insert("Utilities", at: 0)
        default: break
        }
        if has(["event", "Action", "UnityEvent", "delegate"]) { cats.append("Events") }
        if has(["IEnumerator", "StartCoroutine"]) { cats.append("Coroutines") }
        var seen = Set<String>()
        return cats.filter { seen.insert($0).inserted }
    }

    func detectComponents() -> [String] {
        var found = Set<String>()
        for (i, tok) in t.enumerated() where UnityCatalog.componentTypes.contains(tok.text) {
            // Field types, generic args (GetComponent<T>), typeof(T)
            let prev = text(i - 1), next = text(i + 1)
            if prev == "<" || prev == "(" && text(i - 2) == "typeof" || next.first.map({ $0.isLetter || $0 == "_" }) == true || next == "[" || next == ">" {
                found.insert(tok.text)
            }
        }
        return found.sorted()
    }

    func referencedTypes() -> [String] {
        var out = Set<String>()
        let declared = Set(types.map(\.name))
        for (i, tok) in t.enumerated() where (tok.kind == .typeName || tok.kind == .identifier) && CSharpLexer.isTypeLike(tok.text) {
            if text(i - 1) == "." { continue }
            if declared.contains(tok.text) { continue }
            if UnityCatalog.knownTypes.contains(tok.text) { continue }
            out.insert(tok.text)
        }
        return out.sorted()
    }
}

extension Worker.Ctx {
    var isExpressionLike: Bool { if case .expression = self { return true }; return false }
}
