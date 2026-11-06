import Foundation

/// Builds export archives / file sets from a `VaultSnapshot`.
public struct ExportBuilder {

    public struct Options: Sendable {
        public var codec = FileCodec.Options()
        /// Keep the folder hierarchy (otherwise all files are flat in the root).
        public var preserveFolders = true
        /// Only C# scripts (a folder that can be dropped straight into `Assets/`).
        public var scriptsOnly = false
        /// Include `.vault/manifest.json` (all metadata, re-importable) and `INDEX.md`.
        public var includeManifest = true
        /// Name of the archive's root directory (empty = no root directory).
        public var rootName = "UnityVault"
        public init() {}
    }

    public struct ExportFile: Sendable {
        public var path: String
        public var data: Data
        public var itemID: UUID?
    }

    public struct Manifest: Codable, Sendable {
        public var format: String = "unity-developer-vault"
        public var version: Int = 1
        public var exportedAt: Date
        public var folders: [SnapshotFolder]
        public var items: [ManifestItem]
    }

    public struct ManifestItem: Codable, Sendable {
        public var path: String
        public var item: SnapshotItem
    }

    public let snapshot: VaultSnapshot
    public var options: Options

    public init(snapshot: VaultSnapshot, options: Options = Options()) {
        self.snapshot = snapshot
        self.options = options
    }

    /// Computes the export files for the given items. `relativeTo` strips that folder's ancestors
    /// from the paths (so exporting "Horror Game/Scripts" yields "Scripts/…").
    public func files(for itemIDs: [UUID]? = nil, rootFolder: UUID? = nil) -> [ExportFile] {
        var items = snapshot.items
        if let ids = itemIDs { let set = Set(ids); items = items.filter { set.contains($0.id) } }
        if let root = rootFolder {
            let tree = snapshot.subtree(of: root)
            items = items.filter { $0.folderID.map(tree.contains) ?? false }
        }
        if options.scriptsOnly { items = items.filter { $0.kind == .script } }
        items.sort { $0.createdAt < $1.createdAt }

        let stripCount = rootFolder.map { max(0, snapshot.path(of: $0).count - 1) } ?? 0
        var used = Set<String>()
        var out: [ExportFile] = []
        var manifestItems: [ManifestItem] = []
        let prefix = options.rootName.isEmpty ? "" : FileNaming.safeName(options.rootName) + "/"

        for item in items {
            var dirs = options.preserveFolders ? Array(snapshot.path(of: item.folderID).dropFirst(stripCount)) : []
            dirs = dirs.map { FileNaming.safeName($0) }
            if options.preserveFolders && item.folderID == nil && !options.scriptsOnly { dirs = ["Inbox"] }
            let name = FileNaming.fileName(for: item, promptsAsText: options.codec.promptsAsText)
            var path = prefix + (dirs.isEmpty ? "" : dirs.joined(separator: "/") + "/") + name
            path = ZipWriter.uniquePath(path, used: used)
            used.insert(path.lowercased())
            out.append(ExportFile(path: path, data: FileCodec.render(item, options: options.codec), itemID: item.id))
            manifestItems.append(ManifestItem(path: String(path.dropFirst(prefix.count)), item: item))
        }

        if options.includeManifest && !options.scriptsOnly {
            let relevantFolders: [SnapshotFolder]
            if let root = rootFolder { let tree = snapshot.subtree(of: root); relevantFolders = snapshot.folders.filter { tree.contains($0.id) } }
            else { relevantFolders = snapshot.folders }
            let manifest = Manifest(exportedAt: Date(), folders: relevantFolders, items: manifestItems)
            let enc = JSONEncoder()
            enc.outputFormatting = [.prettyPrinted, .sortedKeys]
            enc.dateEncodingStrategy = .iso8601
            if let data = try? enc.encode(manifest) {
                out.append(ExportFile(path: prefix + ".vault/manifest.json", data: data, itemID: nil))
            }
            out.append(ExportFile(path: prefix + "INDEX.md", data: Data(indexMarkdown(manifestItems).utf8), itemID: nil))
        }
        return out
    }

    public func zip(for itemIDs: [UUID]? = nil, rootFolder: UUID? = nil) -> Data {
        var z = ZipWriter()
        for f in files(for: itemIDs, rootFolder: rootFolder) {
            z.add(path: f.path, data: f.data, modified: snapshot.items.first { $0.id == f.itemID }?.modifiedAt ?? Date())
        }
        // Keep empty folders so the structure is complete.
        if options.preserveFolders && !options.scriptsOnly {
            let prefix = options.rootName.isEmpty ? "" : FileNaming.safeName(options.rootName) + "/"
            let folders = rootFolder.map { snapshot.subtree(of: $0) } ?? Set(snapshot.folders.map(\.id))
            let stripCount = rootFolder.map { max(0, snapshot.path(of: $0).count - 1) } ?? 0
            for fid in folders {
                let p = snapshot.path(of: fid).dropFirst(stripCount).map { FileNaming.safeName($0) }.joined(separator: "/")
                if !p.isEmpty { z.addDirectory(prefix + p) }
            }
        }
        return z.archiveData()
    }

    /// A human/Claude readable table of contents.
    func indexMarkdown(_ items: [ManifestItem]) -> String {
        var md = "# \(options.rootName.isEmpty ? "Unity Developer Vault" : options.rootName) – Index\n\n"
        md += "Exportiert am \(ISO8601DateFormatter().string(from: Date())). \(items.count) Einträge.\n\n"
        for kind in VaultItemKind.allCases {
            let group = items.filter { $0.item.kind == kind }
            guard !group.isEmpty else { continue }
            md += "## \(kind.pluralName) (\(group.count))\n\n"
            md += "| Datei | Kategorie | Tags | Beschreibung |\n|---|---|---|---|\n"
            for m in group {
                let link = m.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? m.path
                let desc = m.item.summary.replacingOccurrences(of: "|", with: "/").replacingOccurrences(of: "\n", with: " ")
                md += "| [\(m.path)](\(link)) | \(m.item.category) | \(m.item.tags.joined(separator: ", ")) | \(desc) |\n"
            }
            md += "\n"
        }
        return md
    }
}

/// Imports files (from a ZIP, the Files app or a sync folder) into snapshot items.
public enum ImportPlanner {

    public struct Planned: Sendable {
        public var item: SnapshotItem
        /// Folder path (names) relative to the import root.
        public var folderPath: [String]
    }

    /// Plans an import. If a `.vault/manifest.json` is present its metadata is used, but every
    /// imported item always receives a **new** id so nothing in the vault gets overwritten.
    public static func plan(files: [(path: String, data: Data)], now: Date = Date()) -> [Planned] {
        var manifestByPath: [String: SnapshotItem] = [:]
        // Detect a common root directory (e.g. "UnityVault/")
        let paths = files.map(\.path)
        var root = commonRoot(paths)
        // Only strip the root directory of our own exports (it is just the archive name).
        if !paths.contains(root + ".vault/manifest.json") { root = "" }
        if let m = files.first(where: { $0.path.hasSuffix(".vault/manifest.json") }) {
            let dec = JSONDecoder()
            dec.dateDecodingStrategy = .iso8601
            if let manifest = try? dec.decode(ExportBuilder.Manifest.self, from: m.data) {
                for mi in manifest.items { manifestByPath[mi.path] = mi.item }
            }
        }
        var result: [Planned] = []
        for f in files {
            var rel = f.path
            if !root.isEmpty && rel.hasPrefix(root) { rel = String(rel.dropFirst(root.count)) }
            let comps = rel.split(separator: "/").map(String.init)
            guard let name = comps.last, !comps.contains(where: { $0.hasPrefix(".") || $0 == "__MACOSX" }) else { continue }
            let ext = (name as NSString).pathExtension.lowercased()
            guard FileCodec.syncedExtensions.contains(ext) else { continue }
            if rel == "INDEX.md" { continue }
            var item = FileCodec.parse(path: rel, data: f.data, existing: nil, now: now)
            if var meta = manifestByPath[rel] {
                // Keep metadata, but the content comes from the file (may have been edited).
                meta.content = item.content
                meta.title = item.kind == .script ? item.title : meta.title
                item = meta
            }
            item.id = UUID()
            item.folderID = nil
            var folder = Array(comps.dropLast())
            if folder == ["Inbox"] { folder = [] }
            result.append(Planned(item: item, folderPath: folder))
        }
        return result
    }

    static func commonRoot(_ paths: [String]) -> String {
        let firsts = Set(paths.compactMap { p -> String? in
            let c = p.split(separator: "/", omittingEmptySubsequences: true)
            return c.count > 1 ? String(c[0]) : nil
        })
        let allNested = paths.allSatisfy { $0.split(separator: "/").count > 1 }
        if firsts.count == 1, allNested, let r = firsts.first { return r + "/" }
        return ""
    }
}
