import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";

const servers: Array<ReturnType<typeof buildServer>> = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())));

const ownerId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";

function createServer() {
  const server = buildServer({
    logger: false,
    authService: { authenticate: async () => ({ userId: ownerId }) },
    workspaceService: {
      async getSellerProfile() { return undefined; },
      async upsertSellerProfile() { throw new Error("not used"); },
      async createConversation() { throw new Error("not used"); },
      async listConversations() { return []; },
      async getConversation(requestOwnerId, requestConversationId) {
        return requestOwnerId === ownerId && requestConversationId === conversationId
          ? { id: conversationId, ownerId, title: "Nova research" }
          : undefined;
      },
      async appendMessage() { return undefined; },
      async listMessages(requestOwnerId, requestConversationId) {
        return requestOwnerId === ownerId && requestConversationId === conversationId
          ? [{ role: "user", content: { text: "Analyze nova.example" } }]
          : undefined;
      },
    },
    objectActionService: {
      async publish() { throw new Error("not used"); },
      async listForConversation() {
        return [{
          id: "profile-1",
          conversationId,
          version: 1,
          type: "company_profile",
          company: "Nova",
          domain: "nova.example",
          summary: "Finance automation",
          facts: [{ label: "Model", value: "B2B SaaS" }],
          pros: ["Clear pain"],
          cons: ["Budget unknown"],
        }];
      },
      async applyAction() { return undefined; },
    },
  });
  servers.push(server);
  return server;
}

describe("conversation export API", () => {
  it("exports the authenticated conversation as Markdown or structured JSON", async () => {
    const server = createServer();
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });
    const headers = { authorization: "Bearer valid" };

    const markdown = await fetch(`${origin}/api/v1/conversations/${conversationId}/export?format=markdown`, { headers });
    const json = await fetch(`${origin}/api/v1/conversations/${conversationId}/export?format=json`, { headers });

    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-type")).toContain("text/markdown");
    expect(markdown.headers.get("content-disposition")).toContain(`${conversationId}.md`);
    expect(await markdown.text()).toContain("## Nova (nova.example)");
    expect(json.status).toBe(200);
    expect(await json.json()).toMatchObject({
      schemaVersion: 1,
      conversationId,
      messages: [{ role: "user", content: { text: "Analyze nova.example" } }],
      interactiveObjects: [{ type: "company_profile", company: "Nova" }],
    });
  });

  it("does not export a conversation outside the authenticated owner scope", async () => {
    const server = createServer();
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });
    const otherConversationId = "33333333-3333-4333-8333-333333333333";

    const response = await fetch(`${origin}/api/v1/conversations/${otherConversationId}/export?format=json`, {
      headers: { authorization: "Bearer valid" },
    });

    expect(response.status).toBe(404);
  });
});
