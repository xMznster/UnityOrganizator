import Foundation

/// Static knowledge about the Unity API surface that is relevant for highlighting,
/// analysis and script classification. This is *real* reference data (not demo content).
public enum UnityCatalog {

    /// Unity message (magic method) signatures: name -> allowed parameter type lists.
    /// An empty inner array means "no parameters".
    public static let messages: [String: [[String]]] = [
        "Awake": [[]], "Start": [[]], "Update": [[]], "FixedUpdate": [[]], "LateUpdate": [[]],
        "OnEnable": [[]], "OnDisable": [[]], "OnDestroy": [[]], "OnValidate": [[]], "Reset": [[]],
        "OnGUI": [[]], "OnDrawGizmos": [[]], "OnDrawGizmosSelected": [[]],
        "OnApplicationQuit": [[]], "OnApplicationPause": [["bool"]], "OnApplicationFocus": [["bool"]],
        "OnBecameVisible": [[]], "OnBecameInvisible": [[]],
        "OnCollisionEnter": [["Collision"], []], "OnCollisionStay": [["Collision"], []], "OnCollisionExit": [["Collision"], []],
        "OnCollisionEnter2D": [["Collision2D"], []], "OnCollisionStay2D": [["Collision2D"], []], "OnCollisionExit2D": [["Collision2D"], []],
        "OnTriggerEnter": [["Collider"]], "OnTriggerStay": [["Collider"]], "OnTriggerExit": [["Collider"]],
        "OnTriggerEnter2D": [["Collider2D"]], "OnTriggerStay2D": [["Collider2D"]], "OnTriggerExit2D": [["Collider2D"]],
        "OnControllerColliderHit": [["ControllerColliderHit"]],
        "OnParticleCollision": [["GameObject"]], "OnParticleTrigger": [[]],
        "OnMouseDown": [[]], "OnMouseUp": [[]], "OnMouseEnter": [[]], "OnMouseExit": [[]],
        "OnMouseOver": [[]], "OnMouseDrag": [[]], "OnMouseUpAsButton": [[]],
        "OnAnimatorMove": [[]], "OnAnimatorIK": [["int"]],
        "OnTransformParentChanged": [[]], "OnTransformChildrenChanged": [[]],
        "OnRenderObject": [[]], "OnWillRenderObject": [[]], "OnPreRender": [[]], "OnPostRender": [[]],
        "OnRenderImage": [["RenderTexture", "RenderTexture"]],
        "OnJointBreak": [["float"]], "OnJointBreak2D": [["Joint2D"]],
        "OnRectTransformDimensionsChange": [[]], "OnCanvasGroupChanged": [[]]
    ]

    /// Messages that may be declared as coroutines (returning IEnumerator).
    public static let coroutineMessages: Set<String> = [
        "Start", "OnCollisionEnter", "OnCollisionStay", "OnCollisionExit",
        "OnCollisionEnter2D", "OnCollisionStay2D", "OnCollisionExit2D",
        "OnTriggerEnter", "OnTriggerStay", "OnTriggerExit",
        "OnTriggerEnter2D", "OnTriggerStay2D", "OnTriggerExit2D",
        "OnBecameVisible", "OnBecameInvisible", "OnMouseDown", "OnMouseUp", "OnMouseEnter",
        "OnMouseExit", "OnMouseOver", "OnMouseDrag", "OnMouseUpAsButton"
    ]

    /// Messages called every frame (or every physics step / GUI event).
    public static let frameMessages: Set<String> = ["Update", "LateUpdate", "FixedUpdate", "OnGUI"]

    /// Type -> namespace that must be imported for it.
    public static let typeNamespaces: [String: String] = {
        var map: [String: String] = [:]
        for t in unityEngineTypes { map[t] = "UnityEngine" }
        for t in ["NavMeshAgent", "NavMesh", "NavMeshHit", "NavMeshPath", "NavMeshObstacle", "NavMeshPathStatus", "OffMeshLinkData", "NavMeshSurface", "NavMeshLink", "NavMeshModifier"] { map[t] = "UnityEngine.AI" }
        for t in ["Image", "Button", "Text", "Slider", "Toggle", "Scrollbar", "ScrollRect", "Dropdown", "InputField", "RawImage", "Mask", "RectMask2D", "LayoutGroup", "HorizontalLayoutGroup", "VerticalLayoutGroup", "GridLayoutGroup", "ContentSizeFitter", "CanvasScaler", "GraphicRaycaster", "Selectable", "Outline", "Shadow", "LayoutElement", "AspectRatioFitter"] { map[t] = "UnityEngine.UI" }
        for t in ["TextMeshProUGUI", "TextMeshPro", "TMP_Text", "TMP_InputField", "TMP_Dropdown", "TMP_FontAsset"] { map[t] = "TMPro" }
        for t in ["InputAction", "InputActionAsset", "InputActionMap", "InputActionReference", "PlayerInput", "InputValue", "Keyboard", "Mouse", "Gamepad", "Touchscreen", "InputSystem", "InputDevice", "InputActionPhase"] { map[t] = "UnityEngine.InputSystem" }
        for t in ["SceneManager", "Scene", "LoadSceneMode"] { map[t] = "UnityEngine.SceneManagement" }
        for t in ["UnityEvent", "UnityAction"] { map[t] = "UnityEngine.Events" }
        for t in ["EventSystem", "PointerEventData", "IPointerClickHandler", "IPointerDownHandler", "IPointerUpHandler", "IPointerEnterHandler", "IPointerExitHandler", "IDragHandler", "IBeginDragHandler", "IEndDragHandler", "BaseEventData"] { map[t] = "UnityEngine.EventSystems" }
        for t in ["AudioMixer", "AudioMixerGroup", "AudioMixerSnapshot"] { map[t] = "UnityEngine.Audio" }
        for t in ["PlayableDirector", "Playable", "PlayableGraph"] { map[t] = "UnityEngine.Playables" }
        for t in ["Volume", "VolumeProfile"] { map[t] = "UnityEngine.Rendering" }
        for t in ["Tilemap", "TileBase", "Tile"] { map[t] = "UnityEngine.Tilemaps" }
        for t in ["VideoPlayer", "VideoClip"] { map[t] = "UnityEngine.Video" }
        for t in ["Editor", "EditorWindow", "EditorGUILayout", "EditorGUI", "EditorUtility", "AssetDatabase", "SerializedObject", "SerializedProperty", "PropertyDrawer", "CustomEditor", "CustomPropertyDrawer", "MenuItem", "Handles", "Selection", "EditorApplication", "PrefabUtility", "Undo", "EditorPrefs", "EditorSceneManager", "BuildPipeline", "InitializeOnLoad", "ScriptableWizard"] { map[t] = "UnityEditor" }
        for t in ["IEnumerator", "IEnumerable", "ArrayList", "Hashtable"] { map[t] = "System.Collections" }
        for t in ["List", "Dictionary", "HashSet", "Queue", "Stack", "LinkedList", "SortedDictionary", "SortedList", "KeyValuePair", "IReadOnlyList", "IReadOnlyCollection", "IReadOnlyDictionary", "ICollection", "IList", "IDictionary", "ISet", "Comparer", "EqualityComparer"] { map[t] = "System.Collections.Generic" }
        for t in ["Action", "Func", "Predicate", "Exception", "Math", "Random", "Serializable", "NonSerialized", "Guid", "DateTime", "TimeSpan", "Lazy", "Tuple", "Enum", "Array", "Console", "Convert", "EventHandler", "EventArgs", "IDisposable", "IComparable", "Type", "Attribute", "Obsolete", "ArgumentException", "ArgumentNullException", "InvalidOperationException", "NotImplementedException", "Nullable", "StringComparison", "BitConverter"] { map[t] = "System" }
        for t in ["StringBuilder", "Encoding", "Regex"] { map[t] = t == "Regex" ? "System.Text.RegularExpressions" : "System.Text" }
        for t in ["Task", "CancellationToken", "CancellationTokenSource"] { map[t] = t == "Task" ? "System.Threading.Tasks" : "System.Threading" }
        for t in ["File", "Path", "Directory", "StreamReader", "StreamWriter", "FileStream", "MemoryStream"] { map[t] = "System.IO" }
        return map
    }()

    /// Types where both System and UnityEngine define the name -> ambiguous, skip import checks.
    public static let ambiguousTypes: Set<String> = ["Random", "Object", "Debug", "Range", "Text", "Image", "Button", "Tile", "Scene"]

    public static let unityEngineTypes: [String] = [
        "MonoBehaviour", "ScriptableObject", "GameObject", "Transform", "RectTransform", "Component", "Behaviour",
        "Vector2", "Vector3", "Vector4", "Vector2Int", "Vector3Int", "Quaternion", "Matrix4x4", "Color", "Color32",
        "Rigidbody", "Rigidbody2D", "Collider", "Collider2D", "BoxCollider", "SphereCollider", "CapsuleCollider",
        "MeshCollider", "BoxCollider2D", "CircleCollider2D", "CapsuleCollider2D", "PolygonCollider2D", "EdgeCollider2D",
        "CharacterController", "Collision", "Collision2D", "ControllerColliderHit", "RaycastHit", "RaycastHit2D", "Ray", "Ray2D",
        "Physics", "Physics2D", "LayerMask", "Animator", "Animation", "AnimationClip", "AnimationCurve", "RuntimeAnimatorController",
        "AnimatorStateInfo", "AvatarIKGoal", "HumanBodyBones", "AudioSource", "AudioClip", "AudioListener", "Camera", "Light",
        "Renderer", "MeshRenderer", "SkinnedMeshRenderer", "SpriteRenderer", "LineRenderer", "TrailRenderer", "Mesh", "MeshFilter",
        "Material", "Shader", "Texture", "Texture2D", "RenderTexture", "Sprite", "ParticleSystem", "Time", "Input", "KeyCode",
        "Mathf", "Debug", "Application", "Resources", "PlayerPrefs", "Screen", "Cursor", "CursorLockMode", "Coroutine",
        "WaitForSeconds", "WaitForSecondsRealtime", "WaitForFixedUpdate", "WaitForEndOfFrame", "WaitUntil", "WaitWhile",
        "YieldInstruction", "CustomYieldInstruction", "SerializeField", "SerializeReference", "Header", "Tooltip", "Range", "Space", "TextArea",
        "Multiline", "HideInInspector", "RequireComponent", "DisallowMultipleComponent", "ExecuteInEditMode", "ExecuteAlways",
        "CreateAssetMenu", "AddComponentMenu", "ContextMenu", "ContextMenuItem", "ColorUsage", "Gizmos", "GUI", "GUILayout",
        "Bounds", "Rect", "Plane", "ForceMode", "ForceMode2D", "Space", "QueryTriggerInteraction", "Joint", "HingeJoint",
        "FixedJoint", "SpringJoint", "ConfigurableJoint", "Joint2D", "WheelCollider", "Terrain", "Canvas", "CanvasGroup",
        "AsyncOperation", "Object", "Random", "Gradient", "Keyframe", "AnimationEvent", "Avatar", "AvatarMask",
        "LODGroup", "ReflectionProbe", "LightProbes", "Cubemap", "WrapMode", "RigidbodyConstraints", "RigidbodyInterpolation",
        "CollisionDetectionMode", "PhysicMaterial", "PhysicsMaterial", "PhysicsMaterial2D", "SystemInfo", "Handheld", "Touch", "TouchPhase",
        "WebCamTexture", "Microphone", "JsonUtility", "ISerializationCallbackReceiver", "HideFlags", "SendMessageOptions"
    ]

    /// All type names highlighted as types.
    public static let knownTypes: Set<String> = {
        var s = Set(typeNamespaces.keys)
        s.formUnion(["String", "Int32", "Single", "Boolean", "Double", "Object", "IComparer", "IEquatable"])
        return s
    }()

    /// Common component types (used to auto-fill "Verwendete Komponenten").
    public static let componentTypes: Set<String> = [
        "Transform", "RectTransform", "Rigidbody", "Rigidbody2D", "Collider", "Collider2D", "BoxCollider",
        "SphereCollider", "CapsuleCollider", "MeshCollider", "BoxCollider2D", "CircleCollider2D", "CapsuleCollider2D",
        "PolygonCollider2D", "CharacterController", "Animator", "Animation", "AudioSource", "AudioListener", "Camera",
        "Light", "Renderer", "MeshRenderer", "SkinnedMeshRenderer", "SpriteRenderer", "LineRenderer", "TrailRenderer",
        "MeshFilter", "ParticleSystem", "NavMeshAgent", "NavMeshObstacle", "Canvas", "CanvasGroup", "Image", "Button",
        "Text", "TextMeshProUGUI", "TextMeshPro", "Slider", "Toggle", "PlayerInput", "HingeJoint", "FixedJoint",
        "SpringJoint", "ConfigurableJoint", "WheelCollider", "Terrain", "LODGroup", "PlayableDirector", "VideoPlayer",
        "Tilemap", "Volume"
    ]

    /// Members that are expensive when called every frame.
    public static let expensiveFrameCalls: [String: String] = [
        "GetComponent": "GetComponent", "GetComponents": "GetComponents", "GetComponentInChildren": "GetComponentInChildren",
        "GetComponentInParent": "GetComponentInParent", "GetComponentsInChildren": "GetComponentsInChildren",
        "FindObjectOfType": "FindObjectOfType", "FindObjectsOfType": "FindObjectsOfType",
        "FindFirstObjectByType": "FindFirstObjectByType", "FindAnyObjectByType": "FindAnyObjectByType",
        "FindObjectsByType": "FindObjectsByType", "FindWithTag": "GameObject.FindWithTag",
        "FindGameObjectWithTag": "GameObject.FindGameObjectWithTag", "FindGameObjectsWithTag": "GameObject.FindGameObjectsWithTag",
        "SendMessage": "SendMessage", "BroadcastMessage": "BroadcastMessage", "AddComponent": "AddComponent"
    ]

    /// Struct-typed properties whose fields cannot be assigned directly (CS1612).
    public static let structProperties: Set<String> = [
        "position", "localPosition", "eulerAngles", "localEulerAngles", "localScale", "velocity",
        "angularVelocity", "rotation", "localRotation", "anchoredPosition", "sizeDelta", "pivot",
        "anchorMin", "anchorMax", "center", "size", "color", "offset", "linearVelocity", "forward", "up", "right"
    ]
    public static let structFields: Set<String> = ["x", "y", "z", "w", "r", "g", "b", "a"]

    public static let rigidbodyCalls: Set<String> = ["AddForce", "AddTorque", "AddForceAtPosition", "AddRelativeForce", "AddRelativeTorque", "MovePosition", "MoveRotation", "AddExplosionForce"]
    public static let legacyInputCalls: Set<String> = ["GetKey", "GetKeyDown", "GetKeyUp", "GetAxis", "GetAxisRaw", "GetButton", "GetButtonDown", "GetButtonUp", "GetMouseButton", "GetMouseButtonDown", "GetMouseButtonUp"]
    public static let linqMethods: Set<String> = ["Where", "Select", "SelectMany", "OrderBy", "OrderByDescending", "ThenBy", "ToList", "ToArray", "ToDictionary", "First", "FirstOrDefault", "Last", "LastOrDefault", "Any", "All", "Sum", "Average", "Min", "Max", "Distinct", "GroupBy", "Skip", "Take", "Aggregate", "SequenceEqual", "Zip", "Except", "Intersect", "Union", "OfType", "Cast", "Single", "SingleOrDefault"]

    /// Base types that make a class "Unity-managed" (receives messages).
    public static let behaviourBases: Set<String> = ["MonoBehaviour", "NetworkBehaviour", "StateMachineBehaviour", "UIBehaviour", "Behaviour"]
    public static let editorBases: Set<String> = ["Editor", "EditorWindow", "PropertyDrawer", "ScriptableWizard", "AssetPostprocessor", "DecoratorDrawer", "ShaderGUI"]
}
