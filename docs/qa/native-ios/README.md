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
