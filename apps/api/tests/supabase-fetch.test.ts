import { describe, expect, it, vi } from "vitest";

import { createSupabaseFetch } from "../src/supabase-fetch.js";

describe("Supabase transport", () => {
  it("retries a transient JWT-issued-at-future response before returning success", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "JWT issued at future" }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const delay = vi.fn(async () => undefined);

    const response = await createSupabaseFetch({ fetchImpl, delay })("https://example.supabase.co/rest/v1/conversations");

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(1_000);
  });

  it("does not retry unrelated server failures", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "database unavailable" }), { status: 500 }));
    const delay = vi.fn(async () => undefined);

    const response = await createSupabaseFetch({ fetchImpl, delay })("https://example.supabase.co/rest/v1/conversations");

    expect(response.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });
});
