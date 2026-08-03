const genericSecretRules = [
  { ruleId: "openai-api-key", pattern: /sk-[A-Za-z0-9_-]{32,}/g },
  { ruleId: "supabase-secret-key", pattern: /sb_secret_[A-Za-z0-9_-]{32,}/g },
];

export function scanBufferForSecrets(buffer, configuredSecrets) {
  const text = buffer.toString("latin1");
  const findings = [];

  for (const { ruleId, pattern } of genericSecretRules) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      findings.push({ ruleId, offset: match.index });
    }
  }

  for (const secret of configuredSecrets) {
    if (!secret.privileged || secret.value.length < 8) continue;
    let offset = text.indexOf(secret.value);
    while (offset !== -1) {
      findings.push({ ruleId: "configured-secret", key: secret.name, offset });
      offset = text.indexOf(secret.value, offset + secret.value.length);
    }
  }

  return findings.sort((left, right) => left.offset - right.offset || left.ruleId.localeCompare(right.ruleId));
}
