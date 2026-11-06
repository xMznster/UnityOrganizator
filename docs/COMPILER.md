# C#-Analyse & Kompilierung

## Was ist auf iOS technisch möglich?

| Ansatz | Machbar auf iOS? | Grund |
|---|---|---|
| Roslyn (C#-Compiler) in der App | **Nein** (praktisch) | .NET auf iOS läuft nur AOT-kompiliert; Roslyn emittiert IL, das ohne JIT nicht ausgeführt werden kann. Die Unity-Assemblies (UnityEngine/UnityEditor, ~200 MB) sind nicht auf dem Gerät und dürfen nicht mitgeliefert werden. |
| Unity-Kompilierung | **Nein** | Benötigt den Unity-Editor (macOS/Windows/Linux). |
| Eigener Parser + Regelwerk | **Ja** | Läuft vollständig lokal und offline → in der App umgesetzt. |
| Roslyn auf dem eigenen PC | **Ja** | → PC-Companion `VaultCompiler`. |

Die App kennzeichnet daher jede Meldung mit ihrer Quelle (*Lexer, Syntax, C#-Analyse, Unity-Regeln, Roslyn-Compiler*) und zeigt unter **„Was wurde geprüft?“** genau, welche Stufen gelaufen sind.

## Stufe 1–3: Lokal in der App (VaultKit/CSharp)

1. **Syntaxprüfung**
   - Lexer: unterminierte Strings, Raw-/Verbatim-/Interpolated-Strings, Zeichenliterale, Block-Kommentare, ungültige Zeichen.
   - Klammerstruktur `( ) [ ] { }` mit Fehlerkorrektur; bei fehlender `}` Hinweis „vermutlich vor Zeile X“ (anhand der Einrückung).
   - Fehlertoleranter Strukturparser: Namespaces, Typen, Member, Anweisungen; erkennt fehlende Semikolons (auch vor `}`), Code im Klassenrumpf, Methoden außerhalb von Klassen, `if` ohne `(`.
2. **Code-Analyse (C#)**: `=` statt `==` in Bedingungen, `if (…);`, leere `catch`-Blöcke, `while(true)` ohne Ausstieg, doppelte Typen/Methoden/Felder (CS0101/CS0111/CS0102), fehlende `using`-Direktiven für bekannte Typen (CS0246) und LINQ.
3. **Unity-Regeln**: falsch geschriebene/kleingeschriebene Messages (`start`, `Updtae`), falsche Signaturen (`OnTriggerEnter(Collider2D)`, `OnCollisionEnter(Collider)`), Coroutines ohne `yield`, direkt aufgerufene Coroutines, `StartCoroutine("…")`, CS1612 (`transform.position.x = …`), `GetComponent`/`Find`/`Camera.main`/`Debug.Log` in `Update`, Physik in `Update`, Input-Down in `FixedUpdate`, Bewegung ohne `Time.deltaTime`, `tag ==` statt `CompareTag`, `new` auf Komponenten/ScriptableObjects, `UnityEditor` ohne `#if UNITY_EDITOR`, Dateiname ≠ Klassenname, mehrere MonoBehaviours pro Datei, altes Input-Manager-API.

Zusätzlich: Skript-Klassifizierung (MonoBehaviour, ScriptableObject, Editor-Skript, Interface …), Kategorie-Vorschläge (Enemy AI, Player Controller …), Komponenten-Erkennung und Abhängigkeiten.

Nicht lokal prüfbar: Ob `rb.AddForc()` existiert, Typfehler, Overload-Auflösung – das kann nur ein echter Compiler mit den Unity-DLLs.

## Stufe 4: Echte Kompilierung – `companion/VaultCompiler`

Roslyn 4.11, kompiliert mit C# 9 (Unity-Sprachstand) und Unity-Defines (`UNITY_EDITOR`, `UNITY_20xx_OR_NEWER`, `ENABLE_INPUT_SYSTEM` …) gegen:
- die Unity-Assemblies der Editor-Installation (`Data/Managed/UnityEngine/*.dll`, automatisch über Unity Hub gefunden oder `--unity`),
- optional `--project <Unity-Projekt>` → `Library/ScriptAssemblies/*.dll` (Input System, TextMeshPro, AI Navigation, eigene asmdefs).

### Installation (PC/Mac)

```bash
# .NET 8 SDK installieren: https://dotnet.microsoft.com/download
cd companion/VaultCompiler
dotnet run -c Release -- selftest       # prüft die Pipeline
```

### Modus A: Live aus der App (WLAN)

```bash
dotnet run -c Release -- serve --port 5199 --token MEINGEHEIMNIS --project "C:\Unity\HorrorGame"
```
In der App: *PC & Claude → PC-Compiler* → `http://<IP des PCs>:5199` und den Schlüssel eintragen → im Skript *Analyse → „Jetzt auf dem PC kompilieren“*. Es werden das Skript und alle Skripte desselben Projekts gesendet, damit Querverweise aufgelöst werden. Ergebnisse erscheinen als „Roslyn-Compiler“ mit Zeilennummern im Editor.

Firewall: eingehende Verbindungen auf Port 5199 im privaten Netz erlauben.

### Modus B: Über den Sync-Ordner

```bash
dotnet run -c Release -- watch "D:\iCloudDrive\UnityVault"
```
Schreibt bei jeder Änderung `.vault/compile-results.json`; die App liest die Datei bei der nächsten Synchronisierung und hängt die Compilerfehler an die jeweiligen Skripte (`check` = einmalig).

### API

- `GET /health` → Text mit Unity-Pfad
- `POST /compile` `{"files":[{"path":"Player.cs","content":"…"}]}` → `{"compiledAt":"…Z","unityPath":"…","success":false,"diagnostics":[{"file","line","column","severity","id","message"}]}`
- Authentifizierung: `Authorization: Bearer <token>` (falls `--token` gesetzt)
