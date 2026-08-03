import { parseInteractiveObject, type InteractiveObject } from "@gtm/contracts";

export interface ConversationExport {
  schemaVersion: 1;
  conversationId: string;
  generatedAt: string;
  messages: unknown[];
  interactiveObjects: InteractiveObject[];
}

export function buildConversationExport(input: {
  conversationId: string;
  generatedAt?: string;
  messages: unknown[];
  interactiveObjects: unknown[];
}): ConversationExport {
  return {
    schemaVersion: 1,
    conversationId: input.conversationId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    messages: structuredClone(input.messages),
    interactiveObjects: input.interactiveObjects.map(parseInteractiveObject),
  };
}

function text(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/([*_`[\]])/g, "\\$1").replace(/\r?\n/g, " ").trim();
}

function titleCase(value: string) {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

export function renderConversationMarkdown(exported: ConversationExport) {
  const sections = exported.interactiveObjects.flatMap((object) => {
    switch (object.type) {
      case "workflow_progress":
        return [
          `## ${text(object.title)}`,
          ...object.steps.map((step) => `- ${step.status === "completed" ? "[x]" : "[ ]"} ${text(step.label)} — ${step.agent} — ${step.status}`),
        ].join("\n");
      case "company_profile":
        return [
          `## ${text(object.company)} (${text(object.domain)})`,
          text(object.summary),
          "",
          ...object.facts.map((fact) => `- ${text(fact.label)}: ${text(fact.value)}`),
          "",
          `Pros: ${object.pros.map(text).join("; ") || "None recorded"}`,
          `Cons: ${object.cons.map(text).join("; ") || "None recorded"}`,
        ].join("\n");
      case "icp_score":
        return [
          `## ${text(object.company)} ICP assessment`,
          `ICP score: ${object.score}/100 (${object.band})`,
          `Reasons: ${object.reasons.map(text).join("; ") || "None recorded"}`,
          `Gaps: ${object.gaps.map(text).join("; ") || "None recorded"}`,
        ].join("\n");
      case "opportunity":
        return [
          `### ${text(object.title)}`,
          `${text(object.company)} — ${object.status}`,
          text(object.summary),
          `Impact: ${object.impact} · Value: ${object.value} · Effort: ${object.effort} · Fit: ${object.fit}`,
        ].join("\n");
      case "evidence_collection":
        return [
          `## ${text(object.title)}`,
          text(object.subtitle),
          "",
          ...object.items.map((item) => [
            `### ${text(item.title)}`,
            item.url,
            text(item.excerpt),
            `${titleCase(item.classification)} · confidence ${item.confidence}/5`,
          ].join("\n")),
        ].join("\n");
      case "company_comparison":
        return [
          `## ${text(object.title)}`,
          ...object.entries.slice().sort((left, right) => left.rank - right.rank)
            .map((entry) => `${entry.rank}. ${text(entry.company)} — ${entry.score}/100 — ${entry.status}\n   ${text(entry.rationale)} (${text(entry.domain)})`),
          ...(object.failures?.length ? [
            "",
            "### Targets not analyzed",
            ...object.failures.map((failure) => `- ${text(failure.domain)} — ${text(failure.reason)}`),
          ] : []),
        ].join("\n");
    }
  });

  return [
    "# GTM research export",
    "",
    `Conversation: ${exported.conversationId}`,
    `Generated: ${exported.generatedAt}`,
    "",
    ...sections.flatMap((section) => [section, ""]),
  ].join("\n").trimEnd().concat("\n");
}
