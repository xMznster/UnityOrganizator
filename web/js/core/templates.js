// Unity script templates & snippets (generated from UnityTemplates.swift by tools/port_templates.py logic).
export const TEMPLATES = [
 {
  "id": "mono",
  "name": "MonoBehaviour",
  "symbol": "cube",
  "category": "",
  "detail": "Standard-Komponente mit Awake/Start/Update",
  "body": "using UnityEngine;\n\npublic class #NAME# : MonoBehaviour\n{\n    private void Awake()\n    {\n    }\n\n    private void Start()\n    {\n    }\n\n    private void Update()\n    {\n    }\n}\n"
 },
 {
  "id": "so",
  "name": "ScriptableObject",
  "symbol": "shippingbox",
  "category": "Data / ScriptableObject",
  "detail": "Daten-Asset mit CreateAssetMenu",
  "body": "using UnityEngine;\n\n[CreateAssetMenu(fileName = \"#NAME#\", menuName = \"Game/#NAME#\")]\npublic class #NAME# : ScriptableObject\n{\n    [SerializeField] private string displayName;\n    [SerializeField, TextArea] private string description;\n\n    public string DisplayName => displayName;\n    public string Description => description;\n}\n"
 },
 {
  "id": "player",
  "name": "Player Controller (CharacterController)",
  "symbol": "figure.walk",
  "category": "Player Controller",
  "detail": "Bewegung, Sprung, Schwerkraft",
  "body": "using UnityEngine;\n\n[RequireComponent(typeof(CharacterController))]\npublic class #NAME# : MonoBehaviour\n{\n    [Header(\"Movement\")]\n    [SerializeField] private float moveSpeed = 5f;\n    [SerializeField] private float jumpHeight = 1.2f;\n    [SerializeField] private float gravity = -9.81f;\n\n    private CharacterController controller;\n    private Vector3 velocity;\n\n    private void Awake()\n    {\n        controller = GetComponent<CharacterController>();\n    }\n\n    private void Update()\n    {\n        bool grounded = controller.isGrounded;\n        if (grounded && velocity.y < 0f)\n        {\n            velocity.y = -2f;\n        }\n\n        Vector3 input = new Vector3(Input.GetAxisRaw(\"Horizontal\"), 0f, Input.GetAxisRaw(\"Vertical\"));\n        Vector3 move = transform.TransformDirection(Vector3.ClampMagnitude(input, 1f));\n        controller.Move(move * moveSpeed * Time.deltaTime);\n\n        if (grounded && Input.GetButtonDown(\"Jump\"))\n        {\n            velocity.y = Mathf.Sqrt(jumpHeight * -2f * gravity);\n        }\n\n        velocity.y += gravity * Time.deltaTime;\n        controller.Move(velocity * Time.deltaTime);\n    }\n}\n"
 },
 {
  "id": "enemy",
  "name": "Enemy AI (NavMesh)",
  "symbol": "eye",
  "category": "Enemy AI",
  "detail": "Patrouille, Verfolgung, Angriff mit NavMeshAgent",
  "body": "using UnityEngine;\nusing UnityEngine.AI;\n\n[RequireComponent(typeof(NavMeshAgent))]\npublic class #NAME# : MonoBehaviour\n{\n    private enum State { Patrol, Chase, Attack }\n\n    [SerializeField] private Transform[] patrolPoints;\n    [SerializeField] private Transform target;\n    [SerializeField] private float sightRange = 12f;\n    [SerializeField] private float attackRange = 2f;\n\n    private NavMeshAgent agent;\n    private State state = State.Patrol;\n    private int patrolIndex;\n\n    private void Awake()\n    {\n        agent = GetComponent<NavMeshAgent>();\n    }\n\n    private void Update()\n    {\n        float distance = target != null ? Vector3.Distance(transform.position, target.position) : float.MaxValue;\n        state = distance <= attackRange ? State.Attack : distance <= sightRange ? State.Chase : State.Patrol;\n\n        switch (state)\n        {\n            case State.Patrol:\n                Patrol();\n                break;\n            case State.Chase:\n                agent.isStopped = false;\n                agent.SetDestination(target.position);\n                break;\n            case State.Attack:\n                agent.isStopped = true;\n                transform.LookAt(new Vector3(target.position.x, transform.position.y, target.position.z));\n                break;\n        }\n    }\n\n    private void Patrol()\n    {\n        if (patrolPoints == null || patrolPoints.Length == 0) return;\n        agent.isStopped = false;\n        if (!agent.pathPending && agent.remainingDistance < 0.5f)\n        {\n            patrolIndex = (patrolIndex + 1) % patrolPoints.Length;\n            agent.SetDestination(patrolPoints[patrolIndex].position);\n        }\n    }\n\n    private void OnDrawGizmosSelected()\n    {\n        Gizmos.color = Color.yellow;\n        Gizmos.DrawWireSphere(transform.position, sightRange);\n        Gizmos.color = Color.red;\n        Gizmos.DrawWireSphere(transform.position, attackRange);\n    }\n}\n"
 },
 {
  "id": "interact",
  "name": "Interaction (Trigger + Interface)",
  "symbol": "hand.tap",
  "category": "Interactions",
  "detail": "IInteractable mit Trigger-Erkennung",
  "body": "using UnityEngine;\nusing UnityEngine.Events;\n\npublic interface IInteractable\n{\n    string Prompt { get; }\n    void Interact(GameObject interactor);\n}\n\npublic class #NAME# : MonoBehaviour, IInteractable\n{\n    [SerializeField] private string prompt = \"Benutzen\";\n    [SerializeField] private UnityEvent onInteract;\n\n    public string Prompt => prompt;\n\n    public void Interact(GameObject interactor)\n    {\n        onInteract?.Invoke();\n    }\n\n    private void OnTriggerEnter(Collider other)\n    {\n        if (other.CompareTag(\"Player\"))\n        {\n            Debug.Log($\"[{name}] {prompt}\");\n        }\n    }\n}\n"
 },
 {
  "id": "singleton",
  "name": "Singleton Manager",
  "symbol": "crown",
  "category": "Utilities",
  "detail": "Persistenter Manager mit DontDestroyOnLoad",
  "body": "using UnityEngine;\n\npublic class #NAME# : MonoBehaviour\n{\n    public static #NAME# Instance { get; private set; }\n\n    private void Awake()\n    {\n        if (Instance != null && Instance != this)\n        {\n            Destroy(gameObject);\n            return;\n        }\n        Instance = this;\n        DontDestroyOnLoad(gameObject);\n    }\n}\n"
 },
 {
  "id": "events",
  "name": "Event Channel (ScriptableObject)",
  "symbol": "dot.radiowaves.left.and.right",
  "category": "Events",
  "detail": "Entkoppelte Events über Assets",
  "body": "using System;\nusing UnityEngine;\n\n[CreateAssetMenu(menuName = \"Events/#NAME#\")]\npublic class #NAME# : ScriptableObject\n{\n    public event Action<int> Raised;\n\n    public void Raise(int value)\n    {\n        Raised?.Invoke(value);\n    }\n}\n"
 },
 {
  "id": "input",
  "name": "Input System Handler",
  "symbol": "gamecontroller",
  "category": "Input System",
  "detail": "Neues Input System mit InputActionReference",
  "body": "using UnityEngine;\nusing UnityEngine.InputSystem;\n\npublic class #NAME# : MonoBehaviour\n{\n    [SerializeField] private InputActionReference moveAction;\n    [SerializeField] private InputActionReference jumpAction;\n\n    public Vector2 Move { get; private set; }\n\n    private void OnEnable()\n    {\n        moveAction.action.Enable();\n        jumpAction.action.Enable();\n        jumpAction.action.performed += OnJump;\n    }\n\n    private void OnDisable()\n    {\n        jumpAction.action.performed -= OnJump;\n        moveAction.action.Disable();\n        jumpAction.action.Disable();\n    }\n\n    private void Update()\n    {\n        Move = moveAction.action.ReadValue<Vector2>();\n    }\n\n    private void OnJump(InputAction.CallbackContext context)\n    {\n        Debug.Log(\"Jump\");\n    }\n}\n"
 },
 {
  "id": "editor",
  "name": "Custom Inspector (Editor)",
  "symbol": "slider.horizontal.3",
  "category": "Editor Tool",
  "detail": "Gehört in einen Ordner 'Editor'",
  "body": "using UnityEditor;\nusing UnityEngine;\n\n[CustomEditor(typeof(MonoBehaviour), true)]\npublic class #NAME# : Editor\n{\n    public override void OnInspectorGUI()\n    {\n        DrawDefaultInspector();\n        EditorGUILayout.Space();\n        if (GUILayout.Button(\"Aktion ausführen\"))\n        {\n            Debug.Log($\"Clicked on {target.name}\");\n        }\n    }\n}\n"
 },
 {
  "id": "plain",
  "name": "Leere C#-Klasse",
  "symbol": "curlybraces",
  "category": "",
  "detail": "Reine C#-Klasse ohne Unity-Basis",
  "body": "using System;\n\n[Serializable]\npublic class #NAME#\n{\n}\n"
 }
];

export const SNIPPETS = [
 {
  "title": "Update()",
  "code": "private void Update()\n{\n    $0\n}"
 },
 {
  "title": "FixedUpdate()",
  "code": "private void FixedUpdate()\n{\n    $0\n}"
 },
 {
  "title": "Coroutine",
  "code": "private IEnumerator Routine()\n{\n    $0\n    yield return null;\n}"
 },
 {
  "title": "OnTriggerEnter",
  "code": "private void OnTriggerEnter(Collider other)\n{\n    if (other.CompareTag(\"Player\"))\n    {\n        $0\n    }\n}"
 },
 {
  "title": "OnCollisionEnter",
  "code": "private void OnCollisionEnter(Collision collision)\n{\n    $0\n}"
 },
 {
  "title": "[SerializeField]",
  "code": "[SerializeField] private $0"
 },
 {
  "title": "Header",
  "code": "[Header(\"$0\")]"
 },
 {
  "title": "GetComponent (Awake)",
  "code": "private void Awake()\n{\n    $0 = GetComponent<>();\n}"
 },
 {
  "title": "Raycast",
  "code": "if (Physics.Raycast(transform.position, transform.forward, out RaycastHit hit, 10f))\n{\n    $0\n}"
 },
 {
  "title": "WaitForSeconds",
  "code": "yield return new WaitForSeconds($0);"
 },
 {
  "title": "Debug.Log",
  "code": "Debug.Log($\"$0\");"
 },
 {
  "title": "event Action",
  "code": "public event Action<$0> OnChanged;"
 },
 {
  "title": "Property",
  "code": "public $0 Value { get; private set; }"
 },
 {
  "title": "#if UNITY_EDITOR",
  "code": "#if UNITY_EDITOR\n$0\n#endif"
 },
 {
  "title": "Singleton Instance",
  "code": "public static $0 Instance { get; private set; }"
 }
];

export function csharpIdentifier(s) {
  let id = String(s).split(/[^\p{L}\p{N}_]+/u).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");
  id = id.replace(/[^\x00-\x7F]/g, "");
  if (!id) id = "NewScript";
  if (/^[0-9]/.test(id)) id = "_" + id;
  return id;
}

export const renderTemplate = (t, name) => t.body.replaceAll("#NAME#", csharpIdentifier(name));
