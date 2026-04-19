# Header Grid Background

Date: 2026-04-19

The `spec-grid` blueprint background is now the default visual treatment for the
main page headers across the app.

## Intent

Use one consistent header surface instead of mixing plain glass headers and
grid-backed headers. The grid gives the top of the page more structure without
adding extra UI chrome.

## Applied to

- `src/app/page.tsx`
- `src/app/articles/page.tsx`
- `src/app/articles/[articleId]/page.tsx`
- `src/app/cases/[caseId]/page.tsx`

Other pages already used `spec-grid` in their header surface and were left as
they were.
