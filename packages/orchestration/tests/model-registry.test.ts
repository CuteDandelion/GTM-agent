import { describe, expect, it } from "vitest";

import { createModelRegistry, resolveModel } from "../src/index.js";

describe("model-aware routing", () => {
  it("routes every role through the configured registry", () => {
    const registry = createModelRegistry();

    expect(resolveModel(registry, "planner", new Set(registry.models))).toBe("gpt-5.6-sol");
    expect(resolveModel(registry, "executor", new Set(registry.models))).toBe("gpt-5.6-luna");
    expect(resolveModel(registry, "analyst", new Set(registry.models))).toBe("gpt-5.6-terra");
    expect(resolveModel(registry, "conversation", new Set(registry.models))).toBe("gpt-5.6-terra");
    expect(resolveModel(registry, "critic", new Set(registry.models))).toBe("gpt-5.6-sol");
  });

  it("uses only explicitly allowed fallbacks", () => {
    const registry = createModelRegistry();
    const terraOnly = new Set(["gpt-5.6-terra"]);

    expect(resolveModel(registry, "planner", terraOnly)).toBe("gpt-5.6-terra");
    expect(resolveModel(registry, "executor", terraOnly)).toBe("gpt-5.6-terra");
    expect(() => resolveModel(registry, "critic", terraOnly)).toThrow(/no available model/i);
  });
});
