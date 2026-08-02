# Bluerose deployment verification — 2026-08-03

This is the redacted evidence ledger for the deployed GTM API after the real
provider iOS journey. No secret values or application payloads are retained.

## Kubernetes

- Context: `kubernetes-admin@kubernetes`
- Node `ubuntu`: `Ready`
- Namespace/deployment: `gtm-agent/gtm-agent-api`
- Image: `ghcr.io/cutedandelion/gtm-agent-api@sha256:5b325d3b5ed935e231e6a250e9dd55d8e04877c662c2756895c32460df2b0cd5`
- Replicas: `1/1 ready`
- Pod restarts: `0`
- Service endpoint: `172.16.243.245:3000`
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
- Applied migrations: 9
- Latest migrations: conversation workflow queue, interactive-object
  publication, and authenticated trusted-write restriction
- Security advisor findings: 0
- Performance advisor findings: two informational unused-index notices

## Cleanup

The exact temporary remote manifests
`/tmp/gtm-agent-deployment-09810c97.yaml`,
`/tmp/gtm-agent-deployment-5b325d3b.yaml`, and
`/tmp/gtm-agent-deployment-5ed7632f.yaml` were removed. A follow-up lookup found
no remaining `/tmp/gtm-agent-deployment-*.yaml` files.
