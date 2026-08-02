import { describe, expect, it } from "vitest";
import { InMemoryCheckpointStore } from "@gtm/orchestration";

import * as bootstrap from "../src/bootstrap.js";
import { InMemoryInteractiveObjectService } from "../src/interactive-actions.js";
import { InMemoryResearchRunStore } from "../src/research-service.js";

describe("research run mobile projection", () => {
  it("publishes a fresh mobile phase after a durable checkpoint save", async () => {
    const factory = "createProjectingCheckpointStore" in bootstrap
      ? bootstrap.createProjectingCheckpointStore as unknown as (options: Record<string, unknown>) => InMemoryCheckpointStore
      : undefined;
    expect(typeof factory, "bootstrap must expose the checkpoint projection adapter").toBe("function");
    if (!factory) return;

    const ownerId = "11111111-1111-4111-8111-111111111111";
    const conversationId = "22222222-2222-4222-8222-222222222222";
    const runId = "33333333-3333-4333-8333-333333333333";
    const checkpointStore = new InMemoryCheckpointStore();
    const runStore = new InMemoryResearchRunStore();
    const interactiveObjects = new InMemoryInteractiveObjectService();
    await runStore.save({
      runId,
      conversationId,
      status: "running",
      input: {
        ownerId,
        conversationId,
        message: "Analyze foodbegood.app",
        domains: ["foodbegood.app"],
        documentIds: [],
      },
      createdAt: "2026-08-02T12:00:00.000Z",
      updatedAt: "2026-08-02T12:00:01.000Z",
    });
    const checkpoint = {
      runId,
      workflowId: "company-domain-research-v1",
      status: "running" as const,
      executionCount: 2,
      nodes: {
        "research-plan": { status: "completed" as const, attempts: 1, toolsUsed: [] },
        "crawl-company": { status: "running" as const, attempts: 1, toolsUsed: [] },
      },
    };
    const projectingStore = factory({
      checkpointStore,
      runStore,
      observe: bootstrap.createRunProjectionObserver(interactiveObjects),
    });

    await projectingStore.save(checkpoint);

    expect(await checkpointStore.load(runId)).toEqual(checkpoint);
    expect(await interactiveObjects.listForConversation(ownerId, conversationId)).toMatchObject([{
      type: "workflow_progress",
      live: true,
      steps: [
        { id: "plan", status: "completed" },
        { id: "research", status: "running" },
        { id: "analyze", status: "pending" },
        { id: "review", status: "pending" },
      ],
    }]);
  });

  it("projects live DAG checkpoints into the active Sol, Luna, Terra, and review phase", async () => {
    const factory = "createRunProjectionObserver" in bootstrap
      ? bootstrap.createRunProjectionObserver as unknown as (service: InMemoryInteractiveObjectService) => (snapshot: Record<string, unknown>) => Promise<void>
      : undefined;
    expect(typeof factory, "bootstrap must expose the run-to-mobile projection observer").toBe("function");
    if (!factory) return;

    const service = new InMemoryInteractiveObjectService();
    const observe = factory(service);
    const common = {
      runId: "33333333-3333-4333-8333-333333333333",
      conversationId: "22222222-2222-4222-8222-222222222222",
      status: "running",
      input: {
        ownerId: "11111111-1111-4111-8111-111111111111",
        conversationId: "22222222-2222-4222-8222-222222222222",
        message: "Analyze foodbegood.app",
        domains: ["foodbegood.app"],
        documentIds: [],
      },
      createdAt: "2026-08-02T12:00:00.000Z",
      updatedAt: "2026-08-02T12:00:01.000Z",
    };

    await observe({
      ...common,
      checkpoint: {
        status: "running",
        nodes: {
          "research-plan": { status: "completed" },
          "validate-domain": { status: "completed" },
          "crawl-company": { status: "running" },
        },
      },
    });
    let progress = (await service.listForConversation(common.input.ownerId, common.conversationId) as Array<Record<string, unknown>>)
      .find((object) => object.type === "workflow_progress");
    expect(progress).toMatchObject({
      live: true,
      steps: [
        { id: "plan", agent: "Sol", status: "completed" },
        { id: "research", agent: "Luna", status: "running" },
        { id: "analyze", agent: "Terra", status: "pending" },
        { id: "review", agent: "Sol", status: "pending" },
      ],
    });

    await observe({
      ...common,
      checkpoint: {
        status: "running",
        nodes: {
          "research-plan": { status: "completed" },
          "normalize-evidence": { status: "completed" },
          "company-profile": { status: "completed" },
          "icp-assessment": { status: "completed" },
          "opportunity-analysis": { status: "completed" },
          "critical-review": { status: "running" },
        },
      },
    });
    progress = (await service.listForConversation(common.input.ownerId, common.conversationId) as Array<Record<string, unknown>>)
      .find((object) => object.type === "workflow_progress");
    expect(progress).toMatchObject({
      version: 2,
      live: true,
      steps: [
        { id: "plan", agent: "Sol", status: "completed" },
        { id: "research", agent: "Luna", status: "completed" },
        { id: "analyze", agent: "Terra", status: "completed" },
        { id: "review", agent: "Sol", status: "running" },
      ],
    });
  });

  it("replaces live progress with terminal company, ICP, opportunity, and evidence objects", async () => {
    const factory = "createRunProjectionObserver" in bootstrap
      ? bootstrap.createRunProjectionObserver as unknown as (service: InMemoryInteractiveObjectService) => (snapshot: Record<string, unknown>) => Promise<void>
      : undefined;
    expect(typeof factory, "bootstrap must expose the run-to-mobile projection observer").toBe("function");
    if (!factory) return;

    const service = new InMemoryInteractiveObjectService();
    const observe = factory(service);
    const common = {
      runId: "33333333-3333-4333-8333-333333333333",
      conversationId: "22222222-2222-4222-8222-222222222222",
      input: {
        ownerId: "11111111-1111-4111-8111-111111111111",
        conversationId: "22222222-2222-4222-8222-222222222222",
        message: "Analyze foodbegood.app",
        domains: ["foodbegood.app"],
        documentIds: [],
      },
      createdAt: "2026-08-02T12:00:00.000Z",
      updatedAt: "2026-08-02T12:00:00.000Z",
    };
    await observe({ ...common, status: "queued" });
    await observe({ ...common, status: "running" });
    await observe({
      ...common,
      status: "completed",
      checkpoint: {
        status: "completed",
        nodes: {
          "company-profile": {
            status: "completed",
            output: { output: {
              companyProfiles: [{
                company: "Foodbegood",
                domain: "foodbegood.app",
                profile: {
                  background: "Early-stage food-sharing company.",
                  product: "Affordable meals from partner canteens.",
                  operatingScale: "Waitlist stage.",
                  hiringSignal: "Small product team.",
                  technologySignal: "AI engineering capability is visible.",
                },
                icpAssessment: {
                  fit: "medium",
                  rationale: "Repeatable partner and waitlist workflows fit bounded automation.",
                  risks: ["Budget is not publicly verified."],
                },
                automationHypotheses: [{
                  opportunity: "Waitlist Triage Agent",
                  value: "Reduce manual qualification and routing.",
                  controls: "Human approval before external messages.",
                }],
              }],
            } },
          },
          "final-review": {
            status: "completed",
            output: { output: {
              approvedClaims: [{
                company: "Foodbegood",
                statement: "Foodbegood asks prospective users to join a waitlist.",
                sourceUrl: "https://foodbegood.app/user.html",
              }],
            } },
          },
          synthesis: { status: "completed", output: { output: { facts: [] } } },
        },
      },
    });

    const objects = await service.listForConversation(common.input.ownerId, common.conversationId) as Array<Record<string, unknown>>;
    expect(objects).toHaveLength(5);
    expect(objects.find((object) => object.type === "workflow_progress")).toMatchObject({
      version: 3,
      live: false,
      title: "Researching foodbegood.app",
      steps: [
        { id: "plan", label: "Plan", agent: "Sol", status: "completed" },
        { id: "research", label: "Research", agent: "Luna", status: "completed" },
        { id: "analyze", label: "Analyze", agent: "Terra", status: "completed" },
        { id: "review", label: "Review", agent: "Sol", status: "completed" },
      ],
    });
    expect(objects.find((object) => object.type === "company_profile")).toMatchObject({
      company: "Foodbegood",
      domain: "foodbegood.app",
      summary: "Affordable meals from partner canteens.",
      pros: ["AI engineering capability is visible."],
      cons: ["Budget is not publicly verified."],
    });
    expect(objects.find((object) => object.type === "icp_score")).toMatchObject({
      company: "Foodbegood",
      score: 62,
      band: "medium",
    });
    expect(objects.find((object) => object.type === "opportunity")).toMatchObject({
      company: "Foodbegood",
      title: "Waitlist Triage Agent",
      summary: "Reduce manual qualification and routing.",
      status: "research",
    });
    expect(objects.find((object) => object.type === "evidence_collection")).toMatchObject({
      title: "Foodbegood evidence",
      items: [{
        title: "Foodbegood source",
        url: "https://foodbegood.app/user.html",
        excerpt: "Foodbegood asks prospective users to join a waitlist.",
        classification: "fact",
        confidence: 5,
      }],
    });
  });

  it("projects the current single-company provider output shape", async () => {
    const service = new InMemoryInteractiveObjectService();
    const observe = bootstrap.createRunProjectionObserver(service) as unknown as (snapshot: Record<string, unknown>) => Promise<void>;
    await observe({
      runId: "33333333-3333-4333-8333-333333333333",
      conversationId: "22222222-2222-4222-8222-222222222222",
      status: "completed",
      input: {
        ownerId: "11111111-1111-4111-8111-111111111111",
        conversationId: "22222222-2222-4222-8222-222222222222",
        domains: ["foodbegood.app"],
      },
      checkpoint: {
        status: "completed",
        nodes: {
          "company-profile": { status: "completed", output: { output: {
            company: {
              name: "Foodbegood",
              domain: "foodbegood.app",
              profile: "Food-sharing platform connecting canteens with people seeking affordable meals.",
              stage: "Early-stage company.",
              teamSignal: "Small product and AI team.",
            },
            icpAssessment: {
              fit: "strong_provisional",
              score: 8,
              outOf: 10,
              inferences: [{ claim: "Repeatable partner workflows fit bounded automation." }],
              qualificationQuestions: ["How many daily pickups are handled?"],
            },
            opportunity: {
              name: "Human-approved canteen operations agent",
              hypothesis: "Prepare exception queues and reminder drafts for human approval.",
              guardrails: ["Human approval for external messages."],
            },
            caveats: ["Operating scale and budget are not publicly verified."],
          } } },
          "final-review": { status: "completed", output: { output: {
            approvedClaims: [{
              company: "Foodbegood",
              statement: "Canteen staff can manage food availability in the app.",
              sourceUrl: "https://play.google.com/store/apps/details?id=com.foodbegood.food_be_good",
            }],
          } } },
        },
      },
    });

    const objects = await service.listForConversation(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ) as Array<Record<string, unknown>>;
    expect(objects).toHaveLength(5);
    expect(objects.find((object) => object.type === "company_profile")).toMatchObject({
      company: "Foodbegood",
      domain: "foodbegood.app",
      summary: "Food-sharing platform connecting canteens with people seeking affordable meals.",
      cons: ["Operating scale and budget are not publicly verified."],
    });
    expect(objects.find((object) => object.type === "icp_score")).toMatchObject({ score: 80, band: "high" });
    expect(objects.find((object) => object.type === "opportunity")).toMatchObject({
      title: "Human-approved canteen operations agent",
      summary: "Prepare exception queues and reminder drafts for human approval.",
    });
    expect(objects.find((object) => object.type === "evidence_collection")).toMatchObject({ items: [{
      excerpt: "Canteen staff can manage food availability in the app.",
    }] });
  });

  it("projects a partial five-domain batch as four ranked targets plus the failed target", async () => {
    const service = new InMemoryInteractiveObjectService();
    const observe = bootstrap.createRunProjectionObserver(service) as unknown as (snapshot: Record<string, unknown>) => Promise<void>;
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const conversationId = "22222222-2222-4222-8222-222222222222";
    await observe({
      runId: "33333333-3333-4333-8333-333333333333",
      conversationId,
      status: "completed",
      input: {
        ownerId,
        conversationId,
        domains: ["alpha.example", "beta.example", "broken.example", "delta.example", "echo.example"],
      },
      checkpoint: {
        status: "completed",
        nodes: {
          "crawl-company": { status: "completed", output: { crawl_company: {
            companies: [
              { domain: "alpha.example" },
              { domain: "beta.example" },
              { domain: "delta.example" },
              { domain: "echo.example" },
            ],
            failures: [{ domain: "broken.example", error: "forced crawl failure" }],
          } } },
          "company-profile": { status: "completed", output: { output: { companyProfiles: [
            { company: "Alpha", domain: "alpha.example", profile: { product: "Alpha product" }, icpAssessment: { fit: "high" } },
            { company: "Beta", domain: "beta.example", profile: { product: "Beta product" }, icpAssessment: { fit: "medium" } },
            { company: "Delta", domain: "delta.example", profile: { product: "Delta product" }, icpAssessment: { fit: "medium" } },
            { company: "Echo", domain: "echo.example", profile: { product: "Echo product" }, icpAssessment: { fit: "low" } },
          ] } } },
          "portfolio-comparison": { status: "completed", output: { output: { ranking: [
            { rank: 1, company: "Alpha", score: 90, fit: "High", rationale: "Strongest supported fit" },
            { rank: 2, company: "Beta", score: 80, fit: "Medium-high", rationale: "Good supported fit" },
            { rank: 3, company: "Delta", score: 70, fit: "Medium", rationale: "Some supported fit" },
            { rank: 4, company: "Echo", score: 60, fit: "Low", rationale: "Weakest supported fit" },
          ] } } },
          "final-review": { status: "completed", output: { output: { approvedClaims: [] } } },
        },
      },
    });

    const objects = await service.listForConversation(ownerId, conversationId) as Array<Record<string, unknown>>;
    expect(objects.find((object) => object.type === "company_comparison")).toMatchObject({
      title: "Company priority",
      entries: [
        { company: "Alpha", domain: "alpha.example", rank: 1, score: 90, status: "pursue", rationale: "Strongest supported fit" },
        { company: "Beta", domain: "beta.example", rank: 2, score: 80, status: "research", rationale: "Good supported fit" },
        { company: "Delta", domain: "delta.example", rank: 3, score: 70, status: "research", rationale: "Some supported fit" },
        { company: "Echo", domain: "echo.example", rank: 4, score: 60, status: "nurture", rationale: "Weakest supported fit" },
      ],
      failures: [{ domain: "broken.example", reason: "forced crawl failure" }],
    });
  });
});
