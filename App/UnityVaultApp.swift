import SwiftUI
import SwiftData
import VaultKit

@main
struct UnityVaultApp: App {
    let container: ModelContainer
    @State private var store: VaultStore
    @State private var sync = SyncService()

    init() {
        let schema = Schema([Folder.self, VaultItem.self, Revision.self])
        let inMemory = ProcessInfo.processInfo.arguments.contains("-uiTestingInMemory")
        let config = ModelConfiguration("UnityVault", schema: schema, isStoredInMemoryOnly: inMemory)
        do {
            container = try ModelContainer(for: schema, configurations: [config])
        } catch {
            // Never silently wipe user data: fall back to an in-memory store and tell the user.
            container = try! ModelContainer(for: schema, configurations: [ModelConfiguration(isStoredInMemoryOnly: true)])
            UserDefaults.standard.set(error.localizedDescription, forKey: "store.openError")
        }
        container.mainContext.autosaveEnabled = true
        _store = State(initialValue: VaultStore(context: container.mainContext))
        if ProcessInfo.processInfo.arguments.contains("-uiTestingReset") {
            for key in ["onboarding.done", "sync.folderBookmark", "sync.target"] { UserDefaults.standard.removeObject(forKey: key) }
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(sync)
        }
        .modelContainer(container)
    }
}

struct RootView: View {
    @Environment(VaultStore.self) private var store
    @Environment(SyncService.self) private var sync
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(SettingsKey.appearance) private var appearance = AppearanceMode.dark.rawValue
    @AppStorage(SettingsKey.syncOnLaunch) private var syncOnLaunch = false
    @State private var tab: AppTab = .home
    @State private var homeRouter = Router()
    @State private var vaultRouter = Router()
    @State private var searchRouter = Router()
    @State private var workflowRouter = Router()
    @State private var storeError: String? = UserDefaults.standard.string(forKey: "store.openError")

    enum AppTab: Hashable { case home, vault, search, workflow, settings }

    var body: some View {
        TabView(selection: $tab) {
            Tab("Home", systemImage: "square.grid.2x2", value: AppTab.home) {
                NavigationStack(path: Bindable(homeRouter).path) {
                    DashboardView().vaultDestinations()
                }
                .environment(homeRouter)
            }
            Tab("Vault", systemImage: "folder", value: AppTab.vault) {
                NavigationStack(path: Bindable(vaultRouter).path) {
                    VaultRootView().vaultDestinations()
                }
                .environment(vaultRouter)
            }
            Tab("PC & Claude", systemImage: "desktopcomputer", value: AppTab.workflow) {
                NavigationStack(path: Bindable(workflowRouter).path) {
                    WorkflowView().vaultDestinations()
                }
                .environment(workflowRouter)
            }
            Tab("Einstellungen", systemImage: "gearshape", value: AppTab.settings) {
                NavigationStack {
                    SettingsView().vaultDestinations()
                }
                .environment(Router())
            }
            Tab(value: AppTab.search, role: .search) {
                NavigationStack(path: Bindable(searchRouter).path) {
                    SearchView().vaultDestinations()
                }
                .environment(searchRouter)
            }
        }
        .tint(Theme.accent)
        .preferredColorScheme((AppearanceMode(rawValue: appearance) ?? .dark).colorScheme)
        .overlay(alignment: .top) {
            if let toast = store.toast {
                ToastView(text: toast.text, symbol: toast.symbol)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .id(toast.id)
                    .task(id: toast.id) {
                        try? await Task.sleep(nanoseconds: 1_800_000_000)
                        withAnimation(.easeOut(duration: 0.25)) { if store.toast?.id == toast.id { store.toast = nil } }
                    }
            }
        }
        .alert("Hinweis", isPresented: Binding(get: { store.lastError != nil }, set: { if !$0 { store.lastError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(store.lastError ?? "") }
        .alert("Datenbank konnte nicht geöffnet werden", isPresented: Binding(get: { storeError != nil }, set: { if !$0 { storeError = nil; UserDefaults.standard.removeObject(forKey: "store.openError") } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Die App läuft vorübergehend mit einem leeren Speicher, damit nichts überschrieben wird. Bitte Exporte prüfen. Fehler: \(storeError ?? "")")
        }
        .task {
            if syncOnLaunch && sync.isConfigured { await sync.sync(store: store) }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { store.save() }
        }
    }
}
