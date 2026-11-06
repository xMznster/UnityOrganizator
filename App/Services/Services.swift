import Foundation
import Security
import SwiftUI
import UniformTypeIdentifiers
import VaultKit

// MARK: - Keychain

enum Keychain {
    static let service = "com.xmznster.unityvault"

    static func set(_ value: String, for key: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: service,
                                   kSecAttrAccount as String: key]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty else { return }
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(_ key: String) -> String {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: key,
                                kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return "" }
        return String(decoding: data, as: UTF8.self)
    }
}

// MARK: - Export

/// Writes export files to disk so they can be shared or saved via the Files app.
/// Exports are also kept in the app's Documents/Exports folder, which is visible in
/// Files ▸ Auf meinem iPhone ▸ Unity Vault.
enum ExportService {
    static var documents: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    static var exportsDirectory: URL {
        let url = documents.appendingPathComponent("Exports", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// Creates a fresh, empty directory for one export operation.
    static func freshDirectory() -> URL {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd_HHmmss"
        var url = exportsDirectory.appendingPathComponent(f.string(from: Date()), isDirectory: true)
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = exportsDirectory.appendingPathComponent(f.string(from: Date()) + "-\(n)", isDirectory: true)
            n += 1
        }
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// Writes a single item as a real file (.cs / .md / .txt). Content is written byte-exact.
    static func writeItem(_ item: SnapshotItem, promptsAsText: Bool = false, frontMatter: Bool = true) throws -> URL {
        let dir = freshDirectory()
        let name = FileNaming.fileName(for: item, promptsAsText: promptsAsText)
        let url = dir.appendingPathComponent(name)
        let data = FileCodec.render(item, options: .init(frontMatter: frontMatter, promptsAsText: promptsAsText))
        try data.write(to: url, options: .atomic)
        return url
    }

    /// Writes several items as individual files (keeps the folder hierarchy when requested).
    static func writeFiles(_ files: [ExportBuilder.ExportFile]) throws -> [URL] {
        let dir = freshDirectory()
        var urls: [URL] = []
        for f in files {
            let url = dir.appendingPathComponent(f.path)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try f.data.write(to: url, options: .atomic)
            urls.append(url)
        }
        return urls
    }

    static func writeZip(_ data: Data, name: String) throws -> URL {
        let url = freshDirectory().appendingPathComponent(FileNaming.safeName(name) + ".zip")
        try data.write(to: url, options: .atomic)
        return url
    }

    static func writeText(_ text: String, name: String) throws -> URL {
        let url = freshDirectory().appendingPathComponent(name)
        try Data(text.utf8).write(to: url, options: .atomic)
        return url
    }

    /// Verifies that the written files contain exactly the expected bytes.
    static func verify(_ files: [ExportBuilder.ExportFile], at urls: [URL]) -> Bool {
        guard files.count == urls.count else { return false }
        for (f, u) in zip(files, urls) {
            guard let d = try? Data(contentsOf: u), d == f.data else { return false }
        }
        return true
    }
}

// MARK: - Import

enum ImportService {
    static var csharpType: UTType { UTType(filenameExtension: "cs") ?? .sourceCode }
    static var markdownType: UTType { UTType(filenameExtension: "md") ?? .plainText }
    static var allowedTypes: [UTType] { [.folder, .zip, csharpType, markdownType, .plainText, .sourceCode, .text] }

    /// Reads picked URLs (files, folders or our own ZIP exports) into (relativePath, data) pairs.
    static func collectFiles(from urls: [URL]) throws -> [(path: String, data: Data)] {
        var out: [(String, Data)] = []
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            var isDir: ObjCBool = false
            FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
            if isDir.boolValue {
                let base = url.deletingLastPathComponent().standardizedFileURL.path
                let en = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles])
                while let f = en?.nextObject() as? URL {
                    guard (try? f.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { continue }
                    var rel = String(f.standardizedFileURL.path.dropFirst(base.count))
                    while rel.hasPrefix("/") { rel.removeFirst() }
                    out.append((rel, try Data(contentsOf: f)))
                }
            } else if url.pathExtension.lowercased() == "zip" {
                let data = try Data(contentsOf: url)
                guard let entries = ZipReader.read(data) else {
                    throw NSError(domain: "Import", code: 1, userInfo: [NSLocalizedDescriptionKey:
                        "Dieses ZIP ist komprimiert. Bitte in der Dateien-App entpacken (antippen) und den Ordner importieren."])
                }
                out.append(contentsOf: entries.map { ($0.path, $0.data) })
            } else {
                out.append((url.lastPathComponent, try Data(contentsOf: url)))
            }
        }
        return out
    }
}

// MARK: - Sync

@MainActor
@Observable
final class SyncService {
    enum Target: String, CaseIterable, Identifiable {
        case folder, github
        var id: String { rawValue }
        var title: String { self == .folder ? "Ordner (Dateien-App)" : "GitHub-Repository" }
    }

    var isSyncing = false
    var lastResult: String?
    var lastLog: [String] = []
    var lastError: String?
    var target: Target {
        didSet { UserDefaults.standard.set(target.rawValue, forKey: "sync.target") }
    }
    var githubConfig: GitHubRemote.Config {
        didSet { if let d = try? JSONEncoder().encode(githubConfig) { UserDefaults.standard.set(d, forKey: "sync.github") } }
    }
    var folderName: String? { resolvedFolderURL()?.lastPathComponent }
    var lastSyncDate: Date? { UserDefaults.standard.object(forKey: "sync.lastDate.\(target.rawValue)") as? Date }
    var compileResults: [String: [CodeDiagnostic]] = [:]

    init() {
        target = Target(rawValue: UserDefaults.standard.string(forKey: "sync.target") ?? "") ?? .folder
        if let d = UserDefaults.standard.data(forKey: "sync.github"), let c = try? JSONDecoder().decode(GitHubRemote.Config.self, from: d) {
            githubConfig = c
        } else {
            githubConfig = GitHubRemote.Config(owner: "", repo: "", branch: "main", directory: "")
        }
    }

    var githubToken: String {
        get { Keychain.get("github.token") }
        set { Keychain.set(newValue, for: "github.token") }
    }

    var isConfigured: Bool {
        switch target {
        case .folder: return resolvedFolderURL() != nil
        case .github: return !githubConfig.owner.isEmpty && !githubConfig.repo.isEmpty && !githubToken.isEmpty
        }
    }

    // MARK: Folder bookmark

    func setFolder(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            UserDefaults.standard.set(data, forKey: "sync.folderBookmark")
            // A different folder = different remote: forget what was synced before.
            UserDefaults.standard.removeObject(forKey: syncedIDsKey(.folder))
            lastError = nil
        } catch {
            lastError = "Ordner konnte nicht gespeichert werden: \(error.localizedDescription)"
        }
    }

    func clearFolder() {
        UserDefaults.standard.removeObject(forKey: "sync.folderBookmark")
        UserDefaults.standard.removeObject(forKey: syncedIDsKey(.folder))
    }

    func resolvedFolderURL() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: "sync.folderBookmark") else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
        if stale, let fresh = try? url.bookmarkData() { UserDefaults.standard.set(fresh, forKey: "sync.folderBookmark") }
        return url
    }

    func syncedIDsKey(_ t: Target) -> String {
        t == .folder ? "sync.ids.folder" : "sync.ids.github.\(githubConfig.owner)/\(githubConfig.repo)@\(githubConfig.branch)/\(githubConfig.directory)"
    }

    func previouslySynced() -> Set<UUID>? {
        guard let arr = UserDefaults.standard.array(forKey: syncedIDsKey(target)) as? [String] else { return nil }
        return Set(arr.compactMap(UUID.init(uuidString:)))
    }

    // MARK: Run

    func sync(store: VaultStore) async {
        guard !isSyncing else { return }
        isSyncing = true
        lastError = nil
        defer { isSyncing = false }
        store.save()
        var scopedURL: URL? = nil
        do {
            let remote: SyncRemote
            switch target {
            case .folder:
                guard let url = resolvedFolderURL() else { throw SyncError.notConfigured("Kein Sync-Ordner gewählt") }
                guard url.startAccessingSecurityScopedResource() else { throw SyncError.io("Kein Zugriff auf den Ordner – bitte neu auswählen.") }
                scopedURL = url
                remote = FolderRemote(root: url)
            case .github:
                guard !githubConfig.owner.isEmpty, !githubConfig.repo.isEmpty else { throw SyncError.notConfigured("Repository fehlt") }
                guard !githubToken.isEmpty else { throw SyncError.notConfigured("GitHub-Token fehlt") }
                remote = GitHubRemote(config: githubConfig, token: githubToken)
            }
            let engine = SyncEngine(remote: remote, deviceName: UIDevice.current.name)
            var outcome: SyncOutcome
            do {
                outcome = try await engine.sync(snapshot: store.snapshot(), previouslySynced: previouslySynced())
            } catch SyncError.remoteChangedDuringSync {
                outcome = try await engine.sync(snapshot: store.snapshot(), previouslySynced: previouslySynced())
            }
            store.apply(outcome)
            let ids = outcome.manifest.entries.keys.sorted()
            UserDefaults.standard.set(ids, forKey: syncedIDsKey(target))
            UserDefaults.standard.set(Date(), forKey: "sync.lastDate.\(target.rawValue)")
            lastResult = outcome.summary
            lastLog = outcome.log
            await loadCompileResults(remote: remote, manifest: outcome.manifest, store: store)
            store.show("Synchronisiert", symbol: "arrow.triangle.2.circlepath")
        } catch {
            lastError = error.localizedDescription
        }
        scopedURL?.stopAccessingSecurityScopedResource()
    }

    /// Reads `.vault/compile-results.json` written by the PC companion (`vault-compiler watch`)
    /// and attaches real compiler diagnostics to the matching scripts.
    func loadCompileResults(remote: SyncRemote, manifest: SyncManifest, store: VaultStore) async {
        guard let listing = try? await remote.list(), listing[CompileResults.path] != nil,
              let data = try? await remote.read(CompileResults.path),
              let results = try? CompileResults.decode(data) else { return }
        let byPath = Dictionary(uniqueKeysWithValues: manifest.entries.map { ($0.value.path, $0.key) })
        for (path, diags) in results.diagnosticsByFile {
            guard let key = byPath[path], let id = UUID(uuidString: key), let item = store.item(id: id) else { continue }
            item.compilerResultJSON = CompilerService.encode(diags)
            item.compiledAt = results.compiledAt
        }
        store.save()
    }
}

// MARK: - PC compiler (Roslyn companion)

/// Result file / HTTP response format of the PC companion.
struct CompileResults: Codable {
    static let path = ".vault/compile-results.json"
    var compiledAt: Date
    var unityPath: String?
    var success: Bool
    var diagnostics: [Entry]

    struct Entry: Codable {
        var file: String
        var line: Int
        var column: Int
        var severity: String
        var id: String
        var message: String
    }

    var diagnosticsByFile: [String: [CodeDiagnostic]] {
        var out: [String: [CodeDiagnostic]] = [:]
        for e in diagnostics {
            let sev: DiagnosticSeverity = e.severity == "error" ? .error : (e.severity == "warning" ? .warning : .info)
            out[e.file, default: []].append(CodeDiagnostic(severity: sev, source: .compiler, ruleID: e.id, message: e.message, line: e.line, column: e.column))
        }
        return out
    }

    static func decode(_ data: Data) throws -> CompileResults {
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return try dec.decode(CompileResults.self, from: data)
    }
}

enum CompilerService {
    struct Request: Codable {
        struct File: Codable { var path: String; var content: String }
        var files: [File]
    }

    static func encode(_ diags: [CodeDiagnostic]) -> String? {
        guard let d = try? JSONEncoder().encode(diags) else { return nil }
        return String(decoding: d, as: UTF8.self)
    }

    static func decode(_ json: String?) -> [CodeDiagnostic] {
        guard let json, let d = json.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([CodeDiagnostic].self, from: d)) ?? []
    }

    /// Sends scripts to the companion (`vault-compiler serve`) and returns real Roslyn diagnostics
    /// for the main file. Other files are sent so that cross-script references resolve.
    static func compile(main: SnapshotItem, others: [SnapshotItem], baseURL: String, token: String) async throws -> (CompileResults, [CodeDiagnostic]) {
        guard var comps = URLComponents(string: baseURL.trimmingCharacters(in: .whitespaces)), comps.host != nil else {
            throw SyncError.notConfigured("Ungültige Compiler-Adresse (z. B. http://192.168.0.10:5199)")
        }
        comps.path = "/compile"
        var req = URLRequest(url: comps.url!, timeoutInterval: 60)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let mainName = FileNaming.fileName(for: main)
        var files = [Request.File(path: mainName, content: main.content)]
        var used: Set<String> = [mainName.lowercased()]
        for o in others where o.kind == .script && o.id != main.id {
            let p = ZipWriter.uniquePath(FileNaming.fileName(for: o), used: used)
            used.insert(p.lowercased())
            files.append(.init(path: p, content: o.content))
        }
        req.httpBody = try JSONEncoder().encode(Request(files: files))
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw SyncError.invalidResponse("keine Antwort") }
        guard http.statusCode == 200 else {
            throw SyncError.http(http.statusCode, String(decoding: data.prefix(300), as: UTF8.self))
        }
        let result = try CompileResults.decode(data)
        let mine = result.diagnosticsByFile[mainName] ?? []
        return (result, mine)
    }
}
