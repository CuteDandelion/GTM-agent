import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

type TestUser = {
  id: string;
  email: string;
  password: string;
};

async function createAuthenticatedClient(admin: SupabaseClient): Promise<{
  user: TestUser;
  client: SupabaseClient;
}> {
  const password = `Owner-${randomUUID()}`;
  const email = `gtm-write-boundary-${randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(created.error).toBeNull();
  const user = { id: created.data.user!.id, email, password };
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
  return { user, client };
}

function expectPermissionDenied(error: { message: string } | null) {
  expect(error?.message).toMatch(/permission denied/i);
}

describe("Supabase authenticated-client write boundaries", () => {
  it.runIf(process.env.GTM_SUPABASE_INTEGRATION === "1")(
    "allows upload registration but rejects forged document lifecycle and provider metadata",
    async () => {
      const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { user, client } = await createAuthenticatedClient(admin);
      const conversationId = randomUUID();
      const validDocumentId = randomUUID();

      try {
        expect((await admin.from("conversations").insert({
          id: conversationId,
          owner_id: user.id,
          title: "Document boundary",
        })).error).toBeNull();

        const valid = await client.from("user_documents").insert({
          id: validDocumentId,
          owner_id: user.id,
          conversation_id: conversationId,
          bucket_id: "user-uploads",
          storage_path: `${user.id}/${validDocumentId}/brief.txt`,
          file_name: "brief.txt",
          mime_type: "text/plain",
          size_bytes: 12,
          status: "uploaded",
        }).select("id,status,openai_file_id,vector_store_id").single();
        expect(valid.error).toBeNull();
        expect(valid.data).toMatchObject({
          id: validDocumentId,
          status: "uploaded",
          openai_file_id: null,
          vector_store_id: null,
        });

        const forgedUpdate = await client.from("user_documents").update({
          status: "ready",
          content_hash: "attacker-controlled",
          extraction_metadata: { trust: "forged" },
          openai_file_id: "file_forged",
          vector_store_id: "vs_forged",
        }).eq("id", validDocumentId);
        expectPermissionDenied(forgedUpdate.error);

        const forgedInsert = await client.from("user_documents").insert({
          id: randomUUID(),
          owner_id: user.id,
          conversation_id: conversationId,
          bucket_id: "user-uploads",
          storage_path: `${user.id}/${randomUUID()}/forged.txt`,
          file_name: "forged.txt",
          mime_type: "text/plain",
          size_bytes: 12,
          status: "ready",
          extraction_metadata: { trust: "forged" },
          openai_file_id: "file_forged",
        });
        expect(forgedInsert.error).not.toBeNull();

        const forgedStatusOnly = await client.from("user_documents").insert({
          id: randomUUID(),
          owner_id: user.id,
          conversation_id: conversationId,
          bucket_id: "user-uploads",
          storage_path: `${user.id}/${randomUUID()}/status-only.txt`,
          file_name: "status-only.txt",
          mime_type: "text/plain",
          size_bytes: 12,
          status: "ready",
        });
        expect(forgedStatusOnly.error?.message).toMatch(/only register unprocessed document uploads/i);

        const readable = await client.from("user_documents")
          .select("id,status")
          .eq("id", validDocumentId)
          .single();
        expect(readable.error).toBeNull();
        expect(readable.data).toEqual({ id: validDocumentId, status: "uploaded" });
      } finally {
        await admin.auth.admin.deleteUser(user.id);
      }
    },
    20_000,
  );

  it.runIf(process.env.GTM_SUPABASE_INTEGRATION === "1")(
    "rejects authenticated Data API writes to every server-produced research table while preserving owner reads",
    async () => {
      const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { user, client } = await createAuthenticatedClient(admin);
      const conversationId = randomUUID();
      const templateId = randomUUID();
      const companyId = randomUUID();
      const icpId = randomUUID();
      const runId = randomUUID();
      const nodeId = randomUUID();
      const attemptId = randomUUID();
      const interactiveObjectId = randomUUID();
      const evidenceId = randomUUID();

      try {
        for (const [table, row] of [
          ["conversations", { id: conversationId, owner_id: user.id, title: "Trusted records boundary" }],
          ["workflow_templates", {
            id: templateId,
            owner_id: user.id,
            name: "server-workflow",
            dag: {},
            model_policy: {},
            tool_policy: {},
          }],
          ["companies", { id: companyId, owner_id: user.id, canonical_name: "Boundary Co" }],
          ["icp_definitions", { id: icpId, owner_id: user.id, name: "Boundary ICP", definition: {} }],
          ["workflow_runs", {
            id: runId,
            owner_id: user.id,
            conversation_id: conversationId,
            company_id: companyId,
            workflow_template_id: templateId,
            input: {},
          }],
          ["workflow_nodes", {
            id: nodeId,
            owner_id: user.id,
            workflow_run_id: runId,
            node_key: "research",
            agent_role: "researcher",
            model: "gpt-test",
            reasoning_effort: "low",
          }],
          ["node_attempts", {
            id: attemptId,
            owner_id: user.id,
            workflow_node_id: nodeId,
            attempt_number: 1,
            status: "completed",
          }],
          ["interactive_objects", {
            id: interactiveObjectId,
            owner_id: user.id,
            conversation_id: conversationId,
            object_key: "trusted-object",
            object_type: "workflow_progress",
            payload: { type: "workflow_progress" },
          }],
          ["evidence", {
            id: evidenceId,
            owner_id: user.id,
            workflow_run_id: runId,
            company_id: companyId,
            source_type: "web",
            title: "Trusted evidence",
            observed_at: "2026-08-02T00:00:00.000Z",
          }],
        ] as const) {
          expect((await admin.from(table).insert(row)).error, `admin fixture insert for ${table}`).toBeNull();
        }

        const attempts: Array<[string, Record<string, unknown>]> = [
          ["workflow_templates", {
            owner_id: user.id, name: "forged-workflow", dag: { forged: true },
            model_policy: { forged: true }, tool_policy: { forged: true },
          }],
          ["workflow_runs", {
            id: randomUUID(), owner_id: user.id, conversation_id: conversationId,
            company_id: companyId, workflow_template_id: templateId, input: { forged: true },
          }],
          ["workflow_nodes", {
            id: randomUUID(), owner_id: user.id, workflow_run_id: runId, node_key: "forged",
            agent_role: "researcher", model: "forged-model", reasoning_effort: "high",
          }],
          ["node_dependencies", {
            owner_id: user.id, workflow_run_id: runId, node_id: randomUUID(), depends_on_node_id: nodeId,
          }],
          ["node_attempts", {
            owner_id: user.id, workflow_node_id: nodeId, attempt_number: 2, status: "completed",
          }],
          ["node_artifacts", {
            owner_id: user.id, workflow_node_id: nodeId, node_attempt_id: attemptId,
            artifact_type: "forged", payload: { forged: true },
          }],
          ["model_invocations", {
            owner_id: user.id, node_attempt_id: attemptId, model: "forged-model",
            reasoning_effort: "high", status: "completed",
          }],
          ["tool_invocations", {
            owner_id: user.id, node_attempt_id: attemptId, tool_name: "forged-tool",
            input: {}, status: "completed",
          }],
          ["evidence", {
            owner_id: user.id, workflow_run_id: runId, company_id: companyId,
            source_type: "web", title: "Forged evidence", observed_at: "2026-08-02T00:00:00.000Z",
          }],
          ["claims", {
            owner_id: user.id, workflow_run_id: runId, company_id: companyId,
            claim_text: "Forged claim", confidence: 1, evidence_ids: [evidenceId],
          }],
          ["icp_assessments", {
            owner_id: user.id, company_id: companyId, icp_definition_id: icpId,
            workflow_run_id: runId, score: 100, rationale: "Forged assessment",
          }],
          ["opportunities", {
            owner_id: user.id, company_id: companyId, workflow_run_id: runId,
            title: "Forged opportunity", description: "Forged", value_score: "high",
            effort_score: "low", fit_score: "high",
          }],
          ["interactive_objects", {
            owner_id: user.id, conversation_id: conversationId, object_key: "forged-object",
            object_type: "workflow_progress", payload: { type: "workflow_progress" },
          }],
          ["feedback_events", {
            owner_id: user.id, conversation_id: conversationId,
            interactive_object_id: interactiveObjectId, event_type: "forged", payload: {},
          }],
        ];

        for (const [table, row] of attempts) {
          const result = await client.from(table).insert(row);
          expectPermissionDenied(result.error);
        }

        expectPermissionDenied((await client.from("interactive_objects")
          .update({ payload: { type: "workflow_progress", forged: true } })
          .eq("id", interactiveObjectId)).error);
        expectPermissionDenied((await client.from("evidence").delete().eq("id", evidenceId)).error);

        const readable = await client.from("evidence").select("id,title").eq("id", evidenceId).single();
        expect(readable.error).toBeNull();
        expect(readable.data).toEqual({ id: evidenceId, title: "Trusted evidence" });
      } finally {
        await admin.auth.admin.deleteUser(user.id);
      }
    },
    20_000,
  );
});
