interface MobileSupabaseClientInput<Client, Storage> {
  projectUrl: string;
  publishableKey: string;
  storage: Storage;
  createClient: (
    projectUrl: string,
    publishableKey: string,
    options: {
      auth: {
        storage: Storage;
        autoRefreshToken: boolean;
        persistSession: boolean;
        detectSessionInUrl: boolean;
      };
    },
  ) => Client;
}

export function createMobileSupabaseClient<Client, Storage>({
  projectUrl,
  publishableKey,
  storage,
  createClient,
}: MobileSupabaseClientInput<Client, Storage>): Client {
  if (!projectUrl.trim() || !publishableKey.trim()) {
    throw new Error("Supabase mobile configuration is missing");
  }
  return createClient(projectUrl, publishableKey, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}
