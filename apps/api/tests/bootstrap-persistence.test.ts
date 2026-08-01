import { InMemoryCheckpointStore } from "@gtm/orchestration";
import { describe, expect, it } from "vitest";

import { createApplicationResearchService } from "../src/bootstrap.js";
import { InMemoryResearchArtifactStore } from "../src/research-artifacts.js";
import { InMemoryResearchRunStore } from "../src/research-service.js";
import type { ResearchPersistence } from "../src/supabase-research-persistence.js";

describe("application research persistence wiring", () => {
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
