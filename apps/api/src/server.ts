import Fastify, { type FastifyServerOptions } from "fastify";
import { canonicalAcmeFixtures, parseCanonicalFixtureBundle } from "@gtm/contracts";
import { z } from "zod";

import type { AuthService } from "./supabase-auth.js";
import { StaleObjectVersionError, type InteractiveObjectService } from "./interactive-actions.js";

const canonicalFixturePayload = parseCanonicalFixtureBundle(canonicalAcmeFixtures);

export interface ResearchService {
  startDomainResearch(input: {
    ownerId?: string;
    conversationId: string;
    message: string;
    domains: string[];
    documentIds: string[];
  }): Promise<{
    runId: string;
    status: "queued" | "running";
    interactiveObject: unknown;
  }>;
  getRun(runId: string, ownerId?: string): Promise<unknown | undefined>;
  cancelRun(runId: string, ownerId?: string): Promise<unknown | undefined>;
  resumeRun(runId: string, ownerId?: string): Promise<unknown | undefined>;
}

type BuildServerOptions = {
  logger?: Exclude<FastifyServerOptions["logger"], undefined>;
  researchService?: ResearchService;
  authService?: AuthService;
  objectActionService?: InteractiveObjectService;
};

const conversationParamsSchema = z.object({ conversationId: z.uuid() });
const messageBodySchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  domains: z.array(z.string().trim().min(1).max(253)).min(1).max(5),
  documentIds: z.array(z.uuid()).max(10).default([]),
});
const runParamsSchema = z.object({ runId: z.string().trim().min(1).max(200) });
const objectParamsSchema = z.object({ objectId: z.string().trim().min(1).max(200) });
const objectActionBodySchema = z.object({
  action: z.enum(["challenge", "shortlist", "correct", "set_status"]),
  expectedVersion: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 1_048_576,
    requestTimeout: 30_000,
    trustProxy: true
  });

  server.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });

  server.get("/health", async () => ({
    status: "ok",
    service: "gtm-orchestrator-api",
    version: "0.1.0"
  }));

  server.get("/ready", async () => ({
    status: "ready",
    checks: { configuration: "ok" }
  }));

  server.get("/api/v1/fixtures/acme", async () => canonicalFixturePayload);

  const authenticate = async (authorization: string | undefined) => {
    if (!options.authService) return { authorized: true, ownerId: undefined };
    const user = await options.authService.authenticate(authorization);
    return user ? { authorized: true, ownerId: user.userId } : { authorized: false, ownerId: undefined };
  };

  server.post("/api/v1/conversations/:conversationId/messages", async (request, reply) => {
    const auth = await authenticate(request.headers.authorization);
    if (!auth.authorized) return reply.code(401).send({ error: "unauthorized" });
    const params = conversationParamsSchema.safeParse(request.params);
    const body = messageBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: [...(params.success ? [] : params.error.issues), ...(body.success ? [] : body.error.issues)],
      });
    }
    if (!options.researchService) {
      return reply.code(503).send({ error: "research_service_unavailable" });
    }

    const run = await options.researchService.startDomainResearch({
      ...(auth.ownerId ? { ownerId: auth.ownerId } : {}),
      conversationId: params.data.conversationId,
      message: body.data.message,
      domains: body.data.domains,
      documentIds: body.data.documentIds,
    });
    return reply.code(202).send(run);
  });

  server.get("/api/v1/runs/:runId", async (request, reply) => {
    const auth = await authenticate(request.headers.authorization);
    if (!auth.authorized) return reply.code(401).send({ error: "unauthorized" });
    const params = runParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!options.researchService) return reply.code(503).send({ error: "research_service_unavailable" });
    const run = await options.researchService.getRun(params.data.runId, auth.ownerId);
    if (!run) return reply.code(404).send({ error: "run_not_found" });
    return reply.send(run);
  });

  server.post("/api/v1/runs/:runId/cancel", async (request, reply) => {
    const auth = await authenticate(request.headers.authorization);
    if (!auth.authorized) return reply.code(401).send({ error: "unauthorized" });
    const params = runParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!options.researchService) return reply.code(503).send({ error: "research_service_unavailable" });
    const run = await options.researchService.cancelRun(params.data.runId, auth.ownerId);
    if (!run) return reply.code(404).send({ error: "run_not_found" });
    return reply.send(run);
  });

  server.post("/api/v1/runs/:runId/resume", async (request, reply) => {
    const auth = await authenticate(request.headers.authorization);
    if (!auth.authorized) return reply.code(401).send({ error: "unauthorized" });
    const params = runParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!options.researchService) return reply.code(503).send({ error: "research_service_unavailable" });
    const run = await options.researchService.resumeRun(params.data.runId, auth.ownerId);
    if (!run) return reply.code(404).send({ error: "run_not_found" });
    return reply.code(202).send(run);
  });

  server.post("/api/v1/interactive-objects/:objectId/actions", async (request, reply) => {
    const auth = await authenticate(request.headers.authorization);
    if (!auth.authorized) return reply.code(401).send({ error: "unauthorized" });
    const params = objectParamsSchema.safeParse(request.params);
    const body = objectActionBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    if (!options.objectActionService) return reply.code(503).send({ error: "object_action_service_unavailable" });
    try {
      const result = await options.objectActionService.applyAction({
        objectId: params.data.objectId,
        ...(auth.ownerId ? { ownerId: auth.ownerId } : {}),
        action: body.data.action,
        expectedVersion: body.data.expectedVersion,
        payload: body.data.payload,
      });
      if (!result) return reply.code(404).send({ error: "interactive_object_not_found" });
      return reply.send(result);
    } catch (error) {
      if (error instanceof StaleObjectVersionError) {
        return reply.code(409).send({
          error: "stale_object_version",
          expectedVersion: error.expectedVersion,
          currentVersion: error.currentVersion,
        });
      }
      throw error;
    }
  });

  return server;
}
