import Foundation

public enum SearchEntityKind: String, Codable, Sendable, CaseIterable {
    case note, prompt, script, folder

    public init(_ k: VaultItemKind) {
        switch k {
        case .note: self = .note
        case .prompt: self = .prompt
        case .script: self = .script
        }
    }
}

public enum SearchField: String, Sendable, CaseIterable {
    case title, tags, summary, category, folder, content, code

    var weight: Double {
        switch self {
        case .title: return 10
        case .tags: return 7
        case .category: return 5
        case .summary: return 5
        case .folder: return 4
        case .code: return 2
        case .content: return 2
        }
    }
}

public struct SearchDocument: Sendable, Identifiable {
    public var id: UUID
    public var kind: SearchEntityKind
    public var title: String
    public var summary: String
    public var content: String
    public var tags: [String]
    public var category: String
    public var folderPath: [String]
    public var project: String?
    public var status: String?
    public var isFavorite: Bool
    public var modifiedAt: Date

    public init(id: UUID, kind: SearchEntityKind, title: String, summary: String = "", content: String = "",
                tags: [String] = [], category: String = "", folderPath: [String] = [], project: String? = nil,
                status: String? = nil, isFavorite: Bool = false, modifiedAt: Date = Date()) {
        self.id = id; self.kind = kind; self.title = title; self.summary = summary; self.content = content
        self.tags = tags; self.category = category; self.folderPath = folderPath; self.project = project
        self.status = status; self.isFavorite = isFavorite; self.modifiedAt = modifiedAt
    }
}

public struct SearchQuery: Sendable, Equatable {
    public enum Mode: String, Sendable, CaseIterable {
        /// Word based: every term must appear somewhere (title, tags, code identifiers …).
        case smart
        /// Exact substring match, e.g. for code fragments like `GetComponent<Rigidbody>()`.
        case exact
    }
    public var text: String
    public var mode: Mode
    public var caseSensitive: Bool
    public var kinds: Set<SearchEntityKind>
    public var projects: Set<String>
    public var categories: Set<String>
    public var tags: Set<String>
    public var statuses: Set<String>
    public var favoritesOnly: Bool

    public init(text: String = "", mode: Mode = .smart, caseSensitive: Bool = false, kinds: Set<SearchEntityKind> = [],
                projects: Set<String> = [], categories: Set<String> = [], tags: Set<String> = [],
                statuses: Set<String> = [], favoritesOnly: Bool = false) {
        self.text = text; self.mode = mode; self.caseSensitive = caseSensitive; self.kinds = kinds
        self.projects = projects; self.categories = categories; self.tags = tags; self.statuses = statuses
        self.favoritesOnly = favoritesOnly
    }

    public var hasFilters: Bool {
        !kinds.isEmpty || !projects.isEmpty || !categories.isEmpty || !tags.isEmpty || !statuses.isEmpty || favoritesOnly
    }
}

public struct SearchHit: Sendable, Identifiable {
    public var id: UUID
    public var kind: SearchEntityKind
    public var score: Double
    public var matchedFields: [SearchField]
    /// One line of context around the first content match.
    public var snippet: String
    /// Highlight ranges inside `snippet` (UTF-16 offsets).
    public var highlights: [NSRange]
    /// 1-based line number of the snippet in the content (if the match is in the content).
    public var line: Int?
    public var matchCount: Int
}

/// In-memory full-text index. Building is O(total text); searching is a linear scan over
/// pre-lowercased fields, which handles tens of thousands of documents comfortably.
public final class SearchIndex: @unchecked Sendable {

    struct Entry {
        var doc: SearchDocument
        var title: String
        var tags: String
        var summary: String
        var category: String
        var folder: String
        var content: String
        /// Identifier words from code, e.g. "SpiderLegAnimator" -> "spider leg animator"
        var codeWords: String
    }

    private var entries: [Entry] = []

    public init(documents: [SearchDocument] = []) {
        rebuild(documents)
    }

    public var count: Int { entries.count }

    public func rebuild(_ documents: [SearchDocument]) {
        entries = documents.map(SearchIndex.makeEntry)
    }

    static func makeEntry(_ d: SearchDocument) -> Entry {
        let words = d.kind == .script ? SearchIndex.codeWords(d.content) : ""
        return Entry(doc: d,
                     title: d.title.lowercased() + " " + TextUtil.identifierWords(d.title).joined(separator: " "),
                     tags: d.tags.joined(separator: " ").lowercased(),
                     summary: d.summary.lowercased(),
                     category: d.category.lowercased(),
                     folder: d.folderPath.joined(separator: " / ").lowercased(),
                     content: d.content.lowercased(),
                     codeWords: words)
    }

    static func codeWords(_ code: String) -> String {
        var out = Set<String>()
        var current = ""
        for ch in code {
            if ch.isLetter || ch.isNumber || ch == "_" { current.append(ch) }
            else {
                if current.count > 2 { for w in TextUtil.identifierWords(current) where w.count > 1 { out.insert(w) } }
                current = ""
            }
        }
        if current.count > 2 { for w in TextUtil.identifierWords(current) { out.insert(w) } }
        return out.sorted().joined(separator: " ")
    }

    /// Very small suffix stemmer for German/English search terms ("animation" ~ "animator").
    public static func stem(_ w: String) -> String {
        guard w.count > 4 else { return w }
        let suffixes = ["ations", "ation", "ions", "ion", "ers", "er", "ing", "ors", "or", "ed", "es", "en", "s", "e"]
        for s in suffixes where w.hasSuffix(s) && w.count - s.count >= 4 {
            return String(w.dropLast(s.count))
        }
        return w
    }

    static func tokenize(_ q: String) -> [String] {
        // Quoted phrases stay together.
        var terms: [String] = []
        var current = ""
        var inQuotes = false
        for ch in q {
            if ch == "\"" { inQuotes.toggle(); if !current.isEmpty { terms.append(current); current = "" }; continue }
            if ch.isWhitespace && !inQuotes { if !current.isEmpty { terms.append(current); current = "" }; continue }
            current.append(ch)
        }
        if !current.isEmpty { terms.append(current) }
        return terms.map { $0.lowercased() }.filter { !$0.isEmpty }
    }

    public func search(_ query: SearchQuery, limit: Int = 300) -> [SearchHit] {
        let raw = query.text.trimmingCharacters(in: .whitespacesAndNewlines)
        var hits: [SearchHit] = []
        let terms = query.mode == .smart ? SearchIndex.tokenize(raw) : []
        let stems = terms.map(SearchIndex.stem)

        for e in entries {
            let d = e.doc
            // Filters
            if !query.kinds.isEmpty && !query.kinds.contains(d.kind) { continue }
            if query.favoritesOnly && !d.isFavorite { continue }
            if !query.projects.isEmpty && !(d.project.map { query.projects.contains($0) } ?? false) { continue }
            if !query.categories.isEmpty && !query.categories.contains(d.category) { continue }
            if !query.statuses.isEmpty && !(d.status.map { query.statuses.contains($0) } ?? false) { continue }
            if !query.tags.isEmpty {
                let lowerTags = Set(d.tags.map { $0.lowercased() })
                if !query.tags.allSatisfy({ lowerTags.contains($0.lowercased()) }) { continue }
            }

            if raw.isEmpty {
                // Filter-only search: list by recency.
                hits.append(SearchHit(id: d.id, kind: d.kind, score: d.modifiedAt.timeIntervalSince1970 / 1e10,
                                      matchedFields: [], snippet: firstLine(d), highlights: [], line: nil, matchCount: 0))
                continue
            }

            if query.mode == .exact {
                if let hit = exactMatch(e, raw, caseSensitive: query.caseSensitive) { hits.append(hit) }
                continue
            }

            var score = 0.0
            var fields = Set<SearchField>()
            var allMatched = true
            for (ti, term) in terms.enumerated() {
                let st = stems[ti]
                var termScore = 0.0
                func check(_ text: String, _ f: SearchField) {
                    if text.contains(term) {
                        termScore += f.weight * (wordBoundaryMatch(text, term) ? 1.5 : 1.0)
                        fields.insert(f)
                    } else if st != term && text.contains(st) {
                        termScore += f.weight * 0.6
                        fields.insert(f)
                    }
                }
                check(e.title, .title)
                check(e.tags, .tags)
                check(e.summary, .summary)
                check(e.category, .category)
                check(e.folder, .folder)
                if e.content.contains(term) || (st != term && e.content.contains(st)) {
                    let f: SearchField = d.kind == .script ? .code : .content
                    let occurrences = min(10, countOccurrences(e.content, term.count >= 3 ? term : st))
                    termScore += f.weight * (1.0 + log2(Double(max(1, occurrences))))
                    fields.insert(f)
                } else if !e.codeWords.isEmpty && e.codeWords.contains(st) {
                    termScore += SearchField.code.weight
                    fields.insert(.code)
                }
                if termScore == 0 { allMatched = false; break }
                score += termScore
            }
            guard allMatched else { continue }
            // Phrase bonus
            let phrase = terms.joined(separator: " ")
            if terms.count > 1 && (e.title.contains(phrase) || e.content.contains(phrase)) { score *= 1.5 }
            if d.isFavorite { score *= 1.1 }
            // Recency tie-breaker
            score += d.modifiedAt.timeIntervalSince1970 / 1e10

            let (snippet, ranges, line, count) = makeSnippet(d.content, terms: terms + stems.filter { !terms.contains($0) }, caseSensitive: false)
            let ordered = SearchField.allCases.filter { fields.contains($0) }
            hits.append(SearchHit(id: d.id, kind: d.kind, score: score, matchedFields: ordered,
                                  snippet: snippet.isEmpty ? firstLine(d) : snippet,
                                  highlights: snippet.isEmpty ? [] : ranges, line: line, matchCount: count))
        }
        hits.sort { $0.score > $1.score }
        return Array(hits.prefix(limit))
    }

    private func exactMatch(_ e: Entry, _ needle: String, caseSensitive: Bool) -> SearchHit? {
        let d = e.doc
        let options: String.CompareOptions = caseSensitive ? [] : [.caseInsensitive]
        var fields: [SearchField] = []
        if d.title.range(of: needle, options: options) != nil { fields.append(.title) }
        if d.summary.range(of: needle, options: options) != nil { fields.append(.summary) }
        if d.tags.joined(separator: " ").range(of: needle, options: options) != nil { fields.append(.tags) }
        if d.folderPath.joined(separator: "/").range(of: needle, options: options) != nil { fields.append(.folder) }
        let inContent = d.content.range(of: needle, options: options) != nil
        if inContent { fields.append(d.kind == .script ? .code : .content) }
        guard !fields.isEmpty else { return nil }
        let (snippet, ranges, line, count) = makeSnippet(d.content, terms: [needle], caseSensitive: caseSensitive)
        let score = fields.reduce(0) { $0 + $1.weight } + Double(count)
        return SearchHit(id: d.id, kind: d.kind, score: score, matchedFields: fields,
                         snippet: snippet.isEmpty ? firstLine(d) : snippet, highlights: ranges, line: line, matchCount: count)
    }

    private func wordBoundaryMatch(_ text: String, _ term: String) -> Bool {
        guard let r = text.range(of: term) else { return false }
        if r.lowerBound == text.startIndex { return true }
        let before = text[text.index(before: r.lowerBound)]
        return !(before.isLetter || before.isNumber)
    }

    private func countOccurrences(_ text: String, _ term: String) -> Int {
        guard !term.isEmpty else { return 0 }
        var count = 0
        var range = text.startIndex..<text.endIndex
        while let r = text.range(of: term, range: range) {
            count += 1
            range = r.upperBound..<text.endIndex
            if count >= 50 { break }
        }
        return count
    }

    private func firstLine(_ d: SearchDocument) -> String {
        if !d.summary.isEmpty { return d.summary }
        let line = d.content.split(separator: "\n", omittingEmptySubsequences: true).first.map(String.init) ?? ""
        return String(line.trimmingCharacters(in: .whitespaces).prefix(140))
    }

    /// Finds the first line containing any term and returns it with highlight ranges.
    func makeSnippet(_ content: String, terms: [String], caseSensitive: Bool) -> (String, [NSRange], Int?, Int) {
        guard !content.isEmpty, !terms.isEmpty else { return ("", [], nil, 0) }
        let options: String.CompareOptions = caseSensitive ? [] : [.caseInsensitive]
        var lineNo = 0
        var total = 0
        var best: (String, Int)? = nil
        for line in content.components(separatedBy: "\n") {
            lineNo += 1
            for term in terms where line.range(of: term, options: options) != nil {
                total += 1
                if best == nil { best = (line, lineNo) }
                break
            }
            if total > 200 { break }
        }
        guard let (line, n) = best else { return ("", [], nil, 0) }
        var snippet = line.trimmingCharacters(in: .whitespaces)
        // Center around first match when the line is long.
        if snippet.count > 160, let r = snippet.range(of: terms[0], options: options) {
            let startOffset = max(0, snippet.distance(from: snippet.startIndex, to: r.lowerBound) - 50)
            let start = snippet.index(snippet.startIndex, offsetBy: startOffset)
            let end = snippet.index(start, offsetBy: min(160, snippet.distance(from: start, to: snippet.endIndex)))
            snippet = (startOffset > 0 ? "…" : "") + String(snippet[start..<end]) + "…"
        }
        let ns = snippet as NSString
        var ranges: [NSRange] = []
        for term in terms {
            var searchRange = NSRange(location: 0, length: ns.length)
            while true {
                let r = ns.range(of: term, options: caseSensitive ? [] : [.caseInsensitive], range: searchRange)
                if r.location == NSNotFound { break }
                ranges.append(r)
                let next = NSMaxRange(r)
                if next >= ns.length { break }
                searchRange = NSRange(location: next, length: ns.length - next)
            }
        }
        return (snippet, ranges, n, total)
    }

    /// All tags with usage counts (for filter chips / autocompletion).
    public func tagCounts() -> [(String, Int)] {
        var counts: [String: Int] = [:]
        for e in entries { for t in e.doc.tags { counts[t, default: 0] += 1 } }
        return counts.sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }
    }
}
