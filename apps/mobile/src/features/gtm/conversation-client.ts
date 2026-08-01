export interface StartDomainResearchInput {
  apiBaseUrl: string;
  conversationId: string;
  message: string;
  domains: string[];
  documentIds?: string[];
  accessToken?: string;
  fetcher?: typeof fetch;
}

export interface QueuedResearchRun {
  runId: string;
  status: "queued" | "running";
  interactiveObject: unknown;
}

export async function startDomainResearch(input: StartDomainResearchInput): Promise<QueuedResearchRun> {
  const origin = input.apiBaseUrl.replace(/\/+$/, "");
  const response = await (input.fetcher ?? fetch)(
    `${origin}/api/v1/conversations/${encodeURIComponent(input.conversationId)}/messages`,
    {
      method: "POST",
      headers: {
        ...(input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: input.message,
        domains: input.domains,
        documentIds: input.documentIds ?? [],
      }),
    },
  );
  if (!response.ok) throw new Error(`Conversation request failed with status ${response.status}`);
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null
    || typeof (result as { runId?: unknown }).runId !== "string"
    || !["queued", "running"].includes(String((result as { status?: unknown }).status))) {
    throw new Error("Conversation response did not match the queued-run contract");
  }
  return result as QueuedResearchRun;
}
