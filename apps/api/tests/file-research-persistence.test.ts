import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DagScheduler, defineWorkflow } from "@gtm/orchestration";
import { describe, expect, it } from "vitest";

import {
  createFileResearchPersistence,
  evaluationProtocolFingerprint,
  findReusableEvaluationRun,
} from "../src/file-research-persistence.js";
import { createResearchService } from "../src/research-service.js";

describe("file-backed research persistence", () => {
  it("isolates resumable state when any evaluation protocol source changes", () => {
    expect(evaluationProtocolFingerprint(["manifest-v1", "agent-prompts-v1"]))
      .toBe(evaluationProtocolFingerprint(["manifest-v1", "agent-prompts-v1"]));
    expect(evaluationProtocolFingerprint(["manifest-v1", "agent-prompts-v1"]))
      .not.toBe(evaluationProtocolFingerprint(["manifest-v1", "agent-prompts-v2"]));
  });

  it("reuses only the latest non-cancelled run with the exact evaluation input", () => {
    const exactInput = {
      ownerId: "owner-1",
      conversationId: "conversation-1",
      message: "Compare the cohort",
      domains: ["one.example", "two.example"],
      documentIds: [],
    };
    const runs = [
      {
        runId: "wrong-cohort",
        conversationId: exactInput.conversationId,
        status: "failed" as const,
        input: { ...exactInput, domains: ["wrong.example"] },
        createdAt: "2026-08-02T10:00:00.000Z",
        updatedAt: "2026-08-02T10:00:00.000Z",
      },
      {
        runId: "cancelled-exact",
        conversationId: exactInput.conversationId,
        status: "cancelled" as const,
        input: exactInput,
        createdAt: "2026-08-02T11:00:00.000Z",
        updatedAt: "2026-08-02T11:00:00.000Z",
      },
      {
        runId: "latest-exact",
        conversationId: exactInput.conversationId,
        status: "failed" as const,
        input: exactInput,
        createdAt: "2026-08-02T12:00:00.000Z",
        updatedAt: "2026-08-02T12:00:00.000Z",
      },
    ];

    expect(findReusableEvaluationRun(runs, exactInput)?.runId).toBe("latest-exact");
    expect(findReusableEvaluationRun(runs, { ...exactInput, message: "Changed protocol" })).toBeUndefined();
  });

  it("resumes only unfinished DAG nodes and retains artifacts after a process restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gtm-live-eval-"));
    const statePath = join(directory, "state.json");
    const workflow = defineWorkflow({
      id: "resumable-evaluation",
      budget: { maxNodeExecutions: 3 },
      nodes: [
        { id: "research", dependencies: [], role: "executor", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
        { id: "review", dependencies: ["research"], role: "critic", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
      ],
    });
    const context = { ownerId: "owner-1", runId: "run-resumable" };

    try {
      const firstPersistence = await createFileResearchPersistence(statePath);
      const firstJobs: Array<() => Promise<void>> = [];
      const firstScheduler = new DagScheduler({
        workflow,
        checkpoints: firstPersistence.checkpointStore,
        executor: async ({ node }) => {
          if (node.id === "review") throw new Error("temporary provider failure");
          return { retained: node.id };
        },
      });
      const firstService = createResearchService({
        scheduler: firstScheduler,
        runStore: firstPersistence.runStore,
        createRunId: () => context.runId,
        enqueue: (job) => firstJobs.push(job),
      });

      await firstService.startDomainResearch({
        ownerId: context.ownerId,
        conversationId: "conversation-1",
        message: "Analyze acme.example",
        domains: ["acme.example"],
        documentIds: [],
      });
      await firstPersistence.artifactStore.saveCrawledPages(context, "acme.example", [{
        url: "https://acme.example/",
        title: "Acme",
        text: "Acme evidence",
        contentHash: "sha256-content",
        observedAt: "2026-08-02T12:00:00.000Z",
        trust: "untrusted_external",
      }]);
      await firstPersistence.artifactStore.saveEvidence(context, { fact: "Acme evidence" });
      await firstJobs[0]!();
      await expect(firstService.getRun(context.runId, context.ownerId)).resolves.toMatchObject({ status: "failed" });

      const restartedPersistence = await createFileResearchPersistence(statePath);
      const resumedNodes: string[] = [];
      const resumedJobs: Array<() => Promise<void>> = [];
      const restartedService = createResearchService({
        scheduler: new DagScheduler({
          workflow,
          checkpoints: restartedPersistence.checkpointStore,
          executor: async ({ node }) => {
            resumedNodes.push(node.id);
            return { resumed: node.id };
          },
        }),
        runStore: restartedPersistence.runStore,
        enqueue: (job) => resumedJobs.push(job),
      });

      await restartedService.resumeRun(context.runId, context.ownerId);
      await resumedJobs[0]!();

      await expect(restartedService.getRun(context.runId, context.ownerId)).resolves.toMatchObject({ status: "completed" });
      expect(resumedNodes).toEqual(["review"]);
      await expect(restartedPersistence.artifactStore.listCrawledPages(context)).resolves.toEqual([
        expect.objectContaining({ domain: "acme.example", pages: [expect.objectContaining({ text: "Acme evidence" })] }),
      ]);
      await expect(restartedPersistence.artifactStore.listEvidence(context)).resolves.toEqual([{ fact: "Acme evidence" }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
