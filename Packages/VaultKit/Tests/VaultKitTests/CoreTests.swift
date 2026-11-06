import XCTest
@testable import VaultKit

final class CoreTests: XCTestCase {

    // MARK: Hashing

    func testGitBlobIDMatchesGit() {
        // `printf 'hello\n' | git hash-object --stdin`
        XCTAssertEqual(SHA1.gitBlobID(Data("hello\n".utf8)), "ce013625030ba8dba906f756967f9e9ca394464a")
        XCTAssertEqual(SHA1.hex(Data("abc".utf8)), "a9993e364706816aba3e25717850c26c9cd0d89d")
        XCTAssertEqual(CRC32.checksum(Data("123456789".utf8)), 0xCBF43926)
    }

    // MARK: ZIP

    func testZipRoundTripPreservesBytes() throws {
        var z = ZipWriter()
        let code = "using UnityEngine;\r\n// Ümlaut 🕷️\r\npublic class A : MonoBehaviour { }\n"
        z.add(path: "Vault/Scripts/A.cs", text: code)
        z.add(path: "Vault/Scripts/A.cs", text: "duplicate")
        z.addDirectory("Vault/Empty")
        let data = z.archiveData()
        let entries = try XCTUnwrap(ZipReader.read(data))
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries[0].path, "Vault/Scripts/A.cs")
        XCTAssertEqual(entries[0].data, Data(code.utf8))
        XCTAssertEqual(entries[1].path, "Vault/Scripts/A (2).cs")

        // Verify with the system unzip tool when available.
        let unzip = URL(fileURLWithPath: "/usr/bin/unzip")
        if FileManager.default.fileExists(atPath: unzip.path) {
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let zipURL = dir.appendingPathComponent("t.zip")
            try data.write(to: zipURL)
            let p = Process()
            p.executableURL = unzip
            p.arguments = ["-q", "-t", zipURL.path]
            try p.run(); p.waitUntilExit()
            XCTAssertEqual(p.terminationStatus, 0, "unzip -t failed")
        }
    }

    // MARK: Markdown

    func testMarkdownParsing() {
        let md = """
        # Spider Leg Animation

        Idee für **prozedurale** Beine.

        - [ ] IK Targets
        - [x] Raycasts
          - nested

        1. Erstens
        2. Zweitens

        ```csharp
        void Update() { }
        ```

        > [!TIP] Kurzer Hinweis

        | A | B |
        |---|---|
        | 1 | 2 |

        ---
        """
        let blocks = MarkdownParser.parse(md)
        XCTAssertEqual(blocks.first, .heading(level: 1, text: "Spider Leg Animation"))
        XCTAssertTrue(blocks.contains(.code(language: "csharp", code: "void Update() { }")))
        XCTAssertTrue(blocks.contains(.callout(kind: "tip", text: "Kurzer Hinweis")))
        XCTAssertTrue(blocks.contains(.table(header: ["A", "B"], rows: [["1", "2"]])))
        XCTAssertTrue(blocks.contains(.divider))
        guard case .bulletList(let items)? = blocks.first(where: { if case .bulletList = $0 { return true }; return false }) else {
            return XCTFail("no list")
        }
        XCTAssertEqual(items.map(\.checked), [false, true, nil])
        XCTAssertEqual(items[2].indent, 1)
        XCTAssertEqual(MarkdownParser.suggestedTitle(md), "Spider Leg Animation")
    }

    // MARK: Search

    func makeIndex() -> (SearchIndex, [UUID]) {
        let ids = (0..<4).map { _ in UUID() }
        let docs = [
            SearchDocument(id: ids[0], kind: .script, title: "SpiderLegAnimator", content: "public class SpiderLegAnimator : MonoBehaviour { void Update() { var hit = Physics.Raycast(); } }",
                           tags: ["ik", "procedural"], category: "Animation", folderPath: ["Horror Game", "Scripts", "Enemy AI"], project: "Horror Game"),
            SearchDocument(id: ids[1], kind: .note, title: "Ideen für Spinnengegner", content: "Die Spider soll eine Leg Animation mit IK bekommen.",
                           tags: ["idea"], category: "Spielidee", folderPath: ["Horror Game", "Ideas"], project: "Horror Game"),
            SearchDocument(id: ids[2], kind: .prompt, title: "Claude Prompt: Procedural animation", content: "Write a Unity script for spider leg animation using raycasts.",
                           tags: ["claude"], category: "Code generieren", folderPath: ["Monster Game", "Prompts"], project: "Monster Game"),
            SearchDocument(id: ids[3], kind: .note, title: "Blender Export", content: "FBX export settings", folderPath: ["Blender"], project: "Blender")
        ]
        return (SearchIndex(documents: docs), ids)
    }

    func testSmartSearchFindsAcrossKindsAndCamelCase() {
        let (index, ids) = makeIndex()
        let hits = index.search(SearchQuery(text: "Spider Leg Animation"))
        XCTAssertEqual(Set(hits.map(\.id)), Set(ids[0...2]))
        XCTAssertFalse(hits.contains { $0.id == ids[3] })
    }

    func testSearchFilters() {
        let (index, ids) = makeIndex()
        var q = SearchQuery(text: "spider")
        q.kinds = [.script]
        XCTAssertEqual(index.search(q).map(\.id), [ids[0]])
        q = SearchQuery(text: "spider", projects: ["Horror Game"])
        XCTAssertEqual(Set(index.search(q).map(\.id)), [ids[0], ids[1]])
        q = SearchQuery(text: "", tags: ["IK"])
        XCTAssertEqual(index.search(q).map(\.id), [ids[0]])
        q = SearchQuery(text: "enemy ai")
        XCTAssertTrue(index.search(q).contains { $0.id == ids[0] }, "folder names must be searchable")
    }

    func testExactCodeSearch() {
        let (index, ids) = makeIndex()
        let hits = index.search(SearchQuery(text: "Physics.Raycast()", mode: .exact))
        XCTAssertEqual(hits.map(\.id), [ids[0]])
        XCTAssertEqual(hits.first?.line, 1)
        XCTAssertFalse(hits.first?.highlights.isEmpty ?? true)
    }

    // MARK: Codec / Export / Import

    func testFrontMatterRoundTrip() {
        let item = SnapshotItem(kind: .prompt, title: "Refactor \"Player\"", content: "Line 1\n\n## H2\n", summary: "Kurz: 1", category: "Refactoring", tags: ["claude", "c#"])
        let data = FileCodec.render(item)
        let parsed = FileCodec.parse(path: "x/Refactor Player.md", data: data, existing: nil)
        XCTAssertEqual(parsed.title, item.title)
        XCTAssertEqual(parsed.kind, .prompt)
        XCTAssertEqual(parsed.content, item.content)
        XCTAssertEqual(parsed.summary, item.summary)
        XCTAssertEqual(parsed.tags, item.tags)
        XCTAssertEqual(parsed.category, item.category)
        // Rendering the parsed item again must give identical bytes (stable sync).
        var again = parsed
        again.id = item.id
        again.createdAt = item.createdAt
        XCTAssertEqual(FileCodec.render(again), data)
    }

    func testScriptFileIsByteExact() {
        let code = "\u{FEFF}using UnityEngine;\r\n\tpublic class X : MonoBehaviour {}\r\n"
        let item = SnapshotItem(kind: .script, title: "X", content: code)
        XCTAssertEqual(FileCodec.render(item), Data(code.utf8))
        XCTAssertEqual(FileNaming.fileName(for: item), "X.cs")
        XCTAssertEqual(FileNaming.fileName(for: SnapshotItem(kind: .script, title: "spider leg animator")), "SpiderLegAnimator.cs")
        XCTAssertEqual(FileNaming.safeName("a/b:c*?"), "a b c")
    }

    func sampleSnapshot() -> VaultSnapshot {
        let horror = SnapshotFolder(name: "Horror Game")
        let scripts = SnapshotFolder(name: "Scripts", parentID: horror.id)
        let ai = SnapshotFolder(name: "Enemy AI", parentID: scripts.id)
        let ideas = SnapshotFolder(name: "Ideas", parentID: horror.id)
        let items = [
            SnapshotItem(kind: .script, title: "SpiderAI", content: "using UnityEngine;\npublic class SpiderAI : MonoBehaviour { }\n", folderID: ai.id, status: .tested),
            SnapshotItem(kind: .script, title: "Door", content: "using UnityEngine;\npublic class Door : MonoBehaviour { }\n", folderID: scripts.id),
            SnapshotItem(kind: .note, title: "Spider idea", content: "Legs!", tags: ["idea"], folderID: ideas.id),
            SnapshotItem(kind: .prompt, title: "Prompt", content: "Write code", folderID: nil)
        ]
        return VaultSnapshot(folders: [horror, scripts, ai, ideas], items: items)
    }

    func testExportStructureAndReimport() throws {
        let snap = sampleSnapshot()
        let builder = ExportBuilder(snapshot: snap)
        let files = builder.files()
        let paths = Set(files.map(\.path))
        XCTAssertTrue(paths.contains("UnityVault/Horror Game/Scripts/Enemy AI/SpiderAI.cs"))
        XCTAssertTrue(paths.contains("UnityVault/Horror Game/Scripts/Door.cs"))
        XCTAssertTrue(paths.contains("UnityVault/Horror Game/Ideas/Spider idea.md"))
        XCTAssertTrue(paths.contains("UnityVault/Inbox/Prompt.md"))
        XCTAssertTrue(paths.contains("UnityVault/.vault/manifest.json"))
        XCTAssertTrue(paths.contains("UnityVault/INDEX.md"))

        // Folder export strips ancestors
        let scriptsFolder = snap.folders[1].id
        let sub = ExportBuilder(snapshot: snap).files(rootFolder: scriptsFolder).map(\.path)
        XCTAssertTrue(sub.contains("UnityVault/Scripts/Enemy AI/SpiderAI.cs"), "\(sub)")

        // Unity-only export: only .cs
        var opts = ExportBuilder.Options(); opts.scriptsOnly = true
        XCTAssertTrue(ExportBuilder(snapshot: snap, options: opts).files().allSatisfy { $0.path.hasSuffix(".cs") })

        // Round trip through ZIP
        let zip = builder.zip()
        let entries = try XCTUnwrap(ZipReader.read(zip))
        let planned = ImportPlanner.plan(files: entries.map { ($0.path, $0.data) })
        XCTAssertEqual(planned.count, 4)
        let spider = try XCTUnwrap(planned.first { $0.item.title == "SpiderAI" })
        XCTAssertEqual(spider.folderPath, ["Horror Game", "Scripts", "Enemy AI"])
        XCTAssertEqual(spider.item.status, .tested, "metadata restored from manifest")
        XCTAssertEqual(spider.item.content, snap.items[0].content)
        XCTAssertNotEqual(spider.item.id, snap.items[0].id, "imports never overwrite existing items")
        let prompt = try XCTUnwrap(planned.first { $0.item.kind == .prompt })
        XCTAssertEqual(prompt.folderPath, [])
    }

    func testTemplatesAreClean() {
        for t in UnityTemplates.all {
            let code = t.render(name: "My Thing")
            let r = CSharpAnalyzer().analyze(code, options: .init(fileName: "MyThing"))
            let bad = r.diagnostics.filter { $0.severity != .info }
            XCTAssertEqual(bad, [], "Template \(t.id): \(bad.map { "\($0.line) \($0.ruleID) \($0.message)" })")
        }
    }

    // MARK: Claude

    func testSkillGeneration() throws {
        let snap = sampleSnapshot()
        let files = ClaudeBridge.skillFiles(spec: .init(name: "Horror Enemy Patterns", description: "Use for enemy AI"), items: snap.items, snapshot: snap)
        let skill = try XCTUnwrap(files["horror-enemy-patterns/SKILL.md"]).utf8String
        XCTAssertTrue(skill.hasPrefix("---\nname: horror-enemy-patterns\ndescription: \"Use for enemy AI\"\n---"))
        XCTAssertNotNil(files["horror-enemy-patterns/scripts/SpiderAI.cs"])
        XCTAssertNotNil(files["horror-enemy-patterns/prompts/Prompt.md"])
        XCTAssertEqual(ClaudeBridge.normalizedSkillName("Spider Leg_Animation!!"), "spider-leg-animation")
    }

    // MARK: Editor assist

    func testSmartNewline() {
        let text = "void Start() {}" as NSString
        let e = EditorAssist.newlineEdit(in: text, range: NSRange(location: 14, length: 0), indentUnit: "    ")
        XCTAssertEqual(e.replacement, "\n    \n")
        XCTAssertEqual(e.caret, 14 + 5)
        let t2 = "    int x;" as NSString
        XCTAssertEqual(EditorAssist.newlineEdit(in: t2, range: NSRange(location: 10, length: 0), indentUnit: "    ").replacement, "\n    ")
    }

    func testClosingBraceOutdent() {
        let text = "class A {\n    void M() {\n        " as NSString
        let e = EditorAssist.closingBraceEdit(in: text, range: NSRange(location: text.length, length: 0), indentUnit: "    ")
        XCTAssertEqual(e?.replacement, "    }")
    }

    func testBracketPairAndReindent() {
        let src = "class A { void M() { int[] a = { 1 }; } }"
        let lex = CSharpLexer().lex(src)
        let pair = EditorAssist.bracketPair(tokens: lex.tokens, caret: 9)
        XCTAssertEqual(pair?.0, 8)
        XCTAssertEqual(pair?.1, (src as NSString).length - 1)
        let messy = "class A\n{\nvoid M()\n{\nif (x)\n{\nFoo(a,\nb);\n}\n}\n}"
        let formatted = EditorAssist.reindent(messy, indentUnit: "  ")
        XCTAssertEqual(formatted, "class A\n{\n  void M()\n  {\n    if (x)\n    {\n      Foo(a,\n        b);\n    }\n  }\n}")
    }

    func testToggleComment() {
        let text = "a();\n  b();\n" as NSString
        let e = EditorAssist.toggleLineComment(in: text, range: NSRange(location: 0, length: text.length))
        XCTAssertEqual(e.replacement, "// a();\n//   b();\n")
        let back = EditorAssist.toggleLineComment(in: e.replacement as NSString, range: NSRange(location: 0, length: (e.replacement as NSString).length))
        XCTAssertEqual(back.replacement, "a();\n  b();\n")
    }
}

extension Data {
    var utf8String: String { String(decoding: self, as: UTF8.self) }
}
