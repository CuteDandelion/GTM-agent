# MVP completion audit

Audit time: 2026-08-03 (Europe/Berlin)

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
| 2 | Primary journeys pass on Xcode Simulator | Xcode 26.6 and the iOS 26.5 iPhone 17 Pro Simulator passed `testProviderBackedConversationPersistsAcrossRelaunch` with one test and zero failures against the deployed Bluerose/Supabase/OpenAI path. `docs/qa/native-ios/bluerose-real-provider-e2e-final-proof-2026-08-03.mp4` retains the real conversation, role progress, evidence interaction, and restored objects after relaunch. | Partial | The focused user-approved MVP journey is proven; the broader deterministic auth, onboarding, action-failure, and resilience matrix remains post-MVP release work. |
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
| 13 | Cross-user API, RLS, and Storage isolation | Exact-commit integration tests cover ownership, Storage isolation, and authenticated trusted-write denial. The three reviewed queue, interactive-object publication, and trusted-write migrations are now applied to the dedicated hosted project, and its security advisors report no findings. | Partial | Run the complete synthetic two-user API plus Storage denial journey against the final release database after the next schema change or release-candidate cut. |
| 14 | All quality gates pass from a clean checkout | `docs/qa/local-release-verification-2026-08-02.md` qualifies immutable commit `09d2eee`: clean `npm ci`, 230 repository tests, 11 local-Supabase integration tests, 3 database contracts, 8 Playwright interaction tests, all nine migrations, both advisors, typecheck, lint, build, runtime-integrity, OpenAPI compatibility, and diff checks passed. Full native mobile E2E and remaining resilience journeys are not covered by this result. | Partial | Complete the missing Android/iOS native E2E journeys against the immutable candidate. |
| 15 | Deployed Bluerose/Supabase smoke and recovery | The dedicated `gtm-agent` namespace is deployed on immutable digest `sha256:10b8d210742107a7a9b9ae5d6190624a8da2e296cb9b0aafb9be6b2e99d47804` built from commit `06c6909`. Its pod is ready with zero restarts, the ClusterIP has a live endpoint, and the public HTTPS `/health` and `/ready` paths returned 200 three times. The same retained health check confirms Portfolio and Cloudflare tunnel readiness in `docs/qa/bluerose-deployment-verification-2026-08-03.md`. | Partial | Retain a deliberate pod-restart/workflow-resume recovery run for the later release-candidate gate. |
| 16 | Bounded live OpenAI model/tool/citation/usage proof | Provider-backed role/tool traces and native recordings exist; the accepted portfolio run used real web/crawl/evidence tools. A fresh two-request production-path acceptance at `docs/qa/openai-provider-acceptance-2026-08-02.md` retained multi-turn context, returned two genuine provider response IDs, dynamically avoided an unnecessary tool on turn one, and selected hosted `web_search` for `foodbegood.app` on turn two. File search and the complete usage/citation collation remain unproven. | Partial | Collate model IDs, response IDs, usage records, file-search proof, and citations into one release artifact. |
| 17 | No privileged credentials in Android/iOS builds | `docs/qa/mobile-binary-secret-scan.json` retains a redacted exact-secret and signature scan over 1,206 APK files, 92 iOS app-bundle files, and the 291-file repository snapshot. It found zero OpenAI or Supabase privileged-secret matches; scanner behavior is covered by three focused tests. | Proven | Re-run against the immutable release artifacts if build inputs change. |
| 18 | No autonomous outreach or external writes | Product policy requires approval and current tools are research/read/persistence tools; no outreach connector is implemented. | Proven | Keep this invariant in the final security report. |
| 19 | No unresolved severity-one or severity-two defect | `design-qa.md` passes with no unresolved visual P1/P2. The additive security remediation report locally closes the seven original high/medium findings, the trusted-write migration is now applied remotely, and the hosted Supabase security advisor reports zero findings. Original low findings, the deferred vector-store candidate, and broader release qualification remain open. | Partial | Run the final release-candidate security scan and produce the consolidated release evidence report after the deferred native and recovery gates. |
| 20 | Android/iOS match all three canonical states | The source remains hash-locked. `docs/qa/native-cross-platform-comparison.png` places locked-reference, Android-native, and iOS-native progress, assessment, and evidence panels at the same 403 x 900 dimensions. `design-qa.md` records no unresolved P1/P2 and ends with the required passing result. | Proven | Preserve the source captures and hashes in the release report. |
| 21 | Five real samples, 40+ claims, accuracy/tool traces | `packages/evals/results/latest-generated-claim.json` contains five real-company samples, 65 claims, 61 correct, four unverifiable, zero incorrect, 25 tool traces, and score 93.85. Its raw `accepted` field is `false` against the standing 97 target; the plan records the operator's explicit credit-limited MVP exception. | Proven by exception | Preserve both the raw non-passing result and the dated operator exception; do not rewrite the artifact as accepted. |

## Fresh infrastructure audit

- Supabase project `gtm-agent` (`uqfkxtgdhmwcrrnbpayn`) is active in
  `eu-central-1`.
- Ten remote migrations are applied, including conversation workflow queue,
  interactive-object publication, authenticated trusted-write restriction, and
  the production-tested `preserve_opportunity_decisions` migration.
- All 25 application tables have RLS enabled. The exact synthetic native-E2E
  user was deleted and its absence verified after the provider proof; the
  redacted result is retained in
  `docs/qa/native-ios/synthetic-user-cleanup-2026-08-03.json`.
- Supabase security advisors report no findings. Performance advisors report
  only informational unused-index notices, expected for an empty MVP database.
- Bluerose is healthy, with no warning events and protected workloads untouched.
  The isolated GTM Agent workload is deployed and ready behind the Cloudflare
  HTTPS hostname; the redacted check is retained in
  `docs/qa/bluerose-deployment-verification-2026-08-03.md`.

## Immediate release blockers

1. Physical Android installation/smoke evidence.
2. Full Android Emulator and iOS Simulator deterministic E2E journeys.
3. End-to-end mixed-success five-domain comparison proof (the deterministic domain boundary is now covered).
4. Complete remaining native mobile E2E and resilience journeys against the immutable candidate.
5. Release evidence report and closure of the remaining release conditions.
6. Deliberate deployed pod-restart/workflow-resume recovery evidence.

The operator explicitly deferred these broader release-qualification items after
the focused real-provider iOS MVP demonstration. They remain open and prevent a
claim that every criterion in the original release checklist is complete, but
they do not invalidate the retained user-approved MVP journey.
