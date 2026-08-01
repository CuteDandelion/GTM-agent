import { z } from "zod";

export const evidenceInputSchema = z.object({
  workflowRunId: z.string().min(1),
  companyId: z.string().min(1).optional(),
  sourceType: z.enum(["web", "document", "company-site", "user-correction"]),
  sourceUrl: z.url().optional(),
  documentId: z.string().min(1).optional(),
  title: z.string().min(1),
  observedAt: z.iso.datetime(),
  excerpt: z.string().min(1),
  contentHash: z.string().min(8),
  classification: z.enum(["fact", "inference", "hypothesis"]),
  confidence: z.number().min(0).max(1),
  citation: z.record(z.string(), z.unknown()).default({}),
}).superRefine((value, context) => {
  if (!value.sourceUrl && !value.documentId) {
    context.addIssue({
      code: "custom",
      message: "Evidence requires a sourceUrl or documentId",
      path: ["sourceUrl"],
    });
  }
});

export type EvidenceInput = z.infer<typeof evidenceInputSchema>;
export type ToolHandler = (input: unknown) => Promise<unknown>;

export interface ToolSessionPolicy {
  nodeId: string;
  allowedTools: string[];
  requiredTools: string[];
}

export interface ToolSession {
  invoke(toolName: string, input: unknown): Promise<unknown>;
  assertRequirements(): void;
  usedTools(): string[];
}

export interface ToolGateway {
  startSession(policy: ToolSessionPolicy): ToolSession;
  registeredTools(): string[];
}

export function createToolGateway(handlers: Record<string, ToolHandler>): ToolGateway {
  const registered = new Map(Object.entries(handlers));

  return {
    registeredTools: () => [...registered.keys()].sort(),
    startSession(policy) {
      const allowed = new Set(policy.allowedTools);
      const required = new Set(policy.requiredTools);
      const used = new Set<string>();

      for (const toolName of required) {
        if (!allowed.has(toolName)) {
          throw new Error(`Required tool ${toolName} is not allowed for node ${policy.nodeId}`);
        }
      }

      return {
        async invoke(toolName, input) {
          if (!allowed.has(toolName)) {
            throw new Error(`Tool ${toolName} is not allowed for node ${policy.nodeId}`);
          }
          const handler = registered.get(toolName);
          if (!handler) throw new Error(`Tool ${toolName} is not registered`);
          const output = await handler(input);
          used.add(toolName);
          return output;
        },
        assertRequirements() {
          const missing = [...required].filter((toolName) => !used.has(toolName));
          if (missing.length > 0) {
            throw new Error(`Node ${policy.nodeId} did not use required tools: ${missing.join(", ")}`);
          }
        },
        usedTools: () => [...used],
      };
    },
  };
}
