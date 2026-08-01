import { buildServer } from "./server.js";
import { createApplicationResearchService } from "./bootstrap.js";
import { createEnvironmentAuthService } from "./supabase-auth.js";
import { InMemoryInteractiveObjectService } from "./interactive-actions.js";
import { createEnvironmentWorkspaceService } from "./supabase-workspace.js";

const workspaceService = createEnvironmentWorkspaceService();
const requiredEnvironment = [
  "OPENAI_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
] as const;
const configurationReady = requiredEnvironment.every((key) => Boolean(process.env[key]?.trim()));
const server = buildServer({
  researchService: createApplicationResearchService(),
  authService: createEnvironmentAuthService(),
  objectActionService: new InMemoryInteractiveObjectService(),
  ...(workspaceService ? { workspaceService } : {}),
  configurationReady,
});
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

async function shutdown(signal: string) {
  server.log.info({ signal }, "shutdown requested");
  await server.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await server.listen({ host, port });
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}
