import { parseCanonicalFixtureBundle, type CanonicalAcmeFixtureBundle } from "@gtm/contracts";

export async function fetchCanonicalAcmeFixture(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch
): Promise<CanonicalAcmeFixtureBundle> {
  const origin = apiBaseUrl.replace(/\/+$/, "");
  const response = await fetcher(`${origin}/api/v1/fixtures/acme`);

  if (!response.ok) {
    throw new Error(`Fixture request failed with status ${response.status}`);
  }

  return parseCanonicalFixtureBundle(await response.json());
}
