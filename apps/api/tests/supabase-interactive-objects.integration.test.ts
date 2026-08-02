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
        const prompt = await service.publish({
          ...shared,
          objectKey: "decision-scope",
          object: {
            type: "interaction_prompt",
            purpose: "clarification",
            title: "Choose a target scope",
            prompt: "Which workflow should I evaluate first?",
            selection: "single",
            options: [
              { id: "sales", label: "Sales workflow" },
              { id: "support", label: "Support workflow" },
            ],
            allowFreeText: true,
          },
        }) as { id: string; version: number };
        await expect(service.applyAction({
          objectId: prompt.id,
          ownerId: owner.id,
          action: "respond",
          expectedVersion: prompt.version,
          payload: { optionId: "sales", label: "Sales workflow" },
        })).resolves.toMatchObject({
          objectId: prompt.id,
          version: 2,
          action: "respond",
        });
        await expect(service.listForConversation(owner.id, conversation.id)).resolves.toMatchObject([{
          id: first.id,
          version: 2,
          type: "workflow_progress",
          live: false,
        }, {
          id: prompt.id,
          version: 2,
          type: "interaction_prompt",
        }]);
        const feedback = await admin.from("feedback_events")
          .select("event_type,payload")
          .eq("owner_id", owner.id)
          .eq("interactive_object_id", prompt.id)
          .single();
        expect(feedback.error).toBeNull();
        expect(feedback.data).toMatchObject({
          event_type: "respond",
          payload: { optionId: "sales", label: "Sales workflow" },
        });

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
