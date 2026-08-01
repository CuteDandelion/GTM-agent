import { afterEach, describe, expect, it, vi } from "vitest";

import { buildServer, type ResearchService } from "../src/server.js";
import { ResearchRunConflictError } from "../src/research-service.js";

const servers: Array<ReturnType<typeof buildServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("conversational research API", () => {
  it("starts a validated domain-analysis run from a chat message", async () => {
    const startDomainResearch = vi.fn(async () => ({
      runId: "run-acme-1",
      status: "queued" as const,
      interactiveObject: {
        id: "progress-acme-1",
        type: "workflow_progress" as const,
        version: 1,
        title: "Researching Acme",
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
    const server = buildServer({ logger: false, researchService });
    servers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const response = await fetch(`${origin}/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Analyze acme.ai", domains: ["acme.ai"] }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ runId: "run-acme-1", status: "queued" });
    expect(startDomainResearch).toHaveBeenCalledWith({
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Analyze acme.ai",
      domains: ["acme.ai"],
      documentIds: [],
    });
  });

  it("rejects invalid or oversized batches before orchestration", async () => {
    const startDomainResearch = vi.fn();
    const server = buildServer({
      logger: false,
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
