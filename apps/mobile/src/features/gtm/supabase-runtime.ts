import "react-native-url-polyfill/auto";
import "expo-sqlite/localStorage/install";

import { createClient } from "@supabase/supabase-js";

import { createMobileSupabaseClient } from "./mobile-supabase-client";

export function createRuntimeSupabaseClient() {
  return createMobileSupabaseClient({
    projectUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
    publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    storage: globalThis.localStorage,
    createClient,
  });
}
