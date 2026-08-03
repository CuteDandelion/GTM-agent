import { afterEach, describe, expect, it } from "vitest";

import { InMemoryInteractiveObjectService } from "../src/interactive-actions.js";
import { buildServer } from "../src/server.js";

const servers: Array<ReturnType<typeof buildServer>> = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())));

describe("interactive object action API", () => {
  it("publishes one stable mobile object and advances its version on replacement", async () => {
    const service = new InMemoryInteractiveObjectService();
    if (!("publish" in service)) {
      expect("publish" in service, "interactive object service must expose the projection sink").toBe(true);
      return;
    }
    const publish = service.publish as (input: {
      ownerId: string;
      conversationId: string;
      objectKey: string;
      object: Record<string, unknown>;
    }) => Promise<unknown>;
    const input = {
      ownerId: "user-1",
      conversationId: "22222222-2222-4222-8222-222222222222",
      objectKey: "workflow-progress",
    };

    await publish.call(service, { ...input, object: { type: "workflow_progress", title: "Researching foodbegood.app", live: true, steps: [] } });
    await publish.call(service, { ...input, object: { type: "workflow_progress", title: "Researching foodbegood.app", live: false, steps: [{ id: "review", label: "Review", agent: "Sol", status: "completed" }] } });

    await expect(service.listForConversation(input.ownerId, input.conversationId)).resolves.toEqual([{
      id: expect.any(String),
      conversationId: input.conversationId,
      version: 2,
      type: "workflow_progress",
      title: "Researching foodbegood.app",
      live: false,
      steps: [{ id: "review", label: "Review", agent: "Sol", status: "completed" }],
    }]);
  });

  it("lists only the authenticated owner's conversation objects", async () => {
    const objectActionService = new InMemoryInteractiveObjectService([{
      id: "object-1",
      ownerId: "user-1",
      conversationId: "22222222-2222-4222-8222-222222222222",
      version: 1,
      data: { type: "company_profile", company: "Acme" },
    }, {
      id: "object-2",
      ownerId: "user-2",
      conversationId: "22222222-2222-4222-8222-222222222222",
      version: 1,
      data: { type: "company_profile", company: "Other" },
    }]);
    const server = buildServer({
      logger: false,
      authService: { authenticate: async () => ({ userId: "user-1" }) },
      objectActionService,
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const response = await fetch(`${origin}/api/v1/conversations/22222222-2222-4222-8222-222222222222/interactive-objects`, {
      headers: { authorization: "Bearer valid" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{
      id: "object-1",
      conversationId: "22222222-2222-4222-8222-222222222222",
      version: 1,
      type: "company_profile",
      company: "Acme",
    }]);
  });

  it("applies an owner-scoped action and rejects a stale retry", async () => {
    const objectActionService = new InMemoryInteractiveObjectService([{
      id: "object-1",
      ownerId: "user-1",
      conversationId: "conversation-1",
      version: 1,
      data: {},
    }]);
    const server = buildServer({
      logger: false,
      authService: { authenticate: async () => ({ userId: "user-1" }) },
      objectActionService,
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });
    const request = () => fetch(`${origin}/api/v1/interactive-objects/object-1/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer valid" },
      body: JSON.stringify({ action: "shortlist", expectedVersion: 1, payload: {} }),
    });

    const applied = await request();
    const stale = await request();
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({ objectId: "object-1", version: 2, action: "shortlist" });
    expect(stale.status).toBe(409);
  });
});
