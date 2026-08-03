# Local release verification — 2026-08-02

This record qualifies immutable commit
`09d2eee60afce4fe2be44a38787eaeec223da07c` from the detached clean checkout
`/private/tmp/agent-demo-release-09d2eee`. It is local evidence only; it is not
deployment proof.

## Reproducible checkout

- `npm ci --cache /private/tmp/agent-demo-npm-cache`: passed from an empty
  `node_modules` directory.
- The first candidate exposed an out-of-sync lockfile. The lockfile was repaired
  and the clean install was rerun successfully before this commit was qualified.
- `git diff --check`: passed.

## Deterministic repository gates

- `npm test`: 230 passed, 9 conditional Supabase tests skipped because the
  default repository run does not start external services.
- `npm run typecheck`: passed for every workspace.
- `npm run lint`: passed.
- `npm run build`: passed; the protected mobile runtime integrity check covered
  28 files and the production prototype bundle completed.
- `npm run test:runtime --workspace @gtm/prototype`: 8/8 Playwright interaction
  tests passed.
- `openapi/openapi.json`: 15 public operations covered by the API compatibility
  test, including route existence, bearer protection, and successful responses.

## Fresh local Supabase lane

The project-scoped stack was started only for this lane, reset from zero, and
stopped with its volumes retained afterward.

- Supabase CLI: `2.111.0`.
- `npx supabase db reset --local --no-seed`: all nine committed migrations
  replayed successfully.
- `npm run test:supabase:local`: 4 files and 11 tests passed, including
  authenticated trusted-write denial and valid upload registration.
- `npm run test:database:contract`: 3/3 passed.
- Security advisor with `--fail-on warn`: no issues.
- Performance advisor with `--fail-on error`: no issues.

## Immutable container lane

- Tag: `gtm-agent:09d2eee`.
- Local image ID:
  `sha256:ae5bc19c61d078e3d3c49c8318bd4f2fd1ac564c332c0a91a81703c1c3b59a0c`.
- Size: 231,250,228 bytes.
- Runtime user: `node`.
- `GET /health`: HTTP 200 with service/version payload.
- `GET /ready`: HTTP 200 with configuration check `ok`.
- SIGTERM reached the API shutdown handler and the container exited with code 0.

The first container candidate used `npm start` as PID 1 and exited 1 on
SIGTERM. The release Dockerfile now starts `tsx` directly; a regression guard
and the rebuilt exact-commit smoke prove the fix.

No temporary GTM smoke containers or local Supabase containers remained after
verification.

## Dependency audit

`npm audit --omit=dev --json` reported 0 critical, 0 high, and 12 moderate
records. They resolve to the Expo/Xcode build-tool chain and the upstream
`uuid` advisory already retained in the security remediation report. A forced
major downgrade is not an acceptable release fix.

## Deliberately unproven here

- Physical Android installation.
- Complete native Android and iOS deterministic E2E coverage.
- Remote two-user Supabase and Storage isolation after applying the latest
  migration.
- Bluerose deployment, smoke, pod restart, and workflow recovery.
