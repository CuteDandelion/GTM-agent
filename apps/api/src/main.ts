import { fileURLToPath } from "node:url";

import { createOpenCodeRuntime, startOpenCodeAgentService } from "@gtm/agents";

import { buildServer } from "./server.js";
import { createApplicationConversationAgent, createApplicationResearchService } from "./bootstrap.js";
import { createEnvironmentAuthService } from "./supabase-auth.js";
import { InMemoryInteractiveObjectService } from "./interactive-actions.js";
import { createEnvironmentInteractiveObjectService } from "./supabase-interactive-objects.js";
import { createEnvironmentWorkspaceService } from "./supabase-workspace.js";

const workspaceService = createEnvironmentWorkspaceService();
const interactiveObjectService = createEnvironmentInteractiveObjectService() ?? new InMemoryInteractiveObjectService();
const requiredEnvironment = [
  "OPENCODE_KEY",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
] as const;
const openCodeService = await startOpenCodeAgentService({
  directory: fileURLToPath(new URL("../", import.meta.url)),
});
const createRuntime = (toolDefinitions = {}) => createOpenCodeRuntime({
  transport: openCodeService.transport,
  bridge: openCodeService.bridge,
  toolDefinitions,
});
const configurationReady = requiredEnvironment.every((key) => Boolean(process.env[key]?.trim()))
  && await openCodeService.isReady();
const server = buildServer({
  conversationAgent: createApplicationConversationAgent(createRuntime()),
  researchService: createApplicationResearchService({
    interactiveObjectService,
    createAgentRuntime: createRuntime,
  }),
  authService: createEnvironmentAuthService(),
  objectActionService: interactiveObjectService,
  ...(workspaceService ? { workspaceService } : {}),
  configurationReady,
});
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

async function shutdown(signal: string) {
  server.log.info({ signal }, "shutdown requested");
  await server.close();
  await openCodeService.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await server.listen({ host, port });
} catch (error) {
  server.log.error(error);
  await openCodeService.close();
  process.exitCode = 1;
}
