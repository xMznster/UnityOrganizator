import XCTest

/// End-to-end tests that run the real app in the simulator.
final class UnityVaultUITests: XCTestCase {

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ args: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += args
        app.launch()
        return app
    }

    private func screenshot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    /// A note written in the app must survive terminating and relaunching the app.
    func testNotePersistsAcrossRelaunch() throws {
        let marker = "Persist\(Int.random(in: 10000...99999))"
        var app = launch()
        screenshot(app, "01-dashboard")
        let quick = app.buttons["quick.Neue Notiz"]
        XCTAssertTrue(quick.waitForExistence(timeout: 10))
        quick.tap()

        let editor = app.textViews["noteEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText("# \(marker)\nSpider Leg Animation mit IK.\n- Raycasts\n")
        screenshot(app, "02-note-editor")
        // Leave the editor (flushes to the database).
        app.navigationBars.buttons.element(boundBy: 0).tap()
        sleep(1)

        app.terminate()
        app = launch()
        let restored = app.staticTexts[marker]
        XCTAssertTrue(restored.waitForExistence(timeout: 10), "Note was not persisted across relaunch")
        screenshot(app, "03-after-relaunch")
    }

    func testCreateScriptFromTemplateShowsAnalysis() throws {
        let app = launch()
        let quick = app.buttons["quick.Neues Skript"]
        XCTAssertTrue(quick.waitForExistence(timeout: 10))
        quick.tap()
        let field = app.textFields["scriptNameField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        let name = "SpiderLeg\(Int.random(in: 100...999))"
        field.typeText(name)
        screenshot(app, "04-new-script")
        app.buttons["Erstellen"].tap()

        let editor = app.textViews["codeEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        let value = editor.value as? String ?? ""
        XCTAssertTrue(value.contains("public class \(name) : MonoBehaviour"), "Template not rendered: \(value.prefix(200))")
        // Introduce a syntax error and wait for the live analysis.
        editor.tap()
        editor.typeText("int broken = 5\n")
        sleep(2)
        screenshot(app, "05-script-editor")
        let analysis = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Analyse:' AND NOT (label BEGINSWITH 'Analyse: 0 Fehler')")).firstMatch
        XCTAssertTrue(analysis.waitForExistence(timeout: 6), "Live analysis did not report the syntax error")
    }

    func testCreateProjectFolder() throws {
        let app = launch()
        app.tabBars.buttons["Vault"].tap()
        let add = app.navigationBars.buttons["Neu"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        app.buttons["Neues Projekt"].tap()
        let field = app.textFields["folderNameField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        let name = "Monster \(Int.random(in: 100...999))"
        field.typeText(name)
        app.buttons["Anlegen"].tap()
        XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 5))
        screenshot(app, "06-vault")
    }
}
