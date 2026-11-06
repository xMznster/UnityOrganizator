import SwiftUI
import VaultKit

struct SettingsView: View {
    @Environment(VaultStore.self) private var store
    @AppStorage(SettingsKey.appearance) private var appearance = AppearanceMode.dark.rawValue
    @AppStorage(SettingsKey.editorTheme) private var editorTheme = EditorThemeChoice.night.rawValue
    @AppStorage(SettingsKey.editorFontSize) private var fontSize = 14.0
    @AppStorage(SettingsKey.editorTabWidth) private var tabWidth = 4
    @AppStorage(SettingsKey.editorUseTabs) private var useTabs = false
    @AppStorage(SettingsKey.editorAutoPair) private var autoPair = true
    @AppStorage(SettingsKey.editorLineNumbers) private var lineNumbers = true
    @AppStorage(SettingsKey.editorLiveAnalysis) private var liveAnalysis = true
    @AppStorage(SettingsKey.defaultUnityVersion) private var unityVersion = ""
    @State private var stats = VaultStore.Stats()

    var body: some View {
        Form {
            Section("Darstellung") {
                Picker("App-Design", selection: $appearance) {
                    ForEach(AppearanceMode.allCases) { Text($0.title).tag($0.rawValue) }
                }
                Picker("Editor-Theme", selection: $editorTheme) {
                    ForEach(EditorThemeChoice.allCases) { Text($0.title).tag($0.rawValue) }
                }
            }
            Section {
                Stepper("Schriftgröße: \(Int(fontSize)) pt", value: $fontSize, in: 9...28, step: 1)
                Stepper("Einrückung: \(tabWidth) Leerzeichen", value: $tabWidth, in: 2...8, step: 1).disabled(useTabs)
                Toggle("Tabs statt Leerzeichen", isOn: $useTabs)
                Toggle("Klammern & Anführungszeichen automatisch schließen", isOn: $autoPair)
                Toggle("Zeilennummern", isOn: $lineNumbers)
                Toggle("Live-Analyse beim Tippen", isOn: $liveAnalysis)
                CodeBlockView(language: "csharp", code: "void Update()\n{\n    // Vorschau \(Int(fontSize)) pt\n    transform.Rotate(0f, 90f * Time.deltaTime, 0f);\n}")
            } header: { Text("Code-Editor") } footer: { Text("Tipp: Im Editor mit zwei Fingern zoomen, um die Schriftgröße zu ändern.") }
            Section("Unity") {
                TextField("Standard-Unity-Version für neue Skripte", text: $unityVersion).textInputAutocapitalization(.never)
            }
            Section("Daten") {
                LabeledContent("Skripte", value: "\(stats.scripts) (\(stats.totalLines) Zeilen)")
                LabeledContent("Notizen", value: "\(stats.notes)")
                LabeledContent("Prompts", value: "\(stats.prompts)")
                LabeledContent("Ordner", value: "\(stats.folders) (\(stats.projects) Projekte)")
                NavigationLink("Papierkorb") { TrashView() }
                Text("Alle Inhalte liegen lokal in einer SwiftData-Datenbank auf diesem iPhone und sind offline verfügbar. Änderungen werden automatisch gespeichert.")
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
            }
            Section("Über") {
                LabeledContent("App", value: "Unity Developer Vault")
                LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")
                Text("Analyse-Engine, Sync-Engine und Exporte stammen aus dem Paket VaultKit (plattformunabhängig, mit Unit-Tests). Details: docs/ARCHITECTURE.md im Repository.")
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
            }
        }
        .scrollContentBackground(.hidden)
        .vaultBackground()
        .navigationTitle("Einstellungen")
        .onAppear { stats = store.stats() }
    }
}
