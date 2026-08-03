import { describe, expect, it, vi } from "vitest";

import {
  assertGtmResearchToolContract,
  createGtmResearchWorkflow,
  DagScheduler,
  InMemoryCheckpointStore,
  defineWorkflow,
  type NodeExecutor,
} from "../src/index.js";

describe("deterministic DAG scheduler", () => {
  it("retries an interrupted node after cancellation without looping on its cumulative attempts", async () => {
    const workflow = defineWorkflow({
      id: "cancel-resume-attempts",
      budget: { maxNodeExecutions: 4 },
      nodes: [
        { id: "done", dependencies: [], role: "deterministic", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
        { id: "interrupted", dependencies: ["done"], role: "deterministic", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
      ],
    });
    const checkpoints = new InMemoryCheckpointStore();
    await checkpoints.save({
      runId: "run-cancelled",
      workflowId: workflow.id,
      status: "cancelled",
      executionCount: 2,
      nodes: {
        done: { status: "completed", attempts: 1, toolsUsed: [], output: { retained: true } },
        interrupted: { status: "running", attempts: 1, toolsUsed: [] },
      },
    });
    const executed: string[] = [];
    const scheduler = new DagScheduler({
      workflow,
      checkpoints,
      executor: async ({ node }) => {
        executed.push(node.id);
        return { resumed: node.id };
      },
    });

    const resumed = await scheduler.resume("run-cancelled", {});

    expect(resumed.status).toBe("completed");
    expect(executed).toEqual(["interrupted"]);
    expect(resumed.nodes.done?.attempts).toBe(1);
    expect(resumed.nodes.interrupted?.attempts).toBe(2);
  });

  it("honors provider retry guidance before retrying a rate-limited model node", async () => {
    const workflow = defineWorkflow({
      id: "rate-limit-backoff",
      budget: { maxNodeExecutions: 2 },
      nodes: [
        { id: "research", dependencies: [], role: "executor", allowedTools: ["web_search"], requiredTools: ["web_search"], retries: 1, timeoutMs: 1_000 },
      ],
    });
    const retryDelay = vi.fn(async () => undefined);
    const executor: NodeExecutor = vi.fn(async ({ attempt, useTool }) => {
      if (attempt === 1) throw new Error("429 Rate limit reached. Please try again in 12.225s.");
      useTool("web_search");
      return { recovered: true };
    });

    const result = await new DagScheduler({
      workflow,
      checkpoints: new InMemoryCheckpointStore(),
      executor,
      retryDelay,
    }).run("run-rate-limit", {});

    expect(result.status).toBe("completed");
    expect(retryDelay).toHaveBeenCalledWith(12_225);
  });

  it("resumes without rerunning completed nodes", async () => {
    const workflow = defineWorkflow({
      id: "resume-test",
      budget: { maxNodeExecutions: 5 },
      nodes: [
        { id: "plan", dependencies: [], role: "planner", allowedTools: ["get_seller_profile"], requiredTools: ["get_seller_profile"], retries: 0, timeoutMs: 1_000 },
        { id: "profile", dependencies: ["plan"], role: "analyst", allowedTools: ["search_evidence"], requiredTools: ["search_evidence"], retries: 1, timeoutMs: 1_000 },
      ],
    });
    const checkpoints = new InMemoryCheckpointStore();
    const calls = { plan: 0, profile: 0 };
    const executor: NodeExecutor = vi.fn(async ({ node, attempt, useTool }) => {
      calls[node.id as keyof typeof calls] += 1;
      useTool(node.requiredTools[0]!);
      if (node.id === "profile" && attempt === 1) throw new Error("injected restart");
      return { node: node.id, attempt };
    });

    const first = await new DagScheduler({ workflow, checkpoints, executor }).run("run-1", {});
    expect(first.status).toBe("completed");
    expect(calls).toEqual({ plan: 1, profile: 2 });

    const resumed = await new DagScheduler({ workflow, checkpoints, executor }).run("run-1", {});
    expect(resumed.status).toBe("completed");
    expect(calls).toEqual({ plan: 1, profile: 2 });
  });

  it("fails a node that does not use its mandatory tools", async () => {
    const workflow = defineWorkflow({
      id: "tool-policy-test",
      budget: { maxNodeExecutions: 1 },
      nodes: [
        { id: "research", dependencies: [], role: "executor", allowedTools: ["web_search"], requiredTools: ["web_search"], retries: 0, timeoutMs: 1_000 },
      ],
    });
    const executor: NodeExecutor = async () => ({ unsupported: true });

    const result = await new DagScheduler({
      workflow,
      checkpoints: new InMemoryCheckpointStore(),
      executor,
    }).run("run-tools", {});

    expect(result.status).toBe("failed");
    expect(result.nodes.research!.error).toMatch(/required tool web_search/i);
  });

  it("rejects cycles before a workflow can run", () => {
    expect(() => defineWorkflow({
      id: "cycle",
      budget: { maxNodeExecutions: 2 },
      nodes: [
        { id: "a", dependencies: ["b"], role: "planner", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
        { id: "b", dependencies: ["a"], role: "analyst", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
      ],
    })).toThrow(/cycle/i);
  });

  it("skips a conditional node when its predicate is false", async () => {
    const workflow = defineWorkflow({
      id: "conditional",
      budget: { maxNodeExecutions: 2 },
      nodes: [
        { id: "review", dependencies: [], role: "critic", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
        {
          id: "supplemental",
          dependencies: ["review"],
          role: "planner",
          allowedTools: [],
          requiredTools: [],
          retries: 0,
          timeoutMs: 1_000,
          when: ({ dependencyOutputs }) => dependencyOutputs.review === "material-gap",
        },
      ],
    });
    const executor: NodeExecutor = async ({ node }) => node.id === "review" ? "sufficient" : "should-not-run";

    const result = await new DagScheduler({
      workflow,
      checkpoints: new InMemoryCheckpointStore(),
      executor,
    }).run("run-condition", {});

    expect(result.status).toBe("completed");
    expect(result.nodes.supplemental!.status).toBe("skipped");
    expect(result.executionCount).toBe(1);
  });

  it("ships the full research DAG with deterministic and role-routed OpenCode stages", () => {
    const workflow = createGtmResearchWorkflow();
    const byId = new Map(workflow.nodes.map((node) => [node.id, node]));

    expect(byId.get("validate-domain")?.role).toBe("deterministic");
    expect(byId.get("extract-company")?.role).toBe("executor");
    expect(byId.get("extract-company")?.concurrencyKey).toBe("opencode-go/gpt-5.6-luna");
    expect(byId.get("extract-product")?.concurrencyKey).toBe("opencode-go/gpt-5.6-luna");
    expect(byId.get("company-profile")?.role).toBe("analyst");
    expect(byId.get("critical-review")?.role).toBe("critic");
    expect(byId.get("final-review")?.requiredTools).toContain("web_search");
    expect(byId.get("final-review")?.timeoutMs).toBe(300_000);
    expect(byId.get("current-research")?.requiredTools).toContain("web_search");
    expect(byId.get("document-research")?.requiredTools).toContain("read_document");
    expect(byId.get("portfolio-comparison")?.role).toBe("portfolio");
    expect(byId.get("portfolio-comparison")?.requiredTools).toContain("compare_companies");
    expect(byId.get("portfolio-comparison")?.requiredTools).toContain("code_interpreter");
    expect(byId.get("synthesis")?.dependencies).toContain("final-review");
  });

  it("fails closed when a specialist loses a mandatory research capability", () => {
    const workflow = createGtmResearchWorkflow();
    const currentResearch = workflow.nodes.find((node) => node.id === "current-research")!;
    const unsafeWorkflow = {
      ...workflow,
      nodes: workflow.nodes.map((node) => node.id === currentResearch.id
        ? {
          ...currentResearch,
          allowedTools: currentResearch.allowedTools.filter((tool) => tool !== "web_search"),
          requiredTools: currentResearch.requiredTools.filter((tool) => tool !== "web_search"),
        }
        : node),
    };

    expect(() => assertGtmResearchToolContract(unsafeWorkflow))
      .toThrow(/current-research.*web_search/i);
  });

  it("requires secure document reading, evidence analysis, critic research, and batch computation", () => {
    const workflow = createGtmResearchWorkflow();
    const mutations = [
      ["document-research", "read_document"],
      ["company-profile", "search_evidence"],
      ["critical-review", "web_search"],
      ["portfolio-comparison", "code_interpreter"],
      ["interactive-objects", "get_company_profile"],
    ] as const;

    for (const [nodeId, toolName] of mutations) {
      const unsafeWorkflow = {
        ...workflow,
        nodes: workflow.nodes.map((node) => node.id === nodeId
          ? {
            ...node,
            allowedTools: node.allowedTools.filter((tool) => tool !== toolName),
            requiredTools: node.requiredTools.filter((tool) => tool !== toolName),
          }
          : node),
      };

      expect(() => assertGtmResearchToolContract(unsafeWorkflow))
        .toThrow(new RegExp(`${nodeId}.*${toolName}`, "i"));
    }
  });

  it("runs portfolio comparison only for multi-company batches", async () => {
    const run = (runId: string, domains: string[]) => new DagScheduler({
      workflow: createGtmResearchWorkflow(),
      checkpoints: new InMemoryCheckpointStore(),
      executor: async ({ node, useTool }) => {
        for (const toolName of node.requiredTools) useTool(toolName);
        return { node: node.id };
      },
    }).run(runId, { domains, documentIds: [] });

    const single = await run("single-company", ["acme.ai"]);
    const batch = await run("company-batch", ["acme.ai", "nova.example"]);

    expect(single.nodes["portfolio-comparison"]?.status).toBe("skipped");
    expect(batch.nodes["portfolio-comparison"]?.status).toBe("completed");
  });

  it("activates only the specialist branches selected by the conversation plan", async () => {
    const result = await new DagScheduler({
      workflow: createGtmResearchWorkflow(),
      checkpoints: new InMemoryCheckpointStore(),
      executor: async ({ node, useTool }) => {
        for (const toolName of node.requiredTools) useTool(toolName);
        return { node: node.id };
      },
    }).run("dynamic-company-profile", {
      domains: ["foodbegood.app"],
      documentIds: ["11111111-1111-4111-8111-111111111111"],
      researchPlan: {
        objective: "Profile the company from its own site",
        capabilities: ["company_profile"],
      },
    });

    expect(result.status).toBe("completed");
    expect(result.nodes["company-profile"]?.status).toBe("completed");
    expect(result.nodes["current-research"]?.status).toBe("skipped");
    expect(result.nodes["document-research"]?.status).toBe("skipped");
    expect(result.nodes["icp-assessment"]?.status).toBe("skipped");
    expect(result.nodes["opportunity-analysis"]?.status).toBe("skipped");
    expect(result.nodes["portfolio-comparison"]?.status).toBe("skipped");
  });

  it("runs independent ready nodes concurrently within the workflow bound", async () => {
    const workflow = defineWorkflow({
      id: "concurrent",
      budget: { maxNodeExecutions: 3, maxConcurrency: 2 },
      nodes: [
        { id: "a", dependencies: [], role: "executor", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
        { id: "b", dependencies: [], role: "executor", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
        { id: "done", dependencies: ["a", "b"], role: "analyst", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
      ],
    });
    let active = 0;
    let peak = 0;
    const executor: NodeExecutor = async ({ node }) => {
      if (node.id === "done") return true;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return node.id;
    };

    const result = await new DagScheduler({
      workflow,
      checkpoints: new InMemoryCheckpointStore(),
      executor,
    }).run("run-concurrent", {});

    expect(result.status).toBe("completed");
    expect(peak).toBe(2);
  });

  it("does not run ready nodes with the same model capacity key concurrently", async () => {
    const workflow = defineWorkflow({
      id: "model-aware-concurrency",
      budget: { maxNodeExecutions: 3, maxConcurrency: 3 },
      nodes: [
        { id: "flash-a", dependencies: [], role: "executor", concurrencyKey: "opencode-go/gpt-5.6-luna", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
        { id: "flash-b", dependencies: [], role: "executor", concurrencyKey: "opencode-go/gpt-5.6-luna", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
        { id: "qwen", dependencies: [], role: "analyst", concurrencyKey: "opencode-go/minimax-m3", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
      ],
    });
    const activeByKey = new Map<string, number>();
    const peakByKey = new Map<string, number>();
    const executor: NodeExecutor = async ({ node }) => {
      const key = node.concurrencyKey ?? node.id;
      const active = (activeByKey.get(key) ?? 0) + 1;
      activeByKey.set(key, active);
      peakByKey.set(key, Math.max(peakByKey.get(key) ?? 0, active));
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeByKey.set(key, active - 1);
      return node.id;
    };

    const result = await new DagScheduler({
      workflow,
      checkpoints: new InMemoryCheckpointStore(),
      executor,
    }).run("run-model-aware", {});

    expect(result.status).toBe("completed");
    expect(peakByKey.get("opencode-go/gpt-5.6-luna")).toBe(1);
  });

  it("cancels an in-flight run without completing its active node", async () => {
    const workflow = defineWorkflow({
      id: "cancel",
      budget: { maxNodeExecutions: 1 },
      nodes: [
        { id: "slow", dependencies: [], role: "executor", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
      ],
    });
    let release!: () => void;
    const started = new Promise<void>((resolve) => { release = resolve; });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const scheduler = new DagScheduler({
      workflow,
      checkpoints: new InMemoryCheckpointStore(),
      executor: async () => { release(); await gate; return "too late"; },
    });

    const running = scheduler.run("run-cancel", {});
    await started;
    await scheduler.cancel("run-cancel");
    finish();
    const result = await running;

    expect(result.status).toBe("cancelled");
    expect(result.nodes.slow?.status).toBe("cancelled");
  });

  it("runs the single supplemental loop when the wrapped critic output requests it", async () => {
    const workflow = createGtmResearchWorkflow();
    const executor: NodeExecutor = async ({ node, useTool }) => {
      for (const toolName of node.requiredTools) useTool(toolName);
      if (node.id === "critical-review") return { output: { needsSupplementalResearch: true } };
      return { output: {} };
    };
    const result = await new DagScheduler({
      workflow,
      checkpoints: new InMemoryCheckpointStore(),
      executor,
    }).run("run-supplemental", { domains: ["acme.ai"], documentIds: [] });

    expect(result.status).toBe("completed");
    expect(result.nodes["supplemental-plan"]?.status).toBe("completed");
    expect(result.nodes["supplemental-research"]?.status).toBe("completed");
  });
});
