import { describe, expect, it } from "vitest";

import {
  buildSampleToolTraces,
  evaluateAccuracyRun,
  evaluateGeneratedClaimAccuracy,
  extractUserFacingFactsFromCheckpoint,
  partitionPrecisionEvidence,
  validateAccuracyDecisions,
  validateGeneratedClaimDecisions,
  type AccuracyManifest,
  type AccuracyRun,
  type GeneratedClaimAccuracyRun,
} from "../src/index.js";

function fixture(): { manifest: AccuracyManifest; run: AccuracyRun } {
  const samples = Array.from({ length: 5 }, (_, sampleIndex) => ({
    id: `sample-${sampleIndex + 1}`,
    company: `Company ${sampleIndex + 1}`,
    domain: `company-${sampleIndex + 1}.example`,
    industry: ["developer tools", "fintech", "database", "productivity", "healthcare"][sampleIndex]!,
    stage: ["seed", "series-a", "series-c", "public", "bootstrapped"][sampleIndex]!,
    sizeBand: ["1-10", "11-50", "51-200", "1000+", "201-1000"][sampleIndex]!,
    requiredTools: ["web_search", "crawl_company"],
    claims: Array.from({ length: 20 }, (_, claimIndex) => ({
      id: `sample-${sampleIndex + 1}-claim-${claimIndex + 1}`,
      statement: `Atomic gold fact ${claimIndex + 1}`,
      weight: 1,
      sourceUrl: `https://company-${sampleIndex + 1}.example/source-${claimIndex + 1}`,
      verifiedAt: "2026-08-02T00:00:00.000Z",
    })),
  }));
  const decisions = samples.flatMap((sample) => sample.claims.map((claim) => ({
    sampleId: sample.id,
    claimId: claim.id,
    verdict: "correct" as const,
    citationUrls: [claim.sourceUrl],
    rationale: "Matches the independently curated gold fact.",
  })));
  const toolTraces = samples.flatMap((sample) => sample.requiredTools.map((toolName, index) => ({
    sampleId: sample.id,
    toolName,
    status: "completed" as const,
    traceId: `${sample.id}-trace-${index}`,
  })));
  return {
    manifest: { version: "2026-08-02", minimumScore: 97, samples },
    run: { runId: "eval-run-1", evaluatedAt: "2026-08-02T01:00:00.000Z", decisions, toolTraces },
  };
}

describe("accuracy release gate", () => {
  it("grades the user-facing synthesis facts instead of internal working evidence", () => {
    const nodes = {
      "current-research": { output: { facts: [{ company: "acme.ai", fact: "Internal draft", source: "https://acme.ai/draft" }] } },
      synthesis: {
        output: {
          output: {
            facts: [{ company: "acme.ai", fact: "Approved public fact", source: "https://acme.ai/source" }],
          },
        },
      },
    };

    expect(extractUserFacingFactsFromCheckpoint(nodes)).toEqual([
      { company: "acme.ai", fact: "Approved public fact", source: "https://acme.ai/source" },
    ]);

    expect(extractUserFacingFactsFromCheckpoint({
      synthesis: {
        output: {
          output: {
            companyProfiles: [{
              company: "acme.ai",
              facts: [{ statement: "Approved profile fact", sourceUrl: "https://acme.ai/profile-source" }],
            }],
          },
        },
      },
    })).toEqual([
      { company: "acme.ai", fact: "Approved profile fact", source: "https://acme.ai/profile-source" },
    ]);

    expect(extractUserFacingFactsFromCheckpoint({
      synthesis: {
        output: {
          output: {
            facts: [{ company: "acme.ai", statement: "Approved current fact", sourceUrl: "https://acme.ai/current-source" }],
          },
        },
      },
    })).toEqual([
      { company: "acme.ai", fact: "Approved current fact", source: "https://acme.ai/current-source" },
    ]);
  });

  it("splits precision evidence into two bounded grader payloads", () => {
    expect(partitionPrecisionEvidence(["a", "b", "c", "d", "e"])).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
    expect(() => partitionPrecisionEvidence(["only-one"])).toThrow("Precision grading requires at least two evidence items");
  });

  it("scores factual precision only from claims the product actually generated", () => {
    const { manifest, run } = fixture();
    const decisions = Array.from({ length: 100 }, (_, index) => ({
      sampleId: `sample-${(index % 5) + 1}`,
      claimId: `output-claim-${index + 1}`,
      statement: `System-produced atomic claim ${index + 1}`,
      sourceUrl: `https://company-${(index % 5) + 1}.example/evidence-${index + 1}`,
      verdict: index < 97 ? "correct" as const : "unverifiable" as const,
      citationUrls: index < 97 ? [`https://company-${(index % 5) + 1}.example/evidence-${index + 1}`] : [],
      rationale: index < 97 ? "Verified against the cited primary source." : "The cited source does not establish it.",
    }));
    const precisionRun: GeneratedClaimAccuracyRun = {
      runId: run.runId,
      evaluatedAt: run.evaluatedAt,
      decisions,
      toolTraces: run.toolTraces,
      graderToolTraces: manifest.samples.map((sample) => ({
        sampleId: sample.id,
        toolName: "web_search",
        status: "completed" as const,
        traceId: `grader:${sample.id}`,
      })),
    };

    expect(validateGeneratedClaimDecisions(decisions)).toEqual(decisions);
    expect(evaluateGeneratedClaimAccuracy(manifest, precisionRun)).toMatchObject({
      score: 97,
      accepted: true,
      correctClaims: 97,
      evaluatedClaims: 100,
    });
  });

  it("rejects generated-claim grading that covers fewer than forty claims or five samples", () => {
    const { manifest, run } = fixture();
    const decisions = Array.from({ length: 39 }, (_, index) => ({
      sampleId: `sample-${(index % 4) + 1}`,
      claimId: `output-claim-${index + 1}`,
      statement: `System-produced atomic claim ${index + 1}`,
      sourceUrl: `https://company-${(index % 4) + 1}.example/evidence-${index + 1}`,
      verdict: "correct" as const,
      citationUrls: [`https://company-${(index % 4) + 1}.example/evidence-${index + 1}`],
      rationale: "Verified against the cited primary source.",
    }));

    expect(() => evaluateGeneratedClaimAccuracy(manifest, {
      runId: run.runId,
      evaluatedAt: run.evaluatedAt,
      decisions,
      toolTraces: run.toolTraces,
      graderToolTraces: [],
    })).toThrow("Generated-claim evaluation requires at least 40 atomic claims");
  });

  it("does not credit a generated claim whose verified citation differs from its asserted source", () => {
    const { manifest, run } = fixture();
    const decisions = Array.from({ length: 40 }, (_, index) => ({
      sampleId: `sample-${(index % 5) + 1}`,
      claimId: `output-claim-${index + 1}`,
      statement: `System-produced atomic claim ${index + 1}`,
      sourceUrl: `https://company-${(index % 5) + 1}.example/evidence-${index + 1}`,
      verdict: "correct" as const,
      citationUrls: [`https://wrong.example/evidence-${index + 1}`],
      rationale: "Checked a different source.",
    }));
    const result = evaluateGeneratedClaimAccuracy(manifest, {
      runId: run.runId,
      evaluatedAt: run.evaluatedAt,
      decisions,
      toolTraces: run.toolTraces,
      graderToolTraces: manifest.samples.map((sample) => ({
        sampleId: sample.id,
        toolName: "web_search",
        status: "completed" as const,
        traceId: `grader:${sample.id}`,
      })),
    });

    expect(result.score).toBe(0);
    expect(result.claimResults[0]).toMatchObject({ credited: false, normalizedVerdict: "citation_mismatch" });
  });

  it("validates independently generated claim decisions before scoring", () => {
    const decision = {
      sampleId: "sample-1",
      claimId: "claim-1",
      verdict: "correct",
      citationUrls: ["https://example.com/source"],
      rationale: "The system asserted it and the primary source independently confirms it.",
    };

    expect(validateAccuracyDecisions([decision])).toEqual([decision]);
    expect(() => validateAccuracyDecisions([{ ...decision, verdict: "probably" }])).toThrow();
  });

  it("projects checkpoint tool evidence onto every company in a batch", () => {
    const { manifest } = fixture();
    for (const sample of manifest.samples) sample.requiredTools = ["web_search", "crawl_company"];

    const traces = buildSampleToolTraces(manifest, "workflow-run-1", {
      "current-research": { status: "completed", toolsUsed: ["web_search"] },
      "crawl-company": { status: "completed", toolsUsed: ["crawl_company"] },
      "failed-node": { status: "failed", toolsUsed: ["web_search"] },
    });

    expect(traces).toHaveLength(10);
    expect(traces).toContainEqual({
      sampleId: "sample-1",
      toolName: "web_search",
      status: "completed",
      traceId: "workflow-run-1:current-research:web_search",
    });
  });

  it("accepts an evidence-complete run scoring exactly 97", () => {
    const { manifest, run } = fixture();
    for (const index of [0, 1, 2]) {
      run.decisions[index] = { ...run.decisions[index]!, verdict: "contradicted", citationUrls: [] };
    }

    const result = evaluateAccuracyRun(manifest, run);

    expect(result.score).toBe(97);
    expect(result.accepted).toBe(true);
    expect(result.correctWeight).toBe(97);
    expect(result.evaluatedWeight).toBe(100);
  });

  it("blocks a score below 97 even by one hundredth", () => {
    const { manifest, run } = fixture();
    manifest.samples[0]!.claims[0]!.weight = 3.071450665;
    run.decisions[0] = { ...run.decisions[0]!, verdict: "unverifiable", citationUrls: [] };

    const result = evaluateAccuracyRun(manifest, run);

    expect(result.score).toBe(96.99);
    expect(result.accepted).toBe(false);
    expect(result.failures).toContain("Accuracy 96.99 is below the required 97.00");
  });

  it("blocks release when mandatory research tools were not actually completed", () => {
    const { manifest, run } = fixture();
    run.toolTraces = run.toolTraces.filter((trace) => !(trace.sampleId === "sample-3" && trace.toolName === "web_search"));

    const result = evaluateAccuracyRun(manifest, run);

    expect(result.score).toBe(100);
    expect(result.accepted).toBe(false);
    expect(result.failures).toContain("sample-3 is missing a completed web_search tool trace");
  });

  it("rejects manifests below five samples or forty atomic claims", () => {
    const { manifest, run } = fixture();
    manifest.samples.pop();
    expect(() => evaluateAccuracyRun(manifest, run)).toThrow();
  });

  it("gives zero credit to citation-mismatched correct claims", () => {
    const { manifest, run } = fixture();
    run.decisions[0] = { ...run.decisions[0]!, citationUrls: ["https://wrong.example/source"] };

    const result = evaluateAccuracyRun(manifest, run);

    expect(result.score).toBe(99);
    expect(result.claimResults[0]).toMatchObject({ credited: false, normalizedVerdict: "citation_mismatch" });
  });
});
