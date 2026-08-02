import { InMemoryCheckpointStore } from "@gtm/orchestration";
import { describe, expect, it } from "vitest";

import {
  createApplicationResearchService,
  createCrawlCheckpointSummary,
  createModelVisiblePageExcerpts,
  createSaveEvidenceHandler,
} from "../src/bootstrap.js";
import * as bootstrap from "../src/bootstrap.js";
import {
  InMemoryResearchArtifactStore,
  type ResearchArtifactStore,
} from "../src/research-artifacts.js";
import { InMemoryResearchRunStore } from "../src/research-service.js";
import { InMemoryInteractiveObjectService } from "../src/interactive-actions.js";
import type { ResearchPersistence } from "../src/supabase-research-persistence.js";

describe("application research persistence wiring", () => {
  it("rejects malformed model-authored evidence before persistence", async () => {
    const artifactStore: ResearchArtifactStore = {
      async saveCrawledPages() {},
      async listCrawledPages() { return []; },
      async saveEvidence() { throw new Error("persistence should not run"); },
      async listEvidence() { return []; },
    };
    const saveEvidence = createSaveEvidenceHandler(artifactStore);

    await expect(saveEvidence({
      workflowRunId: "model-forged-run",
      sourceType: "web",
      title: "Unsupported evidence",
      observedAt: "2026-08-02T00:00:00.000Z",
      excerpt: "Missing source provenance must be rejected.",
      contentHash: "sha256:missing-source",
      classification: "fact",
      confidence: 0.9,
    }, {
      ownerId: "22222222-2222-4222-8222-222222222222",
      runId: "trusted-run-1",
      nodeId: "current-research",
    })).rejects.toThrow("Evidence requires a sourceUrl or documentId");
  });

  it("persists normalized evidence under the trusted workflow run", async () => {
    const artifactStore = new InMemoryResearchArtifactStore();
    const saveEvidence = createSaveEvidenceHandler(artifactStore);
    const trustedContext = {
      ownerId: "22222222-2222-4222-8222-222222222222",
      runId: "trusted-run-2",
      nodeId: "current-research",
    };

    await expect(saveEvidence({
      workflowRunId: "model-forged-run",
      sourceType: "company-site",
      sourceUrl: "https://example.com/about",
      title: "Example company profile",
      observedAt: "2026-08-02T00:00:00.000Z",
      excerpt: "Example builds workflow automation software.",
      contentHash: "sha256:company-profile",
      classification: "fact",
      confidence: 0.91,
      untrustedExtraField: "must be removed",
    }, trustedContext)).resolves.toMatchObject({ saved: true });

    await expect(artifactStore.listEvidence(trustedContext)).resolves.toEqual([{
      workflowRunId: "trusted-run-2",
      sourceType: "company-site",
      sourceUrl: "https://example.com/about",
      title: "Example company profile",
      observedAt: "2026-08-02T00:00:00.000Z",
      excerpt: "Example builds workflow automation software.",
      contentHash: "sha256:company-profile",
      classification: "fact",
      confidence: 0.91,
      citation: {},
    }]);
  });

  it("keeps four successful targets when one target in a five-domain batch fails", async () => {
    const executeDomainBatch = (bootstrap as typeof bootstrap & {
      executeDomainBatch?: <T>(domains: string[], execute: (domain: string) => Promise<T>) => Promise<{
        completed: T[];
        failures: Array<{ domain: string; error: string }>;
      }>;
    }).executeDomainBatch;
    expect(executeDomainBatch).toBeTypeOf("function");

    const result = await executeDomainBatch!([
      "alpha.example",
      "beta.example",
      "broken.example",
      "delta.example",
      "echo.example",
    ], async (domain) => {
      if (domain === "broken.example") throw new Error("forced crawl failure");
      return { domain, pageCount: 1 };
    });

    expect(result).toEqual({
      completed: [
        { domain: "alpha.example", pageCount: 1 },
        { domain: "beta.example", pageCount: 1 },
        { domain: "delta.example", pageCount: 1 },
        { domain: "echo.example", pageCount: 1 },
      ],
      failures: [{ domain: "broken.example", error: "forced crawl failure" }],
    });
  });

  it("persists successful crawls and reports the failed target to downstream batch nodes", async () => {
    const createDeterministicDomainTools = (bootstrap as typeof bootstrap & {
      createDeterministicDomainTools?: (input: {
        artifactStore: InMemoryResearchArtifactStore;
        validatePublicDomain(domain: string): Promise<string>;
        crawlDomain(domain: string): Promise<{
          rootUrl: string;
          pages: Array<{
            url: string;
            title: string;
            text: string;
            contentHash: string;
            observedAt: string;
            trust: "untrusted_external";
          }>;
        }>;
      }) => {
        crawl_company(input: {
          domains: string[];
          runId: string;
          workflowInput: { ownerId: string };
        }): Promise<unknown>;
      };
    }).createDeterministicDomainTools;
    expect(createDeterministicDomainTools).toBeTypeOf("function");
    const artifactStore = new InMemoryResearchArtifactStore();
    const tools = createDeterministicDomainTools!({
      artifactStore,
      validatePublicDomain: async (domain) => `https://${domain}/`,
      crawlDomain: async (domain) => {
        if (domain === "broken.example") throw new Error("forced crawl failure");
        return {
          rootUrl: `https://${domain}/`,
          pages: [{
            url: `https://${domain}/`,
            title: domain,
            text: `${domain} evidence`,
            contentHash: `sha256:${domain}`,
            observedAt: "2026-08-02T00:00:00.000Z",
            trust: "untrusted_external" as const,
          }],
        };
      },
    });

    const output = await tools.crawl_company({
      domains: ["alpha.example", "beta.example", "broken.example", "delta.example", "echo.example"],
      runId: "batch-run-1",
      workflowInput: { ownerId: "22222222-2222-4222-8222-222222222222" },
    });

    expect(output).toMatchObject({
      companies: [
        { domain: "alpha.example", pageCount: 1 },
        { domain: "beta.example", pageCount: 1 },
        { domain: "delta.example", pageCount: 1 },
        { domain: "echo.example", pageCount: 1 },
      ],
      failures: [{ domain: "broken.example", error: "forced crawl failure" }],
    });
    await expect(artifactStore.listCrawledPages({
      ownerId: "22222222-2222-4222-8222-222222222222",
      runId: "batch-run-1",
    })).resolves.toHaveLength(4);
    await expect(artifactStore.listEvidence({
      ownerId: "22222222-2222-4222-8222-222222222222",
      runId: "batch-run-1",
    })).resolves.toEqual([{
      kind: "domain_failure",
      domain: "broken.example",
      error: "forced crawl failure",
      classification: "fact",
    }]);
  });

  it("fails closed when every target in a domain batch fails", async () => {
    const createDeterministicDomainTools = (bootstrap as typeof bootstrap & {
      createDeterministicDomainTools?: (input: {
        artifactStore: InMemoryResearchArtifactStore;
        validatePublicDomain(domain: string): Promise<string>;
        crawlDomain(domain: string): Promise<never>;
      }) => {
        crawl_company(input: {
          domains: string[];
          runId: string;
          workflowInput: { ownerId: string };
        }): Promise<unknown>;
      };
    }).createDeterministicDomainTools!;
    const tools = createDeterministicDomainTools({
      artifactStore: new InMemoryResearchArtifactStore(),
      validatePublicDomain: async (domain) => `https://${domain}/`,
      crawlDomain: async (domain) => {
        throw new Error(`${domain} unavailable`);
      },
    });

    await expect(tools.crawl_company({
      domains: ["broken-one.example", "broken-two.example"],
      runId: "batch-run-failed",
      workflowInput: { ownerId: "22222222-2222-4222-8222-222222222222" },
    })).rejects.toThrow("All 2 domain targets failed");
  });

  it("wires accepted research runs into the mobile-visible projection sink", async () => {
    const ownerId = "22222222-2222-4222-8222-222222222222";
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const interactiveObjectService = new InMemoryInteractiveObjectService();
    const service = createApplicationResearchService({
      persistence: {
        runStore: new InMemoryResearchRunStore(),
        checkpointStore: new InMemoryCheckpointStore(),
        artifactStore: new InMemoryResearchArtifactStore(),
      },
      interactiveObjectService,
      enqueue: () => undefined,
    });

    await service.startDomainResearch({
      ownerId,
      conversationId,
      message: "Analyze foodbegood.app",
      domains: ["foodbegood.app"],
      documentIds: [],
    });

    await expect(interactiveObjectService.listForConversation(ownerId, conversationId)).resolves.toMatchObject([{
      type: "workflow_progress",
      title: "Researching foodbegood.app",
      live: true,
      version: 1,
    }]);
  });

  it("keeps raw page text out of crawl checkpoint outputs after persistence", () => {
    const summary = createCrawlCheckpointSummary("https://example.com", {
      rootUrl: "https://example.com/",
      pages: [{
        url: "https://example.com/",
        title: "Example",
        text: "large untrusted model input",
        contentHash: "sha256:abc",
        observedAt: "2026-08-02T00:00:00.000Z",
        trust: "untrusted_external",
      }],
    });

    expect(summary).toEqual({
      domain: "https://example.com",
      rootUrl: "https://example.com/",
      pageCount: 1,
      pages: [{
        url: "https://example.com/",
        title: "Example",
        contentHash: "sha256:abc",
        observedAt: "2026-08-02T00:00:00.000Z",
      }],
    });
    expect(JSON.stringify(summary)).not.toContain("large untrusted model input");
  });

  it("bounds model-visible crawl excerpts without dropping source provenance", () => {
    const pages = createModelVisiblePageExcerpts([{
      domain: "https://example.com",
      url: "https://example.com/about",
      title: "About",
      text: "x".repeat(4_000),
      contentHash: "sha256:def",
      observedAt: "2026-08-02T00:00:00.000Z",
      trust: "untrusted_external",
    }]);

    expect(pages[0]).toMatchObject({
      domain: "https://example.com",
      url: "https://example.com/about",
      contentHash: "sha256:def",
      observedAt: "2026-08-02T00:00:00.000Z",
      textTruncated: true,
    });
    expect(pages[0]?.text).toHaveLength(750);
  });

  it("fails closed instead of using process memory in production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => createApplicationResearchService()).toThrow(/production research requires/i);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("fails closed when production document storage is unavailable", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousUrl = process.env.SUPABASE_URL;
    const previousSecret = process.env.SUPABASE_SECRET_KEY;
    process.env.NODE_ENV = "production";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    const persistence: ResearchPersistence = {
      runStore: new InMemoryResearchRunStore(),
      checkpointStore: new InMemoryCheckpointStore(),
      artifactStore: new InMemoryResearchArtifactStore(),
    };
    try {
      expect(() => createApplicationResearchService({ persistence }))
        .toThrow(/production documents require/i);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previousUrl;
      if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
      else process.env.SUPABASE_SECRET_KEY = previousSecret;
    }
  });

  it("restores an accepted run through a new service instance using the configured persistence", async () => {
    const persistence: ResearchPersistence = {
      runStore: new InMemoryResearchRunStore(),
      checkpointStore: new InMemoryCheckpointStore(),
      artifactStore: new InMemoryResearchArtifactStore(),
    };
    const firstProcess = createApplicationResearchService({ persistence, enqueue: () => undefined });

    const accepted = await firstProcess.startDomainResearch({
      ownerId: "22222222-2222-4222-8222-222222222222",
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Analyze acme.ai",
      domains: ["acme.ai"],
      documentIds: [],
    });
    const restartedProcess = createApplicationResearchService({ persistence, enqueue: () => undefined });

    await expect(restartedProcess.getRun(accepted.runId, "22222222-2222-4222-8222-222222222222"))
      .resolves.toMatchObject({ status: "queued", conversationId: "11111111-1111-4111-8111-111111111111" });
  });
});
