import {
  Agent,
  fileSearchTool,
  run,
  tool,
  webSearchTool,
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
    try {
      candidate = JSON.parse(candidate);
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

const functionToolInputSchema = z.object({ input: z.unknown().optional() });

export function createFunctionToolAdapters(
  definitions: Record<string, FunctionToolAdapterDefinition>,
): Record<string, AnyFunctionTool> {
  return Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [
    name,
    tool({
      name,
      description: definition.description,
      parameters: functionToolInputSchema,
      strict: true,
      execute: async ({ input }, runContext?: RunContext<ToolRunContext>) => JSON.stringify(
        runContext?.context
          ? await definition.handler(input, runContext.context)
          : await definition.handler(input),
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
    const result = await options.runtime({
      agentName: configuration.name,
      instructions: configuration.instructions,
      model,
      reasoningEffort: configuration.reasoningEffort,
      tools: [...context.node.allowedTools],
      input: {
        runId: context.runId,
        nodeId: context.node.id,
        attempt: context.attempt,
        workflowInput: context.input,
        dependencyOutputs: context.dependencyOutputs,
      },
    });
    const output = requireStructuredOutput(result.output);

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

export function createOpenAIAgentsRuntime(options: {
  vectorStoreIds?: string[];
  customTools?: Record<string, AnyFunctionTool>;
  maxTurns?: number;
} = {}): AgentRuntime {
  const vectorStoreIds = options.vectorStoreIds ?? [];
  const customTools = options.customTools ?? {};

  return async (request) => {
    const tools: Array<HostedTool | AnyFunctionTool> = request.tools.map((toolName) => {
      if (toolName === "web_search") {
        return webSearchTool({ searchContextSize: "medium", externalWebAccess: true });
      }
      if (toolName === "file_search") {
        if (vectorStoreIds.length === 0) {
          throw new Error("file_search requires at least one configured vector store");
        }
        return fileSearchTool(vectorStoreIds, { includeSearchResults: true, maxNumResults: 12 });
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
        store: false,
      },
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
        return [rawItem.name];
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
