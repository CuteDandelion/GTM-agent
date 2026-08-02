import type { OpportunityObject } from "@gtm/contracts";

import { reduceInteractiveObjects } from "./interactive-object-reducer";

const opportunity = (version: number, status: OpportunityObject["status"]): OpportunityObject => ({
  id: "33333333-3333-4333-8333-333333333333",
  conversationId: "22222222-2222-4222-8222-222222222222",
  version,
  type: "opportunity",
  company: "Acme",
  title: "Support Triage Agent",
  summary: "Automate support triage",
  impact: "high",
  value: "high",
  effort: "medium",
  fit: "high",
  status,
});

describe("interactive-object realtime reducer", () => {
  it("applies a newer object revision and ignores duplicate or out-of-order events", () => {
    const initial = [opportunity(2, "research")];
    const updated = reduceInteractiveObjects(initial, { kind: "upsert", object: opportunity(3, "pursue") });

    expect(updated).toEqual([opportunity(3, "pursue")]);
    expect(reduceInteractiveObjects(updated, { kind: "upsert", object: opportunity(3, "nurture") })).toBe(updated);
    expect(reduceInteractiveObjects(updated, { kind: "upsert", object: opportunity(1, "reject") })).toBe(updated);
  });

  it("removes deleted objects without mutating the previous state", () => {
    const initial = [opportunity(2, "research")];
    const removed = reduceInteractiveObjects(initial, {
      kind: "delete",
      objectId: "33333333-3333-4333-8333-333333333333",
    });

    expect(removed).toEqual([]);
    expect(initial).toEqual([opportunity(2, "research")]);
  });
});
