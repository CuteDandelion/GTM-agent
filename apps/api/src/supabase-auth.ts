export interface AuthenticatedUser {
  userId: string;
}

export interface AuthService {
  authenticate(authorization: string | undefined): Promise<AuthenticatedUser | undefined>;
}

interface SupabaseAuthClientLike {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
}

export function createSupabaseAuthService(client: SupabaseAuthClientLike): AuthService {
  return {
    async authenticate(authorization) {
      const match = authorization?.match(/^Bearer\s+(.+)$/i);
      if (!match?.[1]) return undefined;
      const { data, error } = await client.auth.getUser(match[1]);
      if (error || !data.user?.id) return undefined;
      return { userId: data.user.id };
    },
  };
}

export function createEnvironmentAuthService(environment: NodeJS.ProcessEnv = process.env): AuthService {
  const url = environment.SUPABASE_URL;
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return { authenticate: async () => undefined };
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return createSupabaseAuthService(client);
}
import { createClient } from "@supabase/supabase-js";
