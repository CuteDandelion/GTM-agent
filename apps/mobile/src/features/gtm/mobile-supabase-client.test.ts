import { createMobileSupabaseClient } from "./mobile-supabase-client";

describe("mobile Supabase client configuration", () => {
  it("creates a persisted native auth client with public project credentials", () => {
    const storage = { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() };
    const client = { auth: {} };
    const createClient = jest.fn(() => client);

    expect(createMobileSupabaseClient({
      projectUrl: "https://project.supabase.co",
      publishableKey: "sb_publishable_test",
      storage,
      createClient,
    })).toBe(client);
    expect(createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "sb_publishable_test",
      {
        auth: {
          storage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      },
    );
  });

  it("fails closed when the public project configuration is missing", () => {
    expect(() => createMobileSupabaseClient({
      projectUrl: "",
      publishableKey: "",
      storage: {},
      createClient: jest.fn(),
    })).toThrow("Supabase mobile configuration is missing");
  });
});
