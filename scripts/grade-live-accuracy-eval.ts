import { readFile, writeFile } from "node:fs/promises";

import { createOpenAIAgentsRuntime } from "@gtm/agents";
import {
  evaluateAccuracyRun,
  validateAccuracyDecisions,
  validateAccuracyManifest,
  type AccuracyDecision,
  type AccuracySample,
  type AccuracyToolTrace,
} from "@gtm/evals";

const manifestUrl = new URL("../packages/evals/manifests/real-world-v1.json", import.meta.url);
const rawResultUrl = new URL("../packages/evals/results/latest-raw.json", import.meta.url);
const resultUrl = new URL("../packages/evals/results/latest.json", import.meta.url);

const graderOutputType = {
  type: "json_schema" as const,
  name: "gtm_accuracy_grading",
  strict: true,
  schema: {
    type: "object" as const,
    properties: {
      decisions: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            sampleId: { type: "string" as const },
            claimId: { type: "string" as const },
            verdict: {
              type: "string" as const,
              enum: ["correct", "contradicted", "unverifiable", "stale", "citation_mismatch"],
            },
            citationUrls: { type: "array" as const, items: { type: "string" as const } },
            rationale: { type: "string" as const },
          },
          required: ["sampleId", "claimId", "verdict", "citationUrls", "rationale"],
          additionalProperties: false,
        },
      },
    },
    required: ["decisions"],
    additionalProperties: false,
  },
};

interface RawEvaluationArtifact {
  workflowRunId: string;
  status: string;
  evidence: unknown[];
  nodes: Record<string, unknown>;
  toolTraces: AccuracyToolTrace[];
}

function relevantEvidence(sample: AccuracySample, evidence: unknown[]) {
  const host = new URL(sample.domain.includes("://") ? sample.domain : `https://${sample.domain}`).hostname
    .replace(/^www\./, "").toLowerCase();
  const company = sample.company.toLowerCase();
  return evidence.filter((item) => {
    const serialized = JSON.stringify(item).toLowerCase();
    return serialized.includes(host) || serialized.includes(company);
  });
}

function retryDelayMs(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const seconds = message.match(/try again in\s+([0-9]+(?:\.[0-9]+)?)s/i)?.[1];
  return seconds ? Math.min(60_000, Math.max(1_000, Math.ceil(Number(seconds) * 1_000))) : 2_000;
}

async function gradeSample(
  runtime: ReturnType<typeof createOpenAIAgentsRuntime>,
  sample: AccuracySample,
  systemEvidence: unknown[],
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await runtime({
        agentName: "Independent GTM accuracy grader",
        instructions: "Independently grade the supplied system evidence against every atomic benchmark claim. You MUST call web_search and verify against the claim's primary source URL. Mark a claim correct only when (1) the SYSTEM_EVIDENCE explicitly asserts that claim or a semantically equivalent fact and (2) independent source research confirms it. Evaluate dated or 'when verified' claims at the claim's verifiedAt timestamp: later-changing live dashboard values do not make an accurately observed historical value stale. If the source confirms a fact that the system did not assert, mark it unverifiable. Use contradicted for an opposing assertion, stale only when newer evidence invalidates a claim that was intended to be current, and citation_mismatch when the asserted fact cannot be tied to the specified primary source. Never infer missing coverage. Return exactly one JSON object with a decisions array and no prose. Include one decision for every supplied claim, preserve sampleId and claimId exactly, and include the exact verified primary source URL in citationUrls only when checked.",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        tools: ["web_search"],
        requiredTools: ["web_search"],
        outputType: graderOutputType,
        input: {
          runId: `grader-${sample.id}`,
          nodeId: "independent-accuracy-grading",
          workflowInput: { ownerId: "33333333-3333-4333-8333-333333333333" },
          sample: {
            id: sample.id,
            company: sample.company,
            domain: sample.domain,
            claims: sample.claims,
          },
          systemEvidence,
        },
      });
      if (!response.usedTools.includes("web_search")) {
        throw new Error(`${sample.id} grader did not use web_search`);
      }
      const output = response.output as { decisions?: unknown };
      const decisions = validateAccuracyDecisions(output.decisions);
      const expectedClaimIds = new Set(sample.claims.map((claim) => claim.id));
      if (decisions.length !== expectedClaimIds.size
        || decisions.some((decision) => decision.sampleId !== sample.id || !expectedClaimIds.has(decision.claimId))) {
        throw new Error(`${sample.id} grader returned an incomplete or mismatched decision set`);
      }
      return {
        decisions,
        trace: {
          sampleId: sample.id,
          toolName: "web_search",
          status: "completed" as const,
          traceId: response.responseId ?? `grader:${sample.id}:${attempt}`,
        },
      };
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs(error)));
    }
  }
  throw lastError;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for independent live grading");
  const manifest = validateAccuracyManifest(JSON.parse(await readFile(manifestUrl, "utf8")));
  const raw = JSON.parse(await readFile(rawResultUrl, "utf8")) as RawEvaluationArtifact;
  if (raw.status !== "raw_requires_independent_grading") {
    throw new Error(`Raw evaluation is not gradeable: ${raw.status}`);
  }

  const runtime = createOpenAIAgentsRuntime({ maxTurns: 8 });
  const decisions: AccuracyDecision[] = [];
  const graderToolTraces: AccuracyToolTrace[] = [];
  for (const sample of manifest.samples) {
    const systemEvidence = relevantEvidence(sample, raw.evidence);
    const graded = await gradeSample(runtime, sample, systemEvidence);
    decisions.push(...graded.decisions);
    graderToolTraces.push(graded.trace);
  }

  const evaluatedAt = new Date().toISOString();
  const run = {
    runId: raw.workflowRunId,
    evaluatedAt,
    decisions,
    toolTraces: raw.toolTraces,
  };
  const evaluation = evaluateAccuracyRun(manifest, run);
  await writeFile(resultUrl, `${JSON.stringify({
    ...evaluation,
    evaluatedAt,
    decisions,
    toolTraces: raw.toolTraces,
    graderToolTraces,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log(JSON.stringify({
    workflowRunId: raw.workflowRunId,
    score: evaluation.score,
    minimumScore: evaluation.minimumScore,
    accepted: evaluation.accepted,
    failures: evaluation.failures,
    graderWebSearchTraces: graderToolTraces.length,
    result: "packages/evals/results/latest.json",
  }, null, 2));
  if (!evaluation.accepted) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
