import { randomUUID } from "node:crypto";

import type { CrawledPage } from "@gtm/crawler";

export interface ResearchArtifactContext {
  ownerId: string;
  runId: string;
}

export interface ResearchArtifactStore {
  saveCrawledPages(context: ResearchArtifactContext, domain: string, pages: CrawledPage[]): Promise<void>;
  listCrawledPages(context: ResearchArtifactContext): Promise<Array<{ domain: string; pages: CrawledPage[] }>>;
  saveEvidence(context: ResearchArtifactContext, evidence: unknown): Promise<{ id: string }>;
  listEvidence(context: ResearchArtifactContext): Promise<unknown[]>;
}

export class InMemoryResearchArtifactStore implements ResearchArtifactStore {
  readonly #artifacts = new Map<string, Array<{ kind: "crawl" | "evidence"; key: string; payload: unknown }>>();

  #key(context: ResearchArtifactContext) {
    return `${context.ownerId}:${context.runId}`;
  }

  async saveCrawledPages(context: ResearchArtifactContext, domain: string, pages: CrawledPage[]) {
    const key = this.#key(context);
    const artifacts = this.#artifacts.get(key) ?? [];
    const next = artifacts.filter((artifact) => artifact.kind !== "crawl" || artifact.key !== domain);
    next.push({ kind: "crawl", key: domain, payload: structuredClone(pages) });
    this.#artifacts.set(key, next);
  }

  async listCrawledPages(context: ResearchArtifactContext) {
    return (this.#artifacts.get(this.#key(context)) ?? [])
      .filter((artifact) => artifact.kind === "crawl")
      .map((artifact) => ({ domain: artifact.key, pages: structuredClone(artifact.payload) as CrawledPage[] }));
  }

  async saveEvidence(context: ResearchArtifactContext, evidence: unknown) {
    const key = this.#key(context);
    const artifacts = this.#artifacts.get(key) ?? [];
    const id = randomUUID();
    artifacts.push({ kind: "evidence", key: id, payload: structuredClone(evidence) });
    this.#artifacts.set(key, artifacts);
    return { id };
  }

  async listEvidence(context: ResearchArtifactContext) {
    return (this.#artifacts.get(this.#key(context)) ?? [])
      .filter((artifact) => artifact.kind === "evidence")
      .map((artifact) => structuredClone(artifact.payload));
  }
}
