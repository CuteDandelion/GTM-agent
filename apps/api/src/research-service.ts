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

export class ResearchRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchRunConflictError";
  }
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
  const enqueue = options.enqueue ?? ((job) => queueMicrotask(() => {
    void job().catch((error) => console.error("research background job failed", error));
  }));
  const activeRunTokens = new Map<string, { token: symbol; started: boolean }>();
  const pendingReruns = new Map<string, { snapshot: ResearchRunSnapshot; resume: boolean }>();
  const loadOwned = async (runId: string, ownerId?: string) => {
    const snapshot = await options.runStore.load(runId);
    if (!snapshot || (ownerId && snapshot.input.ownerId !== ownerId)) return undefined;
    return snapshot;
  };

  const enqueueExecution = (snapshot: ResearchRunSnapshot, resume: boolean) => {
    const active = activeRunTokens.get(snapshot.runId);
    if (active) {
      if (active.started) pendingReruns.set(snapshot.runId, { snapshot, resume });
      return;
    }
    const executionToken = Symbol(snapshot.runId);
    activeRunTokens.set(snapshot.runId, { token: executionToken, started: false });
    enqueue(async () => {
      const scheduled = activeRunTokens.get(snapshot.runId);
      if (scheduled?.token !== executionToken) return;
      scheduled.started = true;
      try {
        const { error: _previousError, ...retryableSnapshot } = snapshot;
        const running = { ...retryableSnapshot, status: "running" as const, updatedAt: now() };
        await options.runStore.save(running);
        const checkpoint = resume && options.scheduler.resume
          ? await options.scheduler.resume(snapshot.runId, snapshot.input)
          : await options.scheduler.run(snapshot.runId, snapshot.input);
        const status: ResearchRunStatus = checkpoint.status === "completed"
          ? "completed"
          : checkpoint.status === "cancelled" ? "cancelled" : "failed";
        await options.runStore.save({ ...running, status, checkpoint, updatedAt: now() });
      } catch (error) {
        if (error instanceof ResearchRunConflictError) return;
        const { error: _previousError, ...retryableSnapshot } = snapshot;
        const running = { ...retryableSnapshot, status: "running" as const, updatedAt: now() };
        try {
          await options.runStore.save({
            ...running,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            updatedAt: now(),
          });
        } catch (saveError) {
          if (!(saveError instanceof ResearchRunConflictError)) throw saveError;
        }
      } finally {
        if (activeRunTokens.get(snapshot.runId)?.token === executionToken) {
          activeRunTokens.delete(snapshot.runId);
          const pending = pendingReruns.get(snapshot.runId);
          if (pending) {
            pendingReruns.delete(snapshot.runId);
            enqueueExecution(pending.snapshot, pending.resume);
          }
        }
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
      if (["cancelled", "completed", "failed"].includes(snapshot.status)) return snapshot;
      const cancelled = { ...snapshot, status: "cancelled" as const, updatedAt: now() };
      try {
        await options.runStore.save(cancelled);
      } catch (error) {
        if (error instanceof ResearchRunConflictError) return loadOwned(runId, ownerId);
        throw error;
      }
      activeRunTokens.delete(runId);
      try {
        await options.scheduler.cancel(runId);
      } catch {
        // The durable cancelled state wins even if this process does not own the worker lease.
      }
      return cancelled;
    },
    async resumeRun(runId, ownerId) {
      const snapshot = await loadOwned(runId, ownerId);
      if (!snapshot) return undefined;
      if (snapshot.status === "completed") return snapshot;
      const { error: _previousError, ...retryableSnapshot } = snapshot;
      const queued = { ...retryableSnapshot, status: "queued" as const, updatedAt: now() };
      if (snapshot.status !== "queued") await options.runStore.save(queued);
      enqueueExecution(queued, true);
      return queued;
    },
  };
}
