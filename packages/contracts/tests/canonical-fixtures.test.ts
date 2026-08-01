import { describe, expect, it } from "vitest";

async function loadContracts() {
  return import("../src/index.js").catch(() => ({}));
}

describe("canonical Acme fixtures", () => {
  it("exports schema-valid progress, assessment, and evidence objects", async () => {
    const contracts = await loadContracts();
    const parseInteractiveObject = Reflect.get(contracts, "parseInteractiveObject");
    const parseCompanyAssessmentObject = Reflect.get(contracts, "parseCompanyAssessmentObject");
    const parseCanonicalFixtureBundle = Reflect.get(contracts, "parseCanonicalFixtureBundle");
    const fixtures = Reflect.get(contracts, "canonicalAcmeFixtures");

    expect(fixtures).toBeDefined();
    expect(fixtures.progress.title).toBe("Researching Acme");
    expect(fixtures.assessment.icpScore).toBe(82);
    expect(fixtures.assessment.opportunity.title).toBe("Support Triage Agent");
    expect(fixtures.evidence.items).toHaveLength(3);
    expect(fixtures.evidence.items.map((item: { classification: string }) => item.classification)).toEqual([
      "fact",
      "fact",
      "inference"
    ]);

    expect(parseInteractiveObject(fixtures.progress)).toEqual(fixtures.progress);
    expect(parseCompanyAssessmentObject(fixtures.assessment)).toEqual(fixtures.assessment);
    expect(parseInteractiveObject(fixtures.evidence)).toEqual(fixtures.evidence);
    expect(parseCanonicalFixtureBundle(fixtures)).toEqual(fixtures);
  });

  it("rejects an out-of-range ICP score and confidence", async () => {
    const contracts = await loadContracts();
    const parseCompanyAssessmentObject = Reflect.get(contracts, "parseCompanyAssessmentObject");
    const parseInteractiveObject = Reflect.get(contracts, "parseInteractiveObject");
    const fixtures = Reflect.get(contracts, "canonicalAcmeFixtures");

    expect(() => parseCompanyAssessmentObject({ ...fixtures.assessment, icpScore: 101 })).toThrow();
    expect(() =>
      parseInteractiveObject({
        ...fixtures.evidence,
        items: [{ ...fixtures.evidence.items[0], confidence: 6 }]
      })
    ).toThrow();
  });
});
