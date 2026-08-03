import {
  canonicalAcmeFixtures,
  parseInteractiveObject,
  type CompanyComparisonObject,
  type CompanyProfileObject,
  type EvidenceCollectionObject,
  type IcpScoreObject,
  type InteractiveObject,
  type InteractionPromptObject,
  type OpportunityObject,
  type WorkflowProgressObject,
} from "@gtm/contracts";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { startDomainResearch } from "./conversation-client";
import type { ConversationExportFormat, ConversationExportService } from "./conversation-export-client";
import type { ConversationMessage } from "./conversation-workspace-client";
import type { DocumentUploadService, UploadableDocument, UploadedDocument } from "./document-upload-service";
import { applyInteractiveObjectAction } from "./interactive-object-client";
import { saveSellerProfile } from "./seller-profile-client";

type ConversationState = "empty" | "onboarding" | "progress" | "assessment";
type SymbolName = SymbolViewProps["name"];
type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];
type ProgressCardData = Omit<WorkflowProgressObject, "steps"> & { steps: readonly WorkflowProgressObject["steps"][number][] };
type EvidenceDrawerData = Omit<EvidenceCollectionObject, "items"> & { items: readonly EvidenceCollectionObject["items"][number][] };
type TimelineTurn = { id: string; role: "user" | "assistant"; text: string; domains: string[]; queuePosition?: number; status?: "queued" | "running" | "completed" | "failed" };

const colors = { navy: "#071A45", ink: "#101828", muted: "#667085", line: "#E4E7EC", green: "#16A34A", blue: "#1264F4", soft: "#F3F4F6", white: "#FFFFFF" } as const;
const materialIconAliases: Partial<Record<string, MaterialIconName>> = {
  hourglass: "hourglass-empty",
};
const factIcons: SymbolName[] = [
  { ios: "briefcase", android: "business_center" },
  { ios: "calendar", android: "calendar_today" },
  { ios: "bolt", android: "bolt" },
  { ios: "person.2", android: "groups" },
];

function Icon({ name, size = 18, color = colors.navy }: { name: SymbolName; size?: number; color?: string }) {
  if (Platform.OS === "web") {
    const normalizedName = typeof name === "object" && "android" in name && name.android
      ? name.android.replaceAll("_", "-")
      : "help-outline";
    const materialName = materialIconAliases[normalizedName] ?? normalizedName as MaterialIconName;
    return <MaterialIcons name={materialName} size={size} color={color} />;
  }
  return <SymbolView name={name} size={size} tintColor={color} />;
}

function Header({ onDebug, warningCount = 0 }: { onDebug?: () => void; warningCount?: number }) {
  return <View style={styles.header}>
    <Pressable accessibilityRole="button" accessibilityLabel="Open menu" style={styles.headerButton}><Icon name={{ ios: "line.3.horizontal", android: "menu" }} size={20} /></Pressable>
    <View style={styles.agentMark}><Icon name={{ ios: "sparkles", android: "auto_awesome" }} color={colors.white} size={18} /></View>
    <View style={styles.headerCopy}><Text style={styles.headerTitle}>GTM Research Agent</Text><Text style={styles.headerSubtitle}>Conversational research for freelancers</Text></View>
    {onDebug ? <Pressable accessibilityRole="button" accessibilityLabel="Open debug panel" onPress={onDebug} style={styles.headerButton}>
      <Icon name={{ ios: "ladybug", android: "bug_report" }} size={18} />
      {warningCount > 0 ? <View accessible accessibilityLabel={`${warningCount} debug warnings`} style={styles.debugWarningBadge}><Text style={styles.debugWarningBadgeText}>{warningCount > 9 ? "9+" : warningCount}</Text></View> : null}
    </Pressable> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Research settings" style={styles.headerButton}><Icon name={{ ios: "slider.horizontal.3", android: "tune" }} size={19} /></Pressable>
  </View>;
}

function UserMessage({ message = "Analyze acme.ai" }: { message?: string }) {
  return <View style={styles.userRow}><View style={styles.userBubble}><Text style={styles.userText}>{message}</Text><Text style={styles.userTime}>9:41 AM  Sent</Text></View></View>;
}

function AssistantHistoryMessage({ message }: { message: string }) {
  return <View style={styles.agentRow}><AgentAvatar /><View testID="agent-response" accessible accessibilityLabel="Agent response" style={[styles.assistantBubble, styles.historyAssistantBubble]}><Text style={styles.assistantText}>{message}</Text></View></View>;
}

function EmptyConversation() {
  return <View style={styles.emptyConversation}>
    <View style={styles.emptyIcon}><Icon name={{ ios: "sparkles", android: "auto_awesome" }} color={colors.blue} size={24} /></View>
    <Text style={styles.emptyTitle}>Start a new GTM conversation</Text>
    <Text style={styles.emptyDescription}>Ask me to analyze a company domain, compare startups, or explore an opportunity.</Text>
  </View>;
}

function initialTimeline(messages: ConversationMessage[]): TimelineTurn[] {
  return messages.flatMap((message) => {
    const text = typeof message.content.text === "string" ? message.content.text.trim() : "";
    if (!text || (message.role !== "user" && message.role !== "assistant")) return [];
    const domains = Array.isArray(message.content.domains)
      ? message.content.domains.filter((domain): domain is string => typeof domain === "string")
      : [];
    return [{ id: message.id, role: message.role, text, domains }];
  });
}

function AgentAvatar() {
  return <View style={styles.avatar}><Icon name={{ ios: "point.3.connected.trianglepath.dotted", android: "hub" }} color={colors.white} size={14} /></View>;
}

type DebugSnapshot = {
  apiStatus: string;
  authStatus: string;
  conversationId: string;
  runId: string;
  queuePosition: string;
  phase: string;
  messageCount: number;
  interactiveObjectCount: number;
  interactiveObjectSummary: string;
  attachmentCount: number;
  lastResponseKind: string;
  usedTools: string;
  warnings: string[];
};

function DebugPanel({ snapshot, onClose }: { snapshot: DebugSnapshot; onClose(): void }) {
  const rows: [string, string | number][] = [
    ["API", snapshot.apiStatus],
    ["Auth", snapshot.authStatus],
    ["Conversation", snapshot.conversationId],
    ["Run", snapshot.runId],
    ["Queue position", snapshot.queuePosition],
    ["Agent phase", snapshot.phase],
    ["Messages", snapshot.messageCount],
    ["Interactive objects", snapshot.interactiveObjectCount],
    ["Object types", snapshot.interactiveObjectSummary],
    ["Attachments", snapshot.attachmentCount],
    ["Last response", snapshot.lastResponseKind],
    ["Tools", snapshot.usedTools],
  ];
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.debugModalRoot}>
      <Pressable accessibilityLabel="Close debug panel" onPress={onClose} style={styles.debugScrim} />
      <View style={styles.debugPanel}>
        <View style={styles.debugHeader}>
          <View><Text style={styles.debugEyebrow}>DEVELOPMENT ONLY</Text><Text style={styles.debugTitle}>Runtime diagnostics</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close debug panel" onPress={onClose} style={styles.closeButton}><Icon name={{ ios: "xmark", android: "close" }} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.debugBody}>
          {rows.map(([label, value]) => <View key={label} style={styles.debugRow}><Text style={styles.debugLabel}>{label}</Text><Text selectable style={styles.debugValue}>{value}</Text></View>)}
          <Text style={styles.debugWarningTitle}>Bug warnings</Text>
          {snapshot.warnings.length > 0
            ? snapshot.warnings.map((warning) => <View key={warning} style={styles.debugWarning}><Icon name={{ ios: "exclamationmark.triangle", android: "warning" }} size={15} color="#B54708" /><Text style={styles.debugWarningText}>{warning}</Text></View>)
            : <Text style={styles.debugHealthy}>No runtime warnings detected.</Text>}
          <Text style={styles.debugPrivacy}>Secrets, access tokens, document contents, and private prompt text are intentionally excluded.</Text>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

function MovingEllipsis({ accessibilityLabel }: { accessibilityLabel: string }) {
  const [dots] = useState(() => [new Animated.Value(0.28), new Animated.Value(0.28), new Animated.Value(0.28)]);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      dots.forEach((dot) => dot.setValue(1));
      return;
    }
    const animation = Animated.loop(Animated.stagger(140, dots.map((dot) => Animated.sequence([
      Animated.timing(dot, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.timing(dot, { toValue: 0.28, duration: 260, useNativeDriver: true }),
    ]))));
    animation.start();
    return () => animation.stop();
  }, [dots, reduceMotion]);

  return <View accessible accessibilityLabel={accessibilityLabel} style={styles.movingEllipsis}>
    {dots.map((opacity, index) => <Animated.Text accessible={false} key={index} style={[styles.movingDot, { opacity }]}>.</Animated.Text>)}
  </View>;
}

function WaitingForAgent({ queuePosition }: { queuePosition?: number }) {
  const queued = queuePosition !== undefined && queuePosition > 1;
  return <View testID="waiting-agent-response" style={styles.waitingRow}>
    <AgentAvatar />
    <View style={styles.waitingBubble}>
      <Text style={styles.waitingLabel}>{queued ? `Queued · position ${queuePosition}` : "Agent is working"}</Text>
      <MovingEllipsis accessibilityLabel="Waiting for agent response" />
    </View>
  </View>;
}

function ProgressCard({
  progress = canonicalAcmeFixtures.progress,
  acknowledgement,
}: {
  progress?: ProgressCardData;
  acknowledgement?: string;
}) {
  return <View style={styles.agentRow}><AgentAvatar /><View style={styles.agentBody}>
    {acknowledgement ? <View accessible accessibilityLabel="Agent response" style={[styles.assistantBubble, styles.progressAcknowledgement]}><Text style={styles.assistantText}>{acknowledgement}</Text><Text style={styles.assistantTime}>9:41 AM</Text></View> : null}
    <View testID="workflow-progress" accessible accessibilityLabel="Workflow progress" style={styles.progressCard}>
      <View style={styles.progressHeader}><Text style={styles.progressTitle}>{progress.title}</Text><View style={styles.liveGroup}><Icon name={{ ios: "circle.fill", android: "radio_button_checked" }} color={colors.green} size={10} /><Text style={styles.liveLabel}>Live</Text></View></View>
      {progress.steps.map((step) => {
        const complete = step.status === "completed";
        const running = step.status === "running";
        return <View key={step.id} style={styles.progressStep}>
          <Icon name={complete ? { ios: "checkmark.circle.fill", android: "check_circle" } : running ? { ios: "hourglass.circle", android: "hourglass_empty" } : { ios: "circle", android: "circle" }} color={complete ? colors.green : running ? colors.blue : "#D4D8DF"} size={18} />
          <View style={styles.stepIdentity}><Text style={styles.stepLabel}>{step.label}</Text><Text style={styles.stepAgentName}> · {step.agent}</Text></View>
          <View style={styles.stepStatusGroup}><Text style={[styles.stepStatus, running && styles.stepStatusRunning]}>{running ? "In progress" : complete ? "Done" : "Pending"}</Text>{running ? <MovingEllipsis accessibilityLabel="Research phase in progress" /> : null}</View>
        </View>;
      })}
    </View><Text style={styles.messageTime}>9:43 AM</Text>
  </View></View>;
}

function ProsCons({ pros, cons }: { pros: readonly string[]; cons: readonly string[] }) {
  return <View style={styles.prosCons}>
    <View style={styles.prosColumn}><Text style={styles.prosTitle}>Pros</Text>{pros.map((item) => <View key={item} style={styles.listItem}><Icon name={{ ios: "checkmark", android: "check_circle" }} color={colors.green} size={10} /><Text style={styles.listText}>{item}</Text></View>)}</View>
    <View style={styles.prosColumn}><Text style={styles.consTitle}>Cons</Text>{cons.map((item) => <View key={item} style={styles.listItem}><Icon name={{ ios: "xmark", android: "cancel" }} color="#DC2626" size={10} /><Text style={styles.listText}>{item}</Text></View>)}</View>
  </View>;
}

function ConfidenceDots({ value }: { value: number }) {
  return <View style={styles.confidenceDots}>{Array.from({ length: 5 }, (_, index) => <Icon key={index} name={index < value ? { ios: "circle.fill", android: "radio_button_checked" } : { ios: "circle", android: "radio_button_unchecked" }} color={index < value ? colors.green : "#D5D9DF"} size={8} />)}</View>;
}

function AssessmentCard({
  assessment,
  onEvidence,
  onChallenge,
  onShortlist,
  shortlisting,
  shortlisted,
}: {
  assessment?: {
    company: string;
    domain: string;
    summary: string;
    icpScore: number;
    facts: readonly string[];
    pros: readonly string[];
    cons: readonly string[];
    opportunity: { title: string; summary: string; impact: "low" | "medium" | "high"; value: "low" | "medium" | "high"; effort: "low" | "medium" | "high"; fit: "low" | "medium" | "high" };
  };
  onEvidence: () => void;
  onChallenge?: () => void;
  onShortlist: () => void;
  shortlisting: boolean;
  shortlisted: boolean;
}) {
  const view = assessment ?? {
    ...canonicalAcmeFixtures.assessment,
    facts: [
      canonicalAcmeFixtures.assessment.facts.businessModel,
      String(canonicalAcmeFixtures.assessment.facts.founded),
      canonicalAcmeFixtures.assessment.facts.fundingStage,
      canonicalAcmeFixtures.assessment.facts.employeeRange,
    ],
  };
  return <View style={styles.agentRow}><AgentAvatar /><View style={styles.agentBody}>
    <View style={[styles.assistantBubble, styles.compactBubble]}><Text style={styles.assistantText}>Here’s what I found about {view.company}.</Text><Text style={styles.assistantTime}>9:41 AM</Text></View>
    <View style={styles.companyCard}>
      <View style={styles.companyHeader}>
        <View style={styles.logo}><Text style={styles.logoText}>{view.company.toLowerCase()}</Text></View>
        <View style={styles.companyIdentity}><Text style={styles.companyName}>{view.company}</Text><View style={styles.domainRow}><Text style={styles.domain}>{view.domain}</Text><Icon name={{ ios: "arrow.up.right.square", android: "open_in_new" }} color={colors.blue} size={11} /></View></View>
        <View style={styles.scorePill}><Text style={styles.scoreLabel}>ICP fit</Text><Text style={styles.score}>{view.icpScore}</Text></View>
      </View>
      <Text style={styles.summary}>{view.summary}</Text>
      <View style={styles.factsRow}>{view.facts.map((fact, index) => <View key={fact} style={styles.factItem}><Icon name={factIcons[index] ?? { ios: "circle", android: "circle" }} size={11} color="#344054" /><Text style={styles.fact}>{fact}</Text></View>)}</View>
      <ProsCons pros={view.pros} cons={view.cons} />
      <View style={styles.opportunityCard}>
        <View style={styles.opportunityIcon}><Icon name={{ ios: "cpu", android: "smart_toy" }} color={colors.white} size={22} /></View>
        <View style={styles.opportunityBody}>
          <View style={styles.opportunityTitleRow}><Text style={styles.opportunityTitle}>{view.opportunity.title}</Text><Text style={styles.impactPill}>{`${view.opportunity.impact[0]!.toUpperCase()}${view.opportunity.impact.slice(1)} impact`}</Text></View>
          <Text style={styles.opportunitySummary}>{view.opportunity.summary}</Text>
          <View style={styles.metrics}><Text style={styles.metric}>Value{`\n`}<Text style={styles.metricGreen}>{`${view.opportunity.value[0]!.toUpperCase()}${view.opportunity.value.slice(1)}`}</Text></Text><Text style={styles.metric}>Effort{`\n`}<Text style={styles.metricBlue}>{`${view.opportunity.effort[0]!.toUpperCase()}${view.opportunity.effort.slice(1)}`}</Text></Text><Text style={styles.metric}>Fit{`\n`}<Text style={styles.metricGreen}>{`${view.opportunity.fit[0]!.toUpperCase()}${view.opportunity.fit.slice(1)}`}</Text></Text></View>
        </View><View style={styles.opportunityChevron}><Icon name={{ ios: "chevron.right", android: "chevron_right" }} size={15} /></View>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Evidence" style={styles.actionButton} onPress={onEvidence}><Icon name={{ ios: "doc.text", android: "description" }} size={13} /><Text style={styles.actionText}>Evidence</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Challenge" style={styles.actionButton} onPress={onChallenge}><Icon name={{ ios: "questionmark.circle", android: "help_outline" }} size={13} /><Text style={styles.actionText}>Challenge</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={shortlisted ? "Shortlisted" : "Shortlist"} disabled={shortlisting || shortlisted} onPress={onShortlist} style={styles.shortlistButton}><Icon name={{ ios: "star", android: "star" }} color={colors.white} size={13} /><Text style={styles.shortlistText}>{shortlisting ? "Saving…" : shortlisted ? "Shortlisted" : "Shortlist"}</Text></Pressable>
      </View>
    </View><Text style={styles.messageTime}>9:43 AM</Text>
  </View></View>;
}

function ProfileCard({ profile }: { profile: CompanyProfileObject }) {
  return <View style={styles.agentRow}><AgentAvatar /><View style={styles.agentBody}><View style={styles.companyCard}>
    <View style={styles.companyHeader}><View style={styles.logo}><Text style={styles.logoText}>{profile.company.toLowerCase()}</Text></View><View style={styles.companyIdentity}><Text style={styles.companyName}>{profile.company}</Text><Text style={styles.domain}>{profile.domain}</Text></View></View>
    <Text style={styles.summary}>{profile.summary}</Text>
    <View style={styles.factsRow}>{profile.facts.map((fact) => <Text key={`${fact.label}-${fact.value}`} style={styles.fact}>{fact.value}</Text>)}</View>
    <ProsCons pros={profile.pros} cons={profile.cons} />
  </View></View></View>;
}

function IcpCard({ score }: { score: IcpScoreObject }) {
  return <View style={styles.agentRow}><AgentAvatar /><View style={styles.agentBody}><View style={styles.companyCard}>
    <View style={styles.companyHeader}><View style={styles.companyIdentity}><Text style={styles.companyName}>{score.company} ICP assessment</Text><Text style={styles.domain}>{score.band} fit</Text></View><View style={styles.scorePill}><Text style={styles.scoreLabel}>ICP fit</Text><Text style={styles.score}>{score.score}</Text></View></View>
    <ProsCons pros={score.reasons} cons={score.gaps} />
  </View></View></View>;
}

function OpportunityCard({ opportunity }: { opportunity: OpportunityObject }) {
  return <View style={styles.agentRow}><AgentAvatar /><View style={styles.agentBody}>
    <View style={[styles.assistantBubble, styles.compactBubble]}><Text style={styles.assistantText}>Here’s what I found about {opportunity.company}.</Text></View>
    <View style={styles.companyCard}>
    <View style={styles.opportunityCard}><View style={styles.opportunityIcon}><Icon name={{ ios: "cpu", android: "smart_toy" }} color={colors.white} size={22} /></View><View style={styles.opportunityBody}>
      <View style={styles.opportunityTitleRow}><Text style={styles.opportunityTitle}>{opportunity.title}</Text><Text style={styles.impactPill}>{opportunity.status === "pursue" ? "Shortlisted" : opportunity.status}</Text></View>
      <Text style={styles.opportunitySummary}>{opportunity.summary}</Text>
      <View style={styles.metrics}><Text style={styles.metric}>Value{`\n`}<Text style={styles.metricGreen}>{opportunity.value}</Text></Text><Text style={styles.metric}>Effort{`\n`}<Text style={styles.metricBlue}>{opportunity.effort}</Text></Text><Text style={styles.metric}>Fit{`\n`}<Text style={styles.metricGreen}>{opportunity.fit}</Text></Text></View>
    </View></View>
  </View></View></View>;
}

function ComparisonCard({ comparison, exporting, onExport }: { comparison: CompanyComparisonObject; exporting: boolean; onExport: (format: ConversationExportFormat) => void }) {
  return <View style={styles.agentRow}><AgentAvatar /><View style={styles.agentBody}><View style={styles.companyCard}>
    <Text style={styles.companyName}>{comparison.title}</Text>
    {comparison.entries.slice().sort((left, right) => left.rank - right.rank).map((entry) => <View key={`${entry.rank}-${entry.domain}`} style={styles.comparisonEntry}>
      <View style={styles.comparisonRank}><Text style={styles.comparisonRankText}>{entry.rank}</Text></View>
      <View style={styles.companyIdentity}><Text style={styles.opportunityTitle}>{entry.company}</Text><Text style={styles.domain}>{entry.domain}</Text><Text style={styles.opportunitySummary}>{entry.rationale}</Text></View>
      <View style={styles.scorePill}><Text style={styles.score}>{entry.score}</Text></View>
    </View>)}
    {comparison.failures?.length ? <View style={styles.comparisonFailures}>
      <View style={styles.comparisonFailureHeading}><Icon name={{ ios: "exclamationmark.triangle", android: "warning" }} size={15} color="#B54708" /><Text style={styles.comparisonFailureTitle}>{comparison.failures.length} target{comparison.failures.length === 1 ? "" : "s"} could not be analyzed</Text></View>
      {comparison.failures.map((failure) => <View key={failure.domain} style={styles.comparisonFailureEntry}><Text style={styles.comparisonFailureDomain}>{failure.domain}</Text><Text style={styles.comparisonFailureReason}>{failure.reason}</Text></View>)}
    </View> : null}
    <View style={styles.comparisonActions}>
      <Pressable accessibilityRole="button" accessibilityLabel="Export comparison as Markdown" disabled={exporting} onPress={() => onExport("markdown")} style={styles.actionButton}><Text style={styles.actionText}>{exporting ? "Preparing…" : "Export Markdown"}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Export comparison as JSON" disabled={exporting} onPress={() => onExport("json")} style={styles.actionButton}><Text style={styles.actionText}>{exporting ? "Preparing…" : "Export JSON"}</Text></Pressable>
    </View>
  </View></View></View>;
}

function EvidenceSummaryCard({ evidence, onEvidence }: { evidence: EvidenceCollectionObject; onEvidence: () => void }) {
  return <View style={styles.agentRow}><AgentAvatar /><View style={styles.agentBody}><View style={styles.companyCard}>
    <View style={styles.companyHeader}><View style={styles.companyIdentity}><Text style={styles.companyName}>{evidence.title}</Text><Text style={styles.summary}>{evidence.subtitle}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Evidence" style={styles.actionButtonCompact} onPress={onEvidence}><Text style={styles.actionText}>Open</Text></Pressable></View>
  </View></View></View>;
}

function InteractionPromptCard({ object, onChoose }: { object: InteractionPromptObject; onChoose: (label: string) => void }) {
  return <View style={styles.agentRow}><AgentAvatar /><View style={styles.agentBody}><View style={styles.companyCard}>
    <Text style={styles.companyName}>{object.title}</Text>
    <Text style={styles.summary}>{object.prompt}</Text>
    <View style={styles.promptOptions}>{object.options.map((option) => <Pressable
      key={option.id}
      accessibilityRole="button"
      accessibilityLabel={option.label}
      onPress={() => onChoose(option.label)}
      style={styles.promptOption}
    ><Text style={styles.actionText}>{option.label}</Text>{option.description ? <Text style={styles.promptDescription}>{option.description}</Text> : null}</Pressable>)}</View>
  </View></View></View>;
}

function LiveInteractiveObjects({
  objects,
  onEvidence,
  onChallenge,
  onShortlist,
  shortlisting,
  shortlisted,
  exporting,
  onExport,
  onPromptChoice,
}: {
  objects: InteractiveObject[];
  onEvidence: () => void;
  onChallenge: (opportunity: OpportunityObject) => void;
  onShortlist: () => void;
  shortlisting: boolean;
  shortlisted: boolean;
  exporting: boolean;
  onExport: (format: ConversationExportFormat) => void;
  onPromptChoice: (label: string) => void;
}) {
  const progress = objects.filter((object): object is WorkflowProgressObject => object.type === "workflow_progress");
  const profile = objects.find((object): object is CompanyProfileObject => object.type === "company_profile");
  const score = objects.find((object): object is IcpScoreObject => object.type === "icp_score");
  const opportunities = objects.filter((object): object is OpportunityObject => object.type === "opportunity");
  const evidence = objects.find((object): object is EvidenceCollectionObject => object.type === "evidence_collection");
  const comparisons = objects.filter((object): object is CompanyComparisonObject => object.type === "company_comparison");
  const prompts = objects.filter((object): object is InteractionPromptObject => object.type === "interaction_prompt");
  const primaryOpportunity = opportunities[opportunities.length - 1];
  const hasCombinedAssessment = Boolean(profile && score && primaryOpportunity);
  const combinedAssessment = profile && score && primaryOpportunity ? {
    company: profile.company,
    domain: profile.domain,
    summary: profile.summary,
    icpScore: score.score,
    facts: profile.facts.map((fact) => fact.value),
    pros: profile.pros.length > 0 ? profile.pros : score.reasons,
    cons: profile.cons.length > 0 ? profile.cons : score.gaps,
    opportunity: primaryOpportunity,
  } : undefined;

  return <View style={styles.liveObjects}>
    {progress.map((object) => <ProgressCard key={object.id} progress={object} />)}
    {combinedAssessment && primaryOpportunity ? <AssessmentCard
      assessment={combinedAssessment}
      onEvidence={onEvidence}
      onChallenge={() => onChallenge(primaryOpportunity)}
      onShortlist={onShortlist}
      shortlisting={shortlisting}
      shortlisted={shortlisted}
    /> : null}
    {!hasCombinedAssessment && profile ? <ProfileCard profile={profile} /> : null}
    {!hasCombinedAssessment && score ? <IcpCard score={score} /> : null}
    {(hasCombinedAssessment ? opportunities.slice(0, -1) : opportunities).map((opportunity) => <OpportunityCard key={opportunity.id} opportunity={opportunity} />)}
    {!hasCombinedAssessment && evidence ? <EvidenceSummaryCard evidence={evidence} onEvidence={onEvidence} /> : null}
    {comparisons.map((comparison) => <ComparisonCard key={comparison.id} comparison={comparison} exporting={exporting} onExport={onExport} />)}
    {prompts.map((object) => <InteractionPromptCard key={object.id} object={object} onChoose={onPromptChoice} />)}
  </View>;
}

function Composer({ value = "", onChangeText, onSend, onAttach, disabled = false, attaching = false, placeholder = "Ask anything about your market or ideal customers…" }: {
  value?: string;
  onChangeText?: (value: string) => void;
  onSend?: () => void;
  onAttach?: () => void;
  disabled?: boolean;
  attaching?: boolean;
  placeholder?: string;
}) {
  return <View style={styles.composer}>
    <Pressable accessibilityRole="button" accessibilityLabel={attaching ? "Attaching source" : "Attach source"} disabled={disabled || attaching} onPress={onAttach} style={styles.attachButton}><Icon name={{ ios: "link", android: "link" }} size={17} /></Pressable>
    <TextInput testID="message-composer" accessibilityLabel="Message GTM Research Agent" placeholder={placeholder} placeholderTextColor="#98A2B3" multiline returnKeyType="send" submitBehavior="submit" onSubmitEditing={onSend} style={styles.input} value={value} onChangeText={onChangeText} editable={!disabled} />
    <Pressable accessibilityRole="button" accessibilityLabel="Send message" style={styles.sendButton} onPress={onSend} disabled={disabled}><Icon name={{ ios: "paperplane.fill", android: "send" }} color={colors.white} size={16} /></Pressable>
  </View>;
}

const onboardingPrompts = [
  "Before we research companies, what should I call your business?",
  "What AI or agent automation work do you sell?",
  "List your strongest capabilities, separated by commas.",
  "What proof points should I use when positioning you?",
  "Your seller profile is saved. Which company should we analyze first?",
] as const;

function OnboardingConversation({ answers, step }: { answers: string[]; step: number }) {
  return <>
    {answers.map((answer, index) => <View key={`${index}-${answer}`} style={styles.onboardingExchange}>
      <View style={styles.agentRow}><AgentAvatar /><View style={styles.agentBody}><View style={styles.assistantBubble}><Text style={styles.assistantText}>{onboardingPrompts[index]}</Text></View></View></View>
      <UserMessage message={answer} />
    </View>)}
    <View style={styles.agentRow}><AgentAvatar /><View style={styles.agentBody}><View style={styles.assistantBubble}><Text style={styles.assistantText}>{onboardingPrompts[step]}</Text></View></View></View>
  </>;
}

function EvidenceDrawer({ evidence, onClose }: { evidence: EvidenceDrawerData; onClose: () => void }) {
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalRoot}>
    <Pressable style={styles.scrim} accessibilityRole="button" accessibilityLabel="Dismiss evidence" onPress={onClose} />
    <SafeAreaView style={styles.sheet}>
      <View style={styles.handle} />
      <View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>{evidence.title}</Text><Text style={styles.sheetSubtitle}>{evidence.subtitle}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close evidence" onPress={onClose} style={styles.closeButton}><Icon name={{ ios: "xmark", android: "close" }} size={18} /></Pressable></View>
      <ScrollView contentContainerStyle={styles.evidenceList}>{evidence.items.map((item, index) => <View key={item.id} style={styles.evidenceCard}>
        <View style={[styles.sourceIcon, index === 1 ? styles.sourceGreen : index === 2 ? styles.sourceViolet : styles.sourceBlue]}><Icon name={index === 0 ? { ios: "globe", android: "public" } : { ios: "doc.text", android: "description" }} color={index === 1 ? colors.green : index === 2 ? "#6D28B7" : "#2375ED"} size={23} /></View>
        <View style={styles.sourceBody}><Text style={styles.sourceTitle}>{item.title}</Text><Text style={styles.sourceUrl}>{item.url}</Text><Text style={styles.sourceExcerpt}>{item.excerpt}</Text></View>
        <View style={styles.sourceMeta}><Text style={[styles.classification, item.classification === "fact" ? styles.factClass : styles.inferenceClass]}>{item.classification[0]!.toUpperCase()}{item.classification.slice(1)}</Text><View style={styles.confidenceGroup}><Text style={styles.confidence}>Confidence</Text><ConfidenceDots value={item.confidence} /></View></View>
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
  initialState = "empty",
  apiBaseUrl,
  accessToken,
  conversationId = "11111111-1111-4111-8111-111111111111",
  initialMessages = [],
  interactiveObjects = [],
  documentPicker,
  documentUploadService,
  conversationExportService,
  onOnboardingComplete,
  debugEnabled = __DEV__,
  initialEvidenceOpen = false,
  fetcher = fetch,
}: {
  initialState?: ConversationState;
  apiBaseUrl?: string;
  accessToken?: string;
  conversationId?: string;
  initialMessages?: ConversationMessage[];
  interactiveObjects?: InteractiveObject[];
  documentPicker?: { pick(): Promise<UploadableDocument | undefined> };
  documentUploadService?: DocumentUploadService;
  conversationExportService?: ConversationExportService;
  onOnboardingComplete?: () => void;
  debugEnabled?: boolean;
  initialEvidenceOpen?: boolean;
  fetcher?: typeof fetch;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(initialEvidenceOpen);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState(initialState === "progress" || initialState === "assessment" ? "Analyze acme.ai" : "");
  const [timeline, setTimeline] = useState<TimelineTurn[]>(() => initialTimeline(initialMessages));
  const [turnObjects, setTurnObjects] = useState<InteractiveObject[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlight = useRef(false);
  const [pendingRequest, setPendingRequest] = useState<{ runId: string; queuePosition?: number; baselineVersion: number }>();
  const [error, setError] = useState<string>();
  const [debugOpen, setDebugOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingAnswers, setOnboardingAnswers] = useState<string[]>([]);
  const [objectVersion, setObjectVersion] = useState<number>(canonicalAcmeFixtures.assessment.version);
  const [shortlisting, setShortlisting] = useState(false);
  const [shortlisted, setShortlisted] = useState(false);
  const [attachedDocuments, setAttachedDocuments] = useState<UploadedDocument[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState<"challenge" | "correct">();
  const [exporting, setExporting] = useState(false);
  const [lastTurnDiagnostics, setLastTurnDiagnostics] = useState<{ kind: string; usedTools: string[] }>({
    kind: "None",
    usedTools: [],
  });
  const receivedInteractiveObjects = [...interactiveObjects, ...turnObjects];
  const allInteractiveObjects = receivedInteractiveObjects
    .filter((object, index, objects) => objects.findIndex((candidate) => candidate.id === object.id) === index);
  const liveOpportunities = allInteractiveObjects.filter((object): object is OpportunityObject => object.type === "opportunity");
  const liveOpportunity = liveOpportunities[liveOpportunities.length - 1];
  const liveProgress = allInteractiveObjects.find((object): object is WorkflowProgressObject => object.type === "workflow_progress");
  const liveEvidence = allInteractiveObjects.find((object): object is EvidenceCollectionObject => object.type === "evidence_collection");
  const activeEvidence = liveEvidence ?? canonicalAcmeFixtures.evidence;
  const isShortlisted = shortlisted || liveOpportunity?.status === "pursue";
  const hasNewTerminalAgentOutput = pendingRequest !== undefined && allInteractiveObjects.some((object) => (
    object.type !== "workflow_progress" && object.version > pendingRequest.baselineVersion
  ));
  const showWaitingForAgent = submitting || (pendingRequest !== undefined && !hasNewTerminalAgentOutput)
    || Boolean(liveProgress?.live);
  const completedTimelineTurnId = hasNewTerminalAgentOutput
    ? timeline.find((turn) => turn.status === "queued" || turn.status === "running")?.id
    : undefined;
  const timelineHasWaiting = timeline.some((turn) => (
    turn.id !== completedTimelineTurnId && (turn.status === "queued" || turn.status === "running")
  ));
  const activePhase = liveProgress?.steps.find((step) => step.status === "running")?.label
    ?? (pendingRequest ? "Waiting for workflow progress" : "Idle");
  const duplicateObjectIds = [...new Set(receivedInteractiveObjects
    .filter((object, index, objects) => objects.findIndex((candidate) => candidate.id === object.id) !== index)
    .map((object) => object.id))];
  const foreignObjectCount = receivedInteractiveObjects.filter((object) => object.conversationId !== conversationId).length;
  const interactiveObjectSummary = Object.entries(allInteractiveObjects.reduce<Record<string, number>>((summary, object) => ({
    ...summary,
    [object.type]: (summary[object.type] ?? 0) + 1,
  }), {})).map(([type, count]) => `${type}: ${count}`).join(", ") || "None";
  const debugWarnings = [
    ...(!apiBaseUrl ? ["API base URL is missing."] : []),
    ...(!accessToken ? ["No authenticated session is available."] : []),
    ...(pendingRequest && !liveProgress ? ["Waiting for first workflow progress event."] : []),
    ...(pendingRequest?.queuePosition !== undefined && pendingRequest.queuePosition < 1 ? ["Queue position must be 1 or greater."] : []),
    ...(duplicateObjectIds.length > 0 ? [`Duplicate interactive-object IDs detected: ${duplicateObjectIds.join(", ")}.`] : []),
    ...(foreignObjectCount > 0 ? [`${foreignObjectCount} interactive object${foreignObjectCount === 1 ? "" : "s"} belongs to another conversation.`] : []),
    ...(liveProgress?.live && !liveProgress.steps.some((step) => step.status === "running") ? ["Workflow is marked live but no phase is running."] : []),
    ...(error ? [`Latest runtime error: ${error}`] : []),
  ];
  const debugSnapshot: DebugSnapshot = {
    apiStatus: apiBaseUrl ? "Configured" : "API not configured",
    authStatus: accessToken ? "Signed in" : "Signed out",
    conversationId,
    runId: pendingRequest?.runId ?? "None",
    queuePosition: pendingRequest?.queuePosition?.toString() ?? "None",
    phase: activePhase,
    messageCount: timeline.length,
    interactiveObjectCount: allInteractiveObjects.length,
    interactiveObjectSummary,
    attachmentCount: attachedDocuments.length,
    lastResponseKind: lastTurnDiagnostics.kind,
    usedTools: lastTurnDiagnostics.usedTools.join(", ") || "None reported",
    warnings: debugWarnings,
  };
  const challenge = (opportunity: OpportunityObject) => {
    setFeedbackMode("challenge");
    setDraft("");
    setError(undefined);
  };
  const exportConversation = async (format: ConversationExportFormat) => {
    if (!conversationExportService) {
      setError("Conversation export is not available on this device.");
      return;
    }
    setExporting(true);
    setError(undefined);
    try {
      await conversationExportService.export(format);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to export this comparison");
    } finally {
      setExporting(false);
    }
  };
  const shortlist = async () => {
    if (!apiBaseUrl || !accessToken) {
      setError("Connect the API and sign in to shortlist this opportunity.");
      return;
    }
    setShortlisting(true);
    setError(undefined);
    try {
      const result = await applyInteractiveObjectAction({
        apiBaseUrl,
        accessToken,
        objectId: liveOpportunity?.id ?? canonicalAcmeFixtures.assessment.id,
        action: "shortlist",
        expectedVersion: Math.max(liveOpportunity?.version ?? 0, objectVersion),
        payload: {},
        fetcher,
      });
      setObjectVersion(result.version);
      setShortlisted(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to shortlist this opportunity");
    } finally {
      setShortlisting(false);
    }
  };
  const attachDocument = async () => {
    if (!documentPicker || !documentUploadService) {
      setError("Document upload is not available on this device.");
      return;
    }
    if (attachedDocuments.length >= 10) {
      setError("Attach no more than 10 documents to one research request.");
      return;
    }
    setAttaching(true);
    setError(undefined);
    try {
      const file = await documentPicker.pick();
      if (!file) return;
      const uploaded = await documentUploadService.upload({ conversationId, file });
      setAttachedDocuments((current) => [...current, uploaded]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to attach this document");
    } finally {
      setAttaching(false);
    }
  };
  const submit = async () => {
    const trimmed = draft.trim();
    if (initialState === "onboarding") {
      if (!trimmed) {
        setError("Write a short answer before continuing.");
        return;
      }
      if (onboardingStep >= 4) {
        setMessage(trimmed);
        setDraft("");
        return;
      }
      const answers = [...onboardingAnswers, trimmed];
      setOnboardingAnswers(answers);
      setDraft("");
      setError(undefined);
      if (onboardingStep < 3) {
        setOnboardingStep(onboardingStep + 1);
        return;
      }
      if (!apiBaseUrl || !accessToken) {
        setError("Connect the API and sign in to save your seller profile.");
        return;
      }
      if (submissionInFlight.current) return;
      submissionInFlight.current = true;
      setSubmitting(true);
      try {
        await saveSellerProfile({
          apiBaseUrl,
          accessToken,
          fetcher,
          profile: {
            businessName: answers[0]!,
            offerSummary: answers[1]!,
            capabilities: answers[2]!.split(",").map((item) => item.trim()).filter(Boolean),
            proofPoints: answers[3]!.split(",").map((item) => item.trim()).filter(Boolean),
            constraints: { externalWritesRequireApproval: true },
          },
        });
        setOnboardingStep(4);
        onOnboardingComplete?.();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to save seller profile");
      } finally {
        submissionInFlight.current = false;
        setSubmitting(false);
      }
      return;
    }
    if (feedbackMode) {
      if (!trimmed) {
        setError(feedbackMode === "correct" ? "Describe the correction before sending." : "Describe what the agent should challenge before sending.");
        return;
      }
      if (!apiBaseUrl || !accessToken || !liveOpportunity) {
        setError("Connect the API and sign in to review this opportunity.");
        return;
      }
      if (submissionInFlight.current) return;
      submissionInFlight.current = true;
      setSubmitting(true);
      setError(undefined);
      try {
        const result = await applyInteractiveObjectAction({
          apiBaseUrl,
          accessToken,
          objectId: liveOpportunity.id,
          action: feedbackMode,
          expectedVersion: Math.max(liveOpportunity.version, objectVersion),
          payload: { message: trimmed },
          fetcher,
        });
        setObjectVersion(result.version);
        setMessage(trimmed);
        setDraft("");
        setFeedbackMode(undefined);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to record this review");
      } finally {
        submissionInFlight.current = false;
        setSubmitting(false);
      }
      return;
    }
    const domains = extractDomains(trimmed);
    if (!trimmed) {
      setError("Write a message before sending.");
      return;
    }
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      const accepted = apiBaseUrl ? await startDomainResearch({
        apiBaseUrl,
        conversationId,
        message: trimmed,
        domains,
        documentIds: attachedDocuments.map((document) => document.id),
        ...(accessToken ? { accessToken } : {}),
        fetcher,
      }) : undefined;
      setMessage(trimmed);
      setDraft("");
      setAttachedDocuments([]);
      setLastTurnDiagnostics({
        kind: accepted?.kind ?? "No API response",
        usedTools: accepted?.usedTools ?? [],
      });
      if (accepted?.interactiveObjects.length) {
        const parsedObjects = accepted.interactiveObjects.flatMap((object) => {
          try {
            return [parseInteractiveObject(object)];
          } catch {
            return [];
          }
        });
        setTurnObjects((current) => [...current, ...parsedObjects]);
      }
      if (accepted?.kind === "research") {
        setPendingRequest({
          runId: accepted.runId,
          queuePosition: accepted.queuePosition,
          baselineVersion: allInteractiveObjects.reduce((highest, object) => Math.max(highest, object.version), 0),
        });
      } else {
        setPendingRequest(undefined);
      }
      const turnId = accepted?.kind === "research" ? accepted.runId : `turn-${Date.now()}`;
      const position = accepted?.kind === "research" ? accepted.queuePosition : undefined;
      setTimeline((current) => [...current,
        { id: `${turnId}-user`, role: "user", text: trimmed, domains },
        ...(accepted?.message ? [{
          id: `${turnId}-assistant`,
          role: "assistant" as const,
          text: accepted.message,
          domains: [],
          status: accepted.kind === "research" ? "queued" as const : "completed" as const,
          queuePosition: position,
        }] : []),
      ]);
    } catch (caught) {
      setLastTurnDiagnostics({ kind: "Error", usedTools: [] });
      setError(caught instanceof Error ? caught.message : "Unable to start research");
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  };
  return <SafeAreaView style={styles.screen}><Header onDebug={debugEnabled ? () => setDebugOpen(true) : undefined} warningCount={debugWarnings.length} /><ScrollView style={styles.scroll} contentContainerStyle={styles.conversation}>
    <Text style={styles.today}>Today</Text>{initialState === "onboarding"
      ? <OnboardingConversation answers={onboardingAnswers} step={onboardingStep} />
      : initialState === "empty" && timeline.length === 0 && interactiveObjects.length === 0
        ? <EmptyConversation />
      : <>{timeline.length > 0
        ? <View style={styles.timeline}>{timeline.map((turn) => <View key={turn.id} style={styles.timelineTurn}>{turn.role === "user" ? <UserMessage message={turn.text} /> : <AssistantHistoryMessage message={turn.text} />}{turn.id !== completedTimelineTurnId && (turn.status === "queued" || turn.status === "running") ? <WaitingForAgent queuePosition={turn.queuePosition} /> : null}</View>)}</View>
        : initialState === "progress" || initialState === "assessment" ? <UserMessage message={message} /> : null}{allInteractiveObjects.length > 0
        ? <LiveInteractiveObjects objects={allInteractiveObjects} onEvidence={() => setEvidenceOpen(true)} onChallenge={challenge} onShortlist={() => void shortlist()} shortlisting={shortlisting} shortlisted={isShortlisted} exporting={exporting} onExport={(format) => void exportConversation(format)} onPromptChoice={(label) => { setDraft(label); setError(undefined); }} />
        : initialState === "progress" ? <ProgressCard acknowledgement="On it. I’ll research Acme and surface high-leverage GTM opportunities." /> : initialState === "assessment" ? <AssessmentCard onEvidence={() => setEvidenceOpen(true)} onShortlist={() => void shortlist()} shortlisting={shortlisting} shortlisted={isShortlisted} /> : null}{showWaitingForAgent && !timelineHasWaiting ? <WaitingForAgent queuePosition={pendingRequest?.queuePosition} /> : null}</>}
    {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
  </ScrollView>{attachedDocuments.length > 0 ? <View style={styles.attachmentTray}>{attachedDocuments.map((document) => <Text key={document.id} style={styles.attachmentLabel}>{document.fileName} attached</Text>)}</View> : null}{feedbackMode ? <View style={styles.feedbackTray}><Text style={styles.feedbackLabel}>Review this recommendation</Text><View style={styles.feedbackModes}><Pressable accessibilityRole="button" accessibilityLabel="Submit challenge" onPress={() => setFeedbackMode("challenge")} style={[styles.feedbackMode, feedbackMode === "challenge" && styles.feedbackModeActive]}><Text style={[styles.feedbackModeText, feedbackMode === "challenge" && styles.feedbackModeTextActive]}>Challenge</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Record correction" onPress={() => setFeedbackMode("correct")} style={[styles.feedbackMode, feedbackMode === "correct" && styles.feedbackModeActive]}><Text style={[styles.feedbackModeText, feedbackMode === "correct" && styles.feedbackModeTextActive]}>Correction</Text></Pressable></View></View> : null}<Composer value={draft} onChangeText={setDraft} onSend={() => void submit()} onAttach={() => void attachDocument()} attaching={attaching} disabled={submitting} placeholder={feedbackMode === "correct" ? "Describe the corrected fact…" : feedbackMode === "challenge" ? "What should the agent re-check?" : initialState === "onboarding" ? "Reply to continue…" : undefined} />{evidenceOpen ? <EvidenceDrawer evidence={activeEvidence} onClose={() => setEvidenceOpen(false)} /> : null}{debugOpen ? <DebugPanel snapshot={debugSnapshot} onClose={() => setDebugOpen(false)} /> : null}</SafeAreaView>;
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
  assistantBubble: { maxWidth: 258, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 10, borderRadius: 17, borderTopLeftRadius: 6, backgroundColor: colors.soft }, compactBubble: { width: "100%", maxWidth: "100%", paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  assistantText: { color: colors.ink, fontSize: 13, lineHeight: 19 }, assistantTime: { color: colors.muted, fontSize: 10, marginTop: 6 }, historyAssistantBubble: { marginBottom: 16 }, timeline: { gap: 2 }, timelineTurn: { gap: 0 },
  emptyConversation: { minHeight: 280, paddingHorizontal: 28, alignItems: "center", justifyContent: "center" }, emptyIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: "#EAF2FF", alignItems: "center", justifyContent: "center", marginBottom: 18 }, emptyTitle: { color: colors.ink, fontSize: 20, fontWeight: "700", textAlign: "center" }, emptyDescription: { maxWidth: 310, color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8 },
  progressAcknowledgement: { marginBottom: 0 }, progressCard: { marginTop: 9, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.white, overflow: "hidden" }, progressHeader: { paddingHorizontal: 14, paddingVertical: 13, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressTitle: { color: colors.ink, fontWeight: "700", fontSize: 15 }, liveGroup: { flexDirection: "row", alignItems: "center", gap: 4 }, liveLabel: { color: colors.muted, fontSize: 11 }, progressStep: { minHeight: 51, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: "#EEF0F3", flexDirection: "row", alignItems: "center", gap: 8 },
  stepIdentity: { flex: 1, flexDirection: "row", alignItems: "center" }, stepLabel: { color: colors.ink, fontSize: 13 }, stepAgentName: { color: colors.ink, fontSize: 13 }, stepStatusGroup: { flexDirection: "row", alignItems: "center", gap: 2 }, stepStatus: { color: colors.muted, fontSize: 11 }, stepStatusRunning: { color: colors.blue }, messageTime: { color: colors.muted, fontSize: 10, marginTop: 6, marginLeft: 12 },
  movingEllipsis: { minWidth: 15, flexDirection: "row", alignItems: "center" }, movingDot: { color: colors.blue, fontSize: 14, fontWeight: "700", lineHeight: 14 },
  waitingRow: { marginTop: 10, flexDirection: "row", alignItems: "flex-start", gap: 8 }, waitingBubble: { minHeight: 38, paddingHorizontal: 13, borderRadius: 16, borderTopLeftRadius: 6, backgroundColor: colors.soft, flexDirection: "row", alignItems: "center", gap: 5 }, waitingLabel: { color: colors.muted, fontSize: 11 },
  companyCard: { minHeight: 530, marginTop: 9, paddingHorizontal: 12, paddingTop: 15, paddingBottom: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 15, backgroundColor: colors.white, justifyContent: "space-between" }, companyHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" }, logoText: { color: colors.white, fontSize: 14, fontWeight: "700" }, companyIdentity: { flex: 1 }, companyName: { color: colors.ink, fontSize: 16, fontWeight: "700" }, domainRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }, domain: { color: colors.blue, fontSize: 12 },
  scorePill: { flexDirection: "row", alignItems: "baseline", gap: 4, paddingHorizontal: 10, paddingVertical: 12, borderRadius: 11, backgroundColor: "#ECF9F0" }, scoreLabel: { color: colors.green, fontSize: 11 }, score: { color: colors.green, fontSize: 19, fontWeight: "700" },
  summary: { maxWidth: 258, color: colors.ink, fontSize: 13, lineHeight: 19, marginVertical: 10 }, factsRow: { paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", justifyContent: "space-between", gap: 6 }, factItem: { flexDirection: "row", alignItems: "center", gap: 3 }, fact: { color: "#344054", fontSize: 10 },
  prosCons: { paddingTop: 11, paddingBottom: 12, flexDirection: "row", gap: 12 }, prosColumn: { flex: 1, gap: 6 }, prosTitle: { color: colors.green, fontSize: 11, fontWeight: "600" }, consTitle: { color: "#DC2626", fontSize: 11, fontWeight: "600" }, listItem: { flexDirection: "row", alignItems: "flex-start", gap: 5 }, listText: { flex: 1, color: colors.ink, fontSize: 10, lineHeight: 13 },
  opportunityCard: { paddingHorizontal: 8, paddingVertical: 13, borderWidth: 1.5, borderColor: "#4C94FF", borderRadius: 12, backgroundColor: "#FBFDFF", flexDirection: "row", alignItems: "flex-start", gap: 10 }, opportunityIcon: { width: 44, height: 44, borderRadius: 11, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" }, opportunityBody: { flex: 1 }, opportunityChevron: { alignSelf: "center" },
  opportunityTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 }, opportunityTitle: { flex: 1, color: colors.ink, fontWeight: "700", fontSize: 14 }, impactPill: { color: colors.green, fontSize: 9, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, backgroundColor: "#E7F8ED" }, opportunitySummary: { color: colors.ink, fontSize: 11, lineHeight: 16, marginTop: 5, marginBottom: 8 },
  metrics: { flexDirection: "row" }, metric: { width: "33.33%", color: "#344054", fontSize: 10, lineHeight: 14 }, metricGreen: { color: colors.green, fontSize: 11 }, metricBlue: { color: colors.blue, fontSize: 11 }, actions: { flexDirection: "row", gap: 7, marginTop: 10 },
  actionButton: { flex: 1, minHeight: 36, borderWidth: 1, borderColor: colors.line, borderRadius: 9, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" }, actionText: { color: colors.ink, fontSize: 11 }, shortlistButton: { flex: 1, minHeight: 36, borderRadius: 9, backgroundColor: colors.navy, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" }, shortlistText: { color: colors.white, fontSize: 11 },
  composer: { marginHorizontal: 14, marginBottom: 8, minHeight: 64, paddingHorizontal: 7, borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", gap: 6 }, attachButton: { width: 34, height: 34, borderWidth: 1, borderColor: colors.line, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  attachmentTray: { marginHorizontal: 18, marginBottom: 5, alignItems: "flex-start" }, attachmentLabel: { color: colors.muted, fontSize: 10, backgroundColor: colors.soft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  feedbackTray: { marginHorizontal: 18, marginBottom: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, feedbackLabel: { color: colors.muted, fontSize: 10 }, feedbackModes: { flexDirection: "row", gap: 4 }, feedbackMode: { minHeight: 28, paddingHorizontal: 9, borderWidth: 1, borderColor: colors.line, borderRadius: 8, alignItems: "center", justifyContent: "center" }, feedbackModeActive: { backgroundColor: colors.navy, borderColor: colors.navy }, feedbackModeText: { color: colors.ink, fontSize: 9 }, feedbackModeTextActive: { color: colors.white },
  input: { flex: 1, minHeight: 46, maxHeight: 88, color: colors.ink, fontSize: 11, lineHeight: 16 }, sendButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  errorText: { color: "#B42318", fontSize: 11, marginBottom: 10, textAlign: "right" },
  liveObjects: { gap: 10 },
  comparisonEntry: { paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row", alignItems: "center", gap: 9 }, comparisonRank: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" }, comparisonRankText: { color: colors.white, fontSize: 10, fontWeight: "700" }, actionButtonCompact: { minWidth: 54, minHeight: 32, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  comparisonFailures: { borderTopWidth: 1, borderTopColor: "#FEDF89", backgroundColor: "#FFFAEB", borderRadius: 10, padding: 10, marginTop: 8, gap: 7 }, comparisonFailureHeading: { flexDirection: "row", alignItems: "center", gap: 6 }, comparisonFailureTitle: { color: "#93370D", fontSize: 12, fontWeight: "700" }, comparisonFailureEntry: { paddingLeft: 21 }, comparisonFailureDomain: { color: colors.ink, fontSize: 12, fontWeight: "700" }, comparisonFailureReason: { color: "#B54708", fontSize: 11, marginTop: 2 },
  comparisonActions: { flexDirection: "row", gap: 6, marginTop: 12 },
  promptOptions: { gap: 7, marginTop: 4 }, promptOption: { minHeight: 42, paddingHorizontal: 11, paddingVertical: 9, borderWidth: 1, borderColor: colors.line, borderRadius: 10, justifyContent: "center" }, promptDescription: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  debugWarningBadge: { position: "absolute", top: 1, right: 1, minWidth: 15, height: 15, paddingHorizontal: 3, borderRadius: 8, backgroundColor: "#D92D20", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.white }, debugWarningBadgeText: { color: colors.white, fontSize: 8, lineHeight: 10, fontWeight: "800" },
  debugModalRoot: { flex: 1, justifyContent: "flex-end" }, debugScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(7,26,69,0.38)" }, debugPanel: { maxHeight: "76%", backgroundColor: "#0B1220", borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden" },
  debugHeader: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: "#263244", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, debugEyebrow: { color: "#84ADFF", fontSize: 9, fontWeight: "700", letterSpacing: 1.2 }, debugTitle: { color: colors.white, fontSize: 20, fontWeight: "700", marginTop: 3 }, debugBody: { padding: 18, gap: 8, paddingBottom: 34 },
  debugRow: { minHeight: 34, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#202B3B", flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }, debugLabel: { color: "#98A2B3", fontSize: 11 }, debugValue: { flex: 1, color: "#E6EDF7", fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 10, textAlign: "right" },
  debugWarningTitle: { color: colors.white, fontSize: 13, fontWeight: "700", marginTop: 10 }, debugWarning: { padding: 10, borderWidth: 1, borderColor: "#7A2E0E", borderRadius: 10, backgroundColor: "#32180C", flexDirection: "row", alignItems: "flex-start", gap: 8 }, debugWarningText: { flex: 1, color: "#FEC84B", fontSize: 10, lineHeight: 15 }, debugHealthy: { color: "#75E0A7", fontSize: 11 }, debugPrivacy: { color: "#667085", fontSize: 9, lineHeight: 14, marginTop: 8 },
  onboardingExchange: { gap: 10, marginBottom: 16 },
  modalRoot: { flex: 1, justifyContent: "flex-end" }, scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(16,24,40,0.44)" }, sheet: { height: "88%", backgroundColor: colors.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden" }, handle: { alignSelf: "center", width: 34, height: 4, marginTop: 8, borderRadius: 2, backgroundColor: "#C9CDD3" },
  sheetHeader: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", justifyContent: "space-between" }, sheetTitle: { color: colors.ink, fontSize: 20, fontWeight: "700" }, sheetSubtitle: { color: colors.muted, fontSize: 12, marginTop: 4 }, closeButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  evidenceList: { padding: 12, gap: 12, paddingBottom: 80 }, evidenceCard: { minHeight: 178, paddingHorizontal: 15, paddingTop: 17, paddingBottom: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 15, flexDirection: "row", flexWrap: "wrap", alignContent: "space-between", gap: 12, backgroundColor: colors.white }, sourceIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" }, sourceBlue: { backgroundColor: "#E9F2FF" }, sourceGreen: { backgroundColor: "#E8F8ED" }, sourceViolet: { backgroundColor: "#F1EAFB" }, sourceBody: { flex: 1 },
  sourceTitle: { color: colors.ink, fontSize: 14, fontWeight: "700", marginTop: 4 }, sourceUrl: { color: colors.blue, fontSize: 12, marginTop: 6 }, sourceExcerpt: { color: "#475467", fontSize: 12, lineHeight: 19, marginTop: 12 }, sourceMeta: { width: "100%", flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }, classification: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, fontSize: 10 }, factClass: { color: colors.green, backgroundColor: "#EBF8EF" }, inferenceClass: { color: "#6D28B7", backgroundColor: "#F5F0FB" }, confidenceGroup: { flexDirection: "row", alignItems: "center", gap: 8 }, confidence: { color: colors.muted, fontSize: 10 }, confidenceDots: { flexDirection: "row" }
});
