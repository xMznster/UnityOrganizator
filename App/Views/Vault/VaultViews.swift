import SwiftUI
import SwiftData
import UniformTypeIdentifiers
import VaultKit

// MARK: - Navigation

@MainActor
@Observable
final class Router {
    var path = NavigationPath()
    func open(_ item: VaultItem) { path.append(item) }
    func open(_ folder: Folder) { path.append(folder) }
    func popToRoot() { path = NavigationPath() }
}

struct ItemEditorRouter: View {
    let item: VaultItem
    var body: some View {
        if item.kind == .script { ScriptEditorView(item: item) } else { NoteEditorView(item: item) }
    }
}

extension View {
    func vaultDestinations() -> some View {
        self
            .navigationDestination(for: Folder.self) { FolderDetailView(folder: $0) }
            .navigationDestination(for: VaultItem.self) { ItemEditorRouter(item: $0) }
    }
}

// MARK: - Rows

struct ItemRow: View {
    let item: VaultItem
    var showPath = false

    var body: some View {
        HStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                IconBadge(symbol: item.kind.symbol, color: Theme.color(for: item.kind), size: 38)
                if item.kind == .script, let s = item.status {
                    Circle().fill(Theme.color(for: s)).frame(width: 10, height: 10)
                        .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 2))
                        .offset(x: 2, y: 2)
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(item.kind == .script ? FileNaming.fileName(for: item.snapshot()) : item.title)
                        .font(item.kind == .script ? Theme.mono(15, .semibold) : .system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    if item.isFavorite { Image(systemName: "star.fill").font(.system(size: 10)).foregroundStyle(Theme.amber) }
                }
                Text(showPath ? item.locationDescription : item.previewText)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    if !item.category.isEmpty { Text(item.category).font(Theme.mono(10, .medium)).foregroundStyle(Theme.textTertiary) }
                    ForEach(item.tags.prefix(2), id: \.self) { Text("#" + $0).font(Theme.mono(10)).foregroundStyle(Theme.textTertiary) }
                }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 4) {
                Text(item.modifiedAt.relativeDescription).font(Theme.mono(10)).foregroundStyle(Theme.textTertiary)
                if item.kind == .script {
                    if item.lastErrorCount > 0 {
                        Label("\(item.lastErrorCount)", systemImage: "xmark.octagon.fill").labelStyle(CompactLabelStyle()).font(Theme.mono(11, .semibold)).foregroundStyle(Theme.error)
                    } else if item.lastWarningCount > 0 {
                        Label("\(item.lastWarningCount)", systemImage: "exclamationmark.triangle.fill").labelStyle(CompactLabelStyle()).font(Theme.mono(11, .semibold)).foregroundStyle(Theme.warning)
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

struct FolderRow: View {
    let folder: Folder
    var body: some View {
        HStack(spacing: 12) {
            IconBadge(symbol: folder.isProject ? folder.icon : "folder.fill", color: Theme.folderColor(folder.colorHex), size: 38)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(folder.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                    if folder.isFavorite { Image(systemName: "star.fill").font(.system(size: 10)).foregroundStyle(Theme.amber) }
                }
                let subs = folder.children.count
                Text("\(folder.totalItemCount) Einträge" + (subs > 0 ? " · \(subs) Ordner" : ""))
                    .font(Theme.mono(11)).foregroundStyle(Theme.textTertiary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textTertiary)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

// MARK: - Vault root

struct VaultRootView: View {
    @Environment(VaultStore.self) private var store
    @Environment(Router.self) private var router
    @Query(filter: #Predicate<Folder> { $0.parent == nil }, sort: [SortDescriptor(\Folder.sortIndex), SortDescriptor(\Folder.name)]) private var projects: [Folder]
    @Query(filter: #Predicate<VaultItem> { $0.deletedAt == nil && $0.folder == nil }, sort: \VaultItem.modifiedAt, order: .reverse) private var inbox: [VaultItem]
    @Query(filter: #Predicate<VaultItem> { $0.deletedAt != nil }) private var trash: [VaultItem]
    @Query(filter: #Predicate<VaultItem> { $0.deletedAt == nil && $0.isFavorite }, sort: \VaultItem.modifiedAt, order: .reverse) private var favorites: [VaultItem]
    @State private var editingFolder: FolderEditTarget?
    @State private var showImport = false
    @State private var newScriptFolder: FolderBox?
    @State private var movingFolder: Folder?
    @State private var deletingFolder: Folder?

    var body: some View {
        List {
            Section {
                NavigationLink { InboxView() } label: {
                    HStack(spacing: 12) {
                        IconBadge(symbol: "tray.full", color: Theme.accent, size: 38)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Inbox").font(.system(size: 16, weight: .semibold))
                            Text("Einträge ohne Ordner").font(Theme.mono(11)).foregroundStyle(Theme.textTertiary)
                        }
                        Spacer()
                        Text("\(inbox.count)").font(Theme.mono(13, .semibold)).foregroundStyle(Theme.textSecondary)
                    }
                }
                NavigationLink { FavoritesView() } label: {
                    HStack(spacing: 12) {
                        IconBadge(symbol: "star.fill", color: Theme.amber, size: 38)
                        Text("Favoriten").font(.system(size: 16, weight: .semibold))
                        Spacer()
                        Text("\(favorites.count)").font(Theme.mono(13, .semibold)).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .listRowBackground(Theme.surface)

            Section {
                if projects.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Noch keine Projekte. Lege eigene Ordner an oder starte mit der vorgeschlagenen Struktur (Horror Game, Monster Game, General Unity, Blender, App Development).")
                            .font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                        HStack {
                            Button("Projekt anlegen") { editingFolder = .new(parent: nil) }.buttonStyle(PrimaryButtonStyle())
                            Button("Startstruktur") { store.createStarterStructure() }.buttonStyle(SecondaryButtonStyle())
                        }
                    }
                    .padding(.vertical, 6)
                }
                ForEach(projects) { f in
                    NavigationLink(value: f) { FolderRow(folder: f) }
                        .contextMenu { folderMenu(f) }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { deletingFolder = f } label: { Label("Löschen", systemImage: "trash") }
                            Button { editingFolder = .edit(f) } label: { Label("Bearbeiten", systemImage: "pencil") }.tint(Theme.info)
                        }
                }
                .onMove { from, to in
                    var list = projects
                    list.move(fromOffsets: from, toOffset: to)
                    for (i, f) in list.enumerated() { f.sortIndex = i }
                    store.save()
                }
            } header: {
                SectionHeader(title: "Projekte", count: projects.count)
            }
            .listRowBackground(Theme.surface)

            Section {
                NavigationLink { TrashView() } label: {
                    HStack(spacing: 12) {
                        IconBadge(symbol: "trash", color: Theme.textSecondary, size: 38)
                        Text("Papierkorb").font(.system(size: 16, weight: .semibold))
                        Spacer()
                        Text("\(trash.count)").font(Theme.mono(13, .semibold)).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .listRowBackground(Theme.surface)
        }
        .scrollContentBackground(.hidden)
        .vaultBackground()
        .navigationTitle("Vault")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { EditButton() }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { editingFolder = .new(parent: nil) } label: { Label("Neues Projekt", systemImage: "folder.badge.plus") }
                    Button { open(store.createItem(kind: .note, in: nil)) } label: { Label("Neue Notiz (Inbox)", systemImage: VaultItemKind.note.symbol) }
                    Button { open(store.createItem(kind: .prompt, in: nil)) } label: { Label("Neuer Prompt (Inbox)", systemImage: VaultItemKind.prompt.symbol) }
                    Button { newScriptFolder = FolderBox(folder: nil) } label: { Label("Neues Skript (Inbox)", systemImage: VaultItemKind.script.symbol) }
                    Divider()
                    Button { showImport = true } label: { Label("Dateien importieren", systemImage: "square.and.arrow.down") }
                } label: { Image(systemName: "plus.circle.fill").font(.system(size: 20)) }
                    .accessibilityLabel("Neu")
            }
        }
        .folderSheets(editing: $editingFolder, moving: $movingFolder, deleting: $deletingFolder)
        .newScriptSheet(target: $newScriptFolder) { open($0) }
        .importFiles(isPresented: $showImport, into: nil)
    }

    private func open(_ item: VaultItem) { router.open(item) }

    @ViewBuilder
    private func folderMenu(_ f: Folder) -> some View {
        Button { editingFolder = .edit(f) } label: { Label("Bearbeiten", systemImage: "pencil") }
        Button { editingFolder = .new(parent: f) } label: { Label("Unterordner", systemImage: "folder.badge.plus") }
        Button { store.toggleFavorite(f) } label: { Label(f.isFavorite ? "Favorit entfernen" : "Favorit", systemImage: "star") }
        Button { movingFolder = f } label: { Label("Verschieben", systemImage: "folder") }
        Button { store.duplicate(f) } label: { Label("Duplizieren", systemImage: "plus.square.on.square") }
        Divider()
        Button(role: .destructive) { deletingFolder = f } label: { Label("Löschen", systemImage: "trash") }
    }
}

struct FolderBox: Identifiable {
    let id = UUID()
    let folder: Folder?
}

// MARK: - Folder detail

struct FolderDetailView: View {
    let folder: Folder
    @Environment(VaultStore.self) private var store
    @Environment(Router.self) private var router
    @AppStorage("folder.sort") private var sortRaw = SortMode.modified.rawValue
    @State private var editingFolder: FolderEditTarget?
    @State private var movingFolder: Folder?
    @State private var deletingFolder: Folder?
    @State private var newScriptFolder: FolderBox?
    @State private var showImport = false
    @State private var showExport = false
    @State private var selection = Set<UUID>()
    @State private var editMode: EditMode = .inactive
    @State private var movingItems: [VaultItem] = []
    @State private var showMoveItems = false
    @State private var filterKind: VaultItemKind?
    @State private var exportItems: [UUID] = []
    @State private var showExportSelection = false
    @State private var claudeItems: [VaultItem] = []

    enum SortMode: String, CaseIterable, Identifiable {
        case modified = "Zuletzt geändert", name = "Name", kind = "Typ", created = "Erstellt"
        var id: String { rawValue }
    }

    private var items: [VaultItem] {
        var list = folder.liveItems
        if let k = filterKind { list = list.filter { $0.kind == k } }
        switch SortMode(rawValue: sortRaw) ?? .modified {
        case .modified: list.sort { $0.modifiedAt > $1.modifiedAt }
        case .name: list.sort { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        case .kind: list.sort { ($0.kindRaw, $0.title) < ($1.kindRaw, $1.title) }
        case .created: list.sort { $0.createdAt > $1.createdAt }
        }
        return list
    }

    var body: some View {
        let _ = store.changeToken
        List(selection: $selection) {
            if !folder.children.isEmpty {
                Section {
                    ForEach(folder.sortedChildren) { child in
                        NavigationLink(value: child) { FolderRow(folder: child) }
                            .contextMenu { folderMenu(child) }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) { deletingFolder = child } label: { Label("Löschen", systemImage: "trash") }
                                Button { editingFolder = .edit(child) } label: { Label("Bearbeiten", systemImage: "pencil") }.tint(Theme.info)
                            }
                    }
                } header: { SectionHeader(title: "Ordner", count: folder.children.count) }
                .listRowBackground(Theme.surface)
            }
            Section {
                if items.isEmpty {
                    EmptyStateView(symbol: "doc.badge.plus", title: "Leer", message: "Erstelle Notizen, Prompts oder Skripte in „\(folder.name)“.")
                        .listRowBackground(Color.clear)
                }
                ForEach(items) { item in
                    NavigationLink(value: item) { ItemRow(item: item) }
                        .tag(item.id)
                        .contextMenu { itemMenu(item) }
                        .swipeActions(edge: .leading) {
                            Button { store.toggleFavorite(item) } label: { Label("Favorit", systemImage: item.isFavorite ? "star.slash" : "star") }.tint(Theme.amber)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { store.trash([item]) } label: { Label("Löschen", systemImage: "trash") }
                            Button { movingItems = [item]; showMoveItems = true } label: { Label("Verschieben", systemImage: "folder") }.tint(Theme.info)
                        }
                }
            } header: {
                HStack {
                    SectionHeader(title: "Einträge", count: items.count)
                }
            }
            .listRowBackground(Theme.surface)
        }
        .scrollContentBackground(.hidden)
        .vaultBackground()
        .environment(\.editMode, $editMode)
        .navigationTitle(folder.name)
        .toolbar { toolbar }
        .safeAreaInset(edge: .bottom) { if editMode == .active && !selection.isEmpty { selectionBar } }
        .folderSheets(editing: $editingFolder, moving: $movingFolder, deleting: $deletingFolder)
        .newScriptSheet(target: $newScriptFolder) { router.open($0) }
        .importFiles(isPresented: $showImport, into: folder)
        .sheet(isPresented: $showExport) { ExportSheet(scope: .folder(folder.id), title: folder.name) }
        .sheet(isPresented: $showExportSelection) { ExportSheet(scope: .items(exportItems), title: folder.name) }
        .sheet(isPresented: $showMoveItems) {
            FolderPickerView(title: "Verschieben nach", excluded: nil) { target in
                store.move(movingItems, to: target)
                selection.removeAll()
                editMode = .inactive
            }
        }
        .sheet(isPresented: Binding(get: { !claudeItems.isEmpty }, set: { if !$0 { claudeItems = [] } })) {
            ClaudeContextSheet(items: claudeItems)
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Menu {
                Picker("Sortierung", selection: $sortRaw) {
                    ForEach(SortMode.allCases) { Text($0.rawValue).tag($0.rawValue) }
                }
                Picker("Filter", selection: $filterKind) {
                    Text("Alle Typen").tag(VaultItemKind?.none)
                    ForEach(VaultItemKind.allCases) { Text($0.pluralName).tag(VaultItemKind?.some($0)) }
                }
                Divider()
                Button { withAnimation { editMode = editMode == .active ? .inactive : .active; selection.removeAll() } } label: {
                    Label(editMode == .active ? "Auswahl beenden" : "Auswählen", systemImage: "checkmark.circle")
                }
                Button { editingFolder = .edit(folder) } label: { Label("Ordner bearbeiten", systemImage: "pencil") }
                Button { store.toggleFavorite(folder) } label: { Label(folder.isFavorite ? "Favorit entfernen" : "Als Favorit", systemImage: "star") }
                Button { movingFolder = folder } label: { Label("Ordner verschieben", systemImage: "folder") }
                Button { store.duplicate(folder) } label: { Label("Ordner duplizieren", systemImage: "plus.square.on.square") }
                Button { showExport = true } label: { Label("Ordner exportieren (ZIP)", systemImage: "square.and.arrow.up") }
                Button { claudeItems = folder.liveItems } label: { Label("Als Claude-Kontext", systemImage: "sparkles") }
                Divider()
                Button(role: .destructive) { deletingFolder = folder } label: { Label("Ordner löschen", systemImage: "trash") }
            } label: { Image(systemName: "ellipsis.circle") }
            Menu {
                Button { router.open(store.createItem(kind: .note, in: folder)) } label: { Label("Notiz / Idee", systemImage: VaultItemKind.note.symbol) }
                Button { router.open(store.createItem(kind: .prompt, in: folder)) } label: { Label("Prompt", systemImage: VaultItemKind.prompt.symbol) }
                Button { newScriptFolder = FolderBox(folder: folder) } label: { Label("C#-Skript", systemImage: VaultItemKind.script.symbol) }
                Divider()
                Button { editingFolder = .new(parent: folder) } label: { Label("Unterordner", systemImage: "folder.badge.plus") }
                Button { showImport = true } label: { Label("Dateien importieren", systemImage: "square.and.arrow.down") }
            } label: { Image(systemName: "plus.circle.fill").font(.system(size: 20)) }
                .accessibilityLabel("Neu in \(folder.name)")
        }
    }

    private var selectionBar: some View {
        let selected = folder.liveItems.filter { selection.contains($0.id) }
        return HStack(spacing: 18) {
            Text("\(selected.count) ausgewählt").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textSecondary)
            Spacer()
            Button { movingItems = selected; showMoveItems = true } label: { Image(systemName: "folder") }
                .accessibilityLabel("Verschieben")
            Button { exportItems = selected.map(\.id); showExportSelection = true } label: { Image(systemName: "square.and.arrow.up") }
                .accessibilityLabel("Exportieren")
            Button { claudeItems = selected } label: { Image(systemName: "sparkles") }
                .accessibilityLabel("Claude-Kontext")
            Button { for i in selected { store.duplicate(i) } } label: { Image(systemName: "plus.square.on.square") }
                .accessibilityLabel("Duplizieren")
            Button(role: .destructive) { store.trash(selected); selection.removeAll() } label: { Image(systemName: "trash") }
                .accessibilityLabel("Löschen")
        }
        .font(.system(size: 18, weight: .medium))
        .foregroundStyle(Theme.accent)
        .padding(.horizontal, 18).padding(.vertical, 12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
        .padding(.horizontal, 12)
    }

    @ViewBuilder
    private func itemMenu(_ item: VaultItem) -> some View {
        Button { store.toggleFavorite(item) } label: { Label(item.isFavorite ? "Favorit entfernen" : "Favorit", systemImage: "star") }
        Button { movingItems = [item]; showMoveItems = true } label: { Label("Verschieben", systemImage: "folder") }
        Button { store.duplicate(item) } label: { Label("Duplizieren", systemImage: "plus.square.on.square") }
        Button { UIPasteboard.general.string = item.content; store.show("Kopiert", symbol: "doc.on.doc") } label: { Label("Inhalt kopieren", systemImage: "doc.on.doc") }
        Button { exportItems = [item.id]; showExportSelection = true } label: { Label("Exportieren", systemImage: "square.and.arrow.up") }
        Divider()
        Button(role: .destructive) { store.trash([item]) } label: { Label("In den Papierkorb", systemImage: "trash") }
    }

    @ViewBuilder
    private func folderMenu(_ f: Folder) -> some View {
        Button { editingFolder = .edit(f) } label: { Label("Bearbeiten", systemImage: "pencil") }
        Button { editingFolder = .new(parent: f) } label: { Label("Unterordner", systemImage: "folder.badge.plus") }
        Button { movingFolder = f } label: { Label("Verschieben", systemImage: "folder") }
        Button { store.duplicate(f) } label: { Label("Duplizieren", systemImage: "plus.square.on.square") }
        Button(role: .destructive) { deletingFolder = f } label: { Label("Löschen", systemImage: "trash") }
    }
}

// MARK: - Inbox / Favorites / Trash

struct InboxView: View {
    @Environment(VaultStore.self) private var store
    @Query(filter: #Predicate<VaultItem> { $0.deletedAt == nil && $0.folder == nil }, sort: \VaultItem.modifiedAt, order: .reverse) private var items: [VaultItem]
    @State private var moving: VaultItem?

    var body: some View {
        List {
            if items.isEmpty {
                EmptyStateView(symbol: "tray", title: "Inbox ist leer", message: "Schnell erfasste Notizen, Prompts und Skripte ohne Ordner landen hier.")
                    .listRowBackground(Color.clear)
            }
            ForEach(items) { item in
                NavigationLink(value: item) { ItemRow(item: item) }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) { store.trash([item]) } label: { Label("Löschen", systemImage: "trash") }
                        Button { moving = item } label: { Label("Einsortieren", systemImage: "folder") }.tint(Theme.info)
                    }
            }
            .listRowBackground(Theme.surface)
        }
        .scrollContentBackground(.hidden)
        .vaultBackground()
        .navigationTitle("Inbox")
        .sheet(item: $moving) { item in
            FolderPickerView(title: "Einsortieren", excluded: nil, allowsInbox: false) { f in store.move([item], to: f) }
        }
    }
}

struct FavoritesView: View {
    @Query(filter: #Predicate<VaultItem> { $0.deletedAt == nil && $0.isFavorite }, sort: \VaultItem.modifiedAt, order: .reverse) private var items: [VaultItem]
    @Query(filter: #Predicate<Folder> { $0.isFavorite }) private var folders: [Folder]

    var body: some View {
        List {
            if items.isEmpty && folders.isEmpty {
                EmptyStateView(symbol: "star", title: "Keine Favoriten", message: "Markiere wichtige Skripte, Prompts und Ordner mit dem Stern.")
                    .listRowBackground(Color.clear)
            }
            if !folders.isEmpty {
                Section { ForEach(folders) { f in NavigationLink(value: f) { FolderRow(folder: f) } } } header: { SectionHeader(title: "Ordner") }
                    .listRowBackground(Theme.surface)
            }
            if !items.isEmpty {
                Section { ForEach(items) { i in NavigationLink(value: i) { ItemRow(item: i, showPath: true) } } } header: { SectionHeader(title: "Einträge") }
                    .listRowBackground(Theme.surface)
            }
        }
        .scrollContentBackground(.hidden)
        .vaultBackground()
        .navigationTitle("Favoriten")
    }
}

struct TrashView: View {
    @Environment(VaultStore.self) private var store
    @Query(filter: #Predicate<VaultItem> { $0.deletedAt != nil }, sort: \VaultItem.deletedAt, order: .reverse) private var items: [VaultItem]
    @State private var confirmEmpty = false

    var body: some View {
        List {
            if items.isEmpty {
                EmptyStateView(symbol: "trash", title: "Papierkorb ist leer", message: "Gelöschte Einträge bleiben hier, bis du sie endgültig entfernst.")
                    .listRowBackground(Color.clear)
            }
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 4) {
                    ItemRow(item: item)
                    if let d = item.deletedAt { Text("Gelöscht \(d.relativeDescription)").font(Theme.mono(10)).foregroundStyle(Theme.textTertiary) }
                }
                .swipeActions(edge: .leading) {
                    Button { store.restore(item) } label: { Label("Wiederherstellen", systemImage: "arrow.uturn.backward") }.tint(Theme.success)
                }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) { store.deletePermanently([item]) } label: { Label("Endgültig löschen", systemImage: "trash.slash") }
                }
                .contextMenu {
                    Button { store.restore(item) } label: { Label("Wiederherstellen", systemImage: "arrow.uturn.backward") }
                    Button(role: .destructive) { store.deletePermanently([item]) } label: { Label("Endgültig löschen", systemImage: "trash.slash") }
                }
            }
            .listRowBackground(Theme.surface)
        }
        .scrollContentBackground(.hidden)
        .vaultBackground()
        .navigationTitle("Papierkorb")
        .toolbar {
            if !items.isEmpty {
                Button("Leeren", role: .destructive) { confirmEmpty = true }
            }
        }
        .confirmationDialog("Papierkorb endgültig leeren?", isPresented: $confirmEmpty, titleVisibility: .visible) {
            Button("\(items.count) Einträge endgültig löschen", role: .destructive) { store.emptyTrash() }
        } message: { Text("Dies kann nicht rückgängig gemacht werden.") }
    }
}

// MARK: - Folder create / edit / move / delete

enum FolderEditTarget: Identifiable {
    case new(parent: Folder?)
    case edit(Folder)
    var id: String {
        switch self {
        case .new(let p): return "new-\(p?.id.uuidString ?? "root")"
        case .edit(let f): return "edit-\(f.id.uuidString)"
        }
    }
}

struct FolderEditSheet: View {
    let target: FolderEditTarget
    @Environment(VaultStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var icon = "folder"
    @State private var color = Theme.folderPalette[0]

    static let icons = ["folder", "moon.stars", "pawprint", "cube", "gamecontroller", "paintbrush.pointed", "iphone", "brain", "flame",
                        "bolt", "eye", "figure.walk", "map", "hammer", "book", "sparkles", "music.note", "camera", "shield", "ladybug"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("Ordnername", text: $name).font(.system(size: 17, weight: .semibold))
                    .accessibilityIdentifier("folderNameField")
                }
                Section("Symbol") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 6), spacing: 12) {
                        ForEach(Self.icons, id: \.self) { s in
                            Button { icon = s } label: {
                                Image(systemName: s).font(.system(size: 18))
                                    .frame(width: 40, height: 40)
                                    .foregroundStyle(icon == s ? Theme.background : Theme.folderColor(color))
                                    .background(icon == s ? Theme.folderColor(color) : Theme.surfaceHighlight, in: RoundedRectangle(cornerRadius: 10))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section("Farbe") {
                    HStack(spacing: 10) {
                        ForEach(Theme.folderPalette, id: \.self) { hex in
                            Button { color = hex } label: {
                                Circle().fill(Theme.folderColor(hex)).frame(width: 30, height: 30)
                                    .overlay(Circle().strokeBorder(Color.white.opacity(color == hex ? 0.9 : 0), lineWidth: 2.5))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .vaultBackground()
            .navigationTitle(isNew ? "Neuer Ordner" : "Ordner bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(isNew ? "Anlegen" : "Sichern", action: save).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty) }
            }
            .onAppear(perform: load)
        }
        .presentationDetents([.medium, .large])
    }

    private var isNew: Bool { if case .new = target { return true }; return false }

    private func load() {
        switch target {
        case .new(let parent):
            name = ""
            icon = parent == nil ? "folder" : "folder"
            color = parent?.colorHex.isEmpty == false ? parent!.colorHex : Theme.folderPalette[store.rootFolders().count % Theme.folderPalette.count]
        case .edit(let f):
            name = f.name; icon = f.icon; color = f.colorHex.isEmpty ? Theme.folderPalette[0] : f.colorHex
        }
    }

    private func save() {
        switch target {
        case .new(let parent):
            store.createFolder(name: name, parent: parent, icon: icon, colorHex: color)
        case .edit(let f):
            if f.name != name { store.rename(f, to: name) }
            f.icon = icon
            f.colorHex = color
            store.save()
        }
        dismiss()
    }
}

extension View {
    func folderSheets(editing: Binding<FolderEditTarget?>, moving: Binding<Folder?>, deleting: Binding<Folder?>) -> some View {
        modifier(FolderSheetsModifier(editing: editing, moving: moving, deleting: deleting))
    }

    func newScriptSheet(target: Binding<FolderBox?>, onCreate: @escaping (VaultItem) -> Void) -> some View {
        sheet(item: target) { box in NewScriptSheet(folder: box.folder, onCreate: onCreate) }
    }

    func importFiles(isPresented: Binding<Bool>, into folder: Folder?) -> some View {
        modifier(ImportModifier(isPresented: isPresented, folder: folder))
    }
}

private struct FolderSheetsModifier: ViewModifier {
    @Binding var editing: FolderEditTarget?
    @Binding var moving: Folder?
    @Binding var deleting: Folder?
    @Environment(VaultStore.self) private var store

    func body(content: Content) -> some View {
        content
            .sheet(item: $editing) { FolderEditSheet(target: $0) }
            .sheet(item: $moving) { f in
                FolderPickerView(title: "„\(f.name)“ verschieben", excluded: f) { target in store.move(f, to: target) }
            }
            .confirmationDialog("Ordner löschen?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { f in
                Button("„\(f.name)“ löschen", role: .destructive) { store.deleteFolder(f) }
            } message: { f in
                Text("Unterordner werden entfernt. \(f.totalItemCount) Einträge werden in den Papierkorb verschoben und können wiederhergestellt werden.")
            }
    }
}

private struct ImportModifier: ViewModifier {
    @Binding var isPresented: Bool
    let folder: Folder?
    @Environment(VaultStore.self) private var store
    @State private var error: String?

    func body(content: Content) -> some View {
        content
            .fileImporter(isPresented: $isPresented, allowedContentTypes: ImportService.allowedTypes, allowsMultipleSelection: true) { result in
                switch result {
                case .success(let urls):
                    do {
                        let files = try ImportService.collectFiles(from: urls)
                        let planned = ImportPlanner.plan(files: files)
                        if planned.isEmpty { error = "Keine unterstützten Dateien gefunden (.cs, .md, .txt)."; return }
                        let n = store.importPlanned(planned, into: folder)
                        store.show("\(n) Dateien importiert", symbol: "square.and.arrow.down")
                    } catch { self.error = error.localizedDescription }
                case .failure(let e): error = e.localizedDescription
                }
            }
            .alert("Import", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(error ?? "") }
    }
}

// MARK: - New script

struct NewScriptSheet: View {
    let folder: Folder?
    var onCreate: (VaultItem) -> Void
    @Environment(VaultStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var templateID = UnityTemplates.all[0].id

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("z. B. SpiderLegAnimator", text: $name)
                        .accessibilityIdentifier("scriptNameField")
                        .font(Theme.mono(16))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if !name.isEmpty {
                        Text("Datei: \(TextUtil.csharpIdentifier(from: name)).cs").font(Theme.mono(12)).foregroundStyle(Theme.textSecondary)
                    }
                } header: { Text("Skriptname") } footer: { Text("Unity verlangt, dass Dateiname und Klassenname übereinstimmen – beides wird automatisch gesetzt.") }
                Section("Vorlage") {
                    ForEach(UnityTemplates.all) { t in
                        Button { templateID = t.id } label: {
                            HStack(spacing: 12) {
                                IconBadge(symbol: t.symbol, color: Theme.script, size: 34)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(t.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                                    Text(t.detail).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                if templateID == t.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent) }
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .vaultBackground()
            .navigationTitle("Neues C#-Skript")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Erstellen") {
                        let t = UnityTemplates.all.first { $0.id == templateID } ?? UnityTemplates.all[0]
                        let item = store.createScript(name: name.isEmpty ? "NewScript" : name, template: t, in: folder)
                        dismiss()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onCreate(item) }
                    }
                }
            }
        }
    }
}
