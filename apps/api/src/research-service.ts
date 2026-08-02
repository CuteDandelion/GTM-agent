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
  listForConversation(conversationId: string): Promise<ResearchRunSnapshot[]>;
  claimNextForConversation?(conversationId: string, updatedAt: string): Promise<ResearchRunSnapshot | undefined>;
  save(snapshot: ResearchRunSnapshot): Promise<void>;
}

export class ResearchRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchRunConflictError";
  }
}

export class ResearchAdmissionError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Research capacity is temporarily exhausted");
    this.name = "ResearchAdmissionError";
  }
}

export class InMemoryResearchRunStore implements ResearchRunStore {
  readonly #runs = new Map<string, ResearchRunSnapshot>();

  async load(runId: string): Promise<ResearchRunSnapshot | undefined> {
    return this.#runs.get(runId);
  }

  async listForConversation(conversationId: string): Promise<ResearchRunSnapshot[]> {
    return [...this.#runs.values()]
      .filter((snapshot) => snapshot.conversationId === conversationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((snapshot) => structuredClone(snapshot));
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
  onRunUpdated?: (snapshot: ResearchRunSnapshot) => Promise<void>;
  admission?: {
    maxActiveGlobal?: number;
    maxActivePerOwner?: number;
    maxRequestsGlobalPerWindow?: number;
    maxRequestsPerOwnerPerWindow?: number;
    windowMs?: number;
    now?: () => number;
    retryAfterSeconds?: number;
  };
}

export function createResearchService(options: CreateResearchServiceOptions): ResearchService {
  const createRunId = options.createRunId ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());
  const enqueue = options.enqueue ?? ((job) => queueMicrotask(() => {
    void job().catch((error) => console.error("research background job failed", error));
  }));
  const activeRunTokens = new Map<string, { token: symbol; started: boolean }>();
  const activeConversationRuns = new Map<string, string>();
  const pendingReruns = new Map<string, { snapshot: ResearchRunSnapshot; resume: boolean }>();
  const resumeRequestedRuns = new Set<string>();
  const admission = {
    maxActiveGlobal: Math.max(1, Math.floor(options.admission?.maxActiveGlobal ?? 20)),
    maxActivePerOwner: Math.max(1, Math.floor(options.admission?.maxActivePerOwner ?? 5)),
    maxRequestsGlobalPerWindow: Math.max(1, Math.floor(options.admission?.maxRequestsGlobalPerWindow ?? 10)),
    maxRequestsPerOwnerPerWindow: Math.max(1, Math.floor(options.admission?.maxRequestsPerOwnerPerWindow ?? 3)),
    windowMs: Math.max(1_000, Math.floor(options.admission?.windowMs ?? 3_600_000)),
    now: options.admission?.now ?? Date.now,
    retryAfterSeconds: Math.max(1, Math.floor(options.admission?.retryAfterSeconds ?? 10)),
  };
  const admittedRunOwners = new Map<string, string>();
  const admittedRunsByOwner = new Map<string, number>();
  let researchWindowStartedAt = admission.now();
  let researchRequestsInWindow = 0;
  const researchRequestsByOwner = new Map<string, number>();
  const ownerKeyFor = (input: ResearchRequest) => input.ownerId ?? `conversation:${input.conversationId}`;
  const consumeResearchRequestBudget = (ownerKey: string) => {
    const currentTime = admission.now();
    const elapsed = currentTime - researchWindowStartedAt;
    if (elapsed < 0 || elapsed >= admission.windowMs) {
      researchWindowStartedAt = currentTime;
      researchRequestsInWindow = 0;
      researchRequestsByOwner.clear();
    }
    const ownerRequests = researchRequestsByOwner.get(ownerKey) ?? 0;
    if (
      researchRequestsInWindow >= admission.maxRequestsGlobalPerWindow
      || ownerRequests >= admission.maxRequestsPerOwnerPerWindow
    ) {
      return Math.max(1, Math.ceil((admission.windowMs - (currentTime - researchWindowStartedAt)) / 1_000));
    }
    researchRequestsInWindow += 1;
    researchRequestsByOwner.set(ownerKey, ownerRequests + 1);
    return undefined;
  };
  const admitRun = (runId: string, input: ResearchRequest) => {
    if (admittedRunOwners.has(runId)) return false;
    const ownerKey = ownerKeyFor(input);
    const ownerActive = admittedRunsByOwner.get(ownerKey) ?? 0;
    if (admittedRunOwners.size >= admission.maxActiveGlobal || ownerActive >= admission.maxActivePerOwner) {
      throw new ResearchAdmissionError(admission.retryAfterSeconds);
    }
    const budgetRetryAfterSeconds = consumeResearchRequestBudget(ownerKey);
    if (budgetRetryAfterSeconds !== undefined) throw new ResearchAdmissionError(budgetRetryAfterSeconds);
    admittedRunOwners.set(runId, ownerKey);
    admittedRunsByOwner.set(ownerKey, ownerActive + 1);
    return true;
  };
  const releaseRunAdmission = (runId: string) => {
    const ownerKey = admittedRunOwners.get(runId);
    if (!ownerKey) return;
    admittedRunOwners.delete(runId);
    const remaining = (admittedRunsByOwner.get(ownerKey) ?? 1) - 1;
    if (remaining === 0) admittedRunsByOwner.delete(ownerKey);
    else admittedRunsByOwner.set(ownerKey, remaining);
  };
  const saveAndPublish = async (snapshot: ResearchRunSnapshot) => {
    await options.runStore.save(snapshot);
    await options.onRunUpdated?.(structuredClone(snapshot));
  };
  const loadOwned = async (runId: string, ownerId?: string) => {
    const snapshot = await options.runStore.load(runId);
    if (!snapshot || (ownerId && snapshot.input.ownerId !== ownerId)) return undefined;
    return snapshot;
  };

  const drainConversation = async (conversationId: string) => {
    if (activeConversationRuns.has(conversationId)) return;
    const next = options.runStore.claimNextForConversation
      ? await options.runStore.claimNextForConversation(conversationId, now())
      : (await options.runStore.listForConversation(conversationId))
        .find((candidate) => candidate.status === "queued");
    if (!next || activeConversationRuns.has(conversationId)) return;
    activeConversationRuns.set(conversationId, next.runId);
    const resume = resumeRequestedRuns.delete(next.runId) || Boolean(next.checkpoint);
    enqueueExecution(next, resume);
  };

  const releaseConversation = async (snapshot: ResearchRunSnapshot) => {
    if (activeConversationRuns.get(snapshot.conversationId) !== snapshot.runId) return;
    activeConversationRuns.delete(snapshot.conversationId);
    await drainConversation(snapshot.conversationId);
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
        await saveAndPublish(running);
        const checkpoint = resume && options.scheduler.resume
          ? await options.scheduler.resume(snapshot.runId, snapshot.input)
          : await options.scheduler.run(snapshot.runId, snapshot.input);
        const status: ResearchRunStatus = checkpoint.status === "completed"
          ? "completed"
          : checkpoint.status === "cancelled" ? "cancelled" : "failed";
        await saveAndPublish({ ...running, status, checkpoint, updatedAt: now() });
      } catch (error) {
        if (error instanceof ResearchRunConflictError) return;
        const { error: _previousError, ...retryableSnapshot } = snapshot;
        const running = { ...retryableSnapshot, status: "running" as const, updatedAt: now() };
        try {
          await saveAndPublish({
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
          } else {
            releaseRunAdmission(snapshot.runId);
            await releaseConversation(snapshot);
          }
        }
      }
    });
  };

  return {
    async startDomainResearch(input) {
      const runId = createRunId();
      admitRun(runId, input);
      const timestamp = now();
      const snapshot: ResearchRunSnapshot = {
        runId,
        conversationId: input.conversationId,
        status: "queued",
        input,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      try {
        await saveAndPublish(snapshot);
        await drainConversation(snapshot.conversationId);
      } catch (error) {
        releaseRunAdmission(runId);
        throw error;
      }
      const conversationRuns = await options.runStore.listForConversation(snapshot.conversationId);
      const queuePosition = conversationRuns
        .filter((candidate) => ["queued", "running"].includes(candidate.status))
        .findIndex((candidate) => candidate.runId === runId) + 1;

      const companyLabel = input.domains.length === 1 ? input.domains[0] : `${input.domains.length} companies`;
      return {
        runId,
        status: "queued",
        queuePosition,
        interactiveObject: {
          id: `progress-${runId}`,
          type: "workflow_progress",
          version: 1,
          title: `Researching ${companyLabel}`,
          status: queuePosition > 1 ? "queued" : "running",
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
        await saveAndPublish(cancelled);
      } catch (error) {
        if (error instanceof ResearchRunConflictError) return loadOwned(runId, ownerId);
        throw error;
      }
      activeRunTokens.delete(runId);
      releaseRunAdmission(runId);
      try {
        await options.scheduler.cancel(runId);
      } catch {
        // The durable cancelled state wins even if this process does not own the worker lease.
      }
      await releaseConversation(cancelled);
      return cancelled;
    },
    async resumeRun(runId, ownerId) {
      const snapshot = await loadOwned(runId, ownerId);
      if (!snapshot) return undefined;
      if (snapshot.status === "completed") return snapshot;
      const newlyAdmitted = admitRun(snapshot.runId, snapshot.input);
      const { error: _previousError, ...retryableSnapshot } = snapshot;
      const queued = { ...retryableSnapshot, status: "queued" as const, updatedAt: now() };
      try {
        if (snapshot.status !== "queued") await saveAndPublish(queued);
        if (activeConversationRuns.get(queued.conversationId) === queued.runId) {
          enqueueExecution(queued, true);
        } else {
          resumeRequestedRuns.add(queued.runId);
          await drainConversation(queued.conversationId);
        }
      } catch (error) {
        if (newlyAdmitted) releaseRunAdmission(snapshot.runId);
        throw error;
      }
      return queued;
    },
  };
}
