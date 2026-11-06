import SwiftUI
import UIKit
import VaultKit

/// UITextView on an explicit TextKit 1 stack (needed for fast temporary-attribute highlighting
/// and line-fragment based line numbers).
final class CodeTextView: UITextView {
    enum KeyAction { case indent, outdent, toggleComment, format }

    let gutter = LineNumberGutter()
    var keyHandler: ((KeyAction) -> Void)?
    var showsLineNumbers = true {
        didSet { gutter.isHidden = !showsLineNumbers; updateGutterWidth(lineCount: gutter.lastLineCount) }
    }

    static func makeTextKit1() -> CodeTextView {
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layout.addTextContainer(container)
        return CodeTextView(frame: .zero, textContainer: container)
    }

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        gutter.textView = self
        gutter.isOpaque = true
        gutter.contentMode = .redraw
        addSubview(gutter)
        textContainerInset = UIEdgeInsets(top: 12, left: 4, bottom: 120, right: 8)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func updateGutterWidth(lineCount: Int) {
        gutter.lastLineCount = lineCount
        guard showsLineNumbers else {
            if textContainerInset.left != 6 { textContainerInset.left = 6 }
            return
        }
        let digits = max(2, String(lineCount).count)
        let charWidth = ("8" as NSString).size(withAttributes: [.font: gutter.font]).width
        let width = ceil(CGFloat(digits) * charWidth + 26)
        if abs(gutter.width - width) > 0.5 || textContainerInset.left != width + 4 {
            gutter.width = width
            textContainerInset.left = width + 4
            setNeedsLayout()
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        gutter.frame = CGRect(x: contentOffset.x, y: contentOffset.y, width: gutter.width, height: bounds.height)
        bringSubviewToFront(gutter)
    }

    override var keyCommands: [UIKeyCommand]? {
        let tab = UIKeyCommand(input: "\t", modifierFlags: [], action: #selector(keyIndent))
        tab.wantsPriorityOverSystemBehavior = true
        let shiftTab = UIKeyCommand(input: "\t", modifierFlags: .shift, action: #selector(keyOutdent))
        shiftTab.wantsPriorityOverSystemBehavior = true
        return [
            tab, shiftTab,
            UIKeyCommand(title: "Kommentar umschalten", action: #selector(keyComment), input: "/", modifierFlags: .command),
            UIKeyCommand(title: "Einrücken", action: #selector(keyIndent), input: "]", modifierFlags: .command),
            UIKeyCommand(title: "Ausrücken", action: #selector(keyOutdent), input: "[", modifierFlags: .command),
            UIKeyCommand(title: "Dokument formatieren", action: #selector(keyFormat), input: "i", modifierFlags: [.control])
        ]
    }

    @objc private func keyIndent() { keyHandler?(.indent) }
    @objc private func keyOutdent() { keyHandler?(.outdent) }
    @objc private func keyComment() { keyHandler?(.toggleComment) }
    @objc private func keyFormat() { keyHandler?(.format) }
}

/// Draws line numbers (and diagnostic markers) for the visible line fragments only.
final class LineNumberGutter: UIView {
    weak var textView: CodeTextView?
    var lineStartsProvider: (() -> [Int])?
    var palette: EditorPalette = .night
    var font = UIFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
    var width: CGFloat = 44
    var currentLine = 1
    var markers: [Int: DiagnosticSeverity] = [:]
    var lastLineCount = 1

    override func draw(_ rect: CGRect) {
        guard let tv = textView, let ctx = UIGraphicsGetCurrentContext() else { return }
        ctx.setFillColor(palette.gutterBackground.cgColor)
        ctx.fill(bounds)
        ctx.setFillColor(palette.gutterText.withAlphaComponent(0.25).cgColor)
        ctx.fill(CGRect(x: bounds.width - 1, y: 0, width: 1, height: bounds.height))

        let starts = lineStartsProvider?() ?? [0]
        let lm = tv.layoutManager
        let inset = tv.textContainerInset
        var visible = tv.bounds
        visible.origin.y -= inset.top
        let glyphRange = lm.glyphRange(forBoundingRect: visible, in: tv.textContainer)
        let offsetY = tv.contentOffset.y

        func lineIndex(for char: Int) -> Int {
            var lo = 0, hi = starts.count - 1
            while lo < hi { let mid = (lo + hi + 1) / 2; if starts[mid] <= char { lo = mid } else { hi = mid - 1 } }
            return lo
        }

        let normal: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: palette.gutterText]
        let active: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: palette.gutterActive]

        func drawNumber(_ line: Int, fragment: CGRect) {
            let y = fragment.minY + inset.top - offsetY
            let s = "\(line)" as NSString
            let size = s.size(withAttributes: normal)
            let lineHeight = fragment.height
            let textY = y + (min(lineHeight, font.lineHeight * 1.4) - size.height) / 2
            s.draw(at: CGPoint(x: bounds.width - size.width - 10, y: textY), withAttributes: line == currentLine ? active : normal)
            if let sev = markers[line] {
                let color = UIColor(Theme.color(for: sev))
                ctx.setFillColor(color.cgColor)
                let d: CGFloat = 6
                ctx.fillEllipse(in: CGRect(x: 4, y: y + (min(lineHeight, font.lineHeight * 1.4) - d) / 2, width: d, height: d))
            }
        }

        if tv.textStorage.length == 0 {
            drawNumber(1, fragment: CGRect(x: 0, y: 0, width: 10, height: tv.font?.lineHeight ?? 16))
            return
        }
        lm.enumerateLineFragments(forGlyphRange: glyphRange) { fragRect, _, _, fragGlyphs, _ in
            let charIndex = lm.characterIndexForGlyph(at: fragGlyphs.location)
            let idx = lineIndex(for: charIndex)
            if starts[idx] == charIndex { drawNumber(idx + 1, fragment: fragRect) }
        }
        // Empty last line after a trailing newline.
        let extra = lm.extraLineFragmentRect
        if extra.height > 0, extra.minY + inset.top - offsetY < bounds.height {
            drawNumber(starts.count, fragment: extra)
        }
    }
}

/// Keyboard accessory row with programmer symbols and editing actions (one-handed friendly).
final class EditorAccessoryBar: UIInputView {
    enum Key {
        case insert(String)
        case wrap(String, String)
        case linePrefix(String)
        case outdent, undo, redo, left, right, dismiss
    }

    private let handler: (Key) -> Void
    private let stack = UIStackView()
    private var buttons: [UIButton] = []

    init(language: EditorLanguage, handler: @escaping (Key) -> Void) {
        self.handler = handler
        super.init(frame: CGRect(x: 0, y: 0, width: 320, height: 46), inputViewStyle: .keyboard)
        allowsSelfSizing = true
        let scroll = UIScrollView()
        scroll.showsHorizontalScrollIndicator = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        addSubview(scroll)
        stack.axis = .horizontal
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            scroll.topAnchor.constraint(equalTo: topAnchor),
            scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
            heightAnchor.constraint(equalToConstant: 46),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -8),
            stack.centerYAnchor.constraint(equalTo: scroll.centerYAnchor),
            stack.heightAnchor.constraint(equalToConstant: 34)
        ])
        let items: [(String, Key)]
        switch language {
        case .csharp:
            items = [("⇥", .insert("\t")), ("⇤", .outdent), ("{ }", .wrap("{", "}")), ("( )", .wrap("(", ")")),
                     (";", .insert(";")), ("=", .insert(" = ")), ("<>", .wrap("<", ">")), ("[ ]", .wrap("[", "]")),
                     ("\"", .insert("\"")), (".", .insert(".")), (",", .insert(", ")), (":", .insert(":")),
                     ("=>", .insert(" => ")), ("!", .insert("!")), ("&&", .insert(" && ")), ("||", .insert(" || ")),
                     ("+", .insert("+")), ("-", .insert("-")), ("*", .insert("*")), ("/", .insert("/")), ("_", .insert("_")),
                     ("?", .insert("?")), ("'", .insert("'")), ("#", .insert("#")), ("$", .insert("$\"")),
                     ("◀︎", .left), ("▶︎", .right), ("↶", .undo), ("↷", .redo), ("⌄", .dismiss)]
        case .markdown:
            items = [("H1", .linePrefix("# ")), ("H2", .linePrefix("## ")), ("H3", .linePrefix("### ")),
                     ("B", .wrap("**", "**")), ("I", .wrap("*", "*")), ("`", .wrap("`", "`")),
                     ("```", .wrap("```csharp\n", "\n```")), ("•", .linePrefix("- ")), ("1.", .linePrefix("1. ")),
                     ("☐", .linePrefix("- [ ] ")), (">", .linePrefix("> ")), ("Link", .wrap("[", "](https://)")),
                     ("—", .insert("\n---\n")), ("#", .insert("#")), ("◀︎", .left), ("▶︎", .right),
                     ("↶", .undo), ("↷", .redo), ("⌄", .dismiss)]
        }
        for (title, key) in items {
            let b = UIButton(type: .system)
            var cfg = UIButton.Configuration.filled()
            cfg.title = title
            cfg.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 11, bottom: 4, trailing: 11)
            cfg.cornerStyle = .medium
            cfg.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
                var out = incoming
                out.font = UIFont.monospacedSystemFont(ofSize: 15, weight: .semibold)
                return out
            }
            b.configuration = cfg
            b.addAction(UIAction { [weak self] _ in
                UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.5)
                self?.handler(key)
            }, for: .touchUpInside)
            b.accessibilityLabel = Self.accessibilityName(title)
            buttons.append(b)
            stack.addArrangedSubview(b)
        }
        apply(palette: .night)
    }

    required init?(coder: NSCoder) { fatalError() }

    func apply(palette: EditorPalette) {
        for b in buttons {
            b.configuration?.baseBackgroundColor = palette.isDark ? UIColor(hex: 0x1D2230) : UIColor(hex: 0xFFFFFF)
            b.configuration?.baseForegroundColor = palette.isDark ? UIColor(hex: 0xD8DEE9) : UIColor(hex: 0x24292F)
        }
    }

    static func accessibilityName(_ t: String) -> String {
        switch t {
        case "⇥": return "Einrücken"
        case "⇤": return "Ausrücken"
        case "↶": return "Rückgängig"
        case "↷": return "Wiederholen"
        case "⌄": return "Tastatur ausblenden"
        case "◀︎": return "Cursor links"
        case "▶︎": return "Cursor rechts"
        default: return t
        }
    }
}

/// SwiftUI bridge. The controller owns the view; SwiftUI only hosts it.
struct CodeEditorView: UIViewRepresentable {
    let controller: CodeEditorController

    func makeUIView(context: Context) -> CodeTextView { controller.textView }
    func updateUIView(_ uiView: CodeTextView, context: Context) {}
}
