# Text-Only UI Copy Pass

Date: 2026-04-19

## What changed

- Reverted the structural UI edits from the earlier simplification pass.
- Kept the existing layouts, cards, badges, and interaction patterns intact.
- Limited the follow-up pass to copy changes only.

## Intent

- Reduce some of the more verbose helper text without changing the visual structure.
- Preserve the team's in-progress UI work and avoid layout churn.

## Files touched

- `src/app/articles/page.tsx`
- `src/app/articles/[articleId]/page.tsx`
- `src/components/article-hypothesis-board.tsx`
- `src/components/case-viewer.tsx`
- `src/components/clustering-pipeline-toggle.tsx`
- `src/components/global-pipeline-runner.tsx`
- `src/components/economic-blast-radius-section.tsx`
- `src/components/confirmed-case-report-loading-state.tsx`
- `src/components/screen-state.tsx`
- `src/app/loading.tsx`
- `src/app/error.tsx`

## Notes for later

- If the UI still feels noisy, prefer another copy pass first.
- Only change layout/components if there is explicit agreement to do a visual redesign.
