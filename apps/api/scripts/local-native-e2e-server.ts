import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import {
  createLocalE2eAgentRuntime,
  createLocalE2eConversationAgent,
} from "../src/local-e2e-runtime.js";
import {
  createProjectingCheckpointStore,
  createRunProjectionObserver,
} from "../src/run-interactive-object-projection.js";
import { createResearchScheduler } from "../src/runtime.js";
import { createResearchService } from "../src/research-service.js";
import { buildServer } from "../src/server.js";
import { createSupabaseAuthService } from "../src/supabase-auth.js";
import { createSupabaseInteractiveObjectService } from "../src/supabase-interactive-objects.js";
import { createSupabaseResearchPersistence } from "../src/supabase-research-persistence.js";
import { createSupabaseWorkspaceService } from "../src/supabase-workspace.js";

const email = "gtm-native-e2e@example.test";
const password = "Local-GTM-E2E-2026!";
const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  throw new Error("Local native E2E requires SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY");
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const authClient = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
if (listed.error) throw listed.error;
for (const existing of listed.data.users.filter((user) => user.email === email)) {
  const deleted = await admin.auth.admin.deleteUser(existing.id);
  if (deleted.error) throw deleted.error;
}

const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw created.error ?? new Error("Unable to create local E2E user");
const ownerId = created.data.user.id;
const workspaceService = createSupabaseWorkspaceService(admin);

const persistence = createSupabaseResearchPersistence(admin, { workerLeaseId: randomUUID() });
const interactiveObjectService = createSupabaseInteractiveObjectService(admin);
const projectionObserver = createRunProjectionObserver(interactiveObjectService);
const scheduler = createResearchScheduler({
  agentRuntime: createLocalE2eAgentRuntime(),
  availableModels: new Set(["opencode-go/minimax-m3", "opencode-go/gpt-5.6-luna", "opencode-go/minimax-m3"]),
  checkpointStore: createProjectingCheckpointStore({
    checkpointStore: persistence.checkpointStore,
    runStore: persistence.runStore,
    observe: projectionObserver,
  }),
  deterministicTools: {
    validate_domain: async ({ domains }) => ({ domains }),
    crawl_company: async ({ domains }) => ({
      companies: domains.map((domain) => ({
        domain,
        pageCount: 1,
        truncated: false,
        sourceUrls: [`https://${domain}/`],
      })),
    }),
  },
});
const researchService = createResearchService({
  scheduler,
  runStore: persistence.runStore,
  onRunUpdated: projectionObserver,
});
const server = buildServer({
  logger: true,
  authService: createSupabaseAuthService(authClient),
  workspaceService,
  objectActionService: interactiveObjectService,
  researchService,
  conversationAgent: createLocalE2eConversationAgent(),
  configurationReady: true,
});

let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  await server.close().catch(() => undefined);
  const deleted = await admin.auth.admin.deleteUser(ownerId);
  if (deleted.error) server.log.error(deleted.error, "unable to delete local E2E user");
}

async function shutdown(signal: string) {
  server.log.info({ signal }, "local native E2E shutdown requested");
  await cleanup();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const origin = await server.listen({ host: "127.0.0.1", port });
  server.log.info({
    origin,
    email,
    password,
    provider: "deterministic-local-e2e",
  }, "local native E2E server ready; this lane does not measure research accuracy");
} catch (error) {
  server.log.error(error);
  await cleanup();
  process.exitCode = 1;
}
