import XCTest

final class GTMResearchAgentUITests: XCTestCase {
  private let app = XCUIApplication()

  override func setUpWithError() throws {
    continueAfterFailure = false
    app.launch()
  }

  func testProviderBackedConversationPersistsAcrossRelaunch() throws {
    let environment = ProcessInfo.processInfo.environment
    let mode = try XCTUnwrap(environment["NATIVE_E2E_MODE"], "NATIVE_E2E_MODE must be local or provider")
    try XCTSkipUnless(mode == "provider", "Set NATIVE_E2E_MODE=provider for the paid provider journey")
    let email = try XCTUnwrap(environment["NATIVE_E2E_EMAIL"], "NATIVE_E2E_EMAIL is required")
    let password = try XCTUnwrap(environment["NATIVE_E2E_PASSWORD"], "NATIVE_E2E_PASSWORD is required")
    let researchPrompt = "Profile foodbegood.app for AI and agent automation sales fit. Use current web evidence. Focus on company profile, ICP fit, and one evidence-backed opportunity."
    let queuedFollowUp = "Continue researching the same company and rank which workflow I should discuss first."

    signIn(email: email, password: password)

    if app.staticTexts["Before we research companies, what should I call your business?"].waitForExistence(timeout: 30) {
      for answer in [
        "Dandelion AI Studio",
        "AI and agent automation",
        "Agent orchestration, Workflow automation",
        "Human-approved delivery",
      ] {
        send(answer)
      }
    }

    XCTAssertTrue(app.staticTexts["Start a new GTM conversation"].waitForExistence(timeout: 30), "The provider journey must begin from an empty conversation")

    send(researchPrompt)
    XCTAssertTrue(labeledElement(researchPrompt).waitForExistence(timeout: 60), "The real-company prompt must be accepted and rendered")
    XCTAssertTrue(waitForAny([
      element("waiting-agent-response"),
      element("workflow-progress")
    ], timeout: 30), "Expected genuine queued or agent-phase progress with waiting animation")

    send(queuedFollowUp)
    XCTAssertTrue(labeledElement(queuedFollowUp).waitForExistence(timeout: 60), "The active-run follow-up must remain a distinct turn")
    XCTAssertTrue(app.staticTexts["Queued · position 2"].waitForExistence(timeout: 60), "The follow-up must enter the durable FIFO behind the active run")

    XCTAssertTrue(app.buttons["Evidence"].waitForExistence(timeout: 300), "Expected provider-authored evidence interactive objects")
    XCTAssertTrue(app.buttons["Shortlist"].waitForExistence(timeout: 30), "Expected a provider-authored opportunity interactive object")
    app.buttons["Evidence"].tap()
    XCTAssertTrue(app.buttons["Close evidence"].waitForExistence(timeout: 15), "Provider evidence must be inspectable")
    app.buttons["Close evidence"].tap()

    app.terminate()
    app.launch()

    XCTAssertTrue(labeledElement(researchPrompt).waitForExistence(timeout: 45), "Conversation must persist across an app relaunch")
    XCTAssertTrue(labeledElement(queuedFollowUp).waitForExistence(timeout: 45), "The queued follow-up must persist across an app relaunch")
    XCTAssertTrue(app.buttons["Evidence"].waitForExistence(timeout: 45), "Dynamic interactive objects must persist across an app relaunch")
  }

  func testLocalOnboardingQueueActionFailureAndRelaunchJourney() throws {
    let environment = ProcessInfo.processInfo.environment
    let mode = try XCTUnwrap(environment["NATIVE_E2E_MODE"], "NATIVE_E2E_MODE must be local or provider")
    try XCTSkipUnless(mode == "local", "Set NATIVE_E2E_MODE=local for the deterministic local journey")
    let email = try XCTUnwrap(environment["NATIVE_E2E_EMAIL"], "NATIVE_E2E_EMAIL is required")
    let password = try XCTUnwrap(environment["NATIVE_E2E_PASSWORD"], "NATIVE_E2E_PASSWORD is required")
    let firstPrompt = "Profile foodbegood.app for AI and agent automation sales fit."
    let queuedFollowUp = "Which workflow should I discuss first?"

    let signInButton = app.buttons["Sign in"]
    if signInButton.waitForExistence(timeout: 15) {
      signInButton.tap()
      XCTAssertTrue(app.staticTexts["Enter your email and password."].waitForExistence(timeout: 5), "Empty credentials must fail visibly without a network request")
      signIn(email: email, password: password)
    }

    XCTAssertTrue(app.staticTexts["Before we research companies, what should I call your business?"].waitForExistence(timeout: 30), "The fresh local operator must enter conversational seller onboarding")
    for answer in [
      "Dandelion AI Studio",
      "AI and agent automation",
      "Agent orchestration, Workflow automation",
      "Human-approved delivery",
    ] {
      send(answer)
    }

    XCTAssertTrue(app.staticTexts["Start a new GTM conversation"].waitForExistence(timeout: 30), "Completed onboarding must transition into an empty conversation")

    send(firstPrompt)
    XCTAssertTrue(labeledElement(firstPrompt).waitForExistence(timeout: 30), "The first local research prompt must be accepted")
    XCTAssertTrue(waitForAny([
      element("waiting-agent-response"),
      element("workflow-progress")
    ], timeout: 30), "The local run must expose visible progress")

    send(queuedFollowUp)
    XCTAssertTrue(labeledElement(queuedFollowUp).waitForExistence(timeout: 30), "The follow-up must remain a distinct conversation turn")
    XCTAssertTrue(app.staticTexts["Queued · position 2"].waitForExistence(timeout: 30), "A prompt submitted during the run must expose its FIFO queue position")

    XCTAssertTrue(app.buttons["Evidence"].waitForExistence(timeout: 60), "The deterministic run must publish inspectable evidence")
    app.buttons["Evidence"].tap()
    XCTAssertTrue(app.buttons["Close evidence"].waitForExistence(timeout: 10), "Evidence must open as an interactive object")
    app.buttons["Close evidence"].tap()

    let shortlist = app.buttons["Shortlist"]
    XCTAssertTrue(shortlist.waitForExistence(timeout: 10), "The opportunity must expose a shortlist action")
    shortlist.tap()
    XCTAssertTrue(app.buttons["Shortlisted"].waitForExistence(timeout: 15), "The local action must update the opportunity in place")

    app.terminate()
    app.launch()

    XCTAssertTrue(labeledElement(firstPrompt).waitForExistence(timeout: 45), "The first prompt must survive relaunch")
    XCTAssertTrue(labeledElement(queuedFollowUp).waitForExistence(timeout: 45), "The queued follow-up must survive relaunch")
    XCTAssertTrue(app.buttons["Shortlisted"].waitForExistence(timeout: 45), "The interactive-object action must survive relaunch")
  }

  private func signIn(email: String, password: String) {
    let emailField = app.textFields["Email"]
    guard emailField.waitForExistence(timeout: 15) else { return }

    emailField.tap()
    emailField.clearAndEnterText(email)
    emailField.typeText("\n")

    let passwordField = app.secureTextFields["Password"]
    XCTAssertTrue(passwordField.waitForExistence(timeout: 5))
    passwordField.clearAndEnterText(password)
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

private extension XCUIElement {
  func clearAndEnterText(_ text: String) {
    tap()
    if let currentValue = value as? String, !currentValue.isEmpty {
      typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: currentValue.count))
    }
    typeText(text)
  }
}
