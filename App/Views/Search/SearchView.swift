import SwiftUI
import VaultKit

@MainActor
@Observable
final class SearchModel {
    var query = SearchQuery()
    var hits: [SearchHit] = []
    var isIndexing = false
    private(set) var index = SearchIndex()
    private var indexedToken = -1
    private var task: Task<Void, Never>?
    var projects: [String] = []
    var categories: [String] = []
    var tags: [(String, Int)] = []

    func ensureIndex(store: VaultStore) {
        guard indexedToken != store.changeToken else { return }
        indexedToken = store.changeToken
        let docs = store.searchDocuments()
        let fresh = SearchIndex(documents: docs)
        index = fresh
        projects = Array(Set(docs.compactMap(\.project))).sorted()
        categories = Array(Set(docs.map(\.category).filter { !$0.isEmpty })).sorted()
        tags = fresh.tagCounts()
        run(debounce: false)
    }

    func run(debounce: Bool = true) {
        task?.cancel()
        let q = query
        let idx = index
        task = Task { [weak self] in
            if debounce { try? await Task.sleep(nanoseconds: 150_000_000) }
            if Task.isCancelled { return }
            let result = await Task.detached(priority: .userInitiated) { idx.search(q) }.value
            if Task.isCancelled { return }
            self?.hits = result
        }
    }
}

struct SearchView: View {
    @Environment(VaultStore.self) private var store
    @Environment(Router.self) private var router
    @State private var model = SearchModel()
    @State private var showFilters = false
    @State private var text = ""

    private let kindScopes: [(String, SearchEntityKind?)] = [("Alle", nil), ("Skripte", .script), ("Notizen", .note), ("Prompts", .prompt), ("Ordner", .folder)]

    var body: some View {
        List {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(kindScopes, id: \.0) { scope in
                            let selected = scope.1 == nil ? model.query.kinds.isEmpty : model.query.kinds == [scope.1!]
                            Button {
                                model.query.kinds = scope.1.map { [$0] } ?? []
                                model.run(debounce: false)
                            } label: { Chip(text: scope.0, color: Theme.accent, selected: selected) }
                            .buttonStyle(.plain)
                        }
                        Divider().frame(height: 20)
                        Button {
                            model.query.mode = model.query.mode == .smart ? .exact : .smart
                            model.run(debounce: false)
                        } label: {
                            Chip(text: model.query.mode == .exact ? "Code-Fragment (exakt)" : "Intelligent", symbol: model.query.mode == .exact ? "chevron.left.forwardslash.chevron.right" : "text.magnifyingglass",
                                 color: Theme.prompt, selected: model.query.mode == .exact)
                        }
                        .buttonStyle(.plain)
                        Button { showFilters = true } label: {
                            Chip(text: model.query.hasFilters && !(model.query.kinds.count == 1 && !hasOtherFilters) ? "Filter aktiv" : "Filter",
                                 symbol: "line.3.horizontal.decrease.circle", color: Theme.amber, selected: hasOtherFilters)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.vertical, 2)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            }

            if text.isEmpty && !hasOtherFilters {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Durchsucht Titel, Inhalte, C#-Code (auch CamelCase wie SpiderLegAnimator), Beschreibungen, Tags, Kategorien und Ordnernamen gleichzeitig.")
                            .font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                        Text("Tipp: „Code-Fragment“ findet exakte Ausschnitte wie GetComponent<Rigidbody>(). Anführungszeichen suchen Phrasen.")
                            .font(.system(size: 13)).foregroundStyle(Theme.textTertiary)
                    }
                    .listRowBackground(Theme.surface)
                    if !model.tags.isEmpty {
                        FlowLayout(spacing: 6) {
                            ForEach(model.tags.prefix(30), id: \.0) { tag, count in
                                Button {
                                    model.query.tags = [tag]
                                    model.run(debounce: false)
                                } label: { TagChip(tag: "\(tag) \(count)") }
                                .buttonStyle(.plain)
                            }
                        }
                        .listRowBackground(Color.clear)
                    }
                } header: { SectionHeader(title: "Wissensbasis", count: model.index.count) }
            } else {
                Section {
                    if model.hits.isEmpty {
                        EmptyStateView(symbol: "magnifyingglass", title: "Keine Treffer", message: "Andere Begriffe oder weniger Filter versuchen.")
                            .listRowBackground(Color.clear)
                    }
                    ForEach(model.hits) { hit in
                        SearchHitRow(hit: hit) { open(hit) }
                            .listRowBackground(Theme.surface)
                    }
                } header: { SectionHeader(title: "Treffer", count: model.hits.count) }
            }
        }
        .scrollContentBackground(.hidden)
        .vaultBackground()
        .navigationTitle("Suche")
        .searchable(text: $text, placement: .navigationBarDrawer(displayMode: .always), prompt: "z. B. Spider Leg Animation")
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .onChange(of: text) { _, t in model.query.text = t; model.run() }
        .onAppear { model.ensureIndex(store: store) }
        .onChange(of: store.changeToken) { _, _ in model.ensureIndex(store: store) }
        .sheet(isPresented: $showFilters) {
            SearchFilterSheet(model: model).presentationDetents([.medium, .large])
        }
    }

    private var hasOtherFilters: Bool {
        !model.query.projects.isEmpty || !model.query.categories.isEmpty || !model.query.tags.isEmpty || !model.query.statuses.isEmpty || model.query.favoritesOnly
    }

    private func open(_ hit: SearchHit) {
        if hit.kind == .folder {
            if let f = store.folder(id: hit.id) { router.open(f) }
        } else if let item = store.item(id: hit.id) {
            router.open(item)
        }
    }
}

struct SearchHitRow: View {
    let hit: SearchHit
    var onTap: () -> Void
    @Environment(VaultStore.self) private var store

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 12) {
                IconBadge(symbol: symbol, color: color, size: 34)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(hit.kind == .script ? Theme.mono(14, .semibold) : .system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary).lineLimit(1)
                    Text(path).font(.system(size: 11)).foregroundStyle(Theme.textTertiary).lineLimit(1)
                    if !hit.snippet.isEmpty {
                        HStack(alignment: .top, spacing: 6) {
                            if let line = hit.line { Text("\(line)").font(Theme.mono(10, .semibold)).foregroundStyle(Theme.textTertiary) }
                            Text(highlightedSnippet).font(hit.kind == .script ? Theme.mono(12) : .system(size: 13)).lineLimit(2)
                        }
                    }
                    HStack(spacing: 4) {
                        ForEach(hit.matchedFields, id: \.self) { f in
                            Text(fieldName(f)).font(Theme.mono(9, .semibold)).foregroundStyle(Theme.accent)
                                .padding(.horizontal, 5).padding(.vertical, 2)
                                .background(Theme.accentSoft, in: Capsule())
                        }
                        if hit.matchCount > 1 { Text("\(hit.matchCount)×").font(Theme.mono(9)).foregroundStyle(Theme.textTertiary) }
                    }
                }
            }
            .padding(.vertical, 2)
        }
        .buttonStyle(.plain)
    }

    private var item: VaultItem? { hit.kind == .folder ? nil : store.item(id: hit.id) }
    private var folder: Folder? { hit.kind == .folder ? store.folder(id: hit.id) : nil }
    private var title: String {
        if let f = folder { return f.name }
        if let i = item { return i.kind == .script ? FileNaming.fileName(for: i.snapshot()) : i.title }
        return "?"
    }
    private var path: String { folder?.parent?.pathString ?? item?.locationDescription ?? "" }
    private var symbol: String {
        switch hit.kind {
        case .folder: return "folder.fill"
        case .note: return VaultItemKind.note.symbol
        case .prompt: return VaultItemKind.prompt.symbol
        case .script: return VaultItemKind.script.symbol
        }
    }
    private var color: Color {
        switch hit.kind {
        case .folder: return Theme.folder
        case .note: return Theme.note
        case .prompt: return Theme.prompt
        case .script: return Theme.script
        }
    }
    private func fieldName(_ f: SearchField) -> String {
        switch f {
        case .title: return "TITEL"
        case .tags: return "TAG"
        case .summary: return "BESCHREIBUNG"
        case .category: return "KATEGORIE"
        case .folder: return "ORDNER"
        case .content: return "TEXT"
        case .code: return "CODE"
        }
    }
    private var highlightedSnippet: AttributedString {
        var attr = AttributedString(hit.snippet)
        attr.foregroundColor = Theme.textSecondary
        for r in hit.highlights {
            if let range = Range<AttributedString.Index>(r, in: attr) {
                attr[range].foregroundColor = Theme.textPrimary
                attr[range].backgroundColor = Theme.amber.opacity(0.3)
            }
        }
        return attr
    }
}

struct SearchFilterSheet: View {
    @Bindable var model: SearchModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Nur Favoriten", isOn: $model.query.favoritesOnly)
                    Toggle("Groß-/Kleinschreibung (Code-Fragment)", isOn: $model.query.caseSensitive)
                }
                if !model.projects.isEmpty {
                    Section("Projekt") { chips(model.projects, selection: $model.query.projects) }
                }
                if !model.categories.isEmpty {
                    Section("Kategorie") { chips(model.categories, selection: $model.query.categories) }
                }
                Section("Skript-Status") {
                    chips(ScriptStatus.allCases.map(\.rawValue), selection: $model.query.statuses, label: { ScriptStatus(rawValue: $0)?.displayName ?? $0 })
                }
                if !model.tags.isEmpty {
                    Section("Tags (alle müssen passen)") { chips(model.tags.map(\.0), selection: $model.query.tags) }
                }
            }
            .scrollContentBackground(.hidden)
            .vaultBackground()
            .navigationTitle("Filter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Zurücksetzen") {
                        model.query.projects = []; model.query.categories = []; model.query.tags = []
                        model.query.statuses = []; model.query.favoritesOnly = false
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } }
            }
            .onChange(of: model.query) { _, _ in model.run(debounce: false) }
        }
    }

    private func chips(_ values: [String], selection: Binding<Set<String>>, label: @escaping (String) -> String = { $0 }) -> some View {
        FlowLayout(spacing: 6) {
            ForEach(values, id: \.self) { v in
                let on = selection.wrappedValue.contains(v)
                Button {
                    if on { selection.wrappedValue.remove(v) } else { selection.wrappedValue.insert(v) }
                } label: { Chip(text: label(v), color: Theme.accent, selected: on) }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
    }
}
