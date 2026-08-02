import { resolveVisualQaState } from "./visual-qa-state";

describe("resolveVisualQaState", () => {
  it("accepts only canonical conversation states outside production", () => {
    expect(resolveVisualQaState("empty", "development")).toBe("empty");
    expect(resolveVisualQaState("progress", "development")).toBe("progress");
    expect(resolveVisualQaState("assessment", "test")).toBe("assessment");
    expect(resolveVisualQaState("evidence", "development")).toBe("evidence");
    expect(resolveVisualQaState("onboarding", "development")).toBeUndefined();
    expect(resolveVisualQaState("assessment", "production")).toBeUndefined();
    expect(resolveVisualQaState("evidence", "production")).toBeUndefined();
  });
});
