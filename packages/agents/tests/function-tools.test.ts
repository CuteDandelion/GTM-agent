import { describe, expect, it, vi } from "vitest";
import { RunContext } from "@openai/agents";

import { createFunctionToolAdapters, extractToolRunContext, gtmNodeOutputType, normalizeProviderToolName, selectAvailableToolNames } from "../src/index.js";

describe("OpenAI function tool adapters", () => {
  it("forces provider output into a JSON object without constraining node-specific fields", () => {
    expect(gtmNodeOutputType).toEqual({
      type: "json_schema",
      name: "gtm_node_output",
      strict: false,
      schema: { type: "object", properties: {}, required: [], additionalProperties: true },
    });
  });

  it("normalizes hosted provider call names to DAG policy names", () => {
    expect(normalizeProviderToolName("web_search_call")).toBe("web_search");
    expect(normalizeProviderToolName("file_search_call")).toBe("file_search");
    expect(normalizeProviderToolName("code_interpreter_call")).toBe("code_interpreter");
    expect(normalizeProviderToolName("save_evidence")).toBe("save_evidence");
  });

  it("omits unavailable optional file search without hiding a required capability", () => {
    expect(selectAvailableToolNames(["read_document", "file_search"], [], ["read_document"]))
      .toEqual(["read_document"]);
    expect(() => selectAvailableToolNames(["file_search"], [], ["file_search"]))
      .toThrow("file_search requires at least one configured vector store");
    expect(selectAvailableToolNames(["file_search"], ["vs_1"], ["file_search"]))
      .toEqual(["file_search"]);
  });

  it("keeps tool names explicit and passes structured input to the handler", async () => {
    const handler = vi.fn(async (...[input]: unknown[]) => ({ saved: input }));
    const adapters = createFunctionToolAdapters({
      save_evidence: {
        description: "Persist traceable evidence.",
        handler,
      },
    });

    expect(adapters.save_evidence).toMatchObject({
      type: "function",
      name: "save_evidence",
      strict: false,
      parameters: {
        type: "object",
        properties: { input: { type: "object", additionalProperties: true } },
        required: ["input"],
        additionalProperties: true,
      },
    });
    const result = await adapters.save_evidence!.invoke({} as never, JSON.stringify({ input: { title: "Acme" } }));
    expect(handler).toHaveBeenCalledWith({ title: "Acme" });
    expect(result).toBe(JSON.stringify({ saved: { title: "Acme" } }));
  });

  it("passes trusted runner context to tool handlers instead of relying on model input", async () => {
    const handler = vi.fn(async (...[input, context]: unknown[]) => ({ input, context }));
    const adapters = createFunctionToolAdapters({
      search_evidence: {
        description: "Read only this run's evidence.",
        handler,
      },
    });
    const trustedContext = { runId: "run-1", ownerId: "owner-1" };

    await adapters.search_evidence!.invoke(
      new RunContext(trustedContext) as never,
      JSON.stringify({ input: { modelSuppliedOwnerId: "attacker" } }),
    );

    expect(handler).toHaveBeenCalledWith(
      { modelSuppliedOwnerId: "attacker" },
      trustedContext,
    );
  });

  it("derives tool ownership only from the scheduler envelope", () => {
    expect(extractToolRunContext({
      runId: "run-1",
      nodeId: "profile",
      workflowInput: {
        ownerId: "22222222-2222-4222-8222-222222222222",
        modelSuppliedOwnerId: "33333333-3333-4333-8333-333333333333",
      },
    })).toEqual({
      runId: "run-1",
      nodeId: "profile",
      ownerId: "22222222-2222-4222-8222-222222222222",
    });
    expect(() => extractToolRunContext({
      runId: "run-1",
      nodeId: "profile",
      workflowInput: { ownerId: "attacker" },
    })).toThrow();
  });
});
