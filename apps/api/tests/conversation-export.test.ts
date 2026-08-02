import { describe, expect, it } from "vitest";

import { buildConversationExport, renderConversationMarkdown } from "../src/conversation-export.js";

describe("conversation export", () => {
  it("renders evidence-bearing GTM objects as readable Markdown", () => {
    const exported = buildConversationExport({
      conversationId: "11111111-1111-4111-8111-111111111111",
      generatedAt: "2026-08-02T12:00:00.000Z",
      messages: [{ role: "user", content: { text: "Analyze nova.example" } }],
      interactiveObjects: [
        { id: "profile-1", conversationId: "11111111-1111-4111-8111-111111111111", version: 1, type: "company_profile", company: "Nova", domain: "nova.example", summary: "Finance automation", facts: [{ label: "Model", value: "B2B SaaS" }], pros: ["Clear pain"], cons: ["Budget unknown"] },
        { id: "icp-1", conversationId: "11111111-1111-4111-8111-111111111111", version: 1, type: "icp_score", company: "Nova", score: 91, band: "high", reasons: ["Strong workflow fit"], gaps: ["Buying process unknown"] },
        { id: "opp-1", conversationId: "11111111-1111-4111-8111-111111111111", version: 1, type: "opportunity", company: "Nova", title: "Invoice Exception Agent", summary: "Route exceptions for approval.", impact: "high", value: "high", effort: "medium", fit: "high", status: "pursue" },
        { id: "evidence-1", conversationId: "11111111-1111-4111-8111-111111111111", version: 1, type: "evidence_collection", title: "Evidence", subtitle: "Current sources", items: [{ id: "source-1", title: "Nova homepage", url: "https://nova.example", excerpt: "Finance automation for scaling teams.", classification: "fact", confidence: 4 }] },
        { id: "comparison-1", conversationId: "11111111-1111-4111-8111-111111111111", version: 1, type: "company_comparison", title: "Priority", entries: [{ company: "Nova", domain: "nova.example", rank: 1, score: 91, status: "pursue", rationale: "Best fit" }], failures: [{ domain: "broken.example", reason: "forced crawl failure" }] },
      ],
    });

    const markdown = renderConversationMarkdown(exported);

    expect(markdown).toContain("# GTM research export");
    expect(markdown).toContain("## Nova (nova.example)");
    expect(markdown).toContain("ICP score: 91/100 (high)");
    expect(markdown).toContain("### Invoice Exception Agent");
    expect(markdown).toContain("https://nova.example");
    expect(markdown).toContain("Fact · confidence 4/5");
    expect(markdown).toContain("1. Nova — 91/100 — pursue");
    expect(markdown).toContain("### Targets not analyzed");
    expect(markdown).toContain("broken.example — forced crawl failure");
  });
});
