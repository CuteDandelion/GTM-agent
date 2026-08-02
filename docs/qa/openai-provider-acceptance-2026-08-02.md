# OpenAI provider acceptance — 2026-08-02

This is a credit-bounded acceptance check of the production conversation-agent path. It used the existing local `OPENAI_API_KEY` without printing or rewriting it. Exactly two paid provider requests were made.

## Production path exercised

- `createApplicationConversationAgent()`
- `createConversationAgent()`
- `createOpenAIAgentsRuntime()`
- OpenAI Agents SDK `run(...)`

The runtime used structured output, `store: false`, and returned `result.lastResponseId` plus observed provider tool calls.

## Turn 1 — dynamic direct answer

Input asked what information is needed before evaluating a startup for AI automation opportunities.

```json
{
  "kind": "answer",
  "responseId": "resp_0fecee6ff7975e53016a6f9bc176b081958a07b90551f25a86",
  "responseIdLooksProviderIssued": true,
  "usedTools": [],
  "messageLength": 107,
  "messageSha256": "3ee7b6166463f0ee37aac1daf901970bb6a3264e62fb8ff82e2ed80ecc50cfd8",
  "objectCount": 0
}
```

Result: schema-valid direct-answer behavior with no unnecessary tool call.

## Turn 2 — conversation history plus hosted web research

The same conversation ID was supplied with prior history establishing the preferred target as `bootstrapped B2B SaaS teams`. The follow-up asked for a current-web check of `foodbegood.app`, required the prior target to be named, and required one evidence limitation.

```json
{
  "kind": "answer",
  "responseId": "resp_02e394af3bdae122016a6f9bda7f508196a2960da0f9bf7f7e",
  "responseIdLooksProviderIssued": true,
  "usedTools": ["web_search"],
  "usedCurrentWebTool": true,
  "retainedTarget": true,
  "mentionsDomain": true,
  "messageLength": 384,
  "messageSha256": "82a80f02c6d5368841faeae292af888f466864c63e0fb1370ee950c809f1af0d",
  "objectCount": 0
}
```

Provider output:

> Foodbegood appears only partially relevant to your target—**bootstrapped B2B SaaS teams**—because it operates a canteen food-surplus platform rather than clearly selling B2B SaaS, though its launch/waitlist posture suggests an early-stage team. Evidence limitation: its public site does not disclose funding, ownership, team size, or whether its software is a standalone SaaS product.

Result: the live model retained the supplied multi-turn preference, chose the direct-answer branch rather than starting a fixed research workflow, called the hosted web research tool, and stated an evidence boundary.

## Bounded limitations

- This check exercised the production agent constructor directly. It did not prove HTTP persistence/relaunch; that is a separate API/native E2E gate.
- Multi-turn context is currently provided to the model as complete application-managed conversation history, not by chaining OpenAI `previous_response_id` values.
- File search was not exercised because no `OPENAI_VECTOR_STORE_IDS` were configured for this local run.
- This was an acceptance smoke test, not a new accuracy evaluation or a deployment proof.
