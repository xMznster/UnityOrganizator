import SwiftUI
import UIKit
import VaultKit

// MARK: - Metadata

struct ItemMetadataSheet: View {
    @Bindable var item: VaultItem
    var report: AnalysisReport?
    @Environment(VaultStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var showFolderPicker = false
    @State private var allTags: [String] = []

    var body: some View {
        NavigationStack {
            Form {
                Section(item.kind == .script ? "Skript" : "Allgemein") {
                    TextField(item.kind == .script ? "Skriptname (= Klassenname)" : "Titel", text: $item.title)
                        .font(item.kind == .script ? Theme.mono(15) : .body)
                        .textInputAutocapitalization(item.kind == .script ? .never : .sentences)
                        .autocorrectionDisabled(item.kind == .script)
                    if item.kind == .script, let r = report, let main = r.types.first(where: { $0.nestingDepth == 0 && ($0.bases.contains("MonoBehaviour") || $0.bases.contains("ScriptableObject")) }), main.name != item.title {
                        Button { item.title = main.name } label: {
                            Label("Auf Klassennamen „\(main.name)“ setzen", systemImage: "wand.and.stars")
                        }
                    }
                    TextField("Kurzbeschreibung (optional)", text: $item.summary, axis: .vertical)
                        .lineLimit(2...5)
                }
                Section("Kategorie") {
                    TextField("Kategorie", text: $item.category)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(categorySuggestions, id: \.self) { c in
                                Button { item.category = c } label: { Chip(text: c, color: Theme.accent, selected: item.category == c) }
                                    .buttonStyle(.plain)
                            }
                        }
                    }
                }
                Section("Tags") {
                    TagEditor(tags: $item.tags, suggestions: allTags)
                }
                Section("Ort") {
                    Button { showFolderPicker = true } label: {
                        HStack {
                            Label(item.locationDescription, systemImage: "folder")
                            Spacer()
                            Text("Verschieben").foregroundStyle(Theme.accent)
                        }
                    }
                    .foregroundStyle(Theme.textPrimary)
                    Toggle(isOn: $item.isFavorite) { Label("Favorit", systemImage: "star") }
                }
                if item.kind == .script { scriptSection }
                Section {
                    LabeledContent("Erstellt", value: item.createdAt.shortDateTime)
                    LabeledContent("Geändert", value: item.modifiedAt.shortDateTime)
                    LabeledContent("Versionen", value: "\(item.revisions.count)")
                    LabeledContent("ID", value: item.id.uuidString.prefix(8) + "…")
                }
                .font(.footnote)
            }
            .scrollContentBackground(.hidden)
            .vaultBackground()
            .navigationTitle("Eigenschaften")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") { item.touch(); store.save(); dismiss() }
                }
            }
            .sheet(isPresented: $showFolderPicker) {
                FolderPickerView(title: "Verschieben nach", excluded: nil) { folder in
                    store.move([item], to: folder)
                }
            }
            .onAppear { allTags = Array(Set(store.liveItems().flatMap(\.tags))).sorted() }
        }
    }

    private var categorySuggestions: [String] {
        var list: [String]
        switch item.kind {
        case .note: list = CategoryPresets.note
        case .prompt: list = CategoryPresets.prompt
        case .script: list = (report?.suggestedCategories ?? []) + CategoryPresets.script
        }
        var seen = Set<String>()
        return list.filter { seen.insert($0).inserted }
    }

    @ViewBuilder
    private var scriptSection: some View {
        Section("Unity") {
            Picker("Status", selection: Binding(get: { item.status ?? .inDevelopment }, set: { item.status = $0 })) {
                ForEach(ScriptStatus.allCases) { s in Label(s.displayName, systemImage: s.symbol).tag(s) }
            }
            TextField("Unity-Version (z. B. 6000.0 LTS)", text: $item.unityVersion)
                .textInputAutocapitalization(.never)
            TextField("Projekt (leer = Hauptordner)", text: $item.projectName)
            if let kind = report?.scriptKind ?? UnityScriptKind(rawValue: item.scriptKindRaw) {
                LabeledContent("Erkannter Typ", value: kind.rawValue)
            }
        }
        Section {
            TagEditor(tags: $item.components, suggestions: Array(UnityCatalog.componentTypes).sorted())
        } header: { Text("Verwendete Komponenten") }
        Section {
            TagEditor(tags: $item.dependencies, suggestions: [])
            Button {
                store.refreshScriptMetadata(item, fillEmptyOnly: false)
                store.show("Aus Code erkannt", symbol: "wand.and.stars")
            } label: { Label("Komponenten, Kategorie & Abhängigkeiten aus Code erkennen", systemImage: "wand.and.stars") }
        } header: { Text("Abhängigkeiten") } footer: {
            Text("Erkannt werden zusätzliche Namespaces (using) und Typen, die in anderen Skripten deines Vaults deklariert sind.")
        }
    }
}

// MARK: - Folder picker

struct FolderPickerView: View {
    var title: String
    /// Folder that may not be chosen (and its descendants), e.g. when moving a folder.
    var excluded: Folder?
    var allowsInbox = true
    var onPick: (Folder?) -> Void
    @Environment(VaultStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var newFolderName = ""
    @State private var creatingIn: Folder?? = nil

    var body: some View {
        NavigationStack {
            List {
                if allowsInbox {
                    Button { onPick(nil); dismiss() } label: {
                        Label(excluded == nil ? "Inbox (ohne Ordner)" : "Oberste Ebene (Projekt)", systemImage: excluded == nil ? "tray" : "square.stack.3d.up")
                    }
                }
                Section("Ordner") {
                    ForEach(store.rootFolders()) { f in FolderPickerRow(folder: f, depth: 0, excluded: excluded) { picked in onPick(picked); dismiss() } }
                }
            }
            .scrollContentBackground(.hidden)
            .vaultBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
            }
        }
    }
}

private struct FolderPickerRow: View {
    let folder: Folder
    let depth: Int
    let excluded: Folder?
    var onPick: (Folder) -> Void

    var body: some View {
        let disabled = excluded.map { folder.id == $0.id || folder.isDescendant(of: $0) } ?? false
        Button { onPick(folder) } label: {
            HStack(spacing: 10) {
                Image(systemName: folder.isProject ? folder.icon : "folder.fill").foregroundStyle(Theme.folderColor(folder.colorHex))
                Text(folder.name).foregroundStyle(disabled ? Theme.textTertiary : Theme.textPrimary)
                Spacer()
            }
            .padding(.leading, CGFloat(depth) * 18)
        }
        .disabled(disabled)
        ForEach(folder.sortedChildren) { child in
            FolderPickerRow(folder: child, depth: depth + 1, excluded: excluded, onPick: onPick)
        }
    }
}

// MARK: - Revisions

struct RevisionsView: View {
    let item: VaultItem
    var onRestore: (String) -> Void
    @Environment(VaultStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var preview: Revision?

    var body: some View {
        NavigationStack {
            List {
                let revs = item.revisions.sorted { $0.createdAt > $1.createdAt }
                if revs.isEmpty {
                    EmptyStateView(symbol: "clock.arrow.circlepath", title: "Keine Versionen", message: "Versionen entstehen beim Bearbeiten und vor Synchronisierungen automatisch.")
                        .listRowBackground(Color.clear)
                }
                ForEach(revs) { r in
                    Button { preview = r } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(r.createdAt.shortDateTime).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                                Spacer()
                                Text(r.reason).font(Theme.mono(11)).foregroundStyle(Theme.textTertiary)
                            }
                            Text(diffSummary(old: r.content, new: item.content)).font(Theme.mono(11)).foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .vaultBackground()
            .navigationTitle("Versionen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
            .navigationDestination(item: $preview) { r in
                ScrollView {
                    Text(r.content).font(Theme.mono(12)).textSelection(.enabled).padding().frame(maxWidth: .infinity, alignment: .leading)
                }
                .vaultBackground()
                .navigationTitle(r.createdAt.shortDateTime)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Wiederherstellen") {
                            store.restore(r)
                            onRestore(item.content)
                            dismiss()
                        }
                    }
                }
            }
        }
    }

    private func diffSummary(old: String, new: String) -> String {
        let a = old.components(separatedBy: "\n"), b = new.components(separatedBy: "\n")
        let setA = Set(a), setB = Set(b)
        let added = b.filter { !setA.contains($0) }.count
        let removed = a.filter { !setB.contains($0) }.count
        if added == 0 && removed == 0 { return "identisch mit aktueller Version · \(a.count) Zeilen" }
        return "\(a.count) Zeilen · ggü. aktuell: +\(added) / −\(removed)"
    }
}

// MARK: - Share / save helpers

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

/// "In Dateien sichern" for one or more files (any type).
struct DocumentExporter: UIViewControllerRepresentable {
    let urls: [URL]
    var onFinish: (Bool) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let vc = UIDocumentPickerViewController(forExporting: urls, asCopy: true)
        vc.delegate = context.coordinator
        return vc
    }
    func updateUIViewController(_ vc: UIDocumentPickerViewController, context: Context) {}
    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onFinish: (Bool) -> Void
        init(onFinish: @escaping (Bool) -> Void) { self.onFinish = onFinish }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { onFinish(true) }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { onFinish(false) }
    }
}

// MARK: - Export sheet

struct ExportSheet: View {
    enum Scope {
        case items([UUID])
        case folder(UUID)
        case all
    }
    let scope: Scope
    let title: String
    @Environment(VaultStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var format: Format = .automatic
    @State private var frontMatter = true
    @State private var preserveFolders = true
    @State private var includeManifest = true
    @State private var exportedURLs: [URL] = []
    @State private var showShare = false
    @State private var showSave = false
    @State private var error: String?
    @State private var verified: Bool?

    enum Format: String, CaseIterable, Identifiable {
        case automatic = "Einzeldateien (.cs / .md)"
        case zip = "ZIP mit Ordnerstruktur"
        case unityOnly = "Nur C# (Unity-Assets-Ordner)"
        case promptsTXT = "Prompts als .txt"
        var id: String { rawValue }
    }

    private var snapshotItems: [SnapshotItem] {
        let snap = store.snapshot()
        switch scope {
        case .items(let ids): return snap.items.filter { ids.contains($0.id) }
        case .folder(let fid): let tree = snap.subtree(of: fid); return snap.items.filter { $0.folderID.map(tree.contains) ?? false }
        case .all: return snap.items
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Inhalt", value: title)
                    let items = snapshotItems
                    LabeledContent("Einträge", value: "\(items.count) · \(items.filter { $0.kind == .script }.count) Skripte")
                }
                Section("Format") {
                    Picker("Format", selection: $format) {
                        ForEach(Format.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section {
                    Toggle("Ordnerstruktur beibehalten", isOn: $preserveFolders)
                    if format != .unityOnly {
                        Toggle("Metadaten als Front Matter in .md", isOn: $frontMatter)
                    }
                    if format == .zip {
                        Toggle("Manifest + INDEX.md (re-importierbar)", isOn: $includeManifest)
                    }
                } footer: {
                    Text("C#-Dateien werden byte-genau exportiert – der Code bleibt vollständig erhalten. Exporte liegen zusätzlich unter Dateien ▸ Auf meinem iPhone ▸ Unity Vault ▸ Exports.")
                }
                if let error { Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.error) } }
                if !exportedURLs.isEmpty {
                    Section("Bereit") {
                        ForEach(exportedURLs.prefix(8), id: \.self) { u in Label(u.lastPathComponent, systemImage: "doc").font(Theme.mono(12)) }
                        if exportedURLs.count > 8 { Text("+ \(exportedURLs.count - 8) weitere").font(.footnote).foregroundStyle(Theme.textSecondary) }
                        if let verified {
                            Label(verified ? "Inhalt geprüft: identisch" : "Prüfung fehlgeschlagen", systemImage: verified ? "checkmark.seal.fill" : "xmark.seal")
                                .foregroundStyle(verified ? Theme.success : Theme.error)
                        }
                    }
                }
                Section {
                    Button { if prepare() { showShare = true } } label: { Label("Teilen …", systemImage: "square.and.arrow.up") }
                    Button { if prepare() { showSave = true } } label: { Label("In Dateien sichern …", systemImage: "folder.badge.plus") }
                }
            }
            .scrollContentBackground(.hidden)
            .vaultBackground()
            .navigationTitle("Exportieren")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Schließen") { dismiss() } } }
            .sheet(isPresented: $showShare) { ShareSheet(items: exportedURLs) }
            .sheet(isPresented: $showSave) {
                DocumentExporter(urls: exportedURLs) { ok in if ok { store.show("Gesichert", symbol: "folder.fill") } }
            }
            .onAppear {
                if case .items(let ids) = scope, ids.count == 1 { format = .automatic } else { format = .zip }
            }
        }
    }

    /// Builds the files. Returns false on error.
    private func prepare() -> Bool {
        error = nil
        verified = nil
        let snap = store.snapshot()
        var options = ExportBuilder.Options()
        options.preserveFolders = preserveFolders
        options.codec = FileCodec.Options(frontMatter: frontMatter, promptsAsText: format == .promptsTXT)
        options.scriptsOnly = format == .unityOnly
        options.includeManifest = includeManifest && format == .zip
        options.rootName = format == .unityOnly ? "Scripts" : FileNaming.safeName(title)
        let builder = ExportBuilder(snapshot: snap, options: options)
        let ids: [UUID]?
        var rootFolder: UUID? = nil
        switch scope {
        case .items(let list): ids = list
        case .folder(let fid): ids = nil; rootFolder = fid
        case .all: ids = nil
        }
        do {
            if format == .zip {
                let data = builder.zip(for: ids, rootFolder: rootFolder)
                exportedURLs = [try ExportService.writeZip(data, name: title)]
                verified = ZipReader.read(data) != nil
            } else {
                var opts = options
                opts.includeManifest = false
                opts.rootName = ""
                if case .items(let list) = scope, list.count == 1 { opts.preserveFolders = false }
                let files = ExportBuilder(snapshot: snap, options: opts).files(for: ids, rootFolder: rootFolder)
                guard !files.isEmpty else { error = "Keine passenden Einträge für dieses Format."; return false }
                let urls = try ExportService.writeFiles(files)
                verified = ExportService.verify(files, at: urls)
                exportedURLs = urls
            }
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}

// MARK: - Claude context

struct ClaudeContextSheet: View {
    let items: [VaultItem]
    @Environment(VaultStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var task = ""
    @State private var showShare = false
    @State private var url: URL?

    private var bundle: String {
        ClaudeBridge.contextBundle(items: items.map { $0.snapshot() }, snapshot: store.snapshot(), task: task)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Aufgabe für Claude (optional), z. B. „Baue darauf ein Patrouillen-System auf“", text: $task, axis: .vertical)
                        .lineLimit(2...6)
                } header: { Text("Aufgabe") } footer: {
                    Text("Erzeugt ein Markdown-Dokument mit \(items.count) Einträgen inkl. Metadaten – zum Einfügen in Claude oder als Kontextdatei für Claude Code.")
                }
                Section("Vorschau") {
                    Text(bundle.prefix(1200) + (bundle.count > 1200 ? "\n…" : "")).font(Theme.mono(11)).foregroundStyle(Theme.textSecondary)
                }
                Section {
                    Button {
                        UIPasteboard.general.string = bundle
                        store.show("Kontext kopiert (\(bundle.count) Zeichen)", symbol: "sparkles")
                        dismiss()
                    } label: { Label("In Zwischenablage kopieren", systemImage: "doc.on.doc") }
                    Button {
                        url = try? ExportService.writeText(bundle, name: "claude-context.md")
                        showShare = url != nil
                    } label: { Label("Als claude-context.md teilen", systemImage: "square.and.arrow.up") }
                }
            }
            .scrollContentBackground(.hidden)
            .vaultBackground()
            .navigationTitle("Claude-Kontext")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Schließen") { dismiss() } } }
            .sheet(isPresented: $showShare) { if let url { ShareSheet(items: [url]) } }
        }
    }
}
