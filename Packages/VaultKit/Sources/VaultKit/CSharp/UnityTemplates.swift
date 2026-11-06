import Foundation

/// Starter templates for new Unity scripts and insertable snippets for the editor.
public enum UnityTemplates {

    public struct Template: Identifiable, Sendable {
        public var id: String
        public var name: String
        public var symbol: String
        public var category: String
        public var detail: String
        /// `#NAME#` is replaced with the script name.
        public var body: String

        public func render(name: String) -> String {
            body.replacingOccurrences(of: "#NAME#", with: TextUtil.csharpIdentifier(from: name))
        }
    }

    public static let all: [Template] = [
        Template(id: "mono", name: "MonoBehaviour", symbol: "cube", category: "", detail: "Standard-Komponente mit Awake/Start/Update",
                 body: """
        using UnityEngine;

        public class #NAME# : MonoBehaviour
        {
            private void Awake()
            {
            }

            private void Start()
            {
            }

            private void Update()
            {
            }
        }

        """),
        Template(id: "so", name: "ScriptableObject", symbol: "shippingbox", category: "Data / ScriptableObject", detail: "Daten-Asset mit CreateAssetMenu",
                 body: """
        using UnityEngine;

        [CreateAssetMenu(fileName = "#NAME#", menuName = "Game/#NAME#")]
        public class #NAME# : ScriptableObject
        {
            [SerializeField] private string displayName;
            [SerializeField, TextArea] private string description;

            public string DisplayName => displayName;
            public string Description => description;
        }

        """),
        Template(id: "player", name: "Player Controller (CharacterController)", symbol: "figure.walk", category: "Player Controller", detail: "Bewegung, Sprung, Schwerkraft",
                 body: """
        using UnityEngine;

        [RequireComponent(typeof(CharacterController))]
        public class #NAME# : MonoBehaviour
        {
            [Header("Movement")]
            [SerializeField] private float moveSpeed = 5f;
            [SerializeField] private float jumpHeight = 1.2f;
            [SerializeField] private float gravity = -9.81f;

            private CharacterController controller;
            private Vector3 velocity;

            private void Awake()
            {
                controller = GetComponent<CharacterController>();
            }

            private void Update()
            {
                bool grounded = controller.isGrounded;
                if (grounded && velocity.y < 0f)
                {
                    velocity.y = -2f;
                }

                Vector3 input = new Vector3(Input.GetAxisRaw("Horizontal"), 0f, Input.GetAxisRaw("Vertical"));
                Vector3 move = transform.TransformDirection(Vector3.ClampMagnitude(input, 1f));
                controller.Move(move * moveSpeed * Time.deltaTime);

                if (grounded && Input.GetButtonDown("Jump"))
                {
                    velocity.y = Mathf.Sqrt(jumpHeight * -2f * gravity);
                }

                velocity.y += gravity * Time.deltaTime;
                controller.Move(velocity * Time.deltaTime);
            }
        }

        """),
        Template(id: "enemy", name: "Enemy AI (NavMesh)", symbol: "eye", category: "Enemy AI", detail: "Patrouille, Verfolgung, Angriff mit NavMeshAgent",
                 body: """
        using UnityEngine;
        using UnityEngine.AI;

        [RequireComponent(typeof(NavMeshAgent))]
        public class #NAME# : MonoBehaviour
        {
            private enum State { Patrol, Chase, Attack }

            [SerializeField] private Transform[] patrolPoints;
            [SerializeField] private Transform target;
            [SerializeField] private float sightRange = 12f;
            [SerializeField] private float attackRange = 2f;

            private NavMeshAgent agent;
            private State state = State.Patrol;
            private int patrolIndex;

            private void Awake()
            {
                agent = GetComponent<NavMeshAgent>();
            }

            private void Update()
            {
                float distance = target != null ? Vector3.Distance(transform.position, target.position) : float.MaxValue;
                state = distance <= attackRange ? State.Attack : distance <= sightRange ? State.Chase : State.Patrol;

                switch (state)
                {
                    case State.Patrol:
                        Patrol();
                        break;
                    case State.Chase:
                        agent.isStopped = false;
                        agent.SetDestination(target.position);
                        break;
                    case State.Attack:
                        agent.isStopped = true;
                        transform.LookAt(new Vector3(target.position.x, transform.position.y, target.position.z));
                        break;
                }
            }

            private void Patrol()
            {
                if (patrolPoints == null || patrolPoints.Length == 0) return;
                agent.isStopped = false;
                if (!agent.pathPending && agent.remainingDistance < 0.5f)
                {
                    patrolIndex = (patrolIndex + 1) % patrolPoints.Length;
                    agent.SetDestination(patrolPoints[patrolIndex].position);
                }
            }

            private void OnDrawGizmosSelected()
            {
                Gizmos.color = Color.yellow;
                Gizmos.DrawWireSphere(transform.position, sightRange);
                Gizmos.color = Color.red;
                Gizmos.DrawWireSphere(transform.position, attackRange);
            }
        }

        """),
        Template(id: "interact", name: "Interaction (Trigger + Interface)", symbol: "hand.tap", category: "Interactions", detail: "IInteractable mit Trigger-Erkennung",
                 body: """
        using UnityEngine;
        using UnityEngine.Events;

        public interface IInteractable
        {
            string Prompt { get; }
            void Interact(GameObject interactor);
        }

        public class #NAME# : MonoBehaviour, IInteractable
        {
            [SerializeField] private string prompt = "Benutzen";
            [SerializeField] private UnityEvent onInteract;

            public string Prompt => prompt;

            public void Interact(GameObject interactor)
            {
                onInteract?.Invoke();
            }

            private void OnTriggerEnter(Collider other)
            {
                if (other.CompareTag("Player"))
                {
                    Debug.Log($"[{name}] {prompt}");
                }
            }
        }

        """),
        Template(id: "singleton", name: "Singleton Manager", symbol: "crown", category: "Utilities", detail: "Persistenter Manager mit DontDestroyOnLoad",
                 body: """
        using UnityEngine;

        public class #NAME# : MonoBehaviour
        {
            public static #NAME# Instance { get; private set; }

            private void Awake()
            {
                if (Instance != null && Instance != this)
                {
                    Destroy(gameObject);
                    return;
                }
                Instance = this;
                DontDestroyOnLoad(gameObject);
            }
        }

        """),
        Template(id: "events", name: "Event Channel (ScriptableObject)", symbol: "dot.radiowaves.left.and.right", category: "Events", detail: "Entkoppelte Events über Assets",
                 body: """
        using System;
        using UnityEngine;

        [CreateAssetMenu(menuName = "Events/#NAME#")]
        public class #NAME# : ScriptableObject
        {
            public event Action<int> Raised;

            public void Raise(int value)
            {
                Raised?.Invoke(value);
            }
        }

        """),
        Template(id: "input", name: "Input System Handler", symbol: "gamecontroller", category: "Input System", detail: "Neues Input System mit InputActionReference",
                 body: """
        using UnityEngine;
        using UnityEngine.InputSystem;

        public class #NAME# : MonoBehaviour
        {
            [SerializeField] private InputActionReference moveAction;
            [SerializeField] private InputActionReference jumpAction;

            public Vector2 Move { get; private set; }

            private void OnEnable()
            {
                moveAction.action.Enable();
                jumpAction.action.Enable();
                jumpAction.action.performed += OnJump;
            }

            private void OnDisable()
            {
                jumpAction.action.performed -= OnJump;
                moveAction.action.Disable();
                jumpAction.action.Disable();
            }

            private void Update()
            {
                Move = moveAction.action.ReadValue<Vector2>();
            }

            private void OnJump(InputAction.CallbackContext context)
            {
                Debug.Log("Jump");
            }
        }

        """),
        Template(id: "editor", name: "Custom Inspector (Editor)", symbol: "slider.horizontal.3", category: "Editor Tool", detail: "Gehört in einen Ordner 'Editor'",
                 body: """
        using UnityEditor;
        using UnityEngine;

        [CustomEditor(typeof(MonoBehaviour), true)]
        public class #NAME# : Editor
        {
            public override void OnInspectorGUI()
            {
                DrawDefaultInspector();
                EditorGUILayout.Space();
                if (GUILayout.Button("Aktion ausführen"))
                {
                    Debug.Log($"Clicked on {target.name}");
                }
            }
        }

        """),
        Template(id: "plain", name: "Leere C#-Klasse", symbol: "curlybraces", category: "", detail: "Reine C#-Klasse ohne Unity-Basis",
                 body: """
        using System;

        [Serializable]
        public class #NAME#
        {
        }

        """)
    ]

    public struct Snippet: Identifiable, Sendable {
        public var id: String { title }
        public var title: String
        public var code: String
    }

    /// Insertable snippets. `$0` marks the caret position after insertion.
    public static let snippets: [Snippet] = [
        Snippet(title: "Update()", code: "private void Update()\n{\n    $0\n}"),
        Snippet(title: "FixedUpdate()", code: "private void FixedUpdate()\n{\n    $0\n}"),
        Snippet(title: "Coroutine", code: "private IEnumerator Routine()\n{\n    $0\n    yield return null;\n}"),
        Snippet(title: "OnTriggerEnter", code: "private void OnTriggerEnter(Collider other)\n{\n    if (other.CompareTag(\"Player\"))\n    {\n        $0\n    }\n}"),
        Snippet(title: "OnCollisionEnter", code: "private void OnCollisionEnter(Collision collision)\n{\n    $0\n}"),
        Snippet(title: "[SerializeField]", code: "[SerializeField] private $0"),
        Snippet(title: "Header", code: "[Header(\"$0\")]"),
        Snippet(title: "GetComponent (Awake)", code: "private void Awake()\n{\n    $0 = GetComponent<>();\n}"),
        Snippet(title: "Raycast", code: "if (Physics.Raycast(transform.position, transform.forward, out RaycastHit hit, 10f))\n{\n    $0\n}"),
        Snippet(title: "WaitForSeconds", code: "yield return new WaitForSeconds($0);"),
        Snippet(title: "Debug.Log", code: "Debug.Log($\"$0\");"),
        Snippet(title: "event Action", code: "public event Action<$0> OnChanged;"),
        Snippet(title: "Property", code: "public $0 Value { get; private set; }"),
        Snippet(title: "#if UNITY_EDITOR", code: "#if UNITY_EDITOR\n$0\n#endif"),
        Snippet(title: "Singleton Instance", code: "public static $0 Instance { get; private set; }")
    ]
}
