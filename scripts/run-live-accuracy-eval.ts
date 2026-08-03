import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildSampleToolTraces, validateAccuracyManifest } from "@gtm/evals";

import { createApplicationResearchService } from "../apps/api/src/bootstrap.js";
import {
  createFileResearchPersistence,
  evaluationProtocolFingerprint,
  findReusableEvaluationRun,
} from "../apps/api/src/file-research-persistence.js";

const manifestUrl = new URL("../packages/evals/manifests/real-world-v1.json", import.meta.url);
const resultUrl = new URL("../packages/evals/results/latest-raw.json", import.meta.url);
const ownerId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const evaluationMessage = "Compare these companies for an AI and agent-automation consultancy. Research company background, product, funding or ownership stage, operating scale, hiring signals, technology signals, ICP fit, risks, and automation opportunities. Ground every material fact in current primary-source evidence and retain uncertainty.";
const protocolSourceUrls = [
  manifestUrl,
  new URL("../packages/agents/src/index.ts", import.meta.url),
  new URL("../packages/orchestration/src/index.ts", import.meta.url),
  new URL("../packages/evals/src/index.ts", import.meta.url),
  new URL("../apps/api/src/bootstrap.ts", import.meta.url),
  new URL("../apps/api/src/portfolio-tools.ts", import.meta.url),
];

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for the live accuracy evaluation");
  const manifest = validateAccuracyManifest(JSON.parse(await readFile(manifestUrl, "utf8")));
  const protocolFingerprint = evaluationProtocolFingerprint(await Promise.all(
    protocolSourceUrls.map((url) => readFile(url, "utf8")),
  ));
  const stateUrl = new URL(`../packages/evals/results/live-state-${protocolFingerprint}.json`, import.meta.url);
  const persistence = await createFileResearchPersistence(fileURLToPath(stateUrl));
  const { runStore, artifactStore } = persistence;
  let execution: Promise<void> | undefined;
  const service = createApplicationResearchService({
    persistence,
    enqueue: (job) => { execution = job(); },
  });
  const input = {
    ownerId,
    conversationId,
    message: evaluationMessage,
    domains: manifest.samples.map((sample) => sample.domain),
    documentIds: [],
  };
  const reusable = findReusableEvaluationRun(await runStore.listForConversation(conversationId), input);
  const started = reusable ?? await service.startDomainResearch(input);
  if (reusable && reusable.status !== "completed") await service.resumeRun(reusable.runId, ownerId);
  if (execution) await execution;
  const snapshot = await runStore.load(started.runId);
  if (!snapshot?.checkpoint) throw new Error("Live evaluation did not retain a workflow checkpoint");
  if (snapshot.status !== "completed" || snapshot.checkpoint.status !== "completed") {
    const failedNodes = Object.entries(snapshot.checkpoint.nodes)
      .filter(([, node]) => node.status === "failed")
      .map(([nodeId, node]) => ({ nodeId, error: node.error ?? "unknown error", toolsUsed: node.toolsUsed }));
    const context = { ownerId, runId: started.runId };
    await writeFile(new URL("../packages/evals/results/latest-failed.json", import.meta.url), `${JSON.stringify({
      workflowRunId: started.runId,
      protocolFingerprint,
      resumableState: `packages/evals/results/live-state-${protocolFingerprint}.json`,
      status: snapshot.status,
      failedNodes,
      nodes: snapshot.checkpoint.nodes,
      evidence: await artifactStore.listEvidence(context),
      crawledPages: await artifactStore.listCrawledPages(context),
    }, null, 2)}\n`, { mode: 0o600 });
    throw new Error(`Live evaluation workflow failed: ${failedNodes.map(({ nodeId, error }) => `${nodeId}: ${error}`).join("; ") || snapshot.error || snapshot.checkpoint.status}`);
  }
  const nodes = snapshot.checkpoint.nodes;
  const toolTraces = buildSampleToolTraces(manifest, started.runId, nodes);
  const evidence = await artifactStore.listEvidence({ ownerId, runId: started.runId });
  const missingTools = manifest.samples.flatMap((sample) => sample.requiredTools.filter((toolName) =>
    !toolTraces.some((trace) => trace.sampleId === sample.id && trace.toolName === toolName),
  ).map((toolName) => `${sample.id}:${toolName}`));
  if (missingTools.length > 0) throw new Error(`Live evaluation is missing required tool traces: ${missingTools.join(", ")}`);

  await writeFile(resultUrl, `${JSON.stringify({
    manifestVersion: manifest.version,
    workflowRunId: started.runId,
    protocolFingerprint,
    resumed: Boolean(reusable),
    evaluatedAt: new Date().toISOString(),
    status: "raw_requires_independent_grading",
    toolTraces,
    evidence,
    nodes,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    workflowRunId: started.runId,
    workflowStatus: snapshot.status,
    protocolFingerprint,
    resumed: Boolean(reusable),
    samples: manifest.samples.length,
    atomicGoldClaims: manifest.samples.flatMap((sample) => sample.claims).length,
    evidenceItems: evidence.length,
    toolTraceCount: toolTraces.length,
    result: "packages/evals/results/latest-raw.json",
    nextGate: "independent claim grading and score >= 97",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
