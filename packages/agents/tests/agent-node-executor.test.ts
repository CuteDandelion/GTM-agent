import { describe, expect, it, vi } from "vitest";

import { createModelRegistry, type NodeExecutionContext, type WorkflowNodeDefinition } from "@gtm/orchestration";

import { createAgentNodeExecutor, createRoleAwareNodeExecutor, type AgentRuntime } from "../src/index.js";

function context(node: WorkflowNodeDefinition, useTool = vi.fn()): NodeExecutionContext {
  return {
    runId: "run-1",
    node,
    attempt: 1,
    input: { domain: "acme.ai" },
    dependencyOutputs: {},
    useTool,
  };
}

describe("OpenAI specialist node executor", () => {
  it("routes a Luna extraction node with only its scoped tools", async () => {
    const runtime: AgentRuntime = vi.fn(async () => ({
      output: { facts: ["Acme automates support"] },
      usedTools: ["web_search", "save_evidence"],
      responseId: "resp_1",
    }));
    const useTool = vi.fn();
    const executor = createAgentNodeExecutor({
      registry: createModelRegistry(),
      availableModels: new Set(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]),
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
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      tools: ["web_search", "save_evidence"],
    }));
    expect(useTool).toHaveBeenCalledWith("web_search");
    expect(useTool).toHaveBeenCalledWith("save_evidence");
    expect(output).toMatchObject({ responseId: "resp_1" });
  });

  it("will not silently run a Sol critic on Terra", async () => {
    const runtime: AgentRuntime = vi.fn();
    const executor = createAgentNodeExecutor({
      registry: createModelRegistry(),
      availableModels: new Set(["gpt-5.6-terra"]),
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
      availableModels: new Set(["gpt-5.6-sol"]),
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
      availableModels: new Set(["gpt-5.6-sol"]),
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
