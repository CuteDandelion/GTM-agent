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

test("dynamic interaction prompts and responses remain compatible with the database RPCs", async () => {
  const files = await readdir(new URL("../../supabase/migrations/", import.meta.url));
  const migrationFile = files.find((file) => file.endsWith("_publish_interactive_object.sql"));
  assert.ok(migrationFile, "expected a publish_interactive_object migration");
  const sql = await readFile(
    new URL(`../../supabase/migrations/${migrationFile}`, import.meta.url),
    "utf8",
  );

  assert.match(sql, /p_object_type\s+not\s+in\s*\([\s\S]*'interaction_prompt'[\s\S]*\)/i);
  assert.match(sql, /create or replace function public\.apply_interactive_object_action/i);
  assert.match(sql, /p_action\s+not\s+in\s*\([\s\S]*'respond'[\s\S]*\)/i);
  assert.match(sql, /revoke all on function public\.apply_interactive_object_action[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.apply_interactive_object_action[\s\S]*to service_role/i);
});

test("authenticated users retain only explicitly bounded trusted-table privileges", async () => {
  const files = await readdir(new URL("../../supabase/migrations/", import.meta.url));
  const migrationFile = files.find((file) => file.endsWith("_restrict_authenticated_trusted_writes.sql"));
  assert.ok(migrationFile, "expected a restrict_authenticated_trusted_writes migration");
  const sql = await readFile(
    new URL(`../../supabase/migrations/${migrationFile}`, import.meta.url),
    "utf8",
  );

  assert.match(sql, /revoke all privileges on table public\.%I from authenticated/i);
  assert.match(sql, /grant select on table public\.%I to authenticated/i);
  assert.match(sql, /revoke all privileges on table public\.workflow_checkpoints, public\.research_artifacts from authenticated/i);
  assert.match(sql, /grant select on table public\.workflow_checkpoints, public\.research_artifacts to authenticated/i);
  assert.match(sql, /revoke all privileges on table public\.user_documents from authenticated/i);
  assert.match(sql, /grant select on table public\.user_documents to authenticated/i);
  assert.match(sql, /grant insert\s*\([\s\S]*status[\s\S]*\)\s*on table public\.user_documents to authenticated/i);
});
