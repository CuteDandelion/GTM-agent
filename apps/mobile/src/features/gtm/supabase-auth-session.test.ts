import { createSupabaseAuthSessionService } from "./supabase-auth-session";

describe("Supabase auth session adapter", () => {
  it("returns and refreshes the bearer token through the auth-state subscription", async () => {
    let listener: ((event: string, session: { access_token: string } | null) => void) | undefined;
    const unsubscribe = jest.fn();
    const client = {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: { access_token: "initial-token" } }, error: null })),
        signInWithPassword: jest.fn(async () => ({ data: { session: { access_token: "signed-in-token" } }, error: null })),
        signOut: jest.fn(async () => ({ error: null })),
        onAuthStateChange: jest.fn((callback: typeof listener) => {
          listener = callback;
          return { data: { subscription: { unsubscribe } } };
        }),
      },
    };
    const service = createSupabaseAuthSessionService(client);

    await expect(service.getAccessToken()).resolves.toBe("initial-token");
    await expect(service.signIn("operator@example.com", "password")).resolves.toBe("signed-in-token");
    const tokens: (string | undefined)[] = [];
    const dispose = service.subscribe((token) => tokens.push(token));
    listener?.("TOKEN_REFRESHED", { access_token: "refreshed-token" });
    listener?.("SIGNED_OUT", null);
    dispose();

    expect(tokens).toEqual(["refreshed-token", undefined]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("surfaces Supabase sign-in errors without exposing credentials", async () => {
    const client = {
      auth: {
        getSession: jest.fn(),
        signInWithPassword: jest.fn(async () => ({ data: { session: null }, error: { message: "Invalid login credentials" } })),
        signOut: jest.fn(),
        onAuthStateChange: jest.fn(),
      },
    };
    const service = createSupabaseAuthSessionService(client);

    await expect(service.signIn("operator@example.com", "secret-password")).rejects.toThrow("Invalid login credentials");
  });
});
