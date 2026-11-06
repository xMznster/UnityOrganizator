import Foundation
import SwiftData
import SwiftUI
import VaultKit

/// All mutations of the vault go through this store so that invariants (soft delete,
/// revisions, no accidental overwrites, cycle-free folder moves) are enforced in one place.
@MainActor
@Observable
final class VaultStore {
    let context: ModelContext
    /// Incremented on every mutation; views/search caches observe it.
    private(set) var changeToken = 0
    var toast: Toast?
    var lastError: String?

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        var text: String
        var symbol: String = "checkmark.circle.fill"
    }

    init(context: ModelContext) {
        self.context = context
    }

    // MARK: Persistence

    func save() {
        do {
            if context.hasChanges { try context.save() }
            changeToken &+= 1
        } catch {
            lastError = "Speichern fehlgeschlagen: \(error.localizedDescription)"
        }
    }

    func show(_ text: String, symbol: String = "checkmark.circle.fill") {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { toast = Toast(text: text, symbol: symbol) }
    }

    // MARK: Fetching

    func allFolders() -> [Folder] {
        (try? context.fetch(FetchDescriptor<Folder>())) ?? []
    }

    func rootFolders() -> [Folder] {
        let d = FetchDescriptor<Folder>(predicate: #Predicate { $0.parent == nil })
        return ((try? context.fetch(d)) ?? []).sorted { ($0.sortIndex, $0.name.localizedLowercase) < ($1.sortIndex, $1.name.localizedLowercase) }
    }

    func liveItems() -> [VaultItem] {
        let d = FetchDescriptor<VaultItem>(predicate: #Predicate { $0.deletedAt == nil })
        return (try? context.fetch(d)) ?? []
    }

    func trashedItems() -> [VaultItem] {
        let d = FetchDescriptor<VaultItem>(predicate: #Predicate { $0.deletedAt != nil }, sortBy: [SortDescriptor(\.deletedAt, order: .reverse)])
        return (try? context.fetch(d)) ?? []
    }

    func item(id: UUID) -> VaultItem? {
        var d = FetchDescriptor<VaultItem>(predicate: #Predicate { $0.id == id })
        d.fetchLimit = 1
        return try? context.fetch(d).first
    }

    func folder(id: UUID) -> Folder? {
        var d = FetchDescriptor<Folder>(predicate: #Predicate { $0.id == id })
        d.fetchLimit = 1
        return try? context.fetch(d).first
    }

    // MARK: Items

    @discardableResult
    func createItem(kind: VaultItemKind, title: String? = nil, content: String = "", in folder: Folder?, category: String = "") -> VaultItem {
        let defaultTitle: String
        switch kind {
        case .note: defaultTitle = "Neue Notiz"
        case .prompt: defaultTitle = "Neuer Prompt"
        case .script: defaultTitle = "NewScript"
        }
        let item = VaultItem(kind: kind, title: title ?? defaultTitle, content: content, folder: folder)
        item.category = category
        if kind == .script {
            item.unityVersion = UserDefaults.standard.string(forKey: SettingsKey.defaultUnityVersion) ?? ""
            refreshScriptMetadata(item, fillEmptyOnly: true)
        }
        context.insert(item)
        folder?.modifiedAt = Date()
        save()
        return item
    }

    /// Creates a script from a template. The class name follows the script name.
    @discardableResult
    func createScript(name: String, template: UnityTemplates.Template, in folder: Folder?) -> VaultItem {
        let className = TextUtil.csharpIdentifier(from: name)
        let item = createItem(kind: .script, title: className, content: template.render(name: className), in: folder, category: template.category)
        refreshScriptMetadata(item, fillEmptyOnly: true)
        save()
        return item
    }

    /// Re-analyses a script and fills detected components / category / dependencies.
    func refreshScriptMetadata(_ item: VaultItem, fillEmptyOnly: Bool) {
        guard item.kind == .script else { return }
        let report = CSharpAnalyzer().analyze(item.content, options: .init(fileName: item.title))
        item.lastErrorCount = report.errorCount
        item.lastWarningCount = report.warningCount
        item.scriptKindRaw = report.scriptKind.rawValue
        if !fillEmptyOnly || item.components.isEmpty { item.components = report.detectedComponents }
        if (!fillEmptyOnly || item.category.isEmpty), let cat = report.suggestedCategories.first { item.category = cat }
        if !fillEmptyOnly || item.dependencies.isEmpty {
            item.dependencies = dependencies(for: report, excluding: item.id)
        }
    }

    /// Dependencies = non-default namespaces + types declared by other scripts in the vault.
    func dependencies(for report: AnalysisReport, excluding id: UUID) -> [String] {
        let defaults: Set<String> = ["UnityEngine", "System", "System.Collections", "System.Collections.Generic", "System.Linq"]
        var deps = report.usings.filter { !defaults.contains($0) }
        let referenced = Set(report.referencedTypes)
        if !referenced.isEmpty {
            for other in liveItems() where other.kind == .script && other.id != id {
                let typeName = TextUtil.csharpIdentifier(from: other.title)
                if referenced.contains(typeName) { deps.append(typeName + ".cs") }
            }
        }
        return Array(Set(deps)).sorted()
    }

    func updateContent(_ item: VaultItem, to newContent: String) {
        guard item.content != newContent else { return }
        item.content = newContent
        item.touch()
    }

    func toggleFavorite(_ item: VaultItem) {
        item.isFavorite.toggle()
        save()
        show(item.isFavorite ? "Zu Favoriten hinzugefügt" : "Aus Favoriten entfernt", symbol: item.isFavorite ? "star.fill" : "star")
    }

    func toggleFavorite(_ folder: Folder) {
        folder.isFavorite.toggle()
        save()
    }

    @discardableResult
    func duplicate(_ item: VaultItem, into folder: Folder? = nil) -> VaultItem {
        let copy = VaultItem(kind: item.kind, title: uniqueTitle(item.kind == .script ? item.title + "Copy" : item.title + " (Kopie)", in: folder ?? item.folder),
                             content: item.content, folder: folder ?? item.folder)
        copy.summary = item.summary
        copy.category = item.category
        copy.tags = item.tags
        copy.unityVersion = item.unityVersion
        copy.components = item.components
        copy.dependencies = item.dependencies
        copy.projectName = item.projectName
        copy.statusRaw = item.statusRaw
        context.insert(copy)
        save()
        show("Dupliziert", symbol: "plus.square.on.square")
        return copy
    }

    func uniqueTitle(_ base: String, in folder: Folder?) -> String {
        let siblings = Set((folder?.liveItems ?? liveItems().filter { $0.folder == nil }).map { $0.title.lowercased() })
        if !siblings.contains(base.lowercased()) { return base }
        var n = 2
        while siblings.contains("\(base) \(n)".lowercased()) { n += 1 }
        return "\(base) \(n)"
    }

    func move(_ items: [VaultItem], to folder: Folder?) {
        for item in items {
            item.folder = folder
            item.touch()
        }
        folder?.modifiedAt = Date()
        save()
        show(items.count == 1 ? "Verschoben nach \(folder?.name ?? "Inbox")" : "\(items.count) Einträge verschoben")
    }

    /// Moves to the trash (recoverable).
    func trash(_ items: [VaultItem]) {
        for item in items {
            item.originalFolderID = item.folder?.id
            item.folder = nil
            item.deletedAt = Date()
        }
        save()
        show(items.count == 1 ? "In den Papierkorb verschoben" : "\(items.count) Einträge im Papierkorb", symbol: "trash")
    }

    func restore(_ item: VaultItem) {
        item.deletedAt = nil
        if let fid = item.originalFolderID { item.folder = folder(id: fid) }
        item.originalFolderID = nil
        save()
        show("Wiederhergestellt nach \(item.folder?.name ?? "Inbox")", symbol: "arrow.uturn.backward")
    }

    func deletePermanently(_ items: [VaultItem]) {
        for item in items { context.delete(item) }
        save()
    }

    func emptyTrash() {
        deletePermanently(trashedItems())
        show("Papierkorb geleert", symbol: "trash.slash")
    }

    // MARK: Revisions

    /// Records the current content as a revision unless it equals the latest one.
    func recordRevision(_ item: VaultItem, reason: String) {
        let latest = item.revisions.max(by: { $0.createdAt < $1.createdAt })
        if latest?.content == item.content { return }
        let rev = Revision(item: item, reason: reason)
        context.insert(rev)
        // Keep the 30 newest revisions per item.
        let sorted = item.revisions.sorted { $0.createdAt > $1.createdAt }
        if sorted.count > 30 { for old in sorted.dropFirst(30) { context.delete(old) } }
    }

    func restore(_ revision: Revision) {
        guard let item = revision.item else { return }
        recordRevision(item, reason: "Vor Wiederherstellung")
        item.content = revision.content
        item.touch()
        save()
        show("Version vom \(revision.createdAt.shortDateTime) wiederhergestellt", symbol: "clock.arrow.circlepath")
    }

    // MARK: Folders

    @discardableResult
    func createFolder(name: String, parent: Folder?, icon: String = "folder", colorHex: String = "") -> Folder {
        let siblings = parent?.children ?? rootFolders()
        let f = Folder(name: uniqueFolderName(name, siblings: siblings), parent: parent, icon: icon,
                       colorHex: colorHex.isEmpty ? (parent?.colorHex ?? Theme.folderPalette[siblings.count % Theme.folderPalette.count]) : colorHex,
                       sortIndex: (siblings.map(\.sortIndex).max() ?? -1) + 1)
        context.insert(f)
        save()
        return f
    }

    func uniqueFolderName(_ base: String, siblings: [Folder], excluding: Folder? = nil) -> String {
        let trimmed = base.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = trimmed.isEmpty ? "Neuer Ordner" : trimmed
        let names = Set(siblings.filter { $0.id != excluding?.id }.map { $0.name.lowercased() })
        if !names.contains(name.lowercased()) { return name }
        var n = 2
        while names.contains("\(name) \(n)".lowercased()) { n += 1 }
        return "\(name) \(n)"
    }

    func rename(_ folder: Folder, to name: String) {
        let siblings = folder.parent?.children ?? rootFolders()
        folder.name = uniqueFolderName(name, siblings: siblings, excluding: folder)
        folder.modifiedAt = Date()
        save()
    }

    /// Whether `folder` may be moved into `target` (no cycles).
    func canMove(_ folder: Folder, to target: Folder?) -> Bool {
        guard let target else { return folder.parent != nil }
        if target.id == folder.id { return false }
        if target.isDescendant(of: folder) { return false }
        return folder.parent?.id != target.id
    }

    @discardableResult
    func move(_ folder: Folder, to target: Folder?) -> Bool {
        guard canMove(folder, to: target) else {
            lastError = "Ein Ordner kann nicht in sich selbst oder einen seiner Unterordner verschoben werden."
            return false
        }
        let siblings = target?.children ?? rootFolders()
        folder.name = uniqueFolderName(folder.name, siblings: siblings, excluding: folder)
        folder.parent = target
        folder.sortIndex = (siblings.map(\.sortIndex).max() ?? -1) + 1
        folder.modifiedAt = Date()
        save()
        show("„\(folder.name)“ verschoben nach \(target?.name ?? "Projekte")")
        return true
    }

    /// Deletes a folder. All items inside (recursively) are moved to the trash first, so no content is lost.
    func deleteFolder(_ folder: Folder) {
        let all = [folder] + folder.allDescendants
        var count = 0
        for f in all {
            for item in f.liveItems {
                item.originalFolderID = nil
                item.folder = nil
                item.deletedAt = Date()
                count += 1
            }
        }
        context.delete(folder)
        save()
        show(count > 0 ? "Ordner gelöscht · \(count) Einträge im Papierkorb" : "Ordner gelöscht", symbol: "trash")
    }

    /// Deep copy of a folder with all subfolders and items.
    @discardableResult
    func duplicate(_ folder: Folder) -> Folder {
        func copy(_ f: Folder, into parent: Folder?, rename: Bool) -> Folder {
            let siblings = parent?.children ?? rootFolders()
            let new = Folder(name: rename ? uniqueFolderName(f.name + " Kopie", siblings: siblings) : f.name, parent: parent,
                             icon: f.icon, colorHex: f.colorHex, sortIndex: f.sortIndex + (rename ? 1 : 0))
            context.insert(new)
            for item in f.liveItems {
                let c = VaultItem(kind: item.kind, title: item.title, content: item.content, folder: new)
                c.summary = item.summary; c.category = item.category; c.tags = item.tags
                c.unityVersion = item.unityVersion; c.components = item.components; c.dependencies = item.dependencies
                c.projectName = item.projectName; c.statusRaw = item.statusRaw
                context.insert(c)
            }
            for child in f.children { _ = copy(child, into: new, rename: false) }
            return new
        }
        let result = copy(folder, into: folder.parent, rename: true)
        save()
        show("Ordner dupliziert", symbol: "plus.square.on.square")
        return result
    }

    /// Finds or creates the folder path (names from root). Empty path = Inbox (nil).
    func ensureFolderPath(_ path: [String]) -> Folder? {
        var parent: Folder? = nil
        for raw in path {
            let name = raw.trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty else { continue }
            let siblings = parent?.children ?? rootFolders()
            if let existing = siblings.first(where: { $0.name.compare(name, options: .caseInsensitive) == .orderedSame }) {
                parent = existing
            } else {
                let f = Folder(name: name, parent: parent, colorHex: parent?.colorHex ?? Theme.folderPalette[siblings.count % Theme.folderPalette.count],
                               sortIndex: siblings.count)
                context.insert(f)
                parent = f
            }
        }
        return parent
    }

    /// Creates the suggested starter structure (only on explicit user request).
    func createStarterStructure() {
        let structure: [(String, String, [String])] = [
            ("Horror Game", "moon.stars", ["Ideas", "Prompts", "Scripts/Enemy AI", "Scripts/Player Controller", "Scripts/Interactions", "Documentation"]),
            ("Monster Game", "pawprint", ["Ideas", "Scripts", "Combat System"]),
            ("General Unity", "cube", ["Useful Scripts", "Tutorials", "Technical Knowledge"]),
            ("Blender", "paintbrush.pointed", []),
            ("App Development", "iphone", [])
        ]
        for (i, (name, icon, subs)) in structure.enumerated() {
            let root: Folder
            if let existing = rootFolders().first(where: { $0.name == name }) { root = existing }
            else {
                root = Folder(name: name, icon: icon, colorHex: Theme.folderPalette[i % Theme.folderPalette.count], sortIndex: i)
                context.insert(root)
            }
            for sub in subs {
                _ = ensureFolderPath([name] + sub.split(separator: "/").map(String.init))
            }
        }
        save()
        show("Ordnerstruktur angelegt", symbol: "folder.badge.plus")
    }

    // MARK: Snapshot / import / sync

    func snapshot() -> VaultSnapshot {
        VaultSnapshot(folders: allFolders().map { $0.snapshot() }, items: liveItems().map { $0.snapshot() })
    }

    /// Imports planned items. Always creates new items – never overwrites.
    @discardableResult
    func importPlanned(_ planned: [ImportPlanner.Planned], into base: Folder?) -> Int {
        let basePath = base?.pathComponents ?? []
        for p in planned {
            let folder = ensureFolderPath(basePath + p.folderPath)
            let item = VaultItem(kind: p.item.kind, title: p.item.title, content: p.item.content, folder: folder)
            item.apply(p.item)
            item.createdAt = p.item.createdAt
            item.modifiedAt = Date()
            context.insert(item)
            if item.kind == .script { refreshScriptMetadata(item, fillEmptyOnly: true) }
        }
        save()
        return planned.count
    }

    /// Applies a sync outcome to the database.
    func apply(_ outcome: SyncOutcome) {
        for u in outcome.updated {
            guard let item = item(id: u.id) else { continue }
            recordRevision(item, reason: "Vor Sync-Aktualisierung")
            item.apply(u)
            if item.kind == .script { refreshScriptMetadata(item, fillEmptyOnly: true) }
        }
        for c in outcome.created {
            if item(id: c.item.id) != nil { continue }
            let folder = ensureFolderPath(c.folderPath)
            let item = VaultItem(kind: c.item.kind, title: c.item.title, content: c.item.content, folder: folder)
            item.id = c.item.id
            item.apply(c.item)
            item.createdAt = c.item.createdAt
            context.insert(item)
            if item.kind == .script { refreshScriptMetadata(item, fillEmptyOnly: true) }
        }
        for m in outcome.moved {
            guard let item = item(id: m.itemID) else { continue }
            item.folder = ensureFolderPath(m.folderPath)
            if let t = m.title { item.title = t }
        }
        let toTrash = outcome.trashed.compactMap { item(id: $0) }
        for item in toTrash {
            item.originalFolderID = item.folder?.id
            item.folder = nil
            item.deletedAt = Date()
        }
        save()
    }

    // MARK: Search

    func searchDocuments() -> [SearchDocument] {
        liveItems().map { $0.searchDocument() } + allFolders().map { $0.searchDocument() }
    }

    // MARK: Stats

    struct Stats {
        var notes = 0, prompts = 0, scripts = 0, projects = 0, folders = 0
        var experimental = 0, inDevelopment = 0, tested = 0
        var scriptsWithErrors = 0
        var totalLines = 0
    }

    func stats() -> Stats {
        var s = Stats()
        for item in liveItems() {
            switch item.kind {
            case .note: s.notes += 1
            case .prompt: s.prompts += 1
            case .script:
                s.scripts += 1
                s.totalLines += item.content.reduce(into: 1) { if $1 == "\n" { $0 += 1 } }
                if item.lastErrorCount > 0 { s.scriptsWithErrors += 1 }
                switch item.status {
                case .experimental: s.experimental += 1
                case .inDevelopment, .none: s.inDevelopment += 1
                case .tested: s.tested += 1
                }
            }
        }
        let folders = allFolders()
        s.folders = folders.count
        s.projects = folders.filter { $0.parent == nil }.count
        return s
    }
}
