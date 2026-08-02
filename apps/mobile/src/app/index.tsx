import { useMemo } from "react";

import { GtmApp } from "@/features/gtm/GtmApp";
import { GtmConversationScreen } from "@/features/gtm/GtmConversationScreen";
import { createSupabaseDocumentUploadService } from "@/features/gtm/document-upload-service";
import { createExpoConversationExportService } from "@/features/gtm/expo-conversation-export-runtime";
import { expoDocumentPicker } from "@/features/gtm/expo-document-picker-runtime";
import { createSupabaseAuthSessionService } from "@/features/gtm/supabase-auth-session";
import { createSupabaseInteractiveObjectRealtimeService } from "@/features/gtm/interactive-object-realtime";
import { createRuntimeSupabaseClient } from "@/features/gtm/supabase-runtime";
import { resolveVisualQaState, type VisualQaState } from "@/features/gtm/visual-qa-state";

export default function HomeScreen({
  visualQaState = resolveVisualQaState(
    process.env.EXPO_PUBLIC_VISUAL_QA_STATE,
    process.env.NODE_ENV,
  ),
}: { visualQaState?: VisualQaState } = {}) {
  const services = useMemo(() => {
    if (visualQaState) return undefined;
    const client = createRuntimeSupabaseClient();
    return {
      authService: createSupabaseAuthSessionService(client),
      realtimeService: createSupabaseInteractiveObjectRealtimeService(client),
      documentUploadService: createSupabaseDocumentUploadService(client, { maxBytes: 10_485_760 }),
    };
  }, [visualQaState]);
  if (visualQaState) {
    return <GtmConversationScreen
      initialState={visualQaState === "evidence" ? "assessment" : visualQaState}
      initialEvidenceOpen={visualQaState === "evidence"}
      debugEnabled={false}
    />;
  }
  return <GtmApp
    apiBaseUrl={process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000"}
    supabaseUrl={process.env.EXPO_PUBLIC_SUPABASE_URL}
    authService={services!.authService}
    realtimeService={services!.realtimeService}
    documentPicker={expoDocumentPicker}
    documentUploadService={services!.documentUploadService}
    conversationExportServiceFactory={({ accessToken, conversationId }) => createExpoConversationExportService({
      apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000",
      accessToken,
      conversationId,
    })}
  />;
}
