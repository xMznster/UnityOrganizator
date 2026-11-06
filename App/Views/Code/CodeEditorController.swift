import SwiftUI
import UIKit
import VaultKit

enum EditorLanguage {
    case csharp
    case markdown
}

/// Colored text span (UTF-16 range) produced by a highlighter.
struct HighlightSpan {
    enum Kind {
        case token(CSharpTokenKind)
        case mdHeading, mdMarker, mdCode, mdQuote, mdLink, mdEmphasis
    }
    var location: Int
    var length: Int
    var kind: Kind
    var end: Int { location + length }
}

/// Owns the UITextView and implements all IDE behaviour. SwiftUI views talk to the editor only
/// through this controller (so typing never causes SwiftUI re-renders of the whole screen).
@MainActor
final class CodeEditorController: NSObject, ObservableObject, UITextViewDelegate {
    let textView: CodeTextView
    let language: EditorLanguage

    // Published editor state
    @Published private(set) var line = 1
    @Published private(set) var column = 1
    @Published private(set) var canUndo = false
    @Published private(set) var canRedo = false
    @Published private(set) var lineCount = 1
    @Published private(set) var selectionLength = 0
    @Published private(set) var matchCount = 0
    @Published private(set) var currentMatchIndex = 0

    /// Called (not debounced) on every text change. The owner debounces persistence.
    var onTextChange: ((String) -> Void)?
    var onFontSizeChange: ((CGFloat) -> Void)?

    var palette: EditorPalette { didSet { applyPalette() } }
    var fontSize: CGFloat { didSet { applyFont() } }
    var indentUnit = "    "
    var autoPair = true
    var showsLineNumbers = true { didSet { textView.showsLineNumbers = showsLineNumbers && language == .csharp } }

    var diagnostics: [CodeDiagnostic] = [] {
        didSet {
            var markers: [Int: DiagnosticSeverity] = [:]
            for d in diagnostics { if let cur = markers[d.line] { markers[d.line] = min(cur, d.severity) } else { markers[d.line] = d.severity } }
            textView.gutter.markers = markers
            textView.gutter.setNeedsDisplay()
            rehighlightVisible(force: true)
        }
    }

    private(set) var tokens: [CSharpToken] = []
    private var spans: [HighlightSpan] = []
    private var lineStarts: [Int] = [0]
    private var highlightedRange = NSRange(location: 0, length: 0)
    private var highlightWork: DispatchWorkItem?
    private var bracketRanges: [NSRange] = []
    private var findMatches: [NSRange] = []
    private var isApplyingEdit = false

    init(text: String, language: EditorLanguage, palette: EditorPalette, fontSize: CGFloat) {
        self.language = language
        self.palette = palette
        self.fontSize = fontSize
        self.textView = CodeTextView.makeTextKit1()
        super.init()
        configureTextView()
        textView.text = text
        textDidChangeInternally(highlightNow: true)
    }

    // MARK: Setup

    private func configureTextView() {
        let tv = textView
        tv.delegate = self
        tv.autocorrectionType = .no
        tv.autocapitalizationType = language == .csharp ? .none : .sentences
        tv.smartQuotesType = .no
        tv.smartDashesType = .no
        tv.smartInsertDeleteType = .no
        tv.spellCheckingType = language == .csharp ? .no : .default
        tv.keyboardType = .default
        tv.alwaysBounceVertical = true
        tv.keyboardDismissMode = .interactive
        tv.dataDetectorTypes = []
        tv.accessibilityIdentifier = language == .csharp ? "codeEditor" : "noteEditor"
        tv.layoutManager.allowsNonContiguousLayout = true
        tv.textContainer.lineFragmentPadding = 6
        tv.showsLineNumbers = showsLineNumbers && language == .csharp
        tv.gutter.lineStartsProvider = { [weak self] in self?.lineStarts ?? [0] }
        tv.keyHandler = { [weak self] action in self?.handleKey(action) }
        let accessory = EditorAccessoryBar(language: language) { [weak self] key in self?.handleAccessory(key) }
        tv.inputAccessoryView = accessory
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        tv.addGestureRecognizer(pinch)
        applyFont()
        applyPalette()
    }

    private var pinchStartSize: CGFloat = 14
    @objc private func handlePinch(_ g: UIPinchGestureRecognizer) {
        switch g.state {
        case .began: pinchStartSize = fontSize
        case .changed:
            let new = min(28, max(9, (pinchStartSize * g.scale).rounded()))
            if new != fontSize { fontSize = new }
        case .ended: onFontSizeChange?(fontSize)
        default: break
        }
    }

    private func baseFont() -> UIFont {
        switch language {
        case .csharp: return UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        case .markdown: return UIFont.systemFont(ofSize: fontSize + 2, weight: .regular)
        }
    }

    private func applyFont() {
        let font = baseFont()
        let para = NSMutableParagraphStyle()
        para.lineHeightMultiple = language == .csharp ? 1.15 : 1.25
        let range = NSRange(location: 0, length: textView.textStorage.length)
        textView.textStorage.beginEditing()
        textView.textStorage.addAttributes([.font: font, .paragraphStyle: para], range: range)
        textView.textStorage.endEditing()
        textView.typingAttributes = [.font: font, .foregroundColor: palette.text, .paragraphStyle: para]
        textView.font = font
        textView.gutter.font = UIFont.monospacedDigitSystemFont(ofSize: max(9, fontSize - 2), weight: .regular)
        textView.updateGutterWidth(lineCount: lineCount)
        textView.gutter.setNeedsDisplay()
        rehighlightVisible(force: true)
    }

    private func applyPalette() {
        textView.backgroundColor = palette.background
        textView.textColor = palette.text
        textView.tintColor = UIColor(Theme.accent)
        textView.indicatorStyle = palette.isDark ? .white : .black
        textView.keyboardAppearance = palette.isDark ? .dark : .light
        var attrs = textView.typingAttributes
        attrs[.foregroundColor] = palette.text
        textView.typingAttributes = attrs
        let range = NSRange(location: 0, length: textView.textStorage.length)
        textView.textStorage.addAttribute(.foregroundColor, value: palette.text, range: range)
        textView.gutter.palette = palette
        textView.gutter.setNeedsDisplay()
        (textView.inputAccessoryView as? EditorAccessoryBar)?.apply(palette: palette)
        rehighlightVisible(force: true)
    }

    // MARK: Public API

    var text: String { textView.text }

    func setText(_ newText: String) {
        guard newText != textView.text else { return }
        let sel = textView.selectedRange
        textView.text = newText
        applyFont()
        let len = (newText as NSString).length
        textView.selectedRange = NSRange(location: min(sel.location, len), length: 0)
        textDidChangeInternally(highlightNow: true)
    }

    func focus() { textView.becomeFirstResponder() }
    func resignFocus() { textView.resignFirstResponder() }

    func undo() { textView.undoManager?.undo(); textDidChangeInternally(highlightNow: true) }
    func redo() { textView.undoManager?.redo(); textDidChangeInternally(highlightNow: true) }

    /// Replaces a range as one undoable edit and places the caret.
    func replace(_ range: NSRange, with string: String, caret: Int? = nil) {
        guard let start = textView.position(from: textView.beginningOfDocument, offset: range.location),
              let end = textView.position(from: start, offset: range.length),
              let tr = textView.textRange(from: start, to: end) else { return }
        isApplyingEdit = true
        textView.replace(tr, withText: string)
        isApplyingEdit = false
        if let caret {
            let len = textView.textStorage.length
            textView.selectedRange = NSRange(location: min(max(0, caret), len), length: 0)
        }
        textDidChangeInternally(highlightNow: false)
    }

    func insertSnippet(_ code: String) {
        let sel = textView.selectedRange
        let indent = EditorAssist.lineIndent(in: textView.text as NSString, at: sel.location)
        var body = code.replacingOccurrences(of: "\t", with: indentUnit)
        body = body.components(separatedBy: "\n").enumerated().map { $0.offset == 0 ? $0.element : indent + $0.element }.joined(separator: "\n")
        body = body.replacingOccurrences(of: "    ", with: indentUnit)
        let caretMarker = (body as NSString).range(of: "$0")
        var caret: Int? = nil
        if caretMarker.location != NSNotFound {
            body = (body as NSString).replacingCharacters(in: caretMarker, with: "")
            caret = sel.location + caretMarker.location
        }
        replace(sel, with: body, caret: caret ?? sel.location + (body as NSString).length)
        focus()
    }

    func toggleComment() {
        let e = EditorAssist.toggleLineComment(in: textView.text as NSString, range: textView.selectedRange)
        replace(e.range, with: e.replacement, caret: nil)
        textView.selectedRange = NSRange(location: e.range.location, length: (e.replacement as NSString).length)
    }

    func shift(outdent: Bool) {
        let sel = textView.selectedRange
        if sel.length == 0 && !outdent {
            replace(sel, with: indentUnit, caret: sel.location + (indentUnit as NSString).length)
            return
        }
        let e = EditorAssist.shiftLines(in: textView.text as NSString, range: sel, indentUnit: indentUnit, outdent: outdent)
        replace(e.range, with: e.replacement, caret: nil)
        textView.selectedRange = NSRange(location: e.range.location, length: max(0, (e.replacement as NSString).length - 1))
    }

    func formatDocument() {
        let formatted = EditorAssist.reindent(textView.text, indentUnit: indentUnit)
        guard formatted != textView.text else { return }
        let full = NSRange(location: 0, length: textView.textStorage.length)
        let caretLine = line
        replace(full, with: formatted, caret: nil)
        goTo(line: caretLine, select: false)
    }

    func goTo(line target: Int, column: Int = 1, select: Bool = true) {
        let idx = max(0, min(target - 1, lineStarts.count - 1))
        let start = lineStarts[idx]
        let end = idx + 1 < lineStarts.count ? lineStarts[idx + 1] : textView.textStorage.length
        let caret = min(start + max(0, column - 1), end)
        textView.selectedRange = select ? NSRange(location: start, length: max(0, end - start - 1)) : NSRange(location: caret, length: 0)
        textView.scrollRangeToVisible(NSRange(location: start, length: 0))
        // Keep the line away from the very top.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let rect = self.rect(forCharacterAt: start)
            var offset = self.textView.contentOffset
            offset.y = max(-self.textView.adjustedContentInset.top, rect.minY - self.textView.bounds.height * 0.3)
            let maxY = max(-self.textView.adjustedContentInset.top, self.textView.contentSize.height - self.textView.bounds.height + self.textView.adjustedContentInset.bottom)
            offset.y = min(offset.y, maxY)
            self.textView.setContentOffset(offset, animated: true)
        }
    }

    private func rect(forCharacterAt offset: Int) -> CGRect {
        let lm = textView.layoutManager
        let glyph = lm.glyphIndexForCharacter(at: min(offset, max(0, textView.textStorage.length - 1)))
        var r = lm.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        r.origin.y += textView.textContainerInset.top
        return r
    }

    // MARK: Find & replace

    struct FindOptions: Equatable {
        var caseSensitive = false
        var wholeWord = false
        var regex = false
    }

    func find(_ query: String, options: FindOptions) {
        findMatches = []
        defer {
            matchCount = findMatches.count
            currentMatchIndex = 0
            rehighlightVisible(force: true)
        }
        guard !query.isEmpty else { return }
        let ns = textView.text as NSString
        if options.regex || options.wholeWord {
            var pattern = options.regex ? query : NSRegularExpression.escapedPattern(for: query)
            if options.wholeWord { pattern = "\\b" + pattern + "\\b" }
            guard let re = try? NSRegularExpression(pattern: pattern, options: options.caseSensitive ? [] : [.caseInsensitive]) else { return }
            findMatches = re.matches(in: textView.text, range: NSRange(location: 0, length: ns.length)).map(\.range).filter { $0.length > 0 }
        } else {
            var range = NSRange(location: 0, length: ns.length)
            while true {
                let r = ns.range(of: query, options: options.caseSensitive ? [] : [.caseInsensitive], range: range)
                if r.location == NSNotFound || r.length == 0 { break }
                findMatches.append(r)
                let next = NSMaxRange(r)
                if next >= ns.length || findMatches.count > 5000 { break }
                range = NSRange(location: next, length: ns.length - next)
            }
        }
        // Start at the first match after the caret.
        let caret = textView.selectedRange.location
        if let first = findMatches.firstIndex(where: { $0.location >= caret }) { currentMatchIndex = first }
    }

    func selectMatch(_ delta: Int) {
        guard !findMatches.isEmpty else { return }
        currentMatchIndex = (currentMatchIndex + delta + findMatches.count) % findMatches.count
        let r = findMatches[currentMatchIndex]
        textView.selectedRange = r
        textView.scrollRangeToVisible(r)
    }

    func replaceCurrent(with replacement: String, query: String, options: FindOptions) {
        guard !findMatches.isEmpty else { return }
        let r = findMatches[min(currentMatchIndex, findMatches.count - 1)]
        replace(r, with: replacement, caret: r.location + (replacement as NSString).length)
        find(query, options: options)
        if !findMatches.isEmpty { selectMatch(0) }
    }

    @discardableResult
    func replaceAll(with replacement: String, query: String, options: FindOptions) -> Int {
        guard !findMatches.isEmpty else { return 0 }
        let count = findMatches.count
        let ns = NSMutableString(string: textView.text)
        for r in findMatches.reversed() { ns.replaceCharacters(in: r, with: replacement) }
        let full = NSRange(location: 0, length: textView.textStorage.length)
        let offset = textView.contentOffset
        replace(full, with: ns as String, caret: min(textView.selectedRange.location, ns.length))
        textView.setContentOffset(offset, animated: false)
        find(query, options: options)
        return count
    }

    func clearFind() {
        findMatches = []
        matchCount = 0
        rehighlightVisible(force: true)
    }

    // MARK: Text change pipeline

    private func textDidChangeInternally(highlightNow: Bool) {
        recomputeLineStarts()
        canUndo = textView.undoManager?.canUndo ?? false
        canRedo = textView.undoManager?.canRedo ?? false
        textView.updateGutterWidth(lineCount: lineCount)
        textView.gutter.setNeedsDisplay()
        scheduleHighlight(immediate: highlightNow || textView.textStorage.length < 40_000)
        updateCaretInfo()
        onTextChange?(textView.text)
    }

    private func recomputeLineStarts() {
        var starts = [0]
        let u = textView.text.utf16
        var i = 0
        for c in u {
            i += 1
            if c == 10 { starts.append(i) }
        }
        lineStarts = starts
        lineCount = starts.count
    }

    private func scheduleHighlight(immediate: Bool) {
        highlightWork?.cancel()
        if immediate {
            recomputeSpans()
            rehighlightVisible(force: true)
            return
        }
        let work = DispatchWorkItem { [weak self] in
            self?.recomputeSpans()
            self?.rehighlightVisible(force: true)
        }
        highlightWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: work)
    }

    private func recomputeSpans() {
        switch language {
        case .csharp:
            let lex = CSharpLexer().lex(textView.text)
            tokens = lex.tokens
            spans = tokens.compactMap { t in
                switch t.kind {
                case .whitespace, .identifier: return nil
                default: return HighlightSpan(location: t.location, length: t.length, kind: .token(t.kind))
                }
            }
        case .markdown:
            spans = MarkdownHighlighter.spans(for: textView.text)
        }
    }

    private func color(for kind: HighlightSpan.Kind) -> UIColor {
        switch kind {
        case .token(let k): return palette.color(for: k)
        case .mdHeading: return palette.markdownHeading
        case .mdMarker: return palette.markdownMarker
        case .mdCode: return palette.markdownCode
        case .mdQuote: return palette.markdownQuote
        case .mdLink: return palette.markdownLink
        case .mdEmphasis: return palette.markdownMarker
        }
    }

    /// Applies temporary attributes (no layout invalidation) to the visible range plus a margin.
    func rehighlightVisible(force: Bool = false) {
        let lm = textView.layoutManager
        let length = textView.textStorage.length
        guard length > 0 else { highlightedRange = NSRange(location: 0, length: 0); return }
        var visible = textView.bounds
        visible.origin.y -= textView.textContainerInset.top
        let glyphs = lm.glyphRange(forBoundingRectWithoutAdditionalLayout: visible.insetBy(dx: 0, dy: -visible.height), in: textView.textContainer)
        var chars = lm.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
        let margin = 3000
        let start = max(0, chars.location - margin)
        let end = min(length, NSMaxRange(chars) + margin)
        chars = NSRange(location: start, length: end - start)
        if !force && NSLocationInRange(chars.location, highlightedRange) && NSMaxRange(chars) <= NSMaxRange(highlightedRange) { return }
        highlightedRange = chars

        lm.removeTemporaryAttribute(.foregroundColor, forCharacterRange: chars)
        lm.removeTemporaryAttribute(.backgroundColor, forCharacterRange: chars)
        lm.removeTemporaryAttribute(.underlineStyle, forCharacterRange: chars)
        lm.removeTemporaryAttribute(.underlineColor, forCharacterRange: chars)

        // Binary search for the first span that may intersect.
        var lo = 0, hi = spans.count
        while lo < hi { let mid = (lo + hi) / 2; if spans[mid].end <= chars.location { lo = mid + 1 } else { hi = mid } }
        var i = lo
        while i < spans.count {
            let s = spans[i]
            if s.location >= NSMaxRange(chars) { break }
            let r = NSIntersectionRange(NSRange(location: s.location, length: s.length), chars)
            if r.length > 0 { lm.addTemporaryAttribute(.foregroundColor, value: color(for: s.kind), forCharacterRange: r) }
            i += 1
        }
        for r in findMatches where NSIntersectionRange(r, chars).length > 0 {
            lm.addTemporaryAttribute(.backgroundColor, value: palette.findMatch, forCharacterRange: r)
        }
        for r in bracketRanges where NSMaxRange(r) <= length {
            lm.addTemporaryAttribute(.backgroundColor, value: palette.bracket, forCharacterRange: r)
        }
        // Diagnostics as underlines.
        for d in diagnostics {
            let idx = d.line - 1
            guard idx >= 0, idx < lineStarts.count else { continue }
            let lineStart = lineStarts[idx]
            let lineEnd = idx + 1 < lineStarts.count ? lineStarts[idx + 1] - 1 : length
            var loc = min(lineStart + max(0, d.column - 1), max(lineStart, lineEnd))
            var len = 0
            if let tok = tokens.first(where: { $0.location <= loc && loc < $0.end && $0.kind != .whitespace }) {
                loc = tok.location; len = tok.length
            } else {
                len = max(1, min(lineEnd - loc, 1))
            }
            let r = NSRange(location: loc, length: max(1, min(len, length - loc)))
            guard r.location < length, NSIntersectionRange(r, chars).length > 0 else { continue }
            let style = NSUnderlineStyle.thick.rawValue | NSUnderlineStyle.patternDot.rawValue
            lm.addTemporaryAttribute(.underlineStyle, value: style, forCharacterRange: r)
            lm.addTemporaryAttribute(.underlineColor, value: UIColor(Theme.color(for: d.severity)), forCharacterRange: r)
        }
    }

    private func updateCaretInfo() {
        let sel = textView.selectedRange
        let loc = sel.location
        var lo = 0, hi = lineStarts.count - 1
        while lo < hi { let mid = (lo + hi + 1) / 2; if lineStarts[mid] <= loc { lo = mid } else { hi = mid - 1 } }
        if line != lo + 1 { line = lo + 1 }
        let col = loc - lineStarts[lo] + 1
        if column != col { column = col }
        if selectionLength != sel.length { selectionLength = sel.length }
        textView.gutter.currentLine = line
        textView.gutter.setNeedsDisplay()
        updateBracketMatch()
    }

    private func updateBracketMatch() {
        guard language == .csharp else { return }
        let old = bracketRanges
        bracketRanges = []
        if textView.selectedRange.length == 0, let pair = EditorAssist.bracketPair(tokens: tokens, caret: textView.selectedRange.location) {
            bracketRanges = [NSRange(location: pair.0, length: 1), NSRange(location: pair.1, length: 1)]
        }
        if old != bracketRanges { rehighlightVisible(force: true) }
    }

    // MARK: UITextViewDelegate

    func textView(_ tv: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        handleTyping(range: range, text: text)
    }

    /// Smart typing: auto-indent, list continuation, auto-pairing. Returns false if handled.
    private func handleTyping(range: NSRange, text: String) -> Bool {
        if isApplyingEdit { return true }
        let ns = textView.text as NSString
        if text == "\n" {
            if language == .markdown, let cont = MarkdownHighlighter.listContinuation(in: ns, at: range.location) {
                if cont.isEmpty {
                    // Empty list item → end the list.
                    let lineRange = ns.lineRange(for: NSRange(location: range.location, length: 0))
                    let r = NSRange(location: lineRange.location, length: range.location - lineRange.location)
                    replace(r, with: "", caret: lineRange.location)
                } else {
                    replace(range, with: "\n" + cont, caret: range.location + 1 + (cont as NSString).length)
                }
                return false
            }
            let e = EditorAssist.newlineEdit(in: ns, range: range, indentUnit: language == .csharp ? indentUnit : "")
            replace(e.range, with: e.replacement, caret: e.caret)
            return false
        }
        guard language == .csharp else { return true }
        if text == "}", let e = EditorAssist.closingBraceEdit(in: ns, range: range, indentUnit: indentUnit) {
            // Skip over an auto-inserted closing brace.
            if range.location < ns.length && ns.character(at: range.location) == 125 && range.length == 0 {
                let lineRange = ns.lineRange(for: NSRange(location: range.location, length: 0))
                let before = ns.substring(with: NSRange(location: lineRange.location, length: range.location - lineRange.location))
                if !before.allSatisfy({ $0 == " " || $0 == "\t" }) {
                    textView.selectedRange = NSRange(location: range.location + 1, length: 0)
                    return false
                }
            }
            replace(e.range, with: e.replacement, caret: e.caret)
            return false
        }
        if autoPair && range.length == 0 && text.count == 1 {
            let next: unichar? = range.location < ns.length ? ns.character(at: range.location) : nil
            // Typing a closing char that is already there: just move over it.
            if let n = next, [")", "]", "}", "\""].contains(text), n == (text as NSString).character(at: 0) {
                textView.selectedRange = NSRange(location: range.location + 1, length: 0)
                return false
            }
            if let (pair, caret) = EditorAssist.autoPair(for: text, nextChar: next) {
                if text == "\"" {
                    // Don't pair inside a string literal / after a word char.
                    let prev: unichar = range.location > 0 ? ns.character(at: range.location - 1) : 32
                    if CharacterSet.alphanumerics.contains(UnicodeScalar(prev) ?? " ") || insideStringOrComment(range.location) { return true }
                }
                replace(range, with: pair, caret: range.location + caret)
                return false
            }
        }
        // Deleting an empty pair `(|)` removes both.
        if autoPair && text.isEmpty && range.length == 1 && range.location + 1 < ns.length {
            let a = ns.character(at: range.location), b = ns.character(at: range.location + 1)
            if (a == 40 && b == 41) || (a == 91 && b == 93) || (a == 123 && b == 125) || (a == 34 && b == 34) {
                replace(NSRange(location: range.location, length: 2), with: "", caret: range.location)
                return false
            }
        }
        return true
    }

    private func insideStringOrComment(_ offset: Int) -> Bool {
        tokens.contains { ($0.kind == .string || $0.kind == .comment || $0.kind == .char) && $0.location < offset && offset < $0.end }
    }

    func textViewDidChange(_ textView: UITextView) {
        textDidChangeInternally(highlightNow: false)
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
        updateCaretInfo()
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        textView.gutter.setNeedsDisplay()
        rehighlightVisible()
    }

    // MARK: Keys

    private func handleKey(_ action: CodeTextView.KeyAction) {
        switch action {
        case .indent: shift(outdent: false)
        case .outdent: shift(outdent: true)
        case .toggleComment: toggleComment()
        case .format: formatDocument()
        }
    }

    private func handleAccessory(_ key: EditorAccessoryBar.Key) {
        switch key {
        case .insert(let s):
            if s == "\t" { shift(outdent: false); return }
            let r = textView.selectedRange
            if handleTyping(range: r, text: s) {
                replace(r, with: s, caret: r.location + (s as NSString).length)
            }
        case .wrap(let prefix, let suffix):
            let r = textView.selectedRange
            let selected = (textView.text as NSString).substring(with: r)
            replace(r, with: prefix + selected + suffix, caret: r.location + (prefix as NSString).length + (selected as NSString).length)
        case .linePrefix(let prefix):
            let ns = textView.text as NSString
            let lineRange = ns.lineRange(for: NSRange(location: textView.selectedRange.location, length: 0))
            replace(NSRange(location: lineRange.location, length: 0), with: prefix, caret: textView.selectedRange.location + (prefix as NSString).length)
        case .outdent: shift(outdent: true)
        case .undo: undo()
        case .redo: redo()
        case .left:
            let r = textView.selectedRange
            textView.selectedRange = NSRange(location: max(0, r.location - 1), length: 0)
        case .right:
            let r = textView.selectedRange
            textView.selectedRange = NSRange(location: min(textView.textStorage.length, NSMaxRange(r) + (r.length == 0 ? 1 : 0)), length: 0)
        case .dismiss:
            textView.resignFirstResponder()
        }
    }
}

// MARK: - Markdown highlighting

enum MarkdownHighlighter {
    private static let rules: [(NSRegularExpression, HighlightSpan.Kind)] = {
        func re(_ p: String, _ o: NSRegularExpression.Options = [.anchorsMatchLines]) -> NSRegularExpression {
            try! NSRegularExpression(pattern: p, options: o)
        }
        return [
            (re("^#{1,6} .*$"), .mdHeading),
            (re("^\\s*([-*+]|\\d+[.)])\\s"), .mdMarker),
            (re("\\[( |x|X)\\]"), .mdMarker),
            (re("^>.*$"), .mdQuote),
            (re("^(-{3,}|\\*{3,}|_{3,})\\s*$"), .mdMarker),
            (re("\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__"), .mdEmphasis),
            (re("(?<![*\\w])\\*[^*\\n]+\\*(?!\\*)"), .mdQuote),
            (re("\\[[^\\]\\n]+\\]\\([^)\\n]+\\)"), .mdLink),
            (re("`[^`\\n]+`"), .mdCode),
            (re("^(```|~~~)[\\s\\S]*?(^(```|~~~)\\s*$|\\z)", [.anchorsMatchLines]), .mdCode)
        ]
    }()

    static func spans(for text: String) -> [HighlightSpan] {
        let range = NSRange(location: 0, length: (text as NSString).length)
        var out: [HighlightSpan] = []
        var codeBlocks: [NSRange] = []
        for (re, kind) in rules {
            for m in re.matches(in: text, range: range) {
                if case .mdCode = kind, m.range.length > 2 && (text as NSString).substring(with: NSRange(location: m.range.location, length: 3)) == "```" {
                    codeBlocks.append(m.range)
                }
                out.append(HighlightSpan(location: m.range.location, length: m.range.length, kind: kind))
            }
        }
        // Everything inside fenced code blocks is code; drop other spans there.
        if !codeBlocks.isEmpty {
            out = out.filter { s in
                if case .mdCode = s.kind { return true }
                return !codeBlocks.contains { NSLocationInRange(s.location, $0) }
            }
        }
        out.sort { $0.location < $1.location }
        // Spans must not overlap for the binary-search based applier: trim overlaps (later wins).
        var result: [HighlightSpan] = []
        for s in out {
            if var last = result.last, last.end > s.location {
                last.length = max(0, s.location - last.location)
                result[result.count - 1] = last
                if last.length == 0 { result.removeLast() }
            }
            result.append(s)
        }
        return result
    }

    /// If the caret line is a list item, returns the marker for the next line ("" = end list).
    static func listContinuation(in ns: NSString, at offset: Int) -> String? {
        let lineRange = ns.lineRange(for: NSRange(location: offset, length: 0))
        let line = ns.substring(with: NSRange(location: lineRange.location, length: offset - lineRange.location))
        let indent = String(line.prefix(while: { $0 == " " || $0 == "\t" }))
        let rest = line.dropFirst(indent.count)
        for marker in ["- [ ] ", "- [x] ", "- ", "* ", "+ "] where rest.hasPrefix(marker) {
            if rest.count == marker.count { return "" }
            return indent + (marker == "- [x] " ? "- [ ] " : marker)
        }
        let digits = rest.prefix(while: { $0.isNumber })
        if !digits.isEmpty, rest.dropFirst(digits.count).hasPrefix(". "), let n = Int(digits) {
            if rest.count == digits.count + 2 { return "" }
            return indent + "\(n + 1). "
        }
        return nil
    }
}
