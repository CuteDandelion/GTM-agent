import { describe, expect, it, vi } from "vitest";

import { createToolGateway, evidenceInputSchema } from "../src/index.js";

describe("scoped tool gateway", () => {
  it("allows only tools declared by the DAG node", async () => {
    const webSearch = vi.fn(async () => ({ sources: [{ url: "https://example.com", title: "Example" }] }));
    const gateway = createToolGateway({ web_search: webSearch });
    const session = gateway.startSession({
      nodeId: "current-research",
      allowedTools: ["web_search"],
      requiredTools: ["web_search"],
    });

    await session.invoke("web_search", { query: "Acme funding" });
    expect(webSearch).toHaveBeenCalledOnce();
    await expect(session.invoke("read_document", { documentId: "doc-1" })).rejects.toThrow(/not allowed/i);
    expect(() => session.assertRequirements()).not.toThrow();
  });

  it("fails completion when a mandatory tool was not used", () => {
    const gateway = createToolGateway({ web_search: async () => ({ sources: [] }) });
    const session = gateway.startSession({
      nodeId: "current-research",
      allowedTools: ["web_search"],
      requiredTools: ["web_search"],
    });

    expect(() => session.assertRequirements()).toThrow(/web_search/i);
  });

  it("requires traceable evidence metadata", () => {
    expect(() => evidenceInputSchema.parse({
      workflowRunId: "run-1",
      title: "Acme product page",
      sourceType: "web",
      excerpt: "Customer-support automation platform",
    })).toThrow();

    expect(evidenceInputSchema.parse({
      workflowRunId: "run-1",
      title: "Acme product page",
      sourceType: "web",
      sourceUrl: "https://acme.ai/product",
      observedAt: "2026-08-01T18:00:00.000Z",
      excerpt: "Customer-support automation platform",
      contentHash: "sha256:abc123",
      classification: "fact",
      confidence: 0.9,
    })).toMatchObject({ classification: "fact", confidence: 0.9 });
  });
});
