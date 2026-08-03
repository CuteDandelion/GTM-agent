# Design QA

## Evidence

- Locked visual source: `docs/images/conversational-gtm-prototype.png`
- Locked source SHA-256: `e371e8570784a5babdc85e55fa4c75c848c350b8c78c35a49de7b1a835ea5a29`
- Normalized comparison: `docs/qa/native-cross-platform-comparison.png`
- Comparison SHA-256: `621ac191e3aef143665bab068c7272f3680ebd3be4ae01c4f8856e29ab881a13`
- Comparison layout: locked reference, Android native, and iOS native; progress,
  assessment, and evidence states; every panel normalized to 403 x 900 pixels.
- Native source captures:
  - Android: `docs/qa/native-android/gtm-progress.png`,
    `gtm-assessment.png`, and `gtm-evidence.png` (1080 x 2400).
  - iOS: `docs/qa/native-ios/gtm-progress-ios.png`,
    `gtm-assessment-ios.png`, and `gtm-evidence-ios.png` (1206 x 2622).

The locked source and all six native captures were placed in one comparison and
inspected together. Device bezels, platform status bars, the Dynamic Island,
and home indicators are platform-owned and excluded from app-content findings.

## Findings

No unresolved P1 or P2 visual defects remain in the three canonical states.

- Progress preserves the user prompt, one agent acknowledgement/avatar, live
  status, four Sol/Luna/Terra phases, and a moving phase-level ellipsis without
  a redundant staged waiting bubble.
- Assessment preserves the company profile, ICP fit, pros and cons, opportunity
  hierarchy, value/effort/fit labels, and the three canonical actions.
- Evidence preserves the modal sheet hierarchy, source links, fact/inference
  classifications, confidence indicators, close affordance, and persistent
  composer.
- Header, composer, navy/blue/green semantic colors, borders, radii, typography
  hierarchy, iconography, and major spacing relationships match the locked
  reference within normal Android/iOS font-rasterization differences.
- The implementation uses platform icon libraries and supplied app assets; no
  visible placeholder, emoji substitute, CSS drawing, or handcrafted asset was
  found.

## Primary interactions checked

- Evidence opens and closes.
- Composer remains present in all three canonical states.
- Debug panel opens and closes in development builds and is intentionally
  absent from the canonical fixture captures.
- Mobile tests cover empty/new conversation, multi-turn follow-up, animated
  waiting, FIFO queue position, live interactive objects, actions, export, and
  document attachment.
- The deterministic visual fixture is development-only and does not replace the
  provider-backed conversation runtime or its retained native recordings.

## Superseded evidence

The older `docs/qa/all-states-comparison.png` used Expo captures with an
unretained scale factor. It remains historical evidence only. The normalized
native cross-platform comparison above is authoritative for this pass.

final result: passed
