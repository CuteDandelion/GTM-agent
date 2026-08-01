import {
  createAgentNodeExecutor,
  createRoleAwareNodeExecutor,
  type AgentRuntime,
} from "@gtm/agents";
import {
  createGtmResearchWorkflow,
  createModelRegistry,
  DagScheduler,
  type CheckpointStore,
  type NodeExecutor,
} from "@gtm/orchestration";

export type DeterministicTool = (input: {
  runId: string;
  nodeId: string;
  workflowInput: unknown;
  dependencyOutputs: Record<string, unknown>;
  domains: string[];
}) => Promise<unknown>;

export function createResearchScheduler(options: {
  agentRuntime: AgentRuntime;
  availableModels: ReadonlySet<string>;
  checkpointStore: CheckpointStore;
  deterministicTools: Record<string, DeterministicTool>;
}): DagScheduler {
  const deterministicExecutor: NodeExecutor = async (context) => {
    const outputs: Record<string, unknown> = {};
    const domains = typeof context.input === "object"
      && context.input !== null
      && Array.isArray((context.input as { domains?: unknown }).domains)
      ? (context.input as { domains: string[] }).domains
      : [];

    for (const toolName of context.node.requiredTools) {
      const handler = options.deterministicTools[toolName];
      if (!handler) throw new Error(`Deterministic tool ${toolName} is not registered`);
      outputs[toolName] = await handler({
        runId: context.runId,
        nodeId: context.node.id,
        workflowInput: context.input,
        dependencyOutputs: context.dependencyOutputs,
        domains,
      });
      context.useTool(toolName);
    }
    return outputs;
  };
  const agentExecutor = createAgentNodeExecutor({
    registry: createModelRegistry(),
    availableModels: options.availableModels,
    runtime: options.agentRuntime,
  });

  return new DagScheduler({
    workflow: createGtmResearchWorkflow(),
    checkpoints: options.checkpointStore,
    executor: createRoleAwareNodeExecutor({ deterministicExecutor, agentExecutor }),
  });
}
