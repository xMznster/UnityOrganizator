# Unity Developer Vault

**Mobile IDE & Knowledge Hub für Unity-Entwicklung auf dem iPhone 16 Pro.**
Ideen, Prompts, technische Notizen und C#-Skripte unterwegs sammeln, bearbeiten, prüfen – und später am PC in Unity und mit Claude Code verwenden.

| Bereich | Was die App kann |
|---|---|
| **Dashboard** | Zuletzt bearbeitete Skripte/Notizen, „Weiterarbeiten“, Favoriten, Projekte, Statistiken, Skript-Status, Sync-Status, Schnellaktionen (inkl. „Aus Zwischenablage“ mit automatischer C#-Erkennung) |
| **Notes & Ideas** | Markdown-Editor mit Live-Highlighting, Vorschau (Überschriften, Listen, Checklisten, Tabellen, Callouts, Code-Blöcke mit C#-Highlighting), Titel, Kategorie, Tags, Beschreibung, Erstellungs-/Änderungsdatum, Kopieren, Export |
| **Prompts** | Eigener Typ mit „Kopieren“-Button, als TXT/Markdown exportierbar, in Claude Code als MCP-Prompts nutzbar |
| **C# Code Studio** | Syntax-Highlighting, Zeilennummern, Auto-Einrückung, Klammerpaare, Auto-Close, Suchen & Ersetzen (Regex, ganzes Wort), Undo/Redo, Schriftgröße (auch Pinch), dunkles/helles Theme, Symbolleiste über der Tastatur, Snippets, Vorlagen, Struktur-Ansicht, Formatieren, Kommentar umschalten |
| **Code-Analyse** | Lokal auf dem Gerät: Lexer, Klammerstruktur, fehlertoleranter Parser, C#-Heuristiken, Unity-Regeln – mit Zeilennummern, Fehler/Warnungen/Hinweise und Transparenz „Was wurde geprüft?“ |
| **Echte Kompilierung** | Über den PC-Companion (Roslyn gegen deine Unity-Installation) – per WLAN oder über den Sync-Ordner |
| **Ordner & Projekte** | Beliebig tiefe Ordner, erstellen/umbenennen/verschieben/löschen (Inhalte → Papierkorb), duplizieren, Favoriten, Mehrfachauswahl, Sortierung, Inbox, Papierkorb, Versionen |
| **Suche** | Gleichzeitig in Titeln, Inhalten, Code (CamelCase-bewusst), Beschreibungen, Tags, Kategorien, Ordnernamen; Code-Fragment-Modus; Filter für Typ, Projekt, Kategorie, Tags, Status, Favoriten |
| **Export** | Echte `.cs`-Dateien (byte-genau), Mehrfach-Export, ZIP mit Ordnerstruktur, Markdown mit Front Matter, Prompts als TXT, ganze Projekte, „Nur C#“ für den Unity-`Assets`-Ordner; Teilen-Menü, „In Dateien sichern“, Ordner in der Dateien-App |
| **Sync iPhone ⇄ PC** | Zwei-Wege-Sync mit einem Ordner (iCloud Drive, Working Copy = echtes Git, OneDrive …) oder direkt mit einem GitHub-Repository; Konflikte verlieren nie Inhalte |
| **Claude** | Agent-Skill-Generator (SKILL.md), Kontext-Pakete, CLAUDE.md-Snippet, MCP-Server für Claude Code (Suchen, Lesen, Prompts) |

## Zwei Varianten

| | **Web-App (PWA) – `web/`** | **Native App (Swift) – `App/`** |
|---|---|---|
| Installation | Safari → Teilen → „Zum Home-Bildschirm“ – **kein Mac nötig** | Mac mit Xcode 16+ |
| Speicher | IndexedDB auf dem iPhone, offline | SwiftData auf dem iPhone, offline |
| Sync zum PC | GitHub-Repository (ein Commit pro Sync) | Ordner (iCloud/Working Copy) oder GitHub |
| Analyse/Export/Suche | gleiche Logik (JS-Port, gleiche Tests) | VaultKit (Swift) |

**PWA lokal testen:** `cd web && python3 -m http.server 8000` → http://localhost:8000
**PWA-Tests:** `node --test web/test/*.test.mjs`

## Projektstruktur

```
web/                        PWA: index.html, styles.css, sw.js (offline), js/core (Analyse, Suche, Sync …), js/ui
UnityVault.xcodeproj        Xcode-Projekt (Xcode 16+, öffnen & starten)
App/                        iOS-App (SwiftUI + SwiftData)
  Models/                   Folder, VaultItem, Revision (SwiftData)
  Services/                 VaultStore, Sync, Export, Import, Keychain, PC-Compiler
  Design/                   Designsystem (Farben, Typografie, Komponenten)
  Views/                    Dashboard, Vault, Notes, Code, Search, Workflow, Settings
Packages/VaultKit/          Plattformunabhängiger Kern + 45 Unit-Tests
  CSharp/                   Lexer, Analyzer, Unity-Katalog, Editor-Logik, Vorlagen
  Markdown/ Search/         Markdown-Parser, Suchindex
  Export/ Sync/ Claude/     ZIP, SHA-1/Git-Blob-IDs, Codec, Sync-Engine, Skills
UITests/                    End-to-End-Tests im Simulator (inkl. Persistenz nach Neustart)
companion/mcp-server/       MCP-Server für Claude Code (Node, keine Abhängigkeiten)
companion/VaultCompiler/    Roslyn-Compiler-Companion (.NET 8)
docs/                       Architektur, Compiler, Sync, Claude-Integration
tools/                      Projekt- und Icon-Generator
```

## Auf dem iPhone 16 Pro installieren

Voraussetzungen: Mac mit **Xcode 16 oder neuer**, iPhone mit iOS 18+, Apple-ID (kostenloser Account reicht für die eigene Installation).

1. Repository klonen und `UnityVault.xcodeproj` in Xcode öffnen.
2. Target **UnityVault** → *Signing & Capabilities* → dein **Team** wählen. Falls die Bundle-ID schon vergeben ist, `com.xmznster.unityvault` z. B. in `com.<dein-name>.unityvault` ändern.
3. iPhone per Kabel/WLAN verbinden, auf dem iPhone **Entwicklermodus** aktivieren (Einstellungen → Datenschutz & Sicherheit → Entwicklermodus).
4. Oben das iPhone als Ziel wählen und **Run (⌘R)** drücken.
5. Beim ersten Start ggf. dem Entwickler vertrauen (Einstellungen → Allgemein → VPN & Geräteverwaltung).

> Mit kostenlosem Account läuft das Signing 7 Tage; danach erneut aus Xcode starten (Daten bleiben erhalten). Mit Apple Developer Program 1 Jahr bzw. TestFlight.

## Tests

```bash
swift test --package-path Packages/VaultKit          # Kern: Analyzer, Suche, Export, Sync (auch unter Linux)
node --test companion/mcp-server/test.mjs            # MCP-Server
dotnet run --project companion/VaultCompiler -- selftest   # Roslyn-Pipeline
xcodebuild test -project UnityVault.xcodeproj -scheme UnityVault \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro'   # UI-Tests
```

Alles läuft automatisch in GitHub Actions (`.github/workflows/ci.yml`): Linux + macOS Paket-Tests, iOS-Build (Simulator und Gerät), UI-Tests auf dem iPhone-16-Pro-Simulator, Companion-Tests.

## Weiterführend

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – Architektur & technische Entscheidungen
- [docs/COMPILER.md](docs/COMPILER.md) – Was auf iOS geprüft werden kann und wie die echte Kompilierung funktioniert
- [docs/SYNC.md](docs/SYNC.md) – Synchronisierung iPhone ⇄ PC (Ordner, Git, GitHub)
- [docs/CLAUDE_INTEGRATION.md](docs/CLAUDE_INTEGRATION.md) – Claude Code, MCP, Skills, Zukunftspläne
