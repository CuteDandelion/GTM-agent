import { describe, expect, it, vi } from "vitest";

import { createFunctionToolAdapters } from "../src/index.js";

describe("OpenAI function tool adapters", () => {
  it("keeps tool names explicit and passes structured input to the handler", async () => {
    const handler = vi.fn(async (input) => ({ saved: input }));
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
});
