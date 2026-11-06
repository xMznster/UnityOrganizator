// Port of VaultKit's AnalyzerTests (same C# inputs, extracted to analyzer-samples.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyze } from "../js/core/analyzer.js";
import { lex } from "../js/core/lexer.js";

const S = JSON.parse(fs.readFileSync(new URL("./analyzer-samples.json", import.meta.url)));
const rules = (r) => r.diagnostics.map((d) => d.ruleID);
const fmt = (ds) => ds.map((d) => `${d.line}: ${d.ruleID} ${d.message}`);

test("clean script has no errors or warnings", () => {
  const r = analyze(S.cleanPlayer[0], { fileName: "PlayerController" });
  const bad = r.diagnostics.filter((d) => d.severity !== "info");
  assert.deepEqual(fmt(bad), []);
  assert.equal(r.scriptKind, "MonoBehaviour");
  assert.deepEqual(new Set(r.types.map((t) => t.name)), new Set(["PlayerController", "IDamageable", "State"]));
  const pc = r.types.find((t) => t.name === "PlayerController");
  assert.deepEqual(pc.bases, ["MonoBehaviour", "IDamageable"]);
  assert.ok(pc.methods.some((m) => m.name === "Die" && m.returnType === "IEnumerator"));
  assert.ok(pc.methods.some((m) => m.name === "OnTriggerEnter" && m.parameterTypes.join() === "Collider"));
  assert.ok(pc.fields.some((f) => f.name === "speed" && f.typeName === "float"));
  assert.ok(r.detectedComponents.includes("Rigidbody"));
});

test("missing semicolons", () => {
  const r = analyze(S.testMissingSemicolon[0]);
  assert.deepEqual(r.diagnostics.filter((d) => d.ruleID === "SYN010").map((d) => d.line), [4, 7]);
  assert.ok(rules(analyze(S.testMissingSemicolonBeforeBlockEnd[0])).includes("SYN011"));
});

test("missing brace, stray paren, unterminated string", () => {
  assert.ok(rules(analyze(S.testMissingClosingBraceWithHint[0])).includes("SYN002"));
  assert.ok(rules(analyze("class A { void M() { int x = (1 + 2)); } }")).includes("SYN001"));
  assert.ok(rules(analyze('class A { string s = "hello; }')).includes("LEX001"));
});

test("statements outside methods / types", () => {
  assert.ok(rules(analyze(S.testStatementInClassBody[0])).includes("SYN021"));
  assert.ok(rules(analyze("void Foo() { }")).includes("SYN020"));
});

test("unity message typos and signatures", () => {
  const ids = rules(analyze(S.testUnityMessageTypos[0]));
  assert.equal(ids.filter((x) => x === "UNITY001").length, 2);
  assert.equal(ids.filter((x) => x === "UNITY002").length, 2);
});

test("frame method performance", () => {
  const ids = rules(analyze(S.testFrameMethodPerformance[0]));
  for (const id of ["UNITY011", "UNITY013", "UNITY014", "UNITY010"]) assert.ok(ids.includes(id), id);
});

test("CS1612, missing usings, coroutines, heuristics", () => {
  assert.ok(rules(analyze(S.testCS1612[0])).includes("CS1612"));
  const msgs = analyze(S.testMissingUsings[0]).diagnostics.filter((d) => d.ruleID === "CS0246").map((d) => d.message);
  assert.ok(msgs.some((m) => m.includes("MonoBehaviour")));
  assert.ok(msgs.some((m) => m.includes("System.Collections.Generic")));
  assert.ok(msgs.some((m) => m.includes("using System.Collections;")));
  const co = rules(analyze(S.testCoroutineRules[0]));
  for (const id of ["UNITY042", "UNITY040", "UNITY041"]) assert.ok(co.includes(id), id);
  const h = rules(analyze(S.testCSharpHeuristics[0]));
  for (const id of ["CSA001", "CS0642", "CSA002", "CSA003", "CS0111"]) assert.ok(h.includes(id), id);
  assert.ok(!rules(analyze("class A { void M() { int i = 0; do { i++; } while (i < 3); } }")).includes("CS0642"));
});

test("UnityEditor guard and file name", () => {
  assert.ok(rules(analyze("using UnityEditor;\nusing UnityEngine;\npublic class A : MonoBehaviour { }")).includes("UNITY050"));
  assert.ok(!rules(analyze("#if UNITY_EDITOR\nusing UnityEditor;\n#endif\nusing UnityEngine;\npublic class A : MonoBehaviour { }")).includes("UNITY050"));
  const ed = analyze("using UnityEditor;\nusing UnityEngine;\n[CustomEditor(typeof(Foo))]\npublic class FooEditor : Editor { public override void OnInspectorGUI() { } }");
  assert.equal(ed.scriptKind, "Editor-Skript");
  assert.ok(rules(ed).includes("UNITY051"));
  const code = "using UnityEngine;\npublic class EnemyAI : MonoBehaviour { }";
  assert.ok(rules(analyze(code, { fileName: "Enemy" })).includes("UNITY070"));
  assert.ok(!rules(analyze(code, { fileName: "EnemyAI" })).includes("UNITY070"));
});

test("modern syntax has no false positives", () => {
  const r = analyze(S.testModernSyntaxDoesNotProduceFalsePositives[0]);
  assert.deepEqual(fmt(r.diagnostics.filter((d) => d.severity !== "info")), []);
  assert.equal(r.scriptKind, "ScriptableObject");
});

test("large script performance", () => {
  let code = "using UnityEngine;\npublic class Big : MonoBehaviour\n{\n";
  for (let i = 0; i < 1500; i++) code += `    private float field${i} = ${i}f;\n    public void Method${i}(int a) { if (a > ${i}) { field${i} += a * Time.deltaTime; } }\n`;
  code += "}\n";
  const t = Date.now();
  const r = analyze(code);
  assert.equal(r.errorCount, 0);
  assert.ok(Date.now() - t < 3000, `took ${Date.now() - t}ms`);
});

test("lexer tokens and utf16 ranges", () => {
  const r = lex('var x = 0x1F + 1.5e3f; // hi\n#region X\nstring s = $@"a{b}";');
  const kinds = r.tokens.map((t) => t.kind);
  for (const k of ["number", "comment", "preprocessor", "string"]) assert.ok(kinds.includes(k), k);
  assert.equal(r.issues.length, 0);
  const src = "// 🕷️ spider\nint x;";
  const tok = lex(src).tokens.find((t) => t.text === "int");
  assert.equal(src.slice(tok.location, tok.end), "int");
  assert.equal(tok.line, 2);
});
