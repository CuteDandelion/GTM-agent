import { describe, expect, it, vi } from "vitest";

import { createOpenCodeSessionTransport, startOpenCodeAgentService } from "../src/opencode-service.js";

describe("OpenCode SDK transport", () => {
  it("translates session creation, prompting, structured output, and tool parts", async () => {
    const client = {
      session: {
        create: vi.fn(async () => ({ data: { id: "session-1" } })),
        prompt: vi.fn(async () => ({
          data: {
            info: { id: "message-1", structured: { kind: "answer", message: "Ready" } },
            parts: [
              { type: "text", text: "ignored when structured output exists" },
              { type: "tool", tool: "websearch", state: { status: "completed" } },
              { type: "tool", tool: "gtm_save_evidence", state: { status: "error" } },
            ],
          },
        })),
        delete: vi.fn(async () => ({ data: true })),
      },
    };
    const transport = createOpenCodeSessionTransport({ client, directory: "/app/apps/api" });

    expect(await transport.createSession({ title: "GTM analyst" })).toEqual({ id: "session-1" });
    await expect(transport.prompt({
      sessionId: "session-1",
      model: { providerID: "opencode-go", modelID: "qwen3.7-plus" },
      variant: "high",
      system: "Return grounded output.",
      text: "{\"domain\":\"acme.ai\"}",
      tools: { bash: false, websearch: true },
      format: { type: "json_schema", schema: { type: "object" }, retryCount: 2 },
      maxOutputTokens: 4_096,
    })).resolves.toEqual({
      messageId: "message-1",
      structuredOutput: { kind: "answer", message: "Ready" },
      text: "ignored when structured output exists",
      toolNames: ["websearch"],
    });
    expect(client.session.prompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: "session-1",
      directory: "/app/apps/api",
      agent: "gtm-runtime",
      model: { providerID: "opencode-go", modelID: "qwen3.7-plus" },
      variant: "high",
      system: "Return grounded output.",
      parts: [{ type: "text", text: "{\"domain\":\"acme.ai\"}" }],
      tools: { bash: false, websearch: true },
      format: { type: "json_schema", schema: { type: "object" }, retryCount: 2 },
    }));
    await transport.deleteSession("session-1");
    expect(client.session.delete).toHaveBeenCalledWith({ sessionID: "session-1", directory: "/app/apps/api" });
  });

  it("surfaces SDK and provider errors instead of returning partial output", async () => {
    const missingData = createOpenCodeSessionTransport({
      client: {
        session: {
          create: async () => ({ error: { message: "create failed" } }),
          prompt: async () => ({ error: { message: "prompt failed" } }),
          delete: async () => ({ data: false }),
        },
      },
      directory: "/app/apps/api",
    });
    await expect(missingData.createSession({ title: "GTM analyst" })).rejects.toThrow("create failed");

    const providerError = createOpenCodeSessionTransport({
      client: {
        session: {
          create: async () => ({ data: { id: "session-1" } }),
          prompt: async () => ({
            data: {
              info: { id: "message-1", error: { name: "ProviderAuthError", data: { message: "invalid key" } } },
              parts: [],
            },
          }),
          delete: async () => ({ data: true }),
        },
      },
      directory: "/app/apps/api",
    });
    await expect(providerError.prompt({
      sessionId: "session-1",
      model: { providerID: "opencode-go", modelID: "qwen3.7-plus" },
      system: "Return output.",
      text: "{}",
      tools: {},
      format: { type: "json_schema", schema: { type: "object" }, retryCount: 2 },
      maxOutputTokens: 4_096,
    })).rejects.toThrow("invalid key");
  });
});

describe("OpenCode agent service", () => {
  it("starts a private OpenCode server with the authenticated bridge and restores process state", async () => {
    const originalUrl = process.env.GTM_TOOL_BRIDGE_URL;
    const originalSecret = process.env.GTM_TOOL_BRIDGE_SECRET;
    const close = vi.fn(async () => undefined);
    const health = vi.fn(async () => ({ data: { healthy: true, version: "1.18.11" } }));
    const createOpencode = vi.fn(async () => ({
      client: {
        global: { health },
        session: {
          create: vi.fn(async () => ({ data: { id: "session-1" } })),
          prompt: vi.fn(),
          delete: vi.fn(async () => ({ data: true })),
        },
      },
      server: { url: "http://127.0.0.1:4096", close },
    }));

    const service = await startOpenCodeAgentService({
      directory: "/app/apps/api",
      bridgeSecret: "bridge-secret",
      createOpencode,
    });

    expect(createOpencode).toHaveBeenCalledWith(expect.objectContaining({
      hostname: "127.0.0.1",
      port: 0,
      config: expect.objectContaining({
        autoupdate: false,
        share: "disabled",
        snapshot: false,
        permission: { "*": "deny", StructuredOutput: "allow", websearch: "allow", "gtm_*": "allow" },
        provider: {
          "opencode-go": { options: { apiKey: "{env:OPENCODE_KEY}" } },
        },
      }),
    }));
    expect(process.env.GTM_TOOL_BRIDGE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/invoke$/);
    expect(process.env.GTM_TOOL_BRIDGE_SECRET).toBe("bridge-secret");
    await expect(service.isReady()).resolves.toBe(true);

    await service.close();
    expect(close).toHaveBeenCalledOnce();
    expect(process.env.GTM_TOOL_BRIDGE_URL).toBe(originalUrl);
    expect(process.env.GTM_TOOL_BRIDGE_SECRET).toBe(originalSecret);
  });
});
