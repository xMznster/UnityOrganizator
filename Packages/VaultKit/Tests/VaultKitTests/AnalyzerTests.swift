import XCTest
@testable import VaultKit

final class AnalyzerTests: XCTestCase {

    func analyze(_ code: String, file: String? = nil) -> AnalysisReport {
        CSharpAnalyzer().analyze(code, options: .init(fileName: file))
    }

    func rules(_ r: AnalysisReport) -> [String] { r.diagnostics.map(\.ruleID) }

    // MARK: Clean code must produce no errors / warnings

    static let cleanPlayer = """
    using System.Collections;
    using System.Collections.Generic;
    using UnityEngine;
    using UnityEngine.AI;

    namespace Game.Player
    {
        [RequireComponent(typeof(Rigidbody))]
        public class PlayerController : MonoBehaviour, IDamageable
        {
            [Header("Movement")]
            [SerializeField] private float speed = 5f;
            [SerializeField, Range(0f, 10f)]
            private float jumpForce = 4f;
            public int Health { get; private set; } = 100;
            public event System.Action<int> OnDamaged;
            private Rigidbody rb;
            private readonly List<Vector3> path = new List<Vector3>();
            private Dictionary<string, int> map = new Dictionary<string, int>
            {
                { "a", 1 },
                { "b", 2 }
            };

            private void Awake()
            {
                rb = GetComponent<Rigidbody>();
            }

            private void Update()
            {
                float h = Input.GetAxis("Horizontal");
                transform.Translate(Vector3.right * h * speed * Time.deltaTime);
                if (h > 0.5f)
                    Debug.Assert(h > 0);
                else if (h < -0.5f)
                {
                    path.Add(transform.position);
                }
                var items = new[] { 1, 2, 3 };
                for (int i = 0; i < items.Length; i++) { h += items[i]; }
                System.Func<int, int> square = x =>
                {
                    return x * x;
                };
                var p = transform.position;
                p.y = 2f;
                transform.position = p;
                switch (items.Length)
                {
                    case 1:
                        break;
                    default:
                        h = 0;
                        break;
                }
            }

            private void FixedUpdate()
            {
                rb.AddForce(Vector3.up * jumpForce);
            }

            public void TakeDamage(int amount)
            {
                Health -= amount;
                OnDamaged?.Invoke(amount);
                if (Health <= 0) StartCoroutine(Die());
            }

            private IEnumerator Die()
            {
                yield return new WaitForSeconds(1f);
                Destroy(gameObject);
            }

            private void OnTriggerEnter(Collider other)
            {
                if (other.CompareTag("Enemy"))
                {
                    TakeDamage(10);
                }
            }

            public int Square(int v) => v * v;
        }

        public interface IDamageable
        {
            void TakeDamage(int amount);
            int Health { get; }
        }

        public enum State { Idle, Walking, Running }
    }
    """

    func testCleanScriptHasNoErrorsOrWarnings() {
        let r = analyze(Self.cleanPlayer, file: "PlayerController")
        let problems = r.diagnostics.filter { $0.severity != .info }
        XCTAssertEqual(problems, [], "Unexpected: \(problems.map { "\($0.line): \($0.ruleID) \($0.message)" })")
        XCTAssertEqual(r.scriptKind, .monoBehaviour)
        XCTAssertEqual(Set(r.declaredTypeNames), ["PlayerController", "IDamageable", "State"])
        let pc = r.types.first { $0.name == "PlayerController" }!
        XCTAssertEqual(pc.bases, ["MonoBehaviour", "IDamageable"])
        XCTAssertTrue(pc.methods.contains { $0.name == "Update" })
        XCTAssertTrue(pc.methods.contains { $0.name == "Die" && $0.isCoroutine })
        XCTAssertTrue(pc.methods.contains { $0.name == "OnTriggerEnter" && $0.parameterTypes == ["Collider"] })
        XCTAssertTrue(pc.fields.contains { $0.name == "speed" && $0.typeName == "float" })
        XCTAssertTrue(r.detectedComponents.contains("Rigidbody"))
    }

    func testMissingSemicolon() {
        let code = """
        using UnityEngine;
        public class A : MonoBehaviour
        {
            public float speed = 5f
            void Start()
            {
                int x = 5
                Debug.Log(x);
            }
        }
        """
        let r = analyze(code)
        let syn = r.diagnostics.filter { $0.ruleID == "SYN010" }
        XCTAssertEqual(syn.map(\.line), [4, 7], "\(r.diagnostics)")
    }

    func testMissingSemicolonBeforeBlockEnd() {
        let code = """
        class A {
            void M() {
                int x = 1;
                x++
            }
        }
        """
        XCTAssertTrue(rules(analyze(code)).contains("SYN011"))
    }

    func testMissingClosingBraceWithHint() {
        let code = """
        using UnityEngine;
        public class A : MonoBehaviour
        {
            void Start()
            {
                if (true)
                {
                    Debug.Log("x");
            }

            void Update()
            {
            }
        }
        """
        let r = analyze(code)
        let d = r.diagnostics.first { $0.ruleID == "SYN002" }
        XCTAssertNotNil(d, "\(r.diagnostics)")
    }

    func testUnexpectedClosingParen() {
        let r = analyze("class A { void M() { int x = (1 + 2)); } }")
        XCTAssertTrue(rules(r).contains("SYN001"), "\(r.diagnostics)")
    }

    func testUnterminatedString() {
        let r = analyze("class A { string s = \"hello; }")
        XCTAssertTrue(rules(r).contains("LEX001"))
    }

    func testStatementInClassBody() {
        let code = """
        using UnityEngine;
        public class A : MonoBehaviour
        {
            Debug.Log("hi");
            void Start() { }
        }
        """
        XCTAssertTrue(rules(analyze(code)).contains("SYN021"))
    }

    func testMethodOutsideClass() {
        XCTAssertTrue(rules(analyze("void Foo() { }")).contains("SYN020"))
    }

    func testUnityMessageTypos() {
        let code = """
        using UnityEngine;
        public class A : MonoBehaviour
        {
            void start() { }
            void Updtae() { }
            void OnTriggerEnter(Collider2D other) { }
            void OnCollisionEnter(Collider other) { }
            void Helper() { }
        }
        """
        let r = analyze(code)
        let ids = rules(r)
        XCTAssertEqual(ids.filter { $0 == "UNITY001" }.count, 2, "\(r.diagnostics)")
        XCTAssertEqual(ids.filter { $0 == "UNITY002" }.count, 2, "\(r.diagnostics)")
    }

    func testFrameMethodPerformance() {
        let code = """
        using UnityEngine;
        public class A : MonoBehaviour
        {
            void Update()
            {
                var rb = GetComponent<Rigidbody>();
                var p = GameObject.Find("Player");
                rb.AddForce(Vector3.up);
                transform.Translate(Vector3.forward * 2f);
            }
            void LateUpdate() { }
        }
        """
        let ids = rules(analyze(code))
        XCTAssertTrue(ids.contains("UNITY011"))
        XCTAssertTrue(ids.contains("UNITY013"))
        XCTAssertTrue(ids.contains("UNITY014"))
        XCTAssertTrue(ids.contains("UNITY010"))
    }

    func testCS1612() {
        let code = """
        using UnityEngine;
        public class A : MonoBehaviour
        {
            void Start() { transform.position.x = 5f; }
        }
        """
        XCTAssertTrue(rules(analyze(code)).contains("CS1612"))
    }

    func testMissingUsings() {
        let code = """
        public class A : MonoBehaviour
        {
            private List<int> xs;
            IEnumerator Run() { yield return null; }
        }
        """
        let r = analyze(code)
        let msgs = r.diagnostics.filter { $0.ruleID == "CS0246" }.map(\.message)
        XCTAssertTrue(msgs.contains { $0.contains("MonoBehaviour") })
        XCTAssertTrue(msgs.contains { $0.contains("System.Collections.Generic") })
        XCTAssertTrue(msgs.contains { $0.contains("using System.Collections;") })
    }

    func testCoroutineRules() {
        let code = """
        using System.Collections;
        using UnityEngine;
        public class A : MonoBehaviour
        {
            void Start()
            {
                Fade();
                StartCoroutine("Fade");
            }
            IEnumerator Fade() { yield return null; }
            IEnumerator Broken() { return null; }
        }
        """
        let ids = rules(analyze(code))
        XCTAssertTrue(ids.contains("UNITY042"))
        XCTAssertTrue(ids.contains("UNITY040"))
        XCTAssertTrue(ids.contains("UNITY041"))
    }

    func testCSharpHeuristics() {
        let code = """
        class A
        {
            void M(int x)
            {
                if (x = 5) { }
                if (x > 1);
                try { } catch { }
                while (true) { x++; }
            }
            void M(int y) { }
        }
        """
        let ids = rules(analyze(code))
        XCTAssertTrue(ids.contains("CSA001"))
        XCTAssertTrue(ids.contains("CS0642"))
        XCTAssertTrue(ids.contains("CSA002"))
        XCTAssertTrue(ids.contains("CSA003"))
        XCTAssertTrue(ids.contains("CS0111"))
    }

    func testDoWhileIsNotEmptyStatement() {
        let code = "class A { void M() { int i = 0; do { i++; } while (i < 3); } }"
        XCTAssertFalse(rules(analyze(code)).contains("CS0642"))
    }

    func testUnityEditorGuard() {
        let unguarded = "using UnityEditor;\nusing UnityEngine;\npublic class A : MonoBehaviour { }"
        XCTAssertTrue(rules(analyze(unguarded)).contains("UNITY050"))
        let guarded = "#if UNITY_EDITOR\nusing UnityEditor;\n#endif\nusing UnityEngine;\npublic class A : MonoBehaviour { }"
        XCTAssertFalse(rules(analyze(guarded)).contains("UNITY050"))
        let editor = "using UnityEditor;\nusing UnityEngine;\n[CustomEditor(typeof(Foo))]\npublic class FooEditor : Editor { public override void OnInspectorGUI() { } }"
        let r = analyze(editor)
        XCTAssertEqual(r.scriptKind, .editorScript)
        XCTAssertTrue(rules(r).contains("UNITY051"))
    }

    func testFileNameMismatch() {
        let code = "using UnityEngine;\npublic class EnemyAI : MonoBehaviour { }"
        XCTAssertTrue(rules(analyze(code, file: "Enemy")).contains("UNITY070"))
        XCTAssertFalse(rules(analyze(code, file: "EnemyAI")).contains("UNITY070"))
    }

    func testModernSyntaxDoesNotProduceFalsePositives() {
        let code = #"""
        using System;
        using System.Linq;
        using System.Collections.Generic;
        using UnityEngine;

        public record Stats(int Hp, int Mp);

        public sealed class Inventory : ScriptableObject
        {
            [SerializeField] private List<string> items = new();
            public IReadOnlyList<string> Items => items;
            public string this[int i] => items[i];

            public int Count
            {
                get { return items.Count; }
                set
                {
                    if (value < 0) throw new ArgumentException(nameof(value));
                }
            }

            public string Describe(object o) => o switch
            {
                int n when n > 0 => "positive",
                string s => s,
                _ => "unknown"
            };

            public IEnumerable<string> Sorted()
            {
                var q = from i in items
                        where i.Length > 2
                        orderby i
                        select i;
                var r = items
                    .Where(i => i.StartsWith("a"))
                    .Select(i => i.ToUpper())
                    .ToList();
                var anon = new { Name = "x", Value = 2 };
                var cfg = new Dictionary<string, int>() { ["a"] = 1 };
                Action a = delegate { Debug.Log("x"); };
                Action<int> b = delegate (int v) { Debug.Log(v); };
                string interp = $"Value {anon.Value} {{braces}} {cfg["a"]}";
                string verb = @"C:\\path ""quoted""";
                return q.Concat(r);
            }

            public static T Max<T>(T a, T b) where T : IComparable<T>
            {
                return a.CompareTo(b) > 0 ? a : b;
            }
        }
        """#
        let r = analyze(code)
        let problems = r.diagnostics.filter { $0.severity == .error || $0.severity == .warning }
        XCTAssertEqual(problems, [], "\(problems.map { "\($0.line): \($0.ruleID) \($0.message)" })")
        XCTAssertEqual(r.scriptKind, .scriptableObject)
    }

    func testLargeScriptPerformance() {
        var code = "using UnityEngine;\npublic class Big : MonoBehaviour\n{\n"
        for i in 0..<1500 {
            code += "    private float field\(i) = \(i)f;\n    public void Method\(i)(int a) { if (a > \(i)) { field\(i) += a * Time.deltaTime; } }\n"
        }
        code += "}\n"
        let start = Date()
        let r = analyze(code)
        let elapsed = Date().timeIntervalSince(start)
        XCTAssertEqual(r.errorCount, 0)
        XCTAssertGreaterThan(r.lineCount, 3000)
        XCTAssertLessThan(elapsed, 5.0, "Analysis of 3000 lines took \(elapsed)s")
    }

    func testLexerTokens() {
        let r = CSharpLexer().lex("var x = 0x1F + 1.5e3f; // hi\n#region X\nstring s = $@\"a{b}\";")
        let kinds = r.tokens.filter { $0.kind != .whitespace }.map(\.kind)
        XCTAssertTrue(kinds.contains(.number))
        XCTAssertTrue(kinds.contains(.comment))
        XCTAssertTrue(kinds.contains(.preprocessor))
        XCTAssertTrue(kinds.contains(.string))
        XCTAssertEqual(r.issues, [])
        XCTAssertEqual(r.lineStarts.count, 3)
    }

    func testLexerUTF16RangesWithEmoji() {
        let src = "// 🕷️ spider\nint x;"
        let r = CSharpLexer().lex(src)
        let ns = src as NSString
        let intTok = r.tokens.first { $0.text == "int" }!
        XCTAssertEqual(ns.substring(with: intTok.range), "int")
        XCTAssertEqual(intTok.line, 2)
    }
}
