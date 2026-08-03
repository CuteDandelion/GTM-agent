# Native Android visual verification

Captured from the installed debug APK on the `GTM_API_36` ARM64 emulator. The 2026-08-02 artifacts verify native rendering; the 2026-08-03 artifacts additionally prove the signed-in application against the hosted HTTPS API, hosted Supabase project, and real OpenAI research workflow.

| State | Artifact | SHA-256 |
| --- | --- | --- |
| Empty new conversation | `gtm-empty-conversation.png` | `b262f470edb9b3757a9e2fc4c38dfe03c526ed5cba4e7eaa6e5e50e0a3b12473` |
| Research progress | `gtm-progress.png` | `35db3c657e840effab08ccf36d2ac173703e63f88c255dac2419ba9d8449e93b` |
| Progress animation | `gtm-progress-animation.mp4` | `a2e4a4f5d063d03a9918b4fb5dcebff03f3a0ccd8d475ee408caac7e86c55485` |
| Company assessment | `gtm-assessment.png` | `0c3bfdcc5fa842ce95aef6f54d99d991b520c43f587d5320e64e67a4bb213373` |
| Evidence sheet | `gtm-evidence.png` | `d57d2544236071dcf2e0ee37f8081698d3fbbeaa17c42a618cb05ee23ebf7856` |
| Signed-out authentication | `gtm-authentication.png` | `1dd79eb6af3fc9006cdc4f8f6377eb8e0852e2721f82b1ae3f1654784d2cd49a` |

The seeded Acme progress, assessment, and evidence screens are available only when an explicit non-production `EXPO_PUBLIC_VISUAL_QA_STATE` is set. Production ignores this variable. The authenticated application chooses the empty state when a seller profile exists but the active conversation has no messages or interactive objects. The authoritative normalized cross-platform comparison is `docs/qa/native-cross-platform-comparison.png`.

## 2026-08-03 real OpenAI conversation proof

The installed self-contained `debugOptimized` APK used `https://gtm-agent-api.misakirose.com` directly, with no `adb reverse` mapping and no local API. The retained journey exercised these seams:

1. Clear application data and authenticate the synthetic test operator.
2. Complete seller-profile onboarding and reach an empty conversation.
3. Submit `foodbegood.app` and observe a real agent acknowledgement, animated response wait, and live Sol, Luna, Terra, and Sol DAG phases.
4. Submit a follow-up while research is active and observe `Queued · position 2` without losing either message.
5. Observe the queued follow-up automatically transition to running after the first run completed.
6. Open and close the dynamically published Evidence sheet, then apply Shortlist and observe `Shortlisted` plus hosted opportunity revision 2 with `status: pursue`.
7. Force-stop and relaunch the application, reload both prompts and agent responses, and return to the persisted `Shortlisted` object.

The hosted `preserve_opportunity_decisions` migration was applied before this run. Its production behavior regression passed the sequence `publish -> shortlist -> later publish -> reload`, preserving the human decision while refreshing generated content. During this proof, a real provider-output mismatch was also found: the model completed the research and generated source-backed objects, but the projection adapter only understood an older node shape. A regression test reproduced the loss, the adapter was fixed, and the already-paid checkpoint was replayed to publish the missing objects without another OpenAI request.

| Proof | Artifact | SHA-256 |
| --- | --- | --- |
| Empty start, real response, waiting animation, live DAG, and queued follow-up | `gtm-real-openai-journey-start-and-queue.mp4` | `d34c83a3f3c9c655585543795cdc59735a68af05f75c06c273aebdefbbd1e875` |
| Queue completion and terminal DAG | `gtm-real-openai-queue-completion.mp4` | `0477effac717b629d28b00a7236f951cfbbbb5cf9425d779ccd7335f171b5419` |
| Dynamic Evidence open/close interaction | `gtm-real-openai-evidence-interaction.mp4` | `6f3bfe411a7a73ac26dfc25d40afcec80fe9a111cce269942b5988d13ca7563d` |
| Dynamic Evidence sheet | `gtm-real-openai-evidence.png` | `5960e10e51c2efe6182d1e5c7eb8846960fbced581578a98ddaf14f590571014` |
| Shortlist action before restart | `gtm-real-openai-shortlisted.png` | `71ab06f8d374f6233ab3532340ba3ab105a72d7718a79b4b6a4862c8c0cff6f2` |
| Restart, persisted prompts, and persisted Shortlisted object | `gtm-real-openai-persistence.mp4` | `eeac404ab036a84d8e6808b551e2cd7cf2cec57348bd2e9492ccfb1cbfc27a21` |
| Persisted Shortlisted screen | `gtm-real-openai-persisted-shortlisted.png` | `9251d552a089a733871c932e3210f8f96d75161bf1a9b50ab886f78260a6d2e2` |
| Persisted accessibility hierarchy | `gtm-real-openai-persisted-shortlisted.xml` | `daed03e73197f60fbb80919511b0cc48d62678e1f886533543b33a3451a3bc4a` |
| Synthetic-user cleanup verification | `synthetic-user-cleanup-2026-08-03.json` | `6894989b47851df4bffffb78ffa50929c376a81017938219b0c523f8559330a5` |

After final verification, the fixed synthetic user was deleted and its exact-match count verified as zero. Application data and named emulator recordings were removed, the emulator was stopped, the temporary proof directory was deleted, and no local API or Supabase listener remained. No Gradle daemon was visible; the stop command could not start because no Java runtime remained available. Hosted product data and infrastructure remain untouched except for deleting the marked synthetic user.
