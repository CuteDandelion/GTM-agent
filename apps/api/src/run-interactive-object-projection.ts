import type { CheckpointStore } from "@gtm/orchestration";

import type { InteractiveObjectService } from "./interactive-actions.js";
import type { ResearchRunSnapshot, ResearchRunStore } from "./research-service.js";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | undefined => (
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined
);
const asText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const asRecords = (value: unknown) => Array.isArray(value) ? value.flatMap((item) => asRecord(item) ? [asRecord(item)!] : []) : [];
const finishedNodeStatuses = new Set(["completed", "skipped"]);

const researchNodeIds = [
  "validate-domain",
  "crawl-company",
  "extract-company",
  "extract-product",
  "extract-hiring",
  "extract-technology",
  "current-research",
  "document-research",
  "normalize-evidence",
];
const analysisNodeIds = ["company-profile", "icp-assessment", "opportunity-analysis"];
const reviewNodeIds = [
  "critical-review",
  "supplemental-plan",
  "supplemental-research",
  "final-review",
  "synthesis",
  "portfolio-comparison",
  "interactive-objects",
];

function nodeOutput(checkpoint: unknown, nodeId: string) {
  const node = asRecord(asRecord(asRecord(checkpoint)?.nodes)?.[nodeId]);
  const executionOutput = asRecord(node?.output);
  return asRecord(executionOutput?.output) ?? executionOutput;
}

function fitBand(value: unknown): "high" | "medium" | "low" {
  const fit = asText(value)?.toLowerCase().replaceAll("-", "_");
  if (fit === "very_high" || fit === "highest" || fit === "high" || fit === "strong" || fit === "strong_provisional") return "high";
  if (fit === "medium" || fit === "medium_high" || fit === "low_medium" || fit === "moderate" || fit === "moderate_provisional") return "medium";
  return "low";
}

function fitScore(value: unknown) {
  const fit = asText(value)?.toLowerCase().replaceAll("-", "_");
  if (fit === "very_high" || fit === "highest") return 92;
  if (fit === "high" || fit === "medium_high") return 82;
  if (fit === "medium") return 62;
  if (fit === "low_medium") return 42;
  return 25;
}

function assessmentScore(assessment: JsonRecord) {
  const score = typeof assessment.score === "number" ? assessment.score : undefined;
  const outOf = typeof assessment.outOf === "number" ? assessment.outOf : undefined;
  if (score !== undefined && outOf !== undefined && outOf > 0) {
    return Math.max(0, Math.min(100, Math.round((score / outOf) * 100)));
  }
  return fitScore(assessment.fit);
}

function projectionCompanyProfiles(profileOutput: JsonRecord | undefined) {
  const legacyProfiles = asRecords(profileOutput?.companyProfiles);
  if (legacyProfiles.length) return legacyProfiles;

  const company = asRecord(profileOutput?.company);
  const assessment = asRecord(profileOutput?.icpAssessment);
  if (!company || !assessment) return [];
  const opportunity = asRecord(profileOutput?.opportunity);
  const caveats = Array.isArray(profileOutput?.caveats)
    ? profileOutput.caveats.flatMap((value) => asText(value) ? [asText(value)!] : [])
    : [];
  const inferenceRationale = asRecords(assessment.inferences)
    .flatMap((inference) => asText(inference.claim) ? [asText(inference.claim)!] : [])
    .join(" ");

  return [{
    company: company.name,
    domain: company.domain,
    profile: {
      background: company.profile,
      product: company.profile,
      operatingScale: company.stage,
      hiringSignal: company.teamSignal,
    },
    icpAssessment: {
      ...assessment,
      rationale: asText(assessment.rationale) ?? inferenceRationale,
      risks: Array.isArray(assessment.risks) ? assessment.risks : caveats,
    },
    automationHypotheses: opportunity ? [{
      opportunity: opportunity.name,
      value: asText(opportunity.hypothesis) ?? asText(opportunity.commercialValue),
      controls: opportunity.guardrails,
    }] : [],
  }];
}

function checkpointNodeStatus(checkpoint: unknown, nodeId: string) {
  return asText(asRecord(asRecord(asRecord(checkpoint)?.nodes)?.[nodeId])?.status);
}

function anyNodeStarted(checkpoint: unknown, nodeIds: string[]) {
  return nodeIds.some((nodeId) => {
    const status = checkpointNodeStatus(checkpoint, nodeId);
    return Boolean(status && status !== "pending");
  });
}

function allNodesFinished(checkpoint: unknown, nodeIds: string[]) {
  return nodeIds.every((nodeId) => finishedNodeStatuses.has(checkpointNodeStatus(checkpoint, nodeId) ?? ""));
}

function liveProgressSteps(snapshot: ResearchRunSnapshot) {
  const checkpoint = snapshot.checkpoint;
  const reviewStarted = anyNodeStarted(checkpoint, reviewNodeIds);
  const analysisStarted = anyNodeStarted(checkpoint, analysisNodeIds);
  const researchStarted = anyNodeStarted(checkpoint, researchNodeIds);
  const planFinished = finishedNodeStatuses.has(checkpointNodeStatus(checkpoint, "research-plan") ?? "")
    || researchStarted
    || analysisStarted
    || reviewStarted;
  const researchFinished = finishedNodeStatuses.has(checkpointNodeStatus(checkpoint, "normalize-evidence") ?? "")
    || analysisStarted
    || reviewStarted;
  const analysisFinished = allNodesFinished(checkpoint, analysisNodeIds) || reviewStarted;

  return [
    { id: "plan", label: "Plan", agent: "Sol", status: planFinished ? "completed" : "running" },
    { id: "research", label: "Research", agent: "Luna", status: researchFinished ? "completed" : planFinished ? "running" : "pending" },
    { id: "analyze", label: "Analyze", agent: "Terra", status: analysisFinished ? "completed" : researchFinished ? "running" : "pending" },
    { id: "review", label: "Review", agent: "Sol", status: reviewStarted ? "running" : "pending" },
  ];
}

function progressObject(snapshot: ResearchRunSnapshot) {
  const terminal = snapshot.status === "completed";
  const steps = terminal
    ? [
        { id: "plan", label: "Plan", agent: "Sol", status: "completed" },
        { id: "research", label: "Research", agent: "Luna", status: "completed" },
        { id: "analyze", label: "Analyze", agent: "Terra", status: "completed" },
        { id: "review", label: "Review", agent: "Sol", status: "completed" },
      ]
    : snapshot.status === "running"
      ? liveProgressSteps(snapshot)
      : [
          { id: "plan", label: "Plan", agent: "Sol", status: "pending" },
          { id: "research", label: "Research", agent: "Luna", status: "pending" },
          { id: "analyze", label: "Analyze", agent: "Terra", status: "pending" },
          { id: "review", label: "Review", agent: "Sol", status: "pending" },
        ];
  const companyLabel = snapshot.input.domains.length === 1
    ? snapshot.input.domains[0]!
    : `${snapshot.input.domains.length} companies`;
  return {
    type: "workflow_progress",
    title: `Researching ${companyLabel}`,
    live: snapshot.status === "queued" || snapshot.status === "running",
    steps,
  };
}

export function createProjectingCheckpointStore(options: {
  checkpointStore: CheckpointStore;
  runStore: ResearchRunStore;
  observe: (snapshot: ResearchRunSnapshot) => Promise<void>;
}): CheckpointStore {
  return {
    load: (runId) => options.checkpointStore.load(runId),
    async save(checkpoint) {
      await options.checkpointStore.save(checkpoint);
      const snapshot = await options.runStore.load(checkpoint.runId);
      if (!snapshot || snapshot.status !== "running") return;
      await options.observe(structuredClone({ ...snapshot, checkpoint }));
    },
  };
}

export function createRunProjectionObserver(service: InteractiveObjectService) {
  return async (snapshot: ResearchRunSnapshot) => {
    const ownerId = snapshot.input.ownerId;
    if (!ownerId) return;
    const publish = (objectKey: string, object: JsonRecord) => service.publish({
      ownerId,
      conversationId: snapshot.conversationId,
      objectKey,
      object,
    });

    await publish("workflow-progress", progressObject(snapshot));
    if (snapshot.status !== "completed" || !snapshot.checkpoint) return;

    const profileOutput = nodeOutput(snapshot.checkpoint, "company-profile");
    const finalReviewOutput = nodeOutput(snapshot.checkpoint, "final-review");
    const portfolioOutput = nodeOutput(snapshot.checkpoint, "portfolio-comparison");
    const crawlOutput = asRecord(nodeOutput(snapshot.checkpoint, "crawl-company")?.crawl_company);
    const approvedClaims = asRecords(finalReviewOutput?.approvedClaims);
    const companyProfiles = projectionCompanyProfiles(profileOutput);
    for (const companyProfile of companyProfiles) {
      const company = asText(companyProfile.company);
      const domain = asText(companyProfile.domain);
      const profile = asRecord(companyProfile.profile);
      const assessment = asRecord(companyProfile.icpAssessment);
      if (!company || !domain || !profile || !assessment) continue;
      const risks = Array.isArray(assessment.risks) ? assessment.risks.flatMap((risk) => asText(risk) ? [asText(risk)!] : []) : [];
      const technologySignal = asText(profile.technologySignal);
      const hypothesis = asRecords(companyProfile.automationHypotheses)[0];
      const fit = assessment.fit;

      await publish(`company-profile:${domain}`, {
        type: "company_profile",
        company,
        domain,
        summary: asText(profile.product) ?? asText(profile.background) ?? "Public company profile",
        facts: [
          { label: "Background", value: asText(profile.background) },
          { label: "Scale", value: asText(profile.operatingScale) },
          { label: "Hiring", value: asText(profile.hiringSignal) },
        ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value)),
        pros: technologySignal ? [technologySignal] : [],
        cons: risks,
      });
      await publish(`icp-score:${domain}`, {
        type: "icp_score",
        company,
        score: assessmentScore(assessment),
        band: fitBand(fit),
        reasons: asText(assessment.rationale) ? [asText(assessment.rationale)!] : [],
        gaps: risks,
      });
      if (hypothesis) {
        await publish(`opportunity:${domain}`, {
          type: "opportunity",
          company,
          title: asText(hypothesis.opportunity) ?? "Automation discovery",
          summary: asText(hypothesis.value) ?? "Validate the workflow and measurable outcome with the buyer.",
          impact: "high",
          value: "high",
          effort: "medium",
          fit: fitBand(fit),
          status: "research",
        });
      }
      const evidence = approvedClaims.filter((claim) => asText(claim.company)?.toLowerCase() === company.toLowerCase());
      await publish(`evidence:${domain}`, {
        type: "evidence_collection",
        title: `${company} evidence`,
        subtitle: "Approved source-backed claims",
        items: evidence.flatMap((claim, index) => {
          const statement = asText(claim.statement) ?? asText(claim.fact) ?? asText(claim.claim);
          const sourceUrl = asText(claim.sourceUrl) ?? asText(claim.source);
          if (!statement || !sourceUrl) return [];
          return [{
            id: `${snapshot.runId}-source-${index + 1}`,
            title: `${company} source`,
            url: sourceUrl,
            excerpt: statement,
            classification: "fact",
            confidence: 5,
          }];
        }),
      });
    }
    const domainsByCompany = new Map(companyProfiles.flatMap((profile) => {
      const company = asText(profile.company);
      const domain = asText(profile.domain);
      return company && domain ? [[company.toLowerCase(), domain] as const] : [];
    }));
    const entries = asRecords(portfolioOutput?.ranking).flatMap((ranked) => {
      const company = asText(ranked.company);
      const domain = asText(ranked.domain) ?? (company ? domainsByCompany.get(company.toLowerCase()) : undefined);
      const rank = typeof ranked.rank === "number" ? Math.round(ranked.rank) : undefined;
      const rationale = asText(ranked.rationale);
      if (!company || !domain || !rank || rank < 1 || !rationale) return [];
      const band = fitBand(ranked.fit);
      const score = typeof ranked.score === "number"
        ? Math.max(0, Math.min(100, Math.round(ranked.score)))
        : fitScore(ranked.fit);
      return [{
        company,
        domain,
        rank,
        score,
        status: band === "high" ? "pursue" : band === "medium" ? "research" : "nurture",
        rationale,
      }];
    });
    if (entries.length > 0) {
      const failures = asRecords(crawlOutput?.failures).flatMap((failure) => {
        const domain = asText(failure.domain);
        const reason = asText(failure.error) ?? asText(failure.reason);
        return domain && reason ? [{ domain, reason }] : [];
      });
      await publish("company-comparison", {
        type: "company_comparison",
        title: "Company priority",
        entries,
        ...(failures.length ? { failures } : {}),
      });
    }
  };
}
