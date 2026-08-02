import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const requiredTables = [
  "profiles",
  "seller_profiles",
  "icp_definitions",
  "conversations",
  "messages",
  "companies",
  "company_domains",
  "workflow_templates",
  "workflow_runs",
  "workflow_nodes",
  "node_dependencies",
  "node_attempts",
  "node_artifacts",
  "model_invocations",
  "tool_invocations",
  "evidence",
  "claims",
  "icp_assessments",
  "opportunities",
  "interactive_objects",
  "feedback_events",
];

test("the initial migration creates every MVP table with RLS", async () => {
  const files = await readdir(new URL("../../supabase/migrations/", import.meta.url));
  const migrationFile = files.find((file) => file.endsWith("_initial_gtm_schema.sql"));
  assert.ok(migrationFile, "expected an initial_gtm_schema migration");

  const sql = await readFile(
    new URL(`../../supabase/migrations/${migrationFile}`, import.meta.url),
    "utf8",
  );

  for (const table of requiredTables) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`, "i"));
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    );
  }
});

test("the migration creates private buckets and owner-scoped policies", async () => {
  const files = await readdir(new URL("../../supabase/migrations/", import.meta.url));
  const migrationFile = files.find((file) => file.endsWith("_initial_gtm_schema.sql"));
  assert.ok(migrationFile, "expected an initial_gtm_schema migration");
  const sql = await readFile(
    new URL(`../../supabase/migrations/${migrationFile}`, import.meta.url),
    "utf8",
  );

  for (const bucket of ["research-sources", "user-uploads", "exports"]) {
    assert.match(sql, new RegExp(`'${bucket}'`, "i"));
  }
  assert.match(sql, /with check\s*\([^;]*auth\.uid\(\)/is);
  assert.match(sql, /using\s*\([^;]*auth\.uid\(\)/is);
  assert.doesNotMatch(sql, /auth\.role\(\)/i);
  assert.doesNotMatch(sql, /raw_user_meta_data|user_metadata/i);
});

test("conversation workflow prompts have a service-only atomic FIFO claim function", async () => {
  const files = await readdir(new URL("../../supabase/migrations/", import.meta.url));
  const migrationFile = files.find((file) => file.endsWith("_conversation_workflow_queue.sql"));
  assert.ok(migrationFile, "expected a conversation_workflow_queue migration");
  const sql = await readFile(
    new URL(`../../supabase/migrations/${migrationFile}`, import.meta.url),
    "utf8",
  );

  assert.match(sql, /create or replace function public\.claim_next_conversation_workflow_run/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /status\s*=\s*'queued'[\s\S]*order by\s+created_at\s+asc/i);
  assert.match(sql, /not exists[\s\S]*status\s*=\s*'running'/i);
  assert.match(sql, /revoke all on function public\.claim_next_conversation_workflow_run[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.claim_next_conversation_workflow_run[\s\S]*to service_role/i);
});
