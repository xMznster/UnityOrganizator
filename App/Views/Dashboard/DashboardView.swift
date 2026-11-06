import SwiftUI
import SwiftData
import VaultKit

struct DashboardView: View {
    @Environment(VaultStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(SyncService.self) private var sync
    @Query(filter: #Predicate<VaultItem> { $0.deletedAt == nil }, sort: \VaultItem.modifiedAt, order: .reverse) private var items: [VaultItem]
    @Query(filter: #Predicate<Folder> { $0.parent == nil }, sort: [SortDescriptor(\Folder.sortIndex), SortDescriptor(\Folder.name)]) private var projects: [Folder]
    @State private var newScriptTarget: FolderBox?
    @State private var showImport = false
    @State private var newProject: FolderEditTarget?
    @State private var clipboardMessage: String?

    private var scripts: [VaultItem] { items.filter { $0.kind == .script } }
    private var notes: [VaultItem] { items.filter { $0.kind == .note } }
    private var prompts: [VaultItem] { items.filter { $0.kind == .prompt } }
    private var favorites: [VaultItem] { items.filter(\.isFavorite) }
    private var lastOpened: VaultItem? { items.filter { $0.lastOpenedAt != nil }.max { ($0.lastOpenedAt ?? .distantPast) < ($1.lastOpenedAt ?? .distantPast) } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                statsGrid
                quickActions
                if items.isEmpty && projects.isEmpty { onboarding }
                if let last = lastOpened { continueCard(last) }
                if !scripts.isEmpty { recentScripts }
                if !notes.isEmpty || !prompts.isEmpty { recentNotes }
                if !favorites.isEmpty { favoritesSection }
                if !projects.isEmpty { projectsSection }
                if !scripts.isEmpty { statusSection }
                syncCard
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.bottom, 32)
        }
        .vaultBackground()
        .navigationTitle("")
        .toolbar(.hidden, for: .navigationBar)
        .newScriptSheet(target: $newScriptTarget) { router.open($0) }
        .importFiles(isPresented: $showImport, into: nil)
        .sheet(item: $newProject) { FolderEditSheet(target: $0) }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                Text("UNITY DEVELOPER VAULT").font(Theme.label).tracking(2).foregroundStyle(Theme.accent)
                Text(greeting).font(Theme.titleXL).foregroundStyle(Theme.textPrimary)
                Text(Date().formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "de_DE"))))
                    .font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(LinearGradient(colors: [Theme.accent.opacity(0.35), Theme.prompt.opacity(0.25)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 48, height: 48)
                Image(systemName: "curlybraces").font(.system(size: 20, weight: .bold)).foregroundStyle(Theme.textPrimary)
            }
        }
        .padding(.top, 12)
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        switch h {
        case 5..<11: return "Guten Morgen"
        case 11..<17: return "Hallo"
        case 17..<22: return "Guten Abend"
        default: return "Late-Night-Dev"
        }
    }

    // MARK: Stats

    private var statsGrid: some View {
        let errorScripts = scripts.filter { $0.lastErrorCount > 0 }.count
        let lines = scripts.reduce(0) { $0 + $1.content.reduce(into: 1) { if $1 == "\n" { $0 += 1 } } }
        return VStack(spacing: 10) {
            HStack(spacing: 10) {
                StatTile(value: "\(scripts.count)", label: "Skripte", symbol: VaultItemKind.script.symbol, color: Theme.script)
                StatTile(value: "\(notes.count)", label: "Ideen & Notizen", symbol: VaultItemKind.note.symbol, color: Theme.note)
            }
            HStack(spacing: 10) {
                StatTile(value: "\(prompts.count)", label: "Prompts", symbol: VaultItemKind.prompt.symbol, color: Theme.prompt)
                StatTile(value: "\(projects.count)", label: "Projekte", symbol: "square.stack.3d.up", color: Theme.folder)
            }
            HStack(spacing: 8) {
                Image(systemName: errorScripts == 0 ? "checkmark.seal.fill" : "exclamationmark.octagon.fill")
                    .foregroundStyle(errorScripts == 0 ? Theme.success : Theme.error)
                Text(errorScripts == 0 ? "Alle Skripte ohne Syntaxfehler" : "\(errorScripts) Skript\(errorScripts == 1 ? "" : "e") mit Fehlern")
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.textSecondary)
                Spacer()
                Text("\(lines) Zeilen C#").font(Theme.mono(11)).foregroundStyle(Theme.textTertiary)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .cardStyle()
        }
    }

    // MARK: Quick actions

    private var quickActions: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Schnellzugriff")
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                QuickAction(title: "Neue Notiz", subtitle: "Idee festhalten", symbol: "square.and.pencil", color: Theme.note) {
                    router.open(store.createItem(kind: .note, in: nil))
                }
                QuickAction(title: "Neues Skript", subtitle: "Aus Vorlage", symbol: "chevron.left.forwardslash.chevron.right", color: Theme.script) {
                    newScriptTarget = FolderBox(folder: nil)
                }
                QuickAction(title: "Neuer Prompt", subtitle: "Für Claude", symbol: "sparkles", color: Theme.prompt) {
                    router.open(store.createItem(kind: .prompt, in: nil))
                }
                QuickAction(title: "Aus Zwischenablage", subtitle: "C# wird erkannt", symbol: "doc.on.clipboard", color: Theme.accent) {
                    captureClipboard()
                }
            }
            HStack(spacing: 10) {
                Button { showImport = true } label: {
                    Label("Dateien importieren", systemImage: "square.and.arrow.down").font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
                Button { newProject = .new(parent: nil) } label: {
                    Label("Neues Projekt", systemImage: "folder.badge.plus").font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            if let clipboardMessage {
                Text(clipboardMessage).font(.footnote).foregroundStyle(Theme.warning)
            }
        }
    }

    /// Creates an item from the clipboard. C# code becomes a script (named after its class), everything else a note.
    private func captureClipboard() {
        guard let text = UIPasteboard.general.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            clipboardMessage = "Die Zwischenablage enthält keinen Text."
            return
        }
        clipboardMessage = nil
        let report = CSharpAnalyzer().analyze(text)
        let lex = CSharpLexer().lex(text)
        let keywordRatio = Double(lex.tokens.filter { $0.kind == .keyword }.count) / Double(max(1, lex.tokens.filter { $0.kind != .whitespace }.count))
        let looksLikeCode = !report.types.isEmpty || text.contains("using UnityEngine") || (keywordRatio > 0.08 && text.contains(";") && text.contains("{"))
        if looksLikeCode {
            let name = report.types.first(where: { $0.nestingDepth == 0 })?.name ?? "ClipboardScript"
            let item = store.createItem(kind: .script, title: name, content: text, in: nil)
            store.refreshScriptMetadata(item, fillEmptyOnly: true)
            store.save()
            router.open(item)
        } else {
            let lower = text.lowercased()
            let isPrompt = lower.contains("claude") || lower.hasPrefix("you are") || lower.hasPrefix("du bist") || lower.contains("schreibe ein") || lower.contains("write a")
            let title = MarkdownParser.suggestedTitle(text) ?? "Aus Zwischenablage"
            router.open(store.createItem(kind: isPrompt ? .prompt : .note, title: title, content: text, in: nil))
        }
    }

    private var onboarding: some View {
        Card(padding: 18, cornerRadius: Theme.radiusL) {
            VStack(alignment: .leading, spacing: 12) {
                Label("Willkommen in deinem Vault", systemImage: "hand.wave").font(Theme.titleM).foregroundStyle(Theme.textPrimary)
                Text("Alles wird lokal auf deinem iPhone gespeichert und funktioniert offline. Lege eigene Projekte an oder starte mit einer Ordnerstruktur für Horror Game, Monster Game, General Unity, Blender und App Development – alles frei umbenennbar.")
                    .font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                HStack {
                    Button("Startstruktur anlegen") { store.createStarterStructure() }.buttonStyle(PrimaryButtonStyle())
                    Button("Eigenes Projekt") { newProject = .new(parent: nil) }.buttonStyle(SecondaryButtonStyle())
                }
            }
        }
    }

    // MARK: Continue

    private func continueCard(_ item: VaultItem) -> some View {
        Button { router.open(item) } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("WEITERARBEITEN").font(Theme.label).tracking(1.2).foregroundStyle(Theme.accent)
                    Spacer()
                    Text(item.lastOpenedAt?.relativeDescription ?? "").font(Theme.mono(11)).foregroundStyle(Theme.textTertiary)
                }
                HStack(spacing: 10) {
                    IconBadge(symbol: item.kind.symbol, color: Theme.color(for: item.kind), size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.kind == .script ? FileNaming.fileName(for: item.snapshot()) : item.title)
                            .font(item.kind == .script ? Theme.mono(16, .semibold) : .system(size: 17, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary).lineLimit(1)
                        Text(item.locationDescription).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                    }
                }
                if item.kind == .script {
                    CodePeek(code: item.content, lines: 6)
                } else if !item.previewText.isEmpty {
                    Text(item.previewText).font(.system(size: 14)).foregroundStyle(Theme.textSecondary).lineLimit(3)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(colors: [Theme.surfaceElevated, Theme.surface], startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: Theme.radiusL, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusL, style: .continuous).strokeBorder(Theme.accent.opacity(0.25)))
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: Recent

    private var recentScripts: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Zuletzt bearbeitete Skripte", count: scripts.count)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(scripts.prefix(8)) { s in
                        Button { router.open(s) } label: { ScriptCard(item: s) }.buttonStyle(PressableStyle())
                    }
                }
                .padding(.horizontal, 1)
            }
            .scrollClipDisabled()
        }
    }

    private var recentNotes: some View {
        let list = items.filter { $0.kind != .script }.prefix(5)
        return VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Zuletzt bearbeitete Notizen & Prompts")
            VStack(spacing: 0) {
                ForEach(Array(list.enumerated()), id: \.element.id) { i, item in
                    Button { router.open(item) } label: { ItemRow(item: item, showPath: true).padding(.horizontal, 12) }
                        .buttonStyle(PressableStyle())
                    if i < list.count - 1 { Divider().overlay(Theme.stroke).padding(.leading, 62) }
                }
            }
            .padding(.vertical, 6)
            .cardStyle()
        }
    }

    private var favoritesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Favoriten", count: favorites.count)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(favorites.prefix(12)) { f in
                        Button { router.open(f) } label: {
                            HStack(spacing: 8) {
                                Image(systemName: f.kind.symbol).foregroundStyle(Theme.color(for: f.kind))
                                Text(f.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                                Image(systemName: "star.fill").font(.system(size: 9)).foregroundStyle(Theme.amber)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 10)
                            .cardStyle()
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                .padding(.horizontal, 1)
            }
            .scrollClipDisabled()
        }
    }

    private var projectsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Meine Projekte", count: projects.count)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(projects) { p in
                    Button { router.open(p) } label: { ProjectCard(folder: p) }.buttonStyle(PressableStyle())
                }
            }
        }
    }

    private var statusSection: some View {
        let exp = scripts.filter { $0.status == .experimental }.count
        let dev = scripts.filter { $0.status == .inDevelopment || $0.status == nil }.count
        let tested = scripts.filter { $0.status == .tested }.count
        let total = max(1, scripts.count)
        return VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Skript-Status")
            VStack(alignment: .leading, spacing: 12) {
                GeometryReader { geo in
                    HStack(spacing: 3) {
                        Capsule().fill(Theme.color(for: .experimental)).frame(width: max(exp > 0 ? 6 : 0, geo.size.width * CGFloat(exp) / CGFloat(total)))
                        Capsule().fill(Theme.color(for: .inDevelopment)).frame(width: max(dev > 0 ? 6 : 0, geo.size.width * CGFloat(dev) / CGFloat(total)))
                        Capsule().fill(Theme.color(for: .tested)).frame(width: max(tested > 0 ? 6 : 0, geo.size.width * CGFloat(tested) / CGFloat(total)))
                    }
                }
                .frame(height: 10)
                HStack {
                    legend(.experimental, exp)
                    Spacer()
                    legend(.inDevelopment, dev)
                    Spacer()
                    legend(.tested, tested)
                }
            }
            .padding(14)
            .cardStyle()
        }
    }

    private func legend(_ s: ScriptStatus, _ n: Int) -> some View {
        HStack(spacing: 5) {
            Circle().fill(Theme.color(for: s)).frame(width: 8, height: 8)
            Text("\(s.displayName) \(n)").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.textSecondary)
        }
    }

    private var syncCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "PC-Workflow")
            HStack(spacing: 12) {
                IconBadge(symbol: "arrow.triangle.2.circlepath", color: Theme.info, size: 38)
                VStack(alignment: .leading, spacing: 2) {
                    Text(sync.isConfigured ? sync.target.title : "Synchronisierung einrichten").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                    Text(sync.lastSyncDate.map { "Zuletzt \($0.relativeDescription)" } ?? "Mit iCloud Drive, Working Copy oder GitHub")
                        .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                if sync.isConfigured {
                    Button {
                        Task { await sync.sync(store: store) }
                    } label: {
                        if sync.isSyncing { ProgressView() } else { Image(systemName: "arrow.clockwise").font(.system(size: 16, weight: .semibold)) }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(sync.isSyncing)
                    .accessibilityLabel("Jetzt synchronisieren")
                }
            }
            .padding(14)
            .cardStyle()
            if let err = sync.lastError { Text(err).font(.footnote).foregroundStyle(Theme.error) }
        }
    }
}

// MARK: - Dashboard components

struct StatTile: View {
    var value: String
    var label: String
    var symbol: String
    var color: Color

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(symbol: symbol, color: color, size: 36)
            VStack(alignment: .leading, spacing: 0) {
                Text(value).font(Theme.mono(24, .bold)).foregroundStyle(Theme.textPrimary).contentTransition(.numericText())
                Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity)
        .cardStyle()
    }
}

struct QuickAction: View {
    var title: String
    var subtitle: String
    var symbol: String
    var color: Color
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: symbol).font(.system(size: 18, weight: .semibold)).foregroundStyle(color)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                    Text(subtitle).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(colors: [color.opacity(0.16), color.opacity(0.04)], startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: Theme.radiusM, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusM, style: .continuous).strokeBorder(color.opacity(0.25)))
        }
        .buttonStyle(PressableStyle())
        .accessibilityIdentifier("quick." + title)
    }
}

struct ScriptCard: View {
    let item: VaultItem
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "chevron.left.forwardslash.chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.script)
                Text(FileNaming.fileName(for: item.snapshot())).font(Theme.mono(13, .semibold)).foregroundStyle(Theme.textPrimary).lineLimit(1)
            }
            CodePeek(code: item.content, lines: 4)
            HStack(spacing: 6) {
                if let s = item.status { Circle().fill(Theme.color(for: s)).frame(width: 7, height: 7); Text(s.displayName).font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
                Spacer()
                if item.lastErrorCount > 0 {
                    Label("\(item.lastErrorCount)", systemImage: "xmark.octagon.fill").labelStyle(CompactLabelStyle()).font(Theme.mono(10, .semibold)).foregroundStyle(Theme.error)
                }
            }
        }
        .padding(12)
        .frame(width: 230, alignment: .leading)
        .cardStyle()
    }
}

/// A few syntax highlighted lines of a script (skipping `using` lines).
struct CodePeek: View {
    let code: String
    var lines: Int = 5
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let palette: EditorPalette = colorScheme == .dark ? .night : .day
        let all = code.components(separatedBy: "\n")
        let start = all.firstIndex { let t = $0.trimmingCharacters(in: .whitespaces); return !t.hasPrefix("using") && !t.isEmpty } ?? 0
        let snippet = all.dropFirst(start).prefix(lines).joined(separator: "\n")
        Text(highlight(snippet, palette: palette))
            .font(Theme.mono(10.5))
            .lineLimit(lines)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
            .background(Color(uiColor: palette.background).opacity(0.8), in: RoundedRectangle(cornerRadius: 8))
    }

    private func highlight(_ s: String, palette: EditorPalette) -> AttributedString {
        var attr = AttributedString(s)
        attr.foregroundColor = Color(uiColor: palette.text)
        for t in CSharpLexer().lex(s).tokens where t.kind != .whitespace && t.kind != .identifier {
            if let r = Range<AttributedString.Index>(t.range, in: attr) { attr[r].foregroundColor = Color(uiColor: palette.color(for: t.kind)) }
        }
        return attr
    }
}

struct ProjectCard: View {
    let folder: Folder
    var body: some View {
        let color = Theme.folderColor(folder.colorHex)
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: folder.icon).font(.system(size: 18, weight: .semibold)).foregroundStyle(color)
                Spacer()
                if folder.isFavorite { Image(systemName: "star.fill").font(.system(size: 10)).foregroundStyle(Theme.amber) }
            }
            Text(folder.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.textPrimary).lineLimit(1)
            Text("\(folder.totalItemCount) Einträge · \(folder.children.count) Ordner").font(Theme.mono(10)).foregroundStyle(Theme.textTertiary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [color.opacity(0.13), Theme.surface], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: Theme.radiusM, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusM, style: .continuous).strokeBorder(color.opacity(0.22)))
    }
}
