import { describe, expect, it } from "vitest";

import { createModelRegistry, resolveModel } from "../src/index.js";

describe("model-aware routing", () => {
  it("routes every role through the configured registry", () => {
    const registry = createModelRegistry();

    expect(resolveModel(registry, "planner", new Set(registry.models))).toBe("opencode-go/minimax-m3");
    expect(resolveModel(registry, "executor", new Set(registry.models))).toBe("opencode-go/gpt-5.6-luna");
    expect(resolveModel(registry, "analyst", new Set(registry.models))).toBe("opencode-go/minimax-m3");
    expect(resolveModel(registry, "conversation", new Set(registry.models))).toBe("opencode-go/gpt-5.6-luna");
    expect(resolveModel(registry, "critic", new Set(registry.models))).toBe("opencode-go/minimax-m3");
    expect(resolveModel(registry, "portfolio", new Set(registry.models))).toBe("opencode-go/minimax-m3");
  });

  it("uses only explicitly allowed fallbacks", () => {
    const registry = createModelRegistry();
    const lunaOnly = new Set(["opencode-go/gpt-5.6-luna"]);

    expect(resolveModel(registry, "planner", lunaOnly)).toBe("opencode-go/gpt-5.6-luna");
    expect(resolveModel(registry, "executor", lunaOnly)).toBe("opencode-go/gpt-5.6-luna");
    expect(resolveModel(registry, "critic", lunaOnly)).toBe("opencode-go/gpt-5.6-luna");
    expect(() => resolveModel(registry, "portfolio", new Set(["opencode-go/qwen3.7-plus"])))
      .toThrow(/no available model/i);
  });
});
