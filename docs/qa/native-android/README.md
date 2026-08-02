# Native Android visual verification

Captured on 2026-08-02 from the installed debug APK on the `GTM_API_36` ARM64 emulator. These artifacts verify native rendering only; they do not replace the pending signed-in, real API/Supabase/tool-path recording.

| State | Artifact | SHA-256 |
| --- | --- | --- |
| Empty new conversation | `gtm-empty-conversation.png` | `b262f470edb9b3757a9e2fc4c38dfe03c526ed5cba4e7eaa6e5e50e0a3b12473` |
| Research progress | `gtm-progress.png` | `35db3c657e840effab08ccf36d2ac173703e63f88c255dac2419ba9d8449e93b` |
| Progress animation | `gtm-progress-animation.mp4` | `a2e4a4f5d063d03a9918b4fb5dcebff03f3a0ccd8d475ee408caac7e86c55485` |
| Company assessment | `gtm-assessment.png` | `0c3bfdcc5fa842ce95aef6f54d99d991b520c43f587d5320e64e67a4bb213373` |
| Evidence sheet | `gtm-evidence.png` | `d57d2544236071dcf2e0ee37f8081698d3fbbeaa17c42a618cb05ee23ebf7856` |
| Signed-out authentication | `gtm-authentication.png` | `1dd79eb6af3fc9006cdc4f8f6377eb8e0852e2721f82b1ae3f1654784d2cd49a` |

The seeded Acme progress, assessment, and evidence screens are available only when an explicit non-production `EXPO_PUBLIC_VISUAL_QA_STATE` is set. Production ignores this variable. The authenticated application chooses the empty state when a seller profile exists but the active conversation has no messages or interactive objects. The authoritative normalized cross-platform comparison is `docs/qa/native-cross-platform-comparison.png`.
