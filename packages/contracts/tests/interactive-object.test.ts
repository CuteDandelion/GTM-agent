import { describe, expect, it } from "vitest";

const progressFixture = {
  id: "object_acme_research",
  conversationId: "conversation_acme",
  version: 1,
  type: "workflow_progress",
  title: "Researching Acme",
  live: true,
  steps: [
    { id: "plan", label: "Plan", agent: "Sol", status: "completed" },
    { id: "research", label: "Research", agent: "Luna", status: "running" },
    { id: "analyze", label: "Analyze", agent: "Terra", status: "pending" },
    { id: "review", label: "Review", agent: "Sol", status: "pending" }
  ]
} as const;

async function loadContracts() {
  return import("../src/index.js").catch(() => ({}));
}

describe("interactive object contract", () => {
  it("accepts the canonical research-progress object", async () => {
    const contracts = await loadContracts();
    const parseInteractiveObject = Reflect.get(contracts, "parseInteractiveObject");

    expect(typeof parseInteractiveObject).toBe("function");
    expect(parseInteractiveObject(progressFixture)).toEqual(progressFixture);
  });

  it("rejects executable fields invented by a model", async () => {
    const contracts = await loadContracts();
    const parseInteractiveObject = Reflect.get(contracts, "parseInteractiveObject");
    const unsafeObject = {
      ...progressFixture,
      render: "() => fetch('https://example.com')"
    };

    expect(typeof parseInteractiveObject).toBe("function");
    expect(() => parseInteractiveObject(unsafeObject)).toThrow();
  });

  it("supports exactly the six trusted mobile object families", async () => {
    const contracts = await loadContracts();
    expect(Reflect.get(contracts, "interactiveObjectTypes")).toEqual([
      "workflow_progress",
      "company_profile",
      "icp_score",
      "opportunity",
      "evidence_collection",
      "company_comparison",
    ]);

    const parseInteractiveObject = Reflect.get(contracts, "parseInteractiveObject");
    const base = { id: "object-1", conversationId: "conversation-1", version: 1 };
    const objects = [
      progressFixture,
      { ...base, type: "company_profile", company: "Acme", domain: "acme.ai", summary: "Support automation", facts: [{ label: "Model", value: "B2B SaaS" }], pros: ["AI native"], cons: ["Opaque pricing"] },
      { ...base, type: "icp_score", company: "Acme", score: 82, band: "high", reasons: ["Strong workflow fit"], gaps: ["Buyer unknown"] },
      { ...base, type: "opportunity", company: "Acme", title: "Support triage", summary: "Automate routing", impact: "high", value: "high", effort: "medium", fit: "high", status: "research" },
      { ...base, type: "evidence_collection", title: "Evidence", subtitle: "Sources", items: [{ id: "e-1", title: "Homepage", url: "https://acme.ai", excerpt: "Support automation", classification: "fact", confidence: 4 }] },
      { ...base, type: "company_comparison", title: "Target ranking", entries: [{ company: "Acme", domain: "acme.ai", rank: 1, score: 82, status: "pursue", rationale: "Best fit" }] },
    ];
    for (const object of objects) expect(parseInteractiveObject(object)).toEqual(object);
  });
});
