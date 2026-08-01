import { randomUUID } from "node:crypto";

import type { ResearchService } from "./server.js";

export type ResearchRequest = Parameters<ResearchService["startDomainResearch"]>[0];
export type ResearchRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ResearchRunSnapshot {
  runId: string;
  conversationId: string;
  status: ResearchRunStatus;
  input: ResearchRequest;
  checkpoint?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchRunStore {
  load(runId: string): Promise<ResearchRunSnapshot | undefined>;
  save(snapshot: ResearchRunSnapshot): Promise<void>;
}

export class InMemoryResearchRunStore implements ResearchRunStore {
  readonly #runs = new Map<string, ResearchRunSnapshot>();

  async load(runId: string): Promise<ResearchRunSnapshot | undefined> {
    return this.#runs.get(runId);
  }

  async save(snapshot: ResearchRunSnapshot): Promise<void> {
    this.#runs.set(snapshot.runId, structuredClone(snapshot));
  }
}

interface SchedulerLike {
  run(runId: string, input: unknown): Promise<{ status: string }>;
  cancel(runId: string): Promise<void>;
  resume?(runId: string, input: unknown): Promise<{ status: string }>;
}

export interface CreateResearchServiceOptions {
  scheduler: SchedulerLike;
  runStore: ResearchRunStore;
  createRunId?: () => string;
  enqueue?: (job: () => Promise<void>) => void;
  now?: () => string;
}

export function createResearchService(options: CreateResearchServiceOptions): ResearchService {
  const createRunId = options.createRunId ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());
  const enqueue = options.enqueue ?? ((job) => queueMicrotask(() => void job()));
  const loadOwned = async (runId: string, ownerId?: string) => {
    const snapshot = await options.runStore.load(runId);
    if (!snapshot || (ownerId && snapshot.input.ownerId !== ownerId)) return undefined;
    return snapshot;
  };

  const enqueueExecution = (snapshot: ResearchRunSnapshot, resume: boolean) => {
    enqueue(async () => {
      const running = { ...snapshot, status: "running" as const, updatedAt: now() };
      await options.runStore.save(running);
      try {
        const checkpoint = resume && options.scheduler.resume
          ? await options.scheduler.resume(snapshot.runId, snapshot.input)
          : await options.scheduler.run(snapshot.runId, snapshot.input);
        const status: ResearchRunStatus = checkpoint.status === "completed"
          ? "completed"
          : checkpoint.status === "cancelled" ? "cancelled" : "failed";
        await options.runStore.save({ ...running, status, checkpoint, updatedAt: now() });
      } catch (error) {
        await options.runStore.save({
          ...running,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          updatedAt: now(),
        });
      }
    });
  };

  return {
    async startDomainResearch(input) {
      const runId = createRunId();
      const timestamp = now();
      const snapshot: ResearchRunSnapshot = {
        runId,
        conversationId: input.conversationId,
        status: "queued",
        input,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await options.runStore.save(snapshot);

      enqueueExecution(snapshot, false);

      const companyLabel = input.domains.length === 1 ? input.domains[0] : `${input.domains.length} companies`;
      return {
        runId,
        status: "queued",
        interactiveObject: {
          id: `progress-${runId}`,
          type: "workflow_progress",
          version: 1,
          title: `Researching ${companyLabel}`,
          status: "running",
          steps: [],
        },
      };
    },
    getRun: loadOwned,
    async cancelRun(runId, ownerId) {
      const snapshot = await loadOwned(runId, ownerId);
      if (!snapshot) return undefined;
      await options.scheduler.cancel(runId);
      const cancelled = { ...snapshot, status: "cancelled" as const, updatedAt: now() };
      await options.runStore.save(cancelled);
      return cancelled;
    },
    async resumeRun(runId, ownerId) {
      const snapshot = await loadOwned(runId, ownerId);
      if (!snapshot) return undefined;
      const queued = { ...snapshot, status: "queued" as const, updatedAt: now() };
      await options.runStore.save(queued);
      enqueueExecution(queued, true);
      return queued;
    },
  };
}
