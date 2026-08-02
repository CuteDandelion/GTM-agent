import { parseInteractiveObject } from "@gtm/contracts";

import type { InteractiveObjectEvent } from "./interactive-object-reducer";

interface RealtimeChannel {
  on(
    event: "postgres_changes",
    filter: {
      event: "*";
      schema: "public";
      table: "interactive_objects";
      filter: string;
    },
    callback: (payload: { eventType: string; new: unknown; old: unknown }) => void,
  ): RealtimeChannel;
  subscribe(): RealtimeChannel;
}

interface RealtimeClient {
  channel(name: string): RealtimeChannel;
  removeChannel(channel: RealtimeChannel): Promise<unknown>;
}

type InteractiveObjectRow = {
  id: string;
  conversation_id: string;
  object_type: string;
  revision: number;
  payload: unknown;
};

function parseRow(value: unknown) {
  if (typeof value !== "object" || value === null) throw new Error("Realtime interactive-object row was invalid");
  const row = value as Partial<InteractiveObjectRow>;
  if (typeof row.id !== "string"
    || typeof row.conversation_id !== "string"
    || typeof row.object_type !== "string"
    || typeof row.revision !== "number") {
    throw new Error("Realtime interactive-object row was invalid");
  }
  return parseInteractiveObject({
    ...(typeof row.payload === "object" && row.payload !== null ? row.payload : {}),
    id: row.id,
    conversationId: row.conversation_id,
    version: row.revision,
    type: row.object_type,
  });
}

export function createSupabaseInteractiveObjectRealtimeService(client: RealtimeClient) {
  return {
    subscribe(conversationId: string, listener: (event: InteractiveObjectEvent) => void) {
      const channel = client
        .channel(`interactive-objects:${conversationId}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "interactive_objects",
          filter: `conversation_id=eq.${conversationId}`,
        }, (payload) => {
          if (payload.eventType === "DELETE") {
            const previous = payload.old as { id?: unknown };
            if (typeof previous?.id === "string") listener({ kind: "delete", objectId: previous.id });
            return;
          }
          try {
            listener({ kind: "upsert", object: parseRow(payload.new) });
          } catch {
            // Invalid database payloads never reach trusted rendering state.
          }
        })
        .subscribe();
      return () => { void client.removeChannel(channel); };
    },
  };
}

export type InteractiveObjectRealtimeService = ReturnType<typeof createSupabaseInteractiveObjectRealtimeService>;
