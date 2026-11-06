import SwiftUI
import VaultKit

// MARK: - Containers

struct Card<Content: View>: View {
    var padding: CGFloat = 14
    var cornerRadius: CGFloat = Theme.radiusM
    var fill: Color = Theme.surface
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

/// Monospaced IDE-style section header: `// RECENT SCRIPTS ──── action`
struct SectionHeader: View {
    var title: String
    var count: Int? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 8) {
            Text("//").font(Theme.label).foregroundStyle(Theme.accent)
            Text(title.uppercased()).font(Theme.label).tracking(1.2).foregroundStyle(Theme.textSecondary)
            if let count { Text("\(count)").font(Theme.label).foregroundStyle(Theme.textTertiary) }
            Rectangle().fill(Theme.stroke).frame(height: 1)
            if let actionTitle, let action {
                Button(actionTitle, action: action).font(Theme.caption).foregroundStyle(Theme.accent)
            }
        }
        .padding(.horizontal, 2)
    }
}

struct IconBadge: View {
    var symbol: String
    var color: Color
    var size: CGFloat = 34

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.44, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: size, height: size)
            .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
    }
}

struct Chip: View {
    var text: String
    var symbol: String? = nil
    var color: Color = Theme.textSecondary
    var selected = false

    var body: some View {
        HStack(spacing: 4) {
            if let symbol { Image(systemName: symbol).font(.system(size: 10, weight: .semibold)) }
            Text(text).font(.system(size: 12, weight: .medium)).lineLimit(1)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .foregroundStyle(selected ? Theme.background : color)
        .background(selected ? color : color.opacity(0.12), in: Capsule())
    }
}

struct TagChip: View {
    var tag: String
    var body: some View {
        Text("#" + tag)
            .font(Theme.mono(11, .medium))
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Theme.surfaceHighlight, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

struct StatusPill: View {
    var status: ScriptStatus
    var compact = false
    var body: some View {
        Chip(text: compact ? "" : status.displayName, symbol: status.symbol, color: Theme.color(for: status))
    }
}

struct EmptyStateView: View {
    var symbol: String
    var title: String
    var message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(Theme.accentSoft)
                    .frame(width: 76, height: 76)
                Image(systemName: symbol).font(.system(size: 30, weight: .semibold)).foregroundStyle(Theme.accent)
            }
            Text(title).font(Theme.titleM).foregroundStyle(Theme.textPrimary)
            Text(message).font(Theme.body).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
            if let actionTitle, let action {
                Button(action: action) { Text(actionTitle).font(.system(size: 15, weight: .semibold)) }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.top, 4)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Buttons

struct PrimaryButtonStyle: ButtonStyle {
    var color: Color = Theme.accent
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 18).padding(.vertical, 11)
            .foregroundStyle(Color.black.opacity(0.85))
            .background(color, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 14).padding(.vertical, 10)
            .foregroundStyle(Theme.textPrimary)
            .background(Theme.surfaceHighlight, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.stroke))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.75), value: configuration.isPressed)
    }
}

// MARK: - Tag editor

struct TagEditor: View {
    @Binding var tags: [String]
    var suggestions: [String] = []
    @State private var input = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            FlowLayout(spacing: 6) {
                ForEach(tags, id: \.self) { tag in
                    Button {
                        withAnimation(.snappy) { tags.removeAll { $0 == tag } }
                    } label: {
                        HStack(spacing: 4) {
                            Text("#" + tag).font(Theme.mono(12, .medium))
                            Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
                        }
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .foregroundStyle(Theme.accent)
                        .background(Theme.accentSoft, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                TextField("Tag hinzufügen", text: $input)
                    .font(Theme.mono(13))
                    .focused($focused)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit(commit)
                    .frame(minWidth: 120)
            }
            let filtered = suggestions.filter { s in !tags.contains(where: { $0.lowercased() == s.lowercased() }) &&
                (input.isEmpty || s.lowercased().contains(input.lowercased())) }.prefix(12)
            if !filtered.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array(filtered), id: \.self) { s in
                            Button { withAnimation(.snappy) { tags.append(s); input = "" } } label: { TagChip(tag: s) }
                                .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private func commit() {
        let new = TextUtil.parseTags(input)
        for t in new where !tags.contains(where: { $0.lowercased() == t.lowercased() }) { tags.append(t) }
        input = ""
        focused = true
    }
}

/// Simple flow layout for chips.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, width: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            width = max(width, x)
        }
        return CGSize(width: min(width, maxWidth), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX && x > bounds.minX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - Misc

extension View {
    /// Standard screen background.
    func vaultBackground() -> some View {
        self.background(Theme.background.ignoresSafeArea())
    }

    func cardStyle() -> some View {
        self.background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radiusM, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusM, style: .continuous).strokeBorder(Theme.stroke))
    }
}

extension Date {
    var relativeDescription: String {
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.unitsStyle = .short
        return f.localizedString(for: self, relativeTo: Date())
    }
    var shortDateTime: String {
        formatted(.dateTime.day().month(.abbreviated).year().hour().minute().locale(Locale(identifier: "de_DE")))
    }
}

/// Toast-like transient message.
struct ToastView: View {
    var text: String
    var symbol: String = "checkmark.circle.fill"
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).foregroundStyle(Theme.accent)
            Text(text).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.textPrimary)
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.stroke))
        .shadow(color: .black.opacity(0.25), radius: 12, y: 6)
    }
}
