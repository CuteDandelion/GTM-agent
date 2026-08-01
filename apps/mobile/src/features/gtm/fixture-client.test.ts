import { canonicalAcmeFixtures } from "@gtm/contracts";

import { fetchCanonicalAcmeFixture } from "./fixture-client";

describe("fixture API client", () => {
  it("fetches and validates the canonical bundle", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => canonicalAcmeFixtures
    })) as unknown as typeof fetch;

    const result = await fetchCanonicalAcmeFixture("http://127.0.0.1:3000/", fetcher);

    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:3000/api/v1/fixtures/acme");
    expect(result.assessment.icpScore).toBe(82);
  });

  it("rejects a successful HTTP response with an invalid contract", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ...canonicalAcmeFixtures, assessment: { ...canonicalAcmeFixtures.assessment, icpScore: 120 } })
    })) as unknown as typeof fetch;

    await expect(fetchCanonicalAcmeFixture("http://api.test", fetcher)).rejects.toThrow();
  });
});
