import { describe, expect, it, vi } from "vitest";

import { createResearchService, InMemoryResearchRunStore, ResearchAdmissionError } from "../src/research-service.js";

describe("research service", () => {
  it("bounds sequential research requests per owner and globally until the configured window resets", async () => {
    let currentTime = 1_000;
    const jobs: Array<() => Promise<void>> = [];
    let nextRun = 0;
    const service = createResearchService({
      scheduler: { run: async () => ({ status: "completed" }), cancel: vi.fn() },
      runStore: new InMemoryResearchRunStore(),
      createRunId: () => `run-window-${++nextRun}`,
      enqueue: (job) => jobs.push(job),
      admission: {
        maxActiveGlobal: 5,
        maxActivePerOwner: 5,
        maxRequestsGlobalPerWindow: 2,
        maxRequestsPerOwnerPerWindow: 1,
        windowMs: 10_000,
        now: () => currentTime,
        retryAfterSeconds: 3,
      },
    });
    const request = (ownerId: string, conversationId: string) => service.startDomainResearch({
      ownerId,
      conversationId,
      message: "Analyze foodbegood.app",
      domains: ["foodbegood.app"],
      documentIds: [],
    });

    await expect(request("owner-1", "11111111-1111-4111-8111-111111111111")).resolves.toBeDefined();
    await jobs.shift()!();
    await expect(request("owner-1", "22222222-2222-4222-8222-222222222222")).rejects.toMatchObject({ retryAfterSeconds: 10 });
    await expect(request("owner-2", "33333333-3333-4333-8333-333333333333")).resolves.toBeDefined();
    await jobs.shift()!();
    await expect(request("owner-3", "44444444-4444-4444-8444-444444444444")).rejects.toMatchObject({ retryAfterSeconds: 10 });

    currentTime = 10_999;
    await expect(request("owner-1", "22222222-2222-4222-8222-222222222222")).rejects.toMatchObject({ retryAfterSeconds: 1 });
    currentTime = 11_000;
    await expect(request("owner-1", "22222222-2222-4222-8222-222222222222")).resolves.toBeDefined();
  });

  it("bounds active research runs per owner and globally before saving or enqueueing", async () => {
    const jobs: Array<() => Promise<void>> = [];
    const runIds = ["run-owner-1", "run-rejected-owner-1", "run-owner-2", "run-rejected-global", "run-owner-1-retry"];
    const runStore = new InMemoryResearchRunStore();
    const service = createResearchService({
      scheduler: { run: async () => ({ status: "completed" }), cancel: vi.fn() },
      runStore,
      createRunId: () => runIds.shift()!,
      enqueue: (job) => jobs.push(job),
      admission: { maxActiveGlobal: 2, maxActivePerOwner: 1, retryAfterSeconds: 7 },
    });
    const request = (ownerId: string, conversationId: string) => service.startDomainResearch({
      ownerId,
      conversationId,
      message: "Analyze foodbegood.app",
      domains: ["foodbegood.app"],
      documentIds: [],
    });

    await expect(request("owner-1", "11111111-1111-4111-8111-111111111111")).resolves.toMatchObject({ runId: "run-owner-1" });
    await expect(request("owner-1", "22222222-2222-4222-8222-222222222222")).rejects.toMatchObject({
      name: "ResearchAdmissionError",
      retryAfterSeconds: 7,
    });
    await expect(service.getRun("run-rejected-owner-1", "owner-1")).resolves.toBeUndefined();
    await expect(request("owner-2", "33333333-3333-4333-8333-333333333333")).resolves.toMatchObject({ runId: "run-owner-2" });
    await expect(request("owner-3", "44444444-4444-4444-8444-444444444444")).rejects.toBeInstanceOf(ResearchAdmissionError);
    expect(jobs).toHaveLength(2);

    await jobs[0]!();
    await expect(request("owner-1", "22222222-2222-4222-8222-222222222222")).resolves.toMatchObject({ runId: "run-owner-1-retry" });
  });

  it("publishes queued, running, and terminal snapshots for mobile projections", async () => {
    const pending: Array<() => Promise<void>> = [];
    const published: Array<{ status: string; hasCheckpoint: boolean }> = [];
    const service = createResearchService({
      scheduler: {
        run: async (runId: string) => ({
          runId,
          status: "completed" as const,
          nodes: { synthesis: { status: "completed", attempts: 1, toolsUsed: [] } },
        }),
        cancel: vi.fn(),
      },
      runStore: new InMemoryResearchRunStore(),
      createRunId: () => "run-projected-1",
      enqueue: (job) => pending.push(job),
      onRunUpdated: async (snapshot) => {
        published.push({ status: snapshot.status, hasCheckpoint: snapshot.checkpoint !== undefined });
      },
    });

    await service.startDomainResearch({
      ownerId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      message: "Analyze foodbegood.app",
      domains: ["foodbegood.app"],
      documentIds: [],
    });
    await pending[0]!();

    expect(published).toEqual([
      { status: "queued", hasCheckpoint: false },
      { status: "running", hasCheckpoint: false },
      { status: "completed", hasCheckpoint: true },
    ]);
  });

  it("runs prompts FIFO within one conversation while allowing another conversation to run", async () => {
    const jobs: Array<() => Promise<void>> = [];
    const runIds = ["run-first", "run-second", "run-other"];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const run = vi.fn(async (runId: string) => {
      if (runId === "run-first") await firstBlocked;
      return { runId, status: "completed" as const };
    });
    const service = createResearchService({
      scheduler: { run, cancel: vi.fn() },
      runStore: new InMemoryResearchRunStore(),
      createRunId: () => runIds.shift()!,
      enqueue: (job) => jobs.push(job),
    });

    const sameConversation = "11111111-1111-4111-8111-111111111111";
    await service.startDomainResearch({ conversationId: sameConversation, message: "Analyze first.example", domains: ["first.example"], documentIds: [] });
    await service.startDomainResearch({ conversationId: sameConversation, message: "Now compare second.example", domains: ["second.example"], documentIds: [] });
    await service.startDomainResearch({ conversationId: "22222222-2222-4222-8222-222222222222", message: "Analyze other.example", domains: ["other.example"], documentIds: [] });

    expect(jobs).toHaveLength(2);
    const firstJob = jobs[0]!();
    const otherJob = jobs[1]!();
    await otherJob;
    expect(run).toHaveBeenCalledWith("run-other", expect.anything());
    expect(run).not.toHaveBeenCalledWith("run-second", expect.anything());
    await expect(service.getRun("run-second")).resolves.toMatchObject({ status: "queued" });

    releaseFirst();
    await firstJob;
    expect(jobs).toHaveLength(3);
    await jobs[2]!();
    expect(run.mock.calls.map(([runId]) => runId)).toEqual(["run-first", "run-other", "run-second"]);
  });

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
      listForConversation: (conversationId: string) => baseStore.listForConversation(conversationId),
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
