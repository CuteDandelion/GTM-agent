import { describe, expect, it } from "vitest";

import { createPortfolioToolDefinitions } from "../src/portfolio-tools.js";
import { InMemoryResearchArtifactStore } from "../src/research-artifacts.js";

const context = {
  ownerId: "11111111-1111-4111-8111-111111111111",
  runId: "run-1",
  nodeId: "portfolio-comparison",
};

describe("portfolio comparison tool", () => {
  it("returns only the trusted run's crawls and evidence for an evidence-led comparison", async () => {
    const store = new InMemoryResearchArtifactStore();
    await store.saveCrawledPages(context, "alpha.example", [{
      url: "https://alpha.example/",
      title: "Alpha",
      text: "Workflow automation",
      contentHash: "sha256:alpha",
      observedAt: "2026-08-02T00:00:00.000Z",
      trust: "untrusted_external",
    }]);
    await store.saveEvidence(context, { domain: "alpha.example", claim: "Serves finance teams" });
    await store.saveEvidence({ ownerId: context.ownerId, runId: "other-run" }, { domain: "secret.example" });

    const tools = createPortfolioToolDefinitions(store);
    await expect(tools.compare_companies!.handler({ domains: ["alpha.example", "beta.example"] }, context))
      .resolves.toEqual({
        requestedDomains: ["alpha.example", "beta.example"],
        crawledCompanies: [{ domain: "alpha.example", pages: [expect.objectContaining({ title: "Alpha" })] }],
        evidence: [{ domain: "alpha.example", claim: "Serves finance teams" }],
        comparisonPolicy: "Rank only from supplied evidence; expose gaps and ties instead of inventing differentiators.",
      });
  });

  it("rejects single-company input and missing trusted context", async () => {
    const tools = createPortfolioToolDefinitions(new InMemoryResearchArtifactStore());
    await expect(tools.compare_companies!.handler({ domains: ["alpha.example"] }, context)).rejects.toThrow();
    await expect(tools.compare_companies!.handler({ domains: ["alpha.example", "beta.example"] })).rejects.toThrow("trusted workflow context");
  });
});
