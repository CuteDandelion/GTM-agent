import type { AgentRuntime } from "@gtm/agents";

import type { ConversationAgent } from "./server.js";

const approvedClaims = [{
  company: "Foodbegood",
  statement: "Foodbegood asks prospective users to join a waitlist.",
  sourceUrl: "https://foodbegood.app/user.html",
}];

const companyProfiles = [{
  company: "Foodbegood",
  domain: "foodbegood.app",
  profile: {
    background: "Early-stage food-sharing company.",
    product: "Affordable meals from partner canteens.",
    operatingScale: "Waitlist stage.",
    hiringSignal: "Small product team.",
    technologySignal: "AI engineering capability is visible.",
  },
  icpAssessment: {
    fit: "medium",
    rationale: "Repeatable partner and waitlist workflows fit bounded automation.",
    risks: ["Budget is not publicly verified."],
  },
  automationHypotheses: [{
    opportunity: "Waitlist Triage Agent",
    value: "Reduce manual qualification and routing.",
    controls: "Human approval before external messages.",
  }],
}];

const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

function latestConversationDomains(history: unknown[]) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (typeof entry !== "object" || entry === null) continue;
    const content = (entry as { content?: unknown }).content;
    if (typeof content !== "object" || content === null) continue;
    const domains = (content as { domains?: unknown }).domains;
    if (!Array.isArray(domains)) continue;
    const valid = domains.filter((domain): domain is string => typeof domain === "string" && domain.length > 0);
    if (valid.length > 0) return valid;
  }
  return [];
}

export function createLocalE2eConversationAgent(): ConversationAgent {
  return {
    async decide(input) {
      const domains = input.suppliedDomains.length > 0
        ? input.suppliedDomains
        : latestConversationDomains(input.history);
      if (domains.length === 0) {
        return {
          kind: "clarify",
          message: "Which company domain should I research?",
          usedTools: [],
        };
      }
      return {
        kind: "research",
        message: "I’ll research the company, assess ICP fit, and surface an evidence-backed automation opportunity.",
        domains,
        plan: {
          objective: `Profile ${domains.join(", ")} for AI and agent automation sales fit.`,
          capabilities: ["company_profile", "current_web", "icp_assessment", "opportunity_analysis"],
        },
        usedTools: [],
      };
    },
  };
}

/**
 * Test-only provider substitute for signed-in native E2E. It exercises the real
 * DAG, queue, API, Supabase persistence, Realtime, and mobile rendering paths.
 * It is intentionally not imported by the production bootstrap.
 */
export function createLocalE2eAgentRuntime(options: {
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
} = {}): AgentRuntime {
  const delayMs = options.delayMs ?? 2_000;
  const sleep = options.sleep ?? defaultSleep;

  return async (request) => {
    if (delayMs > 0) await sleep(delayMs);
    const nodeId = typeof request.input === "object" && request.input !== null
      ? (request.input as { nodeId?: unknown }).nodeId
      : undefined;
    const usedTools = [...(request.requiredTools ?? [])];

    if (nodeId === "critical-review") {
      return { output: { needsSupplementalResearch: false }, usedTools };
    }
    if (nodeId === "final-review") {
      return { output: { approvedClaims: structuredClone(approvedClaims) }, usedTools };
    }
    if (nodeId === "synthesis") {
      return { output: { facts: structuredClone(approvedClaims) }, usedTools };
    }
    if (nodeId === "company-profile") {
      return { output: { companyProfiles: structuredClone(companyProfiles) }, usedTools };
    }
    return { output: { nodeId, status: "completed" }, usedTools };
  };
}
