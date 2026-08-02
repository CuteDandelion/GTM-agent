import { sendConversationTurn, startDomainResearch } from "./conversation-client";

describe("conversation client", () => {
  it("submits a domain-analysis message and returns the queued interactive object", async () => {
    const fetcher = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      runId: "run-1",
      status: "queued",
      interactiveObject: { id: "progress-run-1", type: "workflow_progress", version: 1, title: "Researching acme.ai", status: "running", steps: [] },
    }), { status: 202, headers: { "content-type": "application/json" } }));

    await expect(startDomainResearch({
      apiBaseUrl: "https://api.example.com/",
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Analyze acme.ai",
      domains: ["acme.ai"],
      fetcher: fetcher as typeof fetch,
    })).resolves.toMatchObject({ runId: "run-1", status: "queued" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects non-successful API responses", async () => {
    const fetcher = jest.fn(async () => new Response("{}", { status: 400 }));
    await expect(startDomainResearch({
      apiBaseUrl: "https://api.example.com",
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Analyze",
      domains: ["bad"],
      fetcher: fetcher as typeof fetch,
    })).rejects.toThrow(/400/);
  });

  it("accepts a direct conversational answer with no research run", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({
      kind: "answer",
      message: "Tell me about your offer or name a company when you are ready.",
      usedTools: [],
      interactiveObjects: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(sendConversationTurn({
      apiBaseUrl: "https://api.example.com",
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "How should we begin?",
      domains: [],
      fetcher: fetcher as typeof fetch,
    })).resolves.toEqual({
      kind: "answer",
      message: "Tell me about your offer or name a company when you are ready.",
      usedTools: [],
      interactiveObjects: [],
    });
  });

  it("sends the Supabase access token only in the bearer authorization header", async () => {
    const fetcher = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      runId: "run-auth-1",
      status: "queued",
      interactiveObject: {},
    }), { status: 202, headers: { "content-type": "application/json" } }));
    const input = {
      apiBaseUrl: "https://api.example.com",
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Analyze acme.ai",
      domains: ["acme.ai"],
      accessToken: "supabase-access-token",
      fetcher: fetcher as typeof fetch,
    } as Parameters<typeof startDomainResearch>[0];

    await startDomainResearch(input);

    const request = fetcher.mock.calls[0]![1]!;
    expect(request.headers).toEqual({
      authorization: "Bearer supabase-access-token",
      "content-type": "application/json",
    });
    expect(String(request.body)).not.toContain("supabase-access-token");
  });
});
