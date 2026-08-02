import Fastify, { type FastifyReply, type FastifyServerOptions } from "fastify";
import { canonicalAcmeFixtures, parseCanonicalFixtureBundle } from "@gtm/contracts";
import { z } from "zod";

import type { AuthService } from "./supabase-auth.js";
import { buildConversationExport, renderConversationMarkdown } from "./conversation-export.js";
import { StaleObjectVersionError, type InteractiveObjectService } from "./interactive-actions.js";
import { ResearchAdmissionError, ResearchRunConflictError } from "./research-service.js";

const canonicalFixturePayload = parseCanonicalFixtureBundle(canonicalAcmeFixtures);

export interface ResearchService {
  startDomainResearch(input: {
    ownerId?: string;
    conversationId: string;
    message: string;
    domains: string[];
    documentIds: string[];
    researchPlan?: ResearchPlan;
  }): Promise<{
    runId: string;
    status: "queued" | "running";
    queuePosition?: number;
    interactiveObject: unknown;
  }>;
  getRun(runId: string, ownerId?: string): Promise<unknown | undefined>;
  cancelRun(runId: string, ownerId?: string): Promise<unknown | undefined>;
  resumeRun(runId: string, ownerId?: string): Promise<unknown | undefined>;
}

export const researchCapabilitySchema = z.enum([
  "company_profile",
  "current_web",
  "document_research",
  "icp_assessment",
  "opportunity_analysis",
  "portfolio_comparison",
]);

export type ResearchCapability = z.infer<typeof researchCapabilitySchema>;

export interface ResearchPlan {
  objective: string;
  capabilities: ResearchCapability[];
}

export interface InteractionPromptDraft {
  key: string;
  type: "interaction_prompt";
  purpose: "clarification" | "scope" | "assumption" | "evidence_request" | "approval" | "next_step";
  title: string;
  prompt: string;
  selection: "single" | "multiple" | "confirmation";
  options: Array<{ id: string; label: string; description?: string | undefined }>;
  allowFreeText: boolean;
}

export type ConversationDecision = {
  kind: "answer" | "clarify";
  message: string;
  usedTools: string[];
  responseId?: string;
  objects?: InteractionPromptDraft[];
} | {
  kind: "research";
  message: string;
  domains: string[];
  plan: ResearchPlan;
  usedTools: string[];
  responseId?: string;
  objects?: InteractionPromptDraft[];
};

export interface ConversationAgent {
  decide(input: {
    ownerId?: string;
    conversationId: string;
    message: string;
    suppliedDomains: string[];
    documentIds: string[];
    history: unknown[];
    sellerProfile: unknown;
    interactiveObjects: unknown[];
  }): Promise<ConversationDecision>;
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
  listConversations(ownerId: string): Promise<unknown[]>;
  getConversation(ownerId: string, conversationId: string): Promise<unknown | undefined>;
  appendMessage(ownerId: string, conversationId: string, input: MessageInput): Promise<unknown | undefined>;
  listMessages(ownerId: string, conversationId: string): Promise<unknown[] | undefined>;
}

type BuildServerOptions = {
  logger?: Exclude<FastifyServerOptions["logger"], undefined>;
  researchService?: ResearchService;
  conversationAgent?: ConversationAgent;
  authService?: AuthService;
  objectActionService?: InteractiveObjectService;
  workspaceService?: WorkspaceService;
  configurationReady?: boolean;
  conversationAdmission?: {
    maxGlobal?: number;
    maxPerOwner?: number;
    maxRequestsGlobalPerWindow?: number;
    maxRequestsPerOwnerPerWindow?: number;
    windowMs?: number;
    now?: () => number;
    retryAfterSeconds?: number;
  };
};

const conversationParamsSchema = z.object({ conversationId: z.uuid() });
const exportQuerySchema = z.object({ format: z.enum(["markdown", "json"]).default("json") });
const messageBodySchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  domains: z.array(z.string().trim().min(1).max(253)).max(5).default([]),
  documentIds: z.array(z.uuid()).max(10).default([]),
});
const runParamsSchema = z.object({ runId: z.string().trim().min(1).max(200) });
const objectParamsSchema = z.object({ objectId: z.string().trim().min(1).max(200) });
const objectActionBodySchema = z.object({
  action: z.enum(["challenge", "shortlist", "correct", "set_status", "respond"]),
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
  const conversationAdmission = {
    maxGlobal: Math.max(1, Math.floor(options.conversationAdmission?.maxGlobal ?? 8)),
    maxPerOwner: Math.max(1, Math.floor(options.conversationAdmission?.maxPerOwner ?? 2)),
    maxRequestsGlobalPerWindow: Math.max(1, Math.floor(options.conversationAdmission?.maxRequestsGlobalPerWindow ?? 30)),
    maxRequestsPerOwnerPerWindow: Math.max(1, Math.floor(options.conversationAdmission?.maxRequestsPerOwnerPerWindow ?? 6)),
    windowMs: Math.max(1_000, Math.floor(options.conversationAdmission?.windowMs ?? 3_600_000)),
    now: options.conversationAdmission?.now ?? Date.now,
    retryAfterSeconds: Math.max(1, Math.floor(options.conversationAdmission?.retryAfterSeconds ?? 5)),
  };
  let activeConversationTurns = 0;
  const activeConversationTurnsByOwner = new Map<string, number>();
  let conversationWindowStartedAt = conversationAdmission.now();
  let conversationRequestsInWindow = 0;
  const conversationRequestsByOwner = new Map<string, number>();
  const consumeConversationRequestBudget = (ownerKey: string) => {
    const currentTime = conversationAdmission.now();
    const elapsed = currentTime - conversationWindowStartedAt;
    if (elapsed < 0 || elapsed >= conversationAdmission.windowMs) {
      conversationWindowStartedAt = currentTime;
      conversationRequestsInWindow = 0;
      conversationRequestsByOwner.clear();
    }
    const ownerRequests = conversationRequestsByOwner.get(ownerKey) ?? 0;
    if (
      conversationRequestsInWindow >= conversationAdmission.maxRequestsGlobalPerWindow
      || ownerRequests >= conversationAdmission.maxRequestsPerOwnerPerWindow
    ) {
      return Math.max(1, Math.ceil((conversationAdmission.windowMs - (currentTime - conversationWindowStartedAt)) / 1_000));
    }
    conversationRequestsInWindow += 1;
    conversationRequestsByOwner.set(ownerKey, ownerRequests + 1);
    return undefined;
  };
  const acquireConversationTurn = (ownerKey: string) => {
    const ownerActive = activeConversationTurnsByOwner.get(ownerKey) ?? 0;
    if (activeConversationTurns >= conversationAdmission.maxGlobal || ownerActive >= conversationAdmission.maxPerOwner) {
      return { retryAfterSeconds: conversationAdmission.retryAfterSeconds } as const;
    }
    const budgetRetryAfterSeconds = consumeConversationRequestBudget(ownerKey);
    if (budgetRetryAfterSeconds !== undefined) {
      return { retryAfterSeconds: budgetRetryAfterSeconds } as const;
    }
    activeConversationTurns += 1;
    activeConversationTurnsByOwner.set(ownerKey, ownerActive + 1);
    let released = false;
    return { release: () => {
      if (released) return;
      released = true;
      activeConversationTurns -= 1;
      const remaining = (activeConversationTurnsByOwner.get(ownerKey) ?? 1) - 1;
      if (remaining === 0) activeConversationTurnsByOwner.delete(ownerKey);
      else activeConversationTurnsByOwner.set(ownerKey, remaining);
    } } as const;
  };
  const capacityResponse = (reply: FastifyReply, error: string, retryAfterSeconds: number) => {
    reply.header("retry-after", String(retryAfterSeconds));
    return reply.code(429).send({ error, retryAfterSeconds });
  };

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

  if (process.env.NODE_ENV !== "production") {
    server.get("/api/v1/fixtures/acme", async () => canonicalFixturePayload);
  }

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

  server.get("/api/v1/conversations", async (request, reply) => {
    const auth = await authenticate(request.headers.authorization);
    if (!auth.authorized || !auth.ownerId) return reply.code(401).send({ error: "unauthorized" });
    if (!options.workspaceService) return reply.code(503).send({ error: "workspace_service_unavailable" });
    return reply.send(await options.workspaceService.listConversations(auth.ownerId));
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

  server.get("/api/v1/conversations/:conversationId/export", async (request, reply) => {
    const auth = await authenticate(request.headers.authorization);
    if (!auth.authorized || !auth.ownerId) return reply.code(401).send({ error: "unauthorized" });
    const params = conversationParamsSchema.safeParse(request.params);
    const query = exportQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "invalid_request" });
    if (!options.workspaceService || !options.objectActionService) {
      return reply.code(503).send({ error: "export_service_unavailable" });
    }
    const conversation = await options.workspaceService.getConversation(auth.ownerId, params.data.conversationId);
    if (!conversation) return reply.code(404).send({ error: "conversation_not_found" });
    const [messages, interactiveObjects] = await Promise.all([
      options.workspaceService.listMessages(auth.ownerId, params.data.conversationId),
      options.objectActionService.listForConversation(auth.ownerId, params.data.conversationId),
    ]);
    if (!messages) return reply.code(404).send({ error: "conversation_not_found" });
    const exported = buildConversationExport({
      conversationId: params.data.conversationId,
      messages,
      interactiveObjects,
    });
    const extension = query.data.format === "markdown" ? "md" : "json";
    reply.header("content-disposition", `attachment; filename=\"${params.data.conversationId}.${extension}\"`);
    if (query.data.format === "markdown") {
      return reply.type("text/markdown; charset=utf-8").send(renderConversationMarkdown(exported));
    }
    return reply.send(exported);
  });

  server.get("/api/v1/conversations/:conversationId/interactive-objects", async (request, reply) => {
    const auth = await authenticate(request.headers.authorization);
    if (!auth.authorized || !auth.ownerId) return reply.code(401).send({ error: "unauthorized" });
    const params = conversationParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!options.objectActionService) return reply.code(503).send({ error: "object_action_service_unavailable" });
    return reply.send(await options.objectActionService.listForConversation(auth.ownerId, params.data.conversationId));
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
    if (!options.researchService) return reply.code(503).send({ error: "research_service_unavailable" });
    const history = options.workspaceService && auth.ownerId
      ? await options.workspaceService.listMessages(auth.ownerId, params.data.conversationId)
      : [];
    if (history === undefined) return reply.code(404).send({ error: "conversation_not_found" });
    const sellerProfile = options.workspaceService && auth.ownerId
      ? await options.workspaceService.getSellerProfile(auth.ownerId)
      : undefined;
    const conversationObjects = options.objectActionService && auth.ownerId
      ? await options.objectActionService.listForConversation(auth.ownerId, params.data.conversationId)
      : [];

    if (options.conversationAgent) {
      const ownerKey = auth.ownerId ?? `conversation:${params.data.conversationId}`;
      const turnAdmission = acquireConversationTurn(ownerKey);
      if ("retryAfterSeconds" in turnAdmission) {
        return capacityResponse(reply, "conversation_capacity_exceeded", turnAdmission.retryAfterSeconds);
      }
      const releaseConversationTurn = turnAdmission.release;
      let decision: ConversationDecision;
      try {
        decision = await options.conversationAgent.decide({
          ...(auth.ownerId ? { ownerId: auth.ownerId } : {}),
          conversationId: params.data.conversationId,
          message: body.data.message,
          suppliedDomains: body.data.domains,
          documentIds: body.data.documentIds,
          history: history ?? [],
          sellerProfile,
          interactiveObjects: conversationObjects,
        });
      } finally {
        releaseConversationTurn();
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
      const interactiveObjects = options.objectActionService && auth.ownerId
        ? await Promise.all((decision.objects ?? []).map(({ key, ...object }) => options.objectActionService!.publish({
            ownerId: auth.ownerId!,
            conversationId: params.data.conversationId,
            objectKey: `conversation-prompt:${key}`,
            object,
          })))
        : [];
      if (decision.kind !== "research") {
        if (options.workspaceService && auth.ownerId) {
          await options.workspaceService.appendMessage(auth.ownerId, params.data.conversationId, {
            role: "assistant",
            content: {
              text: decision.message,
              decision: decision.kind,
              usedTools: decision.usedTools,
              ...(decision.responseId ? { responseId: decision.responseId } : {}),
            },
          });
        }
        return reply.send({ ...decision, interactiveObjects });
      }
      let run: Awaited<ReturnType<ResearchService["startDomainResearch"]>>;
      try {
        run = await options.researchService.startDomainResearch({
          ...(auth.ownerId ? { ownerId: auth.ownerId } : {}),
          conversationId: params.data.conversationId,
          message: body.data.message,
          domains: decision.domains,
          documentIds: body.data.documentIds,
          researchPlan: decision.plan,
        });
      } catch (error) {
        if (error instanceof ResearchAdmissionError) {
          return capacityResponse(reply, "research_capacity_exceeded", error.retryAfterSeconds);
        }
        throw error;
      }
      if (options.workspaceService && auth.ownerId) {
        await options.workspaceService.appendMessage(auth.ownerId, params.data.conversationId, {
          role: "assistant",
          content: {
            text: decision.message,
            decision: decision.kind,
            usedTools: decision.usedTools,
            ...(decision.responseId ? { responseId: decision.responseId } : {}),
            runId: run.runId,
            status: run.status,
            queuePosition: run.queuePosition ?? 1,
            researchPlan: decision.plan,
          },
        });
      }
      return reply.code(202).send({
        kind: "research",
        message: decision.message,
        usedTools: decision.usedTools,
        interactiveObjects,
        ...run,
      });
    }
    return reply.code(503).send({ error: "conversation_agent_unavailable" });
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
    let run: unknown | undefined;
    try {
      run = await options.researchService.resumeRun(params.data.runId, auth.ownerId);
    } catch (error) {
      if (error instanceof ResearchAdmissionError) {
        return capacityResponse(reply, "research_capacity_exceeded", error.retryAfterSeconds);
      }
      if (error instanceof ResearchRunConflictError) {
        return reply.code(409).send({ error: "run_is_active_or_changed" });
      }
      throw error;
    }
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
