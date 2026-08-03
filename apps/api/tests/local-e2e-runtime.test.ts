import { describe, expect, it, vi } from "vitest";

import type { AgentRunRequest } from "@gtm/agents";

import { createLocalE2eAgentRuntime } from "../src/local-e2e-runtime.js";

const request = (nodeId: string, requiredTools: string[] = []): AgentRunRequest => ({
  agentName: "Local E2E specialist",
  instructions: "Return one structured object.",
  model: "gpt-5.6-terra",
  reasoningEffort: "medium",
  tools: requiredTools,
  requiredTools,
  input: {
    runId: "11111111-1111-4111-8111-111111111111",
    nodeId,
    workflowInput: { domains: ["foodbegood.app"] },
    dependencyOutputs: {},
  },
});

describe("local native E2E agent runtime", () => {
  it("returns projection-ready Foodbegood data without calling a provider", async () => {
    const sleep = vi.fn(async () => undefined);
    const runtime = createLocalE2eAgentRuntime({ delayMs: 25, sleep });

    const profile = await runtime(request("company-profile", ["search_evidence"]));
    const review = await runtime(request("final-review", ["get_claim_sources", "web_search"]));
    const synthesis = await runtime(request("synthesis", ["search_evidence", "get_opportunities"]));

    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(25);
    expect(profile.usedTools).toEqual(["search_evidence"]);
    expect(profile.output).toMatchObject({
      companyProfiles: [{
        company: "Foodbegood",
        domain: "foodbegood.app",
        profile: { product: expect.stringContaining("meals") },
        icpAssessment: { fit: "medium" },
        automationHypotheses: [{ opportunity: "Waitlist Triage Agent" }],
      }],
    });
    expect(review.usedTools).toEqual(["get_claim_sources", "web_search"]);
    expect(synthesis.usedTools).toEqual(["search_evidence", "get_opportunities"]);
    expect(synthesis.output).toEqual({
      facts: (review.output as { approvedClaims: unknown[] }).approvedClaims,
    });
  });

  it("keeps supplemental research disabled for the deterministic queue lane", async () => {
    const runtime = createLocalE2eAgentRuntime({ delayMs: 0 });

    await expect(runtime(request("critical-review", ["get_claim_sources", "web_search"]))).resolves.toEqual({
      output: { needsSupplementalResearch: false },
      usedTools: ["get_claim_sources", "web_search"],
    });
  });
});
