import { describe, expect, it, vi } from "vitest";

import {
  createOpenCodeRuntime,
  type OpenCodeSessionTransport,
} from "../src/opencode-runtime.js";
import { createOpenCodeToolBridge } from "../src/opencode-tool-bridge.js";

function createTransport(options: {
  output?: unknown;
  toolNames?: string[];
  promptError?: Error;
} = {}) {
  const transport: OpenCodeSessionTransport = {
    createSession: vi.fn(async () => ({ id: "session-1" })),
    prompt: vi.fn(async () => {
      if (options.promptError) throw options.promptError;
      return {
        messageId: "message-1",
        structuredOutput: options.output ?? { kind: "answer", message: "Ready" },
        toolNames: options.toolNames ?? [],
      };
    }),
    deleteSession: vi.fn(async () => undefined),
  };
  return transport;
}

describe("OpenCode agent runtime", () => {
  it("runs a provider-qualified model with structured output and a deny-by-default tool map", async () => {
    const transport = createTransport({ toolNames: ["websearch", "gtm_save_evidence", "gtm_save_evidence"] });
    const bridge = createOpenCodeToolBridge({ secret: "test-secret" });
    const runtime = createOpenCodeRuntime({
      transport,
      bridge,
      toolDefinitions: {
        save_evidence: {
          description: "Save evidence.",
          handler: async () => ({ saved: true }),
        },
      },
    });

    const result = await runtime({
      agentName: "GTM analyst",
      instructions: "Return grounded analysis.",
      model: "opencode-go/grok-4.5",
      reasoningEffort: "high",
      tools: ["web_search", "save_evidence"],
      requiredTools: ["save_evidence"],
      input: {
        runId: "run-1",
        nodeId: "analysis",
        workflowInput: { ownerId: "22222222-2222-4222-8222-222222222222" },
      },
    });

    expect(result).toEqual({
      output: { kind: "answer", message: "Ready" },
      usedTools: ["web_search", "save_evidence"],
      responseId: "message-1",
    });
    expect(transport.prompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      model: { providerID: "opencode-go", modelID: "grok-4.5" },
      variant: "high",
      system: expect.stringContaining("save_evidence: Save evidence."),
      format: expect.objectContaining({ type: "json_schema", retryCount: 2 }),
      tools: expect.objectContaining({
        bash: false,
        edit: false,
        read: false,
        task: false,
        question: false,
        StructuredOutput: true,
        websearch: true,
        gtm_get_seller_profile: false,
        gtm_save_evidence: true,
      }),
    }));
    expect(transport.deleteSession).toHaveBeenCalledWith("session-1");
  });

  it("fails closed when a required tool was not used and still deletes the session", async () => {
    const transport = createTransport();
    const runtime = createOpenCodeRuntime({
      transport,
      bridge: createOpenCodeToolBridge({ secret: "test-secret" }),
      toolDefinitions: {
        save_evidence: { description: "Save evidence.", handler: async () => ({ saved: true }) },
      },
    });

    await expect(runtime({
      agentName: "GTM analyst",
      instructions: "Return grounded analysis.",
      model: "opencode-go/grok-4.5",
      reasoningEffort: "medium",
      tools: ["save_evidence"],
      requiredTools: ["save_evidence"],
      input: {
        runId: "run-1",
        nodeId: "analysis",
        workflowInput: { ownerId: "22222222-2222-4222-8222-222222222222" },
      },
    })).rejects.toThrow("Required OpenCode tools were not used: save_evidence");
    expect(transport.deleteSession).toHaveBeenCalledWith("session-1");
  });

  it("deletes the ephemeral session when prompting fails", async () => {
    const transport = createTransport({ promptError: new Error("provider unavailable") });
    const runtime = createOpenCodeRuntime({
      transport,
      bridge: createOpenCodeToolBridge({ secret: "test-secret" }),
    });

    await expect(runtime({
      agentName: "Conversation manager",
      instructions: "Choose the next action.",
      model: "opencode-go/grok-4.5",
      reasoningEffort: "low",
      tools: [],
      input: {
        runId: "run-1",
        nodeId: "conversation",
        workflowInput: { ownerId: "22222222-2222-4222-8222-222222222222" },
      },
    })).rejects.toThrow("provider unavailable");
    expect(transport.deleteSession).toHaveBeenCalledWith("session-1");
  });

  it("rejects unqualified model identifiers before creating a session", async () => {
    const transport = createTransport();
    const runtime = createOpenCodeRuntime({
      transport,
      bridge: createOpenCodeToolBridge({ secret: "test-secret" }),
    });

    await expect(runtime({
      agentName: "Conversation manager",
      instructions: "Choose the next action.",
      model: "qwen3.7-plus",
      reasoningEffort: "low",
      tools: [],
      input: {},
    })).rejects.toThrow("OpenCode models must use provider/model format");
    expect(transport.createSession).not.toHaveBeenCalled();
  });
});
