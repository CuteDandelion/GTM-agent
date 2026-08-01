import { describe, expect, it } from "vitest";

import { InMemoryResearchArtifactStore } from "../src/research-artifacts.js";

describe("research artifact isolation", () => {
  it("scopes crawls and evidence by both owner and run", async () => {
    const store = new InMemoryResearchArtifactStore();
    const first = { ownerId: "owner-1", runId: "run-1" };
    const otherOwner = { ownerId: "owner-2", runId: "run-1" };
    const otherRun = { ownerId: "owner-1", runId: "run-2" };

    await store.saveCrawledPages(first, "acme.ai", []);
    await store.saveEvidence(first, { title: "Private evidence" });

    await expect(store.listCrawledPages(first)).resolves.toEqual([{ domain: "acme.ai", pages: [] }]);
    await expect(store.listEvidence(first)).resolves.toEqual([{ title: "Private evidence" }]);
    await expect(store.listCrawledPages(otherOwner)).resolves.toEqual([]);
    await expect(store.listEvidence(otherOwner)).resolves.toEqual([]);
    await expect(store.listCrawledPages(otherRun)).resolves.toEqual([]);
    await expect(store.listEvidence(otherRun)).resolves.toEqual([]);
  });
});
