import SwiftUI
import VaultKit

/// "PC & Claude" hub: synchronisation, export, real compilation and Claude integration.
struct WorkflowView: View {
    @Environment(VaultStore.self) private var store
    @Environment(SyncService.self) private var sync
    @State private var showExportAll = false
    @State private var showImport = false

    var body: some View {
        List {
            Section {
                NavigationLink { SyncSettingsView() } label: {
                    WorkflowRow(symbol: "arrow.triangle.2.circlepath", color: Theme.info, title: "Synchronisierung",
                                subtitle: sync.isConfigured ? "\(sync.target.title) · \(sync.lastSyncDate.map { "zuletzt " + $0.relativeDescription } ?? "noch nie")" : "iCloud Drive, Working Copy (Git) oder GitHub")
                }
                if sync.isConfigured {
                    Button {
                        Task { await sync.sync(store: store) }
                    } label: {
                        HStack {
                            Label(sync.isSyncing ? "Synchronisiere …" : "Jetzt synchronisieren", systemImage: "arrow.clockwise")
                            Spacer()
                            if sync.isSyncing { ProgressView() }
                        }
                    }
                    .disabled(sync.isSyncing)
                    if let r = sync.lastResult { Text(r).font(Theme.mono(11)).foregroundStyle(Theme.textSecondary) }
                    if let e = sync.lastError { Text(e).font(.footnote).foregroundStyle(Theme.error) }
                }
            } header: { SectionHeader(title: "iPhone ⇄ PC") }
            .listRowBackground(Theme.surface)

            Section {
                Button { showExportAll = true } label: {
                    WorkflowRow(symbol: "shippingbox", color: Theme.amber, title: "Gesamten Vault exportieren", subtitle: "ZIP mit Ordnerstruktur, .cs-Dateien, Markdown & Manifest")
                }
                Button { showImport = true } label: {
                    WorkflowRow(symbol: "square.and.arrow.down", color: Theme.script, title: "Importieren", subtitle: ".cs, .md, .txt, Ordner oder Vault-ZIP")
                }
            } header: { SectionHeader(title: "Export & Import") } footer: {
                Text("Einzelne Skripte, Ordner und Projekte exportierst du direkt über ihr Menü (⋯).")
            }
            .listRowBackground(Theme.surface)

            Section {
                NavigationLink { CompilerSettingsView() } label: {
                    WorkflowRow(symbol: "hammer", color: Theme.error, title: "PC-Compiler (Roslyn)", subtitle: "Echte Kompilierung gegen deine Unity-Installation")
                }
            } header: { SectionHeader(title: "Kompilierung") }
            .listRowBackground(Theme.surface)

            Section {
                NavigationLink { ClaudeHubView() } label: {
                    WorkflowRow(symbol: "sparkles", color: Theme.prompt, title: "Claude-Integration", subtitle: "Skills erzeugen, MCP-Server, Kontext-Pakete")
                }
            } header: { SectionHeader(title: "Claude") }
            .listRowBackground(Theme.surface)
        }
        .scrollContentBackground(.hidden)
        .vaultBackground()
        .navigationTitle("PC & Claude")
        .sheet(isPresented: $showExportAll) { ExportSheet(scope: .all, title: "UnityVault") }
        .importFiles(isPresented: $showImport, into: nil)
    }
}

struct WorkflowRow: View {
    var symbol: String
    var color: Color
    var title: String
    var subtitle: String
    var body: some View {
        HStack(spacing: 12) {
            IconBadge(symbol: symbol, color: color, size: 38)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                Text(subtitle).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(2)
            }
        }
        .padding(.vertical, 3)
    }
}

// MARK: - Sync settings

struct SyncSettingsView: View {
    @Environment(VaultStore.self) private var store
    @Environment(SyncService.self) private var sync
    @AppStorage(SettingsKey.syncOnLaunch) private var syncOnLaunch = false
    @State private var pickFolder = false
    @State private var token = ""
    @State private var testResult: String?

    var body: some View {
        @Bindable var sync = sync
        Form {
            Section {
                Picker("Ziel", selection: $sync.target) {
                    ForEach(SyncService.Target.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
            } footer: {
                Text(sync.target == .folder
                     ? "Wähle einen Ordner in der Dateien-App: iCloud Drive (am PC über iCloud für Windows), OneDrive/Dropbox, oder ein Repository der Git-App „Working Copy“ – dann committest und pushst du dort mit echtem Git."
                     : "Synchronisiert direkt mit einem GitHub-Repository über die GitHub-API. Jede Synchronisierung wird ein Commit. Am PC: git clone / git pull.")
            }

            if sync.target == .folder {
                Section("Ordner") {
                    if let name = sync.folderName {
                        LabeledContent("Aktuell", value: name)
                        Button("Anderen Ordner wählen") { pickFolder = true }
                        Button("Verbindung trennen", role: .destructive) { sync.clearFolder() }
                    } else {
                        Button { pickFolder = true } label: { Label("Ordner auswählen …", systemImage: "folder.badge.plus") }
                    }
                }
            } else {
                Section("Repository") {
                    TextField("Besitzer (z. B. xmznster)", text: $sync.githubConfig.owner).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Repository (z. B. unity-vault)", text: $sync.githubConfig.repo).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Branch", text: $sync.githubConfig.branch).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Unterordner (optional)", text: $sync.githubConfig.directory).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                Section {
                    SecureField(sync.githubToken.isEmpty ? "Personal Access Token" : "•••••••• (gespeichert)", text: $token)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Token speichern") { sync.githubToken = token; token = ""; store.show("Token im Schlüsselbund gespeichert", symbol: "key.fill") }
                        .disabled(token.isEmpty)
                } header: { Text("Zugang") } footer: {
                    Text("Fine-grained Token mit Berechtigung „Contents: Read and write“ nur für dieses Repository. Wird ausschließlich im iOS-Schlüsselbund gespeichert.")
                }
            }

            Section {
                Button {
                    Task { await sync.sync(store: store) }
                } label: {
                    HStack {
                        Label("Jetzt synchronisieren", systemImage: "arrow.triangle.2.circlepath")
                        Spacer()
                        if sync.isSyncing { ProgressView() }
                    }
                }
                .disabled(!sync.isConfigured || sync.isSyncing)
                Toggle("Beim App-Start synchronisieren", isOn: $syncOnLaunch)
                if let date = sync.lastSyncDate { LabeledContent("Letzte Synchronisierung", value: date.shortDateTime) }
                if let r = sync.lastResult { Text(r).font(Theme.mono(11)).foregroundStyle(Theme.textSecondary) }
                if let e = sync.lastError { Label(e, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.error).font(.footnote) }
            }

            if !sync.lastLog.isEmpty {
                Section("Protokoll") {
                    ForEach(Array(sync.lastLog.prefix(60).enumerated()), id: \.offset) { _, l in
                        Text(l).font(Theme.mono(11)).foregroundStyle(Theme.textSecondary)
                    }
                }
            }

            Section("So funktioniert die Synchronisierung") {
                VStack(alignment: .leading, spacing: 8) {
                    bullet("Zwei-Wege-Abgleich: Änderungen am iPhone und am PC werden zusammengeführt.")
                    bullet("Jedes Skript ist eine echte .cs-Datei, Notizen/Prompts sind Markdown mit Metadaten.")
                    bullet("Konflikte (beide Seiten geändert): Beide Versionen bleiben erhalten – nichts wird überschrieben.")
                    bullet("Am PC gelöschte Dateien landen in der App im Papierkorb; in der App gelöschte Dateien werden im Ordner nach .vault/trash verschoben.")
                    bullet("Vor jeder Übernahme vom PC wird automatisch eine Version gesichert.")
                }
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
            }
        }
        .scrollContentBackground(.hidden)
        .vaultBackground()
        .navigationTitle("Synchronisierung")
        .fileImporter(isPresented: $pickFolder, allowedContentTypes: [.folder]) { result in
            if case .success(let url) = result { sync.setFolder(url) }
        }
    }

    private func bullet(_ s: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle().fill(Theme.accent).frame(width: 5, height: 5)
            Text(s)
        }
    }
}

// MARK: - Compiler settings

struct CompilerSettingsView: View {
    @AppStorage(SettingsKey.compilerURL) private var compilerURL = ""
    @State private var token = Keychain.get("compiler.token")
    @State private var status: String?
    @State private var testing = false

    var body: some View {
        Form {
            Section {
                TextField("http://192.168.0.10:5199", text: $compilerURL)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("Zugriffsschlüssel (optional)", text: $token)
                    .onChange(of: token) { _, t in Keychain.set(t, for: "compiler.token") }
                Button {
                    test()
                } label: {
                    HStack { Label("Verbindung testen", systemImage: "antenna.radiowaves.left.and.right"); Spacer(); if testing { ProgressView() } }
                }
                .disabled(compilerURL.isEmpty || testing)
                if let status { Text(status).font(.footnote).foregroundStyle(status.hasPrefix("✓") ? Theme.success : Theme.error) }
            } header: { Text("PC-Companion") } footer: {
                Text("Auf dem PC im Repository: companion/VaultCompiler starten (siehe docs/COMPILER.md). iPhone und PC müssen im selben WLAN sein.")
            }
            Section("Was ist auf dem iPhone möglich?") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("iOS verbietet das Ausführen nachgeladenen Codes (kein JIT) und es gibt keine Unity-Assemblies auf dem Gerät. Ein vollständiger C#-/Unity-Compiler kann deshalb nicht in einer App laufen.")
                    Text("Die App analysiert lokal Syntax, Struktur und Unity-Regeln. Für echte Compilerfehler (Typen, Methoden, Overloads) schickt sie den Code an deinen PC, wo Roslyn gegen UnityEngine.dll kompiliert.")
                    Text("Alternativ schreibt „vault-compiler watch“ Ergebnisse in den Sync-Ordner – sie erscheinen nach der nächsten Synchronisierung bei den Skripten.")
                }
                .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            }
        }
        .scrollContentBackground(.hidden)
        .vaultBackground()
        .navigationTitle("PC-Compiler")
    }

    private func test() {
        testing = true
        status = nil
        Task {
            do {
                guard var c = URLComponents(string: compilerURL), c.host != nil else { throw URLError(.badURL) }
                c.path = "/health"
                var req = URLRequest(url: c.url!, timeoutInterval: 8)
                if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
                let (data, resp) = try await URLSession.shared.data(for: req)
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                status = code == 200 ? "✓ Verbunden: " + String(decoding: data.prefix(200), as: UTF8.self) : "HTTP \(code)"
            } catch {
                status = "Nicht erreichbar: \(error.localizedDescription)"
            }
            testing = false
        }
    }
}

// MARK: - Claude hub

struct ClaudeHubView: View {
    @Environment(VaultStore.self) private var store
    @State private var showSkillBuilder = false
    @State private var showContext = false

    var body: some View {
        List {
            Section {
                Button { showSkillBuilder = true } label: {
                    WorkflowRow(symbol: "wand.and.stars", color: Theme.prompt, title: "Claude Skill erzeugen",
                                subtitle: "Aus Ordnern, Skripten und Prompts ein Agent-Skill-Paket (SKILL.md) bauen")
                }
                Button { showContext = true } label: {
                    WorkflowRow(symbol: "doc.richtext", color: Theme.info, title: "Kontext-Paket für Favoriten",
                                subtitle: "Alle Favoriten als ein Markdown-Dokument für Claude")
                }
            } header: { SectionHeader(title: "Jetzt nutzbar") }
            .listRowBackground(Theme.surface)

            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Text("MCP-Server für Claude Code").font(.system(size: 16, weight: .semibold))
                    Text("Der Server in companion/mcp-server liest deinen synchronisierten Vault-Ordner auf dem PC. Claude Code kann damit deine Skripte durchsuchen, lesen und deine Prompts als Slash-Befehle verwenden – ohne Cloud-Dienst.")
                        .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    CodeBlockView(language: "bash", code: "claude mcp add unity-vault -- node /pfad/zu/unityorganizator/companion/mcp-server/server.mjs /pfad/zum/VaultSyncOrdner")
                    Text("Tools: vault_search, vault_get, vault_list, vault_project_tree, vault_analyze · Prompts: jeder gespeicherte Prompt").font(Theme.mono(11)).foregroundStyle(Theme.textTertiary)
                }
                .padding(.vertical, 6)
                Button {
                    UIPasteboard.general.string = ClaudeBridge.claudeMDSnippet()
                    store.show("CLAUDE.md-Abschnitt kopiert", symbol: "doc.on.doc")
                } label: { Label("CLAUDE.md-Abschnitt kopieren", systemImage: "doc.on.doc") }
            } header: { SectionHeader(title: "Claude Code (PC)") }
            .listRowBackground(Theme.surface)

            Section {
                Text("Eine direkte Verbindung vom iPhone zu Claude ist bewusst nicht vorgetäuscht. Die App liefert Daten in Formaten, die Claude heute versteht (Skills, Markdown, MCP über den Sync-Ordner). Eine spätere Live-Anbindung (z. B. Anthropic API mit eigenem Schlüssel oder ein Remote-MCP-Server) ist in docs/CLAUDE_INTEGRATION.md beschrieben.")
                    .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            } header: { SectionHeader(title: "Architektur") }
            .listRowBackground(Theme.surface)
        }
        .scrollContentBackground(.hidden)
        .vaultBackground()
        .navigationTitle("Claude")
        .sheet(isPresented: $showSkillBuilder) { SkillBuilderView() }
        .sheet(isPresented: $showContext) { ClaudeContextSheet(items: store.liveItems().filter(\.isFavorite)) }
    }
}

struct SkillBuilderView: View {
    @Environment(VaultStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var instructions = ""
    @State private var selectedFolders = Set<UUID>()
    @State private var includeKinds: Set<VaultItemKind> = Set(VaultItemKind.allCases)
    @State private var onlyTested = false
    @State private var resultURL: URL?
    @State private var showShare = false
    @State private var showSave = false

    private var items: [VaultItem] {
        let all = store.liveItems()
        var set = Set<UUID>()
        for fid in selectedFolders {
            if let f = store.folder(id: fid) { set.insert(f.id); for d in f.allDescendants { set.insert(d.id) } }
        }
        return all.filter { item in
            guard let fid = item.folder?.id, set.contains(fid) else { return false }
            guard includeKinds.contains(item.kind) else { return false }
            if onlyTested && item.kind == .script && item.status != .tested { return false }
            return true
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name, z. B. Horror Enemy Patterns", text: $name)
                    TextField("Wann soll Claude die Skill verwenden?", text: $description, axis: .vertical).lineLimit(2...4)
                    TextField("Eigene Anweisungen (optional)", text: $instructions, axis: .vertical).lineLimit(3...8)
                } header: { Text("Skill") } footer: {
                    if !name.isEmpty { Text("Ordnername: \(ClaudeBridge.normalizedSkillName(name))").font(Theme.mono(11)) }
                }
                Section("Quellen") {
                    ForEach(store.rootFolders()) { f in folderToggle(f, depth: 0) }
                }
                Section("Inhalte") {
                    ForEach(VaultItemKind.allCases) { k in
                        Toggle(k.pluralName, isOn: Binding(get: { includeKinds.contains(k) }, set: { on in if on { includeKinds.insert(k) } else { includeKinds.remove(k) } }))
                    }
                    Toggle("Nur getestete Skripte", isOn: $onlyTested)
                    LabeledContent("Ausgewählt", value: "\(items.count) Einträge")
                }
                Section {
                    Button { build(); showShare = resultURL != nil } label: { Label("Als ZIP teilen", systemImage: "square.and.arrow.up") }
                    Button { build(); showSave = resultURL != nil } label: { Label("In Dateien sichern", systemImage: "folder") }
                } footer: {
                    Text("Entpacken nach ~/.claude/skills/ (persönlich) oder .claude/skills/ im Unity-Projekt. Claude Code lädt die Skill automatisch, wenn die Beschreibung zur Aufgabe passt.")
                }
                .disabled(items.isEmpty || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .scrollContentBackground(.hidden)
            .vaultBackground()
            .navigationTitle("Claude Skill")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Schließen") { dismiss() } } }
            .sheet(isPresented: $showShare) { if let resultURL { ShareSheet(items: [resultURL]) } }
            .sheet(isPresented: $showSave) { if let resultURL { DocumentExporter(urls: [resultURL]) { _ in } } }
        }
    }

    private func folderToggle(_ f: Folder, depth: Int) -> AnyView {
        AnyView(Group {
            Toggle(isOn: Binding(get: { selectedFolders.contains(f.id) }, set: { on in if on { selectedFolders.insert(f.id) } else { selectedFolders.remove(f.id) } })) {
                Label(f.name, systemImage: f.isProject ? f.icon : "folder").padding(.leading, CGFloat(depth) * 14)
            }
            ForEach(f.sortedChildren) { c in folderToggle(c, depth: depth + 1) }
        })
    }

    private func build() {
        let snap = store.snapshot()
        let spec = ClaudeBridge.SkillSpec(name: name, description: description, instructions: instructions)
        let files = ClaudeBridge.skillFiles(spec: spec, items: items.map { $0.snapshot() }, snapshot: snap)
        var zip = ZipWriter()
        for (path, data) in files.sorted(by: { $0.key < $1.key }) { zip.add(path: path, data: data) }
        resultURL = try? ExportService.writeZip(zip.archiveData(), name: ClaudeBridge.normalizedSkillName(name))
    }
}
