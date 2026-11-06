# Companion-Tools (PC/Mac)

| Tool | Zweck | Start |
|---|---|---|
| `mcp-server/` | Macht den synchronisierten Vault für **Claude Code** verfügbar (Suche, Lesen, Prompts) | `claude mcp add unity-vault -- node companion/mcp-server/server.mjs "<Vault-Ordner>"` |
| `VaultCompiler/` | **Echte C#-Kompilierung** mit Roslyn gegen deine Unity-Installation | `dotnet run --project companion/VaultCompiler -c Release -- serve --token GEHEIM` |

Details: [../docs/CLAUDE_INTEGRATION.md](../docs/CLAUDE_INTEGRATION.md), [../docs/COMPILER.md](../docs/COMPILER.md)
