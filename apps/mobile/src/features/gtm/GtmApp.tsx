import { useEffect, useRef, useState } from "react";
import type { InteractiveObject } from "@gtm/contracts";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { GtmConversationScreen } from "./GtmConversationScreen";
import { loadConversationMessages, loadOrCreateConversation, type ConversationMessage } from "./conversation-workspace-client";
import type { ConversationExportService } from "./conversation-export-client";
import type { DocumentPickerService } from "./document-picker";
import type { DocumentUploadService } from "./document-upload-service";
import { loadInteractiveObjects } from "./interactive-object-client";
import { reduceInteractiveObjects } from "./interactive-object-reducer";
import type { InteractiveObjectRealtimeService } from "./interactive-object-realtime";
import { loadSellerProfile } from "./seller-profile-client";

export interface AuthSessionService {
  getAccessToken(): Promise<string | undefined>;
  signIn(email: string, password: string): Promise<string>;
  signOut(): Promise<void>;
  subscribe(listener: (accessToken: string | undefined) => void): () => void;
}

type AppState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "ready"; accessToken: string; hasProfile: boolean; conversationId: string; messages: ConversationMessage[]; interactiveObjects: InteractiveObject[] };

function safeHost(value?: string) {
  if (!value) return "Not configured";
  try {
    return new URL(value).host;
  } catch {
    return "Invalid URL";
  }
}

export function GtmApp({
  apiBaseUrl,
  authService,
  realtimeService,
  documentPicker,
  documentUploadService,
  conversationExportServiceFactory,
  supabaseUrl,
  debugEnabled = __DEV__,
  fetcher = fetch,
}: {
  apiBaseUrl: string;
  authService: AuthSessionService;
  realtimeService?: InteractiveObjectRealtimeService;
  documentPicker?: DocumentPickerService;
  documentUploadService?: DocumentUploadService;
  conversationExportServiceFactory?: (input: { accessToken: string; conversationId: string }) => ConversationExportService;
  supabaseUrl?: string;
  debugEnabled?: boolean;
  fetcher?: typeof fetch;
}) {
  const [state, setState] = useState<AppState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [authDebugOpen, setAuthDebugOpen] = useState(false);
  const passwordInputRef = useRef<TextInput>(null);

  const openWorkspace = async (accessToken: string) => {
    const [profile, conversation] = await Promise.all([
      loadSellerProfile({ apiBaseUrl, accessToken, fetcher }),
      loadOrCreateConversation({ apiBaseUrl, accessToken, fetcher }),
    ]);
    const [messages, interactiveObjects] = await Promise.all([
      loadConversationMessages({ apiBaseUrl, accessToken, conversationId: conversation.id, fetcher }),
      loadInteractiveObjects({ apiBaseUrl, accessToken, conversationId: conversation.id, fetcher }),
    ]);
    setState({
      kind: "ready",
      accessToken,
      hasProfile: profile !== undefined,
      conversationId: conversation.id,
      messages,
      interactiveObjects,
    });
  };

  const activeConversationId = state.kind === "ready" ? state.conversationId : undefined;
  useEffect(() => {
    if (!realtimeService || !activeConversationId) return undefined;
    return realtimeService.subscribe(activeConversationId, (event) => {
      setState((current) => current.kind === "ready" && current.conversationId === activeConversationId
        ? { ...current, interactiveObjects: reduceInteractiveObjects(current.interactiveObjects, event) }
        : current);
    });
  }, [activeConversationId, realtimeService]);

  useEffect(() => {
    let active = true;
    void authService.getAccessToken()
      .then(async (accessToken) => {
        if (!active) return;
        if (accessToken) await openWorkspace(accessToken);
        else setState({ kind: "signed-out" });
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Unable to restore your session");
        setState({ kind: "signed-out" });
      });
    const unsubscribe = authService.subscribe((accessToken) => {
      if (!active || accessToken) return;
      setState({ kind: "signed-out" });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  // The injected services are stable runtime dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authService, apiBaseUrl, fetcher]);

  const signIn = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const accessToken = await authService.signIn(email.trim(), password);
      await openWorkspace(accessToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in");
    } finally {
      setSubmitting(false);
    }
  };

  if (state.kind === "loading") {
    return <SafeAreaView style={styles.centered}><ActivityIndicator color="#071A45" /><Text style={styles.loadingText}>Opening your GTM workspace…</Text></SafeAreaView>;
  }
  if (state.kind === "ready") {
    return <GtmConversationScreen
      initialState={state.hasProfile
        ? state.messages.length === 0 && state.interactiveObjects.length === 0 ? "empty" : "assessment"
        : "onboarding"}
      apiBaseUrl={apiBaseUrl}
      accessToken={state.accessToken}
      conversationId={state.conversationId}
      initialMessages={state.messages}
      interactiveObjects={state.interactiveObjects}
      documentPicker={documentPicker}
      documentUploadService={documentUploadService}
      conversationExportService={conversationExportServiceFactory?.({ accessToken: state.accessToken, conversationId: state.conversationId })}
      onOnboardingComplete={() => setState((current) => current.kind === "ready"
        ? { ...current, hasProfile: true }
        : current)}
      fetcher={fetcher}
    />;
  }
  return <SafeAreaView style={styles.screen}><View style={styles.signInCard}>
    <Text style={styles.eyebrow}>GTM RESEARCH AGENT</Text>
    <Text style={styles.title}>Sign in to your GTM workspace</Text>
    <Text style={styles.subtitle}>Research companies, qualify opportunities, and keep every recommendation grounded in evidence.</Text>
    {debugEnabled ? <Pressable accessibilityRole="button" accessibilityLabel="Open auth debug panel" onPress={() => setAuthDebugOpen((open) => !open)} style={styles.debugToggle}><Text style={styles.debugToggleText}>{authDebugOpen ? "Hide auth diagnostics" : "Show auth diagnostics"}</Text></Pressable> : null}
    {authDebugOpen ? <View style={styles.debugPanel}>
      <Text style={styles.debugTitle}>Auth diagnostics</Text>
      <View style={styles.debugRow}><Text style={styles.debugLabel}>API host</Text><Text style={styles.debugValue}>{safeHost(apiBaseUrl)}</Text></View>
      <View style={styles.debugRow}><Text style={styles.debugLabel}>Supabase host</Text><Text style={styles.debugValue}>{safeHost(supabaseUrl)}</Text></View>
      <View style={styles.debugRow}><Text style={styles.debugLabel}>Email characters</Text><Text style={styles.debugValue}>{email.length}</Text></View>
      <View style={styles.debugRow}><Text style={styles.debugLabel}>Password characters</Text><Text style={styles.debugValue}>{password.length}</Text></View>
      <View style={styles.debugRow}><Text style={styles.debugLabel}>Last warning</Text><Text style={styles.debugValue}>{error ?? "None"}</Text></View>
      <Text style={styles.debugPrivacy}>Credential values, session tokens, and keys are excluded.</Text>
    </View> : null}
    <Text style={styles.label}>Email</Text>
    <TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => passwordInputRef.current?.focus()} value={email} onChangeText={setEmail} style={styles.input} />
    <Text style={styles.label}>Password</Text>
    <TextInput ref={passwordInputRef} accessibilityLabel="Password" autoCapitalize="none" autoComplete="current-password" secureTextEntry returnKeyType="go" onSubmitEditing={() => void signIn()} value={password} onChangeText={setPassword} style={styles.input} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Sign in" disabled={submitting} onPress={() => void signIn()} style={[styles.button, submitting && styles.buttonDisabled]}>
      <Text style={styles.buttonText}>{submitting ? "Signing in…" : "Sign in"}</Text>
    </Pressable>
  </View></SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", backgroundColor: "#F5F7FA", paddingHorizontal: 22 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", gap: 12 },
  loadingText: { color: "#667085", fontSize: 13 },
  signInCard: { borderRadius: 22, borderWidth: 1, borderColor: "#E4E7EC", backgroundColor: "#FFFFFF", padding: 22 },
  eyebrow: { color: "#1264F4", fontSize: 11, fontWeight: "700", letterSpacing: 1.1 },
  title: { color: "#101828", fontSize: 26, lineHeight: 32, fontWeight: "700", marginTop: 10 },
  subtitle: { color: "#667085", fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 22 },
  debugToggle: { alignSelf: "flex-end", marginTop: -12, marginBottom: 12, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, backgroundColor: "#EEF4FF" }, debugToggleText: { color: "#175CD3", fontSize: 10, fontWeight: "700" },
  debugPanel: { padding: 12, marginBottom: 15, borderRadius: 12, backgroundColor: "#0B1220", gap: 6 }, debugTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "700", marginBottom: 3 }, debugRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 }, debugLabel: { color: "#98A2B3", fontSize: 10 }, debugValue: { flex: 1, color: "#E6EDF7", fontSize: 10, textAlign: "right" }, debugPrivacy: { color: "#667085", fontSize: 8, marginTop: 5 },
  label: { color: "#344054", fontSize: 12, fontWeight: "600", marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 12, paddingHorizontal: 13, color: "#101828", marginBottom: 15 },
  error: { color: "#B42318", fontSize: 12, marginBottom: 12 },
  button: { minHeight: 50, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#071A45", marginTop: 4 },
  buttonDisabled: { opacity: 0.65 },
  buttonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
});
