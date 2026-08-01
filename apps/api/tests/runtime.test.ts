import { describe, expect, it, vi } from "vitest";

import type { AgentRuntime } from "@gtm/agents";
import { InMemoryCheckpointStore } from "@gtm/orchestration";

import { createResearchScheduler } from "../src/runtime.js";

describe("research runtime assembly", () => {
  it("executes deterministic tools locally and specialists through model-aware routes", async () => {
    const validateDomain = vi.fn(async ({ domains }: { domains: string[] }) => ({ domains }));
    const crawlCompany = vi.fn(async ({ domains }: { domains: string[] }) => ({ pages: domains }));
    const runtime: AgentRuntime = vi.fn(async (request) => ({
      output: request.agentName === "Critical Reviewer"
        ? { needsSupplementalResearch: false }
        : { node: (request.input as { nodeId: string }).nodeId },
      usedTools: request.tools,
    }));
    const scheduler = createResearchScheduler({
      agentRuntime: runtime,
      availableModels: new Set(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]),
      checkpointStore: new InMemoryCheckpointStore(),
      deterministicTools: {
        validate_domain: validateDomain,
        crawl_company: crawlCompany,
      },
    });

    const checkpoint = await scheduler.run("run-1", {
      conversationId: "conversation-1",
      message: "Analyze acme.ai",
      domains: ["acme.ai"],
      documentIds: [],
    });

    expect(checkpoint.status).toBe("completed");
    expect(checkpoint.nodes["document-research"]?.status).toBe("skipped");
    expect(validateDomain).toHaveBeenCalledOnce();
    expect(crawlCompany).toHaveBeenCalledOnce();
    expect(runtime).toHaveBeenCalled();
    expect(runtime).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.6-sol" }));
    expect(runtime).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.6-luna" }));
    expect(runtime).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.6-terra" }));
  });

  it("fails closed when a deterministic tool is not registered", async () => {
    const runtime: AgentRuntime = vi.fn(async (request) => ({ output: {}, usedTools: request.tools }));
    const scheduler = createResearchScheduler({
      agentRuntime: runtime,
      availableModels: new Set(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]),
      checkpointStore: new InMemoryCheckpointStore(),
      deterministicTools: {},
    });

    const checkpoint = await scheduler.run("run-2", { domains: ["acme.ai"], documentIds: [] });
    expect(checkpoint.status).toBe("failed");
    expect(checkpoint.nodes["validate-domain"]?.error).toMatch(/not registered/i);
  });
});
