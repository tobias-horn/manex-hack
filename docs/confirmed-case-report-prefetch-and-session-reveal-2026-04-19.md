# Confirmed Case Report Prefetch And Session Reveal

## Goal

Make the confirmed report feel fast after hypothesis approval without showing the report by default after a page reload.

## Behavior

- Hypothesis views now prepare confirmed reports ahead of reveal for reviewable hypotheses.
- Approving a hypothesis no longer opens the report because of persisted `confirmed` status alone.
- After an in-session approval, the UI shows a 3 second fake loading state and then opens the prefetched report.
- After a reload, the screen stays on the hypothesis view even if that hypothesis was already confirmed earlier.
- A confirmed hypothesis can still open the report explicitly via the same primary action, which now reads `Show confirmed report` once the status is already confirmed.

## Implementation Notes

- Shared client fetch helpers live in [src/lib/manex-confirmed-case-report-client.ts](/Users/tobiashorn/Documents/Projekte/manex-hack/src/lib/manex-confirmed-case-report-client.ts).
- Session-only report reveal state lives in [src/components/use-confirmed-case-report-flow.ts](/Users/tobiashorn/Documents/Projekte/manex-hack/src/components/use-confirmed-case-report-flow.ts).
- The fake loading screen is [src/components/confirmed-case-report-loading-state.tsx](/Users/tobiashorn/Documents/Projekte/manex-hack/src/components/confirmed-case-report-loading-state.tsx).
- Both [src/components/article-hypothesis-board.tsx](/Users/tobiashorn/Documents/Projekte/manex-hack/src/components/article-hypothesis-board.tsx) and [src/components/case-viewer.tsx](/Users/tobiashorn/Documents/Projekte/manex-hack/src/components/case-viewer.tsx) now use the same reveal flow.
- [src/components/confirmed-case-workspace.tsx](/Users/tobiashorn/Documents/Projekte/manex-hack/src/components/confirmed-case-workspace.tsx) can render from a prefetched report record instead of always generating on mount.
