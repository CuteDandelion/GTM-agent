import { loadConversationMessages, loadOrCreateConversation } from "./conversation-workspace-client";

const existingConversation = {
  id: "22222222-2222-4222-8222-222222222222",
  ownerId: "11111111-1111-4111-8111-111111111111",
  sellerProfileId: null,
  icpDefinitionId: null,
  title: "GTM research",
  status: "active",
  createdAt: "2026-08-02T09:00:00.000Z",
  updatedAt: "2026-08-02T09:00:00.000Z",
};

describe("conversation workspace bootstrap", () => {
  it("restores the newest active conversation without creating a duplicate", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify([existingConversation]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(loadOrCreateConversation({
      apiBaseUrl: "https://api.example.com/",
      accessToken: "access-token",
      fetcher: fetcher as typeof fetch,
    })).resolves.toEqual(existingConversation);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("https://api.example.com/api/v1/conversations", {
      headers: { authorization: "Bearer access-token" },
    });
  });

  it("creates the first conversation when the workspace is empty", async () => {
    const fetcher = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify(existingConversation), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(loadOrCreateConversation({
      apiBaseUrl: "https://api.example.com",
      accessToken: "access-token",
      fetcher: fetcher as typeof fetch,
    })).resolves.toEqual(existingConversation);
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://api.example.com/api/v1/conversations", {
      method: "POST",
      headers: {
        authorization: "Bearer access-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "GTM research" }),
    });
  });

  it("loads the ordered multi-turn conversation history", async () => {
    const messages = [{
      id: "message-1",
      ownerId: "owner-1",
      conversationId: existingConversation.id,
      role: "user",
      content: { text: "Analyze foodbegood.app", domains: ["foodbegood.app"] },
      sequence: 1,
      createdAt: "2026-08-02T09:00:00.000Z",
    }];
    const fetcher = jest.fn(async () => new Response(JSON.stringify(messages), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(loadConversationMessages({
      apiBaseUrl: "https://api.example.com",
      accessToken: "access-token",
      conversationId: existingConversation.id,
      fetcher: fetcher as typeof fetch,
    })).resolves.toEqual(messages);
  });
});
