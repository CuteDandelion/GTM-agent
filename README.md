# Conversational GTM Orchestrator

A conversation-first mobile research agent for freelancers and agencies selling AI and agent automation. The user supplies one company domain or a batch of up to five; an application-owned DAG routes planning, research, analysis, and critique through model-aware Sol, Luna, and Terra roles and returns evidence-backed, schema-driven objects inside one conversation.

The approved product scope lives in [`docs/MVP_IMPLEMENTATION_PLAN.md`](docs/MVP_IMPLEMENTATION_PLAN.md). The locked mobile reference is [`docs/images/conversational-gtm-prototype.png`](docs/images/conversational-gtm-prototype.png), with its checksum recorded in [`docs/images/REFERENCE_LOCK.md`](docs/images/REFERENCE_LOCK.md).

## Architecture

- `apps/mobile` — Expo 57 React Native client and EAS Android/iOS build profiles.
- `apps/api` — Fastify API for authentication, research runs, cancellation/resume, and interactive-object actions.
- `apps/prototype` — protected browser fidelity harness for the approved mobile design.
- `packages/orchestration` — durable, budgeted DAG scheduler and GTM workflow.
- `packages/agents` — OpenAI Agents SDK adapter with role/model/tool policies.
- `packages/tools` — controlled tool gateway and evidence validation.
- `packages/crawler` — SSRF-resistant bounded crawler.
- `packages/documents` — bounded document parsing and prompt-injection boundary.
- `packages/contracts` — shared runtime schemas and canonical fixtures.
- `supabase/migrations` — owner-scoped database, Storage, RLS, and Realtime schema.

## Local verification

Use Node.js 22:

```bash
npm ci
npm test
npm run typecheck
EXPO_NO_TELEMETRY=1 CI=1 npm run lint
npm run build
```

Copy `.env.example` to `.env.local` for local API configuration. Never put provider or Supabase secret keys in the mobile app.

Run the API with:

```bash
npm run dev -w @gtm/api
```

Run the Expo client with:

```bash
npm start -w @gtm/mobile
```

## Deployment status

The Render blueprint and EAS profiles are validated. Cloud deployment is intentionally not considered complete until a dedicated Supabase project is created, its migration and isolation tests pass, Render secrets are configured, and Android/iOS builds and E2E journeys pass against the deployed service.
