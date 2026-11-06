import Foundation

/// Block-level Markdown model used for note previews and exports.
/// Inline formatting (bold, italic, `code`, links) is left in the text and rendered by
/// the UI layer (SwiftUI's `AttributedString(markdown:)` handles inline syntax).
public enum MarkdownBlock: Equatable, Sendable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case bulletList([ListItem])
    case orderedList(start: Int, items: [ListItem])
    case code(language: String, code: String)
    case quote(String)
    case callout(kind: String, text: String)
    case table(header: [String], rows: [[String]])
    case divider

    public struct ListItem: Equatable, Sendable {
        public var text: String
        public var indent: Int
        /// nil = no checkbox, true/false = task list item.
        public var checked: Bool?
    }
}

public enum MarkdownParser {

    public static func parse(_ source: String) -> [MarkdownBlock] {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var blocks: [MarkdownBlock] = []
        var i = 0
        var paragraph: [String] = []

        func flushParagraph() {
            if !paragraph.isEmpty {
                blocks.append(.paragraph(paragraph.joined(separator: "\n")))
                paragraph.removeAll()
            }
        }

        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Fenced code block
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                flushParagraph()
                let fence = String(trimmed.prefix(3))
                let lang = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces)
                var code: [String] = []
                i += 1
                while i < lines.count && !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(fence) {
                    code.append(lines[i]); i += 1
                }
                i += 1 // skip closing fence (or EOF)
                blocks.append(.code(language: lang.lowercased(), code: code.joined(separator: "\n")))
                continue
            }
            if trimmed.isEmpty { flushParagraph(); i += 1; continue }

            // Heading
            if trimmed.hasPrefix("#") {
                let level = trimmed.prefix(while: { $0 == "#" }).count
                let rest = trimmed.dropFirst(level)
                if level <= 6 && (rest.isEmpty || rest.hasPrefix(" ")) {
                    flushParagraph()
                    blocks.append(.heading(level: level, text: rest.trimmingCharacters(in: .whitespaces)))
                    i += 1; continue
                }
            }
            // Divider
            if trimmed.count >= 3, let f = trimmed.first, "-*_".contains(f),
               trimmed.allSatisfy({ $0 == f || $0 == " " }), trimmed.filter({ $0 == f }).count >= 3 {
                flushParagraph()
                blocks.append(.divider)
                i += 1; continue
            }
            // Quote / callout
            if trimmed.hasPrefix(">") {
                flushParagraph()
                var q: [String] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
                    var l = lines[i].trimmingCharacters(in: .whitespaces).dropFirst()
                    if l.hasPrefix(" ") { l = l.dropFirst() }
                    q.append(String(l)); i += 1
                }
                if let first = q.first, first.hasPrefix("[!"), let close = first.firstIndex(of: "]") {
                    let kind = first[first.index(first.startIndex, offsetBy: 2)..<close].lowercased()
                    let rest = ([String(first[first.index(after: close)...]).trimmingCharacters(in: .whitespaces)] + q.dropFirst())
                        .filter { !$0.isEmpty }.joined(separator: "\n")
                    blocks.append(.callout(kind: kind, text: rest))
                } else {
                    blocks.append(.quote(q.joined(separator: "\n")))
                }
                continue
            }
            // Table: header | separator
            if trimmed.hasPrefix("|") && i + 1 < lines.count && isTableSeparator(lines[i + 1]) {
                flushParagraph()
                let header = splitRow(trimmed)
                i += 2
                var rows: [[String]] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    rows.append(splitRow(lines[i].trimmingCharacters(in: .whitespaces))); i += 1
                }
                blocks.append(.table(header: header, rows: rows))
                continue
            }
            // Lists
            if let first = listMarker(line) {
                flushParagraph()
                var items: [MarkdownBlock.ListItem] = []
                let ordered = first.ordered
                let start = first.number
                while i < lines.count, let m = listMarker(lines[i]), m.ordered == ordered || m.indent > 0 {
                    var text = m.text
                    var checked: Bool? = nil
                    if text.hasPrefix("[ ] ") || text == "[ ]" { checked = false; text = String(text.dropFirst(3)).trimmingCharacters(in: .whitespaces) }
                    else if text.lowercased().hasPrefix("[x] ") || text.lowercased() == "[x]" { checked = true; text = String(text.dropFirst(3)).trimmingCharacters(in: .whitespaces) }
                    items.append(.init(text: text, indent: m.indent, checked: checked))
                    i += 1
                    // continuation lines (indented, non-marker)
                    while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).isEmpty,
                          listMarker(lines[i]) == nil, lines[i].hasPrefix("  ") {
                        items[items.count - 1].text += " " + lines[i].trimmingCharacters(in: .whitespaces)
                        i += 1
                    }
                }
                blocks.append(ordered ? .orderedList(start: start, items: items) : .bulletList(items))
                continue
            }
            paragraph.append(line)
            i += 1
        }
        flushParagraph()
        return blocks
    }

    struct Marker { var ordered: Bool; var number: Int; var indent: Int; var text: String }

    static func listMarker(_ line: String) -> Marker? {
        let leading = line.prefix(while: { $0 == " " || $0 == "\t" })
        let indent = leading.reduce(0) { $0 + ($1 == "\t" ? 4 : 1) } / 2
        let rest = line.dropFirst(leading.count)
        if let f = rest.first, "-*+".contains(f), rest.dropFirst().hasPrefix(" ") {
            return Marker(ordered: false, number: 0, indent: indent, text: String(rest.dropFirst(2)))
        }
        let digits = rest.prefix(while: { $0.isNumber })
        if !digits.isEmpty, digits.count < 10 {
            let after = rest.dropFirst(digits.count)
            if (after.hasPrefix(". ") || after.hasPrefix(") ")) {
                return Marker(ordered: true, number: Int(digits) ?? 1, indent: indent, text: String(after.dropFirst(2)))
            }
        }
        return nil
    }

    static func isTableSeparator(_ line: String) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard t.contains("-"), t.hasPrefix("|") || t.hasPrefix("-") || t.hasPrefix(":") else { return false }
        return t.allSatisfy { "|-: ".contains($0) }
    }

    static func splitRow(_ row: String) -> [String] {
        var r = row
        if r.hasPrefix("|") { r.removeFirst() }
        if r.hasSuffix("|") { r.removeLast() }
        return r.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /// Plain text rendering (used for search snippets and TXT export).
    public static func plainText(_ source: String) -> String {
        var out: [String] = []
        for block in parse(source) {
            switch block {
            case .heading(_, let t): out.append(stripInline(t))
            case .paragraph(let t): out.append(stripInline(t))
            case .bulletList(let items):
                out.append(items.map { String(repeating: "  ", count: $0.indent) + ($0.checked == nil ? "• " : ($0.checked! ? "☑ " : "☐ ")) + stripInline($0.text) }.joined(separator: "\n"))
            case .orderedList(let start, let items):
                out.append(items.enumerated().map { "\(start + $0.offset). " + stripInline($0.element.text) }.joined(separator: "\n"))
            case .code(_, let c): out.append(c)
            case .quote(let q): out.append(stripInline(q))
            case .callout(let k, let t): out.append(k.uppercased() + ": " + stripInline(t))
            case .table(let h, let rows): out.append(([h] + rows).map { $0.joined(separator: "\t") }.joined(separator: "\n"))
            case .divider: out.append("———")
            }
        }
        return out.joined(separator: "\n\n")
    }

    /// Removes inline markdown markers (**, *, `, [text](url)).
    public static func stripInline(_ s: String) -> String {
        var r = s
        // links [text](url) -> text
        while let open = r.range(of: "["), let mid = r.range(of: "](", range: open.upperBound..<r.endIndex),
              let close = r.range(of: ")", range: mid.upperBound..<r.endIndex) {
            let text = r[open.upperBound..<mid.lowerBound]
            r.replaceSubrange(open.lowerBound..<close.upperBound, with: text)
        }
        for marker in ["**", "__", "~~", "`"] { r = r.replacingOccurrences(of: marker, with: "") }
        return r
    }

    /// Extracts the first heading or first line to use as an automatic title.
    public static func suggestedTitle(_ source: String) -> String? {
        for block in parse(source) {
            switch block {
            case .heading(_, let t) where !t.isEmpty: return stripInline(t)
            case .paragraph(let p):
                let first = p.components(separatedBy: "\n").first ?? p
                let s = stripInline(first).trimmingCharacters(in: .whitespaces)
                if !s.isEmpty { return String(s.prefix(60)) }
            default: continue
            }
        }
        return nil
    }
}
