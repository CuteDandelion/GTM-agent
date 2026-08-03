import { describe, expect, it, vi } from "vitest";

import { createModelRegistry, type NodeExecutionContext, type WorkflowNodeDefinition } from "@gtm/orchestration";

import {
  createAgentNodeExecutor,
  createRoleAwareNodeExecutor,
  resolveMaxOutputTokens,
  type AgentRuntime,
} from "../src/index.js";

function context(
  node: WorkflowNodeDefinition,
  useTool = vi.fn(),
  input: unknown = { domain: "acme.ai" },
): NodeExecutionContext {
  return {
    runId: "run-1",
    node,
    attempt: 1,
    input,
    dependencyOutputs: {},
    useTool,
  };
}

describe("specialist node executor", () => {
  it("keeps the product default while allowing a bounded evaluator output budget", () => {
    expect(resolveMaxOutputTokens()).toBe(4_096);
    expect(resolveMaxOutputTokens(8_192)).toBe(8_192);
    expect(() => resolveMaxOutputTokens(32_768)).toThrow("maxOutputTokens must be between 1 and 16384");
  });

  it("routes a fast extraction node with only its scoped tools", async () => {
    const runtime: AgentRuntime = vi.fn(async () => ({
      output: { facts: ["Acme automates support"] },
      usedTools: ["web_search", "save_evidence"],
      responseId: "resp_1",
    }));
    const useTool = vi.fn();
    const executor = createAgentNodeExecutor({
      registry: createModelRegistry(),
      availableModels: new Set(createModelRegistry().models),
      runtime,
    });

    const output = await executor(context({
      id: "current-research",
      dependencies: [],
      role: "executor",
      allowedTools: ["web_search", "save_evidence"],
      requiredTools: ["web_search", "save_evidence"],
      retries: 1,
      timeoutMs: 10_000,
    }, useTool));

    expect(runtime).toHaveBeenCalledWith(expect.objectContaining({
      model: "opencode-go/gpt-5.6-luna",
      reasoningEffort: "low",
      tools: ["web_search", "save_evidence"],
      instructions: expect.stringContaining("Return exactly one valid JSON object"),
      input: expect.objectContaining({ requiredTools: ["web_search", "save_evidence"] }),
    }));
    expect((runtime as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].instructions).toContain("under 3,000 tokens");
    expect((runtime as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].instructions).toContain("one batched evidence object per company");
    expect((runtime as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].instructions).toContain("funding amount, valuation, lead investor");
    expect((runtime as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].instructions).toContain("one atomic factual assertion");
    expect((runtime as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].instructions).toContain("exact page that directly states it");
    expect(useTool).toHaveBeenCalledWith("web_search");
    expect(useTool).toHaveBeenCalledWith("save_evidence");
    expect(output).toMatchObject({ responseId: "resp_1" });
  });

  it("requires final source approval before user-facing synthesis", async () => {
    const runtime: AgentRuntime = vi.fn(async () => ({ output: { approvedClaims: [] }, usedTools: ["get_claim_sources", "web_search"] }));
    const executor = createAgentNodeExecutor({
      registry: createModelRegistry(),
      availableModels: new Set(createModelRegistry().models),
      runtime,
    });

    await executor(context({
      id: "final-review",
      dependencies: [],
      role: "critic",
      allowedTools: ["get_claim_sources", "web_search"],
      requiredTools: ["get_claim_sources", "web_search"],
      retries: 1,
      timeoutMs: 10_000,
    }));
    const finalReviewInstructions = (runtime as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].instructions;
    expect(finalReviewInstructions).toContain("approvedClaims");
    expect(finalReviewInstructions).toContain("Reject stale, unsupported, or citation-mismatched claims");
    expect(finalReviewInstructions).toContain("literal entailment");
    expect(finalReviewInstructions).toContain("Do not transfer modifiers");
    expect(finalReviewInstructions).toContain("Review every source-bearing candidate claim");
    expect(finalReviewInstructions).toContain("at least eight approved atomic claims per company");

    (runtime as ReturnType<typeof vi.fn>).mockClear();
    (runtime as ReturnType<typeof vi.fn>).mockResolvedValue({ output: { facts: [] }, usedTools: ["search_evidence", "get_opportunities"] });
    await executor(context({
      id: "synthesis",
      dependencies: ["final-review"],
      role: "analyst",
      allowedTools: ["search_evidence", "get_opportunities"],
      requiredTools: ["search_evidence", "get_opportunities"],
      retries: 1,
      timeoutMs: 10_000,
    }));
    expect((runtime as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].instructions)
      .toContain("Use only dependencyOutputs.final-review.output.approvedClaims");
    expect((runtime as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].instructions)
      .toContain("Copy each approved factual statement verbatim");
    expect((runtime as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].instructions)
      .toContain("Include every approved claim exactly once");
  });

  it("budgets final review and synthesis for a five-company accuracy cohort", async () => {
    const runtime: AgentRuntime = vi.fn(async (request) => ({
      output: request.input && (request.input as { nodeId?: string }).nodeId === "final-review"
        ? { approvedClaims: Array.from({ length: 40 }, (_, index) => ({ statement: `Claim ${index + 1}` })) }
        : { facts: Array.from({ length: 40 }, (_, index) => ({ statement: `Claim ${index + 1}` })) },
      usedTools: request.tools,
    }));
    const executor = createAgentNodeExecutor({
      registry: createModelRegistry(),
      availableModels: new Set(createModelRegistry().models),
      runtime,
    });
    const workflowInput = { domains: ["one.example", "two.example", "three.example", "four.example", "five.example"] };

    await executor(context({
      id: "final-review",
      dependencies: [],
      role: "critic",
      allowedTools: ["get_claim_sources", "web_search"],
      requiredTools: ["get_claim_sources", "web_search"],
      retries: 1,
      timeoutMs: 300_000,
    }, vi.fn(), workflowInput));
    await executor(context({
      id: "synthesis",
      dependencies: ["final-review"],
      role: "analyst",
      allowedTools: ["search_evidence", "get_opportunities"],
      requiredTools: ["search_evidence", "get_opportunities"],
      retries: 1,
      timeoutMs: 120_000,
    }, vi.fn(), workflowInput));

    for (const request of (runtime as ReturnType<typeof vi.fn>).mock.calls.map(([request]) => request)) {
      expect(request.maxOutputTokens).toBe(8_192);
      expect(request.instructions).toContain("at most 50 concise facts or evidence records");
      expect(request.instructions).toContain("under 7,000 tokens");
    }
  });

  it("rejects synthesis that omits a final-review approved claim", async () => {
    const approvedClaims = [
      { company: "Acme", statement: "Acme has an API.", sourceUrl: "https://acme.example/api" },
      { company: "Acme", statement: "Acme has webhooks.", sourceUrl: "https://acme.example/webhooks" },
    ];
    const runtime: AgentRuntime = vi.fn(async (request) => ({
      output: { facts: [approvedClaims[0]] },
      usedTools: request.tools,
    }));
    const executor = createAgentNodeExecutor({
      registry: createModelRegistry(),
      availableModels: new Set(["opencode-go/minimax-m3"]),
      runtime,
    });
    const synthesisContext = context({
      id: "synthesis",
      dependencies: ["final-review"],
      role: "analyst",
      allowedTools: ["search_evidence", "get_opportunities"],
      requiredTools: ["search_evidence", "get_opportunities"],
      retries: 1,
      timeoutMs: 120_000,
    });
    synthesisContext.dependencyOutputs = { "final-review": { output: { approvedClaims } } };

    await expect(executor(synthesisContext)).rejects.toThrow(/include every approved claim exactly once/i);
  });

  it("will not silently run a critic without an approved critic model", async () => {
    const runtime: AgentRuntime = vi.fn();
    const executor = createAgentNodeExecutor({
      registry: createModelRegistry(),
      availableModels: new Set(["opencode-go/qwen3.7-plus"]),
      runtime,
    });

    await expect(executor(context({
      id: "critical-review",
      dependencies: [],
      role: "critic",
      allowedTools: ["get_claim_sources"],
      requiredTools: ["get_claim_sources"],
      retries: 0,
      timeoutMs: 10_000,
    }))).rejects.toThrow(/no available model/i);
    expect(runtime).not.toHaveBeenCalled();
  });

  it("keeps deterministic nodes outside the model runtime", async () => {
    const runtime: AgentRuntime = vi.fn();
    const executor = createAgentNodeExecutor({
      registry: createModelRegistry(),
      availableModels: new Set(["opencode-go/minimax-m3"]),
      runtime,
    });

    await expect(executor(context({
      id: "validate-domain",
      dependencies: [],
      role: "deterministic",
      allowedTools: ["validate_domain"],
      requiredTools: ["validate_domain"],
      retries: 0,
      timeoutMs: 10_000,
    }))).rejects.toThrow(/deterministic/i);
    expect(runtime).not.toHaveBeenCalled();
  });

  it("rejects raw unstructured provider output before checkpointing", async () => {
    const runtime: AgentRuntime = vi.fn(async () => ({ output: "not structured data", usedTools: [] }));
    const executor = createAgentNodeExecutor({
      registry: createModelRegistry(),
      availableModels: new Set(["opencode-go/minimax-m3"]),
      runtime,
    });

    await expect(executor(context({
      id: "research-plan",
      dependencies: [],
      role: "planner",
      allowedTools: [],
      requiredTools: [],
      retries: 0,
      timeoutMs: 10_000,
    }))).rejects.toThrow(/structured object/i);
  });

  it("accepts a single fenced JSON object from a provider", async () => {
    const runtime: AgentRuntime = vi.fn(async () => ({ output: "```json\n{\"facts\":[\"grounded\"]}\n```", usedTools: [] }));
    const executor = createAgentNodeExecutor({
      registry: createModelRegistry(),
      availableModels: new Set(["opencode-go/minimax-m3"]),
      runtime,
    });

    await expect(executor(context({
      id: "research-plan",
      dependencies: [],
      role: "planner",
      allowedTools: [],
      requiredTools: [],
      retries: 0,
      timeoutMs: 10_000,
    }))).resolves.toMatchObject({ output: { facts: ["grounded"] } });
  });
});

describe("role-aware node executor", () => {
  it("routes deterministic nodes locally and model nodes to the agent executor", async () => {
    const deterministicExecutor = vi.fn(async () => ({ valid: true }));
    const agentExecutor = vi.fn(async () => ({ output: "planned" }));
    const executor = createRoleAwareNodeExecutor({ deterministicExecutor, agentExecutor });
    const deterministic = context({
      id: "validate-domain",
      dependencies: [],
      role: "deterministic",
      allowedTools: ["validate_domain"],
      requiredTools: ["validate_domain"],
      retries: 0,
      timeoutMs: 10_000,
    });
    const planner = context({
      id: "research-plan",
      dependencies: [],
      role: "planner",
      allowedTools: [],
      requiredTools: [],
      retries: 0,
      timeoutMs: 10_000,
    });

    await expect(executor(deterministic)).resolves.toEqual({ valid: true });
    await expect(executor(planner)).resolves.toEqual({ output: "planned" });
    expect(deterministicExecutor).toHaveBeenCalledOnce();
    expect(agentExecutor).toHaveBeenCalledOnce();
  });
});
