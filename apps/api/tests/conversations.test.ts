import { afterEach, describe, expect, it, vi } from "vitest";

import { buildServer, type ConversationAgent, type ConversationDecision, type ResearchService } from "../src/server.js";
import { ResearchAdmissionError, ResearchRunConflictError } from "../src/research-service.js";

const servers: Array<ReturnType<typeof buildServer>> = [];

const researchDecision = (domains: string[]): ConversationDecision => ({
  kind: "research",
  message: "I’ll investigate that with current evidence.",
  domains,
  plan: {
    objective: "Answer the user's company research request",
    capabilities: ["company_profile", "current_web", "icp_assessment", "opportunity_analysis"],
  },
  usedTools: [],
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("conversational research API", () => {
  it("bounds sequential model-backed turns per owner and resets the budget after the configured window", async () => {
    let currentTime = 1_000;
    const decide = vi.fn(async () => ({ kind: "answer" as const, message: "Done", usedTools: [] }));
    const server = buildServer({
      logger: false,
      authService: { authenticate: async () => ({ userId: "owner-1" }) },
      conversationAgent: { decide },
      researchService: { startDomainResearch: vi.fn(), getRun: async () => undefined, cancelRun: async () => undefined, resumeRun: async () => undefined },
      conversationAdmission: {
        maxGlobal: 5,
        maxPerOwner: 5,
        maxRequestsGlobalPerWindow: 5,
        maxRequestsPerOwnerPerWindow: 2,
        windowMs: 10_000,
        now: () => currentTime,
      },
    });
    servers.push(server);
    const request = () => server.inject({
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer valid" },
      url: "/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages",
      payload: { message: "Analyze foodbegood.app" },
    });

    expect((await request()).statusCode).toBe(200);
    expect((await request()).statusCode).toBe(200);
    const exhausted = await request();
    expect(exhausted.statusCode).toBe(429);
    expect(exhausted.headers["retry-after"]).toBe("10");
    expect(exhausted.json()).toEqual({ error: "conversation_capacity_exceeded", retryAfterSeconds: 10 });
    expect(decide).toHaveBeenCalledTimes(2);

    currentTime = 10_999;
    expect((await request()).headers["retry-after"]).toBe("1");
    currentTime = 11_000;
    expect((await request()).statusCode).toBe(200);
    expect(decide).toHaveBeenCalledTimes(3);
  });

  it("bounds sequential model-backed turns globally across owners", async () => {
    const decide = vi.fn(async () => ({ kind: "answer" as const, message: "Done", usedTools: [] }));
    const server = buildServer({
      logger: false,
      authService: { authenticate: async (authorization) => ({ userId: authorization?.slice("Bearer ".length) ?? "missing" }) },
      conversationAgent: { decide },
      researchService: { startDomainResearch: vi.fn(), getRun: async () => undefined, cancelRun: async () => undefined, resumeRun: async () => undefined },
      conversationAdmission: {
        maxGlobal: 5,
        maxPerOwner: 5,
        maxRequestsGlobalPerWindow: 2,
        maxRequestsPerOwnerPerWindow: 2,
        windowMs: 60_000,
        now: () => 5_000,
      },
    });
    servers.push(server);
    const request = (owner: string) => server.inject({
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${owner}` },
      url: "/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages",
      payload: { message: "Analyze foodbegood.app" },
    });

    expect((await request("owner-1")).statusCode).toBe(200);
    expect((await request("owner-2")).statusCode).toBe(200);
    const exhausted = await request("owner-3");
    expect(exhausted.statusCode).toBe(429);
    expect(exhausted.headers["retry-after"]).toBe("60");
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it("rejects a second model-backed turn for the same owner before invoking the provider", async () => {
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const decide = vi.fn(async () => {
      markFirstStarted();
      await firstBlocked;
      return { kind: "answer" as const, message: "Done", usedTools: [] };
    });
    const server = buildServer({
      logger: false,
      authService: { authenticate: async () => ({ userId: "owner-1" }) },
      conversationAgent: { decide },
      researchService: { startDomainResearch: vi.fn(), getRun: async () => undefined, cancelRun: async () => undefined, resumeRun: async () => undefined },
      conversationAdmission: { maxGlobal: 2, maxPerOwner: 1, retryAfterSeconds: 9 },
    });
    servers.push(server);
    const request = () => server.inject({
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer valid" },
      url: "/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages",
      payload: { message: "Analyze foodbegood.app" },
    });

    const first = request();
    await firstStarted;
    const rejected = await request();

    expect(rejected.statusCode).toBe(429);
    expect(rejected.headers["retry-after"]).toBe("9");
    expect(rejected.json()).toEqual({ error: "conversation_capacity_exceeded", retryAfterSeconds: 9 });
    expect(decide).toHaveBeenCalledOnce();
    releaseFirst();
    expect((await first).statusCode).toBe(200);
    expect((await request()).statusCode).toBe(200);
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it("enforces the global model-backed turn limit across different owners", async () => {
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const decide = vi.fn(async () => {
      markFirstStarted();
      await firstBlocked;
      return { kind: "answer" as const, message: "Done", usedTools: [] };
    });
    const server = buildServer({
      logger: false,
      authService: {
        authenticate: async (authorization) => ({ userId: authorization === "Bearer first" ? "owner-1" : "owner-2" }),
      },
      conversationAgent: { decide },
      researchService: { startDomainResearch: vi.fn(), getRun: async () => undefined, cancelRun: async () => undefined, resumeRun: async () => undefined },
      conversationAdmission: { maxGlobal: 1, maxPerOwner: 1, retryAfterSeconds: 4 },
    });
    servers.push(server);
    const request = (authorization: string) => server.inject({
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      url: "/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages",
      payload: { message: "Analyze foodbegood.app" },
    });

    const first = request("Bearer first");
    await firstStarted;
    const rejected = await request("Bearer second");

    expect(rejected.statusCode).toBe(429);
    expect(rejected.json()).toEqual({ error: "conversation_capacity_exceeded", retryAfterSeconds: 4 });
    expect(decide).toHaveBeenCalledOnce();
    releaseFirst();
    expect((await first).statusCode).toBe(200);
  });

  it("returns a bounded retry response when the research queue is full", async () => {
    const server = buildServer({
      logger: false,
      conversationAgent: { decide: async () => researchDecision(["foodbegood.app"]) },
      researchService: {
        startDomainResearch: async () => { throw new ResearchAdmissionError(12); },
        getRun: async () => undefined,
        cancelRun: async () => undefined,
        resumeRun: async () => undefined,
      },
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const response = await fetch(`${origin}/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Analyze foodbegood.app", domains: ["foodbegood.app"] }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(await response.json()).toEqual({ error: "research_capacity_exceeded", retryAfterSeconds: 12 });
  });

  it("lets the conversation agent answer a domain-free turn without starting research", async () => {
    const startDomainResearch = vi.fn();
    const decide = vi.fn(async () => ({
      kind: "answer" as const,
      message: "I can profile companies, compare ICP fit, or examine a specific GTM hypothesis.",
      usedTools: [],
    }));
    const appended: Array<{ role: string; content: Record<string, unknown> }> = [];
    const server = buildServer({
      logger: false,
      authService: { authenticate: async () => ({ userId: "11111111-1111-4111-8111-111111111111" }) },
      conversationAgent: { decide },
      researchService: { startDomainResearch, getRun: async () => undefined, cancelRun: async () => undefined, resumeRun: async () => undefined },
      workspaceService: {
        getSellerProfile: async () => ({ offerSummary: "AI automation" }),
        upsertSellerProfile: async () => ({}),
        createConversation: async () => ({}),
        listConversations: async () => [],
        getConversation: async () => ({}),
        appendMessage: async (_ownerId, _conversationId, input) => {
          appended.push(input);
          return { id: `message-${appended.length}` };
        },
        listMessages: async () => [],
      },
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const response = await fetch(`${origin}/api/v1/conversations/22222222-2222-4222-8222-222222222222/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer valid" },
      body: JSON.stringify({ message: "What can you help me with?" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "answer",
      message: "I can profile companies, compare ICP fit, or examine a specific GTM hypothesis.",
      usedTools: [],
      interactiveObjects: [],
    });
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({
      message: "What can you help me with?",
      history: [],
      sellerProfile: { offerSummary: "AI automation" },
    }));
    expect(startDomainResearch).not.toHaveBeenCalled();
    expect(appended.map(({ role }) => role)).toEqual(["user", "assistant"]);
  });

  it("returns the agent's clarification instead of forcing a company workflow", async () => {
    const conversationAgent: ConversationAgent = {
      decide: vi.fn(async (): Promise<ConversationDecision> => ({
        kind: "clarify",
        message: "Which company or market should I evaluate?",
        usedTools: [],
        objects: [{
          key: "target-scope",
          type: "interaction_prompt" as const,
          purpose: "clarification" as const,
          title: "Choose a target scope",
          prompt: "What should I evaluate?",
          selection: "single" as const,
          options: [{ id: "company", label: "A company" }, { id: "market", label: "A market" }],
          allowFreeText: true,
        }],
      })),
    };
    const startDomainResearch = vi.fn();
    const publish = vi.fn(async ({ object }: { object: Record<string, unknown> }) => ({
      id: "prompt-1",
      conversationId: "11111111-1111-4111-8111-111111111111",
      version: 1,
      ...object,
    }));
    const server = buildServer({
      logger: false,
      authService: { authenticate: async () => ({ userId: "33333333-3333-4333-8333-333333333333" }) },
      conversationAgent,
      researchService: { startDomainResearch, getRun: async () => undefined, cancelRun: async () => undefined, resumeRun: async () => undefined },
      objectActionService: {
        publish,
        listForConversation: async () => [],
        applyAction: async () => undefined,
      },
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const response = await fetch(`${origin}/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer valid" },
      body: JSON.stringify({ message: "Find me the best opportunity" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: "clarify",
      message: "Which company or market should I evaluate?",
      interactiveObjects: [{ id: "prompt-1", type: "interaction_prompt" }],
    });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      objectKey: "conversation-prompt:target-scope",
      object: expect.objectContaining({ type: "interaction_prompt", purpose: "clarification" }),
    }));
    expect(startDomainResearch).not.toHaveBeenCalled();
  });

  it("starts only the bounded DAG capabilities selected by the conversation agent", async () => {
    const startDomainResearch = vi.fn(async () => ({
      runId: "run-dynamic-1",
      status: "queued" as const,
      queuePosition: 1,
      interactiveObject: {},
    }));
    const server = buildServer({
      logger: false,
      conversationAgent: {
        decide: vi.fn(async (): Promise<ConversationDecision> => ({
          kind: "research",
          message: "I’ll verify the company and assess its ICP fit.",
          domains: ["foodbegood.app"],
          plan: {
            objective: "Profile the company and assess ICP fit",
            capabilities: ["company_profile", "current_web", "icp_assessment"],
          },
          usedTools: ["web_search"],
        })),
      },
      researchService: { startDomainResearch, getRun: async () => undefined, cancelRun: async () => undefined, resumeRun: async () => undefined },
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const response = await fetch(`${origin}/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Would foodbegood.app fit my ICP?" }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ kind: "research", runId: "run-dynamic-1" });
    expect(startDomainResearch).toHaveBeenCalledWith(expect.objectContaining({
      domains: ["foodbegood.app"],
      researchPlan: {
        objective: "Profile the company and assess ICP fit",
        capabilities: ["company_profile", "current_web", "icp_assessment"],
      },
    }));
  });

  it("starts a validated domain-analysis run from a chat message", async () => {
    const startDomainResearch = vi.fn(async () => ({
      runId: "run-foodbegood-1",
      status: "queued" as const,
      interactiveObject: {
        id: "progress-foodbegood-1",
        type: "workflow_progress" as const,
        version: 1,
        title: "Researching Foodbegood",
        status: "running" as const,
        steps: [],
      },
    }));
    const researchService: ResearchService = {
      startDomainResearch,
      getRun: async () => undefined,
      cancelRun: async () => undefined,
      resumeRun: async () => undefined,
    };
    const server = buildServer({
      logger: false,
      researchService,
      conversationAgent: { decide: async (input) => researchDecision(input.suppliedDomains) },
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const response = await fetch(`${origin}/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Analyze foodbegood.app", domains: ["foodbegood.app"] }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ runId: "run-foodbegood-1", status: "queued" });
    expect(startDomainResearch).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Analyze foodbegood.app",
      domains: ["foodbegood.app"],
      documentIds: [],
    }));
  });

  it("inherits the latest domains for a domain-free follow-up in the same conversation", async () => {
    const startDomainResearch = vi.fn(async () => ({ runId: "run-follow-up", status: "queued" as const, interactiveObject: {} }));
    const appendMessage = vi.fn(async () => ({ id: "message-follow-up" }));
    const listMessages = vi.fn(async () => [{
      role: "user",
      content: { text: "Analyze foodbegood.app", domains: ["foodbegood.app"] },
    }]);
    const server = buildServer({
      logger: false,
      authService: { authenticate: async () => ({ userId: "owner-1" }) },
      conversationAgent: { decide: async () => researchDecision(["foodbegood.app"]) },
      researchService: { startDomainResearch, getRun: async () => undefined, cancelRun: async () => undefined, resumeRun: async () => undefined },
      workspaceService: {
        getSellerProfile: async () => undefined,
        upsertSellerProfile: async () => ({}),
        createConversation: async () => ({}),
        listConversations: async () => [],
        getConversation: async () => ({}),
        appendMessage,
        listMessages,
      },
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const response = await fetch(`${origin}/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer valid" },
      body: JSON.stringify({ message: "What are the strongest pros and cons?", domains: [] }),
    });

    expect(response.status).toBe(202);
    expect(startDomainResearch).toHaveBeenCalledWith(expect.objectContaining({
      message: "What are the strongest pros and cons?",
      domains: ["foodbegood.app"],
    }));
    expect(appendMessage).toHaveBeenCalledWith("owner-1", expect.any(String), expect.objectContaining({
      content: expect.objectContaining({ domains: [] }),
    }));
    expect(appendMessage).toHaveBeenCalledWith("owner-1", expect.any(String), {
      role: "assistant",
      content: expect.objectContaining({ runId: "run-follow-up", status: "queued" }),
    });
  });

  it("rejects invalid or oversized batches before orchestration", async () => {
    const startDomainResearch = vi.fn();
    const server = buildServer({
      logger: false,
      conversationAgent: { decide: vi.fn() },
      researchService: { startDomainResearch, getRun: async () => undefined, cancelRun: async () => undefined, resumeRun: async () => undefined },
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const response = await fetch(`${origin}/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Analyze these",
        domains: ["one.example", "two.example", "three.example", "four.example", "five.example", "six.example"],
      }),
    });

    expect(response.status).toBe(400);
    expect(startDomainResearch).not.toHaveBeenCalled();
  });

  it("returns a persisted run snapshot", async () => {
    const researchService: ResearchService = {
      startDomainResearch: vi.fn(),
      getRun: async (runId) => runId === "run-1" ? { runId, status: "running", nodes: { plan: "completed" } } : undefined,
      cancelRun: async () => undefined,
      resumeRun: async () => undefined,
    };
    const server = buildServer({ logger: false, researchService });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const found = await fetch(`${origin}/api/v1/runs/run-1`);
    const missing = await fetch(`${origin}/api/v1/runs/missing`);
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ runId: "run-1", status: "running" });
    expect(missing.status).toBe(404);
  });

  it("cancels and resumes an owned workflow through explicit commands", async () => {
    const cancelRun = vi.fn(async () => ({ runId: "run-1", status: "cancelled" }));
    const resumeRun = vi.fn(async () => ({ runId: "run-1", status: "queued" }));
    const server = buildServer({
      logger: false,
      researchService: {
        startDomainResearch: vi.fn(),
        getRun: async () => undefined,
        cancelRun,
        resumeRun,
      },
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const cancelled = await fetch(`${origin}/api/v1/runs/run-1/cancel`, { method: "POST" });
    const resumed = await fetch(`${origin}/api/v1/runs/run-1/resume`, { method: "POST" });

    expect(cancelled.status).toBe(200);
    expect(resumed.status).toBe(202);
    expect(cancelRun).toHaveBeenCalledWith("run-1", undefined);
    expect(resumeRun).toHaveBeenCalledWith("run-1", undefined);
  });

  it("returns a controlled conflict while another worker still owns the run lease", async () => {
    const server = buildServer({
      logger: false,
      researchService: {
        startDomainResearch: vi.fn(),
        getRun: async () => undefined,
        cancelRun: async () => undefined,
        resumeRun: async () => { throw new ResearchRunConflictError("active lease"); },
      },
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const response = await fetch(`${origin}/api/v1/runs/run-1/resume`, { method: "POST" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "run_is_active_or_changed" });
  });

  it("requires a valid bearer session when an auth service is configured", async () => {
    const authenticate = vi.fn(async (authorization?: string) => authorization === "Bearer valid"
      ? { userId: "user-1" }
      : undefined);
    const startDomainResearch = vi.fn(async () => ({
      runId: "run-auth-1",
      status: "queued" as const,
      interactiveObject: {},
    }));
    const server = buildServer({
      logger: false,
      authService: { authenticate },
      conversationAgent: { decide: async (input) => researchDecision(input.suppliedDomains) },
      researchService: {
        startDomainResearch,
        getRun: async () => undefined,
        cancelRun: async () => undefined,
        resumeRun: async () => undefined,
      },
    });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });
    const url = `${origin}/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages`;
    const body = JSON.stringify({ message: "Analyze acme.ai", domains: ["acme.ai"] });

    const missing = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    const valid = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer valid" }, body });

    expect(missing.status).toBe(401);
    expect(valid.status).toBe(202);
    expect(startDomainResearch).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "user-1" }));
  });
});
