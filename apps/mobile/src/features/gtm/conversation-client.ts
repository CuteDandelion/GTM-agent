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
  kind: "research";
  message: string;
  usedTools: string[];
  interactiveObjects: unknown[];
  runId: string;
  status: "queued" | "running";
  queuePosition?: number;
  interactiveObject: unknown;
}

export type ConversationTurnResult = QueuedResearchRun | {
  kind: "answer" | "clarify";
  message: string;
  usedTools: string[];
  interactiveObjects: unknown[];
};

export async function sendConversationTurn(input: StartDomainResearchInput): Promise<ConversationTurnResult> {
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
  if (typeof result !== "object" || result === null) {
    throw new Error("Conversation response did not match the turn contract");
  }
  const candidate = result as Record<string, unknown>;
  if ((candidate.kind === "answer" || candidate.kind === "clarify")
    && typeof candidate.message === "string"
    && Array.isArray(candidate.usedTools)
    && Array.isArray(candidate.interactiveObjects)) {
    return candidate as ConversationTurnResult;
  }
  if ((candidate.kind === "research" || candidate.kind === undefined)
    && typeof candidate.runId === "string"
    && ["queued", "running"].includes(String(candidate.status))) {
    return {
      ...candidate,
      kind: "research",
      message: typeof candidate.message === "string" ? candidate.message : "",
      usedTools: Array.isArray(candidate.usedTools) ? candidate.usedTools : [],
      interactiveObjects: Array.isArray(candidate.interactiveObjects) ? candidate.interactiveObjects : [],
    } as QueuedResearchRun;
  }
  throw new Error("Conversation response did not match the turn contract");
}

export const startDomainResearch = sendConversationTurn;
