import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Syncs with a directory: a folder picked in the Files app (iCloud Drive, OneDrive, a USB drive,
/// a Working Copy Git repository …). Deleted files are moved into `.vault/trash/` instead of being
/// removed, so nothing is ever lost.
public final class FolderRemote: SyncRemote {
    public let root: URL
    public var displayName: String { root.lastPathComponent }
    let fm = FileManager.default

    public init(root: URL) { self.root = root }

    public func list() async throws -> [String: String] {
        var result: [String: String] = [:]
        guard let en = fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey, .isDirectoryKey], options: []) else {
            throw SyncError.io("Ordner nicht lesbar: \(root.path)")
        }
        let rootPath = root.standardizedFileURL.resolvingSymlinksInPath().path
        while let url = en.nextObject() as? URL {
            let name = url.lastPathComponent
            let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey])
            if values?.isDirectory == true {
                // Skip .git, node_modules, Library etc. but keep .vault for the manifest.
                if name == ".git" || name == "Library" || name == "node_modules" || name == "Temp" || (name.hasPrefix(".") && name != ".vault") {
                    en.skipDescendants()
                }
                if name == "trash" && url.deletingLastPathComponent().lastPathComponent == ".vault" { en.skipDescendants() }
                continue
            }
            guard values?.isRegularFile == true else { continue }
            let full = url.standardizedFileURL.resolvingSymlinksInPath().path
            guard full.hasPrefix(rootPath) else { continue }
            var rel = String(full.dropFirst(rootPath.count))
            while rel.hasPrefix("/") { rel.removeFirst() }
            let ext = (rel as NSString).pathExtension.lowercased()
            guard FileCodec.syncedExtensions.contains(ext) || (rel.hasPrefix(".vault/") && ext == "json") else { continue }
            let data = try Data(contentsOf: url)
            result[rel] = SHA1.gitBlobID(data)
        }
        return result
    }

    public func read(_ path: String) async throws -> Data {
        try Data(contentsOf: root.appendingPathComponent(path))
    }

    public func apply(writes: [String: Data], deletes: [String], message: String) async throws {
        let stamp = SyncEngine.shortDate(Date()).replacingOccurrences(of: " ", with: "_")
        for path in deletes {
            let src = root.appendingPathComponent(path)
            guard fm.fileExists(atPath: src.path) else { continue }
            let dst = root.appendingPathComponent(".vault/trash/\(stamp)/\(path)")
            try fm.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
            if fm.fileExists(atPath: dst.path) { try fm.removeItem(at: dst) }
            try fm.moveItem(at: src, to: dst)
            removeEmptyParents(of: src)
        }
        // Manifest last, so an interrupted sync never records state that was not written.
        for (path, data) in writes.sorted(by: { a, _ in a.key != SyncManifest.path }) where path != SyncManifest.path {
            try write(path, data)
        }
        if let m = writes[SyncManifest.path] { try write(SyncManifest.path, m) }
    }

    func write(_ path: String, _ data: Data) throws {
        let url = root.appendingPathComponent(path)
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    func removeEmptyParents(of url: URL) {
        var dir = url.deletingLastPathComponent()
        let rootPath = root.standardizedFileURL.path
        while dir.standardizedFileURL.path.count > rootPath.count {
            guard let contents = try? fm.contentsOfDirectory(atPath: dir.path), contents.filter({ $0 != ".DS_Store" }).isEmpty else { break }
            try? fm.removeItem(at: dir)
            dir = dir.deletingLastPathComponent()
        }
    }
}

/// In-memory remote for tests and previews.
public final class MemoryRemote: SyncRemote {
    public var files: [String: Data]
    public var displayName: String { "Speicher" }
    public var commits: [String] = []
    public init(files: [String: Data] = [:]) { self.files = files }
    public func list() async throws -> [String: String] { files.mapValues { SHA1.gitBlobID($0) } }
    public func read(_ path: String) async throws -> Data {
        guard let d = files[path] else { throw SyncError.io("missing \(path)") }
        return d
    }
    public func apply(writes: [String: Data], deletes: [String], message: String) async throws {
        for d in deletes { files.removeValue(forKey: d) }
        for (p, d) in writes { files[p] = d }
        commits.append(message)
    }
}

/// Syncs with a GitHub repository through the Git Data REST API: every sync becomes exactly one
/// commit. Works on iOS without a native git implementation. Requires a fine-grained personal
/// access token with "Contents: Read and write" for the repository.
public final class GitHubRemote: SyncRemote {
    public struct Config: Codable, Sendable, Equatable {
        public var owner: String
        public var repo: String
        public var branch: String
        /// Optional sub directory inside the repository (e.g. "vault").
        public var directory: String
        public init(owner: String, repo: String, branch: String = "main", directory: String = "") {
            self.owner = owner; self.repo = repo; self.branch = branch; self.directory = directory
        }
    }

    public let config: Config
    let token: String
    let session: URLSession
    let api = URL(string: "https://api.github.com")!
    public var displayName: String { "github.com/\(config.owner)/\(config.repo)@\(config.branch)" }

    private var headCommit: String?
    private var baseTree: String?
    private var blobByPath: [String: String] = [:]

    public init(config: Config, token: String, session: URLSession = .shared) {
        self.config = config
        self.token = token
        self.session = session
    }

    var prefix: String {
        let d = config.directory.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        return d.isEmpty ? "" : d + "/"
    }

    // MARK: HTTP

    func request(_ method: String, _ path: String, body: Any? = nil) async throws -> (Int, Any?) {
        var req = URLRequest(url: URL(string: api.absoluteString + path)!)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        req.setValue("UnityDeveloperVault", forHTTPHeaderField: "User-Agent")
        if let body {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await GitHubRemote.send(session, req)
        guard let http = response as? HTTPURLResponse else { throw SyncError.invalidResponse("keine HTTP-Antwort") }
        let json = data.isEmpty ? nil : try? JSONSerialization.jsonObject(with: data)
        return (http.statusCode, json)
    }

    static func send(_ session: URLSession, _ req: URLRequest) async throws -> (Data, URLResponse) {
        try await withCheckedThrowingContinuation { cont in
            session.dataTask(with: req) { data, resp, err in
                if let err { cont.resume(throwing: err); return }
                guard let resp else { cont.resume(throwing: SyncError.invalidResponse("keine Antwort")); return }
                cont.resume(returning: (data ?? Data(), resp))
            }.resume()
        }
    }

    func check(_ status: Int, _ json: Any?, _ ok: Set<Int> = [200, 201]) throws {
        guard ok.contains(status) else {
            let msg = (json as? [String: Any])?["message"] as? String ?? "Unbekannter Fehler"
            if status == 401 { throw SyncError.http(status, "Token ungültig oder abgelaufen (\(msg))") }
            if status == 403 || status == 404 { throw SyncError.http(status, "Kein Zugriff auf \(config.owner)/\(config.repo) – Token-Berechtigung 'Contents: Read and write' prüfen (\(msg))") }
            throw SyncError.http(status, msg)
        }
    }

    var repoPath: String { "/repos/\(config.owner)/\(config.repo)" }

    // MARK: SyncRemote

    public func list() async throws -> [String: String] {
        blobByPath = [:]
        headCommit = nil
        baseTree = nil
        let (s1, refJSON) = try await request("GET", "\(repoPath)/git/ref/heads/\(config.branch)")
        if s1 == 404 || s1 == 409 {
            // Empty repository or branch missing → nothing there yet.
            return [:]
        }
        try check(s1, refJSON)
        guard let sha = ((refJSON as? [String: Any])?["object"] as? [String: Any])?["sha"] as? String else {
            throw SyncError.invalidResponse("ref")
        }
        headCommit = sha
        let (s2, commitJSON) = try await request("GET", "\(repoPath)/git/commits/\(sha)")
        try check(s2, commitJSON)
        guard let tree = ((commitJSON as? [String: Any])?["tree"] as? [String: Any])?["sha"] as? String else {
            throw SyncError.invalidResponse("commit")
        }
        baseTree = tree
        let (s3, treeJSON) = try await request("GET", "\(repoPath)/git/trees/\(tree)?recursive=1")
        try check(s3, treeJSON)
        let entries = (treeJSON as? [String: Any])?["tree"] as? [[String: Any]] ?? []
        if (treeJSON as? [String: Any])?["truncated"] as? Bool == true {
            throw SyncError.invalidResponse("Repository zu groß für einen Tree-Abruf – bitte ein Unterverzeichnis verwenden.")
        }
        var result: [String: String] = [:]
        for e in entries where e["type"] as? String == "blob" {
            guard let path = e["path"] as? String, let sha = e["sha"] as? String, path.hasPrefix(prefix) else { continue }
            let rel = String(path.dropFirst(prefix.count))
            result[rel] = sha
            blobByPath[rel] = sha
        }
        return result
    }

    public func read(_ path: String) async throws -> Data {
        guard let sha = blobByPath[path] else { throw SyncError.io("Datei nicht im Repository: \(path)") }
        let (s, json) = try await request("GET", "\(repoPath)/git/blobs/\(sha)")
        try check(s, json)
        guard let content = (json as? [String: Any])?["content"] as? String,
              let data = Data(base64Encoded: content.replacingOccurrences(of: "\n", with: "")) else {
            throw SyncError.invalidResponse("blob")
        }
        return data
    }

    public func apply(writes: [String: Data], deletes: [String], message: String) async throws {
        if headCommit == nil {
            try await initializeEmptyRepository()
        }
        var tree: [[String: Any]] = []
        for (path, data) in writes.sorted(by: { $0.key < $1.key }) {
            // Skip unchanged files.
            if blobByPath[path] == SHA1.gitBlobID(data) { continue }
            let (s, json) = try await request("POST", "\(repoPath)/git/blobs", body: ["content": data.base64EncodedString(), "encoding": "base64"])
            try check(s, json)
            guard let sha = (json as? [String: Any])?["sha"] as? String else { throw SyncError.invalidResponse("blob create") }
            tree.append(["path": prefix + path, "mode": "100644", "type": "blob", "sha": sha])
        }
        for path in deletes where blobByPath[path] != nil {
            tree.append(["path": prefix + path, "mode": "100644", "type": "blob", "sha": NSNull()])
        }
        guard !tree.isEmpty else { return }
        var treeBody: [String: Any] = ["tree": tree]
        if let baseTree { treeBody["base_tree"] = baseTree }
        let (s1, treeJSON) = try await request("POST", "\(repoPath)/git/trees", body: treeBody)
        try check(s1, treeJSON)
        guard let newTree = (treeJSON as? [String: Any])?["sha"] as? String else { throw SyncError.invalidResponse("tree") }
        var commitBody: [String: Any] = ["message": message, "tree": newTree]
        if let headCommit { commitBody["parents"] = [headCommit] }
        let (s2, commitJSON) = try await request("POST", "\(repoPath)/git/commits", body: commitBody)
        try check(s2, commitJSON)
        guard let newCommit = (commitJSON as? [String: Any])?["sha"] as? String else { throw SyncError.invalidResponse("commit create") }
        let (s3, refJSON) = try await request("PATCH", "\(repoPath)/git/refs/heads/\(config.branch)", body: ["sha": newCommit, "force": false])
        if s3 == 422 || s3 == 409 { throw SyncError.remoteChangedDuringSync }
        try check(s3, refJSON)
        headCommit = newCommit
        baseTree = newTree
    }

    /// The Git Data API does not work on completely empty repositories, so the first file is
    /// created through the Contents API (which also creates the branch).
    func initializeEmptyRepository() async throws {
        let readme = "# Unity Developer Vault\n\nDieses Repository wird von der iOS-App *Unity Developer Vault* synchronisiert.\n"
        let body: [String: Any] = ["message": "Vault initialisieren", "content": Data(readme.utf8).base64EncodedString(), "branch": config.branch]
        let (s, json) = try await request("PUT", "\(repoPath)/contents/\(prefix).vault/README.md", body: body)
        if s == 422 {
            // Branch missing but repository not empty: create branch from default branch.
            let (rs, repoJSON) = try await request("GET", repoPath)
            try check(rs, repoJSON)
            let defaultBranch = (repoJSON as? [String: Any])?["default_branch"] as? String ?? "main"
            let (bs, bJSON) = try await request("GET", "\(repoPath)/git/ref/heads/\(defaultBranch)")
            try check(bs, bJSON)
            guard let sha = ((bJSON as? [String: Any])?["object"] as? [String: Any])?["sha"] as? String else { throw SyncError.invalidResponse("ref") }
            let (cs, cJSON) = try await request("POST", "\(repoPath)/git/refs", body: ["ref": "refs/heads/\(config.branch)", "sha": sha])
            try check(cs, cJSON)
        } else {
            try check(s, json)
        }
        _ = try await list()
        if headCommit == nil { throw SyncError.invalidResponse("Branch konnte nicht angelegt werden") }
    }
}
