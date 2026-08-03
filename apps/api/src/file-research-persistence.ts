import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CrawledPage } from "@gtm/crawler";
import type { RunCheckpoint } from "@gtm/orchestration";

import type { ResearchArtifactContext } from "./research-artifacts.js";
import type { ResearchRequest, ResearchRunSnapshot } from "./research-service.js";
import type { ResearchPersistence } from "./supabase-research-persistence.js";

interface StoredArtifact {
  kind: "crawl" | "evidence";
  key: string;
  payload: unknown;
}

interface FileResearchState {
  version: 1;
  runs: Record<string, ResearchRunSnapshot>;
  checkpoints: Record<string, RunCheckpoint>;
  artifacts: Record<string, StoredArtifact[]>;
}

const emptyState = (): FileResearchState => ({ version: 1, runs: {}, checkpoints: {}, artifacts: {} });

export function evaluationProtocolFingerprint(sources: string[]): string {
  const hash = createHash("sha256");
  for (const source of sources) hash.update(`${Buffer.byteLength(source)}:`).update(source);
  return hash.digest("hex").slice(0, 16);
}

export function findReusableEvaluationRun(
  runs: ResearchRunSnapshot[],
  input: ResearchRequest,
): ResearchRunSnapshot | undefined {
  const sameValues = (left: string[], right: string[]) =>
    left.length === right.length && left.every((value, index) => value === right[index]);
  return runs
    .filter((run) => run.status !== "cancelled"
      && run.input.ownerId === input.ownerId
      && run.input.conversationId === input.conversationId
      && run.input.message === input.message
      && sameValues(run.input.domains, input.domains)
      && sameValues(run.input.documentIds, input.documentIds))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

async function loadState(filePath: string): Promise<FileResearchState> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<FileResearchState>;
    if (parsed.version !== 1 || !parsed.runs || !parsed.checkpoints || !parsed.artifacts) {
      throw new Error(`Unsupported or incomplete research state at ${filePath}`);
    }
    return structuredClone(parsed as FileResearchState);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }
}

export async function createFileResearchPersistence(filePath: string): Promise<ResearchPersistence> {
  const state = await loadState(filePath);
  let writeQueue = Promise.resolve();
  const persist = async () => {
    const snapshot = `${JSON.stringify(structuredClone(state), null, 2)}\n`;
    writeQueue = writeQueue.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, snapshot, { mode: 0o600 });
      await rename(temporaryPath, filePath);
    });
    await writeQueue;
  };
  const artifactKey = (context: ResearchArtifactContext) => `${context.ownerId}:${context.runId}`;

  return {
    runStore: {
      async load(runId) {
        const run = state.runs[runId];
        return run ? structuredClone(run) : undefined;
      },
      async listForConversation(conversationId) {
        return Object.values(state.runs)
          .filter((run) => run.conversationId === conversationId)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .map((run) => structuredClone(run));
      },
      async save(snapshot) {
        state.runs[snapshot.runId] = structuredClone(snapshot);
        await persist();
      },
    },
    checkpointStore: {
      async load(runId) {
        const checkpoint = state.checkpoints[runId];
        return checkpoint ? structuredClone(checkpoint) : undefined;
      },
      async save(checkpoint) {
        state.checkpoints[checkpoint.runId] = structuredClone(checkpoint);
        await persist();
      },
    },
    artifactStore: {
      async saveCrawledPages(context, domain, pages) {
        const key = artifactKey(context);
        const retained = (state.artifacts[key] ?? [])
          .filter((artifact) => artifact.kind !== "crawl" || artifact.key !== domain);
        retained.push({ kind: "crawl", key: domain, payload: structuredClone(pages) });
        state.artifacts[key] = retained;
        await persist();
      },
      async listCrawledPages(context) {
        return (state.artifacts[artifactKey(context)] ?? [])
          .filter((artifact) => artifact.kind === "crawl")
          .map((artifact) => ({ domain: artifact.key, pages: structuredClone(artifact.payload) as CrawledPage[] }));
      },
      async saveEvidence(context, evidence) {
        const key = artifactKey(context);
        const id = randomUUID();
        const artifacts = state.artifacts[key] ?? [];
        artifacts.push({ kind: "evidence", key: id, payload: structuredClone(evidence) });
        state.artifacts[key] = artifacts;
        await persist();
        return { id };
      },
      async listEvidence(context) {
        return (state.artifacts[artifactKey(context)] ?? [])
          .filter((artifact) => artifact.kind === "evidence")
          .map((artifact) => structuredClone(artifact.payload));
      },
    },
  };
}
