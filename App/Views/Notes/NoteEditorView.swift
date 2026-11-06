import SwiftUI
import VaultKit

/// Editor for notes and prompts: Markdown source editing with live highlighting and a rendered preview.
struct NoteEditorView: View {
    @Bindable var item: VaultItem
    @Environment(VaultStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(SettingsKey.editorFontSize) private var fontSize = 14.0

    @StateObject private var controller: CodeEditorController
    @State private var mode: Mode = .edit
    @State private var saveTask: Task<Void, Never>?
    @State private var sheet: Sheet?
    @State private var openedContent = ""
    @State private var liveContent = ""

    enum Mode: String, CaseIterable { case edit = "Bearbeiten", preview = "Vorschau" }
    enum Sheet: String, Identifiable { case metadata, export, revisions, claude; var id: String { rawValue } }

    init(item: VaultItem) {
        self.item = item
        let size = UserDefaults.standard.object(forKey: SettingsKey.editorFontSize) as? Double ?? 14
        _controller = StateObject(wrappedValue: CodeEditorController(text: item.content, language: .markdown, palette: .night, fontSize: CGFloat(size)))
        _mode = State(initialValue: item.content.isEmpty ? .edit : .preview)
    }

    private var palette: EditorPalette { colorScheme == .dark ? .night : .day }

    var body: some View {
        VStack(spacing: 0) {
            header
            Group {
                switch mode {
                case .edit:
                    CodeEditorView(controller: controller)
                case .preview:
                    ScrollView {
                        MarkdownPreview(markdown: liveContent)
                            .padding(.horizontal, 18).padding(.vertical, 14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .background(Color(uiColor: palette.background))
                }
            }
        }
        .background(Color(uiColor: palette.background).ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color(uiColor: palette.background), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar { toolbar }
        .safeAreaInset(edge: .bottom, spacing: 0) { bottomBar }
        .sheet(item: $sheet) { s in
            switch s {
            case .metadata: ItemMetadataSheet(item: item, report: nil).presentationBackground(Theme.background)
            case .export: ExportSheet(scope: .items([item.id]), title: item.title).presentationBackground(Theme.background)
            case .revisions: RevisionsView(item: item) { restored in controller.setText(restored); liveContent = restored; openedContent = restored }.presentationBackground(Theme.background)
            case .claude: ClaudeContextSheet(items: [item]).presentationBackground(Theme.background)
            }
        }
        .onAppear(perform: onAppear)
        .onDisappear(perform: flush)
        .onChange(of: scenePhase) { _, p in if p != .active { flush() } }
        .onChange(of: colorScheme) { _, _ in controller.palette = palette }
        .onChange(of: fontSize) { _, v in controller.fontSize = CGFloat(v) }
        .onChange(of: mode) { _, m in if m == .edit { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { controller.focus() } } else { controller.resignFocus(); flush() } }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField(item.kind == .prompt ? "Prompt-Titel" : "Titel", text: $item.title, axis: .vertical)
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
                .onChange(of: item.title) { _, _ in item.touch() }
            Button { sheet = .metadata } label: {
                HStack(spacing: 6) {
                    Chip(text: item.kind.displayName, symbol: item.kind.symbol, color: Theme.color(for: item.kind))
                    if !item.category.isEmpty { Chip(text: item.category, symbol: "square.grid.2x2", color: Theme.textSecondary) }
                    ForEach(item.tags.prefix(3), id: \.self) { TagChip(tag: $0) }
                    if item.tags.count > 3 { Text("+\(item.tags.count - 3)").font(Theme.mono(11)).foregroundStyle(Theme.textTertiary) }
                    if item.category.isEmpty && item.tags.isEmpty {
                        Text("Kategorie & Tags hinzufügen").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.accent)
                    }
                    Spacer(minLength: 0)
                }
            }
            .buttonStyle(.plain)
            Picker("Modus", selection: $mode) {
                ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 10)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Text(item.locationDescription).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.textSecondary).lineLimit(1)
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button { store.toggleFavorite(item) } label: { Image(systemName: item.isFavorite ? "star.fill" : "star") }
                .tint(item.isFavorite ? Theme.amber : Theme.accent)
                .accessibilityLabel(item.isFavorite ? "Favorit entfernen" : "Als Favorit markieren")
            Menu {
                Button { copyAll() } label: { Label("Text kopieren", systemImage: "doc.on.doc") }
                Button { UIPasteboard.general.string = MarkdownParser.plainText(controller.text); store.show("Als reiner Text kopiert", symbol: "doc.plaintext") } label: {
                    Label("Als reinen Text kopieren", systemImage: "doc.plaintext")
                }
                Button { sheet = .metadata } label: { Label("Eigenschaften", systemImage: "info.circle") }
                Button { sheet = .export } label: { Label("Exportieren / Teilen", systemImage: "square.and.arrow.up") }
                Button { sheet = .claude } label: { Label("Als Claude-Kontext", systemImage: "sparkles") }
                Button { sheet = .revisions } label: { Label("Versionen", systemImage: "clock.arrow.circlepath") }
                Button { flush(); store.duplicate(item) } label: { Label("Duplizieren", systemImage: "plus.square.on.square") }
                Divider()
                Menu {
                    ForEach(VaultItemKind.allCases.filter { $0 != .script }) { k in
                        Button { item.kind = k; item.touch(); store.save() } label: { Label(k.displayName, systemImage: k.symbol) }
                    }
                } label: { Label("Typ ändern", systemImage: "arrow.left.arrow.right") }
            } label: { Image(systemName: "ellipsis.circle") }
        }
    }

    private var bottomBar: some View {
        HStack(spacing: 12) {
            Text("\(wordCount) Wörter · \(liveContent.count) Zeichen").font(Theme.mono(11)).foregroundStyle(Theme.textTertiary)
            Spacer()
            Text("Gespeichert \(item.modifiedAt.relativeDescription)").font(Theme.mono(11)).foregroundStyle(Theme.textTertiary)
            if item.kind == .prompt {
                Button { copyAll() } label: { Label("Kopieren", systemImage: "doc.on.doc").font(.system(size: 13, weight: .semibold)) }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.prompt)
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(Color(uiColor: palette.background).opacity(0.97))
        .overlay(alignment: .top) { Rectangle().fill(Theme.stroke).frame(height: 1) }
    }

    private var wordCount: Int { liveContent.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).count }

    private func copyAll() {
        UIPasteboard.general.string = controller.text
        store.show(item.kind == .prompt ? "Prompt kopiert – bereit für Claude" : "Text kopiert", symbol: "doc.on.doc")
    }

    private func onAppear() {
        controller.palette = palette
        if controller.text != item.content { controller.setText(item.content) }
        liveContent = item.content
        openedContent = item.content
        store.recordRevision(item, reason: "Beim Öffnen")
        item.lastOpenedAt = Date()
        store.save()
        controller.onTextChange = { text in
            liveContent = text
            saveTask?.cancel()
            saveTask = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 600_000_000)
                if Task.isCancelled { return }
                persist(text)
            }
        }
        if mode == .edit { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { controller.focus() } }
    }

    private func persist(_ text: String) {
        guard item.content != text else { return }
        store.updateContent(item, to: text)
        // Auto title for untitled notes.
        if item.title == "Neue Notiz" || item.title == "Neuer Prompt", let t = MarkdownParser.suggestedTitle(text), !t.isEmpty {
            item.title = t
        }
        store.save()
    }

    private func flush() {
        saveTask?.cancel()
        persist(controller.text)
        if item.content != openedContent {
            store.recordRevision(item, reason: "Bearbeitung")
            openedContent = item.content
        }
        store.save()
    }
}

// MARK: - Markdown preview

struct MarkdownPreview: View {
    let markdown: String
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let blocks = MarkdownParser.parse(markdown)
        VStack(alignment: .leading, spacing: 12) {
            if blocks.isEmpty {
                Text("Noch kein Inhalt. Wechsle zu „Bearbeiten“, um zu schreiben.").foregroundStyle(Theme.textTertiary)
            }
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .textSelection(.enabled)
    }

    private func inline(_ s: String) -> Text {
        if let a = try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            return Text(a)
        }
        return Text(s)
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let text):
            inline(text)
                .font(.system(size: level == 1 ? 26 : (level == 2 ? 21 : 18), weight: .bold))
                .foregroundStyle(level <= 2 ? Theme.textPrimary : Theme.textSecondary)
                .padding(.top, level == 1 ? 6 : 4)
        case .paragraph(let text):
            inline(text).font(.system(size: 16)).foregroundStyle(Theme.textPrimary).lineSpacing(4)
        case .bulletList(let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        if let checked = it.checked {
                            Image(systemName: checked ? "checkmark.square.fill" : "square").foregroundStyle(checked ? Theme.success : Theme.textTertiary)
                        } else {
                            Circle().fill(Theme.accent).frame(width: 5, height: 5).offset(y: -3)
                        }
                        inline(it.text).font(.system(size: 16)).foregroundStyle(it.checked == true ? Theme.textTertiary : Theme.textPrimary)
                            .strikethrough(it.checked == true)
                    }
                    .padding(.leading, CGFloat(it.indent) * 18)
                }
            }
        case .orderedList(let start, let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, it in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("\(start + i).").font(Theme.mono(14, .semibold)).foregroundStyle(Theme.accent)
                        inline(it.text).font(.system(size: 16)).foregroundStyle(Theme.textPrimary)
                    }
                    .padding(.leading, CGFloat(it.indent) * 18)
                }
            }
        case .code(let language, let code):
            CodeBlockView(language: language, code: code)
        case .quote(let text):
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 2).fill(Theme.accent).frame(width: 3)
                inline(text).font(.system(size: 15)).italic().foregroundStyle(Theme.textSecondary)
            }
        case .callout(let kind, let text):
            let color: Color = kind == "warning" || kind == "caution" ? Theme.warning : (kind == "important" ? Theme.error : (kind == "tip" ? Theme.success : Theme.info))
            VStack(alignment: .leading, spacing: 4) {
                Text(kind.uppercased()).font(Theme.label).foregroundStyle(color)
                inline(text).font(.system(size: 15)).foregroundStyle(Theme.textPrimary)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(color.opacity(0.3)))
        case .table(let header, let rows):
            ScrollView(.horizontal, showsIndicators: false) {
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow { ForEach(Array(header.enumerated()), id: \.offset) { _, h in inline(h).font(.system(size: 14, weight: .semibold)) } }
                    Divider()
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        GridRow { ForEach(Array(row.enumerated()), id: \.offset) { _, c in inline(c).font(.system(size: 14)) } }
                    }
                }
                .padding(12)
            }
            .cardStyle()
        case .divider:
            Rectangle().fill(Theme.stroke).frame(height: 1).padding(.vertical, 4)
        }
    }
}

/// Syntax highlighted, copyable code block (C# highlighted via VaultKit's lexer).
struct CodeBlockView: View {
    let language: String
    let code: String
    @Environment(\.colorScheme) private var colorScheme
    @State private var copied = false

    var body: some View {
        let palette: EditorPalette = colorScheme == .dark ? .night : .day
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? "code" : language).font(Theme.mono(11, .semibold)).foregroundStyle(Theme.textTertiary)
                Spacer()
                Button {
                    UIPasteboard.general.string = code
                    copied = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
                } label: {
                    Label(copied ? "Kopiert" : "Kopieren", systemImage: copied ? "checkmark" : "doc.on.doc").font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(Theme.accent)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            Rectangle().fill(Theme.stroke).frame(height: 1)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(highlighted(palette: palette)).font(Theme.mono(13)).padding(12).fixedSize(horizontal: true, vertical: false)
            }
        }
        .background(Color(uiColor: palette.background), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke))
    }

    private func highlighted(palette: EditorPalette) -> AttributedString {
        var attr = AttributedString(code)
        attr.foregroundColor = Color(uiColor: palette.text)
        let isCSharp = ["csharp", "cs", "c#", "unity", ""].contains(language)
        guard isCSharp, code.utf16.count < 60_000 else { return attr }
        for t in CSharpLexer().lex(code).tokens where t.kind != .whitespace && t.kind != .identifier {
            if let r = Range<AttributedString.Index>(t.range, in: attr) {
                attr[r].foregroundColor = Color(uiColor: palette.color(for: t.kind))
            }
        }
        return attr
    }
}
