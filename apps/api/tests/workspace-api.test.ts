import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";

const servers: Array<ReturnType<typeof buildServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("seller workspace API", () => {
  it("persists and returns the authenticated owner's seller profile", async () => {
    let sellerProfile: unknown;
    const workspaceService = {
      async upsertSellerProfile(ownerId: string, input: unknown) {
        sellerProfile = {
          id: "22222222-2222-4222-8222-222222222222",
          ownerId,
          ...(input as object),
          updatedAt: "2026-08-01T20:00:00.000Z",
        };
        return sellerProfile;
      },
      async getSellerProfile(ownerId: string) {
        return (sellerProfile as { ownerId?: string } | undefined)?.ownerId === ownerId
          ? sellerProfile
          : undefined;
      },
      async createConversation() { throw new Error("not used"); },
      async getConversation() { return undefined; },
      async appendMessage() { return undefined; },
      async listMessages() { return undefined; },
    };
    const server = buildServer({
      logger: false,
      authService: {
        authenticate: async (authorization) => authorization === "Bearer owner-token"
          ? { userId: "11111111-1111-4111-8111-111111111111" }
          : undefined,
      },
      workspaceService,
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });
    const headers = { authorization: "Bearer owner-token", "content-type": "application/json" };

    const saved = await fetch(`${origin}/api/v1/seller-profile`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        businessName: "Dandelion AI",
        offerSummary: "AI and agent automation for operational teams",
        capabilities: ["AI automation", "agent orchestration"],
        proofPoints: ["Production agent deployments"],
        constraints: { externalWritesRequireApproval: true },
      }),
    });
    const loaded = await fetch(`${origin}/api/v1/seller-profile`, { headers });

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      ownerId: "11111111-1111-4111-8111-111111111111",
      businessName: "Dandelion AI",
    });
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toMatchObject({
      offerSummary: "AI and agent automation for operational teams",
      constraints: { externalWritesRequireApproval: true },
    });
  });

  it("creates a conversation and restores its persisted user messages", async () => {
    const conversationId = "33333333-3333-4333-8333-333333333333";
    const conversations = new Map<string, { id: string; ownerId: string; title: string }>();
    const messages = new Map<string, Array<Record<string, unknown>>>();
    const workspaceService = {
      async getSellerProfile() { return undefined; },
      async upsertSellerProfile() { throw new Error("not used"); },
      async createConversation(ownerId: string, input: { title: string }) {
        const conversation = { id: conversationId, ownerId, title: input.title };
        conversations.set(conversationId, conversation);
        messages.set(conversationId, []);
        return conversation;
      },
      async getConversation(ownerId: string, id: string) {
        const conversation = conversations.get(id);
        return conversation?.ownerId === ownerId ? conversation : undefined;
      },
      async appendMessage(ownerId: string, id: string, input: { role: string; content: unknown }) {
        const conversation = conversations.get(id);
        if (conversation?.ownerId !== ownerId) return undefined;
        const message = { id: "44444444-4444-4444-8444-444444444444", ownerId, conversationId: id, ...input, sequence: 1 };
        messages.get(id)?.push(message);
        return message;
      },
      async listMessages(ownerId: string, id: string) {
        const conversation = conversations.get(id);
        return conversation?.ownerId === ownerId ? messages.get(id) : undefined;
      },
    };
    const server = buildServer({
      logger: false,
      authService: { authenticate: async () => ({ userId: "11111111-1111-4111-8111-111111111111" }) },
      workspaceService,
      researchService: {
        startDomainResearch: async () => ({ runId: "run-1", status: "queued", interactiveObject: {} }),
        getRun: async () => undefined,
        cancelRun: async () => undefined,
        resumeRun: async () => undefined,
      },
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });
    const headers = { authorization: "Bearer owner-token", "content-type": "application/json" };

    const created = await fetch(`${origin}/api/v1/conversations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Acme opportunity research" }),
    });
    const submitted = await fetch(`${origin}/api/v1/conversations/${conversationId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "Analyze acme.ai", domains: ["acme.ai"] }),
    });
    const restored = await fetch(`${origin}/api/v1/conversations/${conversationId}/messages`, { headers });

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ id: conversationId, title: "Acme opportunity research" });
    expect(submitted.status).toBe(202);
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual([
      expect.objectContaining({ role: "user", content: { text: "Analyze acme.ai", domains: ["acme.ai"], documentIds: [] }, sequence: 1 }),
    ]);
  });
});
