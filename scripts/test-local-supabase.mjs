import { spawnSync } from "node:child_process";

function parseEnvironment(output) {
  return Object.fromEntries(output.split("\n").flatMap((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/);
    return match ? [[match[1], match[2] ?? match[3] ?? ""]] : [];
  }));
}

const status = spawnSync("npx", ["supabase", "status", "--output", "env"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

if (status.status !== 0) {
  process.stderr.write(status.stderr || "Local Supabase is unavailable.\n");
  process.exit(status.status ?? 1);
}

const local = parseEnvironment(status.stdout);
const url = local.API_URL;
const publishableKey = local.PUBLISHABLE_KEY || local.ANON_KEY;
const secretKey = local.SECRET_KEY || local.SERVICE_ROLE_KEY;

if (!url || !publishableKey || !secretKey) {
  process.stderr.write("Local Supabase status did not provide the required API credentials.\n");
  process.exit(1);
}

let authReady = false;
for (let attempt = 0; attempt < 200; attempt += 1) {
  try {
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: publishableKey },
    });
    if (response.ok) {
      authReady = true;
      break;
    }
  } catch {
    // The local stack can briefly accept connections before Auth is ready after db reset.
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

if (!authReady) {
  process.stderr.write("Local Supabase Auth did not become ready within 50 seconds.\n");
  process.exit(1);
}

const selectedTests = process.argv.slice(2);
const integrationTests = selectedTests.length > 0 ? selectedTests : [
  "tests/supabase-workspace.integration.test.ts",
  "tests/supabase-research-persistence.integration.test.ts",
];

const tests = spawnSync(
  "npm",
  [
    "test",
    "--workspace",
    "@gtm/api",
    "--",
    ...integrationTests,
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GTM_SUPABASE_INTEGRATION: "1",
      SUPABASE_URL: url,
      SUPABASE_PUBLISHABLE_KEY: publishableKey,
      SUPABASE_SECRET_KEY: secretKey,
    },
    stdio: "inherit",
  },
);

process.exit(tests.status ?? 1);
