import { describe, expect, it } from "vitest";

import { InMemoryInteractiveObjectService, StaleObjectVersionError } from "../src/interactive-actions.js";

describe("interactive object actions", () => {
  it("records a correction and advances the object version", async () => {
    const service = new InMemoryInteractiveObjectService([{
      id: "object-1",
      ownerId: "user-1",
      conversationId: "conversation-1",
      version: 1,
      data: { type: "opportunity", status: "research" },
    }]);

    await expect(service.applyAction({
      objectId: "object-1",
      ownerId: "user-1",
      action: "correct",
      expectedVersion: 1,
      payload: { correction: "The buyer is the COO, not support leadership." },
    })).resolves.toMatchObject({ version: 2, action: "correct" });
  });

  it("rejects stale versions and cross-owner access", async () => {
    const service = new InMemoryInteractiveObjectService([{
      id: "object-1",
      ownerId: "user-1",
      conversationId: "conversation-1",
      version: 2,
      data: {},
    }]);

    await expect(service.applyAction({ objectId: "object-1", ownerId: "user-1", action: "shortlist", expectedVersion: 1, payload: {} }))
      .rejects.toBeInstanceOf(StaleObjectVersionError);
    await expect(service.applyAction({ objectId: "object-1", ownerId: "user-2", action: "shortlist", expectedVersion: 2, payload: {} }))
      .resolves.toBeUndefined();
  });
});
