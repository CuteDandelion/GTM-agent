# Native iOS visual verification

Captured on 2026-08-02 from the installed development build on the iPhone 17
Pro iOS 26.5 simulator. These fixtures verify native rendering only; the same
folder separately retains provider-backed conversation recordings.

| State | Artifact | SHA-256 |
| --- | --- | --- |
| Research progress | `gtm-progress-ios.png` | `03b85eee5e110a87416797c3a544f7d7a38a048e389fda04288b2d9296403046` |
| Company assessment | `gtm-assessment-ios.png` | `fec267747c9a3f2f1124d7d73e190bb0e781b788a7a788177a68b088ddabf42a` |
| Evidence sheet | `gtm-evidence-ios.png` | `4b65858f0e2d8a473a7a2d60a120fa6c8e590ff69c3310056c6b3c14f09c785e` |

The seeded Acme states require the explicit non-production
`EXPO_PUBLIC_VISUAL_QA_STATE` switch. Production ignores that switch. The
authoritative normalized comparison is
`docs/qa/native-cross-platform-comparison.png`.

## Real-provider conversation proof

The provider-backed journey was rerun on 2026-08-03 against the deployed
Bluerose HTTPS API and hosted Supabase project. Xcode reported one passing test
and zero failures for
`testProviderBackedConversationPersistsAcrossRelaunch` on the iPhone 17 Pro
iOS 26.5 simulator.

The recording preserves the real `foodbegood.app` conversation and shows:

- two distinct user turns from the durable conversation;
- completed Sol planning, Luna research, Terra analysis, and Sol review phases;
- provider-authored company, ICP, evidence, and opportunity objects;
- the evidence sheet with inspectable external source URLs;
- termination, relaunch, and restoration of the conversation and objects.

| Artifact | Duration | SHA-256 |
| --- | ---: | --- |
| `bluerose-real-provider-e2e-final-proof-2026-08-03.mp4` | 195.908 seconds | `bb471ba34101dbadca3fa5d1dcb137327eabb403d3a4891561e09eaf5b83c49b` |

The redacted machine-readable Xcode result is retained in
`provider-xcresult-summary-2026-08-03.json`. The post-run hosted-user and local
credential cleanup result is retained in
`synthetic-user-cleanup-2026-08-03.json`.

Provider XCUITest runs now require a fresh empty conversation by default.
Cost-free inspection of an already completed provider conversation is available
only through the explicit `NATIVE_E2E_REPLAY_EXISTING=1` test setting, which
cannot satisfy the fresh empty-state, waiting-animation, or FIFO assertions.
The updated test target was compile-verified with the CocoaPods Xcode workspace
after this guard was added; no additional provider request was made.

The synthetic Supabase account, local credential file, embedded Xcode scheme
credentials, failed recordings, and temporary Bluerose deployment manifests
were removed after the proof completed.
