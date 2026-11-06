import XCTest
@testable import VaultKit

/// Simulates an app-side vault (a snapshot) syncing with a remote, including edits made on the PC.
final class SyncTests: XCTestCase {

    var snapshot: VaultSnapshot!
    var remote: MemoryRemote!
    var engine: SyncEngine!
    var synced: Set<UUID>? = nil

    override func setUp() {
        let project = SnapshotFolder(name: "Horror Game")
        let scripts = SnapshotFolder(name: "Scripts", parentID: project.id)
        snapshot = VaultSnapshot(folders: [project, scripts], items: [
            SnapshotItem(kind: .script, title: "Enemy", content: "class Enemy {}\n", folderID: scripts.id, status: .experimental),
            SnapshotItem(kind: .note, title: "Idea", content: "Spider legs", tags: ["idea"], folderID: project.id)
        ])
        remote = MemoryRemote()
        engine = SyncEngine(remote: remote)
        synced = nil
    }

    /// Runs a sync and applies the outcome to `snapshot` the way the app does.
    @discardableResult
    func runSync() async throws -> SyncOutcome {
        let out = try await engine.sync(snapshot: snapshot, previouslySynced: synced)
        for u in out.updated {
            if let i = snapshot.items.firstIndex(where: { $0.id == u.id }) { snapshot.items[i] = u }
        }
        for c in out.created {
            var item = c.item
            item.folderID = folderID(for: c.folderPath)
            snapshot.items.append(item)
        }
        for m in out.moved {
            if let i = snapshot.items.firstIndex(where: { $0.id == m.itemID }) {
                snapshot.items[i].folderID = folderID(for: m.folderPath)
                if let t = m.title { snapshot.items[i].title = t }
            }
        }
        snapshot.items.removeAll { out.trashed.contains($0.id) }
        synced = Set(out.manifest.entries.keys.compactMap(UUID.init(uuidString:)))
        return out
    }

    func folderID(for path: [String]) -> UUID? {
        var parent: UUID? = nil
        for name in path {
            if let f = snapshot.folders.first(where: { $0.name == name && $0.parentID == parent }) { parent = f.id }
            else {
                let f = SnapshotFolder(name: name, parentID: parent)
                snapshot.folders.append(f)
                parent = f.id
            }
        }
        return parent
    }

    func testInitialPushAndIdempotence() async throws {
        let out = try await runSync()
        XCTAssertEqual(Set(remote.files.keys), ["Horror Game/Scripts/Enemy.cs", "Horror Game/Idea.md", ".vault/manifest.json"])
        XCTAssertEqual(remote.files["Horror Game/Scripts/Enemy.cs"], Data("class Enemy {}\n".utf8))
        XCTAssertEqual(out.pushed.count, 2)
        // Second sync without changes: nothing to do.
        let before = remote.files
        let out2 = try await runSync()
        XCTAssertEqual(out2.pushed, [])
        XCTAssertEqual(out2.updated.count + out2.created.count, 0)
        XCTAssertEqual(remote.files.filter { $0.key != SyncManifest.path }, before.filter { $0.key != SyncManifest.path })
    }

    func testPullRemoteEditKeepsMetadata() async throws {
        try await runSync()
        remote.files["Horror Game/Scripts/Enemy.cs"] = Data("class Enemy { int hp; }\n".utf8)
        let out = try await runSync()
        XCTAssertEqual(out.updated.count, 1)
        let enemy = snapshot.items.first { $0.title == "Enemy" }!
        XCTAssertEqual(enemy.content, "class Enemy { int hp; }\n")
        XCTAssertEqual(enemy.status, .experimental, "app metadata must survive a pull")
        let out2 = try await runSync()
        XCTAssertEqual(out2.pushed, [], "after pulling, the next sync must be a no-op")
    }

    func testConflictKeepsBothVersions() async throws {
        try await runSync()
        remote.files["Horror Game/Scripts/Enemy.cs"] = Data("class Enemy { /* PC */ }\n".utf8)
        snapshot.items[0].content = "class Enemy { /* iPhone */ }\n"
        let out = try await runSync()
        XCTAssertEqual(out.conflicts.count, 1)
        XCTAssertEqual(remote.files["Horror Game/Scripts/Enemy.cs"], Data("class Enemy { /* iPhone */ }\n".utf8))
        XCTAssertTrue(snapshot.items.contains { $0.content == "class Enemy { /* PC */ }\n" }, "PC version kept as copy")
        // The conflict copy is pushed on the next sync – nothing is lost anywhere.
        try await runSync()
        XCTAssertTrue(remote.files.values.contains(Data("class Enemy { /* PC */ }\n".utf8)))
    }

    func testNewRemoteFileCreatesFolders() async throws {
        try await runSync()
        remote.files["Monster Game/Combat System/Damage.cs"] = Data("class Damage {}".utf8)
        remote.files["Monster Game/Ideas/Boss.md"] = Data("# Boss\nBig spider".utf8)
        remote.files["Monster Game/readme.png"] = Data([1, 2, 3])
        let out = try await runSync()
        XCTAssertEqual(out.created.count, 2)
        let dmg = snapshot.items.first { $0.title == "Damage" }!
        XCTAssertEqual(dmg.kind, .script)
        XCTAssertEqual(snapshot.path(of: dmg.folderID), ["Monster Game", "Combat System"])
        let out2 = try await runSync()
        XCTAssertEqual(out2.created.count, 0, "imported files are not imported twice")
        XCTAssertNotNil(remote.files["Monster Game/Ideas/Boss.md"])
    }

    func testRemoteDeleteMovesToTrashAndAppDeleteRemovesFile() async throws {
        try await runSync()
        remote.files.removeValue(forKey: "Horror Game/Idea.md")
        let out = try await runSync()
        XCTAssertEqual(out.trashed.count, 1)
        XCTAssertFalse(snapshot.items.contains { $0.title == "Idea" })
        // Delete in app
        snapshot.items.removeAll { $0.title == "Enemy" }
        let out2 = try await runSync()
        XCTAssertEqual(out2.deletedRemote, ["Horror Game/Scripts/Enemy.cs"])
        XCTAssertNil(remote.files["Horror Game/Scripts/Enemy.cs"])
    }

    func testFolderRenameInAppMovesFiles() async throws {
        try await runSync()
        snapshot.folders[1].name = "Gameplay Scripts"
        try await runSync()
        XCTAssertNotNil(remote.files["Horror Game/Gameplay Scripts/Enemy.cs"])
        XCTAssertNil(remote.files["Horror Game/Scripts/Enemy.cs"])
    }

    func testMoveOnPCMovesItemInApp() async throws {
        try await runSync()
        let data = remote.files.removeValue(forKey: "Horror Game/Scripts/Enemy.cs")!
        remote.files["Horror Game/AI/Enemy.cs"] = data
        let out = try await runSync()
        XCTAssertEqual(out.moved.count, 1)
        XCTAssertEqual(out.created.count, 0)
        let enemy = snapshot.items.first { $0.title == "Enemy" }!
        XCTAssertEqual(snapshot.path(of: enemy.folderID), ["Horror Game", "AI"])
    }

    func testFreshInstallRestoresInsteadOfDeleting() async throws {
        try await runSync()
        let filesBefore = remote.files.keys.filter { $0 != SyncManifest.path }
        // Simulate reinstall: empty app, no knowledge of previous syncs.
        snapshot = VaultSnapshot(folders: [], items: [])
        synced = nil
        let out = try await runSync()
        XCTAssertEqual(out.deletedRemote, [])
        XCTAssertEqual(Set(remote.files.keys.filter { $0 != SyncManifest.path }), Set(filesBefore))
        XCTAssertEqual(snapshot.items.count, 2)
        let enemy = snapshot.items.first { $0.title == "Enemy" }!
        XCTAssertEqual(enemy.status, .experimental, "script metadata restored from manifest")
        XCTAssertEqual(snapshot.path(of: enemy.folderID), ["Horror Game", "Scripts"])
    }

    func testFolderRemoteOnDisk() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("vault-sync-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let folder = FolderRemote(root: dir)
        engine = SyncEngine(remote: folder)
        try await runSync()
        let enemyURL = dir.appendingPathComponent("Horror Game/Scripts/Enemy.cs")
        XCTAssertEqual(try String(contentsOf: enemyURL, encoding: .utf8), "class Enemy {}\n")
        // Edit on "PC"
        try "class Enemy { float speed; }\n".write(to: enemyURL, atomically: true, encoding: .utf8)
        try await runSync()
        XCTAssertEqual(snapshot.items.first { $0.title == "Enemy" }?.content, "class Enemy { float speed; }\n")
        // Delete in app → file moves into .vault/trash (never hard-deleted)
        snapshot.items.removeAll { $0.title == "Enemy" }
        try await runSync()
        XCTAssertFalse(FileManager.default.fileExists(atPath: enemyURL.path))
        let trash = dir.appendingPathComponent(".vault/trash")
        let trashed = FileManager.default.enumerator(atPath: trash.path)?.allObjects as? [String] ?? []
        XCTAssertTrue(trashed.contains { $0.hasSuffix("Enemy.cs") }, "\(trashed)")
    }
}
