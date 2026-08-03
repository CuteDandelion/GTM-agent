import { describe, expect, it, vi } from "vitest";

import { createConversationAgent } from "../src/conversation-agent.js";

describe("conversation agent", () => {
  it("gives the model the dialogue, tool catalog, and freedom to choose a non-research answer", async () => {
    const runtime = vi.fn(async () => ({
      output: {
        kind: "answer",
        message: "We can start by defining your ICP before choosing targets.",
      },
      usedTools: [],
      responseId: "response-1",
    }));
    const agent = createConversationAgent({ runtime, availableModels: new Set(["gpt-5.6-terra"]) });

    const decision = await agent.decide({
      ownerId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      message: "Where should I start?",
      suppliedDomains: [],
      documentIds: [],
      history: [{ role: "user", content: { text: "I sell agent automation" } }],
      sellerProfile: { offerSummary: "Agent automation" },
      interactiveObjects: [],
    });

    expect(decision).toEqual({
      kind: "answer",
      message: "We can start by defining your ICP before choosing targets.",
      usedTools: [],
      responseId: "response-1",
    });
    expect(runtime).toHaveBeenCalledWith(expect.objectContaining({
      agentName: "GTM conversation orchestrator",
      model: "gpt-5.6-terra",
      tools: ["web_search", "file_search", "code_interpreter"],
      requiredTools: [],
      input: expect.objectContaining({
        conversationHistory: expect.any(Array),
        userMessage: "Where should I start?",
      }),
    }));
  });

  it("rejects model-authored tools or capabilities outside the application allowlist", async () => {
    const runtime = vi.fn(async () => ({
      output: {
        kind: "research",
        message: "I will do that.",
        domains: ["foodbegood.app"],
        plan: { objective: "Send outreach", capabilities: ["send_email"] },
      },
      usedTools: ["send_email"],
    }));
    const agent = createConversationAgent({ runtime, availableModels: new Set(["gpt-5.6-terra"]) });

    await expect(agent.decide({
      ownerId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      message: "Research and email them",
      suppliedDomains: ["foodbegood.app"],
      documentIds: [],
      history: [],
      sellerProfile: {},
      interactiveObjects: [],
    })).rejects.toThrow(/decision contract/i);
  });
});
