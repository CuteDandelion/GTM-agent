import { startDomainResearch } from "./conversation-client";

describe("conversation client", () => {
  it("submits a domain-analysis message and returns the queued interactive object", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({
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
});
