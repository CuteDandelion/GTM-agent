import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CheckpointStore, RunCheckpoint } from "@gtm/orchestration";

import type { ResearchArtifactStore } from "./research-artifacts.js";
import { createSupabaseFetch } from "./supabase-fetch.js";
import {
  ResearchRunConflictError,
  type ResearchRunSnapshot,
  type ResearchRunStore,
} from "./research-service.js";

type WorkflowRunRow = {
  id: string;
  owner_id: string;
  conversation_id: string;
  status: ResearchRunSnapshot["status"];
  input: ResearchRunSnapshot["input"];
  output: unknown;
  state_version: number;
  started_at: string | null;
  created_at: string;
  updated_at: string;
};

export interface ResearchPersistence {
  runStore: ResearchRunStore;
  checkpointStore: CheckpointStore;
  artifactStore: ResearchArtifactStore;
}

const workflowRunColumns = "id,owner_id,conversation_id,status,input,output,state_version,started_at,created_at,updated_at";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sameResearchInput(left: ResearchRunSnapshot["input"], right: ResearchRunSnapshot["input"]) {
  return left.ownerId === right.ownerId
    && left.conversationId === right.conversationId
    && left.message === right.message
    && JSON.stringify(left.domains) === JSON.stringify(right.domains)
    && JSON.stringify(left.documentIds) === JSON.stringify(right.documentIds);
}

function mapRun(row: WorkflowRunRow, checkpoint?: RunCheckpoint): ResearchRunSnapshot {
  const output = record(row.output);
  return {
    runId: row.id,
    conversationId: row.conversation_id,
    status: row.status,
    input: { ...row.input, ownerId: row.owner_id },
    ...(checkpoint ? { checkpoint } : {}),
    ...(typeof output.error === "string" ? { error: output.error } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function createSupabaseResearchPersistence(
  client: SupabaseClient,
  options: { workerLeaseId?: string } = {},
): ResearchPersistence {
  const workerLeaseId = options.workerLeaseId ?? randomUUID();
  const templateIds = new Map<string, string>();
  const runOwners = new Map<string, string>();
  const checkpointVersions = new Map<string, number>();
  const checkpointVersionLoads = new Map<string, Promise<number>>();
  const checkpointSaveQueues = new Map<string, Promise<void>>();

  const ensureTemplate = async (ownerId: string) => {
    const cached = templateIds.get(ownerId);
    if (cached) return cached;
    const result = await client.from("workflow_templates").upsert({
      owner_id: ownerId,
      name: "company-domain-research",
      version: 1,
      dag: { workflowId: "company-domain-research-v1" },
      model_policy: {
        planner: "opencode-go/minimax-m3",
        executor: "opencode-go/gpt-5.6-luna",
        analyst: "opencode-go/minimax-m3",
        critic: "opencode-go/minimax-m3",
      },
      tool_policy: { externalWritesRequireApproval: true },
    }, { onConflict: "owner_id,name,version" }).select("id").single();
    if (result.error) throw new Error(`Unable to ensure workflow template: ${result.error.message}`);
    const id = (result.data as { id: string }).id;
    templateIds.set(ownerId, id);
    return id;
  };

  const resolveRunOwner = async (runId: string) => {
    const cached = runOwners.get(runId);
    if (cached) return cached;
    const result = await client.from("workflow_runs").select("owner_id").eq("id", runId).maybeSingle();
    if (result.error) throw new Error(`Unable to authorize workflow run: ${result.error.message}`);
    if (!result.data) throw new Error(`Workflow run ${runId} does not exist`);
    const ownerId = (result.data as { owner_id: string }).owner_id;
    runOwners.set(runId, ownerId);
    return ownerId;
  };

  const loadCheckpoint = async (runId: string) => {
    const ownerId = await resolveRunOwner(runId);
    const result = await client.from("workflow_checkpoints")
      .select("version,checkpoint")
      .eq("workflow_run_id", runId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (result.error) throw new Error(`Unable to load workflow checkpoint: ${result.error.message}`);
    if (!result.data) return undefined;
    const row = result.data as { version: number; checkpoint: RunCheckpoint };
    checkpointVersions.set(runId, Number(row.version));
    return row.checkpoint;
  };

  const initializeCheckpointVersion = (runId: string) => {
    const existing = checkpointVersionLoads.get(runId);
    if (existing) return existing;
    const loading = resolveRunOwner(runId).then((ownerId) => client.from("workflow_checkpoints").select("version")
      .eq("workflow_run_id", runId).eq("owner_id", ownerId).maybeSingle()).then((result) => {
        if (result.error) throw new Error(`Unable to load workflow checkpoint version: ${result.error.message}`);
        const version = result.data ? Number((result.data as { version: number }).version) : 0;
        checkpointVersions.set(runId, version);
        return version;
      }).finally(() => checkpointVersionLoads.delete(runId));
    checkpointVersionLoads.set(runId, loading);
    return loading;
  };

  const requireOwnedRun = async (runId: string, ownerId: string) => {
    const resolvedOwnerId = await resolveRunOwner(runId);
    if (resolvedOwnerId !== ownerId) {
      throw new Error(`Workflow run ${runId} does not belong to the authenticated owner`);
    }
  };

  const runStore: ResearchRunStore = {
    async load(runId) {
      const result = await client.from("workflow_runs").select(workflowRunColumns).eq("id", runId).maybeSingle();
      if (result.error) throw new Error(`Unable to load research run: ${result.error.message}`);
      if (!result.data) return undefined;
      const row = result.data as WorkflowRunRow;
      runOwners.set(runId, row.owner_id);
      return mapRun(row, await loadCheckpoint(runId));
    },
    async listForConversation(conversationId) {
      const result = await client.from("workflow_runs")
        .select(workflowRunColumns)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (result.error) throw new Error(`Unable to list conversation research runs: ${result.error.message}`);
      return Promise.all((result.data as WorkflowRunRow[]).map(async (row) => {
        runOwners.set(row.id, row.owner_id);
        return mapRun(row, await loadCheckpoint(row.id));
      }));
    },
    async claimNextForConversation(conversationId, updatedAt) {
      const result = await client.rpc("claim_next_conversation_workflow_run", {
        p_conversation_id: conversationId,
        p_worker_lease_id: workerLeaseId,
        p_updated_at: updatedAt,
      });
      if (result.error) throw new Error(`Unable to claim the next conversation research run: ${result.error.message}`);
      if (!result.data) return undefined;
      return runStore.load(String(result.data));
    },
    async save(snapshot) {
      const ownerId = snapshot.input.ownerId;
      if (!ownerId) throw new Error("Durable research runs require an authenticated owner");
      const existing = await client.from("workflow_runs")
        .select("owner_id,conversation_id,workflow_template_id,input,status,state_version")
        .eq("id", snapshot.runId)
        .maybeSingle();
      if (existing.error) throw new Error(`Unable to inspect research run: ${existing.error.message}`);
      const output = snapshot.status === "failed" && snapshot.error ? { error: snapshot.error } : {};

      if (!existing.data) {
        const templateId = await ensureTemplate(ownerId);
        const inserted = await client.from("workflow_runs").insert({
          id: snapshot.runId,
          owner_id: ownerId,
          conversation_id: snapshot.conversationId,
          workflow_template_id: templateId,
          status: snapshot.status,
          input: { ...snapshot.input, ownerId },
          output,
          worker_lease_id: snapshot.status === "running" ? workerLeaseId : null,
          lease_expires_at: snapshot.status === "running"
            ? new Date(Date.now() + 15 * 60_000).toISOString()
            : null,
          started_at: snapshot.status === "running" ? snapshot.updatedAt : null,
          completed_at: ["completed", "failed", "cancelled"].includes(snapshot.status) ? snapshot.updatedAt : null,
          created_at: snapshot.createdAt,
          updated_at: snapshot.updatedAt,
        });
        if (inserted.error) throw new Error(`Unable to create research run: ${inserted.error.message}`);
        runOwners.set(snapshot.runId, ownerId);
        return;
      }

      const current = existing.data as {
        owner_id: string;
        conversation_id: string;
        workflow_template_id: string;
        input: ResearchRunSnapshot["input"];
        state_version: number;
      };
      if (current.owner_id !== ownerId) throw new Error(`Workflow run ${snapshot.runId} belongs to another owner`);
      const templateId = await ensureTemplate(ownerId);
      if (current.conversation_id !== snapshot.conversationId
        || current.workflow_template_id !== templateId
        || !sameResearchInput(current.input, { ...snapshot.input, ownerId })) {
        throw new Error(`Workflow run ${snapshot.runId} immutable fields cannot be changed`);
      }
      const updated = await client.rpc("update_workflow_run_state", {
        p_workflow_run_id: snapshot.runId,
        p_owner_id: ownerId,
        p_expected_version: Number(current.state_version),
        p_worker_lease_id: workerLeaseId,
        p_status: snapshot.status,
        p_output: output,
        p_updated_at: snapshot.updatedAt,
      });
      if (updated.error) {
        if (/version conflict|invalid workflow run transition|worker lease (?:conflict|expired)/i.test(updated.error.message)) {
          throw new ResearchRunConflictError(updated.error.message);
        }
        throw new Error(`Unable to save research run: ${updated.error.message}`);
      }
      runOwners.set(snapshot.runId, ownerId);
    },
  };

  const checkpointStore: CheckpointStore = {
    load: loadCheckpoint,
    async save(checkpoint) {
      const previous = checkpointSaveQueues.get(checkpoint.runId) ?? Promise.resolve();
      const saving = previous.then(async () => {
        if (!checkpointVersions.has(checkpoint.runId)) {
          await initializeCheckpointVersion(checkpoint.runId);
        }
        const ownerId = await resolveRunOwner(checkpoint.runId);
        const expectedVersion = checkpointVersions.get(checkpoint.runId) ?? 0;
        const result = await client.rpc("save_workflow_checkpoint", {
          p_workflow_run_id: checkpoint.runId,
          p_owner_id: ownerId,
          p_expected_version: expectedVersion,
          p_worker_lease_id: workerLeaseId,
          p_checkpoint: checkpoint,
        });
        if (result.error) {
          if (/version conflict|worker lease (?:conflict|expired)|is not running/i.test(result.error.message)) {
            throw new ResearchRunConflictError(result.error.message);
          }
          throw new Error(`Unable to save workflow checkpoint: ${result.error.message}`);
        }
        checkpointVersions.set(checkpoint.runId, Number(result.data));
      });
      checkpointSaveQueues.set(checkpoint.runId, saving.catch(() => undefined));
      await saving;
    },
  };

  const artifactStore: ResearchArtifactStore = {
    async saveCrawledPages(context, domain, pages) {
      await requireOwnedRun(context.runId, context.ownerId);
      const result = await client.from("research_artifacts").upsert({
        owner_id: context.ownerId,
        workflow_run_id: context.runId,
        artifact_kind: "crawl_page",
        artifact_key: domain,
        payload: { domain, pages },
        updated_at: new Date().toISOString(),
      }, { onConflict: "workflow_run_id,artifact_kind,artifact_key" });
      if (result.error) throw new Error(`Unable to save crawled pages: ${result.error.message}`);
    },
    async listCrawledPages(context) {
      await requireOwnedRun(context.runId, context.ownerId);
      const result = await client.from("research_artifacts").select("payload")
        .eq("workflow_run_id", context.runId).eq("owner_id", context.ownerId)
        .eq("artifact_kind", "crawl_page").order("created_at");
      if (result.error) throw new Error(`Unable to load crawled pages: ${result.error.message}`);
      return (result.data ?? []).map((row) => (row as { payload: { domain: string; pages: never[] } }).payload);
    },
    async saveEvidence(context, evidence) {
      await requireOwnedRun(context.runId, context.ownerId);
      const id = randomUUID();
      const result = await client.from("research_artifacts").insert({
        id,
        owner_id: context.ownerId,
        workflow_run_id: context.runId,
        artifact_kind: "evidence",
        artifact_key: id,
        payload: evidence,
      });
      if (result.error) throw new Error(`Unable to save evidence: ${result.error.message}`);
      return { id };
    },
    async listEvidence(context) {
      await requireOwnedRun(context.runId, context.ownerId);
      const result = await client.from("research_artifacts").select("payload")
        .eq("workflow_run_id", context.runId).eq("owner_id", context.ownerId)
        .eq("artifact_kind", "evidence").order("created_at");
      if (result.error) throw new Error(`Unable to load evidence: ${result.error.message}`);
      return (result.data ?? []).map((row) => (row as { payload: unknown }).payload);
    },
  };

  return { runStore, checkpointStore, artifactStore };
}

export function createEnvironmentResearchPersistence(
  environment: NodeJS.ProcessEnv = process.env,
): ResearchPersistence | undefined {
  const url = environment.SUPABASE_URL;
  const secretKey = environment.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return undefined;
  return createSupabaseResearchPersistence(createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseFetch() },
  }));
}
