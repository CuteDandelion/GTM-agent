import XCTest

final class GTMResearchAgentUITests: XCTestCase {
  private let app = XCUIApplication()

  override func setUpWithError() throws {
    continueAfterFailure = false
    app.launch()
  }

  func testProviderBackedConversationPersistsAcrossRelaunch() throws {
    let environment = ProcessInfo.processInfo.environment
    let email = try XCTUnwrap(environment["NATIVE_E2E_EMAIL"], "NATIVE_E2E_EMAIL is required")
    let password = try XCTUnwrap(environment["NATIVE_E2E_PASSWORD"], "NATIVE_E2E_PASSWORD is required")
    let researchPrompt = "Profile foodbegood.app for AI and agent automation sales fit. Use current web evidence. Focus on company profile, ICP fit, and one evidence-backed opportunity."

    signIn(email: email, password: password)

    if !labeledElement(researchPrompt).waitForExistence(timeout: 5) {
      let emptyState = app.staticTexts["Start a new GTM conversation"]
      XCTAssertTrue(emptyState.waitForExistence(timeout: 30), "A newly authenticated user must start with an empty conversation")

      send("How should I begin profiling a potential client?")
      XCTAssertTrue(element("agent-response").waitForExistence(timeout: 120), "Expected a provider-authored conversational response")

      send(researchPrompt)

      XCTAssertTrue(waitForAny([
        element("waiting-agent-response"),
        element("workflow-progress")
      ], timeout: 30), "Expected visible queued or workflow progress")
    }

    XCTAssertTrue(app.buttons["Evidence"].waitForExistence(timeout: 60), "Expected an evidence-backed research result")

    let followUp = "Which assumption should I verify first before pitching them?"
    let responseCountBeforeFollowUp = app.descendants(matching: .any).matching(identifier: "agent-response").count
    send(followUp)
    XCTAssertTrue(labeledElement(followUp).waitForExistence(timeout: 60), "The contextual follow-up must be accepted and rendered")
    XCTAssertTrue(waitForAgentResponseCount(atLeast: responseCountBeforeFollowUp + 1, timeout: 120), "Expected a new contextual follow-up answer")

    app.terminate()
    app.launch()

    XCTAssertTrue(labeledElement(researchPrompt).waitForExistence(timeout: 45), "Conversation must persist across an app relaunch")
    XCTAssertTrue(labeledElement(followUp).waitForExistence(timeout: 45), "The contextual follow-up must persist across an app relaunch")
  }

  private func signIn(email: String, password: String) {
    let emailField = app.textFields["Email"]
    guard emailField.waitForExistence(timeout: 15) else { return }

    emailField.tap()
    emailField.typeText(email)
    emailField.typeText("\n")

    let passwordField = app.secureTextFields["Password"]
    XCTAssertTrue(passwordField.waitForExistence(timeout: 5))
    passwordField.typeText(password)
    passwordField.typeText("\n")

    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    if springboard.buttons["Not Now"].waitForExistence(timeout: 5) {
      springboard.buttons["Not Now"].tap()
    }
  }

  private func send(_ message: String) {
    let composer = element("message-composer")
    XCTAssertTrue(composer.waitForExistence(timeout: 30), "Message composer is unavailable")
    composer.tap()
    composer.typeText(message)
    composer.typeText("\n")
  }

  private func waitForAny(_ elements: [XCUIElement], timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if elements.contains(where: { $0.exists }) { return true }
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    }
    return false
  }

  private func waitForAgentResponseCount(atLeast expected: Int, timeout: TimeInterval) -> Bool {
    let responses = app.descendants(matching: .any).matching(identifier: "agent-response")
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if responses.count >= expected { return true }
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    }
    return false
  }

  private func element(_ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func labeledElement(_ label: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
  }
}
