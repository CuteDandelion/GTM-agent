import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { createSupabaseInteractiveObjectService } from "../src/supabase-interactive-objects.js";
import { createSupabaseWorkspaceService } from "../src/supabase-workspace.js";

describe("Supabase interactive-object projection integration", () => {
  it.runIf(process.env.GTM_SUPABASE_INTEGRATION === "1")(
    "atomically replaces one owner-scoped projection while denying client-side publication",
    async () => {
      const url = process.env.SUPABASE_URL!;
      const secretKey = process.env.SUPABASE_SECRET_KEY!;
      const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
      const admin = createClient(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const password = `Owner-${randomUUID()}`;
      const created = await admin.auth.admin.createUser({
        email: `gtm-projection-${randomUUID()}@example.test`,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      const owner = created.data.user!;

      try {
        const conversation = await createSupabaseWorkspaceService(admin).createConversation(owner.id, {
          title: "Projection integration",
        }) as { id: string };
        const service = createSupabaseInteractiveObjectService(admin);
        const shared = {
          ownerId: owner.id,
          conversationId: conversation.id,
          objectKey: "workflow-progress",
        };
        const first = await service.publish({
          ...shared,
          object: {
            type: "workflow_progress",
            title: "Researching foodbegood.app",
            live: true,
            steps: [{ id: "research", label: "Research", agent: "Luna", status: "running" }],
          },
        }) as { id: string; version: number };
        const second = await service.publish({
          ...shared,
          object: {
            type: "workflow_progress",
            title: "Researching foodbegood.app",
            live: false,
            steps: [{ id: "review", label: "Review", agent: "Sol", status: "completed" }],
          },
        }) as { id: string; version: number };

        expect(second).toMatchObject({ id: first.id, version: 2 });
        await expect(service.listForConversation(owner.id, conversation.id)).resolves.toMatchObject([{
          id: first.id,
          version: 2,
          type: "workflow_progress",
          live: false,
        }]);

        const ownerClient = createClient(url, publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        expect((await ownerClient.auth.signInWithPassword({ email: owner.email!, password })).error).toBeNull();
        const denied = await ownerClient.rpc("publish_interactive_object", {
          p_owner_id: owner.id,
          p_conversation_id: conversation.id,
          p_object_key: "forged",
          p_object_type: "workflow_progress",
          p_payload: { type: "workflow_progress", title: "Forged", live: true, steps: [] },
        });
        expect(denied.error).not.toBeNull();
      } finally {
        await admin.auth.admin.deleteUser(owner.id);
      }
    },
  );
});
