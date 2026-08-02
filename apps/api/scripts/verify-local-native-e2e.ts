import assert from "node:assert/strict";

import { createClient } from "@supabase/supabase-js";

const apiBaseUrl = process.env.GTM_API_BASE_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !publishableKey) throw new Error("Local E2E verification requires Supabase client configuration");

const client = createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const signedIn = await client.auth.signInWithPassword({
  email: "gtm-native-e2e@example.test",
  password: "Local-GTM-E2E-2026!",
});
assert.equal(signedIn.error, null);
const accessToken = signedIn.data.session?.access_token;
assert.ok(accessToken);
const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };

const created = await fetch(`${apiBaseUrl}/api/v1/conversations`, {
  method: "POST",
  headers,
  body: JSON.stringify({ title: "Local FIFO verification" }),
});
assert.equal(created.status, 201);
const conversation = await created.json() as { id: string };

const send = (message: string, domains: string[]) => fetch(`${apiBaseUrl}/api/v1/conversations/${conversation.id}/messages`, {
  method: "POST",
  headers,
  body: JSON.stringify({ message, domains, documentIds: [] }),
});
const firstResponse = await send("Analyze foodbegood.app", ["foodbegood.app"]);
assert.equal(firstResponse.status, 202);
const first = await firstResponse.json() as { runId: string; queuePosition: number };
const secondResponse = await send("Which workflow should I discuss first?", []);
assert.equal(secondResponse.status, 202);
const second = await secondResponse.json() as { runId: string; queuePosition: number };
assert.equal(first.queuePosition, 1);
assert.equal(second.queuePosition, 2);

const waitForRun = async (runId: string) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${apiBaseUrl}/api/v1/runs/${runId}`, { headers });
    assert.equal(response.status, 200);
    const run = await response.json() as { status: string; updatedAt: string };
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${runId}`);
};

const firstTerminal = await waitForRun(first.runId);
const secondTerminal = await waitForRun(second.runId);
assert.equal(firstTerminal.status, "completed");
assert.equal(secondTerminal.status, "completed");
assert.ok(new Date(secondTerminal.updatedAt).getTime() >= new Date(firstTerminal.updatedAt).getTime());

const objectsResponse = await fetch(`${apiBaseUrl}/api/v1/conversations/${conversation.id}/interactive-objects`, { headers });
assert.equal(objectsResponse.status, 200);
const objects = await objectsResponse.json() as Array<{ type: string; live?: boolean }>;
assert.deepEqual(new Set(objects.map((object) => object.type)), new Set([
  "workflow_progress",
  "company_profile",
  "icp_score",
  "opportunity",
  "evidence_collection",
]));
assert.equal(objects.find((object) => object.type === "workflow_progress")?.live, false);

const messagesResponse = await fetch(`${apiBaseUrl}/api/v1/conversations/${conversation.id}/messages`, { headers });
assert.equal(messagesResponse.status, 200);
const messages = await messagesResponse.json() as Array<{ role: string; content: { queuePosition?: number } }>;
assert.equal(messages.length, 4);
assert.equal(messages[3]?.content.queuePosition, 2);

console.log(JSON.stringify({
  status: "passed",
  conversationId: conversation.id,
  firstRun: { id: first.runId, queuePosition: first.queuePosition, status: firstTerminal.status },
  secondRun: { id: second.runId, queuePosition: second.queuePosition, status: secondTerminal.status },
  interactiveObjectTypes: objects.map((object) => object.type).sort(),
  messageCount: messages.length,
}));
