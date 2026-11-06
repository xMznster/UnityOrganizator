import SwiftUI
import VaultKit

/// Runs the on-device analyzer off the main thread with debouncing.
@MainActor
@Observable
final class AnalysisModel {
    var report: AnalysisReport?
    var isRunning = false
    var compilerDiagnostics: [CodeDiagnostic] = []
    var compiledAt: Date?
    var compilerError: String?
    var isCompiling = false
    private var task: Task<Void, Never>?

    func schedule(text: String, fileName: String, delay: Double = 0.7, completion: @escaping (AnalysisReport) -> Void) {
        task?.cancel()
        task = Task { [weak self] in
            if delay > 0 { try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) }
            if Task.isCancelled { return }
            self?.isRunning = true
            let report = await Task.detached(priority: .userInitiated) {
                CSharpAnalyzer().analyze(text, options: .init(fileName: fileName))
            }.value
            if Task.isCancelled { return }
            self?.report = report
            self?.isRunning = false
            completion(report)
        }
    }

    /// Local diagnostics plus (clearly labelled) compiler diagnostics.
    var allDiagnostics: [CodeDiagnostic] { (report?.diagnostics ?? []) + compilerDiagnostics }
}

struct ScriptEditorView: View {
    @Bindable var item: VaultItem
    @Environment(VaultStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(SettingsKey.editorTheme) private var editorTheme = EditorThemeChoice.night.rawValue
    @AppStorage(SettingsKey.editorFontSize) private var fontSize = 14.0
    @AppStorage(SettingsKey.editorTabWidth) private var tabWidth = 4
    @AppStorage(SettingsKey.editorUseTabs) private var useTabs = false
    @AppStorage(SettingsKey.editorAutoPair) private var autoPair = true
    @AppStorage(SettingsKey.editorLineNumbers) private var lineNumbers = true
    @AppStorage(SettingsKey.editorLiveAnalysis) private var liveAnalysis = true
    @AppStorage(SettingsKey.compilerURL) private var compilerURL = ""

    @StateObject private var controller: CodeEditorController
    @State private var analysis = AnalysisModel()
    @State private var saveTask: Task<Void, Never>?
    @State private var showFind = false
    @State private var sheet: EditorSheet?
    @State private var openedContent: String = ""

    enum EditorSheet: String, Identifiable {
        case analysis, outline, snippets, metadata, export, revisions, claude
        var id: String { rawValue }
    }

    init(item: VaultItem) {
        self.item = item
        let theme = EditorThemeChoice(rawValue: UserDefaults.standard.string(forKey: SettingsKey.editorTheme) ?? "") ?? .night
        let size = UserDefaults.standard.object(forKey: SettingsKey.editorFontSize) as? Double ?? 14
        _controller = StateObject(wrappedValue: CodeEditorController(text: item.content, language: .csharp,
                                                                      palette: theme.palette(for: .dark), fontSize: CGFloat(size)))
    }

    private var palette: EditorPalette {
        (EditorThemeChoice(rawValue: editorTheme) ?? .night).palette(for: colorScheme)
    }

    var body: some View {
        VStack(spacing: 0) {
            if showFind {
                FindReplaceBar(controller: controller, isPresented: $showFind)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            CodeEditorView(controller: controller)
                .background(Color(uiColor: palette.background))
        }
        .background(Color(uiColor: palette.background).ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) { statusBar }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color(uiColor: palette.background), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar { toolbarContent }
        .sheet(item: $sheet) { s in sheetView(s) }
        .onAppear(perform: onAppear)
        .onDisappear(perform: flush)
        .onChange(of: scenePhase) { _, phase in if phase != .active { flush() } }
        .onChange(of: editorTheme) { _, _ in controller.palette = palette }
        .onChange(of: colorScheme) { _, _ in controller.palette = palette }
        .onChange(of: fontSize) { _, v in if abs(controller.fontSize - CGFloat(v)) > 0.1 { controller.fontSize = CGFloat(v) } }
        .onChange(of: tabWidth) { _, _ in controller.indentUnit = indentUnit }
        .onChange(of: useTabs) { _, _ in controller.indentUnit = indentUnit }
        .onChange(of: autoPair) { _, v in controller.autoPair = v }
        .onChange(of: lineNumbers) { _, v in controller.showsLineNumbers = v }
        .onChange(of: item.title) { _, _ in runAnalysis(delay: 0.3) }
        .animation(.snappy(duration: 0.25), value: showFind)
    }

    private var indentUnit: String { useTabs ? "\t" : String(repeating: " ", count: max(1, tabWidth)) }

    // MARK: Lifecycle

    private func onAppear() {
        controller.palette = palette
        controller.indentUnit = indentUnit
        controller.autoPair = autoPair
        controller.showsLineNumbers = lineNumbers
        if controller.text != item.content { controller.setText(item.content) }
        openedContent = item.content
        store.recordRevision(item, reason: "Beim Öffnen")
        item.lastOpenedAt = Date()
        store.save()
        analysis.compilerDiagnostics = CompilerService.decode(item.compilerResultJSON)
        analysis.compiledAt = item.compiledAt
        controller.onTextChange = { text in scheduleSave(text) }
        controller.onFontSizeChange = { size in fontSize = Double(size) }
        runAnalysis(delay: 0)
    }

    private func scheduleSave(_ text: String) {
        saveTask?.cancel()
        saveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 600_000_000)
            if Task.isCancelled { return }
            persist(text)
        }
        if liveAnalysis { runAnalysis(delay: 0.8) }
    }

    private func persist(_ text: String) {
        guard item.content != text else { return }
        store.updateContent(item, to: text)
        // Compiler results refer to an older version once the code changes.
        if !analysis.compilerDiagnostics.isEmpty {
            analysis.compilerDiagnostics = []
            item.compilerResultJSON = nil
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
        store.refreshScriptMetadata(item, fillEmptyOnly: true)
        store.save()
    }

    private func runAnalysis(delay: Double) {
        analysis.schedule(text: controller.text, fileName: item.title, delay: delay) { report in
            controller.diagnostics = report.diagnostics + analysis.compilerDiagnostics
            if item.lastErrorCount != report.errorCount || item.lastWarningCount != report.warningCount || item.scriptKindRaw != report.scriptKind.rawValue {
                item.lastErrorCount = report.errorCount
                item.lastWarningCount = report.warningCount
                item.scriptKindRaw = report.scriptKind.rawValue
            }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Button { sheet = .metadata } label: {
                VStack(spacing: 1) {
                    HStack(spacing: 5) {
                        Image(systemName: "chevron.left.forwardslash.chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.script)
                        Text(FileNaming.fileName(for: item.snapshot())).font(Theme.mono(14, .semibold)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                    }
                    Text(item.locationDescription).font(.system(size: 10)).foregroundStyle(Theme.textTertiary).lineLimit(1)
                }
            }
            .accessibilityLabel("Skript-Eigenschaften")
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button { showFind.toggle() } label: { Image(systemName: "magnifyingglass") }
                .accessibilityLabel("Suchen und Ersetzen")
            Menu {
                Button { controller.undo() } label: { Label("Rückgängig", systemImage: "arrow.uturn.backward") }.disabled(!controller.canUndo)
                Button { controller.redo() } label: { Label("Wiederholen", systemImage: "arrow.uturn.forward") }.disabled(!controller.canRedo)
                Divider()
                Button { sheet = .snippets } label: { Label("Snippet einfügen", systemImage: "text.badge.plus") }
                Button { controller.formatDocument() } label: { Label("Dokument formatieren", systemImage: "text.alignleft") }
                Button { controller.toggleComment() } label: { Label("Kommentar umschalten", systemImage: "number") }
                Button { UIPasteboard.general.string = controller.text; store.show("Code kopiert", symbol: "doc.on.doc") } label: {
                    Label("Gesamten Code kopieren", systemImage: "doc.on.doc")
                }
                Button { if let s = UIPasteboard.general.string { controller.insertSnippet(s) } } label: {
                    Label("Einfügen", systemImage: "doc.on.clipboard")
                }
                Divider()
                Menu {
                    Button("Größer") { fontSize = min(28, fontSize + 1) }
                    Button("Kleiner") { fontSize = max(9, fontSize - 1) }
                    Picker("Theme", selection: $editorTheme) {
                        ForEach(EditorThemeChoice.allCases) { Text($0.title).tag($0.rawValue) }
                    }
                    Toggle("Zeilennummern", isOn: $lineNumbers)
                    Toggle("Klammern automatisch schließen", isOn: $autoPair)
                } label: { Label("Darstellung", systemImage: "textformat.size") }
                Divider()
                Button { sheet = .metadata } label: { Label("Eigenschaften", systemImage: "info.circle") }
                Button { sheet = .export } label: { Label("Als .cs exportieren / teilen", systemImage: "square.and.arrow.up") }
                Button { sheet = .claude } label: { Label("Als Claude-Kontext", systemImage: "sparkles") }
                Button { sheet = .revisions } label: { Label("Versionen", systemImage: "clock.arrow.circlepath") }
                Button { store.toggleFavorite(item) } label: {
                    Label(item.isFavorite ? "Favorit entfernen" : "Als Favorit markieren", systemImage: item.isFavorite ? "star.slash" : "star")
                }
                Button { flush(); store.duplicate(item) } label: { Label("Duplizieren", systemImage: "plus.square.on.square") }
            } label: { Image(systemName: "ellipsis.circle") }
        }
    }

    // MARK: Status bar

    private var statusBar: some View {
        let report = analysis.report
        let errors = (report?.errorCount ?? 0) + analysis.compilerDiagnostics.filter { $0.severity == .error }.count
        let warnings = (report?.warningCount ?? 0) + analysis.compilerDiagnostics.filter { $0.severity == .warning }.count
        let infos = report?.infoCount ?? 0
        return HStack(spacing: 10) {
            Button { sheet = .analysis } label: {
                HStack(spacing: 8) {
                    if analysis.isRunning {
                        ProgressView().controlSize(.mini)
                    } else if errors == 0 && warnings == 0 {
                        Image(systemName: "checkmark.seal.fill").foregroundStyle(Theme.success)
                    }
                    if errors > 0 { Label("\(errors)", systemImage: "xmark.octagon.fill").foregroundStyle(Theme.error) }
                    if warnings > 0 { Label("\(warnings)", systemImage: "exclamationmark.triangle.fill").foregroundStyle(Theme.warning) }
                    if infos > 0 { Label("\(infos)", systemImage: "info.circle.fill").foregroundStyle(Theme.info) }
                    if let kind = report?.scriptKind, kind != .empty {
                        Text(kind.rawValue).foregroundStyle(Theme.textSecondary).lineLimit(1)
                    }
                }
                .labelStyle(CompactLabelStyle())
                .font(Theme.mono(11, .semibold))
            }
            .accessibilityLabel("Analyse: \(errors) Fehler, \(warnings) Warnungen")
            Spacer(minLength: 4)
            Text("Ln \(controller.line), Sp \(controller.column)").font(Theme.mono(11)).foregroundStyle(Theme.textTertiary)
            Button { sheet = .outline } label: { Image(systemName: "list.bullet.indent") }
                .accessibilityLabel("Struktur")
            Button { sheet = .snippets } label: { Image(systemName: "text.badge.plus") }
                .accessibilityLabel("Snippets")
        }
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(Theme.accent)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(Color(uiColor: palette.background).opacity(0.97))
        .overlay(alignment: .top) { Rectangle().fill(Theme.stroke).frame(height: 1) }
    }

    // MARK: Sheets

    @ViewBuilder
    private func sheetView(_ s: EditorSheet) -> some View {
        switch s {
        case .analysis:
            AnalysisSheet(item: item, analysis: analysis, compilerURL: compilerURL,
                          onJump: { d in sheet = nil; DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { controller.goTo(line: d.line, column: d.column, select: false); controller.focus() } },
                          onCompile: compileOnPC)
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.background)
        case .outline:
            OutlineSheet(report: analysis.report) { line in
                sheet = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { controller.goTo(line: line, select: false) }
            }
            .presentationDetents([.medium, .large])
            .presentationBackground(Theme.background)
        case .snippets:
            SnippetSheet { code in
                sheet = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { controller.insertSnippet(code) }
            }
            .presentationDetents([.medium, .large])
            .presentationBackground(Theme.background)
        case .metadata:
            ItemMetadataSheet(item: item, report: analysis.report)
                .presentationBackground(Theme.background)
        case .export:
            ExportSheet(scope: .items([item.id]), title: item.title)
                .presentationBackground(Theme.background)
        case .revisions:
            RevisionsView(item: item) { restored in controller.setText(restored); openedContent = restored }
                .presentationBackground(Theme.background)
        case .claude:
            ClaudeContextSheet(items: [item])
                .presentationBackground(Theme.background)
        }
    }

    private func compileOnPC() {
        flush()
        analysis.isCompiling = true
        analysis.compilerError = nil
        let main = item.snapshot()
        // Send the other scripts of the same project so cross-references resolve.
        let projectRoot = item.folder?.root
        let others = store.liveItems().filter { $0.kind == .script && $0.id != item.id && (projectRoot == nil || $0.folder?.root.id == projectRoot?.id) }.map { $0.snapshot() }
        Task {
            do {
                let (result, diags) = try await CompilerService.compile(main: main, others: others, baseURL: compilerURL, token: Keychain.get("compiler.token"))
                analysis.compilerDiagnostics = diags
                analysis.compiledAt = result.compiledAt
                item.compilerResultJSON = CompilerService.encode(diags)
                item.compiledAt = result.compiledAt
                store.save()
                controller.diagnostics = (analysis.report?.diagnostics ?? []) + diags
            } catch {
                analysis.compilerError = error.localizedDescription
            }
            analysis.isCompiling = false
        }
    }
}

struct CompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) { configuration.icon; configuration.title }
    }
}

// MARK: - Find & replace

struct FindReplaceBar: View {
    @ObservedObject var controller: CodeEditorController
    @Binding var isPresented: Bool
    @State private var query = ""
    @State private var replacement = ""
    @State private var showReplace = false
    @State private var options = CodeEditorController.FindOptions()
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.textTertiary)
                    TextField("Suchen", text: $query)
                        .font(Theme.mono(14))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focused)
                        .submitLabel(.search)
                        .onSubmit { controller.selectMatch(1) }
                    if !query.isEmpty {
                        Text(controller.matchCount == 0 ? "0" : "\(controller.currentMatchIndex + 1)/\(controller.matchCount)")
                            .font(Theme.mono(11)).foregroundStyle(Theme.textSecondary)
                    }
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(Theme.surfaceHighlight, in: RoundedRectangle(cornerRadius: 10))
                Button { controller.selectMatch(-1) } label: { Image(systemName: "chevron.up") }.disabled(controller.matchCount == 0)
                Button { controller.selectMatch(1) } label: { Image(systemName: "chevron.down") }.disabled(controller.matchCount == 0)
                Menu {
                    Toggle("Groß-/Kleinschreibung", isOn: $options.caseSensitive)
                    Toggle("Ganzes Wort", isOn: $options.wholeWord)
                    Toggle("Regulärer Ausdruck", isOn: $options.regex)
                    Toggle("Ersetzen anzeigen", isOn: $showReplace)
                } label: { Image(systemName: "slider.horizontal.3") }
                Button { controller.clearFind(); isPresented = false } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textTertiary) }
            }
            if showReplace {
                HStack(spacing: 8) {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.2.squarepath").foregroundStyle(Theme.textTertiary)
                        TextField("Ersetzen durch", text: $replacement)
                            .font(Theme.mono(14))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    .padding(.horizontal, 10).padding(.vertical, 8)
                    .background(Theme.surfaceHighlight, in: RoundedRectangle(cornerRadius: 10))
                    Button("Ersetzen") { controller.replaceCurrent(with: replacement, query: query, options: options) }
                        .disabled(controller.matchCount == 0)
                    Button("Alle") { controller.replaceAll(with: replacement, query: query, options: options) }
                        .disabled(controller.matchCount == 0)
                }
                .font(.system(size: 14, weight: .semibold))
            }
        }
        .foregroundStyle(Theme.accent)
        .padding(10)
        .background(Theme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.stroke).frame(height: 1) }
        .onAppear { focused = true; showReplace = false }
        .onChange(of: query) { _, q in controller.find(q, options: options) }
        .onChange(of: options) { _, o in controller.find(query, options: o) }
    }
}

// MARK: - Analysis sheet

struct AnalysisSheet: View {
    let item: VaultItem
    let analysis: AnalysisModel
    let compilerURL: String
    var onJump: (CodeDiagnostic) -> Void
    var onCompile: () -> Void
    @State private var tab = 0
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("", selection: $tab) {
                    Text("Probleme").tag(0)
                    Text("Was wurde geprüft?").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16).padding(.vertical, 10)
                if tab == 0 { problems } else { coverage }
            }
            .vaultBackground()
            .navigationTitle("Code-Analyse")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
        }
    }

    private var problems: some View {
        List {
            if let r = analysis.report {
                Section {
                    HStack(spacing: 14) {
                        summaryTile("\(r.errorCount)", "Fehler", Theme.error)
                        summaryTile("\(r.warningCount)", "Warnungen", Theme.warning)
                        summaryTile("\(r.infoCount)", "Hinweise", Theme.info)
                        summaryTile("\(r.lineCount)", "Zeilen", Theme.textSecondary)
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                }
                if r.diagnostics.isEmpty {
                    Section {
                        Label("Keine Probleme in der lokalen Analyse gefunden.", systemImage: "checkmark.seal.fill")
                            .foregroundStyle(Theme.success)
                    } footer: {
                        Text("Lokal geprüft: Syntax, Struktur, C#-Heuristiken und Unity-Regeln. Eine echte Kompilierung gegen die Unity-Assemblies erfolgt über den PC-Companion.")
                    }
                }
                ForEach(DiagnosticSource.allCases.filter { $0 != .compiler }, id: \.self) { source in
                    let list = r.diagnostics.filter { $0.source == source }
                    if !list.isEmpty {
                        Section(source.displayName + " (\(list.count))") {
                            ForEach(list) { d in DiagnosticRow(d: d).contentShape(Rectangle()).onTapGesture { onJump(d) } }
                        }
                    }
                }
            } else {
                ProgressView("Analysiere …")
            }
            compilerSection
        }
        .scrollContentBackground(.hidden)
    }

    @ViewBuilder
    private var compilerSection: some View {
        Section {
            if analysis.isCompiling {
                HStack { ProgressView(); Text("Kompiliere auf dem PC …").foregroundStyle(Theme.textSecondary) }
            } else if let err = analysis.compilerError {
                Label(err, systemImage: "wifi.exclamationmark").foregroundStyle(Theme.error).font(.callout)
            }
            if let at = analysis.compiledAt, !analysis.isCompiling {
                if analysis.compilerDiagnostics.isEmpty {
                    Label("Erfolgreich kompiliert (\(at.relativeDescription))", systemImage: "checkmark.circle.fill").foregroundStyle(Theme.success)
                } else {
                    ForEach(analysis.compilerDiagnostics) { d in DiagnosticRow(d: d).contentShape(Rectangle()).onTapGesture { onJump(d) } }
                }
            }
            Button(action: onCompile) {
                Label(compilerURL.isEmpty ? "PC-Compiler in den Einstellungen einrichten" : "Jetzt auf dem PC kompilieren (Roslyn)", systemImage: "desktopcomputer")
            }
            .disabled(compilerURL.isEmpty || analysis.isCompiling)
        } header: {
            Text("Echte Kompilierung")
        } footer: {
            Text("iOS erlaubt keine Ausführung des C#-Compilers mit Unity-Referenzen. Der PC-Companion (companion/VaultCompiler) kompiliert mit Roslyn gegen deine Unity-Installation und liefert echte Compilerfehler zurück.")
        }
    }

    private func summaryTile(_ value: String, _ label: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value).font(Theme.mono(20, .bold)).foregroundStyle(color)
            Text(label).font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .cardStyle()
    }

    private var coverage: some View {
        List {
            Section {
                ForEach(analysis.report?.checks ?? [], id: \.name) { c in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: c.performed ? "checkmark.circle.fill" : "xmark.circle")
                            .foregroundStyle(c.performed ? Theme.success : Theme.textTertiary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.name).font(.system(size: 15, weight: .semibold))
                            Text(c.detail).font(.footnote).foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: analysis.compiledAt != nil ? "checkmark.circle.fill" : "circle.dashed")
                        .foregroundStyle(analysis.compiledAt != nil ? Theme.success : Theme.textTertiary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Roslyn-Kompilierung (PC)").font(.system(size: 15, weight: .semibold))
                        Text(analysis.compiledAt.map { "Zuletzt: \($0.shortDateTime)" } ?? "Noch nicht ausgeführt").font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                }
            } footer: {
                Text("Die lokale Analyse ist eine eigene, auf dem Gerät laufende Implementierung (Lexer + fehlertoleranter Parser + Regelwerk). Sie erkennt Syntaxfehler und typische Unity-Probleme, ersetzt aber keinen Compiler: Tippfehler in Methodennamen fremder Klassen oder falsche Typen werden nur vom Roslyn-Compiler gefunden.")
            }
        }
        .scrollContentBackground(.hidden)
    }
}

struct DiagnosticRow: View {
    let d: CodeDiagnostic
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: d.severity == .error ? "xmark.octagon.fill" : (d.severity == .warning ? "exclamationmark.triangle.fill" : "info.circle.fill"))
                .foregroundStyle(Theme.color(for: d.severity))
                .font(.system(size: 15))
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 4) {
                Text(d.message).font(.system(size: 14)).foregroundStyle(Theme.textPrimary)
                if let s = d.suggestion {
                    Text("→ " + s).font(.system(size: 12)).foregroundStyle(Theme.accent)
                }
                HStack(spacing: 6) {
                    Text("Zeile \(d.line)").font(Theme.mono(11, .semibold))
                    Text(d.ruleID).font(Theme.mono(11))
                    Text(d.source.displayName).font(Theme.mono(11))
                }
                .foregroundStyle(Theme.textTertiary)
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Outline

struct OutlineSheet: View {
    let report: AnalysisReport?
    var onJump: (Int) -> Void

    var body: some View {
        NavigationStack {
            List {
                if let r = report, !r.types.isEmpty {
                    ForEach(Array(r.types.enumerated()), id: \.offset) { _, t in
                        Section {
                            row(symbol: symbol(for: t.kind), color: Theme.accent, title: t.name, detail: t.bases.isEmpty ? t.kind.rawValue : ": " + t.bases.joined(separator: ", "), line: t.line)
                            ForEach(t.fields, id: \.self) { f in
                                row(symbol: "f.square", color: Theme.info, title: f.name, detail: f.typeName, line: f.line)
                            }
                            ForEach(t.properties, id: \.self) { p in
                                row(symbol: "p.square", color: Theme.prompt, title: p.name, detail: p.typeName, line: p.line)
                            }
                            ForEach(t.methods, id: \.self) { m in
                                let isMessage = UnityCatalog.messages[m.name] != nil
                                row(symbol: isMessage ? "bolt.square" : "m.square", color: isMessage ? Theme.amber : Theme.script,
                                    title: m.name + "(" + m.parameterTypes.joined(separator: ", ") + ")", detail: m.returnType, line: m.line)
                            }
                        }
                    }
                    if !r.usings.isEmpty {
                        Section("using") { Text(r.usings.joined(separator: "\n")).font(Theme.mono(12)).foregroundStyle(Theme.textSecondary) }
                    }
                } else {
                    EmptyStateView(symbol: "list.bullet.indent", title: "Keine Struktur", message: "Sobald das Skript Typen und Methoden enthält, erscheinen sie hier.")
                        .listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .vaultBackground()
            .navigationTitle("Struktur")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func symbol(for kind: TypeDeclKind) -> String {
        switch kind {
        case .class: return "c.square.fill"
        case .struct: return "s.square.fill"
        case .interface: return "i.square.fill"
        case .enum: return "e.square.fill"
        case .record: return "r.square.fill"
        }
    }

    private func row(symbol: String, color: Color, title: String, detail: String, line: Int) -> some View {
        Button { onJump(line) } label: {
            HStack(spacing: 10) {
                Image(systemName: symbol).foregroundStyle(color)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(Theme.mono(13, .semibold)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                    if !detail.isEmpty { Text(detail).font(Theme.mono(11)).foregroundStyle(Theme.textTertiary).lineLimit(1) }
                }
                Spacer()
                Text("\(line)").font(Theme.mono(11)).foregroundStyle(Theme.textTertiary)
            }
        }
    }
}

// MARK: - Snippets

struct SnippetSheet: View {
    var onInsert: (String) -> Void
    var body: some View {
        NavigationStack {
            List {
                Section("Snippets") {
                    ForEach(UnityTemplates.snippets) { s in
                        Button { onInsert(s.code) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(s.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                                Text(s.code.replacingOccurrences(of: "$0", with: "▍")).font(Theme.mono(11)).foregroundStyle(Theme.textSecondary).lineLimit(3)
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .vaultBackground()
            .navigationTitle("Einfügen")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
