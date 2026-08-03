import { parseInteractiveObject, type InteractiveObject } from "@gtm/contracts";

type InteractiveObjectAction = "challenge" | "shortlist" | "correct" | "set_status" | "respond";

interface InteractiveObjectClientInput {
  apiBaseUrl: string;
  accessToken: string;
  fetcher?: typeof fetch;
}

export class StaleInteractiveObjectError extends Error {
  constructor(readonly expectedVersion: number, readonly currentVersion: number) {
    super(`Interactive object changed from version ${expectedVersion} to ${currentVersion}`);
    this.name = "StaleInteractiveObjectError";
  }
}

function origin(apiBaseUrl: string) {
  return apiBaseUrl.replace(/\/+$/, "");
}

export async function loadInteractiveObjects(input: InteractiveObjectClientInput & {
  conversationId: string;
}): Promise<InteractiveObject[]> {
  const response = await (input.fetcher ?? fetch)(
    `${origin(input.apiBaseUrl)}/api/v1/conversations/${encodeURIComponent(input.conversationId)}/interactive-objects`,
    { headers: { authorization: `Bearer ${input.accessToken}` } },
  );
  if (!response.ok) throw new Error(`Interactive-object request failed with status ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Interactive-object response was invalid");
  return payload.map(parseInteractiveObject);
}

export async function applyInteractiveObjectAction(input: InteractiveObjectClientInput & {
  objectId: string;
  action: InteractiveObjectAction;
  expectedVersion: number;
  payload: Record<string, unknown>;
}) {
  const response = await (input.fetcher ?? fetch)(
    `${origin(input.apiBaseUrl)}/api/v1/interactive-objects/${encodeURIComponent(input.objectId)}/actions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: input.action,
        expectedVersion: input.expectedVersion,
        payload: input.payload,
      }),
    },
  );
  const payload: unknown = await response.json();
  if (response.status === 409 && typeof payload === "object" && payload !== null) {
    const stale = payload as { expectedVersion?: unknown; currentVersion?: unknown };
    if (typeof stale.expectedVersion === "number" && typeof stale.currentVersion === "number") {
      throw new StaleInteractiveObjectError(stale.expectedVersion, stale.currentVersion);
    }
  }
  if (!response.ok) throw new Error(`Interactive-object action failed with status ${response.status}`);
  if (typeof payload !== "object" || payload === null
    || typeof (payload as { objectId?: unknown }).objectId !== "string"
    || typeof (payload as { version?: unknown }).version !== "number"
    || (payload as { action?: unknown }).action !== input.action) {
    throw new Error("Interactive-object action response was invalid");
  }
  return payload as { objectId: string; version: number; action: InteractiveObjectAction; payload: Record<string, unknown> };
}
