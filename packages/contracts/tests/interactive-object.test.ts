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

  it("supports the trusted mobile object families including agent-authored interaction prompts", async () => {
    const contracts = await loadContracts();
    expect(Reflect.get(contracts, "interactiveObjectTypes")).toEqual([
      "workflow_progress",
      "company_profile",
      "icp_score",
      "opportunity",
      "evidence_collection",
      "company_comparison",
      "interaction_prompt",
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
      {
        ...base,
        type: "interaction_prompt",
        purpose: "clarification",
        title: "Choose the comparison lens",
        prompt: "What matters most for this shortlist?",
        selection: "single",
        options: [
          { id: "fastest-win", label: "Fastest win", description: "Prefer low-effort automation opportunities." },
          { id: "largest-value", label: "Largest value", description: "Prefer strategic upside over speed." },
        ],
        allowFreeText: true,
      },
    ];
    for (const object of objects) expect(parseInteractiveObject(object)).toEqual(object);
  });

  it("keeps failed batch targets explicit without assigning them a fabricated rank", async () => {
    const contracts = await loadContracts();
    const parseInteractiveObject = Reflect.get(contracts, "parseInteractiveObject");
    const comparison = {
      id: "comparison-1",
      conversationId: "conversation-1",
      version: 1,
      type: "company_comparison",
      title: "Target ranking",
      entries: [
        { company: "Alpha", domain: "alpha.example", rank: 1, score: 82, status: "pursue", rationale: "Strongest supported fit" },
      ],
      failures: [
        { domain: "broken.example", reason: "forced crawl failure" },
      ],
    };

    expect(parseInteractiveObject(comparison)).toEqual(comparison);
  });
});
