import type { FunctionToolAdapterDefinition, ToolRunContext } from "@gtm/agents";
import { z } from "zod";

import type { ResearchArtifactStore } from "./research-artifacts.js";

const comparisonInputSchema = z.object({
  domains: z.array(z.string().trim().min(3).max(253)).min(2).max(5)
    .transform((domains) => [...new Set(domains.map((domain) => domain.toLowerCase()))]),
}).refine(({ domains }) => domains.length >= 2, "At least two unique company domains are required");

function requireContext(context?: ToolRunContext) {
  if (!context) throw new Error("Research tools require trusted workflow context");
  return { ownerId: context.ownerId, runId: context.runId };
}

export function createPortfolioToolDefinitions(
  artifactStore: ResearchArtifactStore,
): Record<"compare_companies", FunctionToolAdapterDefinition> {
  return {
    compare_companies: {
      description: "Return the trusted crawls and evidence needed to rank two to five companies. Rank only from supplied evidence and expose gaps or ties.",
      handler: async (input, context) => {
        const { domains } = comparisonInputSchema.parse(input);
        const trustedContext = requireContext(context);
        const [crawledCompanies, evidence] = await Promise.all([
          artifactStore.listCrawledPages(trustedContext),
          artifactStore.listEvidence(trustedContext),
        ]);
        return {
          requestedDomains: domains,
          crawledCompanies: crawledCompanies.filter(({ domain }) => domains.includes(domain.toLowerCase())),
          evidence,
          comparisonPolicy: "Rank only from supplied evidence; expose gaps and ties instead of inventing differentiators.",
        };
      },
    },
  };
}
