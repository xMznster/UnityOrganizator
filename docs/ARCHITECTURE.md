# Architektur & technische Entscheidungen

## Überblick

```
┌──────────────────────────── iOS-App (SwiftUI) ────────────────────────────┐
│ Views: Dashboard · Vault · Editoren · Suche · PC & Claude · Einstellungen │
│        │                       │                                           │
│   VaultStore (@Observable)   CodeEditorController (UIKit/TextKit 1)        │
│        │  einzige Stelle für Mutationen (Papierkorb, Versionen, Zyklen)    │
│   SwiftData: Folder ─< Folder, Folder ─< VaultItem ─< Revision             │
│        │                                                                   │
│   SyncService · ExportService · ImportService · CompilerService · Keychain │
└────────┼───────────────────────────────────────────────────────────────────┘
         │ VaultSnapshot (reine Werte)
┌────────▼──────────── VaultKit (Swift Package, nur Foundation) ─────────────┐
│ CSharpLexer → CSharpAnalyzer (Parser + Regeln) · UnityCatalog · Templates  │
│ EditorAssist · MarkdownParser · SearchIndex · FileCodec · ExportBuilder    │
│ ZipWriter/Reader · SHA1/CRC32 · SyncEngine + FolderRemote/GitHubRemote      │
│ ClaudeBridge (Skills, Kontext)                                              │
└─────────────────────────────────────────────────────────────────────────────┘
         │ Dateien (.cs/.md + .vault/manifest.json)
┌────────▼──────── PC ────────┐
│ VaultCompiler (Roslyn, .NET)│   MCP-Server (Node) → Claude Code
└─────────────────────────────┘
```

## Entscheidungen

| Thema | Entscheidung | Begründung |
|---|---|---|
| UI | SwiftUI, iOS 18 (Tab-API mit Such-Rolle, `@Observable`) | Native, modern; iPhone 16 Pro läuft mit aktuellem iOS |
| Persistenz | **SwiftData** (SQLite) mit `autosave`, zusätzlich explizites `save()` nach jeder Mutation und beim Wechsel in den Hintergrund | Zuverlässig, offline, transaktional |
| Kernlogik | **VaultKit** als eigenes Package ohne UIKit/SwiftData | Unter Linux & macOS testbar (45 Tests), wiederverwendbar (z. B. für eine spätere Mac-App) |
| Editor | `UITextView` auf explizitem **TextKit-1**-Stack; Lexing pro Änderung (große Dateien entprellt), Farben als Attribute in einem einzigen `beginEditing/endEditing`-Block; Dateien > 80 000 Zeichen nur im sichtbaren Bereich ± 10 000 Zeichen (wird beim Scrollen nachgezogen); Zeilennummern zeichnet ein Gutter nur für sichtbare Zeilenfragmente | Flüssig auch bei mehreren tausend Zeilen (iOS bietet keine temporären Layout-Attribute wie macOS) |
| Speichern im Editor | Text lebt im Controller; Persistenz entprellt (600 ms) + sofort bei Verlassen/Hintergrund | Kein SwiftUI-Re-Render pro Tastendruck, kein Datenverlust |
| Analyse | Eigene Implementierung (Lexer + fehlertoleranter Parser + Regelwerk), läuft im Hintergrund-Task, entprellt | Roslyn ist auf iOS nicht lauffähig (siehe COMPILER.md) |
| Löschen | Soft-Delete (Papierkorb); Ordner-Löschen verschiebt alle Inhalte rekursiv in den Papierkorb; Relationship `.nullify` statt `.cascade` für Items | „Keine Inhalte versehentlich überschreiben/löschen“ |
| Versionen | `Revision` beim Öffnen, nach Bearbeitung, vor Sync-Übernahme, vor Wiederherstellung (max. 30 je Eintrag) | Jede Änderung ist rückholbar |
| Import | Erzeugt immer **neue** Einträge (neue IDs) | Import überschreibt nie |
| Ordnerverschiebung | Zyklenprüfung (`isDescendant`), eindeutige Namen pro Ebene | Konsistenter Baum |
| Export | Eigener ZIP-Writer (Stored, UTF-8-Namen), `.cs` byte-genau, Verifikation nach dem Schreiben | Keine Abhängigkeiten, garantiert vollständiger Code |
| Sync | Zwei-Wege-Engine mit Manifest und Git-Blob-IDs (SHA-1) | Funktioniert identisch für Ordner und GitHub; Änderungen ohne Download erkennbar |
| Secrets | GitHub-Token & Compiler-Schlüssel im iOS-Schlüsselbund | Nie im Klartext in UserDefaults |
| Projekt | `UnityVault.xcodeproj` wird von `tools/generate_xcodeproj.py` erzeugt (Xcode-16-Format mit synchronisierten Ordnern) | Neue Dateien in `App/` werden automatisch Teil des Targets |

## Datenmodell

- **Folder**: `id, name, icon, colorHex, isFavorite, sortIndex, createdAt, modifiedAt, parent, children, items`. Ordner ohne Parent sind *Projekte*.
- **VaultItem**: `id, kind (note|prompt|script), title, content, summary, category, tags, createdAt, modifiedAt, lastOpenedAt, isFavorite, folder, deletedAt, originalFolderID` sowie Skript-Metadaten `unityVersion, components, dependencies, projectName, status (experimental|inDevelopment|tested)` und Caches `lastErrorCount, lastWarningCount, scriptKindRaw, compilerResultJSON, compiledAt`.
- **Revision**: `id, createdAt, title, content, reason, item`.

Das *Projekt* eines Skripts ist `projectName`, sonst der Name des obersten Ordners.

## Designsystem

Dark-first „IDE“-Look: fast schwarzer Grund (`#090B0F`), Flächen in Abstufungen, Akzent **Vault Cyan** (`#4FD1C5`), Typfarben (Notiz blau, Prompt violett, Skript grün, Ordner amber), monospaced Abschnittsköpfe im Stil `// RECENT SCRIPTS`, abgerundete Karten mit feinen Konturen, Feder-Animationen beim Drücken. Alle Farben sind adaptiv (Hell-Modus vorhanden). Editor-Themes *Vault Night* / *Vault Day*.

Einhandbedienung: wichtigste Aktionen unten (Tab-Leiste, Statusleiste im Editor, Tastatur-Symbolleiste mit `{ } ( ) ; =>` usw., Auswahlleiste), Suche als eigene Tab-Rolle unten rechts.

## Bekannte Grenzen

- Die lokale Analyse löst keine Symbole gegen Unity-Assemblies auf (dafür: PC-Companion).
- ZIP-Import liest nur unkomprimierte Archive (eigene Exporte); fremde ZIPs in der Dateien-App entpacken und den Ordner importieren.
- Zeilenumbruch im Editor ist immer aktiv (mobilfreundlich); horizontales Scrollen gibt es in Code-Vorschauen.
