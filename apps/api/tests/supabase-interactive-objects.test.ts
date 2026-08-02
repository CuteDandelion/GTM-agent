import { describe, expect, it } from "vitest";

import { StaleObjectVersionError } from "../src/interactive-actions.js";
import { createSupabaseInteractiveObjectService } from "../src/supabase-interactive-objects.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const objectId = "33333333-3333-4333-8333-333333333333";

function createClient(options: {
  rows?: unknown[];
  rpcResult?: { data: unknown; error: { message: string } | null };
}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: async () => ({ data: options.rows ?? [], error: null }),
          }),
        }),
      }),
    }),
    rpc: async (_name: string, _args: unknown) => options.rpcResult ?? { data: null, error: null },
  };
}

describe("Supabase interactive-object persistence", () => {
  it("publishes a projection through the atomic owner-scoped database function", async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const client = createClient({
      rpcResult: {
        data: {
          id: objectId,
          conversation_id: conversationId,
          object_key: "workflow-progress",
          object_type: "workflow_progress",
          revision: 2,
          payload: { type: "workflow_progress", title: "Researching foodbegood.app", live: false, steps: [{ id: "review", label: "Review", agent: "Sol", status: "completed" }] },
        },
        error: null,
      },
    });
    client.rpc = async (name: string, args: unknown) => {
      calls.push({ name, args });
      return {
        data: {
          id: objectId,
          conversation_id: conversationId,
          object_key: "workflow-progress",
          object_type: "workflow_progress",
          revision: 2,
          payload: { type: "workflow_progress", title: "Researching foodbegood.app", live: false, steps: [{ id: "review", label: "Review", agent: "Sol", status: "completed" }] },
        },
        error: null,
      };
    };
    const service = createSupabaseInteractiveObjectService(client as never);
    if (!("publish" in service)) {
      expect("publish" in service, "Supabase service must implement the projection sink").toBe(true);
      return;
    }

    await expect(service.publish({
      ownerId,
      conversationId,
      objectKey: "workflow-progress",
      object: { type: "workflow_progress", title: "Researching foodbegood.app", live: false, steps: [{ id: "review", label: "Review", agent: "Sol", status: "completed" }] },
    })).resolves.toMatchObject({ id: objectId, conversationId, version: 2, type: "workflow_progress" });
    expect(calls).toEqual([{
      name: "publish_interactive_object",
      args: {
        p_owner_id: ownerId,
        p_conversation_id: conversationId,
        p_object_key: "workflow-progress",
        p_object_type: "workflow_progress",
        p_payload: { type: "workflow_progress", title: "Researching foodbegood.app", live: false, steps: [{ id: "review", label: "Review", agent: "Sol", status: "completed" }] },
      },
    }]);
  });

  it("lists trusted payloads using the row identity and revision as authority", async () => {
    const service = createSupabaseInteractiveObjectService(createClient({
      rows: [{
        id: objectId,
        conversation_id: conversationId,
        object_key: "company-acme",
        object_type: "company_profile",
        revision: 4,
        payload: {
          id: "untrusted-payload-id",
          conversationId: "untrusted-conversation",
          version: 99,
          type: "company_profile",
          company: "Acme",
          domain: "acme.ai",
          summary: "AI support automation",
          facts: [{ label: "Model", value: "B2B SaaS" }],
          pros: ["AI native"],
          cons: ["Pricing unclear"],
        },
      }],
    }) as never);

    await expect(service.listForConversation(ownerId, conversationId)).resolves.toEqual([{
      id: objectId,
      conversationId,
      version: 4,
      type: "company_profile",
      company: "Acme",
      domain: "acme.ai",
      summary: "AI support automation",
      facts: [{ label: "Model", value: "B2B SaaS" }],
      pros: ["AI native"],
      cons: ["Pricing unclear"],
    }]);
  });

  it("maps the atomic database action result and rejects stale revisions", async () => {
    const applied = createSupabaseInteractiveObjectService(createClient({
      rpcResult: {
        data: { status: "applied", object_id: objectId, revision: 2 },
        error: null,
      },
    }) as never);
    await expect(applied.applyAction({
      objectId,
      ownerId,
      action: "shortlist",
      expectedVersion: 1,
      payload: {},
    })).resolves.toEqual({ objectId, version: 2, action: "shortlist", payload: {} });

    const stale = createSupabaseInteractiveObjectService(createClient({
      rpcResult: {
        data: { status: "stale", object_id: objectId, current_version: 3 },
        error: null,
      },
    }) as never);
    await expect(stale.applyAction({
      objectId,
      ownerId,
      action: "correct",
      expectedVersion: 1,
      payload: { correction: "Buyer is the COO" },
    })).rejects.toEqual(new StaleObjectVersionError(1, 3));
  });
});
