// Unity Developer Vault – PC compiler companion.
//
// Compiles the vault's C# scripts with Roslyn against a real Unity installation and reports
// genuine compiler diagnostics back to the iPhone app:
//
//   vault-compiler serve  [--port 5199] [--token SECRET] [--unity <EditorPath>] [--project <UnityProject>]
//       HTTP API for the app ("Jetzt auf dem PC kompilieren"). GET /health, POST /compile
//   vault-compiler check  <vaultFolder> [--unity …] [--project …]
//       Compiles every .cs in the folder, writes <vaultFolder>/.vault/compile-results.json
//       (the app picks this up on the next sync).
//   vault-compiler watch  <vaultFolder> [--unity …] [--project …]
//       Same as check, re-run automatically whenever a .cs file changes.
//   vault-compiler selftest
//       Verifies the pipeline with built-in stub assemblies (no Unity needed).

using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace VaultCompiler;

public sealed record SourceFile(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("content")] string Content);

public sealed record DiagnosticEntry(
    [property: JsonPropertyName("file")] string File,
    [property: JsonPropertyName("line")] int Line,
    [property: JsonPropertyName("column")] int Column,
    [property: JsonPropertyName("severity")] string Severity,
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("message")] string Message);

public sealed record CompileResults(
    [property: JsonPropertyName("compiledAt")] string CompiledAt,
    [property: JsonPropertyName("unityPath")] string? UnityPath,
    [property: JsonPropertyName("success")] bool Success,
    [property: JsonPropertyName("diagnostics")] List<DiagnosticEntry> Diagnostics);

public sealed record CompileRequest(
    [property: JsonPropertyName("files")] List<SourceFile> Files);

public static class UnityLocator
{
    /// Finds the Unity "Managed" directories (engine/editor DLLs) for an editor installation.
    public static string? FindEditor(string? explicitPath)
    {
        var candidates = new List<string>();
        if (!string.IsNullOrWhiteSpace(explicitPath)) candidates.Add(explicitPath!);
        var env = Environment.GetEnvironmentVariable("UNITY_EDITOR_PATH");
        if (!string.IsNullOrWhiteSpace(env)) candidates.Add(env!);
        foreach (var hub in new[] { @"C:\Program Files\Unity\Hub\Editor", "/Applications/Unity/Hub/Editor",
                                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Unity/Hub/Editor") })
        {
            if (Directory.Exists(hub))
                candidates.AddRange(Directory.GetDirectories(hub).OrderByDescending(d => d, StringComparer.OrdinalIgnoreCase));
        }
        foreach (var c in candidates)
            if (ManagedDirs(c).Any()) return c;
        return null;
    }

    public static IEnumerable<string> ManagedDirs(string editorPath)
    {
        var options = new[]
        {
            Path.Combine(editorPath, "Data", "Managed", "UnityEngine"),          // Windows: …/Editor
            Path.Combine(editorPath, "Editor", "Data", "Managed", "UnityEngine"), // Windows: version folder
            Path.Combine(editorPath, "Contents", "Managed", "UnityEngine"),       // macOS: Unity.app
            Path.Combine(editorPath, "Unity.app", "Contents", "Managed", "UnityEngine"),
            Path.Combine(editorPath, "Managed", "UnityEngine"),
        };
        return options.Where(Directory.Exists);
    }

    public static List<MetadataReference> References(string? editorPath, string? projectPath, out List<string> notes)
    {
        var noteList = new List<string>();
        notes = noteList;
        var refs = new List<MetadataReference>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Add(string file)
        {
            var name = Path.GetFileName(file);
            if (!seen.Add(name)) return;
            try { refs.Add(MetadataReference.CreateFromFile(file)); } catch { noteList.Add($"skipped {name}"); }
        }
        // Base class library of the running .NET (covers netstandard/mscorlib facades).
        var tpa = (AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);
        foreach (var f in tpa) Add(f);
        if (editorPath != null)
        {
            foreach (var dir in ManagedDirs(editorPath))
                foreach (var dll in Directory.GetFiles(dir, "*.dll")) Add(dll);
            notes.Add($"Unity: {editorPath}");
        }
        if (projectPath != null)
        {
            // Compiled package assemblies (Input System, TextMeshPro, AI Navigation …).
            var scriptAssemblies = Path.Combine(projectPath, "Library", "ScriptAssemblies");
            if (Directory.Exists(scriptAssemblies))
                foreach (var dll in Directory.GetFiles(scriptAssemblies, "*.dll"))
                    if (!Path.GetFileName(dll).StartsWith("Assembly-CSharp", StringComparison.OrdinalIgnoreCase)) Add(dll);
            notes.Add($"Projekt: {projectPath}");
        }
        return refs;
    }
}

public sealed class ScriptCompiler
{
    private readonly List<MetadataReference> _references;
    public string? UnityPath { get; }
    public IReadOnlyList<string> Notes { get; }

    public ScriptCompiler(string? unityPath, string? projectPath, IEnumerable<MetadataReference>? extra = null)
    {
        UnityPath = unityPath;
        _references = UnityLocator.References(unityPath, projectPath, out var notes);
        if (extra != null) _references.AddRange(extra);
        Notes = notes;
    }

    public static readonly string[] Defines =
    {
        "UNITY_EDITOR", "UNITY_5_3_OR_NEWER", "UNITY_2017_1_OR_NEWER", "UNITY_2018_1_OR_NEWER", "UNITY_2019_1_OR_NEWER",
        "UNITY_2020_1_OR_NEWER", "UNITY_2021_1_OR_NEWER", "UNITY_2022_1_OR_NEWER", "UNITY_2023_1_OR_NEWER", "UNITY_6000_0_OR_NEWER",
        "ENABLE_INPUT_SYSTEM", "ENABLE_LEGACY_INPUT_MANAGER", "CSHARP_7_3_OR_NEWER", "NET_STANDARD_2_1", "NET_STANDARD"
    };

    public CompileResults Compile(IReadOnlyList<SourceFile> files)
    {
        var parse = new CSharpParseOptions(LanguageVersion.CSharp9, preprocessorSymbols: Defines);
        var trees = files.Select(f => CSharpSyntaxTree.ParseText(f.Content, parse, path: f.Path)).ToList();
        var compilation = CSharpCompilation.Create("VaultScripts", trees, _references,
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, allowUnsafe: true,
                nullableContextOptions: NullableContextOptions.Disable, concurrentBuild: true));
        var diags = compilation.GetDiagnostics()
            .Where(d => d.Severity is DiagnosticSeverity.Error or DiagnosticSeverity.Warning)
            .Where(d => d.Location.IsInSource)
            .Select(d =>
            {
                var span = d.Location.GetLineSpan();
                return new DiagnosticEntry(span.Path, span.StartLinePosition.Line + 1, span.StartLinePosition.Character + 1,
                    d.Severity == DiagnosticSeverity.Error ? "error" : "warning", d.Id, d.GetMessage());
            })
            .OrderBy(d => d.File).ThenBy(d => d.Line)
            .ToList();
        return new CompileResults(DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"), UnityPath,
            !diags.Any(d => d.Severity == "error"), diags);
    }

    /// Reads all scripts of a vault folder (relative paths with '/' – matching the app's sync paths).
    public static List<SourceFile> ReadFolder(string root)
    {
        var list = new List<SourceFile>();
        foreach (var file in Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(root, file).Replace('\\', '/');
            if (rel.Split('/').Any(p => p.StartsWith('.') || p is "Library" or "Temp" or "obj" or "bin")) continue;
            list.Add(new SourceFile(rel, File.ReadAllText(file)));
        }
        return list;
    }
}

public static class Program
{
    static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public static int Main(string[] args)
    {
        if (args.Length == 0 || args[0] is "-h" or "--help") { PrintHelp(); return 0; }
        string? Opt(string name) { var i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
        var cmd = args[0];
        try
        {
            switch (cmd)
            {
                case "selftest": return SelfTest.Run();
                case "check":
                case "watch":
                {
                    if (args.Length < 2) { Console.Error.WriteLine("Vault-Ordner fehlt."); return 2; }
                    var folder = Path.GetFullPath(args[1]);
                    var compiler = MakeCompiler(Opt("--unity"), Opt("--project"));
                    var code = CheckFolder(compiler, folder);
                    if (cmd == "check") return code;
                    Watch(compiler, folder);
                    return 0;
                }
                case "serve":
                {
                    var compiler = MakeCompiler(Opt("--unity"), Opt("--project"));
                    var port = int.TryParse(Opt("--port"), out var p) ? p : 5199;
                    Serve(compiler, port, Opt("--token") ?? Environment.GetEnvironmentVariable("VAULT_COMPILER_TOKEN"));
                    return 0;
                }
                default:
                    PrintHelp();
                    return 2;
            }
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("Fehler: " + e.Message);
            return 1;
        }
    }

    static void PrintHelp() => Console.WriteLine("""
        vault-compiler – Roslyn-Kompilierung für den Unity Developer Vault

          serve    [--port 5199] [--token SECRET] [--unity <Editor-Pfad>] [--project <Unity-Projekt>]
          check    <Vault-Ordner> [--unity …] [--project …]
          watch    <Vault-Ordner> [--unity …] [--project …]
          selftest

        Ohne --unity wird Unity Hub automatisch gesucht (oder UNITY_EDITOR_PATH).
        --project fügt Library/ScriptAssemblies hinzu (Input System, TextMeshPro, AI Navigation …).
        """);

    static ScriptCompiler MakeCompiler(string? unity, string? project)
    {
        if (Environment.GetCommandLineArgs().Contains("--test-stubs"))
            return new ScriptCompiler(null, null, new[] { SelfTest.StubReference() }); // tests only – not a real Unity check
        var editor = UnityLocator.FindEditor(unity);
        if (editor == null)
            throw new InvalidOperationException("Keine Unity-Installation gefunden. Mit --unity \"…/Hub/Editor/<Version>/Editor\" angeben.");
        var c = new ScriptCompiler(editor, project);
        foreach (var n in c.Notes.Where(n => !n.StartsWith("skipped"))) Console.WriteLine("• " + n);
        return c;
    }

    static int CheckFolder(ScriptCompiler compiler, string folder)
    {
        var files = ScriptCompiler.ReadFolder(folder);
        var result = compiler.Compile(files);
        var outDir = Path.Combine(folder, ".vault");
        Directory.CreateDirectory(outDir);
        File.WriteAllText(Path.Combine(outDir, "compile-results.json"), JsonSerializer.Serialize(result, Json));
        var errors = result.Diagnostics.Count(d => d.Severity == "error");
        var warnings = result.Diagnostics.Count - errors;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {files.Count} Skripte · {errors} Fehler · {warnings} Warnungen");
        foreach (var d in result.Diagnostics.Take(50)) Console.WriteLine($"  {d.File}({d.Line},{d.Column}): {d.Severity} {d.Id}: {d.Message}");
        return errors == 0 ? 0 : 1;
    }

    static void Watch(ScriptCompiler compiler, string folder)
    {
        Console.WriteLine($"Beobachte {folder} … (Strg+C beendet)");
        using var watcher = new FileSystemWatcher(folder, "*.cs") { IncludeSubdirectories = true, EnableRaisingEvents = true };
        var pending = 0;
        void Changed(object? _, FileSystemEventArgs e)
        {
            if (e.FullPath.Contains(Path.DirectorySeparatorChar + ".vault")) return;
            if (Interlocked.Exchange(ref pending, 1) == 1) return;
            Task.Delay(800).ContinueWith(_ => { Interlocked.Exchange(ref pending, 0); try { CheckFolder(compiler, folder); } catch (Exception ex) { Console.Error.WriteLine(ex.Message); } });
        }
        watcher.Changed += Changed; watcher.Created += Changed; watcher.Deleted += Changed; watcher.Renamed += (s, e) => Changed(s, e);
        Thread.Sleep(Timeout.Infinite);
    }

    static void Serve(ScriptCompiler compiler, int port, string? token)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
        builder.Logging.SetMinimumLevel(LogLevel.Warning);
        var app = builder.Build();
        bool Authorized(HttpRequest r) => string.IsNullOrEmpty(token) || r.Headers.Authorization.ToString() == $"Bearer {token}";
        app.MapGet("/health", (HttpRequest r) => Authorized(r)
            ? Results.Text($"VaultCompiler 1.0 · Unity: {compiler.UnityPath}")
            : Results.Unauthorized());
        app.MapPost("/compile", async (HttpRequest r) =>
        {
            if (!Authorized(r)) return Results.Unauthorized();
            var req = await JsonSerializer.DeserializeAsync<CompileRequest>(r.Body, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (req?.Files is not { Count: > 0 } || req.Files.Any(f => f.Content is null || f.Path is null)) return Results.BadRequest("files fehlt");
            var result = compiler.Compile(req.Files);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] /compile {req.Files[0].Path} (+{req.Files.Count - 1}) → {result.Diagnostics.Count(d => d.Severity == "error")} Fehler");
            return Results.Text(JsonSerializer.Serialize(result, Json), "application/json");
        });
        Console.WriteLine($"Vault-Compiler läuft auf Port {port}. In der App eintragen: http://<IP-dieses-PCs>:{port}");
        foreach (var ip in System.Net.Dns.GetHostAddresses(System.Net.Dns.GetHostName()).Where(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork))
            Console.WriteLine($"  → http://{ip}:{port}");
        if (string.IsNullOrEmpty(token)) Console.WriteLine("Hinweis: ohne --token kann jeder im WLAN kompilieren lassen.");
        app.Run();
    }
}

/// Self test with tiny in-memory stubs of UnityEngine (verifies the Roslyn pipeline without Unity).
public static class SelfTest
{
    const string Stub = """
        namespace UnityEngine {
            public class Object { }
            public class Component : Object { public Transform transform => null; public T GetComponent<T>() => default; }
            public class Behaviour : Component { }
            public class MonoBehaviour : Behaviour { }
            public class Transform : Component { public Vector3 position { get; set; } }
            public struct Vector3 { public float x, y, z; public static Vector3 up => default; }
            public class Rigidbody : Component { public void AddForce(Vector3 f) { } }
            public static class Debug { public static void Log(object o) { } }
        }
        """;

    public static MetadataReference StubReference()
    {
        var stubTree = CSharpSyntaxTree.ParseText(Stub);
        var tpa = (AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string ?? "").Split(Path.PathSeparator)
            .Where(f => f.Length > 0).Select(f => (MetadataReference)MetadataReference.CreateFromFile(f)).ToList();
        var stubComp = CSharpCompilation.Create("UnityEngineStub", new[] { stubTree }, tpa, new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
        using var ms = new MemoryStream();
        if (!stubComp.Emit(ms).Success) throw new InvalidOperationException("Stub build failed");
        return MetadataReference.CreateFromImage(ms.ToArray());
    }

    public static int Run()
    {
        var stubTree = CSharpSyntaxTree.ParseText(Stub);
        var tpa = (AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string ?? "").Split(Path.PathSeparator)
            .Where(f => f.Length > 0).Select(f => (MetadataReference)MetadataReference.CreateFromFile(f)).ToList();
        var stubComp = CSharpCompilation.Create("UnityEngineStub", new[] { stubTree }, tpa, new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
        using var ms = new MemoryStream();
        var emit = stubComp.Emit(ms);
        if (!emit.Success) { Console.Error.WriteLine("Stub build failed"); return 1; }
        var stubRef = MetadataReference.CreateFromImage(ms.ToArray());
        var compiler = new ScriptCompiler(null, null, new[] { stubRef });

        var ok = compiler.Compile(new[] { new SourceFile("Player.cs", """
            using UnityEngine;
            public class Player : MonoBehaviour {
                Rigidbody rb;
                void Awake() { rb = GetComponent<Rigidbody>(); }
                void FixedUpdate() { rb.AddForce(Vector3.up); Debug.Log("ok"); }
            }
            """) });
        var bad = compiler.Compile(new[] { new SourceFile("Broken.cs", """
            using UnityEngine;
            public class Broken : MonoBehaviour {
                void Start() { transform.position.x = 5f; GetComponent<Rigidbody>().AddForc(Vector3.up) }
            }
            """) });
        var ids = bad.Diagnostics.Select(d => d.Id).ToHashSet();
        Console.WriteLine($"valid: success={ok.Success} diagnostics={ok.Diagnostics.Count}");
        Console.WriteLine($"broken: success={bad.Success} ids={string.Join(",", ids)}");
        foreach (var d in bad.Diagnostics) Console.WriteLine($"  {d.File}({d.Line},{d.Column}) {d.Id}: {d.Message}");
        var pass = ok.Success && !bad.Success && ids.Contains("CS1002") && ids.Contains("CS1061") && ids.Contains("CS1612")
                   && bad.CompiledAt.EndsWith("Z") && !bad.CompiledAt.Contains('.');
        Console.WriteLine(pass ? "SELFTEST PASSED" : "SELFTEST FAILED");
        return pass ? 0 : 1;
    }
}
