import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deployment = await readFile(new URL("../../deploy/bluerose/deployment.yaml", import.meta.url), "utf8");
const dockerfile = await readFile(new URL("../../Dockerfile", import.meta.url), "utf8");

test("the Bluerose deployment is isolated and exposes only a ClusterIP service", () => {
  assert.match(deployment, /kind:\s*Namespace[\s\S]*name:\s*gtm-agent/);
  assert.match(deployment, /kind:\s*Deployment/);
  assert.match(deployment, /kind:\s*Service[\s\S]*type:\s*ClusterIP/);
  assert.doesNotMatch(deployment, /type:\s*(?:NodePort|LoadBalancer)/);
  assert.doesNotMatch(deployment, /namespace:\s*(?:portfolio|cloudflare-tunnel|kube-system)/);
});

test("the API has rollout, resource, and health protections", () => {
  assert.match(deployment, /image:\s*ghcr\.io\/cutedandelion\/gtm-agent-api:REPLACE_WITH_COMMIT_SHA/);
  assert.doesNotMatch(deployment, /image:[^\n]*:latest/);
  assert.match(deployment, /readinessProbe:[\s\S]*path:\s*\/ready/);
  assert.match(deployment, /livenessProbe:[\s\S]*path:\s*\/health/);
  assert.match(deployment, /resources:[\s\S]*requests:[\s\S]*cpu:[\s\S]*memory:[\s\S]*limits:[\s\S]*cpu:[\s\S]*memory:/);
  assert.match(deployment, /progressDeadlineSeconds:/);
});

test("runtime secrets are referenced, never embedded in the manifest", () => {
  for (const key of ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
    assert.match(deployment, new RegExp(`name: ${key}[\\s\\S]*secretKeyRef:[\\s\\S]*name: gtm-agent-api-secrets[\\s\\S]*key: ${key}`));
  }
  assert.doesNotMatch(deployment, /sk-[A-Za-z0-9_-]+/);
  assert.doesNotMatch(deployment, /value:\s*(?:https?:\/\/|eyJ|sb_secret)/);
});

test("the container runs as an unprivileged production process", () => {
  assert.match(dockerfile, /FROM node:22[^\n]* AS runtime/);
  assert.match(dockerfile, /ENV NODE_ENV=production/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /EXPOSE 3000/);
  assert.match(dockerfile, /CMD \["npm", "start", "-w", "@gtm\/api"\]/);
});
