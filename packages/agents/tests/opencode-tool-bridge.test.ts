import { describe, expect, it, vi } from "vitest";

import { createOpenCodeToolBridge, startOpenCodeToolBridgeServer } from "../src/opencode-tool-bridge.js";

describe("OpenCode tool bridge", () => {
  it("uses trusted session context and records the invoked tool", async () => {
    const handler = vi.fn(async (input, context) => ({ input, context }));
    const bridge = createOpenCodeToolBridge({ secret: "bridge-secret" });
    const registration = bridge.register({
      sessionId: "session-1",
      context: {
        runId: "run-1",
        nodeId: "analysis",
        ownerId: "22222222-2222-4222-8222-222222222222",
      },
      allowedTools: ["search_evidence"],
      requiredTools: ["search_evidence"],
      definitions: {
        search_evidence: { description: "Search evidence.", handler },
      },
    });

    const output = await bridge.invoke({
      secret: "bridge-secret",
      sessionId: "session-1",
      toolName: "search_evidence",
      input: { ownerId: "attacker" },
    });

    expect(output).toEqual({
      input: { ownerId: "attacker" },
      context: {
        runId: "run-1",
        nodeId: "analysis",
        ownerId: "22222222-2222-4222-8222-222222222222",
      },
    });
    expect(registration.usedTools()).toEqual(["search_evidence"]);
    expect(registration.missingRequiredTools()).toEqual([]);
  });

  it("rejects an invalid bridge secret and a tool outside the session allowlist", async () => {
    const bridge = createOpenCodeToolBridge({ secret: "bridge-secret" });
    bridge.register({
      sessionId: "session-1",
      context: { runId: "run-1", nodeId: "analysis", ownerId: "22222222-2222-4222-8222-222222222222" },
      allowedTools: ["search_evidence"],
      requiredTools: [],
      definitions: {
        search_evidence: { description: "Search evidence.", handler: async () => [] },
        save_evidence: { description: "Save evidence.", handler: async () => ({ saved: true }) },
      },
    });

    await expect(bridge.invoke({
      secret: "wrong",
      sessionId: "session-1",
      toolName: "search_evidence",
      input: {},
    })).rejects.toThrow("Unauthorized OpenCode tool bridge request");
    await expect(bridge.invoke({
      secret: "bridge-secret",
      sessionId: "session-1",
      toolName: "save_evidence",
      input: {},
    })).rejects.toThrow("Tool save_evidence is not allowed for OpenCode session session-1");
  });

  it("disposes session registrations without affecting another session", async () => {
    const bridge = createOpenCodeToolBridge({ secret: "bridge-secret" });
    const first = bridge.register({
      sessionId: "session-1",
      context: { runId: "run-1", nodeId: "one", ownerId: "22222222-2222-4222-8222-222222222222" },
      allowedTools: ["lookup"],
      requiredTools: [],
      definitions: { lookup: { description: "Lookup.", handler: async () => "one" } },
    });
    bridge.register({
      sessionId: "session-2",
      context: { runId: "run-2", nodeId: "two", ownerId: "33333333-3333-4333-8333-333333333333" },
      allowedTools: ["lookup"],
      requiredTools: [],
      definitions: { lookup: { description: "Lookup.", handler: async () => "two" } },
    });
    first.dispose();

    await expect(bridge.invoke({
      secret: "bridge-secret",
      sessionId: "session-1",
      toolName: "lookup",
      input: {},
    })).rejects.toThrow("Unknown OpenCode tool session: session-1");
    await expect(bridge.invoke({
      secret: "bridge-secret",
      sessionId: "session-2",
      toolName: "lookup",
      input: {},
    })).resolves.toBe("two");
  });

  it("serves authenticated loopback tool calls over HTTP", async () => {
    const bridge = createOpenCodeToolBridge({ secret: "bridge-secret" });
    bridge.register({
      sessionId: "session-1",
      context: { runId: "run-1", nodeId: "analysis", ownerId: "22222222-2222-4222-8222-222222222222" },
      allowedTools: ["lookup"],
      requiredTools: [],
      definitions: { lookup: { description: "Lookup.", handler: async (input) => ({ input }) } },
    });
    const server = await startOpenCodeToolBridgeServer({ bridge, secret: "bridge-secret" });
    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: { authorization: "Bearer bridge-secret", "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", toolName: "lookup", input: { domain: "acme.ai" } }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ output: { input: { domain: "acme.ai" } } });

      const unauthorized = await fetch(server.url, {
        method: "POST",
        headers: { authorization: "Bearer wrong", "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", toolName: "lookup", input: {} }),
      });
      expect(unauthorized.status).toBe(401);
    } finally {
      await server.close();
    }
  });
});
