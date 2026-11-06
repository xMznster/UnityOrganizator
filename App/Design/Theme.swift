import SwiftUI
import UIKit
import VaultKit

// MARK: - Color tokens

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }

    static func adaptive(dark: UInt32, light: UInt32) -> UIColor {
        UIColor { $0.userInterfaceStyle == .light ? UIColor(hex: light) : UIColor(hex: dark) }
    }

    convenience init?(hexString: String) {
        var s = hexString.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(hex: v)
    }
}

/// The "Vault" design system. Dark-first IDE aesthetic with adaptive light variants.
enum Theme {
    // Surfaces
    static let background = Color(uiColor: .adaptive(dark: 0x090B0F, light: 0xF3F4F7))
    static let surface = Color(uiColor: .adaptive(dark: 0x10131A, light: 0xFFFFFF))
    static let surfaceElevated = Color(uiColor: .adaptive(dark: 0x161A23, light: 0xF8F9FB))
    static let surfaceHighlight = Color(uiColor: .adaptive(dark: 0x1D2230, light: 0xEDEFF4))
    static let stroke = Color(uiColor: .adaptive(dark: 0x232836, light: 0xE1E4EA))
    static let strokeStrong = Color(uiColor: .adaptive(dark: 0x323949, light: 0xCDD2DB))

    // Text
    static let textPrimary = Color(uiColor: .adaptive(dark: 0xE8EAF0, light: 0x14171F))
    static let textSecondary = Color(uiColor: .adaptive(dark: 0x8A93A6, light: 0x5B6372))
    static let textTertiary = Color(uiColor: .adaptive(dark: 0x596173, light: 0x99A0AD))

    // Accents
    static let accent = Color(uiColor: .adaptive(dark: 0x4FD1C5, light: 0x0E9488))
    static let accentSoft = Color(uiColor: .adaptive(dark: 0x4FD1C5, light: 0x0E9488)).opacity(0.14)
    static let amber = Color(uiColor: .adaptive(dark: 0xF7B955, light: 0xC27C0E))
    static let error = Color(uiColor: .adaptive(dark: 0xFF5C6C, light: 0xD92D3F))
    static let warning = Color(uiColor: .adaptive(dark: 0xF7B955, light: 0xB7791F))
    static let info = Color(uiColor: .adaptive(dark: 0x6CB6FF, light: 0x2F6FDB))
    static let success = Color(uiColor: .adaptive(dark: 0x5BD69A, light: 0x18925A))

    // Content kinds
    static let note = Color(uiColor: .adaptive(dark: 0x7AA2F7, light: 0x3B6FE0))
    static let prompt = Color(uiColor: .adaptive(dark: 0xC792EA, light: 0x8B4FC9))
    static let script = Color(uiColor: .adaptive(dark: 0x8BD5A0, light: 0x1E9A4F))
    static let folder = Color(uiColor: .adaptive(dark: 0xF7B955, light: 0xC27C0E))

    static func color(for kind: VaultItemKind) -> Color {
        switch kind {
        case .note: return note
        case .prompt: return prompt
        case .script: return script
        }
    }

    static func color(for severity: DiagnosticSeverity) -> Color {
        switch severity {
        case .error: return error
        case .warning: return warning
        case .info: return info
        }
    }

    static func color(for status: ScriptStatus) -> Color {
        switch status {
        case .experimental: return prompt
        case .inDevelopment: return amber
        case .tested: return success
        }
    }

    /// Palette offered for folders/projects.
    static let folderPalette: [String] = ["#4FD1C5", "#7AA2F7", "#C792EA", "#F7B955", "#FF7A90", "#8BD5A0", "#F78C6C", "#89DDFF"]

    static func folderColor(_ hex: String) -> Color {
        if let ui = UIColor(hexString: hex) { return Color(uiColor: ui) }
        return folder
    }

    // MARK: Typography
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
    static let label = Font.system(size: 11, weight: .semibold, design: .monospaced)
    static let titleXL = Font.system(size: 32, weight: .bold, design: .default)
    static let titleL = Font.system(size: 22, weight: .bold, design: .default)
    static let titleM = Font.system(size: 17, weight: .semibold, design: .default)
    static let body = Font.system(size: 15, weight: .regular)
    static let caption = Font.system(size: 12, weight: .medium)

    // MARK: Metrics
    static let radiusL: CGFloat = 20
    static let radiusM: CGFloat = 14
    static let radiusS: CGFloat = 9
    static let gutter: CGFloat = 16
}

// MARK: - Editor themes

struct EditorPalette {
    var background: UIColor
    var text: UIColor
    var gutterText: UIColor
    var gutterActive: UIColor
    var gutterBackground: UIColor
    var currentLine: UIColor
    var selectionMatch: UIColor
    var findMatch: UIColor
    var bracket: UIColor
    var colors: [CSharpTokenKind: UIColor]
    var markdownHeading: UIColor
    var markdownMarker: UIColor
    var markdownCode: UIColor
    var markdownQuote: UIColor
    var markdownLink: UIColor
    var isDark: Bool

    func color(for kind: CSharpTokenKind) -> UIColor { colors[kind] ?? text }

    static let night = EditorPalette(
        background: UIColor(hex: 0x0C0F15), text: UIColor(hex: 0xD8DEE9), gutterText: UIColor(hex: 0x3A4152),
        gutterActive: UIColor(hex: 0x9AA4B8), gutterBackground: UIColor(hex: 0x0C0F15),
        currentLine: UIColor(hex: 0x4FD1C5, alpha: 0.06), selectionMatch: UIColor(hex: 0x4FD1C5, alpha: 0.18),
        findMatch: UIColor(hex: 0xF7B955, alpha: 0.35), bracket: UIColor(hex: 0x4FD1C5, alpha: 0.35),
        colors: [
            .keyword: UIColor(hex: 0xC678DD), .contextualKeyword: UIColor(hex: 0xC678DD),
            .typeName: UIColor(hex: 0x4FD1C5), .methodName: UIColor(hex: 0x82AAFF),
            .string: UIColor(hex: 0xC3E88D), .char: UIColor(hex: 0xC3E88D), .number: UIColor(hex: 0xF78C6C),
            .comment: UIColor(hex: 0x5C6678), .docComment: UIColor(hex: 0x6B7A8F), .preprocessor: UIColor(hex: 0xFFCB6B),
            .attribute: UIColor(hex: 0xFFCB6B), .operator: UIColor(hex: 0x89DDFF), .punctuation: UIColor(hex: 0x8F9BB3),
            .identifier: UIColor(hex: 0xD8DEE9), .invalid: UIColor(hex: 0xFF5C6C)
        ],
        markdownHeading: UIColor(hex: 0x4FD1C5), markdownMarker: UIColor(hex: 0xC678DD), markdownCode: UIColor(hex: 0xC3E88D),
        markdownQuote: UIColor(hex: 0x8A93A6), markdownLink: UIColor(hex: 0x82AAFF), isDark: true)

    static let day = EditorPalette(
        background: UIColor(hex: 0xFBFBFC), text: UIColor(hex: 0x24292F), gutterText: UIColor(hex: 0xB4BAC4),
        gutterActive: UIColor(hex: 0x4B5563), gutterBackground: UIColor(hex: 0xFBFBFC),
        currentLine: UIColor(hex: 0x0E9488, alpha: 0.06), selectionMatch: UIColor(hex: 0x0E9488, alpha: 0.15),
        findMatch: UIColor(hex: 0xF59E0B, alpha: 0.35), bracket: UIColor(hex: 0x0E9488, alpha: 0.30),
        colors: [
            .keyword: UIColor(hex: 0xA626A4), .contextualKeyword: UIColor(hex: 0xA626A4),
            .typeName: UIColor(hex: 0x0E8A82), .methodName: UIColor(hex: 0x4078F2),
            .string: UIColor(hex: 0x50A14F), .char: UIColor(hex: 0x50A14F), .number: UIColor(hex: 0xC2410C),
            .comment: UIColor(hex: 0x9CA3AF), .docComment: UIColor(hex: 0x8B95A5), .preprocessor: UIColor(hex: 0x986801),
            .attribute: UIColor(hex: 0x986801), .operator: UIColor(hex: 0x0184BC), .punctuation: UIColor(hex: 0x5B6372),
            .identifier: UIColor(hex: 0x24292F), .invalid: UIColor(hex: 0xD92D3F)
        ],
        markdownHeading: UIColor(hex: 0x0E8A82), markdownMarker: UIColor(hex: 0xA626A4), markdownCode: UIColor(hex: 0x50A14F),
        markdownQuote: UIColor(hex: 0x6B7280), markdownLink: UIColor(hex: 0x4078F2), isDark: false)
}

// MARK: - Settings

enum AppearanceMode: String, CaseIterable, Identifiable {
    case dark, light, system
    var id: String { rawValue }
    var title: String {
        switch self {
        case .dark: return "Dunkel"
        case .light: return "Hell"
        case .system: return "System"
        }
    }
    var colorScheme: ColorScheme? {
        switch self {
        case .dark: return .dark
        case .light: return .light
        case .system: return nil
        }
    }
}

enum EditorThemeChoice: String, CaseIterable, Identifiable {
    case night, day, automatic
    var id: String { rawValue }
    var title: String {
        switch self {
        case .night: return "Vault Night (dunkel)"
        case .day: return "Vault Day (hell)"
        case .automatic: return "Wie App"
        }
    }
    func palette(for scheme: ColorScheme) -> EditorPalette {
        switch self {
        case .night: return .night
        case .day: return .day
        case .automatic: return scheme == .dark ? .night : .day
        }
    }
}

/// Keys for @AppStorage, centralised so they are never misspelled.
enum SettingsKey {
    static let appearance = "appearance"
    static let editorTheme = "editor.theme"
    static let editorFontSize = "editor.fontSize"
    static let editorTabWidth = "editor.tabWidth"
    static let editorUseTabs = "editor.useTabs"
    static let editorAutoPair = "editor.autoPair"
    static let editorLineNumbers = "editor.lineNumbers"
    static let editorLiveAnalysis = "editor.liveAnalysis"
    static let defaultUnityVersion = "unity.defaultVersion"
    static let compilerURL = "compiler.url"
    static let syncOnLaunch = "sync.onLaunch"
    static let onboardingDone = "onboarding.done"
}
