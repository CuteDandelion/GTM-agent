export type InteractiveObjectAction = "challenge" | "shortlist" | "correct" | "set_status" | "respond";

export interface InteractiveObjectRecord {
  id: string;
  ownerId: string;
  conversationId: string;
  version: number;
  data: Record<string, unknown>;
  objectKey?: string;
}

export interface PublishInteractiveObjectInput {
  ownerId: string;
  conversationId: string;
  objectKey: string;
  object: Record<string, unknown>;
}

export interface ApplyInteractiveObjectActionInput {
  objectId: string;
  ownerId?: string;
  action: InteractiveObjectAction;
  expectedVersion: number;
  payload: Record<string, unknown>;
}

export interface InteractiveObjectService {
  listForConversation(ownerId: string, conversationId: string): Promise<unknown[]>;
  publish(input: PublishInteractiveObjectInput): Promise<unknown>;
  applyAction(input: ApplyInteractiveObjectActionInput): Promise<{
    objectId: string;
    version: number;
    action: InteractiveObjectAction;
    payload: Record<string, unknown>;
  } | undefined>;
}

export class StaleObjectVersionError extends Error {
  constructor(readonly expectedVersion: number, readonly currentVersion: number) {
    super(`Interactive object version is stale: expected ${expectedVersion}, current ${currentVersion}`);
    this.name = "StaleObjectVersionError";
  }
}

export class InMemoryInteractiveObjectService implements InteractiveObjectService {
  readonly #objects: Map<string, InteractiveObjectRecord>;

  constructor(initial: InteractiveObjectRecord[] = []) {
    this.#objects = new Map(initial.map((object) => [object.id, structuredClone(object)]));
  }

  async listForConversation(ownerId: string, conversationId: string) {
    return [...this.#objects.values()]
      .filter((object) => object.ownerId === ownerId && object.conversationId === conversationId)
      .map((object) => ({
        ...structuredClone(object.data),
        id: object.id,
        conversationId: object.conversationId,
        version: object.version,
      }));
  }

  async publish(input: PublishInteractiveObjectInput) {
    const existing = [...this.#objects.values()].find((object) => (
      object.ownerId === input.ownerId
      && object.conversationId === input.conversationId
      && object.objectKey === input.objectKey
    ));
    if (existing) {
      existing.version += 1;
      existing.data = structuredClone(input.object);
      return {
        ...structuredClone(existing.data),
        id: existing.id,
        conversationId: existing.conversationId,
        version: existing.version,
      };
    }
    const created: InteractiveObjectRecord = {
      id: randomUUID(),
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      objectKey: input.objectKey,
      version: 1,
      data: structuredClone(input.object),
    };
    this.#objects.set(created.id, created);
    return {
      ...structuredClone(created.data),
      id: created.id,
      conversationId: created.conversationId,
      version: created.version,
    };
  }

  async applyAction(input: ApplyInteractiveObjectActionInput) {
    const object = this.#objects.get(input.objectId);
    if (!object || (input.ownerId && object.ownerId !== input.ownerId)) return undefined;
    if (object.version !== input.expectedVersion) {
      throw new StaleObjectVersionError(input.expectedVersion, object.version);
    }
    object.version += 1;
    object.data = {
      ...object.data,
      lastAction: input.action,
      lastActionPayload: structuredClone(input.payload),
    };
    return {
      objectId: object.id,
      version: object.version,
      action: input.action,
      payload: structuredClone(input.payload),
    };
  }
}
import { randomUUID } from "node:crypto";
