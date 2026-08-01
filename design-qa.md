# Design QA

- Source: `docs/images/conversational-gtm-prototype.png`
- Canonical source dimensions: 1536 x 1024 px
- Implementation viewport: protected iPhone runtime at 393 x 852 CSS px (measured 392.993 x 851.994)
- Full implementation capture: `docs/qa/implementation-assessment-final-v3.png` (1111 x 732 px browser capture)
- Isolated phone capture: `docs/qa/implementation-phone-final-v2.png` (330 x 680 px)
- Full comparison: `docs/qa/assessment-comparison-final-v2.png`
- Focused assessment-card comparison: `docs/qa/assessment-comparison-focus-v2.png`
- State: completed company assessment for `acme.ai`

## Required fidelity surfaces

- iPhone frame, safe areas, Dynamic Island, header, and persistent composer
- User analysis prompt and assistant completion bubble
- Acme profile, ICP fit score, facts, pros, and cons
- Support Triage Agent opportunity card and metrics
- Evidence, Challenge, and Shortlist actions
- Navy, blue, green, grey, typography, spacing, borders, and radii

## Iteration history

1. Removed the hidden keyboard dock from layout so the evidence drawer renders without reserved keyboard height.
2. Replaced approximate symbols with the closest Lucide and Expo Symbols icons for the assistant, product mark, and opportunity card.
3. Moved the app header below the status region and verified the measured status bottom is above the header top.
4. Wrapped the company summary to match the source, tightened card density, and preserved the visible completion timestamp above the composer.

## Interaction and runtime checks

- Automatic research progress advances into the completed assessment state.
- Evidence opens and closes the evidence collection sheet.
- Shortlist changes state and remains visibly selected.
- The conversational composer remains available throughout the primary flow.
- Browser console inspection showed no errors or warnings in the verified run.
- Prototype runtime integrity check passes for all 28 protected files.

## Result

passed
