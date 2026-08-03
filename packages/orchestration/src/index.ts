export type AgentRole =
  | "planner"
  | "executor"
  | "analyst"
  | "conversation"
  | "critic"
  | "portfolio";

export type NodeRole = AgentRole | "deterministic";

export interface ModelRoute {
  preferred: string;
  fallbacks: string[];
}

export interface ModelRegistry {
  models: string[];
  routes: Record<AgentRole, ModelRoute>;
}

export function createModelRegistry(overrides: Partial<Record<AgentRole, Partial<ModelRoute>>> = {}): ModelRegistry {
  const routes: Record<AgentRole, ModelRoute> = {
    planner: { preferred: "opencode-go/minimax-m3", fallbacks: ["opencode-go/gpt-5.6-luna"] },
    executor: { preferred: "opencode-go/gpt-5.6-luna", fallbacks: ["opencode-go/minimax-m3"] },
    analyst: { preferred: "opencode-go/minimax-m3", fallbacks: ["opencode-go/gpt-5.6-luna"] },
    conversation: { preferred: "opencode-go/gpt-5.6-luna", fallbacks: ["opencode-go/minimax-m3"] },
    critic: { preferred: "opencode-go/minimax-m3", fallbacks: ["opencode-go/gpt-5.6-luna"] },
    portfolio: { preferred: "opencode-go/minimax-m3", fallbacks: ["opencode-go/gpt-5.6-luna"] },
  };

  for (const role of Object.keys(overrides) as AgentRole[]) {
    routes[role] = { ...routes[role], ...overrides[role] };
  }

  return {
    routes,
    models: [...new Set(Object.values(routes).flatMap(({ preferred, fallbacks }) => [preferred, ...fallbacks]))],
  };
}

export function resolveModel(registry: ModelRegistry, role: AgentRole, availableModels: ReadonlySet<string>): string {
  const route = registry.routes[role];
  for (const model of [route.preferred, ...route.fallbacks]) {
    if (availableModels.has(model)) return model;
  }
  throw new Error(`No available model satisfies the ${role} routing policy`);
}

export interface WorkflowNodeDefinition {
  id: string;
  dependencies: string[];
  role: NodeRole;
  concurrencyKey?: string | undefined;
  allowedTools: string[];
  requiredTools: string[];
  retries: number;
  timeoutMs: number;
  when?: (context: { input: unknown; dependencyOutputs: Record<string, unknown> }) => boolean;
}

export interface WorkflowDefinition {
  id: string;
  budget: { maxNodeExecutions: number; maxConcurrency?: number };
  nodes: WorkflowNodeDefinition[];
}

export function defineWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  if (!definition.id.trim()) throw new Error("Workflow id is required");
  if (!Number.isInteger(definition.budget.maxNodeExecutions) || definition.budget.maxNodeExecutions < 1) {
    throw new Error("maxNodeExecutions must be a positive integer");
  }
  if (definition.budget.maxConcurrency !== undefined
    && (!Number.isInteger(definition.budget.maxConcurrency) || definition.budget.maxConcurrency < 1)) {
    throw new Error("maxConcurrency must be a positive integer");
  }

  const nodeById = new Map<string, WorkflowNodeDefinition>();
  for (const node of definition.nodes) {
    if (nodeById.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
    if (node.retries < 0 || !Number.isInteger(node.retries)) throw new Error(`Invalid retries for ${node.id}`);
    if (node.timeoutMs < 1) throw new Error(`Invalid timeout for ${node.id}`);
    for (const tool of node.requiredTools) {
      if (!node.allowedTools.includes(tool)) {
        throw new Error(`Required tool ${tool} is not allowed for ${node.id}`);
      }
    }
    nodeById.set(node.id, node);
  }

  for (const node of definition.nodes) {
    for (const dependency of node.dependencies) {
      if (!nodeById.has(dependency)) throw new Error(`Unknown dependency ${dependency} for ${node.id}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) throw new Error(`Workflow contains a cycle at ${nodeId}`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const dependency of nodeById.get(nodeId)!.dependencies) visit(dependency);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of definition.nodes) visit(node.id);

  return {
    ...definition,
    budget: { ...definition.budget },
    nodes: definition.nodes.map((node) => ({
      ...node,
      dependencies: [...node.dependencies],
      allowedTools: [...node.allowedTools],
      requiredTools: [...node.requiredTools],
    })),
  };
}

export type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "cancelled";

export interface NodeCheckpoint {
  status: NodeStatus;
  attempts: number;
  output?: unknown;
  error?: string;
  toolsUsed: string[];
}

export interface RunCheckpoint {
  runId: string;
  workflowId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  executionCount: number;
  nodes: Record<string, NodeCheckpoint>;
}

export interface CheckpointStore {
  load(runId: string): Promise<RunCheckpoint | undefined>;
  save(checkpoint: RunCheckpoint): Promise<void>;
}

export class InMemoryCheckpointStore implements CheckpointStore {
  readonly #runs = new Map<string, RunCheckpoint>();

  async load(runId: string): Promise<RunCheckpoint | undefined> {
    const checkpoint = this.#runs.get(runId);
    return checkpoint ? structuredClone(checkpoint) : undefined;
  }

  async save(checkpoint: RunCheckpoint): Promise<void> {
    this.#runs.set(checkpoint.runId, structuredClone(checkpoint));
  }
}

export interface NodeExecutionContext {
  runId: string;
  node: WorkflowNodeDefinition;
  attempt: number;
  input: unknown;
  dependencyOutputs: Record<string, unknown>;
  useTool(toolName: string): void;
}

export type NodeExecutor = (context: NodeExecutionContext) => Promise<unknown>;

export interface DagSchedulerOptions {
  workflow: WorkflowDefinition;
  checkpoints: CheckpointStore;
  executor: NodeExecutor;
  retryDelay?: (milliseconds: number) => Promise<void>;
}

function providerRetryDelayMs(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (!/\b429\b|rate limit/i.test(message)) return 0;
  const seconds = message.match(/try again in\s+([0-9]+(?:\.[0-9]+)?)s/i)?.[1];
  if (!seconds) return 1_000;
  return Math.min(60_000, Math.max(1_000, Math.ceil(Number(seconds) * 1_000)));
}

const defaultRetryDelay = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

function initialCheckpoint(runId: string, workflow: WorkflowDefinition): RunCheckpoint {
  return {
    runId,
    workflowId: workflow.id,
    status: "running",
    executionCount: 0,
    nodes: Object.fromEntries(
      workflow.nodes.map((node) => [node.id, { status: "pending", attempts: 0, toolsUsed: [] }]),
    ),
  };
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, nodeId: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Node ${nodeId} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class DagScheduler {
  readonly #workflow: WorkflowDefinition;
  readonly #checkpoints: CheckpointStore;
  readonly #executor: NodeExecutor;
  readonly #retryDelay: (milliseconds: number) => Promise<void>;
  readonly #cancelledRuns = new Set<string>();

  constructor({ workflow, checkpoints, executor, retryDelay = defaultRetryDelay }: DagSchedulerOptions) {
    this.#workflow = defineWorkflow(workflow);
    this.#checkpoints = checkpoints;
    this.#executor = executor;
    this.#retryDelay = retryDelay;
  }

  async cancel(runId: string): Promise<void> {
    this.#cancelledRuns.add(runId);
    const checkpoint = await this.#checkpoints.load(runId);
    if (!checkpoint || checkpoint.status === "completed" || checkpoint.status === "failed") return;
    checkpoint.status = "cancelled";
    for (const node of Object.values(checkpoint.nodes)) {
      if (node.status === "pending" || node.status === "running") node.status = "cancelled";
    }
    await this.#checkpoints.save(checkpoint);
  }

  async resume(runId: string, input: unknown): Promise<RunCheckpoint> {
    const checkpoint = await this.#checkpoints.load(runId);
    if (checkpoint?.status === "cancelled" || checkpoint?.status === "failed") {
      for (const node of Object.values(checkpoint.nodes)) {
        if (node.status === "cancelled" || node.status === "failed" || node.status === "running") {
          node.status = "pending";
          delete node.error;
        }
      }
      checkpoint.status = "running";
      this.#cancelledRuns.delete(runId);
      await this.#checkpoints.save(checkpoint);
    }
    return this.run(runId, input);
  }

  async run(runId: string, input: unknown): Promise<RunCheckpoint> {
    let checkpoint = await this.#checkpoints.load(runId) ?? initialCheckpoint(runId, this.#workflow);
    if (checkpoint.workflowId !== this.#workflow.id) {
      throw new Error(`Run ${runId} belongs to workflow ${checkpoint.workflowId}`);
    }
    if (checkpoint.status === "completed" || checkpoint.status === "cancelled") return checkpoint;
    checkpoint.status = "running";

    while (true) {
      if (this.#cancelledRuns.has(runId)) {
        checkpoint.status = "cancelled";
        for (const state of Object.values(checkpoint.nodes)) {
          if (state.status === "pending" || state.status === "running") state.status = "cancelled";
        }
        await this.#checkpoints.save(checkpoint);
        return checkpoint;
      }
      const pending = this.#workflow.nodes.filter((node) => checkpoint.nodes[node.id]?.status === "pending");
      if (pending.length === 0) {
        checkpoint.status = Object.values(checkpoint.nodes).every((node) =>
          node.status === "completed" || node.status === "skipped")
          ? "completed"
          : "failed";
        await this.#checkpoints.save(checkpoint);
        return checkpoint;
      }

      const ready = pending.filter((node) =>
        node.dependencies.every((dependency) => {
          const status = checkpoint.nodes[dependency]?.status;
          return status === "completed" || status === "skipped";
        }),
      );
      if (ready.length === 0) {
        checkpoint.status = "failed";
        await this.#checkpoints.save(checkpoint);
        return checkpoint;
      }

      const concurrency = this.#workflow.budget.maxConcurrency ?? 1;
      const occupiedCapacity = new Set<string>();
      const batch: WorkflowNodeDefinition[] = [];
      for (const node of ready) {
        if (batch.length >= concurrency) break;
        if (node.concurrencyKey && occupiedCapacity.has(node.concurrencyKey)) continue;
        batch.push(node);
        if (node.concurrencyKey) occupiedCapacity.add(node.concurrencyKey);
      }
      const batchStatuses = await Promise.all(batch.map(async (node): Promise<"failed" | "cancelled" | undefined> => {
        const nodeState = checkpoint.nodes[node.id]!;
        const dependencyOutputs = Object.fromEntries(
          node.dependencies.map((dependency) => [dependency, checkpoint.nodes[dependency]?.output]),
        );

        if (node.when && !node.when({ input, dependencyOutputs })) {
          nodeState.status = "skipped";
          await this.#checkpoints.save(checkpoint);
          return;
        }

        let attemptsThisExecution = 0;
        while (attemptsThisExecution <= node.retries) {
          if (checkpoint.executionCount >= this.#workflow.budget.maxNodeExecutions) {
            nodeState.status = "failed";
            nodeState.error = "Workflow node execution budget exhausted";
            checkpoint.status = "failed";
            await this.#checkpoints.save(checkpoint);
            return "failed";
          }

          nodeState.status = "running";
          nodeState.attempts += 1;
          attemptsThisExecution += 1;
          nodeState.toolsUsed = [];
          checkpoint.executionCount += 1;
          await this.#checkpoints.save(checkpoint);

          const usedTools = new Set<string>();
          try {
            const output = await withTimeout(
              this.#executor({
                runId,
                node,
                attempt: nodeState.attempts,
                input,
                dependencyOutputs,
                useTool: (toolName) => {
                  if (!node.allowedTools.includes(toolName)) {
                    throw new Error(`Tool ${toolName} is not allowed for node ${node.id}`);
                  }
                  usedTools.add(toolName);
                },
              }),
              node.timeoutMs,
              node.id,
            );

            if (this.#cancelledRuns.has(runId)) {
              nodeState.status = "cancelled";
              nodeState.toolsUsed = [...usedTools];
              checkpoint.status = "cancelled";
              await this.#checkpoints.save(checkpoint);
              return "cancelled";
            }

            for (const requiredTool of node.requiredTools) {
              if (!usedTools.has(requiredTool)) {
                throw new Error(`Required tool ${requiredTool} was not used by node ${node.id}`);
              }
            }

            nodeState.status = "completed";
            nodeState.output = output;
            delete nodeState.error;
            nodeState.toolsUsed = [...usedTools];
            await this.#checkpoints.save(checkpoint);
            break;
          } catch (error) {
            nodeState.error = error instanceof Error ? error.message : String(error);
            nodeState.toolsUsed = [...usedTools];
            if (attemptsThisExecution > node.retries) {
              nodeState.status = "failed";
              checkpoint.status = "failed";
              await this.#checkpoints.save(checkpoint);
              return "failed";
            }
            nodeState.status = "pending";
            await this.#checkpoints.save(checkpoint);
            const delayMs = providerRetryDelayMs(error);
            if (delayMs > 0) await this.#retryDelay(delayMs);
          }
        }
      }));
      if (batchStatuses.some((status) => status === "failed" || status === "cancelled")) return checkpoint;
    }
  }
}

const gtmResearchToolContract: Record<string, {
  allowed?: readonly string[];
  required?: readonly string[];
}> = {
  "research-plan": { required: ["get_seller_profile", "get_icp_definition"] },
  "crawl-company": { required: ["crawl_company"] },
  "extract-company": { required: ["fetch_page", "save_evidence"] },
  "extract-product": { required: ["fetch_page", "save_evidence"] },
  "extract-hiring": { required: ["fetch_page", "save_evidence"] },
  "extract-technology": { required: ["fetch_page", "save_evidence"] },
  "current-research": { required: ["web_search", "save_evidence"] },
  "document-research": {
    allowed: ["extract_document_text", "file_search"],
    required: ["read_document", "save_evidence"],
  },
  "normalize-evidence": { required: ["search_evidence", "save_evidence"] },
  "company-profile": { required: ["search_evidence"] },
  "icp-assessment": { required: ["search_evidence", "get_icp_definition"] },
  "opportunity-analysis": { required: ["search_evidence", "get_seller_profile"] },
  "critical-review": { required: ["get_claim_sources", "web_search"] },
  "supplemental-plan": { required: ["list_open_hypotheses"] },
  "supplemental-research": { required: ["web_search", "save_evidence"] },
  "final-review": { required: ["get_claim_sources", "web_search"] },
  "synthesis": { required: ["search_evidence", "get_opportunities"] },
  "portfolio-comparison": {
    required: ["get_company_profile", "get_opportunities", "compare_companies", "code_interpreter"],
  },
  "interactive-objects": { required: ["get_company_profile", "get_opportunities"] },
};

export function assertGtmResearchToolContract(workflow: WorkflowDefinition): void {
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  for (const [nodeId, contract] of Object.entries(gtmResearchToolContract)) {
    const node = nodesById.get(nodeId);
    if (!node) throw new Error(`GTM research tool contract is missing node ${nodeId}`);

    for (const toolName of contract.allowed ?? []) {
      if (!node.allowedTools.includes(toolName)) {
        throw new Error(`GTM research node ${nodeId} must allow tool ${toolName}`);
      }
    }
    for (const toolName of contract.required ?? []) {
      if (!node.allowedTools.includes(toolName) || !node.requiredTools.includes(toolName)) {
        throw new Error(`GTM research node ${nodeId} must require tool ${toolName}`);
      }
    }
  }
}

export function createGtmResearchWorkflow(): WorkflowDefinition {
  const hasCapability = (input: unknown, capability: string) => {
    if (typeof input !== "object" || input === null) return true;
    const plan = (input as { researchPlan?: unknown }).researchPlan;
    if (typeof plan !== "object" || plan === null) return true;
    const capabilities = (plan as { capabilities?: unknown }).capabilities;
    return Array.isArray(capabilities) && capabilities.includes(capability);
  };
  const concurrencyKeyForRole = (role: NodeRole) => {
    if (role === "executor") return "opencode-go/gpt-5.6-luna";
    if (role === "planner" || role === "analyst" || role === "critic" || role === "portfolio") return "opencode-go/minimax-m3";
    return undefined;
  };
  const node = (
    id: string,
    dependencies: string[],
    role: NodeRole,
    allowedTools: string[],
    requiredTools: string[],
    options: Pick<WorkflowNodeDefinition, "when"> & Partial<Pick<WorkflowNodeDefinition, "timeoutMs">> = {},
  ): WorkflowNodeDefinition => ({
    id,
    dependencies,
    role,
    ...(concurrencyKeyForRole(role) ? { concurrencyKey: concurrencyKeyForRole(role) } : {}),
    allowedTools,
    requiredTools,
    retries: role === "deterministic" ? 1 : 2,
    timeoutMs: role === "deterministic" ? 30_000 : 120_000,
    ...options,
  });

  const workflow = defineWorkflow({
    id: "company-domain-research-v1",
    budget: { maxNodeExecutions: 32, maxConcurrency: 4 },
    nodes: [
      node("research-plan", [], "planner", ["get_seller_profile", "get_icp_definition"], ["get_seller_profile", "get_icp_definition"]),
      node("validate-domain", ["research-plan"], "deterministic", ["validate_domain"], ["validate_domain"]),
      node("crawl-company", ["validate-domain"], "deterministic", ["crawl_company", "fetch_page"], ["crawl_company"]),
      node("extract-company", ["crawl-company"], "executor", ["fetch_page", "save_evidence"], ["fetch_page", "save_evidence"]),
      node("extract-product", ["crawl-company"], "executor", ["fetch_page", "save_evidence"], ["fetch_page", "save_evidence"]),
      node("extract-hiring", ["crawl-company"], "executor", ["fetch_page", "save_evidence"], ["fetch_page", "save_evidence"]),
      node("extract-technology", ["crawl-company"], "executor", ["fetch_page", "save_evidence"], ["fetch_page", "save_evidence"]),
      node(
        "current-research",
        ["research-plan"],
        "executor",
        ["web_search", "save_evidence"],
        ["web_search", "save_evidence"],
        { when: ({ input }) => hasCapability(input, "current_web") },
      ),
      node(
        "document-research",
        ["research-plan"],
        "executor",
        ["read_document", "extract_document_text", "file_search", "save_evidence"],
        ["read_document", "save_evidence"],
        {
          when: ({ input }) => hasCapability(input, "document_research") && Boolean(
            typeof input === "object"
            && input !== null
            && Array.isArray((input as { documentIds?: unknown }).documentIds)
            && (input as { documentIds: unknown[] }).documentIds.length,
          ),
        },
      ),
      node(
        "normalize-evidence",
        ["extract-company", "extract-product", "extract-hiring", "extract-technology", "current-research", "document-research"],
        "executor",
        ["search_evidence", "save_evidence"],
        ["search_evidence", "save_evidence"],
      ),
      node(
        "company-profile",
        ["normalize-evidence"],
        "analyst",
        ["search_evidence"],
        ["search_evidence"],
        { when: ({ input }) => hasCapability(input, "company_profile") },
      ),
      node(
        "icp-assessment",
        ["normalize-evidence"],
        "analyst",
        ["search_evidence", "get_icp_definition"],
        ["search_evidence", "get_icp_definition"],
        { when: ({ input }) => hasCapability(input, "icp_assessment") },
      ),
      node(
        "opportunity-analysis",
        ["normalize-evidence"],
        "analyst",
        ["search_evidence", "get_seller_profile"],
        ["search_evidence", "get_seller_profile"],
        { when: ({ input }) => hasCapability(input, "opportunity_analysis") },
      ),
      node(
        "critical-review",
        ["company-profile", "icp-assessment", "opportunity-analysis"],
        "critic",
        ["get_claim_sources", "web_search"],
        ["get_claim_sources", "web_search"],
      ),
      node(
        "supplemental-plan",
        ["critical-review"],
        "planner",
        ["list_open_hypotheses", "get_claim_sources"],
        ["list_open_hypotheses"],
        {
          when: ({ dependencyOutputs }) => Boolean(
            typeof dependencyOutputs["critical-review"] === "object"
            && dependencyOutputs["critical-review"] !== null
            && (
              (dependencyOutputs["critical-review"] as { needsSupplementalResearch?: unknown }).needsSupplementalResearch === true
              || (
                typeof (dependencyOutputs["critical-review"] as { output?: unknown }).output === "object"
                && (dependencyOutputs["critical-review"] as { output?: { needsSupplementalResearch?: unknown } }).output?.needsSupplementalResearch === true
              )
            ),
          ),
        },
      ),
      node(
        "supplemental-research",
        ["supplemental-plan"],
        "executor",
        ["web_search", "save_evidence"],
        ["web_search", "save_evidence"],
        { when: ({ dependencyOutputs }) => dependencyOutputs["supplemental-plan"] !== undefined },
      ),
      node(
        "final-review",
        ["critical-review", "supplemental-research"],
        "critic",
        ["get_claim_sources", "web_search"],
        ["get_claim_sources", "web_search"],
        { timeoutMs: 300_000 },
      ),
      node("synthesis", ["final-review"], "analyst", ["search_evidence", "get_opportunities"], ["search_evidence", "get_opportunities"]),
      node(
        "portfolio-comparison",
        ["synthesis"],
        "portfolio",
        ["get_company_profile", "get_opportunities", "compare_companies", "code_interpreter"],
        ["get_company_profile", "get_opportunities", "compare_companies", "code_interpreter"],
        {
          when: ({ input }) => hasCapability(input, "portfolio_comparison") && Boolean(
            typeof input === "object"
            && input !== null
            && Array.isArray((input as { domains?: unknown }).domains)
            && (input as { domains: unknown[] }).domains.length > 1,
          ),
        },
      ),
      node("interactive-objects", ["synthesis", "portfolio-comparison"], "conversation", ["get_company_profile", "get_opportunities"], ["get_company_profile", "get_opportunities"]),
    ],
  });
  assertGtmResearchToolContract(workflow);
  return workflow;
}
