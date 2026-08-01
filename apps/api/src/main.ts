import { buildServer } from "./server.js";
import { createApplicationResearchService } from "./bootstrap.js";
import { createEnvironmentAuthService } from "./supabase-auth.js";
import { InMemoryInteractiveObjectService } from "./interactive-actions.js";

const server = buildServer({
  researchService: createApplicationResearchService(),
  authService: createEnvironmentAuthService(),
  objectActionService: new InMemoryInteractiveObjectService(),
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
