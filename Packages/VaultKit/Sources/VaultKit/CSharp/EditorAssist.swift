import Foundation

/// Pure text-editing helpers used by the code editor (auto-indent, bracket matching,
/// comment toggling). All offsets are UTF-16 based to match `NSRange`.
public enum EditorAssist {

    public struct Edit: Equatable, Sendable {
        /// Range to replace (UTF-16).
        public var range: NSRange
        public var replacement: String
        /// Caret position after the edit (UTF-16, absolute).
        public var caret: Int
    }

    /// Leading whitespace of the line containing `offset`.
    public static func lineIndent(in text: NSString, at offset: Int) -> String {
        let lineRange = text.lineRange(for: NSRange(location: min(offset, text.length), length: 0))
        var end = lineRange.location
        while end < NSMaxRange(lineRange) {
            let c = text.character(at: end)
            if c == 32 || c == 9 { end += 1 } else { break }
        }
        return text.substring(with: NSRange(location: lineRange.location, length: end - lineRange.location))
    }

    /// Computes the edit for pressing Return at `range` (smart indentation).
    /// - `{|}` becomes an indented empty line with the `}` on its own line.
    public static func newlineEdit(in text: NSString, range: NSRange, indentUnit: String) -> Edit {
        let indent = lineIndent(in: text, at: range.location)
        // Previous significant character before caret on the same line.
        let lineStart = text.lineRange(for: NSRange(location: range.location, length: 0)).location
        var p = range.location - 1
        var prevChar: unichar = 0
        while p >= lineStart {
            let c = text.character(at: p)
            if c != 32 && c != 9 { prevChar = c; break }
            p -= 1
        }
        var nextChar: unichar = 0
        var q = NSMaxRange(range)
        while q < text.length {
            let c = text.character(at: q)
            if c == 32 || c == 9 { q += 1; continue }
            if c != 10 && c != 13 { nextChar = c }
            break
        }
        let opens = prevChar == 123 || prevChar == 40 || prevChar == 91 // { ( [
        let closesMatch = (prevChar == 123 && nextChar == 125) || (prevChar == 40 && nextChar == 41) || (prevChar == 91 && nextChar == 93)
        if opens && closesMatch {
            let inner = "\n" + indent + indentUnit
            let replacement = inner + "\n" + indent
            return Edit(range: range, replacement: replacement, caret: range.location + (inner as NSString).length)
        }
        let replacement = "\n" + indent + (opens ? indentUnit : "")
        return Edit(range: range, replacement: replacement, caret: range.location + (replacement as NSString).length)
    }

    /// When typing `}` on a line that contains only whitespace, out-dent the line by one unit.
    public static func closingBraceEdit(in text: NSString, range: NSRange, indentUnit: String) -> Edit? {
        let lineRange = text.lineRange(for: NSRange(location: range.location, length: 0))
        let before = text.substring(with: NSRange(location: lineRange.location, length: range.location - lineRange.location))
        guard !before.isEmpty, before.allSatisfy({ $0 == " " || $0 == "\t" }) else { return nil }
        // Find indentation of the matching '{'
        if let open = matchingOpenBrace(in: text, before: range.location) {
            let target = lineIndent(in: text, at: open)
            let r = NSRange(location: lineRange.location, length: range.location - lineRange.location + range.length)
            return Edit(range: r, replacement: target + "}", caret: lineRange.location + (target as NSString).length + 1)
        }
        let unitLen = (indentUnit as NSString).length
        var newIndent = before
        if before.hasSuffix(indentUnit) { newIndent = String(before.dropLast(indentUnit.count)) }
        else if before.hasSuffix("\t") { newIndent = String(before.dropLast()) }
        _ = unitLen
        let r = NSRange(location: lineRange.location, length: range.location - lineRange.location + range.length)
        return Edit(range: r, replacement: newIndent + "}", caret: lineRange.location + (newIndent as NSString).length + 1)
    }

    /// Scans backwards for the unmatched '{' before `offset`, ignoring strings and comments.
    public static func matchingOpenBrace(in text: NSString, before offset: Int) -> Int? {
        let lex = CSharpLexer().lex(text.substring(to: min(offset, text.length)))
        var depth = 0
        for tok in lex.tokens.reversed() where tok.kind == .punctuation {
            if tok.text == "}" { depth += 1 }
            else if tok.text == "{" {
                if depth == 0 { return tok.location }
                depth -= 1
            }
        }
        return nil
    }

    /// Finds the bracket matching the one adjacent to `caret` (before or after it).
    /// Returns the pair of UTF-16 locations, or nil.
    public static func bracketPair(tokens: [CSharpToken], caret: Int) -> (Int, Int)? {
        // Candidate: bracket token immediately before caret, else immediately at caret.
        var idx: Int? = nil
        for (k, tok) in tokens.enumerated() where tok.kind == .punctuation && "()[]{}".contains(tok.text) {
            if tok.location == caret - 1 { idx = k; break }
            if tok.location == caret { idx = k }
            if tok.location > caret { break }
        }
        guard let start = idx else { return nil }
        let open: Set<String> = ["(", "[", "{"]
        let pairs: [String: String] = ["(": ")", "[": "]", "{": "}", ")": "(", "]": "[", "}": "{"]
        let s = tokens[start].text
        let target = pairs[s]!
        var depth = 0
        if open.contains(s) {
            var k = start + 1
            while k < tokens.count {
                let t = tokens[k]
                if t.kind == .punctuation {
                    if t.text == s { depth += 1 }
                    else if t.text == target {
                        if depth == 0 { return (tokens[start].location, t.location) }
                        depth -= 1
                    }
                }
                k += 1
            }
        } else {
            var k = start - 1
            while k >= 0 {
                let t = tokens[k]
                if t.kind == .punctuation {
                    if t.text == s { depth += 1 }
                    else if t.text == target {
                        if depth == 0 { return (t.location, tokens[start].location) }
                        depth -= 1
                    }
                }
                k -= 1
            }
        }
        return nil
    }

    /// Toggles `//` line comments for all lines touched by `range`.
    public static func toggleLineComment(in text: NSString, range: NSRange) -> Edit {
        let lines = text.lineRange(for: range)
        let block = text.substring(with: lines)
        var parts = block.components(separatedBy: "\n")
        let trailingNewline = block.hasSuffix("\n")
        if trailingNewline { parts.removeLast() }
        let allCommented = parts.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            .allSatisfy { $0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
        let minIndent = parts.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            .map { $0.prefix(while: { $0 == " " || $0 == "\t" }).count }.min() ?? 0
        let newParts = parts.map { line -> String in
            if line.trimmingCharacters(in: .whitespaces).isEmpty { return line }
            if allCommented {
                guard let r = line.range(of: "//") else { return line }
                var l = line
                l.removeSubrange(r)
                if l[r.lowerBound...].hasPrefix(" ") { l.remove(at: r.lowerBound) }
                return l
            }
            let idx = line.index(line.startIndex, offsetBy: minIndent)
            return String(line[..<idx]) + "// " + String(line[idx...])
        }
        let replacement = newParts.joined(separator: "\n") + (trailingNewline ? "\n" : "")
        return Edit(range: lines, replacement: replacement, caret: lines.location + (replacement as NSString).length - (trailingNewline ? 1 : 0))
    }

    /// Indents (or out-dents) all lines touched by `range`.
    public static func shiftLines(in text: NSString, range: NSRange, indentUnit: String, outdent: Bool) -> Edit {
        let lines = text.lineRange(for: range)
        let block = text.substring(with: lines)
        var parts = block.components(separatedBy: "\n")
        let trailingNewline = block.hasSuffix("\n")
        if trailingNewline { parts.removeLast() }
        let newParts = parts.map { line -> String in
            if outdent {
                if line.hasPrefix(indentUnit) { return String(line.dropFirst(indentUnit.count)) }
                if line.hasPrefix("\t") { return String(line.dropFirst()) }
                return String(line.drop(while: { $0 == " " }))
            }
            return line.isEmpty ? line : indentUnit + line
        }
        let replacement = newParts.joined(separator: "\n") + (trailingNewline ? "\n" : "")
        return Edit(range: lines, replacement: replacement, caret: lines.location + (replacement as NSString).length - (trailingNewline ? 1 : 0))
    }

    /// Auto-closing pairs. Returns the text to insert and the caret offset inside it.
    public static func autoPair(for typed: String, nextChar: unichar?) -> (String, Int)? {
        let isWordChar: (unichar) -> Bool = { c in (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c == 95 }
        if let n = nextChar, isWordChar(n) { return nil }
        switch typed {
        case "(": return ("()", 1)
        case "[": return ("[]", 1)
        case "{": return ("{}", 1)
        case "\"": return ("\"\"", 1)
        default: return nil
        }
    }

    /// Re-indents a whole C# document based on brace depth (used by "Format Document").
    public static func reindent(_ source: String, indentUnit: String) -> String {
        let lex = CSharpLexer().lex(source)
        let ns = source as NSString
        // depth at start of each line
        let lineCount = lex.lineStarts.count + 1
        var depthAtLine = Array(repeating: 0, count: lineCount + 1)
        var openStack: [Int] = [] // line numbers of currently open brackets
        func depth() -> Int { var seen = Set<Int>(); for l in openStack { seen.insert(l) }; return seen.count }
        var currentLine = 1
        var lineFirstTokenIsClose = Array(repeating: false, count: lineCount + 1)
        var seenTokenOnLine = Array(repeating: false, count: lineCount + 1)
        // Lines inside multi-line tokens (block comments, verbatim strings) are left untouched.
        var protectedLines = Set<Int>()
        for tok in lex.tokens {
            if tok.kind == .whitespace { continue }
            while currentLine < tok.line { currentLine += 1; depthAtLine[currentLine] = depth() }
            if tok.kind == .comment || tok.kind == .docComment || tok.kind == .string {
                let lines = ns.substring(with: tok.range).components(separatedBy: "\n").count
                if lines > 1 { for l in (tok.line + 1)..<(tok.line + lines) { protectedLines.insert(l) } }
            }
            if !seenTokenOnLine[tok.line] {
                seenTokenOnLine[tok.line] = true
                if tok.kind == .punctuation && (tok.text == "}" || tok.text == ")" || tok.text == "]") { lineFirstTokenIsClose[tok.line] = true }
            }
            if tok.kind == .punctuation {
                if tok.text == "{" || tok.text == "(" || tok.text == "[" { openStack.append(tok.line) }
                else if tok.text == "}" || tok.text == ")" || tok.text == "]" { _ = openStack.popLast() }
            }
        }
        while currentLine < lineCount { currentLine += 1; depthAtLine[currentLine] = depth() }
        var out: [String] = []
        let lines = source.components(separatedBy: "\n")
        for (i, line) in lines.enumerated() {
            let lineNo = i + 1
            if protectedLines.contains(lineNo) { out.append(line); continue }
            let trimmed = line.trimmingCharacters(in: CharacterSet(charactersIn: " \t"))
            if trimmed.isEmpty { out.append(""); continue }
            if trimmed.hasPrefix("#") { out.append(trimmed); continue }
            var d = lineNo < depthAtLine.count ? depthAtLine[lineNo] : 0
            if lineNo < lineFirstTokenIsClose.count && lineFirstTokenIsClose[lineNo] { d = max(0, d - 1) }
            out.append(String(repeating: indentUnit, count: d) + trimmed)
        }
        return out.joined(separator: "\n")
    }
}
