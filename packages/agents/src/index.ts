import {
  Agent,
  codeInterpreterTool,
  fileSearchTool,
  run,
  tool,
  webSearchTool,
  type AgentOutputType,
  type FunctionTool,
  type HostedTool,
  type RunContext,
} from "@openai/agents";
import {
  resolveModel,
  type AgentRole,
  type ModelRegistry,
  type NodeExecutionContext,
  type NodeExecutor,
} from "@gtm/orchestration";
import { z } from "zod";

export type ReasoningEffort = "low" | "medium" | "high";

export interface AgentRunRequest {
  agentName: string;
  instructions: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  tools: string[];
  requiredTools?: string[];
  outputType?: AgentOutputType;
  maxOutputTokens?: number;
  input: unknown;
}

export interface AgentRunResult {
  output: unknown;
  usedTools: string[];
  responseId?: string;
}

export type AgentRuntime = (request: AgentRunRequest) => Promise<AgentRunResult>;

export interface ToolRunContext {
  runId: string;
  nodeId: string;
  ownerId: string;
}

function requireStructuredOutput(output: unknown): Record<string, unknown> {
  let candidate = output;
  if (typeof candidate === "string") {
    const fenced = candidate.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced?.[1]) candidate = fenced[1];
    try {
      candidate = JSON.parse(String(candidate));
    } catch {
      throw new Error("Agent output must be a structured object");
    }
  }
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new Error("Agent output must be a structured object");
  }
  return candidate as Record<string, unknown>;
}

export interface FunctionToolAdapterDefinition {
  description: string;
  handler(input: unknown, context?: ToolRunContext): Promise<unknown>;
}

type AnyFunctionTool = FunctionTool<any, any, any>;

const functionToolInputSchema = {
  type: "object" as const,
  properties: {
    input: { type: "object", additionalProperties: true },
  },
  required: ["input"] as ["input"],
  additionalProperties: true as const,
};

export const gtmNodeOutputType = {
  type: "json_schema" as const,
  name: "gtm_node_output",
  strict: false,
  schema: {
    type: "object" as const,
    properties: {},
    required: [] as string[],
    additionalProperties: true as const,
  },
};

export function createFunctionToolAdapters(
  definitions: Record<string, FunctionToolAdapterDefinition>,
): Record<string, AnyFunctionTool> {
  return Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [
    name,
    tool({
      name,
      description: definition.description,
      parameters: functionToolInputSchema,
      strict: false,
      execute: async (parameters, runContext?: RunContext<ToolRunContext>) => JSON.stringify(
        runContext?.context
          ? await definition.handler((parameters as { input: unknown }).input, runContext.context)
          : await definition.handler((parameters as { input: unknown }).input),
      ),
    }),
  ]));
}

export function extractToolRunContext(input: unknown): ToolRunContext {
  const parsed = z.object({
    runId: z.string().min(1),
    nodeId: z.string().min(1),
    workflowInput: z.object({ ownerId: z.string().uuid() }).passthrough(),
  }).parse(input);
  return {
    runId: parsed.runId,
    nodeId: parsed.nodeId,
    ownerId: parsed.workflowInput.ownerId,
  };
}

export function normalizeProviderToolName(name: string): string {
  if (name === "web_search_call") return "web_search";
  if (name === "file_search_call") return "file_search";
  if (name === "code_interpreter_call") return "code_interpreter";
  return name;
}

export function selectAvailableToolNames(
  requestedTools: string[],
  vectorStoreIds: string[],
  requiredTools: string[] = [],
): string[] {
  if (vectorStoreIds.length === 0 && requiredTools.includes("file_search")) {
    throw new Error("file_search requires at least one configured vector store");
  }
  return requestedTools.filter((toolName) => toolName !== "file_search" || vectorStoreIds.length > 0);
}

const roleConfiguration: Record<AgentRole, {
  name: string;
  reasoningEffort: ReasoningEffort;
  instructions: string;
}> = {
  planner: {
    name: "GTM research planner",
    reasoningEffort: "high",
    instructions: "Design a bounded research plan from the seller profile, ICP, and user intent. Define evidence requirements and completion criteria. Do not invent company facts.",
  },
  executor: {
    name: "GTM research executor",
    reasoningEffort: "low",
    instructions: "Perform the assigned extraction or research task using only the supplied tools. Preserve source metadata and save evidence for every material fact.",
  },
  analyst: {
    name: "GTM company analyst",
    reasoningEffort: "medium",
    instructions: "Analyze normalized evidence into a company profile, ICP assessment, and commercially useful automation opportunities. Separate facts, inferences, and hypotheses.",
  },
  conversation: {
    name: "GTM conversation manager",
    reasoningEffort: "low",
    instructions: "Turn validated analysis into concise conversational responses and schema-driven interactive objects. Preserve corrections and never hide evidence gaps.",
  },
  critic: {
    name: "GTM evidence critic",
    reasoningEffort: "high",
    instructions: "Challenge material claims, inspect their sources, search independently when required, and identify contradictions or evidence gaps before approving synthesis.",
  },
  portfolio: {
    name: "GTM portfolio strategist",
    reasoningEffort: "high",
    instructions: "Compare company dossiers using consistent evidence and ICP criteria. Rank targets, explain tradeoffs, and preserve uncertainty.",
  },
};

function nodeSpecificInstructions(nodeId: string) {
  if (nodeId === "current-research") {
    return "For every company domain, search current primary sources beyond the homepage. Cover founding and ownership, the latest funding round date and funding amount, valuation, lead investor and participants, operating scale, employee count and geography, remote status, and dated milestones. Call save_evidence with one batched evidence object per company. Within the batch, store one atomic factual assertion per evidence claim and attach the exact page that directly states it; never cite a general homepage, careers index, or older announcement for a fact stated on another page. Recheck volatile counters and current-status claims at run time, preserve the observation date, label company-reported metrics, and record contradictions or gaps instead of guessing.";
  }
  if (nodeId === "final-review") {
    return "Review every source-bearing candidate claim rather than selecting a small showcase subset. Independently verify every material factual claim against the exact cited primary-source page using web_search. Require literal entailment for every clause, not merely a plausible interpretation. Do not transfer modifiers from one noun to another, turn a reported status or forecast into a goal or intent, replace named collaborators with a broader organizational label, or infer branding and organizational claims from product-continuity language. Split compound claims and approve only the clauses explicitly established by the checked source. For multi-company runs, aim for at least eight approved atomic claims per company when the evidence supports them; when it does not, return every supported claim and record the shortfall as an evidence gap instead of inventing coverage. Return approvedClaims as an array of atomic objects with company, statement, sourceUrl, observedAt, and confidence. Reject stale, unsupported, or citation-mismatched claims rather than forwarding or silently repairing them; corrected claims must name the exact page actually checked. Keep hypotheses separate from approvedClaims.";
  }
  if (nodeId === "synthesis") {
    return "Use only dependencyOutputs.final-review.output.approvedClaims for user-facing factual statements. Include every approved claim exactly once. Copy each approved factual statement verbatim with its approved sourceUrl; do not paraphrase, merge, strengthen, weaken, omit, or duplicate it. Do not recover rejected facts from search_evidence or get_opportunities. Keep recommendations and hypotheses explicitly labeled.";
  }
  if (["extract-company", "extract-product", "extract-hiring", "extract-technology", "normalize-evidence", "supplemental-research"].includes(nodeId)) {
    return "Store one atomic factual assertion per evidence claim with the exact page that directly states it. Do not merge facts from different pages under one convenient URL, and do not promote a hypothesis, absence, or volatile counter into a current fact.";
  }
  return "";
}

function claimKey(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as { statement?: unknown; sourceUrl?: unknown; fact?: unknown; source?: unknown };
  const statement = typeof record.statement === "string" ? record.statement : record.fact;
  const sourceUrl = typeof record.sourceUrl === "string" ? record.sourceUrl : record.source;
  return typeof statement === "string" && typeof sourceUrl === "string"
    ? JSON.stringify([statement, sourceUrl])
    : undefined;
}

function validateClaimBearingOutput(
  nodeId: string,
  output: Record<string, unknown>,
  dependencyOutputs: Record<string, unknown>,
) {
  if (nodeId !== "synthesis") return;
  const finalReview = dependencyOutputs["final-review"] as { output?: { approvedClaims?: unknown } } | undefined;
  const approvedClaims = finalReview?.output?.approvedClaims;
  if (!Array.isArray(approvedClaims)) return;
  const flatFacts = Array.isArray(output.facts) ? output.facts : [];
  const profileFacts = Array.isArray(output.companyProfiles)
    ? output.companyProfiles.flatMap((profile) =>
      typeof profile === "object" && profile !== null && Array.isArray((profile as { facts?: unknown }).facts)
        ? (profile as { facts: unknown[] }).facts
        : [])
    : [];
  const counts = (claims: unknown[]) => {
    const result = new Map<string, number>();
    for (const claim of claims) {
      const key = claimKey(claim);
      if (key) result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  };
  const approvedCounts = counts(approvedClaims);
  const synthesizedCounts = counts([...flatFacts, ...profileFacts]);
  const exact = approvedCounts.size === synthesizedCounts.size
    && [...approvedCounts].every(([key, count]) => synthesizedCounts.get(key) === count);
  if (!exact) throw new Error("Synthesis must include every approved claim exactly once with its approved source URL");
}

export function createAgentNodeExecutor(options: {
  registry: ModelRegistry;
  availableModels: ReadonlySet<string>;
  runtime: AgentRuntime;
}): NodeExecutor {
  return async (context: NodeExecutionContext) => {
    if (context.node.role === "deterministic") {
      throw new Error(`Node ${context.node.id} is deterministic and cannot run through a model runtime`);
    }

    const configuration = roleConfiguration[context.node.role];
    const model = resolveModel(options.registry, context.node.role, options.availableModels);
    const domainCount = typeof context.input === "object" && context.input !== null
      && Array.isArray((context.input as { domains?: unknown }).domains)
      ? (context.input as { domains: unknown[] }).domains.length
      : 1;
    const isCohortClaimNode = context.node.id === "final-review" || context.node.id === "synthesis";
    const factLimit = context.node.id === "current-research"
      ? 50
      : isCohortClaimNode ? Math.min(100, Math.max(20, domainCount * 10)) : 20;
    const serializedTokenLimit = isCohortClaimNode ? 7_000 : 3_000;
    const executionContract = `Execute only the requested DAG node. You MUST call every tool listed in requiredTools before answering. Return exactly one valid JSON object with no Markdown fence or prose outside the object. Keep the serialized output under ${serializedTokenLimit.toLocaleString("en-US")} tokens, include at most ${factLimit} concise facts or evidence records, and never reproduce source documents.`;
    const result = await options.runtime({
      agentName: configuration.name,
      instructions: `${configuration.instructions} ${nodeSpecificInstructions(context.node.id)} ${executionContract}`,
      model,
      reasoningEffort: configuration.reasoningEffort,
      tools: [...context.node.allowedTools],
      requiredTools: [...context.node.requiredTools],
      ...(isCohortClaimNode ? { maxOutputTokens: 8_192 } : {}),
      input: {
        runId: context.runId,
        nodeId: context.node.id,
        attempt: context.attempt,
        requiredTools: [...context.node.requiredTools],
        workflowInput: context.input,
        dependencyOutputs: context.dependencyOutputs,
      },
    });
    const output = requireStructuredOutput(result.output);
    validateClaimBearingOutput(context.node.id, output, context.dependencyOutputs);

    for (const toolName of result.usedTools) context.useTool(toolName);
    return {
      output,
      responseId: result.responseId,
      model,
      reasoningEffort: configuration.reasoningEffort,
    };
  };
}

export function createRoleAwareNodeExecutor(options: {
  deterministicExecutor: NodeExecutor;
  agentExecutor: NodeExecutor;
}): NodeExecutor {
  return (context) => context.node.role === "deterministic"
    ? options.deterministicExecutor(context)
    : options.agentExecutor(context);
}

export function resolveMaxOutputTokens(value?: number) {
  const resolved = value ?? 4_096;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 16_384) {
    throw new Error("maxOutputTokens must be between 1 and 16384");
  }
  return resolved;
}

export function createOpenAIAgentsRuntime(options: {
  vectorStoreIds?: string[];
  customTools?: Record<string, AnyFunctionTool>;
  maxTurns?: number;
} = {}): AgentRuntime {
  const vectorStoreIds = options.vectorStoreIds ?? [];
  const customTools = options.customTools ?? {};

  return async (request) => {
    const enabledToolNames = selectAvailableToolNames(request.tools, vectorStoreIds, request.requiredTools);
    const tools: Array<HostedTool | AnyFunctionTool> = enabledToolNames.map((toolName) => {
      if (toolName === "web_search") {
        return webSearchTool({ searchContextSize: "medium", externalWebAccess: true });
      }
      if (toolName === "file_search") {
        return fileSearchTool(vectorStoreIds, { includeSearchResults: true, maxNumResults: 12 });
      }
      if (toolName === "code_interpreter") {
        return codeInterpreterTool({ includeOutputs: true });
      }
      const customTool = customTools[toolName];
      if (!customTool) throw new Error(`No OpenAI tool adapter is configured for ${toolName}`);
      return customTool;
    });

    const agent = new Agent({
      name: request.agentName,
      instructions: request.instructions,
      model: request.model,
      modelSettings: {
        reasoning: { effort: request.reasoningEffort },
        text: { verbosity: "medium" },
        parallelToolCalls: true,
        maxTokens: resolveMaxOutputTokens(request.maxOutputTokens),
        store: false,
      },
      outputType: request.outputType ?? gtmNodeOutputType,
      tools,
    });

    const result = await run(agent, JSON.stringify(request.input), {
      context: extractToolRunContext(request.input),
      maxTurns: options.maxTurns ?? 12,
    });
    const usedTools = result.newItems.flatMap((item) => {
      if (item.type !== "tool_call_item") return [];
      const rawItem = item.rawItem;
      if (rawItem.type === "hosted_tool_call" || rawItem.type === "function_call") {
        return [normalizeProviderToolName(rawItem.name)];
      }
      return [];
    });

    return {
      output: result.finalOutput,
      usedTools: [...new Set(usedTools)],
      ...(result.lastResponseId ? { responseId: result.lastResponseId } : {}),
    };
  };
}
