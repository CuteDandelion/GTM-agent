export interface SupabaseAuthClient {
  auth: {
    getSession(): Promise<{
      data: { session: { access_token: string } | null };
      error: { message: string } | null;
    }>;
    signInWithPassword(credentials: { email: string; password: string }): Promise<{
      data: { session: { access_token: string } | null };
      error: { message: string } | null;
    }>;
    signOut(): Promise<{ error: { message: string } | null }>;
    onAuthStateChange(callback: (event: string, session: { access_token: string } | null) => void): {
      data: { subscription: { unsubscribe(): void } };
    };
  };
}

export function createSupabaseAuthSessionService(client: SupabaseAuthClient) {
  return {
    async getAccessToken() {
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error(error.message);
      return data.session?.access_token;
    },

    async signIn(email: string, password: string) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      if (!data.session?.access_token) throw new Error("Supabase did not return an authenticated session");
      return data.session.access_token;
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw new Error(error.message);
    },

    subscribe(listener: (accessToken: string | undefined) => void) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        listener(session?.access_token);
      });
      return () => data.subscription.unsubscribe();
    },
  };
}
