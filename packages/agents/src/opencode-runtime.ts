import {
  extractToolRunContext,
  gtmNodeOutputType,
  type AgentRuntime,
  type FunctionToolAdapterDefinition,
  type ReasoningEffort,
} from "./index.js";
import type { OpenCodeToolBridge } from "./opencode-tool-bridge.js";

export interface OpenCodeSessionTransport {
  createSession(options: { title: string }): Promise<{ id: string }>;
  prompt(options: {
    sessionId: string;
    model: { providerID: string; modelID: string };
    variant?: string;
    system: string;
    text: string;
    tools: Record<string, boolean>;
    format: { type: "json_schema"; schema: Record<string, unknown>; retryCount: number };
    maxOutputTokens: number;
  }): Promise<{
    messageId: string;
    structuredOutput?: unknown;
    text?: string;
    toolNames: string[];
  }>;
  deleteSession(sessionId: string): Promise<void>;
}

const deniedTools = [
  "bash",
  "edit",
  "write",
  "apply_patch",
  "read",
  "grep",
  "glob",
  "list",
  "lsp",
  "task",
  "question",
  "skill",
  "todowrite",
  "webfetch",
] as const;

const applicationToolNames = [
  "get_seller_profile",
  "get_icp_definition",
  "fetch_page",
  "save_evidence",
  "search_evidence",
  "get_claim_sources",
  "list_open_hypotheses",
  "get_opportunities",
  "get_company_profile",
  "compare_companies",
  "read_document",
  "extract_document_text",
] as const;

function parseModel(model: string) {
  const separator = model.indexOf("/");
  if (separator < 1 || separator === model.length - 1) {
    throw new Error("OpenCode models must use provider/model format");
  }
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) };
}

function modelVariant(reasoningEffort: ReasoningEffort) {
  return reasoningEffort === "high" ? "high" : undefined;
}

function normalizeOpenCodeToolName(name: string) {
  if (name === "websearch") return "web_search";
  if (name.startsWith("gtm_")) return name.slice(4);
  return name;
}

function parseTextOutput(text?: string) {
  if (!text) throw new Error("OpenCode returned no structured output");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("OpenCode returned invalid structured output");
  }
}

export function createOpenCodeRuntime(options: {
  transport: OpenCodeSessionTransport;
  bridge: OpenCodeToolBridge;
  toolDefinitions?: Record<string, FunctionToolAdapterDefinition>;
  timeoutMs?: number;
}): AgentRuntime {
  const toolDefinitions = options.toolDefinitions ?? {};
  return async (request) => {
    const model = parseModel(request.model);
    const context = extractToolRunContext(request.input);
    const customToolNames = request.tools.filter((toolName) => toolName in toolDefinitions);
    const unsupportedRequiredTools = (request.requiredTools ?? []).filter((toolName) =>
      toolName !== "web_search" && !customToolNames.includes(toolName));
    if (unsupportedRequiredTools.length > 0) {
      throw new Error(`Required tools are unavailable in OpenCode: ${unsupportedRequiredTools.join(", ")}`);
    }
    const tools: Record<string, boolean> = Object.fromEntries(deniedTools.map((name) => [name, false]));
    tools.StructuredOutput = true;
    for (const toolName of applicationToolNames) tools[`gtm_${toolName}`] = false;
    if (request.tools.includes("web_search")) tools.websearch = true;
    for (const toolName of customToolNames) tools[`gtm_${toolName}`] = true;
    const customToolInstructions = customToolNames.length > 0
      ? `\n\nAvailable application tools:\n${customToolNames
        .map((name) => `${name}: ${toolDefinitions[name]!.description}`)
        .join("\n")}`
      : "";
    const variant = modelVariant(request.reasoningEffort);

    const session = await options.transport.createSession({ title: request.agentName });
    const registration = options.bridge.register({
      sessionId: session.id,
      context,
      allowedTools: customToolNames,
      requiredTools: (request.requiredTools ?? []).filter((name) => customToolNames.includes(name)),
      definitions: toolDefinitions,
    });
    try {
      const prompt = options.transport.prompt({
        sessionId: session.id,
        model,
        ...(variant ? { variant } : {}),
        system: `${request.instructions}${customToolInstructions}`,
        text: JSON.stringify(request.input),
        tools,
        format: {
          type: "json_schema",
          schema: (request.outputType ?? gtmNodeOutputType).schema as Record<string, unknown>,
          retryCount: 2,
        },
        maxOutputTokens: request.maxOutputTokens ?? 4_096,
      });
      const timeoutMs = options.timeoutMs ?? 120_000;
      const result = await Promise.race([
        prompt,
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`OpenCode request timed out after ${timeoutMs}ms`)), timeoutMs);
          timer.unref?.();
        }),
      ]);
      const usedTools = [...new Set([
        ...result.toolNames.map(normalizeOpenCodeToolName),
        ...registration.usedTools(),
      ])];
      const missingRequiredTools = (request.requiredTools ?? [])
        .filter((toolName) => !usedTools.includes(toolName));
      if (missingRequiredTools.length > 0) {
        throw new Error(`Required OpenCode tools were not used: ${missingRequiredTools.join(", ")}`);
      }
      return {
        output: result.structuredOutput ?? parseTextOutput(result.text),
        usedTools,
        responseId: result.messageId,
      };
    } finally {
      registration.dispose();
      await options.transport.deleteSession(session.id);
    }
  };
}
