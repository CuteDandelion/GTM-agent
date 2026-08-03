import { z } from "zod";

export type AccuracyVerdict = "correct" | "contradicted" | "unverifiable" | "stale" | "citation_mismatch";

export interface AccuracyClaim {
  id: string;
  statement: string;
  weight: number;
  sourceUrl: string;
  verifiedAt: string;
}

export interface AccuracySample {
  id: string;
  company: string;
  domain: string;
  industry: string;
  stage: string;
  sizeBand: string;
  requiredTools: string[];
  claims: AccuracyClaim[];
}

export interface AccuracyManifest {
  version: string;
  minimumScore: number;
  samples: AccuracySample[];
}

export interface AccuracyDecision {
  sampleId: string;
  claimId: string;
  verdict: AccuracyVerdict;
  citationUrls: string[];
  rationale: string;
}

export interface AccuracyToolTrace {
  sampleId: string;
  toolName: string;
  status: "completed" | "failed" | "skipped";
  traceId: string;
}

export interface AccuracyRun {
  runId: string;
  evaluatedAt: string;
  decisions: AccuracyDecision[];
  toolTraces: AccuracyToolTrace[];
}

export interface GeneratedClaimDecision {
  sampleId: string;
  claimId: string;
  statement: string;
  sourceUrl: string;
  verdict: AccuracyVerdict;
  citationUrls: string[];
  rationale: string;
}

export interface GeneratedClaimAccuracyRun {
  runId: string;
  evaluatedAt: string;
  decisions: GeneratedClaimDecision[];
  toolTraces: AccuracyToolTrace[];
  graderToolTraces: AccuracyToolTrace[];
}

export interface UserFacingFact {
  company: string;
  fact: string;
  source: string;
}

const claimSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  weight: z.number().positive().finite(),
  sourceUrl: z.string().url(),
  verifiedAt: z.string().datetime({ offset: true }),
});

const sampleSchema = z.object({
  id: z.string().min(1),
  company: z.string().min(1),
  domain: z.string().min(3),
  industry: z.string().min(1),
  stage: z.string().min(1),
  sizeBand: z.string().min(1),
  requiredTools: z.array(z.string().min(1)).min(1),
  claims: z.array(claimSchema).min(1),
});

const manifestSchema = z.object({
  version: z.string().min(1),
  minimumScore: z.number().min(0).max(100),
  samples: z.array(sampleSchema).min(5),
});

const decisionSchema = z.object({
  sampleId: z.string().min(1),
  claimId: z.string().min(1),
  verdict: z.enum(["correct", "contradicted", "unverifiable", "stale", "citation_mismatch"]),
  citationUrls: z.array(z.string().url()),
  rationale: z.string().min(1),
});

const generatedClaimDecisionSchema = decisionSchema.extend({
  statement: z.string().min(1),
  sourceUrl: z.string().url(),
});

const runSchema = z.object({
  runId: z.string().min(1),
  evaluatedAt: z.string().datetime({ offset: true }),
  decisions: z.array(decisionSchema),
  toolTraces: z.array(z.object({
    sampleId: z.string().min(1),
    toolName: z.string().min(1),
    status: z.enum(["completed", "failed", "skipped"]),
    traceId: z.string().min(1),
  })),
});

const generatedClaimRunSchema = runSchema.extend({
  decisions: z.array(generatedClaimDecisionSchema),
  graderToolTraces: runSchema.shape.toolTraces,
});

const userFacingFactSchema = z.object({
  company: z.string().min(1),
  fact: z.string().min(1),
  source: z.string().url(),
});
const currentUserFacingFactSchema = z.object({
  company: z.string().min(1),
  statement: z.string().min(1),
  sourceUrl: z.string().url(),
});

const synthesisPayloadSchema = z.object({
  facts: z.array(z.union([userFacingFactSchema, currentUserFacingFactSchema])).min(1).optional(),
  companyProfiles: z.array(z.object({
    company: z.string().min(1),
    facts: z.array(z.object({
      statement: z.string().min(1),
      sourceUrl: z.string().url(),
    })).min(1),
  }).passthrough()).min(1).optional(),
}).passthrough().refine((payload) => Boolean(payload.facts?.length || payload.companyProfiles?.length), {
  message: "Synthesis must expose user-facing facts",
});

const synthesisCheckpointSchema = z.object({
  synthesis: z.object({
    output: z.object({
      output: synthesisPayloadSchema,
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export function validateAccuracyDecisions(input: unknown): AccuracyDecision[] {
  return z.array(decisionSchema).parse(input);
}

export function validateGeneratedClaimDecisions(input: unknown): GeneratedClaimDecision[] {
  return z.array(generatedClaimDecisionSchema).parse(input);
}

export function partitionPrecisionEvidence<T>(evidence: T[]): [T[], T[]] {
  if (evidence.length < 2) throw new Error("Precision grading requires at least two evidence items");
  const splitAt = Math.ceil(evidence.length / 2);
  return [evidence.slice(0, splitAt), evidence.slice(splitAt)];
}

export function extractUserFacingFactsFromCheckpoint(input: unknown): UserFacingFact[] {
  const payload = synthesisCheckpointSchema.parse(input).synthesis.output.output;
  if (payload.facts) return payload.facts.map((fact) => "fact" in fact ? fact : ({
    company: fact.company,
    fact: fact.statement,
    source: fact.sourceUrl,
  }));
  return payload.companyProfiles!.flatMap((profile) => profile.facts.map((fact) => ({
    company: profile.company,
    fact: fact.statement,
    source: fact.sourceUrl,
  })));
}

function rounded(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizedUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function validateAccuracyManifest(input: unknown): AccuracyManifest {
  const manifest = manifestSchema.parse(input);
  const claimCount = manifest.samples.reduce((total, sample) => total + sample.claims.length, 0);
  if (claimCount < 40) throw new Error("Accuracy manifests require at least 40 atomic claims");
  return manifest;
}

export function buildSampleToolTraces(
  manifestInput: AccuracyManifest,
  workflowRunId: string,
  nodes: Record<string, { status: string; toolsUsed: string[] }>,
): AccuracyToolTrace[] {
  const manifest = validateAccuracyManifest(manifestInput);
  return manifest.samples.flatMap((sample) => [...new Set(sample.requiredTools)].flatMap((toolName) => {
    const entry = Object.entries(nodes).find(([, node]) => node.status === "completed" && node.toolsUsed.includes(toolName));
    if (!entry) return [];
    const [nodeId] = entry;
    return [{
      sampleId: sample.id,
      toolName,
      status: "completed" as const,
      traceId: `${workflowRunId}:${nodeId}:${toolName}`,
    }];
  }));
}

export function evaluateAccuracyRun(manifestInput: AccuracyManifest, runInput: AccuracyRun) {
  const manifest = validateAccuracyManifest(manifestInput);
  const run = runSchema.parse(runInput);
  const claims = manifest.samples.flatMap((sample) => sample.claims.map((claim) => ({ sample, claim })));

  const sampleIds = new Set<string>();
  const claimIds = new Set<string>();
  for (const sample of manifest.samples) {
    if (sampleIds.has(sample.id)) throw new Error(`Duplicate sample id: ${sample.id}`);
    sampleIds.add(sample.id);
    for (const claim of sample.claims) {
      if (claimIds.has(claim.id)) throw new Error(`Duplicate claim id: ${claim.id}`);
      claimIds.add(claim.id);
    }
  }

  const decisions = new Map<string, AccuracyDecision>();
  for (const decision of run.decisions) {
    const key = `${decision.sampleId}:${decision.claimId}`;
    if (decisions.has(key)) throw new Error(`Duplicate decision: ${key}`);
    decisions.set(key, decision);
  }

  const claimResults = claims.map(({ sample, claim }) => {
    const decision = decisions.get(`${sample.id}:${claim.id}`);
    if (!decision) throw new Error(`Missing decision for ${sample.id}:${claim.id}`);
    const citationMatches = decision.citationUrls.some((url) => normalizedUrl(url) === normalizedUrl(claim.sourceUrl));
    const normalizedVerdict: AccuracyVerdict = decision.verdict === "correct" && !citationMatches
      ? "citation_mismatch"
      : decision.verdict;
    return {
      sampleId: sample.id,
      claimId: claim.id,
      weight: claim.weight,
      credited: normalizedVerdict === "correct",
      normalizedVerdict,
      citationUrls: decision.citationUrls,
      sourceUrl: claim.sourceUrl,
      rationale: decision.rationale,
    };
  });

  const evaluatedWeight = claimResults.reduce((total, result) => total + result.weight, 0);
  const correctWeight = claimResults.reduce((total, result) => total + (result.credited ? result.weight : 0), 0);
  const score = rounded(100 * correctWeight / evaluatedWeight);
  const failures: string[] = [];
  if (score < manifest.minimumScore) {
    failures.push(`Accuracy ${score.toFixed(2)} is below the required ${manifest.minimumScore.toFixed(2)}`);
  }
  for (const sample of manifest.samples) {
    for (const requiredTool of new Set(sample.requiredTools)) {
      const completed = run.toolTraces.some((trace) => trace.sampleId === sample.id
        && trace.toolName === requiredTool && trace.status === "completed" && trace.traceId.length > 0);
      if (!completed) failures.push(`${sample.id} is missing a completed ${requiredTool} tool trace`);
    }
  }

  return {
    manifestVersion: manifest.version,
    runId: run.runId,
    score,
    minimumScore: manifest.minimumScore,
    correctWeight: rounded(correctWeight),
    evaluatedWeight: rounded(evaluatedWeight),
    accepted: failures.length === 0,
    failures,
    claimResults,
    toolTraces: run.toolTraces,
  };
}

export function evaluateGeneratedClaimAccuracy(
  manifestInput: AccuracyManifest,
  runInput: GeneratedClaimAccuracyRun,
) {
  const manifest = validateAccuracyManifest(manifestInput);
  const run = generatedClaimRunSchema.parse(runInput);
  if (run.decisions.length < 40) {
    throw new Error("Generated-claim evaluation requires at least 40 atomic claims");
  }

  const manifestSampleIds = new Set(manifest.samples.map((sample) => sample.id));
  const evaluatedSampleIds = new Set<string>();
  const claimIds = new Set<string>();
  for (const decision of run.decisions) {
    if (!manifestSampleIds.has(decision.sampleId)) {
      throw new Error(`Unknown generated-claim sample id: ${decision.sampleId}`);
    }
    if (claimIds.has(decision.claimId)) {
      throw new Error(`Duplicate generated claim id: ${decision.claimId}`);
    }
    claimIds.add(decision.claimId);
    evaluatedSampleIds.add(decision.sampleId);
  }
  if (evaluatedSampleIds.size !== manifest.samples.length) {
    throw new Error(`Generated-claim evaluation must cover all ${manifest.samples.length} samples`);
  }

  const claimResults = run.decisions.map((decision) => {
    const citationMatches = decision.citationUrls.some((url) => normalizedUrl(url) === normalizedUrl(decision.sourceUrl));
    const normalizedVerdict: AccuracyVerdict = decision.verdict === "correct" && !citationMatches
      ? "citation_mismatch"
      : decision.verdict;
    return {
      ...decision,
      normalizedVerdict,
      credited: normalizedVerdict === "correct",
    };
  });
  const correctClaims = claimResults.filter((result) => result.credited).length;
  const score = rounded(100 * correctClaims / claimResults.length);
  const failures: string[] = [];
  if (score < manifest.minimumScore) {
    failures.push(`Generated-claim accuracy ${score.toFixed(2)} is below the required ${manifest.minimumScore.toFixed(2)}`);
  }
  for (const sample of manifest.samples) {
    for (const requiredTool of new Set(sample.requiredTools)) {
      const completed = run.toolTraces.some((trace) => trace.sampleId === sample.id
        && trace.toolName === requiredTool && trace.status === "completed" && trace.traceId.length > 0);
      if (!completed) failures.push(`${sample.id} is missing a completed ${requiredTool} tool trace`);
    }
    const independentlyGraded = run.graderToolTraces.some((trace) => trace.sampleId === sample.id
      && trace.toolName === "web_search" && trace.status === "completed" && trace.traceId.length > 0);
    if (!independentlyGraded) failures.push(`${sample.id} is missing an independent web_search grading trace`);
  }

  return {
    manifestVersion: manifest.version,
    runId: run.runId,
    score,
    minimumScore: manifest.minimumScore,
    correctClaims,
    evaluatedClaims: claimResults.length,
    accepted: failures.length === 0,
    failures,
    claimResults,
    toolTraces: run.toolTraces,
    graderToolTraces: run.graderToolTraces,
  };
}
