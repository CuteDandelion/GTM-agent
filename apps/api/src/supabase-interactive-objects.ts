import { parseInteractiveObject } from "@gtm/contracts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  StaleObjectVersionError,
  type ApplyInteractiveObjectActionInput,
  type InteractiveObjectService,
} from "./interactive-actions.js";

type InteractiveObjectRow = {
  id: string;
  conversation_id: string;
  object_key: string;
  object_type: string;
  revision: number;
  payload: unknown;
};

type ActionResult = {
  status: "applied" | "stale" | "not_found";
  object_id?: string;
  revision?: number;
  current_version?: number;
};

const objectColumns = "id,conversation_id,object_key,object_type,revision,payload";

export function createSupabaseInteractiveObjectService(client: SupabaseClient): InteractiveObjectService {
  return {
    async publish(input) {
      const objectType = typeof input.object.type === "string" ? input.object.type : undefined;
      if (!objectType) throw new Error("Interactive-object projection requires a type");
      const result = await client.rpc("publish_interactive_object", {
        p_owner_id: input.ownerId,
        p_conversation_id: input.conversationId,
        p_object_key: input.objectKey,
        p_object_type: objectType,
        p_payload: input.object,
      });
      if (result.error) throw new Error(`Unable to publish interactive object: ${result.error.message}`);
      const row = result.data as InteractiveObjectRow | null;
      if (!row) throw new Error("Interactive-object publish returned no row");
      return parseInteractiveObject({
        ...(typeof row.payload === "object" && row.payload !== null ? row.payload : {}),
        id: row.id,
        conversationId: row.conversation_id,
        version: row.revision,
        type: row.object_type,
      });
    },

    async listForConversation(ownerId, conversationId) {
      const result = await client
        .from("interactive_objects")
        .select(objectColumns)
        .eq("owner_id", ownerId)
        .eq("conversation_id", conversationId)
        .order("updated_at", { ascending: true });
      if (result.error) throw new Error(`Unable to list interactive objects: ${result.error.message}`);
      return (result.data as InteractiveObjectRow[]).map((row) => parseInteractiveObject({
        ...(typeof row.payload === "object" && row.payload !== null ? row.payload : {}),
        id: row.id,
        conversationId: row.conversation_id,
        version: row.revision,
        type: row.object_type,
      }));
    },

    async applyAction(input: ApplyInteractiveObjectActionInput) {
      if (!input.ownerId) return undefined;
      const result = await client.rpc("apply_interactive_object_action", {
        p_object_id: input.objectId,
        p_owner_id: input.ownerId,
        p_action: input.action,
        p_expected_revision: input.expectedVersion,
        p_payload: input.payload,
      });
      if (result.error) throw new Error(`Unable to apply interactive-object action: ${result.error.message}`);
      const outcome = result.data as ActionResult | null;
      if (!outcome || outcome.status === "not_found") return undefined;
      if (outcome.status === "stale") {
        throw new StaleObjectVersionError(input.expectedVersion, outcome.current_version ?? input.expectedVersion);
      }
      if (!outcome.object_id || !outcome.revision) throw new Error("Interactive-object action returned an invalid result");
      return {
        objectId: outcome.object_id,
        version: outcome.revision,
        action: input.action,
        payload: structuredClone(input.payload),
      };
    },
  };
}

export function createEnvironmentInteractiveObjectService(
  environment: NodeJS.ProcessEnv = process.env,
): InteractiveObjectService | undefined {
  const url = environment.SUPABASE_URL;
  const secretKey = environment.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return undefined;
  return createSupabaseInteractiveObjectService(createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }));
}
