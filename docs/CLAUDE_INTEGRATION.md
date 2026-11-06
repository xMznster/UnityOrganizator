# Claude-Integration

Grundsatz: **keine vorgetäuschte Verbindung.** Alles unten funktioniert heute mit Claude Code; was externe Infrastruktur braucht, ist als solches gekennzeichnet.

## 1. MCP-Server für Claude Code (fertig)

`companion/mcp-server/server.mjs` (Node ≥ 18, keine Abhängigkeiten) liest den synchronisierten Vault-Ordner.

```bash
claude mcp add unity-vault -- node /pfad/zu/UnityOrganizator/companion/mcp-server/server.mjs "/pfad/zum/Vault-Sync-Ordner"
```

| Fähigkeit | Inhalt |
|---|---|
| `vault_search` | Suche über Titel, Tags, Ordner, Beschreibungen und Code-Bezeichner (CamelCase), Filter nach Typ/Projekt |
| `vault_get` | Eintrag vollständig (exakter C#-Code) inkl. Metadaten (Status, Unity-Version, Komponenten …) |
| `vault_list` / `vault_project_tree` | Ordner- und Projektstruktur |
| `vault_outline` | Klassen/Methoden eines Skripts |
| MCP-Prompts | Jeder gespeicherte Prompt → `/mcp__unity-vault__<name>` in Claude Code |
| Ressourcen | `vault://<pfad>` für jeden Eintrag |

Änderungen im Ordner werden automatisch erkannt (Neu-Einlesen alle 3 s bei Zugriff).
Für Projekte: In der App *PC & Claude → Claude → „CLAUDE.md-Abschnitt kopieren“* und in die `CLAUDE.md` des Unity-Projekts einfügen.

## 2. Claude Skills aus dem Vault (fertig)

*PC & Claude → Claude → Claude Skill erzeugen*: Ordner wählen, Typen filtern (z. B. nur getestete Skripte), Name + Beschreibung → ZIP mit

```
horror-enemy-patterns/
  SKILL.md          (Front Matter name/description, Vorgehen, kommentiertes Inhaltsverzeichnis)
  scripts/*.cs
  prompts/*.md
  reference/*.md
```

Entpacken nach `~/.claude/skills/` oder `<Unity-Projekt>/.claude/skills/`.

## 3. Kontext-Pakete (fertig)

Für einzelne Einträge, Ordner, Auswahl oder alle Favoriten: ein Markdown-Dokument mit Aufgabe, Metadaten und Code → Zwischenablage oder `claude-context.md`.

## 4. Vorbereitet / Ausblick (benötigt externe Infrastruktur)

| Idee | Was fehlt | Anknüpfungspunkt im Code |
|---|---|---|
| Claude direkt in der App (Fragen zu einem Skript) | Anthropic-API-Schlüssel des Nutzers, Netzwerk | `ClaudeBridge.contextBundle` liefert den Prompt-Kontext; Schlüssel gehört in `Keychain` |
| Vault ohne PC für Claude erreichbar (Remote-MCP) | Ein gehosteter MCP-Server (z. B. auf eigenem Server, liest das GitHub-Sync-Repo) | `server.mjs` kann unverändert auf einem Server laufen; Transport auf Streamable HTTP erweitern |
| Claude-Code-Aufgaben vom iPhone starten | Claude Code im Web/auf dem PC, Repo-Zugriff | GitHub-Sync legt den Vault als Repository ab, das Claude Code direkt öffnen kann |
| Automatisch generierte Skills bei jedem Sync | – (nur Konfiguration) | `ClaudeBridge.skillFiles` kann im Sync-Ordner unter `.claude/skills` schreiben |
