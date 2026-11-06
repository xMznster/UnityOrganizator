// Unity API knowledge used for highlighting, analysis and classification (port of UnityCatalog.swift).

export const messages = {
  Awake: [[]], Start: [[]], Update: [[]], FixedUpdate: [[]], LateUpdate: [[]],
  OnEnable: [[]], OnDisable: [[]], OnDestroy: [[]], OnValidate: [[]], Reset: [[]],
  OnGUI: [[]], OnDrawGizmos: [[]], OnDrawGizmosSelected: [[]],
  OnApplicationQuit: [[]], OnApplicationPause: [["bool"]], OnApplicationFocus: [["bool"]],
  OnBecameVisible: [[]], OnBecameInvisible: [[]],
  OnCollisionEnter: [["Collision"], []], OnCollisionStay: [["Collision"], []], OnCollisionExit: [["Collision"], []],
  OnCollisionEnter2D: [["Collision2D"], []], OnCollisionStay2D: [["Collision2D"], []], OnCollisionExit2D: [["Collision2D"], []],
  OnTriggerEnter: [["Collider"]], OnTriggerStay: [["Collider"]], OnTriggerExit: [["Collider"]],
  OnTriggerEnter2D: [["Collider2D"]], OnTriggerStay2D: [["Collider2D"]], OnTriggerExit2D: [["Collider2D"]],
  OnControllerColliderHit: [["ControllerColliderHit"]],
  OnParticleCollision: [["GameObject"]], OnParticleTrigger: [[]],
  OnMouseDown: [[]], OnMouseUp: [[]], OnMouseEnter: [[]], OnMouseExit: [[]], OnMouseOver: [[]], OnMouseDrag: [[]], OnMouseUpAsButton: [[]],
  OnAnimatorMove: [[]], OnAnimatorIK: [["int"]],
  OnTransformParentChanged: [[]], OnTransformChildrenChanged: [[]],
  OnRenderObject: [[]], OnWillRenderObject: [[]], OnPreRender: [[]], OnPostRender: [[]],
  OnRenderImage: [["RenderTexture", "RenderTexture"]],
  OnJointBreak: [["float"]], OnJointBreak2D: [["Joint2D"]],
  OnRectTransformDimensionsChange: [[]], OnCanvasGroupChanged: [[]],
};

export const coroutineMessages = new Set(["Start", "OnCollisionEnter", "OnCollisionStay", "OnCollisionExit",
  "OnCollisionEnter2D", "OnCollisionStay2D", "OnCollisionExit2D", "OnTriggerEnter", "OnTriggerStay", "OnTriggerExit",
  "OnTriggerEnter2D", "OnTriggerStay2D", "OnTriggerExit2D", "OnBecameVisible", "OnBecameInvisible", "OnMouseDown",
  "OnMouseUp", "OnMouseEnter", "OnMouseExit", "OnMouseOver", "OnMouseDrag", "OnMouseUpAsButton"]);

export const frameMessages = new Set(["Update", "LateUpdate", "FixedUpdate", "OnGUI"]);

export const unityEngineTypes = ["MonoBehaviour", "ScriptableObject", "GameObject", "Transform", "RectTransform", "Component", "Behaviour",
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
  "Bounds", "Rect", "Plane", "ForceMode", "ForceMode2D", "QueryTriggerInteraction", "Joint", "HingeJoint",
  "FixedJoint", "SpringJoint", "ConfigurableJoint", "Joint2D", "WheelCollider", "Terrain", "Canvas", "CanvasGroup",
  "AsyncOperation", "Object", "Random", "Gradient", "Keyframe", "AnimationEvent", "Avatar", "AvatarMask",
  "LODGroup", "ReflectionProbe", "LightProbes", "Cubemap", "WrapMode", "RigidbodyConstraints", "RigidbodyInterpolation",
  "CollisionDetectionMode", "PhysicMaterial", "PhysicsMaterial", "PhysicsMaterial2D", "SystemInfo", "Handheld", "Touch", "TouchPhase",
  "WebCamTexture", "Microphone", "JsonUtility", "ISerializationCallbackReceiver", "HideFlags", "SendMessageOptions"];

export const typeNamespaces = (() => {
  const m = {};
  const add = (ns, list) => { for (const t of list) m[t] = ns; };
  add("UnityEngine", unityEngineTypes);
  add("UnityEngine.AI", ["NavMeshAgent", "NavMesh", "NavMeshHit", "NavMeshPath", "NavMeshObstacle", "NavMeshPathStatus", "OffMeshLinkData", "NavMeshSurface", "NavMeshLink", "NavMeshModifier"]);
  add("UnityEngine.UI", ["Image", "Button", "Text", "Slider", "Toggle", "Scrollbar", "ScrollRect", "Dropdown", "InputField", "RawImage", "Mask", "RectMask2D", "LayoutGroup", "HorizontalLayoutGroup", "VerticalLayoutGroup", "GridLayoutGroup", "ContentSizeFitter", "CanvasScaler", "GraphicRaycaster", "Selectable", "Outline", "Shadow", "LayoutElement", "AspectRatioFitter"]);
  add("TMPro", ["TextMeshProUGUI", "TextMeshPro", "TMP_Text", "TMP_InputField", "TMP_Dropdown", "TMP_FontAsset"]);
  add("UnityEngine.InputSystem", ["InputAction", "InputActionAsset", "InputActionMap", "InputActionReference", "PlayerInput", "InputValue", "Keyboard", "Mouse", "Gamepad", "Touchscreen", "InputSystem", "InputDevice", "InputActionPhase"]);
  add("UnityEngine.SceneManagement", ["SceneManager", "Scene", "LoadSceneMode"]);
  add("UnityEngine.Events", ["UnityEvent", "UnityAction"]);
  add("UnityEngine.EventSystems", ["EventSystem", "PointerEventData", "IPointerClickHandler", "IPointerDownHandler", "IPointerUpHandler", "IPointerEnterHandler", "IPointerExitHandler", "IDragHandler", "IBeginDragHandler", "IEndDragHandler", "BaseEventData"]);
  add("UnityEngine.Audio", ["AudioMixer", "AudioMixerGroup", "AudioMixerSnapshot"]);
  add("UnityEngine.Playables", ["PlayableDirector", "Playable", "PlayableGraph"]);
  add("UnityEngine.Rendering", ["Volume", "VolumeProfile"]);
  add("UnityEngine.Tilemaps", ["Tilemap", "TileBase", "Tile"]);
  add("UnityEngine.Video", ["VideoPlayer", "VideoClip"]);
  add("UnityEditor", ["Editor", "EditorWindow", "EditorGUILayout", "EditorGUI", "EditorUtility", "AssetDatabase", "SerializedObject", "SerializedProperty", "PropertyDrawer", "CustomEditor", "CustomPropertyDrawer", "MenuItem", "Handles", "Selection", "EditorApplication", "PrefabUtility", "Undo", "EditorPrefs", "EditorSceneManager", "BuildPipeline", "InitializeOnLoad", "ScriptableWizard"]);
  add("System.Collections", ["IEnumerator", "IEnumerable", "ArrayList", "Hashtable"]);
  add("System.Collections.Generic", ["List", "Dictionary", "HashSet", "Queue", "Stack", "LinkedList", "SortedDictionary", "SortedList", "KeyValuePair", "IReadOnlyList", "IReadOnlyCollection", "IReadOnlyDictionary", "ICollection", "IList", "IDictionary", "ISet", "Comparer", "EqualityComparer"]);
  add("System", ["Action", "Func", "Predicate", "Exception", "Math", "Random", "Serializable", "NonSerialized", "Guid", "DateTime", "TimeSpan", "Lazy", "Tuple", "Enum", "Array", "Console", "Convert", "EventHandler", "EventArgs", "IDisposable", "IComparable", "Type", "Attribute", "Obsolete", "ArgumentException", "ArgumentNullException", "InvalidOperationException", "NotImplementedException", "Nullable", "StringComparison", "BitConverter"]);
  add("System.Text", ["StringBuilder", "Encoding"]);
  add("System.Text.RegularExpressions", ["Regex"]);
  add("System.Threading.Tasks", ["Task"]);
  add("System.Threading", ["CancellationToken", "CancellationTokenSource"]);
  add("System.IO", ["File", "Path", "Directory", "StreamReader", "StreamWriter", "FileStream", "MemoryStream"]);
  return m;
})();

export const ambiguousTypes = new Set(["Random", "Object", "Debug", "Range", "Text", "Image", "Button", "Tile", "Scene"]);
export const knownTypes = new Set([...Object.keys(typeNamespaces), "String", "Int32", "Single", "Boolean", "Double", "IComparer", "IEquatable"]);

export const componentTypes = new Set(["Transform", "RectTransform", "Rigidbody", "Rigidbody2D", "Collider", "Collider2D", "BoxCollider",
  "SphereCollider", "CapsuleCollider", "MeshCollider", "BoxCollider2D", "CircleCollider2D", "CapsuleCollider2D",
  "PolygonCollider2D", "CharacterController", "Animator", "Animation", "AudioSource", "AudioListener", "Camera",
  "Light", "Renderer", "MeshRenderer", "SkinnedMeshRenderer", "SpriteRenderer", "LineRenderer", "TrailRenderer",
  "MeshFilter", "ParticleSystem", "NavMeshAgent", "NavMeshObstacle", "Canvas", "CanvasGroup", "Image", "Button",
  "Text", "TextMeshProUGUI", "TextMeshPro", "Slider", "Toggle", "PlayerInput", "HingeJoint", "FixedJoint",
  "SpringJoint", "ConfigurableJoint", "WheelCollider", "Terrain", "LODGroup", "PlayableDirector", "VideoPlayer", "Tilemap", "Volume"]);

export const expensiveFrameCalls = {
  GetComponent: "GetComponent", GetComponents: "GetComponents", GetComponentInChildren: "GetComponentInChildren",
  GetComponentInParent: "GetComponentInParent", GetComponentsInChildren: "GetComponentsInChildren",
  FindObjectOfType: "FindObjectOfType", FindObjectsOfType: "FindObjectsOfType",
  FindFirstObjectByType: "FindFirstObjectByType", FindAnyObjectByType: "FindAnyObjectByType",
  FindObjectsByType: "FindObjectsByType", FindWithTag: "GameObject.FindWithTag",
  FindGameObjectWithTag: "GameObject.FindGameObjectWithTag", FindGameObjectsWithTag: "GameObject.FindGameObjectsWithTag",
  SendMessage: "SendMessage", BroadcastMessage: "BroadcastMessage", AddComponent: "AddComponent",
};

export const structProperties = new Set(["position", "localPosition", "eulerAngles", "localEulerAngles", "localScale", "velocity",
  "angularVelocity", "rotation", "localRotation", "anchoredPosition", "sizeDelta", "pivot", "anchorMin", "anchorMax",
  "center", "size", "color", "offset", "linearVelocity", "forward", "up", "right"]);
export const structFields = new Set(["x", "y", "z", "w", "r", "g", "b", "a"]);
export const rigidbodyCalls = new Set(["AddForce", "AddTorque", "AddForceAtPosition", "AddRelativeForce", "AddRelativeTorque", "MovePosition", "MoveRotation", "AddExplosionForce"]);
export const legacyInputCalls = new Set(["GetKey", "GetKeyDown", "GetKeyUp", "GetAxis", "GetAxisRaw", "GetButton", "GetButtonDown", "GetButtonUp", "GetMouseButton", "GetMouseButtonDown", "GetMouseButtonUp"]);
export const linqMethods = new Set(["Where", "Select", "SelectMany", "OrderBy", "OrderByDescending", "ThenBy", "ToList", "ToArray", "ToDictionary", "First", "FirstOrDefault", "Last", "LastOrDefault", "Any", "All", "Sum", "Average", "Min", "Max", "Distinct", "GroupBy", "Skip", "Take", "Aggregate", "SequenceEqual", "Zip", "Except", "Intersect", "Union", "OfType", "Cast", "Single", "SingleOrDefault"]);
export const behaviourBases = new Set(["MonoBehaviour", "NetworkBehaviour", "StateMachineBehaviour", "UIBehaviour", "Behaviour"]);
export const editorBases = new Set(["Editor", "EditorWindow", "PropertyDrawer", "ScriptableWizard", "AssetPostprocessor", "DecoratorDrawer", "ShaderGUI"]);
