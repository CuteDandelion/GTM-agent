export interface SellerProfileInput {
  businessName: string;
  offerSummary: string;
  capabilities: string[];
  proofPoints: string[];
  constraints: { externalWritesRequireApproval: boolean };
}

export interface SellerProfile extends SellerProfileInput {
  id: string;
  ownerId: string;
  updatedAt: string;
}

interface SellerProfileClientInput {
  apiBaseUrl: string;
  accessToken: string;
  fetcher?: typeof fetch;
}

function endpoint(apiBaseUrl: string) {
  return `${apiBaseUrl.replace(/\/+$/, "")}/api/v1/seller-profile`;
}

function parseSellerProfile(value: unknown): SellerProfile {
  if (typeof value !== "object" || value === null) throw new Error("Seller profile response was invalid");
  const candidate = value as Partial<SellerProfile>;
  if (typeof candidate.id !== "string"
    || typeof candidate.ownerId !== "string"
    || typeof candidate.businessName !== "string"
    || typeof candidate.offerSummary !== "string"
    || !Array.isArray(candidate.capabilities)
    || !candidate.capabilities.every((item) => typeof item === "string")
    || !Array.isArray(candidate.proofPoints)
    || !candidate.proofPoints.every((item) => typeof item === "string")
    || typeof candidate.constraints !== "object"
    || candidate.constraints === null
    || typeof candidate.constraints.externalWritesRequireApproval !== "boolean"
    || typeof candidate.updatedAt !== "string") {
    throw new Error("Seller profile response was invalid");
  }
  return candidate as SellerProfile;
}

export async function loadSellerProfile(input: SellerProfileClientInput): Promise<SellerProfile | undefined> {
  const response = await (input.fetcher ?? fetch)(endpoint(input.apiBaseUrl), {
    headers: { authorization: `Bearer ${input.accessToken}` },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Seller profile request failed with status ${response.status}`);
  return parseSellerProfile(await response.json());
}

export async function saveSellerProfile(input: SellerProfileClientInput & { profile: SellerProfileInput }): Promise<SellerProfile> {
  const response = await (input.fetcher ?? fetch)(endpoint(input.apiBaseUrl), {
    method: "PUT",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input.profile),
  });
  if (!response.ok) throw new Error(`Seller profile request failed with status ${response.status}`);
  return parseSellerProfile(await response.json());
}
