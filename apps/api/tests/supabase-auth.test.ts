import { describe, expect, it, vi } from "vitest";

import { createSupabaseAuthService } from "../src/supabase-auth.js";

describe("Supabase bearer authentication", () => {
  it("verifies a bearer token with Supabase Auth", async () => {
    const getUser = vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));
    const auth = createSupabaseAuthService({ auth: { getUser } });

    await expect(auth.authenticate("Bearer token-1")).resolves.toEqual({ userId: "user-1" });
    expect(getUser).toHaveBeenCalledWith("token-1");
  });

  it("rejects missing, malformed, and invalid bearer tokens", async () => {
    const getUser = vi.fn(async () => ({ data: { user: null }, error: new Error("invalid") }));
    const auth = createSupabaseAuthService({ auth: { getUser } });

    await expect(auth.authenticate(undefined)).resolves.toBeUndefined();
    await expect(auth.authenticate("Basic abc")).resolves.toBeUndefined();
    await expect(auth.authenticate("Bearer invalid")).resolves.toBeUndefined();
  });
});
