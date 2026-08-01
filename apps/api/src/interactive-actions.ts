export type InteractiveObjectAction = "challenge" | "shortlist" | "correct" | "set_status";

export interface InteractiveObjectRecord {
  id: string;
  ownerId: string;
  conversationId: string;
  version: number;
  data: Record<string, unknown>;
}

export interface ApplyInteractiveObjectActionInput {
  objectId: string;
  ownerId?: string;
  action: InteractiveObjectAction;
  expectedVersion: number;
  payload: Record<string, unknown>;
}

export interface InteractiveObjectService {
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
