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

const tests = spawnSync(
  "npm",
  ["test", "--workspace", "@gtm/api", "--", "tests/supabase-workspace.integration.test.ts"],
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
