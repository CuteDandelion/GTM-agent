import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../../.github/workflows/publish-api-image.yml", import.meta.url), "utf8");

test("the API image publisher uses GitHub's scoped token and immutable commit tag", () => {
  assert.match(workflow, /push:[\s\S]*branches:[\s\S]*codex\/gtm-orchestrator-mvp/);
  assert.match(workflow, /packages:\s*write/);
  assert.match(workflow, /password:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(workflow, /platforms:\s*linux\/amd64/);
  assert.match(workflow, /tags:\s*ghcr\.io\/cutedandelion\/gtm-agent-api:\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /:latest/);
});
