import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const blueprint = await readFile(new URL("../../render.yaml", import.meta.url), "utf8");

test("the Render blueprint stays on one free web service with readiness checks", () => {
  assert.match(blueprint, /type:\s*web/);
  assert.match(blueprint, /plan:\s*free/);
  assert.match(blueprint, /healthCheckPath:\s*\/ready/);
  assert.match(blueprint, /startCommand:\s*npm start -w @gtm\/api/);
  assert.doesNotMatch(blueprint, /\bdatabases:/);
  assert.doesNotMatch(blueprint, /\bdisk:/);
});

test("provider and storage credentials are declared as dashboard-managed secrets", () => {
  for (const key of ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
    assert.match(blueprint, new RegExp(`key: ${key}\\s+sync: false`));
  }
  assert.doesNotMatch(blueprint, /sk-[A-Za-z0-9_-]+/);
});
