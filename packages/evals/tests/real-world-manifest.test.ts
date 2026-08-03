import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { validateAccuracyManifest } from "../src/index.js";

describe("real-world accuracy manifest", () => {
  it("contains five varied startup domains and forty independently checkable claims", async () => {
    const manifest = validateAccuracyManifest(JSON.parse(await readFile(
      new URL("../manifests/real-world-v1.json", import.meta.url),
      "utf8",
    )));

    expect(manifest.samples).toHaveLength(5);
    expect(manifest.samples.flatMap((sample) => sample.claims)).toHaveLength(40);
    expect(new Set(manifest.samples.map((sample) => sample.industry)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(manifest.samples.map((sample) => sample.stage)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(manifest.samples.map((sample) => sample.sizeBand)).size).toBeGreaterThanOrEqual(3);
    expect(manifest.samples.map((sample) => sample.domain).sort()).toEqual([
      "attio.com",
      "elevenlabs.io",
      "foodbegood.app",
      "langfuse.com",
      "www.missionzero.tech",
    ]);
    expect(manifest.samples.every((sample) => !["public", "established-private", "sustainable-private"].includes(sample.stage))).toBe(true);
    for (const sample of manifest.samples) {
      expect(sample.requiredTools).toEqual(expect.arrayContaining(["web_search", "crawl_company", "save_evidence", "get_claim_sources", "code_interpreter"]));
      for (const claim of sample.claims) expect(new URL(claim.sourceUrl).hostname).toMatch(sample.domain);
    }
  });
});
