import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createOpenCodeRuntime, startOpenCodeAgentService, type AgentRuntime } from "@gtm/agents";
import {
  evaluateGeneratedClaimAccuracy,
  extractUserFacingFactsFromCheckpoint,
  validateAccuracyManifest,
  validateGeneratedClaimDecisions,
  type AccuracySample,
  type AccuracyToolTrace,
  type GeneratedClaimDecision,
} from "@gtm/evals";

const manifestUrl = new URL("../packages/evals/manifests/real-world-v1.json", import.meta.url);
const rawResultUrl = new URL("../packages/evals/results/latest-raw.json", import.meta.url);
const resultUrl = new URL("../packages/evals/results/latest-generated-claim.json", import.meta.url);

const graderOutputType = {
  type: "json_schema" as const,
  name: "gtm_generated_claim_accuracy_grading",
  strict: true,
  schema: {
    type: "object" as const,
    properties: {
      decisions: {
        type: "array" as const,
        minItems: 4,
        items: {
          type: "object" as const,
          properties: {
            sampleId: { type: "string" as const },
            claimId: { type: "string" as const },
            statement: { type: "string" as const },
            sourceUrl: { type: "string" as const },
            verdict: {
              type: "string" as const,
              enum: ["correct", "contradicted", "unverifiable", "stale", "citation_mismatch"],
            },
            citationUrls: { type: "array" as const, items: { type: "string" as const } },
            rationale: { type: "string" as const },
          },
          required: ["sampleId", "claimId", "statement", "sourceUrl", "verdict", "citationUrls", "rationale"],
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

async function gradeGeneratedClaims(
  runtime: AgentRuntime,
  sample: AccuracySample,
  systemEvidence: unknown[],
  batchNumber: number,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await runtime({
        agentName: "Independent generated-claim accuracy grader",
        instructions: "Grade only factual claims that the product actually emitted in SYSTEM_EVIDENCE. You do not have benchmark answers. Split every compound factual statement into all of its atomic claims without adding facts, changing meaning, or omitting a factual clause. Exclude recommendations, hypotheses, fit scores, subjective assessments, risks, and statements that merely say information was not found. Produce at least four atomic decisions when the supplied evidence contains enough factual assertions; never invent a claim to reach a count. For each atomic claim, preserve the exact source URL asserted by the product as sourceUrl, call web_search, inspect that primary source, and independently decide whether the source establishes the statement. Mark correct only when the source supports the complete atomic statement. Use contradicted for opposing evidence, unverifiable when the source does not establish it, stale when newer primary evidence invalidates a current claim, and citation_mismatch when the asserted URL is not the source that supports it. citationUrls must contain only primary URLs you actually checked. Keep every statement and rationale concise. Return exactly one JSON object with a decisions array and no prose. Use the supplied sample id exactly and stable claim ids in the form SAMPLE_ID-batch-BATCH_NUMBER-output-N.",
        model: "opencode-go/minimax-m3",
        reasoningEffort: "high",
        maxOutputTokens: 8_192,
        tools: ["web_search"],
        requiredTools: ["web_search"],
        outputType: graderOutputType,
        input: {
          runId: `generated-claim-grader-${sample.id}-batch-${batchNumber}`,
          nodeId: "independent-generated-claim-grading",
          workflowInput: { ownerId: "33333333-3333-4333-8333-333333333333" },
          sample: { id: sample.id, company: sample.company, domain: sample.domain, batchNumber },
          systemEvidence,
        },
      });
      if (!response.usedTools.includes("web_search")) {
        throw new Error(`${sample.id} generated-claim grader did not use web_search`);
      }
      const output = response.output as { decisions?: unknown };
      const decisions = validateGeneratedClaimDecisions(output.decisions);
      if (decisions.length < 4 || decisions.some((decision) => decision.sampleId !== sample.id)) {
        throw new Error(`${sample.id} batch ${batchNumber} returned fewer than four claims or mismatched sample ids`);
      }
      return {
        decisions,
        trace: {
          sampleId: sample.id,
          toolName: "web_search",
          status: "completed" as const,
          traceId: response.responseId ?? `generated-claim-grader:${sample.id}:${batchNumber}:${attempt}`,
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
  if (!process.env.OPENCODE_KEY) throw new Error("OPENCODE_KEY is required for generated-claim grading");
  const openCode = await startOpenCodeAgentService({
    directory: fileURLToPath(new URL("../apps/api/", import.meta.url)),
  });
  try {
  const manifest = validateAccuracyManifest(JSON.parse(await readFile(manifestUrl, "utf8")));
  const raw = JSON.parse(await readFile(rawResultUrl, "utf8")) as RawEvaluationArtifact;
  if (raw.status !== "raw_requires_independent_grading") {
    throw new Error(`Raw evaluation is not gradeable: ${raw.status}`);
  }

  const runtime = createOpenCodeRuntime({ transport: openCode.transport, bridge: openCode.bridge });
  const decisions: GeneratedClaimDecision[] = [];
  const graderToolTraces: AccuracyToolTrace[] = [];
  const userFacingFacts = extractUserFacingFactsFromCheckpoint(raw.nodes);
  for (const sample of manifest.samples) {
    const systemEvidence = relevantEvidence(sample, userFacingFacts);
    const batches = [systemEvidence];
    for (const [index, batch] of batches.entries()) {
      const graded = await gradeGeneratedClaims(runtime, sample, batch, index + 1);
      decisions.push(...graded.decisions);
      graderToolTraces.push(graded.trace);
    }
  }

  const evaluatedAt = new Date().toISOString();
  const evaluation = evaluateGeneratedClaimAccuracy(manifest, {
    runId: raw.workflowRunId,
    evaluatedAt,
    decisions,
    toolTraces: raw.toolTraces,
    graderToolTraces,
  });
  await writeFile(resultUrl, `${JSON.stringify({
    evaluationVersion: "generated-claim-precision-v1",
    ...evaluation,
    evaluatedAt,
    decisions,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log(JSON.stringify({
    workflowRunId: raw.workflowRunId,
    score: evaluation.score,
    minimumScore: evaluation.minimumScore,
    evaluatedClaims: evaluation.evaluatedClaims,
    accepted: evaluation.accepted,
    failures: evaluation.failures,
    graderWebSearchTraces: graderToolTraces.length,
    result: "packages/evals/results/latest-generated-claim.json",
    benchmarkCoverageReference: "packages/evals/results/latest.json",
  }, null, 2));
  if (!evaluation.accepted) process.exitCode = 1;
  } finally {
    await openCode.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
