import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gitBlobId, sha1Hex, crc32, utf8, fromUtf8, ZipWriter, readZip, render, parseFile, fileName, safeName, exportFiles, exportZip, planImport } from "../js/core/files.js";
import { parse, suggestedTitle, renderHTML } from "../js/core/markdown.js";
import { SearchIndex } from "../js/core/search.js";
import { TEMPLATES, renderTemplate, csharpIdentifier } from "../js/core/templates.js";
import { analyze } from "../js/core/analyzer.js";
import { newlineEdit, closingBraceEdit, bracketPair, reindent, toggleLineComment, listContinuation } from "../js/core/editor-assist.js";
import { lex } from "../js/core/lexer.js";
import { skillFiles, normalizedSkillName } from "../js/core/claude.js";

let idc = 0;
const newId = () => `id-${++idc}`;

test("hashing matches git", async () => {
  assert.equal(await gitBlobId(utf8("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a");
  assert.equal(await sha1Hex(utf8("abc")), "a9993e364706816aba3e25717850c26c9cd0d89d");
  assert.equal(crc32(utf8("123456789")), 0xcbf43926);
});

test("zip round trip is byte exact and valid for unzip", () => {
  const code = "using UnityEngine;\r\n// Ümlaut 🕷️\r\npublic class A : MonoBehaviour { }\n";
  const z = new ZipWriter();
  z.add("Vault/Scripts/A.cs", code);
  z.add("Vault/Scripts/A.cs", "duplicate");
  z.addDirectory("Vault/Empty");
  const bytes = z.toBytes();
  const entries = readZip(bytes);
  assert.equal(entries.length, 2);
  assert.equal(fromUtf8(entries[0].data), code);
  assert.equal(entries[1].path, "Vault/Scripts/A (2).cs");
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "z")), "t.zip");
  fs.writeFileSync(f, bytes);
  try { execFileSync("unzip", ["-q", "-t", f]); } catch (e) { if (e.code !== "ENOENT") throw e; }
});

test("markdown", () => {
  const md = "# Spider Leg Animation\n\nIdee für **prozedurale** Beine.\n\n- [ ] IK Targets\n- [x] Raycasts\n  - nested\n\n```csharp\nvoid Update() { }\n```\n\n> [!TIP] Kurzer Hinweis\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n---";
  const b = parse(md);
  assert.deepEqual(b[0], { type: "heading", level: 1, text: "Spider Leg Animation" });
  assert.ok(b.some((x) => x.type === "code" && x.language === "csharp" && x.code === "void Update() { }"));
  assert.ok(b.some((x) => x.type === "callout" && x.kind === "tip"));
  assert.ok(b.some((x) => x.type === "table" && x.rows[0][1] === "2"));
  const list = b.find((x) => x.type === "bullets");
  assert.deepEqual(list.items.map((i) => i.checked), [false, true, null]);
  assert.equal(suggestedTitle(md), "Spider Leg Animation");
  assert.ok(!renderHTML("<script>alert(1)</script> **x**").includes("<script>"));
});

const docs = () => [
  { id: "a", kind: "script", title: "SpiderLegAnimator", content: "public class SpiderLegAnimator : MonoBehaviour { void Update() { var hit = Physics.Raycast(); } }", tags: ["ik", "procedural"], category: "Animation", folderPath: ["Horror Game", "Scripts", "Enemy AI"], project: "Horror Game", modifiedAt: 1 },
  { id: "b", kind: "note", title: "Ideen für Spinnengegner", content: "Die Spider soll eine Leg Animation mit IK bekommen.", tags: ["idea"], category: "Spielidee", folderPath: ["Horror Game", "Ideas"], project: "Horror Game", modifiedAt: 1 },
  { id: "c", kind: "prompt", title: "Claude Prompt: Procedural animation", content: "Write a Unity script for spider leg animation using raycasts.", tags: ["claude"], category: "Code", folderPath: ["Monster Game", "Prompts"], project: "Monster Game", modifiedAt: 1 },
  { id: "d", kind: "note", title: "Blender Export", content: "FBX export settings", tags: [], category: "", folderPath: ["Blender"], project: "Blender", modifiedAt: 1 },
];

test("search across kinds, filters, exact code", () => {
  const idx = new SearchIndex(docs());
  assert.deepEqual(new Set(idx.search({ text: "Spider Leg Animation" }).map((h) => h.id)), new Set(["a", "b", "c"]));
  assert.deepEqual(idx.search({ text: "spider", kinds: new Set(["script"]) }).map((h) => h.id), ["a"]);
  assert.deepEqual(new Set(idx.search({ text: "spider", projects: new Set(["Horror Game"]) }).map((h) => h.id)), new Set(["a", "b"]));
  assert.deepEqual(idx.search({ text: "", tags: new Set(["IK"]) }).map((h) => h.id), ["a"]);
  assert.ok(idx.search({ text: "enemy ai" }).some((h) => h.id === "a"));
  const ex = idx.search({ text: "Physics.Raycast()", mode: "exact" });
  assert.deepEqual(ex.map((h) => h.id), ["a"]);
  assert.equal(ex[0].line, 1);
  assert.ok(ex[0].ranges.length > 0);
});

test("front matter round trip & byte exact scripts", () => {
  const item = { id: "x1", kind: "prompt", title: 'Refactor "Player"', content: "Line 1\n\n## H2\n", summary: "Kurz: 1", category: "Refactoring", tags: ["claude", "c#"], createdAt: Date.parse("2026-01-01T00:00:00Z"), isFavorite: false };
  const text = render(item);
  const p = parseFile("x/Refactor Player.md", text, null);
  for (const k of ["title", "kind", "content", "summary", "category"]) assert.equal(p[k], item[k], k);
  assert.deepEqual(p.tags, item.tags);
  assert.equal(render({ ...p, id: item.id, createdAt: item.createdAt }), text);
  const code = "﻿using UnityEngine;\r\n\tpublic class X : MonoBehaviour {}\r\n";
  assert.equal(render({ kind: "script", title: "X", content: code }), code);
  assert.equal(fileName({ kind: "script", title: "spider leg animator" }), "SpiderLegAnimator.cs");
  assert.equal(safeName("a/b:c*?"), "a b c");
});

const sample = () => {
  const folders = [{ id: "h", name: "Horror Game", parentId: null }, { id: "s", name: "Scripts", parentId: "h" }, { id: "ai", name: "Enemy AI", parentId: "s" }, { id: "i", name: "Ideas", parentId: "h" }];
  const base = { summary: "", category: "", tags: [], isFavorite: false, unityVersion: "", components: [], dependencies: [], projectName: "", status: "" };
  const items = [
    { ...base, id: "1", kind: "script", title: "SpiderAI", content: "using UnityEngine;\npublic class SpiderAI : MonoBehaviour { }\n", folderId: "ai", status: "tested", createdAt: 1, modifiedAt: 1 },
    { ...base, id: "2", kind: "script", title: "Door", content: "using UnityEngine;\npublic class Door : MonoBehaviour { }\n", folderId: "s", status: "inDevelopment", createdAt: 2, modifiedAt: 2 },
    { ...base, id: "3", kind: "note", title: "Spider idea", content: "Legs!", tags: ["idea"], folderId: "i", createdAt: 3, modifiedAt: 3 },
    { ...base, id: "4", kind: "prompt", title: "Prompt", content: "Write code", folderId: null, createdAt: 4, modifiedAt: 4 },
  ];
  return { folders, items };
};

test("export structure and re-import", () => {
  const snap = sample();
  const paths = new Set(exportFiles(snap).map((f) => f.path));
  for (const p of ["UnityVault/Horror Game/Scripts/Enemy AI/SpiderAI.cs", "UnityVault/Horror Game/Scripts/Door.cs", "UnityVault/Horror Game/Ideas/Spider idea.md", "UnityVault/Inbox/Prompt.md", "UnityVault/.vault/manifest.json", "UnityVault/INDEX.md"]) assert.ok(paths.has(p), p);
  assert.ok(exportFiles(snap, { rootFolder: "s" }).map((f) => f.path).includes("UnityVault/Scripts/Enemy AI/SpiderAI.cs"));
  assert.ok(exportFiles(snap, { scriptsOnly: true }).every((f) => f.path.endsWith(".cs")));
  const planned = planImport(readZip(exportZip(snap)), newId);
  assert.equal(planned.length, 4);
  const spider = planned.find((p) => p.item.title === "SpiderAI");
  assert.deepEqual(spider.folderPath, ["Horror Game", "Scripts", "Enemy AI"]);
  assert.equal(spider.item.status, "tested");
  assert.equal(spider.item.content, snap.items[0].content);
  assert.notEqual(spider.item.id, "1");
  assert.deepEqual(planned.find((p) => p.item.kind === "prompt").folderPath, []);
});

test("templates are clean", () => {
  for (const t of TEMPLATES) {
    const r = analyze(renderTemplate(t, "My Thing"), { fileName: "MyThing" });
    assert.deepEqual(r.diagnostics.filter((d) => d.severity !== "info").map((d) => `${t.id} ${d.line} ${d.ruleID}`), []);
  }
  assert.equal(csharpIdentifier("spider leg animator"), "SpiderLegAnimator");
});

test("editor assist", () => {
  const e = newlineEdit("void Start() {}", 14, 14, "    ");
  assert.equal(e.insert, "\n    \n");
  assert.equal(e.caret, 19);
  assert.equal(newlineEdit("    int x;", 10, 10, "    ").insert, "\n    ");
  const t = "class A {\n    void M() {\n        ";
  assert.equal(closingBraceEdit(t, t.length, t.length, "    ").insert, "    }");
  const src = "class A { void M() { int[] a = { 1 }; } }";
  assert.deepEqual(bracketPair(lex(src).tokens, 9), [8, src.length - 1]);
  assert.equal(reindent("class A\n{\nvoid M()\n{\nif (x)\n{\nFoo(a,\nb);\n}\n}\n}", "  "), "class A\n{\n  void M()\n  {\n    if (x)\n    {\n      Foo(a,\n        b);\n    }\n  }\n}");
  const c = toggleLineComment("a();\n  b();\n", 0, 12);
  assert.equal(c.insert, "// a();\n//   b();");
  assert.equal(listContinuation("- [x] done", 10), "- [ ] ");
  assert.equal(listContinuation("2. zwei", 7), "3. ");
  assert.equal(listContinuation("- ", 2), "");
});

test("skill generation", () => {
  const snap = sample();
  const files = skillFiles({ name: "Horror Enemy Patterns", description: "Use for enemy AI" }, snap.items, snap);
  assert.ok(fromUtf8(files["horror-enemy-patterns/SKILL.md"]).startsWith('---\nname: horror-enemy-patterns\ndescription: "Use for enemy AI"\n---'));
  assert.ok(files["horror-enemy-patterns/scripts/SpiderAI.cs"]);
  assert.ok(files["horror-enemy-patterns/prompts/Prompt.md"]);
  assert.equal(normalizedSkillName("Spider Leg_Animation!!"), "spider-leg-animation");
});
