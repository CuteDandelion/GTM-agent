import { describe, expect, it, vi } from "vitest";
import { RunContext } from "@openai/agents";

import { createFunctionToolAdapters, extractToolRunContext } from "../src/index.js";

describe("OpenAI function tool adapters", () => {
  it("keeps tool names explicit and passes structured input to the handler", async () => {
    const handler = vi.fn(async (...[input]: unknown[]) => ({ saved: input }));
    const adapters = createFunctionToolAdapters({
      save_evidence: {
        description: "Persist traceable evidence.",
        handler,
      },
    });

    expect(adapters.save_evidence).toMatchObject({ type: "function", name: "save_evidence", strict: true });
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
