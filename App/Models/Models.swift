import Foundation
import SwiftData
import VaultKit

/// A folder in the vault tree. Root folders (no parent) are treated as "projects".
@Model
final class Folder {
    @Attribute(.unique) var id: UUID
    var name: String
    var icon: String
    var colorHex: String
    var isFavorite: Bool
    var sortIndex: Int
    var createdAt: Date
    var modifiedAt: Date
    var parent: Folder?
    @Relationship(deleteRule: .cascade, inverse: \Folder.parent) var children: [Folder] = []
    /// Items are never hard-deleted through a folder: they are moved to the trash first (`VaultStore.deleteFolder`).
    @Relationship(deleteRule: .nullify, inverse: \VaultItem.folder) var items: [VaultItem] = []

    init(name: String, parent: Folder? = nil, icon: String = "folder", colorHex: String = "", sortIndex: Int = 0) {
        self.id = UUID()
        self.name = name
        self.icon = icon
        self.colorHex = colorHex
        self.isFavorite = false
        self.sortIndex = sortIndex
        self.createdAt = Date()
        self.modifiedAt = Date()
        self.parent = parent
    }

    var isProject: Bool { parent == nil }

    /// Names from the root down to this folder.
    var pathComponents: [String] {
        var out: [String] = []
        var current: Folder? = self
        var guardCount = 0
        while let f = current, guardCount < 64 { out.insert(f.name, at: 0); current = f.parent; guardCount += 1 }
        return out
    }
    var pathString: String { pathComponents.joined(separator: " / ") }

    var root: Folder {
        var current = self
        var guardCount = 0
        while let p = current.parent, guardCount < 64 { current = p; guardCount += 1 }
        return current
    }

    var liveItems: [VaultItem] { items.filter { $0.deletedAt == nil } }

    var sortedChildren: [Folder] {
        children.sorted { ($0.sortIndex, $0.name.localizedLowercase) < ($1.sortIndex, $1.name.localizedLowercase) }
    }

    /// Recursive count of live items.
    var totalItemCount: Int { liveItems.count + children.reduce(0) { $0 + $1.totalItemCount } }

    func isDescendant(of other: Folder) -> Bool {
        var current = parent
        var guardCount = 0
        while let c = current, guardCount < 64 {
            if c.id == other.id { return true }
            current = c.parent
            guardCount += 1
        }
        return false
    }

    var allDescendants: [Folder] { children + children.flatMap(\.allDescendants) }
}

/// A note, prompt or C# script.
@Model
final class VaultItem {
    @Attribute(.unique) var id: UUID
    var kindRaw: String
    var title: String
    var content: String
    var summary: String
    var category: String
    var tags: [String]
    var createdAt: Date
    var modifiedAt: Date
    var lastOpenedAt: Date?
    var isFavorite: Bool
    var folder: Folder?
    /// Soft delete: items in the trash have a deletion date.
    var deletedAt: Date?
    var originalFolderID: UUID?
    // Script metadata
    var unityVersion: String
    var components: [String]
    var dependencies: [String]
    var projectName: String
    var statusRaw: String
    // Cached analysis results (for dashboard badges without re-analysing everything)
    var lastErrorCount: Int
    var lastWarningCount: Int
    var scriptKindRaw: String
    /// JSON of the last real compilation result from the PC companion.
    var compilerResultJSON: String?
    var compiledAt: Date?
    @Relationship(deleteRule: .cascade, inverse: \Revision.item) var revisions: [Revision] = []

    init(kind: VaultItemKind, title: String, content: String = "", folder: Folder? = nil) {
        self.id = UUID()
        self.kindRaw = kind.rawValue
        self.title = title
        self.content = content
        self.summary = ""
        self.category = ""
        self.tags = []
        self.createdAt = Date()
        self.modifiedAt = Date()
        self.isFavorite = false
        self.folder = folder
        self.unityVersion = ""
        self.components = []
        self.dependencies = []
        self.projectName = ""
        self.statusRaw = kind == .script ? ScriptStatus.inDevelopment.rawValue : ""
        self.lastErrorCount = 0
        self.lastWarningCount = 0
        self.scriptKindRaw = ""
    }

    var kind: VaultItemKind {
        get { VaultItemKind(rawValue: kindRaw) ?? .note }
        set { kindRaw = newValue.rawValue }
    }

    var status: ScriptStatus? {
        get { ScriptStatus(rawValue: statusRaw) }
        set { statusRaw = newValue?.rawValue ?? "" }
    }

    var isTrashed: Bool { deletedAt != nil }

    /// Explicit project or the root folder's name.
    var project: String? {
        if !projectName.isEmpty { return projectName }
        return folder?.root.name
    }

    var locationDescription: String { folder?.pathString ?? "Inbox" }

    var previewText: String {
        if !summary.isEmpty { return summary }
        let lines = content.split(separator: "\n", omittingEmptySubsequences: true)
        if kind == .script {
            // First meaningful line (skip usings / comments)
            if let l = lines.first(where: { let t = $0.trimmingCharacters(in: .whitespaces); return !t.hasPrefix("using") && !t.hasPrefix("//") && !t.isEmpty }) {
                return l.trimmingCharacters(in: .whitespaces)
            }
        }
        return MarkdownParser.stripInline(lines.first.map(String.init) ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "# "))
    }

    func touch() { modifiedAt = Date() }
}

/// Snapshot of an item's content, created before risky operations (sync overwrite, restore)
/// and when an editing session ends with changes.
@Model
final class Revision {
    var id: UUID
    var createdAt: Date
    var title: String
    var content: String
    var reason: String
    var item: VaultItem?

    init(item: VaultItem, reason: String) {
        self.id = UUID()
        self.createdAt = Date()
        self.title = item.title
        self.content = item.content
        self.reason = reason
        self.item = item
    }
}

// MARK: - Snapshot conversion

extension VaultItem {
    func snapshot() -> SnapshotItem {
        SnapshotItem(id: id, kind: kind, title: title, content: content, summary: summary, category: category,
                     tags: tags, createdAt: createdAt, modifiedAt: modifiedAt, isFavorite: isFavorite,
                     folderID: folder?.id, unityVersion: unityVersion, components: components,
                     dependencies: dependencies, projectName: projectName, status: status)
    }

    /// Applies content and metadata from a snapshot (keeps identity and folder).
    func apply(_ s: SnapshotItem) {
        kind = s.kind
        title = s.title
        content = s.content
        summary = s.summary
        category = s.category
        tags = s.tags
        isFavorite = s.isFavorite
        unityVersion = s.unityVersion
        components = s.components
        dependencies = s.dependencies
        projectName = s.projectName
        status = s.kind == .script ? (s.status ?? .inDevelopment) : nil
        modifiedAt = s.modifiedAt
    }

    func searchDocument() -> SearchDocument {
        SearchDocument(id: id, kind: SearchEntityKind(kind), title: title, summary: summary, content: content,
                       tags: tags, category: category, folderPath: folder?.pathComponents ?? [], project: project,
                       status: status?.rawValue, isFavorite: isFavorite, modifiedAt: modifiedAt)
    }
}

extension Folder {
    func snapshot() -> SnapshotFolder {
        SnapshotFolder(id: id, name: name, parentID: parent?.id, isFavorite: isFavorite, sortIndex: sortIndex, icon: icon, colorHex: colorHex)
    }
    func searchDocument() -> SearchDocument {
        SearchDocument(id: id, kind: .folder, title: name, folderPath: parent?.pathComponents ?? [], project: root.name,
                       isFavorite: isFavorite, modifiedAt: modifiedAt)
    }
}
