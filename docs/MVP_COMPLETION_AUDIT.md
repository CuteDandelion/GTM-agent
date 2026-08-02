# MVP completion audit

Audit time: 2026-08-02 (Europe/Berlin)

This file is the evidence ledger for the acceptance criteria in
`docs/MVP_IMPLEMENTATION_PLAN.md`. `Proven` means the named artifact or fresh
inspection demonstrates the criterion. `Partial` means useful evidence exists
but does not cover the full release condition. `Missing` means no qualifying
evidence exists yet. A fixture-only or visual-QA run never substitutes for a
provider-backed or deployed journey.

## Acceptance criteria

| # | Criterion | Current evidence | Status | Required next proof |
|---:|---|---|---|---|
| 1 | APK installs on physical Android | Debug APK exists at `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`; emulator captures and hashes are in `docs/qa/native-android/README.md`. No physical Android device is connected. | Missing: hardware | Install the APK on a physical Android device and retain install/launch/smoke evidence. |
| 2 | Primary journeys pass on Xcode Simulator | Xcode 26.6 and iOS 26.5 simulator runtime are installed. `docs/qa/native-ios/provider-backed-react-loop.mp4` and `provider-backed-persisted-followup.mp4` show the real signed-in provider path and persisted follow-up. Native stills now retain progress, assessment, and evidence states. | Partial | Run and retain the remaining deterministic auth, onboarding, queue, action, and failure journeys on iOS Simulator. |
| 3 | Authentication and conversational seller onboarding | Auth, seller-profile API/client, onboarding UI, and tests exist. Native recordings prove authentication into the conversation, but not the complete onboarding questionnaire as one retained journey. | Partial | Retain an end-to-end registration/sign-in/onboarding recording with persisted profile verification. |
| 4 | Public domain analysis without intervention | The provider-backed Foodbegood run completed a real 20-node DAG and projected persisted profile, ICP, opportunity, progress, and evidence objects. | Proven | Preserve this lane in the release report and rerun only if the protocol changes. |
| 5 | Visible Sol/Luna/Terra routing | The progress object and native/UI evidence expose Plan/Sol, Research/Luna, Analyze/Terra, and Review/Sol. Model-routing tests cover role selection. | Proven | Include final test output and the provider trace in the release report. |
| 6 | Required web, crawl, document, and evidence tools follow policy | Tool policy and mandatory-use tests exist. The accepted eval has 25 tool traces including `web_search`, `crawl_company`, `save_evidence`, `get_claim_sources`, and `code_interpreter`. The retained live run does not independently prove an attached-document/file-search invocation. | Partial | Run a bounded controlled-document lane proving document/file retrieval and citation without spending another full portfolio eval. |
| 7 | Material claims have sources and observation dates | Contracts, evidence objects, eval decisions, and retained source URLs support inspectable citations. | Proven | Confirm the exported dossier preserves observation dates. |
| 8 | Facts, inferences, and hypotheses are distinct | Shared schemas and evidence UI render classifications; contract tests cover object validation. | Proven | Retain final contract-test output. |
| 9 | Skeptic flags unsupported recommendations | The DAG contains critical-review policy and the accepted eval records four unverifiable claims rather than treating them as correct. | Partial | Retain a deterministic API/E2E case where the skeptic visibly annotates or rejects an unsupported recommendation. |
| 10 | Interactive objects update in place and survive restarts | Durable object migrations, stale-version validation, reducer/API/integration tests, and persisted native follow-up evidence exist. | Proven | Include fresh clean-checkout test output. |
| 11 | Interrupted workflow resumes without duplicate work | Durable checkpoints, resume API, scheduler tests, two-worker claiming tests, and retained provider recovery artifacts exist. | Proven | Add deployed pod-restart recovery proof before release. |
| 12 | Five-domain batch tolerates one failed target | The deterministic domain boundary now proves a five-target crawl retains and persists four successes, returns the failed domain to downstream nodes, and stores a source-visible `domain_failure` fact; an all-failed batch fails closed. The complete mobile/API/DAG journey is not yet retained. | Partial | Run the explicit five-domain API/mobile E2E journey and verify the final comparison ranks the four successful targets while explaining the failed target. |
| 13 | Cross-user API, RLS, and Storage isolation | Local integration tests cover ownership; remote Supabase inspection shows all 21 public tables with RLS enabled and zero security-advisor findings. | Partial | Run the complete synthetic two-user API + Storage denial journey against the release database. |
| 14 | All quality gates pass from a clean checkout | The 2026-08-02 dirty-worktree local gate is green: 230 tests passed, nine conditional local-Supabase tests were skipped after the cleaned-up stack was stopped, and typecheck, production build, and lint passed. `openapi/openapi.json` now documents all 15 release operations; its compatibility test maps every documented operation to a real Fastify route and enforces successful responses and bearer protection. The default local-Supabase command includes all four integration files, including the authenticated-write boundary regression. The worktree is intentionally dirty and no clean-checkout CI-equivalent result exists. Full mobile E2E and several resilience lanes remain incomplete. | Missing | Commit to an isolated branch/worktree, then run the documented clean-checkout gate. |
| 15 | Deployed Bluerose/Supabase smoke and recovery | Fresh read-only Bluerose inspection shows a healthy node and protected services, but no `gtm-agent` namespace/workload is deployed. Dedicated Supabase is active and migrated. | Missing | After local gates, publish a pinned image, deploy only the dedicated namespace, then run smoke and pod-restart recovery. |
| 16 | Bounded live OpenAI model/tool/citation/usage proof | Provider-backed role/tool traces and native recordings exist; the accepted portfolio run used real web/crawl/evidence tools. A fresh two-request production-path acceptance at `docs/qa/openai-provider-acceptance-2026-08-02.md` retained multi-turn context, returned two genuine provider response IDs, dynamically avoided an unnecessary tool on turn one, and selected hosted `web_search` for `foodbegood.app` on turn two. File search and the complete usage/citation collation remain unproven. | Partial | Collate model IDs, response IDs, usage records, file-search proof, and citations into one release artifact. |
| 17 | No privileged credentials in Android/iOS builds | `docs/qa/mobile-binary-secret-scan.json` retains a redacted exact-secret and signature scan over 1,206 APK files, 92 iOS app-bundle files, and the 291-file repository snapshot. It found zero OpenAI or Supabase privileged-secret matches; scanner behavior is covered by three focused tests. | Proven | Re-run against the immutable release artifacts if build inputs change. |
| 18 | No autonomous outreach or external writes | Product policy requires approval and current tools are research/read/persistence tools; no outreach connector is implemented. | Proven | Keep this invariant in the final security report. |
| 19 | No unresolved severity-one or severity-two defect | `design-qa.md` passes with no unresolved visual P1/P2. The additive security remediation report at `/private/tmp/codex-security-scans/agent-demo/3bcc15b_20260802T184752Z/artifacts/fix_report.md` locally closes all seven original high/medium findings, with no high or critical production-dependency advisory. Remote application of the write-isolation migration, original low findings, the deferred vector-store candidate, and the remaining release gates are still open. | Missing | Apply and verify the security migration remotely, then produce the final release evidence report after all native and deployed gates. |
| 20 | Android/iOS match all three canonical states | The source remains hash-locked. `docs/qa/native-cross-platform-comparison.png` places locked-reference, Android-native, and iOS-native progress, assessment, and evidence panels at the same 403 x 900 dimensions. `design-qa.md` records no unresolved P1/P2 and ends with the required passing result. | Proven | Preserve the source captures and hashes in the release report. |
| 21 | Five real samples, 40+ claims, accuracy/tool traces | `packages/evals/results/latest-generated-claim.json` contains five real-company samples, 65 claims, 61 correct, four unverifiable, zero incorrect, 25 tool traces, and score 93.85. Its raw `accepted` field is `false` against the standing 97 target; the plan records the operator's explicit credit-limited MVP exception. | Proven by exception | Preserve both the raw non-passing result and the dated operator exception; do not rewrite the artifact as accepted. |

## Fresh infrastructure audit

- Supabase project `gtm-agent` (`uqfkxtgdhmwcrrnbpayn`) is active in
  `eu-central-1`.
- Six remote migrations are applied: initial schema, backend grants, durable
  research state, foreign-key indexes, durable interactive objects, and user
  document lifecycle.
- All 21 application tables have RLS enabled and currently contain zero rows.
- Supabase security advisors report no findings. Performance advisors report
  only informational unused-index notices, expected for an empty MVP database.
- Bluerose is healthy, with no warning events and protected workloads untouched.
  No GTM Agent namespace or workload is deployed.

## Immediate release blockers

1. Physical Android installation/smoke evidence.
2. Full Android Emulator and iOS Simulator deterministic E2E journeys.
3. End-to-end mixed-success five-domain comparison proof (the deterministic domain boundary is now covered).
4. Complete clean-checkout quality gate from an immutable commit.
5. Release evidence report and closure of any reportable security findings.
6. Bluerose deployment, smoke, and pod-restart recovery after local gates pass.
