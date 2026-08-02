export interface Conversation {
  id: string;
  ownerId: string;
  sellerProfileId: string | null;
  icpDefinitionId: string | null;
  title: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  ownerId: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: Record<string, unknown>;
  sequence: number;
  createdAt: string;
}

interface ConversationWorkspaceInput {
  apiBaseUrl: string;
  accessToken: string;
  fetcher?: typeof fetch;
}

interface ConversationMessagesInput extends ConversationWorkspaceInput {
  conversationId: string;
}

function endpoint(apiBaseUrl: string) {
  return `${apiBaseUrl.replace(/\/+$/, "")}/api/v1/conversations`;
}

function parseConversation(value: unknown): Conversation {
  if (typeof value !== "object" || value === null) throw new Error("Conversation response was invalid");
  const candidate = value as Partial<Conversation>;
  if (typeof candidate.id !== "string"
    || typeof candidate.ownerId !== "string"
    || !(typeof candidate.sellerProfileId === "string" || candidate.sellerProfileId === null)
    || !(typeof candidate.icpDefinitionId === "string" || candidate.icpDefinitionId === null)
    || typeof candidate.title !== "string"
    || !["active", "archived"].includes(String(candidate.status))
    || typeof candidate.createdAt !== "string"
    || typeof candidate.updatedAt !== "string") {
    throw new Error("Conversation response was invalid");
  }
  return candidate as Conversation;
}

function parseMessage(value: unknown): ConversationMessage {
  if (typeof value !== "object" || value === null) throw new Error("Conversation message response was invalid");
  const candidate = value as Partial<ConversationMessage>;
  if (typeof candidate.id !== "string"
    || typeof candidate.ownerId !== "string"
    || typeof candidate.conversationId !== "string"
    || !["user", "assistant", "system", "tool"].includes(String(candidate.role))
    || typeof candidate.content !== "object" || candidate.content === null || Array.isArray(candidate.content)
    || typeof candidate.sequence !== "number"
    || typeof candidate.createdAt !== "string") {
    throw new Error("Conversation message response was invalid");
  }
  return candidate as ConversationMessage;
}

export async function loadOrCreateConversation(input: ConversationWorkspaceInput): Promise<Conversation> {
  const url = endpoint(input.apiBaseUrl);
  const fetcher = input.fetcher ?? fetch;
  const listed = await fetcher(url, {
    headers: { authorization: `Bearer ${input.accessToken}` },
  });
  if (!listed.ok) throw new Error(`Conversation list failed with status ${listed.status}`);
  const list: unknown = await listed.json();
  if (!Array.isArray(list)) throw new Error("Conversation list response was invalid");
  if (list.length > 0) return parseConversation(list[0]);

  const created = await fetcher(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ title: "GTM research" }),
  });
  if (!created.ok) throw new Error(`Conversation creation failed with status ${created.status}`);
  return parseConversation(await created.json());
}

export async function loadConversationMessages(input: ConversationMessagesInput): Promise<ConversationMessage[]> {
  const response = await (input.fetcher ?? fetch)(
    `${endpoint(input.apiBaseUrl)}/${encodeURIComponent(input.conversationId)}/messages`,
    { headers: { authorization: `Bearer ${input.accessToken}` } },
  );
  if (!response.ok) throw new Error(`Conversation messages failed with status ${response.status}`);
  const result: unknown = await response.json();
  if (!Array.isArray(result)) throw new Error("Conversation messages response was invalid");
  return result.map(parseMessage).sort((left, right) => left.sequence - right.sequence);
}
