import assert from "node:assert/strict";
import test from "node:test";

async function loadScanner() {
  try {
    return await import("../../scripts/mobile-binary-secret-scan-lib.mjs");
  } catch (error) {
    assert.fail(`mobile binary secret scanner implementation must exist: ${error instanceof Error ? error.code ?? error.message : String(error)}`);
  }
}

test("reports OpenAI and Supabase secret signatures without returning secret text", async () => {
  const { scanBufferForSecrets } = await loadScanner();
  const openAiSecret = `sk-${"A".repeat(48)}`;
  const supabaseSecret = `sb_secret_${"b".repeat(40)}`;

  const findings = scanBufferForSecrets(
    Buffer.from(`prefix ${openAiSecret} middle ${supabaseSecret} suffix`),
    [],
  );

  assert.deepEqual(findings.map(({ ruleId }) => ruleId), [
    "openai-api-key",
    "supabase-secret-key",
  ]);
  assert.equal(JSON.stringify(findings).includes(openAiSecret), false);
  assert.equal(JSON.stringify(findings).includes(supabaseSecret), false);
});

test("detects configured server secrets exactly but ignores publishable values", async () => {
  const { scanBufferForSecrets } = await loadScanner();
  const findings = scanBufferForSecrets(
    Buffer.from("binary exact-server-value public-client-value"),
    [
      { name: "OPENAI_API_KEY", value: "exact-server-value", privileged: true },
      { name: "SUPABASE_PUBLISHABLE_KEY", value: "public-client-value", privileged: false },
    ],
  );

  assert.deepEqual(findings, [{ ruleId: "configured-secret", key: "OPENAI_API_KEY", offset: 7 }]);
});

test("does not flag short placeholders or ordinary mobile configuration", async () => {
  const { scanBufferForSecrets } = await loadScanner();
  const findings = scanBufferForSecrets(
    Buffer.from("EXPO_PUBLIC_API_BASE_URL SUPABASE_URL sk-example sb_secret_example"),
    [{ name: "OPENAI_API_KEY", value: "short", privileged: true }],
  );

  assert.deepEqual(findings, []);
});
