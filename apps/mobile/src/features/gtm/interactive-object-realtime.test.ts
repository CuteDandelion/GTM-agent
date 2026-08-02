import { createSupabaseInteractiveObjectRealtimeService } from "./interactive-object-realtime";

describe("Supabase interactive-object realtime adapter", () => {
  it("maps versioned upserts and deletes for one conversation and cleans up the channel", () => {
    let callback: ((payload: { eventType: string; new: unknown; old: unknown }) => void) | undefined;
    const channel = {} as { on: jest.Mock; subscribe: jest.Mock };
    channel.on = jest.fn((_event, _filter, listener) => {
        callback = listener;
        return channel;
      });
    channel.subscribe = jest.fn(() => channel);
    const removeChannel = jest.fn(async () => "ok");
    const client = { channel: jest.fn(() => channel), removeChannel };
    const events: unknown[] = [];
    const dispose = createSupabaseInteractiveObjectRealtimeService(client as never).subscribe(
      "22222222-2222-4222-8222-222222222222",
      (event) => events.push(event),
    );

    callback?.({
      eventType: "UPDATE",
      new: {
        id: "33333333-3333-4333-8333-333333333333",
        conversation_id: "22222222-2222-4222-8222-222222222222",
        object_type: "opportunity",
        revision: 3,
        payload: {
          company: "Acme",
          title: "Support Triage Agent",
          summary: "Automate support triage",
          impact: "high",
          value: "high",
          effort: "medium",
          fit: "high",
          status: "pursue",
        },
      },
      old: {},
    });
    callback?.({
      eventType: "DELETE",
      new: {},
      old: { id: "33333333-3333-4333-8333-333333333333" },
    });
    dispose();

    expect(events).toEqual([
      { kind: "upsert", object: expect.objectContaining({ id: "33333333-3333-4333-8333-333333333333", version: 3, status: "pursue" }) },
      { kind: "delete", objectId: "33333333-3333-4333-8333-333333333333" },
    ]);
    expect(channel.on).toHaveBeenCalledWith("postgres_changes", {
      event: "*",
      schema: "public",
      table: "interactive_objects",
      filter: "conversation_id=eq.22222222-2222-4222-8222-222222222222",
    }, expect.any(Function));
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
