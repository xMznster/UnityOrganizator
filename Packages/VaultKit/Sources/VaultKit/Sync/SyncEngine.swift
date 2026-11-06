import Foundation

/// A storage location that the vault is synchronised with (a folder in the Files app,
/// iCloud Drive, a Working Copy repository, or a GitHub repository via its REST API).
public protocol SyncRemote: AnyObject {
    /// Human-readable name for logs.
    var displayName: String { get }
    /// All files (relative paths using '/') with their Git blob ids.
    func list() async throws -> [String: String]
    func read(_ path: String) async throws -> Data
    /// Applies all writes and deletions as one batch (one commit on Git remotes).
    func apply(writes: [String: Data], deletes: [String], message: String) async throws
}

public enum SyncError: LocalizedError {
    case remoteChangedDuringSync
    case http(Int, String)
    case invalidResponse(String)
    case notConfigured(String)
    case io(String)

    public var errorDescription: String? {
        switch self {
        case .remoteChangedDuringSync: return "Das Ziel wurde während der Synchronisierung verändert. Bitte erneut synchronisieren."
        case .http(let code, let msg): return "HTTP \(code): \(msg)"
        case .invalidResponse(let m): return "Ungültige Antwort: \(m)"
        case .notConfigured(let m): return "Nicht konfiguriert: \(m)"
        case .io(let m): return "Dateifehler: \(m)"
        }
    }
}

/// Stored in the remote at `.vault/manifest.json`. Records the state of every synced file at the
/// last successful sync so that changes on either side (and conflicts) can be detected.
public struct SyncManifest: Codable, Sendable {
    public struct Entry: Codable, Sendable, Equatable {
        public var path: String
        /// Blob id of the file in the remote after the last sync.
        public var remoteBlob: String
        /// Blob id of the app's rendering of the item after the last sync.
        public var appBlob: String
        public var kind: VaultItemKind
        /// Metadata that is not representable inside the file (scripts).
        public var meta: SnapshotItem?
    }
    public var format = "unity-developer-vault-sync"
    public var version = 1
    public var lastSync: Date?
    public var device: String = ""
    public var entries: [String: Entry] = [:]
    public var folders: [SnapshotFolder] = []

    public init() {}

    public static let path = ".vault/manifest.json"
}

public struct SyncOutcome: Sendable {
    public struct Created: Sendable {
        public var item: SnapshotItem
        public var folderPath: [String]
        public var reason: String
    }
    public struct Moved: Sendable {
        public var itemID: UUID
        public var folderPath: [String]
        public var title: String?
    }
    /// Existing items whose content/metadata changed on the remote side.
    public var updated: [SnapshotItem] = []
    /// New items (files created on the remote, or conflict copies).
    public var created: [Created] = []
    /// Items moved/renamed on the remote side.
    public var moved: [Moved] = []
    /// Items whose file was deleted on the remote side (move to trash in the app).
    public var trashed: [UUID] = []
    public var conflicts: [String] = []
    public var pushed: [String] = []
    public var deletedRemote: [String] = []
    public var log: [String] = []
    public var manifest = SyncManifest()

    public var summary: String {
        "↑ \(pushed.count) gesendet · ↓ \(updated.count + created.count) empfangen · \(moved.count) verschoben · \(trashed.count) gelöscht · \(conflicts.count) Konflikte"
    }
}

public final class SyncEngine {
    public let remote: SyncRemote
    public var codec = FileCodec.Options(frontMatter: true, promptsAsText: false)
    public var deviceName: String
    public var now: () -> Date = Date.init

    public init(remote: SyncRemote, deviceName: String = "iPhone") {
        self.remote = remote
        self.deviceName = deviceName
    }

    static func isSyncable(_ path: String) -> Bool {
        let comps = path.split(separator: "/")
        if comps.contains(where: { $0.hasPrefix(".") }) { return false }
        let ext = (path as NSString).pathExtension.lowercased()
        return FileCodec.syncedExtensions.contains(ext) && (path as NSString).lastPathComponent != "INDEX.md"
    }

    /// Runs one full two-way sync. `snapshot` contains the live (non-deleted) items and all folders.
    ///
    /// - Parameter previouslySynced: ids of the items that this device synced with this remote last time.
    ///   Only those can be "deleted in the app". Pass `nil` on the first sync from a device (e.g. after a
    ///   reinstall): unknown manifest entries are then *restored* instead of deleted on the remote.
    public func sync(snapshot: VaultSnapshot, previouslySynced: Set<UUID>?) async throws -> SyncOutcome {
        var out = SyncOutcome()
        let listing = try await remote.list()
        var manifest = SyncManifest()
        if listing[SyncManifest.path] != nil {
            let data = try await remote.read(SyncManifest.path)
            let dec = JSONDecoder()
            dec.dateDecodingStrategy = .iso8601
            if let m = try? dec.decode(SyncManifest.self, from: data) { manifest = m }
            else { out.log.append("⚠︎ Manifest unlesbar – starte neue Zuordnung (es wird nichts gelöscht).") }
        }
        let remoteFiles = listing.filter { SyncEngine.isSyncable($0.key) }
        var writes: [String: Data] = [:]
        var deletes: [String] = []
        var newEntries: [String: SyncManifest.Entry] = [:]
        var claimedRemotePaths = Set<String>()  // remote paths owned by an item after this sync
        var usedPaths = Set<String>()           // lowercased paths taken in the final layout

        // Manifest paths are "claimed" by their items first, so unrelated new items can't take them.
        for (_, e) in manifest.entries { usedPaths.insert(e.path.lowercased()) }

        let liveIDs = Set(snapshot.items.map(\.id))
        // Remote files that are not tracked by the manifest (new on PC, or the target of a PC-side move).
        let trackedPaths = Set(manifest.entries.values.map(\.path))
        var untracked = remoteFiles.filter { !trackedPaths.contains($0.key) }
        // Files that look like moved copies of tracked entries (same blob, different path).
        var untrackedByBlob: [String: [String]] = [:]
        for (p, b) in untracked { untrackedByBlob[b, default: []].append(p) }

        func desiredPath(for item: SnapshotItem, preferring current: String?) -> String {
            let dirs = snapshot.path(of: item.folderID).map { FileNaming.safeName($0) }
            let dir = item.folderID == nil ? "Inbox" : dirs.joined(separator: "/")
            let name = FileNaming.fileName(for: item, promptsAsText: false)
            let base = dir.isEmpty ? name : dir + "/" + name
            if let cur = current {
                // Keep the existing path if it is the same file name in the same directory (incl. " (2)" suffixes).
                let curDir = (cur as NSString).deletingLastPathComponent
                let curName = ((cur as NSString).lastPathComponent as NSString).deletingPathExtension
                let wanted = (name as NSString).deletingPathExtension
                if curDir == dir && (curName == wanted || curName.hasPrefix(wanted + " (")) &&
                    (cur as NSString).pathExtension == (name as NSString).pathExtension {
                    return cur
                }
            }
            var candidate = base
            var n = 2
            while usedPaths.contains(candidate.lowercased()) || (remoteFiles[candidate] != nil && !trackedPaths.contains(candidate) && untracked[candidate] != nil) {
                let ext = (base as NSString).pathExtension
                candidate = (base as NSString).deletingPathExtension + " (\(n))." + ext
                n += 1
            }
            return candidate
        }

        // 1. Items known to the app.
        for item in snapshot.items.sorted(by: { $0.createdAt < $1.createdAt }) {
            let key = item.id.uuidString
            let rendered = FileCodec.render(item, options: codec)
            let appBlob = SHA1.gitBlobID(rendered)
            guard let entry = manifest.entries[key] else {
                // New in the app → push.
                let path = desiredPath(for: item, preferring: nil)
                usedPaths.insert(path.lowercased())
                writes[path] = rendered
                claimedRemotePaths.insert(path)
                newEntries[key] = .init(path: path, remoteBlob: appBlob, appBlob: appBlob, kind: item.kind, meta: metaFor(item))
                out.pushed.append(path)
                continue
            }
            let appChanged = appBlob != entry.appBlob
            if let remoteBlob = remoteFiles[entry.path] {
                let remoteChanged = remoteBlob != entry.remoteBlob
                switch (appChanged, remoteChanged) {
                case (false, false):
                    let target = desiredPath(for: item, preferring: entry.path)
                    if target != entry.path {
                        // Could be a pure metadata move (folder rename in the app).
                        usedPaths.insert(target.lowercased())
                        writes[target] = rendered
                        deletes.append(entry.path)
                        claimedRemotePaths.insert(target)
                        newEntries[key] = .init(path: target, remoteBlob: appBlob, appBlob: appBlob, kind: item.kind, meta: metaFor(item))
                        out.pushed.append(target)
                    } else {
                        claimedRemotePaths.insert(entry.path)
                        newEntries[key] = SyncManifest.Entry(path: entry.path, remoteBlob: entry.remoteBlob, appBlob: entry.appBlob, kind: item.kind, meta: metaFor(item))
                    }
                case (true, false):
                    let target = desiredPath(for: item, preferring: entry.path)
                    usedPaths.insert(target.lowercased())
                    writes[target] = rendered
                    if target != entry.path { deletes.append(entry.path) }
                    claimedRemotePaths.insert(target)
                    newEntries[key] = .init(path: target, remoteBlob: appBlob, appBlob: appBlob, kind: item.kind, meta: metaFor(item))
                    out.pushed.append(target)
                case (false, true):
                    let data = try await remote.read(entry.path)
                    var updated = FileCodec.parse(path: entry.path, data: data, existing: item, now: now())
                    updated.id = item.id
                    updated.folderID = item.folderID
                    out.updated.append(updated)
                    claimedRemotePaths.insert(entry.path)
                    let newAppBlob = SHA1.gitBlobID(FileCodec.render(updated, options: codec))
                    newEntries[key] = .init(path: entry.path, remoteBlob: remoteBlob, appBlob: newAppBlob, kind: updated.kind, meta: metaFor(updated))
                    out.log.append("↓ \(entry.path) aktualisiert")
                case (true, true):
                    if remoteBlob == appBlob {
                        // Both sides made the same change.
                        claimedRemotePaths.insert(entry.path)
                        newEntries[key] = .init(path: entry.path, remoteBlob: appBlob, appBlob: appBlob, kind: item.kind, meta: metaFor(item))
                        break
                    }
                    // Conflict: keep the app version in place, import the remote version as a copy.
                    let data = try await remote.read(entry.path)
                    var copy = FileCodec.parse(path: entry.path, data: data, existing: item, now: now())
                    copy.id = UUID()
                    copy.title = item.title + " (Konflikt \(Self.shortDate(now())))"
                    copy.createdAt = now()
                    copy.folderID = nil
                    out.created.append(.init(item: copy, folderPath: snapshot.path(of: item.folderID), reason: "Konflikt"))
                    out.conflicts.append(entry.path)
                    let target = desiredPath(for: item, preferring: entry.path)
                    usedPaths.insert(target.lowercased())
                    writes[target] = rendered
                    if target != entry.path { deletes.append(entry.path) }
                    claimedRemotePaths.insert(target)
                    newEntries[key] = .init(path: target, remoteBlob: appBlob, appBlob: appBlob, kind: item.kind, meta: metaFor(item))
                    out.pushed.append(target)
                    out.log.append("⚠︎ Konflikt in \(entry.path): beide Versionen behalten")
                }
            } else {
                // File is gone on the remote side: moved or deleted on the PC.
                if let movedTo = untrackedByBlob[entry.remoteBlob]?.first(where: { untracked[$0] != nil }) {
                    untracked.removeValue(forKey: movedTo)
                    let comps = movedTo.split(separator: "/").map(String.init)
                    var folderPath = Array(comps.dropLast())
                    if folderPath == ["Inbox"] { folderPath = [] }
                    let newTitle = ((comps.last ?? "") as NSString).deletingPathExtension
                    out.moved.append(.init(itemID: item.id, folderPath: folderPath, title: item.kind == .script ? newTitle : nil))
                    usedPaths.insert(movedTo.lowercased())
                    claimedRemotePaths.insert(movedTo)
                    if appChanged {
                        writes[movedTo] = rendered
                        out.pushed.append(movedTo)
                    }
                    newEntries[key] = .init(path: movedTo, remoteBlob: appChanged ? appBlob : entry.remoteBlob, appBlob: appChanged ? appBlob : entry.appBlob, kind: item.kind, meta: metaFor(item))
                    out.log.append("↔︎ \(entry.path) → \(movedTo)")
                } else if appChanged {
                    // Deleted remotely but edited in the app → restore the file.
                    let target = desiredPath(for: item, preferring: entry.path)
                    usedPaths.insert(target.lowercased())
                    writes[target] = rendered
                    claimedRemotePaths.insert(target)
                    newEntries[key] = .init(path: target, remoteBlob: appBlob, appBlob: appBlob, kind: item.kind, meta: metaFor(item))
                    out.pushed.append(target)
                    out.log.append("↑ \(target) wiederhergestellt (am PC gelöscht, in der App geändert)")
                } else {
                    out.trashed.append(item.id)
                    out.log.append("🗑 \(entry.path) wurde am PC gelöscht → Papierkorb")
                }
            }
        }

        // 2. Entries whose items are not in the app: deleted in the app, or unknown to this device.
        var restoreIDs: [String: (UUID, SnapshotItem?)] = [:]
        for (key, entry) in manifest.entries where UUID(uuidString: key).map({ !liveIDs.contains($0) }) ?? true {
            guard let remoteBlob = remoteFiles[entry.path] else { continue }
            if claimedRemotePaths.contains(entry.path) { continue }
            let id = UUID(uuidString: key)
            let deletedInApp = id.map { previouslySynced?.contains($0) ?? false } ?? false
            if !deletedInApp {
                // Unknown to this device (fresh install / other device) → restore with the same identity.
                untracked[entry.path] = remoteBlob
                if let id { restoreIDs[entry.path] = (id, entry.meta) }
                out.log.append("↓ \(entry.path) wiederhergestellt")
                continue
            }
            if remoteBlob == entry.remoteBlob {
                deletes.append(entry.path)
                out.deletedRemote.append(entry.path)
            } else {
                // Edited on the PC after being deleted in the app → bring it back as a new item.
                untracked[entry.path] = remoteBlob
                out.log.append("↓ \(entry.path) wurde am PC geändert, aber in der App gelöscht → wiederhergestellt")
            }
        }

        // 3. New files on the remote.
        for (path, blob) in untracked.sorted(by: { $0.key < $1.key }) where !claimedRemotePaths.contains(path) && writes[path] == nil {
            let data = try await remote.read(path)
            var item = FileCodec.parse(path: path, data: data, existing: nil, now: now())
            item.id = UUID()
            if let (rid, meta) = restoreIDs[path] {
                item.id = rid
                if let meta, item.kind == .script {
                    let content = item.content, title = item.title
                    item = meta; item.content = content; item.title = title; item.id = rid; item.folderID = nil
                }
            } else if let fmID = FileCodec.splitFrontMatter(String(decoding: data, as: UTF8.self)).0?.values["id"],
                      let uuid = UUID(uuidString: fmID), !liveIDs.contains(uuid), newEntries[uuid.uuidString] == nil {
                item.id = uuid
            }
            if item.kind == .script && item.status == nil { item.status = .inDevelopment }
            // Re-use metadata of a deleted entry with the same path (e.g. restore case)
            if restoreIDs[path] == nil, let old = manifest.entries.values.first(where: { $0.path == path })?.meta, item.kind == .script {
                item.unityVersion = old.unityVersion; item.components = old.components
                item.dependencies = old.dependencies; item.status = old.status; item.summary = old.summary
                item.tags = old.tags; item.category = old.category
            }
            let comps = path.split(separator: "/").map(String.init)
            var folderPath = Array(comps.dropLast())
            if folderPath == ["Inbox"] { folderPath = [] }
            out.created.append(.init(item: item, folderPath: folderPath, reason: "Neu am PC"))
            usedPaths.insert(path.lowercased())
            let appBlob = SHA1.gitBlobID(FileCodec.render(item, options: codec))
            newEntries[item.id.uuidString] = .init(path: path, remoteBlob: blob, appBlob: appBlob, kind: item.kind, meta: metaFor(item))
            out.log.append("↓ \(path) neu")
        }

        // Never delete a path that is also being written.
        deletes = Array(Set(deletes)).filter { writes[$0] == nil }.sorted()

        manifest.entries = newEntries
        manifest.lastSync = now()
        manifest.device = deviceName
        manifest.folders = snapshot.folders
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        enc.dateEncodingStrategy = .iso8601
        writes[SyncManifest.path] = try enc.encode(manifest)
        out.manifest = manifest

        let message = "Vault-Sync von \(deviceName): \(out.pushed.count) geändert, \(deletes.count) gelöscht"
        try await remote.apply(writes: writes, deletes: deletes, message: message)
        out.log.insert("✓ Synchronisiert mit \(remote.displayName)", at: 0)
        return out
    }

    func metaFor(_ item: SnapshotItem) -> SnapshotItem? {
        guard item.kind == .script else { return nil }
        var m = item
        m.content = ""
        return m
    }

    static func shortDate(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH.mm"
        return f.string(from: d)
    }
}

/// Applies script metadata stored in the manifest (status, Unity version …) to a parsed item.
public extension SyncManifest.Entry {
    func applyMeta(to item: inout SnapshotItem) {
        guard let m = meta, item.kind == .script else { return }
        item.summary = m.summary; item.unityVersion = m.unityVersion; item.components = m.components
        item.dependencies = m.dependencies; item.projectName = m.projectName; item.status = m.status
        item.tags = m.tags; item.category = m.category; item.isFavorite = m.isFavorite
    }
}
