// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "VaultKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "VaultKit", targets: ["VaultKit"])
    ],
    targets: [
        .target(name: "VaultKit", path: "Sources/VaultKit"),
        .testTarget(name: "VaultKitTests", dependencies: ["VaultKit"], path: "Tests/VaultKitTests")
    ]
)
