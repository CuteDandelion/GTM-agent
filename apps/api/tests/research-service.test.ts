import { describe, expect, it, vi } from "vitest";

import { createResearchService, InMemoryResearchRunStore } from "../src/research-service.js";

describe("research service", () => {
  it("queues a conversational request, executes the DAG, and exposes its checkpoint", async () => {
    const run = vi.fn(async (runId: string) => ({
      runId,
      workflowId: "company-domain-research-v1",
      status: "completed" as const,
      executionCount: 4,
      nodes: { synthesis: { status: "completed", attempts: 1, toolsUsed: [] } },
    }));
    const pending: Array<() => Promise<void>> = [];
    const service = createResearchService({
      scheduler: { run, cancel: vi.fn() },
      runStore: new InMemoryResearchRunStore(),
      createRunId: () => "run-acme-1",
      enqueue: (job) => pending.push(job),
    });

    const accepted = await service.startDomainResearch({
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Analyze acme.ai",
      domains: ["acme.ai"],
      documentIds: [],
    });

    expect(accepted).toMatchObject({ runId: "run-acme-1", status: "queued" });
    expect(run).not.toHaveBeenCalled();
    expect(await service.getRun("run-acme-1")).toMatchObject({ status: "queued" });

    await pending[0]!();

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("run-acme-1", {
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Analyze acme.ai",
      domains: ["acme.ai"],
      documentIds: [],
    });
    expect(await service.getRun("run-acme-1")).toMatchObject({
      status: "completed",
      checkpoint: { workflowId: "company-domain-research-v1", executionCount: 4 },
    });
  });

  it("records background failures without losing the accepted run", async () => {
    const pending: Array<() => Promise<void>> = [];
    const service = createResearchService({
      scheduler: { run: async () => { throw new Error("model unavailable"); }, cancel: vi.fn() },
      runStore: new InMemoryResearchRunStore(),
      createRunId: () => "run-failed-1",
      enqueue: (job) => pending.push(job),
    });

    await service.startDomainResearch({
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Analyze acme.ai",
      domains: ["acme.ai"],
      documentIds: [],
    });
    await pending[0]!();

    expect(await service.getRun("run-failed-1")).toMatchObject({
      status: "failed",
      error: "model unavailable",
    });
  });

  it("delegates cancellation and can requeue a retained run input", async () => {
    const pending: Array<() => Promise<void>> = [];
    const cancel = vi.fn(async () => undefined);
    const run = vi.fn(async (runId: string) => ({ runId, status: "completed" }));
    const service = createResearchService({
      scheduler: { run, cancel },
      runStore: new InMemoryResearchRunStore(),
      createRunId: () => "run-control-1",
      enqueue: (job) => pending.push(job),
    });
    await service.startDomainResearch({
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Analyze acme.ai",
      domains: ["acme.ai"],
      documentIds: [],
    });

    await expect(service.cancelRun("run-control-1")).resolves.toMatchObject({ status: "cancelled" });
    expect(cancel).toHaveBeenCalledWith("run-control-1");
    await expect(service.resumeRun("run-control-1")).resolves.toMatchObject({ status: "queued" });
    expect(pending).toHaveLength(2);
  });

  it("does not expose a run to a different authenticated owner", async () => {
    const service = createResearchService({
      scheduler: { run: async () => ({ status: "completed" }), cancel: vi.fn() },
      runStore: new InMemoryResearchRunStore(),
      createRunId: () => "run-owned-1",
      enqueue: () => undefined,
    });
    await service.startDomainResearch({
      ownerId: "user-1",
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Analyze acme.ai",
      domains: ["acme.ai"],
      documentIds: [],
    });

    await expect(service.getRun("run-owned-1", "user-1")).resolves.toBeDefined();
    await expect(service.getRun("run-owned-1", "user-2")).resolves.toBeUndefined();
  });
});
