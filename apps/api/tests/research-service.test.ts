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
    await pending[0]!();
    await pending[1]!();
    expect(run).toHaveBeenCalledOnce();
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

  it("recreates the service and resumes the retained run without starting it again", async () => {
    const runStore = new InMemoryResearchRunStore();
    const firstJobs: Array<() => Promise<void>> = [];
    const run = vi.fn(async (runId: string) => ({
      runId,
      status: "failed" as const,
      nodes: { plan: { status: "completed", attempts: 1, toolsUsed: ["get_seller_profile"] } },
    }));
    const first = createResearchService({
      scheduler: { run, cancel: vi.fn() },
      runStore,
      createRunId: () => "run-restart-1",
      enqueue: (job) => firstJobs.push(job),
    });
    await first.startDomainResearch({
      ownerId: "owner-1",
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Analyze acme.ai",
      domains: ["acme.ai"],
      documentIds: [],
    });
    await firstJobs[0]!();

    const resumedJobs: Array<() => Promise<void>> = [];
    const resume = vi.fn(async (runId: string) => ({
      runId,
      status: "completed" as const,
      nodes: {
        plan: { status: "completed", attempts: 1, toolsUsed: ["get_seller_profile"] },
        synthesis: { status: "completed", attempts: 1, toolsUsed: ["search_evidence"] },
      },
    }));
    const restarted = createResearchService({
      scheduler: { run: vi.fn(), resume, cancel: vi.fn() },
      runStore,
      enqueue: (job) => resumedJobs.push(job),
    });

    const requeued = await restarted.resumeRun("run-restart-1", "owner-1");
    expect(requeued).toMatchObject({
      status: "queued",
      checkpoint: { nodes: { plan: { status: "completed" } } },
    });
    expect(requeued).not.toHaveProperty("error");
    await resumedJobs[0]!();

    expect(run).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    const completed = await restarted.getRun("run-restart-1", "owner-1");
    expect(completed).toMatchObject({
      status: "completed",
      checkpoint: { nodes: { plan: { attempts: 1 }, synthesis: { attempts: 1 } } },
    });
    expect(completed).not.toHaveProperty("error");
  });

  it("deduplicates concurrent resume commands for the same queued run in one process", async () => {
    const runStore = new InMemoryResearchRunStore();
    await runStore.save({
      runId: "run-deduplicated-1",
      conversationId: "11111111-1111-4111-8111-111111111111",
      status: "queued",
      input: {
        ownerId: "owner-1",
        conversationId: "11111111-1111-4111-8111-111111111111",
        message: "Analyze acme.ai",
        domains: ["acme.ai"],
        documentIds: [],
      },
      createdAt: "2026-08-01T20:00:00.000Z",
      updatedAt: "2026-08-01T20:00:00.000Z",
    });
    const jobs: Array<() => Promise<void>> = [];
    const resume = vi.fn(async () => ({ status: "completed" as const }));
    const service = createResearchService({
      scheduler: { run: vi.fn(), resume, cancel: vi.fn() },
      runStore,
      enqueue: (job) => jobs.push(job),
    });

    await Promise.all([
      service.resumeRun("run-deduplicated-1", "owner-1"),
      service.resumeRun("run-deduplicated-1", "owner-1"),
    ]);

    expect(jobs).toHaveLength(1);
    await jobs[0]!();
    expect(resume).toHaveBeenCalledOnce();
  });

  it("queues a requested rerun that arrives while a failed job is finishing", async () => {
    const baseStore = new InMemoryResearchRunStore();
    const jobs: Array<() => Promise<void>> = [];
    let service!: ReturnType<typeof createResearchService>;
    let requested = false;
    const runStore = {
      load: (runId: string) => baseStore.load(runId),
      async save(snapshot: Parameters<InMemoryResearchRunStore["save"]>[0]) {
        await baseStore.save(snapshot);
        if (snapshot.status === "failed" && !requested) {
          requested = true;
          await service.resumeRun(snapshot.runId, snapshot.input.ownerId);
        }
      },
    };
    service = createResearchService({
      scheduler: {
        run: async () => ({ status: "failed" }),
        resume: async () => ({ status: "completed" }),
        cancel: vi.fn(),
      },
      runStore,
      createRunId: () => "run-cleanup-race",
      enqueue: (job) => jobs.push(job),
    });
    await service.startDomainResearch({
      ownerId: "owner-1",
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Analyze acme.ai",
      domains: ["acme.ai"],
      documentIds: [],
    });

    await jobs[0]!();
    expect(jobs).toHaveLength(2);
    await jobs[1]!();
    await expect(service.getRun("run-cleanup-race", "owner-1")).resolves.toMatchObject({
      status: "completed",
    });
  });
});
