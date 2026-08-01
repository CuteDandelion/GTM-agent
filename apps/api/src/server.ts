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

export interface SellerProfileInput {
  businessName: string;
  offerSummary: string;
  capabilities: string[];
  proofPoints: string[];
  constraints: Record<string, unknown>;
}

export interface ConversationInput {
  title: string;
  sellerProfileId?: string;
  icpDefinitionId?: string;
}

export interface MessageInput {
  role: "user" | "assistant" | "system" | "tool";
  content: Record<string, unknown>;
}

export interface WorkspaceService {
  getSellerProfile(ownerId: string): Promise<unknown | undefined>;
  upsertSellerProfile(ownerId: string, input: SellerProfileInput): Promise<unknown>;
  createConversation(ownerId: string, input: ConversationInput): Promise<unknown>;
  getConversation(ownerId: string, conversationId: string): Promise<unknown | undefined>;
  appendMessage(ownerId: string, conversationId: string, input: MessageInput): Promise<unknown | undefined>;
  listMessages(ownerId: string, conversationId: string): Promise<unknown[] | undefined>;
}

type BuildServerOptions = {
  logger?: Exclude<FastifyServerOptions["logger"], undefined>;
  researchService?: ResearchService;
  authService?: AuthService;
  objectActionService?: InteractiveObjectService;
  workspaceService?: WorkspaceService;
  configurationReady?: boolean;
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
const sellerProfileBodySchema = z.object({
  businessName: z.string().trim().min(1).max(200),
  offerSummary: z.string().trim().min(1).max(4_000),
  capabilities: z.array(z.string().trim().min(1).max(200)).max(50),
  proofPoints: z.array(z.string().trim().min(1).max(1_000)).max(50),
  constraints: z.record(z.string(), z.unknown()),
}).strict();
const conversationBodySchema = z.object({
  title: z.string().trim().min(1).max(300),
  sellerProfileId: z.uuid().optional(),
  icpDefinitionId: z.uuid().optional(),
}).strict();

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

  server.get("/ready", async (_request, reply) => {
    if (options.configurationReady === false) {
      return reply.code(503).send({
        status: "not_ready",
        checks: { configuration: "missing" },
      });
    }
    return reply.send({
      status: "ready",
      checks: { configuration: "ok" },
    });
  });

  server.get("/api/v1/fixtures/acme", async () => canonicalFixturePayload);

  const authenticate = async (authorization: string | undefined) => {
    if (!options.authService) return { authorized: true, ownerId: undefined };
    const user = await options.authService.authenticate(authorization);
    return user ? { authorized: true, ownerId: user.userId } : { authorized: false, ownerId: undefined };
  };

  server.get("/api/v1/seller-profile", async (request, reply) => {
    const auth = await authenticate(request.headers.authorization);
    if (!auth.authorized || !auth.ownerId) return reply.code(401).send({ error: "unauthorized" });
    if (!options.workspaceService) return reply.code(503).send({ error: "workspace_service_unavailable" });
    const profile = await options.workspaceService.getSellerProfile(auth.ownerId);
    if (!profile) return reply.code(404).send({ error: "seller_profile_not_found" });
    return reply.send(profile);
  });

  server.put("/api/v1/seller-profile", async (request, reply) => {
    const auth = await authenticate(request.headers.authorization);
    if (!auth.authorized || !auth.ownerId) return reply.code(401).send({ error: "unauthorized" });
    const body = sellerProfileBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request", details: body.error.issues });
    if (!options.workspaceService) return reply.code(503).send({ error: "workspace_service_unavailable" });
    return reply.send(await options.workspaceService.upsertSellerProfile(auth.ownerId, body.data));
  });

  server.post("/api/v1/conversations", async (request, reply) => {
    const auth = await authenticate(request.headers.authorization);
    if (!auth.authorized || !auth.ownerId) return reply.code(401).send({ error: "unauthorized" });
    const body = conversationBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request", details: body.error.issues });
    if (!options.workspaceService) return reply.code(503).send({ error: "workspace_service_unavailable" });
    return reply.code(201).send(await options.workspaceService.createConversation(auth.ownerId, {
      title: body.data.title,
      ...(body.data.sellerProfileId ? { sellerProfileId: body.data.sellerProfileId } : {}),
      ...(body.data.icpDefinitionId ? { icpDefinitionId: body.data.icpDefinitionId } : {}),
    }));
  });

  server.get("/api/v1/conversations/:conversationId", async (request, reply) => {
    const auth = await authenticate(request.headers.authorization);
    if (!auth.authorized || !auth.ownerId) return reply.code(401).send({ error: "unauthorized" });
    const params = conversationParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!options.workspaceService) return reply.code(503).send({ error: "workspace_service_unavailable" });
    const conversation = await options.workspaceService.getConversation(auth.ownerId, params.data.conversationId);
    if (!conversation) return reply.code(404).send({ error: "conversation_not_found" });
    return reply.send(conversation);
  });

  server.get("/api/v1/conversations/:conversationId/messages", async (request, reply) => {
    const auth = await authenticate(request.headers.authorization);
    if (!auth.authorized || !auth.ownerId) return reply.code(401).send({ error: "unauthorized" });
    const params = conversationParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!options.workspaceService) return reply.code(503).send({ error: "workspace_service_unavailable" });
    const messages = await options.workspaceService.listMessages(auth.ownerId, params.data.conversationId);
    if (!messages) return reply.code(404).send({ error: "conversation_not_found" });
    return reply.send(messages);
  });

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
    if (options.workspaceService) {
      if (!auth.ownerId) return reply.code(401).send({ error: "unauthorized" });
      const persisted = await options.workspaceService.appendMessage(auth.ownerId, params.data.conversationId, {
        role: "user",
        content: {
          text: body.data.message,
          domains: body.data.domains,
          documentIds: body.data.documentIds,
        },
      });
      if (!persisted) return reply.code(404).send({ error: "conversation_not_found" });
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
