import { createClient } from "@supabase/supabase-js";

import { createRunProjectionObserver } from "../src/run-interactive-object-projection.js";
import { createSupabaseInteractiveObjectService } from "../src/supabase-interactive-objects.js";
import { createSupabaseResearchPersistence } from "../src/supabase-research-persistence.js";

const runId = process.argv[2];
const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!runId) throw new Error("Usage: replay-run-projection <workflow-run-id>");
if (!url || !secretKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");

const client = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const persistence = createSupabaseResearchPersistence(client);
const snapshot = await persistence.runStore.load(runId);
if (!snapshot) throw new Error(`Workflow run ${runId} was not found`);
if (snapshot.status !== "completed" || !snapshot.checkpoint) {
  throw new Error(`Workflow run ${runId} is ${snapshot.status}; only completed checkpoints can be replayed`);
}
const ownerId = snapshot.input.ownerId;
if (!ownerId) throw new Error(`Workflow run ${runId} has no owner`);

const objects = createSupabaseInteractiveObjectService(client);
await createRunProjectionObserver(objects)(snapshot);
const projected = await objects.listForConversation(ownerId, snapshot.conversationId);
console.log(JSON.stringify({
  runId,
  status: snapshot.status,
  projectedObjectTypes: projected.flatMap((object) => {
    if (typeof object !== "object" || object === null || !("type" in object)) return [];
    return typeof object.type === "string" ? [object.type] : [];
  }),
}));
