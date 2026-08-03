import type { AgentRuntime } from "@gtm/agents";
import { createModelRegistry, resolveModel } from "@gtm/orchestration";
import { z } from "zod";

import {
  researchCapabilitySchema,
  type ConversationAgent,
  type ConversationDecision,
} from "./server.js";

const answerDecisionSchema = z.object({
  kind: z.enum(["answer", "clarify"]),
  message: z.string().trim().min(1).max(8_000),
  objects: z.array(z.object({
    key: z.string().trim().min(1).max(100),
    type: z.literal("interaction_prompt"),
    purpose: z.enum(["clarification", "scope", "assumption", "evidence_request", "approval", "next_step"]),
    title: z.string().trim().min(1).max(200),
    prompt: z.string().trim().min(1).max(1_000),
    selection: z.enum(["single", "multiple", "confirmation"]),
    options: z.array(z.object({
      id: z.string().trim().min(1).max(100),
      label: z.string().trim().min(1).max(200),
      description: z.string().trim().min(1).max(500).optional(),
    }).strict()).min(1).max(8),
    allowFreeText: z.boolean(),
  }).strict()).max(3).optional(),
}).strict();

const researchDecisionSchema = z.object({
  kind: z.literal("research"),
  message: z.string().trim().min(1).max(2_000),
  domains: z.array(z.string().trim().min(1).max(253)).min(1).max(5),
  plan: z.object({
    objective: z.string().trim().min(1).max(1_000),
    capabilities: z.array(researchCapabilitySchema).min(1).max(6),
  }).strict(),
  objects: answerDecisionSchema.shape.objects,
}).strict();

const conversationDecisionSchema = z.discriminatedUnion("kind", [
  answerDecisionSchema,
  researchDecisionSchema,
]);

function parseDecision(output: unknown): z.infer<typeof conversationDecisionSchema> {
  let candidate = output;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      throw new Error("Conversation agent output violated the decision contract");
    }
  }
  const parsed = conversationDecisionSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("Conversation agent output violated the decision contract");
  return parsed.data;
}

export function createConversationAgent(options: {
  runtime: AgentRuntime;
  availableModels: ReadonlySet<string>;
}): ConversationAgent {
  const model = resolveModel(createModelRegistry(), "conversation", options.availableModels);
  return {
    async decide(input): Promise<ConversationDecision> {
      const result = await options.runtime({
        agentName: "GTM conversation orchestrator",
        model,
        reasoningEffort: "medium",
        tools: ["web_search", "file_search", "code_interpreter"],
        requiredTools: [],
        instructions: [
          "Manage a real multi-turn GTM advisory conversation for a freelancer or agency selling AI and agent automation.",
          "Reason from the complete conversation and seller profile. Choose the next action; never force every turn into company research.",
          "Return kind=answer for a useful direct response, kind=clarify when a material ambiguity blocks a reliable response, or kind=research for evidence-backed multi-step company work.",
          "Use available read-only tools when the turn needs current facts, documents, calculation, or verification. Tool use is optional and must follow the user's intent.",
          "For research, provide one to five company domains and choose only the minimum capabilities needed from: company_profile, current_web, document_research, icp_assessment, opportunity_analysis, portfolio_comparison.",
          "Never request or perform outreach, email, purchases, account changes, or other external writes. External commercial actions require human approval and are outside this tool set.",
          "When a compact interactive surface would reduce ambiguity or speed a decision, optionally add objects: up to three interaction_prompt objects with a stable key, purpose, title, prompt, selection, options, and allowFreeText. Use them creatively for clarification, scope, assumptions, evidence requests, approval gates, or next steps; do not use them when prose is clearer.",
          "Return exactly one JSON object. For answer/clarify use {kind,message,objects?}. For research use {kind,message,domains,plan:{objective,capabilities},objects?}.",
        ].join(" "),
        input: {
          runId: `conversation-turn-${input.conversationId}`,
          nodeId: "conversation-manager",
          workflowInput: {
            ownerId: input.ownerId ?? "00000000-0000-4000-8000-000000000000",
          },
          conversationId: input.conversationId,
          conversationHistory: input.history,
          sellerProfile: input.sellerProfile,
          interactiveObjects: input.interactiveObjects,
          userMessage: input.message,
          suppliedDomains: input.suppliedDomains,
          attachedDocumentIds: input.documentIds,
        },
      });
      const decision = parseDecision(result.output);
      const { objects, ...decisionWithoutObjects } = decision;
      return {
        ...decisionWithoutObjects,
        ...(objects ? { objects } : {}),
        usedTools: result.usedTools,
        ...(result.responseId ? { responseId: result.responseId } : {}),
      };
    },
  };
}
