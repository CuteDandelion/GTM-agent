# Bluerose deployment verification — 2026-08-03

This is the redacted evidence ledger for the deployed GTM API after the real
provider iOS and Android journeys. No secret values or application payloads are
retained.

## Kubernetes

- Context: `kubernetes-admin@kubernetes`
- Node `ubuntu`: `Ready`
- Namespace/deployment: `gtm-agent/gtm-agent-api`
- Source commit: `06c69095ae7a57aa113b6a843d13a6bd8ecaa280`
- Image: `ghcr.io/cutedandelion/gtm-agent-api@sha256:10b8d210742107a7a9b9ae5d6190624a8da2e296cb9b0aafb9be6b2e99d47804`
- Replicas: `1/1 ready`
- Pod restarts: `0`
- Service endpoint: `172.16.243.241:3000`
- Cluster warning events: none

## Public HTTPS

Three consecutive external checks returned:

| Attempt | `/health` | `/ready` |
| ---: | ---: | ---: |
| 1 | 200 | 200 |
| 2 | 200 | 200 |
| 3 | 200 | 200 |

The health payload reported `gtm-orchestrator-api`; readiness reported
`configuration: ok`.

The protected Portfolio workload remained `2/2` ready, both Cloudflare tunnel
replicas remained ready, cluster warning events were empty, and
`https://portfolio.misakirose.com` returned HTTP 200 three times during the
same post-deployment health check.

## Supabase

- Project: `gtm-agent` (`uqfkxtgdhmwcrrnbpayn`)
- Applied migrations: 10
- Latest migrations: conversation workflow queue, interactive-object
  publication, authenticated trusted-write restriction, and
  `preserve_opportunity_decisions`
- Security advisor findings: 0
- Performance advisor findings: two informational unused-index notices

## Cleanup

The exact temporary remote manifests
`/tmp/gtm-agent-deployment-09810c97.yaml`,
`/tmp/gtm-agent-deployment-5b325d3b.yaml`, and
`/tmp/gtm-agent-deployment-5ed7632f.yaml` were removed. A follow-up lookup found
no remaining `/tmp/gtm-agent-deployment-*.yaml` files.
