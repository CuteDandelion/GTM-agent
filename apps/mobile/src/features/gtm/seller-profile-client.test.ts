import { loadSellerProfile, saveSellerProfile } from "./seller-profile-client";

describe("seller profile client", () => {
  it("loads the authenticated operator's seller profile", async () => {
    const fetcher = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      id: "22222222-2222-4222-8222-222222222222",
      ownerId: "11111111-1111-4111-8111-111111111111",
      businessName: "Dandelion AI",
      offerSummary: "AI and agent automation for operational teams",
      capabilities: ["Agent orchestration"],
      proofPoints: ["Production agent deployments"],
      constraints: { externalWritesRequireApproval: true },
      updatedAt: "2026-08-02T09:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(loadSellerProfile({
      apiBaseUrl: "https://api.example.com/",
      accessToken: "supabase-access-token",
      fetcher: fetcher as typeof fetch,
    })).resolves.toMatchObject({ businessName: "Dandelion AI" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/seller-profile",
      { headers: { authorization: "Bearer supabase-access-token" } },
    );
  });

  it("returns no profile when onboarding has not been completed", async () => {
    const fetcher = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ error: "seller_profile_not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }));

    await expect(loadSellerProfile({
      apiBaseUrl: "https://api.example.com",
      accessToken: "supabase-access-token",
      fetcher: fetcher as typeof fetch,
    })).resolves.toBeUndefined();
  });

  it("saves the completed seller profile without putting the access token in the body", async () => {
    const payload = {
      businessName: "Dandelion AI",
      offerSummary: "AI and agent automation for operational teams",
      capabilities: ["Agent orchestration", "Workflow automation"],
      proofPoints: ["Production agent deployments"],
      constraints: { externalWritesRequireApproval: true },
    };
    const fetcher = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      id: "22222222-2222-4222-8222-222222222222",
      ownerId: "11111111-1111-4111-8111-111111111111",
      ...payload,
      updatedAt: "2026-08-02T09:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(saveSellerProfile({
      apiBaseUrl: "https://api.example.com/",
      accessToken: "supabase-access-token",
      profile: payload,
      fetcher: fetcher as typeof fetch,
    })).resolves.toMatchObject({ id: "22222222-2222-4222-8222-222222222222" });

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/api/v1/seller-profile");
    expect(init).toMatchObject({
      method: "PUT",
      headers: {
        authorization: "Bearer supabase-access-token",
        "content-type": "application/json",
      },
    });
    expect(JSON.parse(String(init!.body))).toEqual(payload);
    expect(String(init!.body)).not.toContain("supabase-access-token");
  });
});
