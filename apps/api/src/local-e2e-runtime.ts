import type { AgentRuntime } from "@gtm/agents";

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

/**
 * Test-only provider substitute for signed-in native E2E. It exercises the real
 * DAG, queue, API, Supabase persistence, Realtime, and mobile rendering paths.
 * It is intentionally not imported by the production bootstrap.
 */
export function createLocalE2eAgentRuntime(options: {
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
} = {}): AgentRuntime {
  const delayMs = options.delayMs ?? 250;
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
