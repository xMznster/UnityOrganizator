import Foundation

/// Minimal, dependency-free ZIP archive writer (PKZIP 2.0, "stored" entries, UTF-8 names).
///
/// Content is stored uncompressed: exported vaults are small text files and storing guarantees
/// byte-exact round trips of C# sources, which is the most important property for export.
public struct ZipWriter {
    public struct Entry {
        public var path: String
        public var data: Data
        public var modified: Date
        public init(path: String, data: Data, modified: Date = Date()) {
            self.path = path; self.data = data; self.modified = modified
        }
    }

    private(set) public var entries: [Entry] = []
    private var usedPaths = Set<String>()

    public init() {}

    /// Adds a file. Paths use '/' separators. Duplicate paths get a numeric suffix so that no
    /// content is ever silently overwritten. Returns the final path.
    @discardableResult
    public mutating func add(path: String, data: Data, modified: Date = Date()) -> String {
        var p = path.replacingOccurrences(of: "\\", with: "/")
        while p.hasPrefix("/") { p.removeFirst() }
        p = ZipWriter.uniquePath(p, used: usedPaths)
        usedPaths.insert(p.lowercased())
        entries.append(Entry(path: p, data: data, modified: modified))
        return p
    }

    @discardableResult
    public mutating func add(path: String, text: String, modified: Date = Date()) -> String {
        add(path: path, data: Data(text.utf8), modified: modified)
    }

    /// Adds an explicit directory entry (useful for empty folders).
    public mutating func addDirectory(_ path: String) {
        var p = path
        if !p.hasSuffix("/") { p += "/" }
        guard !usedPaths.contains(p.lowercased()) else { return }
        usedPaths.insert(p.lowercased())
        entries.append(Entry(path: p, data: Data(), modified: Date()))
    }

    public static func uniquePath(_ p: String, used: Set<String>) -> String {
        guard used.contains(p.lowercased()) else { return p }
        let ns = p as NSString
        let ext = ns.pathExtension
        let base = ext.isEmpty ? p : ns.deletingPathExtension
        var n = 2
        while true {
            let candidate = ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)"
            if !used.contains(candidate.lowercased()) { return candidate }
            n += 1
        }
    }

    static func dosDateTime(_ date: Date) -> (UInt16, UInt16) {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone.current
        let c = cal.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let year: Int = max(1980, c.year ?? 1980)
        let hour: Int = c.hour ?? 0, minute: Int = c.minute ?? 0, second: Int = c.second ?? 0
        let month: Int = c.month ?? 1, dayOfMonth: Int = c.day ?? 1
        let timeValue: Int = (hour << 11) | (minute << 5) | (second / 2)
        let dateValue: Int = ((year - 1980) << 9) | (month << 5) | dayOfMonth
        let time = UInt16(truncatingIfNeeded: timeValue)
        let day = UInt16(truncatingIfNeeded: dateValue)
        return (time, day)
    }

    public func archiveData() -> Data {
        var out = Data()
        var central = Data()
        func le16(_ v: UInt16, _ d: inout Data) { d.append(UInt8(v & 0xFF)); d.append(UInt8(v >> 8)) }
        func le32(_ v: UInt32, _ d: inout Data) { for s in [0, 8, 16, 24] { d.append(UInt8((v >> UInt32(s)) & 0xFF)) } }

        for e in entries {
            let name = Data(e.path.utf8)
            let crc = CRC32.checksum(e.data)
            let (time, date) = ZipWriter.dosDateTime(e.modified)
            let offset = UInt32(out.count)
            let isDir = e.path.hasSuffix("/")
            // Local file header
            le32(0x04034b50, &out)
            le16(20, &out)            // version needed
            le16(0x0800, &out)        // flags: UTF-8 names
            le16(0, &out)             // method: stored
            le16(time, &out); le16(date, &out)
            le32(crc, &out)
            le32(UInt32(e.data.count), &out); le32(UInt32(e.data.count), &out)
            le16(UInt16(name.count), &out); le16(0, &out)
            out.append(name)
            out.append(e.data)
            // Central directory header
            le32(0x02014b50, &central)
            le16(0x031E, &central)    // made by: UNIX, v3.0
            le16(20, &central)
            le16(0x0800, &central)
            le16(0, &central)
            le16(time, &central); le16(date, &central)
            le32(crc, &central)
            le32(UInt32(e.data.count), &central); le32(UInt32(e.data.count), &central)
            le16(UInt16(name.count), &central)
            le16(0, &central); le16(0, &central); le16(0, &central); le16(0, &central)
            let mode: UInt32 = isDir ? (0o040755 << 16) | 0x10 : (0o100644 << 16)
            le32(mode, &central)
            le32(offset, &central)
            central.append(name)
        }
        let cdOffset = UInt32(out.count)
        out.append(central)
        // End of central directory
        le32(0x06054b50, &out)
        le16(0, &out); le16(0, &out)
        le16(UInt16(entries.count), &out); le16(UInt16(entries.count), &out)
        le32(UInt32(central.count), &out)
        le32(cdOffset, &out)
        le16(0, &out)
        return out
    }
}

/// Minimal ZIP reader for archives with stored or deflated entries is out of scope; for importing
/// we only need to read archives produced by `ZipWriter` (stored entries).
public enum ZipReader {
    public struct Entry { public var path: String; public var data: Data }

    public static func read(_ data: Data) -> [Entry]? {
        let bytes = [UInt8](data)
        func u16(_ o: Int) -> Int { Int(bytes[o]) | Int(bytes[o + 1]) << 8 }
        func u32(_ o: Int) -> Int { u16(o) | u16(o + 2) << 16 }
        guard bytes.count >= 22 else { return nil }
        var eocd = -1
        var i = bytes.count - 22
        while i >= max(0, bytes.count - 65557) {
            if u32(i) == 0x06054b50 { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { return nil }
        let count = u16(eocd + 10)
        var p = u32(eocd + 16)
        var result: [Entry] = []
        for _ in 0..<count {
            guard p + 46 <= bytes.count, u32(p) == 0x02014b50 else { return nil }
            let method = u16(p + 10)
            let compSize = u32(p + 20)
            let nameLen = u16(p + 28), extraLen = u16(p + 30), commentLen = u16(p + 32)
            let localOffset = u32(p + 42)
            let name = String(decoding: bytes[(p + 46)..<(p + 46 + nameLen)], as: UTF8.self)
            guard method == 0 else { return nil }
            let lnameLen = u16(localOffset + 26), lextraLen = u16(localOffset + 28)
            let start = localOffset + 30 + lnameLen + lextraLen
            guard start + compSize <= bytes.count else { return nil }
            if !name.hasSuffix("/") {
                result.append(Entry(path: name, data: Data(bytes[start..<(start + compSize)])))
            }
            p += 46 + nameLen + extraLen + commentLen
        }
        return result
    }
}
