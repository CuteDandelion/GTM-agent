import { afterEach, describe, expect, it } from "vitest";

import { InMemoryInteractiveObjectService } from "../src/interactive-actions.js";
import { buildServer } from "../src/server.js";

const servers: Array<ReturnType<typeof buildServer>> = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())));

describe("interactive object action API", () => {
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
