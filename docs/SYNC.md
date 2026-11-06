# Synchronisierung iPhone ⇄ PC

## Varianten

| Variante | Einrichtung | Am PC |
|---|---|---|
| **iCloud Drive** | *PC & Claude → Synchronisierung → Ordner (Dateien-App)* → Ordner in iCloud Drive wählen | iCloud für Windows / Finder; Ordner direkt nutzen |
| **Git über Working Copy** (empfohlen für Versionierung) | In der App *Working Copy* ein Repository klonen; in Unity Vault diesen Repository-Ordner wählen; nach dem Sync in Working Copy committen & pushen | `git pull` |
| **GitHub direkt** | *Ziel: GitHub-Repository*, Besitzer/Repo/Branch eintragen, Fine-grained Token mit „Contents: Read and write“ | `git clone` / `git pull` – jede Synchronisierung ist ein Commit |
| OneDrive, Dropbox, USB-Stick | wie iCloud (jeder Anbieter der Dateien-App) | Ordner direkt |

Warum keine eingebaute Git-Implementierung? Eine native Git-Bibliothek (libgit2) wäre schwergewichtig und schwer zu warten. Working Copy ist ein ausgereifter Git-Client auf iOS; die GitHub-REST-API (Git Data API) deckt den direkten Weg ohne Zusatz-App ab. Beide liefern echte Git-Historie.

## Dateiformat im Sync-Ordner

```
Horror Game/
  Scripts/Enemy AI/SpiderLegAnimator.cs   ← exakter C#-Code
  Ideas/Spinnen-Gegner.md                 ← Markdown mit YAML-Front-Matter
  Prompts/Refactor MonoBehaviour.md       ← kind: prompt
Inbox/…                                   ← Einträge ohne Ordner
.vault/manifest.json                      ← Zuordnung Datei ↔ Eintrag, Skript-Metadaten
.vault/compile-results.json               ← optional, vom VaultCompiler
.vault/trash/<Datum>/…                    ← in der App gelöschte Dateien (nur Ordner-Sync)
```

Ordner, die mit `.` beginnen, ignoriert Unity – der Vault-Ordner kann also auch direkt in `Assets/` liegen.

## Algorithmus

Das Manifest speichert pro Eintrag den Pfad sowie zwei Git-Blob-IDs: Stand der Datei (`remoteBlob`) und Stand der App (`appBlob`) bei der letzten Synchronisierung.

| App geändert | PC geändert | Ergebnis |
|---|---|---|
| nein | nein | nichts (ggf. Umbenennen/Verschieben in der App → Datei wird verschoben) |
| ja | nein | Datei wird geschrieben |
| nein | ja | Eintrag wird aktualisiert (vorher Version gesichert, Metadaten bleiben) |
| ja | ja | **Konflikt**: App-Version bleibt, PC-Version wird als Kopie „(Konflikt …)“ angelegt |
| – | Datei neu | neuer Eintrag, Ordner werden angelegt |
| – | Datei verschoben (gleicher Inhalt) | Eintrag wird in der App verschoben |
| – | Datei gelöscht | Eintrag → Papierkorb (bzw. Datei wird wiederhergestellt, falls in der App geändert) |
| in App gelöscht | unverändert | Datei wird entfernt (Ordner-Sync: nach `.vault/trash`) |
| in App gelöscht | geändert | Datei wird als neuer Eintrag zurückgeholt |

**Neuinstallation/zweites Gerät**: Die App merkt sich lokal, welche Einträge sie mit diesem Ziel synchronisiert hat. Ist diese Liste leer, werden alle Dateien des Ziels *wiederhergestellt* statt gelöscht.

Alle Fälle sind in `Packages/VaultKit/Tests/VaultKitTests/SyncTests.swift` getestet (inkl. echtem Dateisystem).
