import { describe, expect, it, vi } from "vitest";

import {
  createGtmResearchWorkflow,
  DagScheduler,
  InMemoryCheckpointStore,
  defineWorkflow,
  type NodeExecutor,
} from "../src/index.js";

describe("deterministic DAG scheduler", () => {
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

  it("ships the full research DAG with deterministic, Luna, Terra, and Sol stages", () => {
    const workflow = createGtmResearchWorkflow();
    const byId = new Map(workflow.nodes.map((node) => [node.id, node]));

    expect(byId.get("validate-domain")?.role).toBe("deterministic");
    expect(byId.get("extract-company")?.role).toBe("executor");
    expect(byId.get("company-profile")?.role).toBe("analyst");
    expect(byId.get("critical-review")?.role).toBe("critic");
    expect(byId.get("current-research")?.requiredTools).toContain("web_search");
    expect(byId.get("document-research")?.requiredTools).toContain("read_document");
    expect(byId.get("synthesis")?.dependencies).toContain("final-review");
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
