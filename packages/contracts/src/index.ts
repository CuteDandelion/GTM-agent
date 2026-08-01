import { z } from "zod";

const workflowStepSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    agent: z.enum(["Sol", "Luna", "Terra", "System"]),
    status: z.enum(["pending", "running", "completed", "failed", "blocked", "skipped"])
  })
  .strict();

export const workflowProgressObjectSchema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    version: z.number().int().positive(),
    type: z.literal("workflow_progress"),
    title: z.string().min(1),
    live: z.boolean(),
    steps: z.array(workflowStepSchema).min(1)
  })
  .strict();

const scoreBandSchema = z.enum(["low", "medium", "high"]);

export const companyAssessmentObjectSchema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    version: z.number().int().positive(),
    type: z.literal("company_assessment"),
    company: z.string().min(1),
    domain: z.string().min(1),
    summary: z.string().min(1),
    icpScore: z.number().int().min(0).max(100),
    facts: z
      .object({
        businessModel: z.string().min(1),
        founded: z.number().int().min(1800),
        fundingStage: z.string().min(1),
        employeeRange: z.string().min(1)
      })
      .strict(),
    pros: z.array(z.string().min(1)).min(1),
    cons: z.array(z.string().min(1)).min(1),
    opportunity: z
      .object({
        title: z.string().min(1),
        summary: z.string().min(1),
        impact: scoreBandSchema,
        value: scoreBandSchema,
        effort: scoreBandSchema,
        fit: scoreBandSchema
      })
      .strict()
  })
  .strict();

const evidenceItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    excerpt: z.string().min(1),
    classification: z.enum(["fact", "inference", "hypothesis"]),
    confidence: z.number().int().min(1).max(5)
  })
  .strict();

export const evidenceCollectionObjectSchema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    version: z.number().int().positive(),
    type: z.literal("evidence_collection"),
    title: z.string().min(1),
    subtitle: z.string().min(1),
    items: z.array(evidenceItemSchema).min(1)
  })
  .strict();

const interactiveObjectBase = {
  id: z.string().min(1),
  conversationId: z.string().min(1),
  version: z.number().int().positive(),
};

export const companyProfileObjectSchema = z.object({
  ...interactiveObjectBase,
  type: z.literal("company_profile"),
  company: z.string().min(1),
  domain: z.string().min(1),
  summary: z.string().min(1),
  facts: z.array(z.object({ label: z.string().min(1), value: z.string().min(1) }).strict()).min(1),
  pros: z.array(z.string().min(1)),
  cons: z.array(z.string().min(1)),
}).strict();

export const icpScoreObjectSchema = z.object({
  ...interactiveObjectBase,
  type: z.literal("icp_score"),
  company: z.string().min(1),
  score: z.number().int().min(0).max(100),
  band: scoreBandSchema,
  reasons: z.array(z.string().min(1)),
  gaps: z.array(z.string().min(1)),
}).strict();

export const opportunityObjectSchema = z.object({
  ...interactiveObjectBase,
  type: z.literal("opportunity"),
  company: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  impact: scoreBandSchema,
  value: scoreBandSchema,
  effort: scoreBandSchema,
  fit: scoreBandSchema,
  status: z.enum(["pursue", "research", "nurture", "reject"]),
}).strict();

export const companyComparisonObjectSchema = z.object({
  ...interactiveObjectBase,
  type: z.literal("company_comparison"),
  title: z.string().min(1),
  entries: z.array(z.object({
    company: z.string().min(1),
    domain: z.string().min(1),
    rank: z.number().int().positive(),
    score: z.number().int().min(0).max(100),
    status: z.enum(["pursue", "research", "nurture", "reject"]),
    rationale: z.string().min(1),
  }).strict()).min(1),
}).strict();

export const interactiveObjectTypes = [
  "workflow_progress",
  "company_profile",
  "icp_score",
  "opportunity",
  "evidence_collection",
  "company_comparison",
] as const;

export const interactiveObjectSchema = z.discriminatedUnion("type", [
  workflowProgressObjectSchema,
  companyProfileObjectSchema,
  icpScoreObjectSchema,
  opportunityObjectSchema,
  evidenceCollectionObjectSchema,
  companyComparisonObjectSchema,
]);

export const canonicalAcmeFixtureBundleSchema = z
  .object({
    progress: workflowProgressObjectSchema,
    assessment: companyAssessmentObjectSchema,
    evidence: evidenceCollectionObjectSchema
  })
  .strict();

export type WorkflowProgressObject = z.infer<typeof workflowProgressObjectSchema>;
export type CompanyAssessmentObject = z.infer<typeof companyAssessmentObjectSchema>;
export type EvidenceCollectionObject = z.infer<typeof evidenceCollectionObjectSchema>;
export type CompanyProfileObject = z.infer<typeof companyProfileObjectSchema>;
export type IcpScoreObject = z.infer<typeof icpScoreObjectSchema>;
export type OpportunityObject = z.infer<typeof opportunityObjectSchema>;
export type CompanyComparisonObject = z.infer<typeof companyComparisonObjectSchema>;
export type InteractiveObject = z.infer<typeof interactiveObjectSchema>;
export type CanonicalAcmeFixtureBundle = z.infer<typeof canonicalAcmeFixtureBundleSchema>;

export const canonicalAcmeFixtures = {
  progress: {
    id: "object_acme_research",
    conversationId: "conversation_acme",
    version: 1,
    type: "workflow_progress",
    title: "Researching Acme",
    live: true,
    steps: [
      { id: "plan", label: "Research plan", agent: "Sol", status: "completed" },
      { id: "crawl", label: "Website crawl", agent: "System", status: "completed" },
      { id: "extract", label: "Evidence extraction", agent: "Luna", status: "completed" },
      { id: "analyze", label: "ICP and opportunity analysis", agent: "Terra", status: "running" },
      { id: "review", label: "Critical review", agent: "Sol", status: "pending" },
      { id: "synthesis", label: "GTM synthesis", agent: "Terra", status: "pending" }
    ]
  },
  assessment: {
    id: "object_acme_assessment",
    conversationId: "conversation_acme",
    version: 1,
    type: "company_assessment",
    company: "Acme",
    domain: "acme.ai",
    summary: "AI platform for customer support automation",
    icpScore: 82,
    facts: {
      businessModel: "B2B SaaS",
      founded: 2019,
      fundingStage: "Series B",
      employeeRange: "51–200"
    },
    pros: ["Modern stack & AI native", "Strong product adoption", "Active funding & roadmap"],
    cons: ["Limited mid-market focus", "Pricing not transparent", "Limited integrations"],
    opportunity: {
      title: "Support Triage Agent",
      summary: "Automate first-line support triage, categorization, and routing.",
      impact: "high",
      value: "high",
      effort: "medium",
      fit: "high"
    }
  },
  evidence: {
    id: "object_acme_evidence",
    conversationId: "conversation_acme",
    version: 1,
    type: "evidence_collection",
    title: "Evidence",
    subtitle: "Key sources and facts supporting this analysis.",
    items: [
      {
        id: "evidence_homepage",
        title: "Acme – Homepage",
        url: "https://acme.ai",
        excerpt: "AI platform for customer support automation.",
        classification: "fact",
        confidence: 4
      },
      {
        id: "evidence_pricing",
        title: "Acme – Pricing",
        url: "https://acme.ai/pricing",
        excerpt: "Pricing not publicly listed. Contact sales for details.",
        classification: "fact",
        confidence: 3
      },
      {
        id: "evidence_roadmap",
        title: "Acme – Blog: Roadmap Update",
        url: "https://acme.ai/blog/roadmap",
        excerpt: "Investing in automation and integrations in 2024.",
        classification: "inference",
        confidence: 4
      }
    ]
  }
} as const;

export function parseInteractiveObject(input: unknown): InteractiveObject {
  return interactiveObjectSchema.parse(input);
}

export function parseCompanyAssessmentObject(input: unknown): CompanyAssessmentObject {
  return companyAssessmentObjectSchema.parse(input);
}

export function parseCanonicalFixtureBundle(input: unknown): CanonicalAcmeFixtureBundle {
  return canonicalAcmeFixtureBundleSchema.parse(input);
}
