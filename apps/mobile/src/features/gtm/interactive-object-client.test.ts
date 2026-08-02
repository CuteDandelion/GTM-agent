import { applyInteractiveObjectAction, loadInteractiveObjects, StaleInteractiveObjectError } from "./interactive-object-client";

describe("interactive-object API client", () => {
  it("loads and validates owner-visible conversation objects", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify([{
      id: "33333333-3333-4333-8333-333333333333",
      conversationId: "22222222-2222-4222-8222-222222222222",
      version: 2,
      type: "opportunity",
      company: "Acme",
      title: "Support Triage Agent",
      summary: "Automate support triage",
      impact: "high",
      value: "high",
      effort: "medium",
      fit: "high",
      status: "research",
    }]), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(loadInteractiveObjects({
      apiBaseUrl: "https://api.example.com/",
      accessToken: "access-token",
      conversationId: "22222222-2222-4222-8222-222222222222",
      fetcher: fetcher as typeof fetch,
    })).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/conversations/22222222-2222-4222-8222-222222222222/interactive-objects",
      { headers: { authorization: "Bearer access-token" } },
    );
  });

  it("applies a version-checked action and identifies stale retries", async () => {
    const appliedFetcher = jest.fn(async () => new Response(JSON.stringify({
      objectId: "33333333-3333-4333-8333-333333333333",
      version: 3,
      action: "shortlist",
      payload: {},
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(applyInteractiveObjectAction({
      apiBaseUrl: "https://api.example.com",
      accessToken: "access-token",
      objectId: "33333333-3333-4333-8333-333333333333",
      action: "shortlist",
      expectedVersion: 2,
      payload: {},
      fetcher: appliedFetcher as typeof fetch,
    })).resolves.toMatchObject({ version: 3, action: "shortlist" });

    const staleFetcher = jest.fn(async () => new Response(JSON.stringify({
      error: "stale_object_version",
      expectedVersion: 2,
      currentVersion: 4,
    }), { status: 409, headers: { "content-type": "application/json" } }));
    await expect(applyInteractiveObjectAction({
      apiBaseUrl: "https://api.example.com",
      accessToken: "access-token",
      objectId: "33333333-3333-4333-8333-333333333333",
      action: "shortlist",
      expectedVersion: 2,
      payload: {},
      fetcher: staleFetcher as typeof fetch,
    })).rejects.toEqual(new StaleInteractiveObjectError(2, 4));
  });
});
