import { canonicalAcmeFixtures } from "@gtm/contracts";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { startDomainResearch } from "./conversation-client";

type ConversationState = "progress" | "assessment";
type SymbolName = SymbolViewProps["name"];

const colors = { navy: "#071A45", ink: "#101828", muted: "#667085", line: "#E4E7EC", green: "#16A34A", blue: "#1264F4", soft: "#F3F4F6", white: "#FFFFFF" } as const;

function Icon({ name, size = 18, color = colors.navy }: { name: SymbolName; size?: number; color?: string }) {
  return <SymbolView name={name} size={size} tintColor={color} />;
}

function Header() {
  return <View style={styles.header}>
    <Pressable accessibilityRole="button" accessibilityLabel="Open menu" style={styles.headerButton}><Icon name={{ ios: "line.3.horizontal", android: "menu" }} size={20} /></Pressable>
    <View style={styles.agentMark}><Icon name={{ ios: "sparkles", android: "auto_awesome" }} color={colors.white} size={18} /></View>
    <View style={styles.headerCopy}><Text style={styles.headerTitle}>GTM Research Agent</Text><Text style={styles.headerSubtitle}>Conversational research for freelancers</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Research settings" style={styles.headerButton}><Icon name={{ ios: "slider.horizontal.3", android: "tune" }} size={19} /></Pressable>
  </View>;
}

function UserMessage({ message = "Analyze acme.ai" }: { message?: string }) {
  return <View style={styles.userRow}><View style={styles.userBubble}><Text style={styles.userText}>{message}</Text><Text style={styles.userTime}>9:41 AM  Sent</Text></View></View>;
}

function AgentAvatar() {
  return <View style={styles.avatar}><Icon name={{ ios: "point.3.connected.trianglepath.dotted", android: "hub" }} color={colors.white} size={14} /></View>;
}

function ProgressCard() {
  const progress = canonicalAcmeFixtures.progress;
  return <View style={styles.agentRow}><AgentAvatar /><View style={styles.agentBody}>
    <View style={styles.assistantBubble}><Text style={styles.assistantText}>I’ll research Acme and map the strongest automation opportunities.</Text><Text style={styles.assistantTime}>9:41 AM</Text></View>
    <View style={styles.progressCard}>
      <View style={styles.progressHeader}><Text style={styles.progressTitle}>{progress.title}</Text><View style={styles.liveGroup}><Icon name={{ ios: "circle.fill", android: "radio_button_checked" }} color={colors.green} size={10} /><Text style={styles.liveLabel}>Live</Text></View></View>
      {progress.steps.map((step) => {
        const complete = step.status === "completed";
        const running = step.status === "running";
        return <View key={step.id} style={styles.progressStep}>
          <Icon name={complete ? { ios: "checkmark.circle.fill", android: "check_circle" } : running ? { ios: "hourglass.circle", android: "hourglass" } : { ios: "circle", android: "circle" }} color={complete ? colors.green : running ? colors.blue : "#D4D8DF"} size={18} />
          <Text style={styles.stepLabel}>{step.label}</Text>
          <Text style={[styles.stepAgent, running && styles.stepAgentRunning]}>{step.agent} · {running ? "Running" : complete ? "Done" : "Pending"}</Text>
        </View>;
      })}
    </View><Text style={styles.messageTime}>9:43 AM</Text>
  </View></View>;
}

function ProsCons({ assessment }: { assessment: typeof canonicalAcmeFixtures.assessment }) {
  return <View style={styles.prosCons}>
    <View style={styles.prosColumn}><Text style={styles.prosTitle}>Pros</Text>{assessment.pros.map((item) => <View key={item} style={styles.listItem}><Icon name={{ ios: "checkmark", android: "check_circle" }} color={colors.green} size={10} /><Text style={styles.listText}>{item}</Text></View>)}</View>
    <View style={styles.prosColumn}><Text style={styles.consTitle}>Cons</Text>{assessment.cons.map((item) => <View key={item} style={styles.listItem}><Icon name={{ ios: "xmark", android: "cancel" }} color="#DC2626" size={10} /><Text style={styles.listText}>{item}</Text></View>)}</View>
  </View>;
}

function ConfidenceDots({ value }: { value: number }) {
  return <View style={styles.confidenceDots}>{Array.from({ length: 5 }, (_, index) => <Icon key={index} name={index < value ? { ios: "circle.fill", android: "radio_button_checked" } : { ios: "circle", android: "radio_button_unchecked" }} color={index < value ? colors.green : "#D5D9DF"} size={8} />)}</View>;
}

function AssessmentCard({ onEvidence }: { onEvidence: () => void }) {
  const assessment = canonicalAcmeFixtures.assessment;
  return <View style={styles.agentRow}><AgentAvatar /><View style={styles.agentBody}>
    <View style={[styles.assistantBubble, styles.compactBubble]}><Text style={styles.assistantText}>Here’s what I found about Acme.</Text><Text style={styles.assistantTime}>9:41 AM</Text></View>
    <View style={styles.companyCard}>
      <View style={styles.companyHeader}>
        <View style={styles.logo}><Text style={styles.logoText}>acme</Text></View>
        <View style={styles.companyIdentity}><Text style={styles.companyName}>{assessment.company}</Text><Text style={styles.domain}>{assessment.domain}</Text></View>
        <View style={styles.scorePill}><Text style={styles.scoreLabel}>ICP fit</Text><Text style={styles.score}>{assessment.icpScore}</Text></View>
      </View>
      <Text style={styles.summary}>{assessment.summary}</Text>
      <View style={styles.factsRow}><Text style={styles.fact}>{assessment.facts.businessModel}</Text><Text style={styles.fact}>{assessment.facts.founded}</Text><Text style={styles.fact}>{assessment.facts.fundingStage}</Text><Text style={styles.fact}>{assessment.facts.employeeRange}</Text></View>
      <ProsCons assessment={assessment} />
      <View style={styles.opportunityCard}>
        <View style={styles.opportunityIcon}><Icon name={{ ios: "cpu", android: "smart_toy" }} color={colors.white} size={22} /></View>
        <View style={styles.opportunityBody}>
          <View style={styles.opportunityTitleRow}><Text style={styles.opportunityTitle}>{assessment.opportunity.title}</Text><Text style={styles.impactPill}>High impact</Text></View>
          <Text style={styles.opportunitySummary}>{assessment.opportunity.summary}</Text>
          <View style={styles.metrics}><Text style={styles.metric}>Value{`\n`}<Text style={styles.metricGreen}>High</Text></Text><Text style={styles.metric}>Effort{`\n`}<Text style={styles.metricBlue}>Medium</Text></Text><Text style={styles.metric}>Fit{`\n`}<Text style={styles.metricGreen}>High</Text></Text></View>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Evidence" style={styles.actionButton} onPress={onEvidence}><Text style={styles.actionText}>Evidence</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Challenge" style={styles.actionButton}><Text style={styles.actionText}>Challenge</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Shortlist" style={styles.shortlistButton}><Icon name={{ ios: "star", android: "star" }} color={colors.white} size={13} /><Text style={styles.shortlistText}>Shortlist</Text></Pressable>
      </View>
    </View><Text style={styles.messageTime}>9:43 AM</Text>
  </View></View>;
}

function Composer({ value = "", onChangeText, onSend, disabled = false }: {
  value?: string;
  onChangeText?: (value: string) => void;
  onSend?: () => void;
  disabled?: boolean;
}) {
  return <View style={styles.composer}>
    <Pressable accessibilityRole="button" accessibilityLabel="Attach source" style={styles.attachButton}><Icon name={{ ios: "link", android: "link" }} size={17} /></Pressable>
    <TextInput accessibilityLabel="Message GTM Research Agent" placeholder="Ask anything about your market or ideal customers…" placeholderTextColor="#98A2B3" multiline style={styles.input} value={value} onChangeText={onChangeText} editable={!disabled} />
    <Pressable accessibilityRole="button" accessibilityLabel="Send message" style={styles.sendButton} onPress={onSend} disabled={disabled}><Icon name={{ ios: "paperplane.fill", android: "send" }} color={colors.white} size={16} /></Pressable>
  </View>;
}

function EvidenceDrawer({ evidence, onClose }: { evidence: typeof canonicalAcmeFixtures.evidence; onClose: () => void }) {
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalRoot}>
    <Pressable style={styles.scrim} accessibilityRole="button" accessibilityLabel="Dismiss evidence" onPress={onClose} />
    <SafeAreaView style={styles.sheet}>
      <View style={styles.handle} />
      <View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>{evidence.title}</Text><Text style={styles.sheetSubtitle}>{evidence.subtitle}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close evidence" onPress={onClose} style={styles.closeButton}><Icon name={{ ios: "xmark", android: "close" }} size={18} /></Pressable></View>
      <ScrollView contentContainerStyle={styles.evidenceList}>{evidence.items.map((item, index) => <View key={item.id} style={styles.evidenceCard}>
        <View style={[styles.sourceIcon, index === 1 ? styles.sourceGreen : index === 2 ? styles.sourceViolet : styles.sourceBlue]}><Icon name={index === 0 ? { ios: "globe", android: "public" } : { ios: "doc.text", android: "description" }} color={index === 1 ? colors.green : index === 2 ? "#6D28B7" : "#2375ED"} size={23} /></View>
        <View style={styles.sourceBody}><Text style={styles.sourceTitle}>{item.title}</Text><Text style={styles.sourceUrl}>{item.url}</Text><Text style={styles.sourceExcerpt}>{item.excerpt}</Text></View>
        <View style={styles.sourceMeta}><Text style={[styles.classification, item.classification === "fact" ? styles.factClass : styles.inferenceClass]}>{item.classification === "fact" ? "Fact" : "Inference"}</Text><View style={styles.confidenceGroup}><Text style={styles.confidence}>Confidence</Text><ConfidenceDots value={item.confidence} /></View></View>
      </View>)}</ScrollView>
      <Composer />
    </SafeAreaView>
  </View></Modal>;
}

function extractDomains(message: string): string[] {
  return [...message.matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi)]
    .map((match) => match[1]!.toLowerCase())
    .filter((domain, index, domains) => domains.indexOf(domain) === index)
    .slice(0, 5);
}

export function GtmConversationScreen({
  initialState = "progress",
  apiBaseUrl,
  conversationId = "11111111-1111-4111-8111-111111111111",
  fetcher = fetch,
}: {
  initialState?: ConversationState;
  apiBaseUrl?: string;
  conversationId?: string;
  fetcher?: typeof fetch;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("Analyze acme.ai");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    const trimmed = draft.trim();
    const domains = extractDomains(trimmed);
    if (!trimmed || domains.length === 0) {
      setError("Include at least one company domain.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      if (apiBaseUrl) await startDomainResearch({ apiBaseUrl, conversationId, message: trimmed, domains, fetcher });
      setMessage(trimmed);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start research");
    } finally {
      setSubmitting(false);
    }
  };
  return <SafeAreaView style={styles.screen}><Header /><ScrollView style={styles.scroll} contentContainerStyle={styles.conversation}>
    <Text style={styles.today}>Today</Text><UserMessage message={message} />{error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}{initialState === "progress" ? <ProgressCard /> : <AssessmentCard onEvidence={() => setEvidenceOpen(true)} />}
  </ScrollView><Composer value={draft} onChangeText={setDraft} onSend={() => void submit()} disabled={submitting} />{evidenceOpen ? <EvidenceDrawer evidence={canonicalAcmeFixtures.evidence} onClose={() => setEvidenceOpen(false)} /> : null}</SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  header: { height: 66, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "#EEF0F3", flexDirection: "row", alignItems: "center", gap: 8 },
  headerButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" }, agentMark: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1 }, headerTitle: { color: colors.ink, fontWeight: "700", fontSize: 15 }, headerSubtitle: { color: colors.muted, fontSize: 10, marginTop: 2 },
  scroll: { flex: 1 }, conversation: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 104 }, today: { color: "#7B8190", fontSize: 10, textAlign: "center", marginBottom: 14 },
  userRow: { alignItems: "flex-end", marginBottom: 16 }, userBubble: { maxWidth: 180, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, borderRadius: 17, borderBottomRightRadius: 5, backgroundColor: colors.navy },
  userText: { color: colors.white, fontSize: 14 }, userTime: { color: "rgba(255,255,255,0.72)", fontSize: 9, textAlign: "right", marginTop: 7 },
  agentRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 }, avatar: { width: 30, height: 30, marginTop: 3, borderRadius: 15, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" }, agentBody: { flex: 1 },
  assistantBubble: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 15, borderTopLeftRadius: 6, backgroundColor: colors.soft }, compactBubble: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  assistantText: { color: colors.ink, fontSize: 12, lineHeight: 17 }, assistantTime: { color: colors.muted, fontSize: 9, marginTop: 6 },
  progressCard: { marginTop: 9, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.white, overflow: "hidden" }, progressHeader: { paddingHorizontal: 14, paddingVertical: 13, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressTitle: { color: colors.ink, fontWeight: "700", fontSize: 15 }, liveGroup: { flexDirection: "row", alignItems: "center", gap: 4 }, liveLabel: { color: colors.green, fontSize: 10 }, progressStep: { minHeight: 46, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: "#EEF0F3", flexDirection: "row", alignItems: "center", gap: 8 },
  stepLabel: { flex: 1, color: colors.ink, fontSize: 11 }, stepAgent: { color: colors.muted, fontSize: 9 }, stepAgentRunning: { color: colors.blue }, messageTime: { color: colors.muted, fontSize: 9, marginTop: 9, marginLeft: 6 },
  companyCard: { marginTop: 9, padding: 11, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.white }, companyHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  logo: { width: 44, height: 44, borderRadius: 11, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" }, logoText: { color: colors.white, fontSize: 12, fontWeight: "700" }, companyIdentity: { flex: 1 }, companyName: { color: colors.ink, fontSize: 15, fontWeight: "700" }, domain: { color: colors.blue, fontSize: 11, marginTop: 3 },
  scorePill: { flexDirection: "row", alignItems: "baseline", gap: 3, paddingHorizontal: 8, paddingVertical: 9, borderRadius: 10, backgroundColor: "#ECF9F0" }, scoreLabel: { color: colors.green, fontSize: 9 }, score: { color: colors.green, fontSize: 18, fontWeight: "700" },
  summary: { color: colors.ink, fontSize: 11, marginVertical: 9 }, factsRow: { paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", justifyContent: "space-between" }, fact: { color: "#344054", fontSize: 8 },
  prosCons: { paddingVertical: 9, flexDirection: "row", gap: 10 }, prosColumn: { flex: 1, gap: 4 }, prosTitle: { color: colors.green, fontSize: 9, fontWeight: "600", marginBottom: 2 }, consTitle: { color: "#DC2626", fontSize: 9, fontWeight: "600", marginBottom: 2 }, listItem: { flexDirection: "row", alignItems: "flex-start", gap: 3 }, listText: { flex: 1, color: colors.ink, fontSize: 8, lineHeight: 12 },
  opportunityCard: { padding: 9, borderWidth: 1.5, borderColor: "#4C94FF", borderRadius: 11, backgroundColor: "#FBFDFF", flexDirection: "row", gap: 9 }, opportunityIcon: { width: 42, height: 42, borderRadius: 10, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" }, opportunityBody: { flex: 1 },
  opportunityTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 }, opportunityTitle: { flex: 1, color: colors.ink, fontWeight: "700", fontSize: 11 }, impactPill: { color: colors.green, fontSize: 8, paddingHorizontal: 5, paddingVertical: 3, borderRadius: 7, backgroundColor: "#E7F8ED" }, opportunitySummary: { color: colors.ink, fontSize: 8, lineHeight: 12, marginVertical: 5 },
  metrics: { flexDirection: "row" }, metric: { width: "33.33%", color: "#344054", fontSize: 8, lineHeight: 11 }, metricGreen: { color: colors.green }, metricBlue: { color: colors.blue }, actions: { flexDirection: "row", gap: 6, marginTop: 8 },
  actionButton: { flex: 1, minHeight: 34, borderWidth: 1, borderColor: colors.line, borderRadius: 8, alignItems: "center", justifyContent: "center" }, actionText: { color: colors.ink, fontSize: 9 }, shortlistButton: { flex: 1, minHeight: 34, borderRadius: 8, backgroundColor: colors.navy, flexDirection: "row", gap: 4, alignItems: "center", justifyContent: "center" }, shortlistText: { color: colors.white, fontSize: 9 },
  composer: { marginHorizontal: 14, marginBottom: 8, minHeight: 64, paddingHorizontal: 7, borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", gap: 6 }, attachButton: { width: 34, height: 34, borderWidth: 1, borderColor: colors.line, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 46, maxHeight: 88, color: colors.ink, fontSize: 11, lineHeight: 16 }, sendButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  errorText: { color: "#B42318", fontSize: 11, marginBottom: 10, textAlign: "right" },
  modalRoot: { flex: 1, justifyContent: "flex-end" }, scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(16,24,40,0.44)" }, sheet: { height: "76%", backgroundColor: colors.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden" }, handle: { alignSelf: "center", width: 34, height: 4, marginTop: 8, borderRadius: 2, backgroundColor: "#C9CDD3" },
  sheetHeader: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", justifyContent: "space-between" }, sheetTitle: { color: colors.ink, fontSize: 17, fontWeight: "700" }, sheetSubtitle: { color: colors.muted, fontSize: 10, marginTop: 3 }, closeButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  evidenceList: { padding: 12, gap: 10, paddingBottom: 18 }, evidenceCard: { padding: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 14, flexDirection: "row", flexWrap: "wrap", gap: 10, backgroundColor: colors.white }, sourceIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" }, sourceBlue: { backgroundColor: "#E9F2FF" }, sourceGreen: { backgroundColor: "#E8F8ED" }, sourceViolet: { backgroundColor: "#F1EAFB" }, sourceBody: { flex: 1 },
  sourceTitle: { color: colors.ink, fontSize: 12, fontWeight: "700" }, sourceUrl: { color: colors.blue, fontSize: 9, marginTop: 3 }, sourceExcerpt: { color: "#475467", fontSize: 10, lineHeight: 14, marginTop: 8 }, sourceMeta: { width: "100%", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, classification: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, fontSize: 8 }, factClass: { color: colors.green, backgroundColor: "#EBF8EF" }, inferenceClass: { color: "#6D28B7", backgroundColor: "#F5F0FB" }, confidenceGroup: { flexDirection: "row", alignItems: "center", gap: 5 }, confidence: { color: colors.muted, fontSize: 8 }, confidenceDots: { flexDirection: "row", gap: 1 }
});
