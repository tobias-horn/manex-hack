# Case Viewer

Date: 2026-04-19

This note captures the switch from article-first investigation navigation to a
case-first viewer for the clustered quality pipelines.

## Why this changed

The Global Intelligence screen already surfaces ranked cases, but the UI still
forced operators to open an article-wide viewer first and then pick a case
inside it.

That added one extra navigation step and made the first investigation screen
feel broader than necessary.

The new flow is:

1. Open Global Intelligence
2. Pick one ranked case
3. Land directly in a dedicated case viewer
4. Switch to nearby cases only if needed

## New route

- `src/app/cases/[caseId]/page.tsx`

The route expects:

- `caseId` in the pathname
- `article` in the query string
- `pipeline` in the query string via the existing clustering-mode helper

## Shared loader

- `src/lib/manex-case-viewer.ts`

This file centralizes:

- loading the correct article caseboard for a pipeline mode
- building a flattened case inventory for the global dashboard
- loading one case viewer payload with review state included

## Viewer shape

- `src/components/case-viewer.tsx`

The case viewer is intentionally narrower in scope than the article viewer:

- one focused case shell
- one working-explanation card
- one evidence drawer
- one compact list of nearby cases from the same article

The goal is to keep the operator on one argument at a time without hiding the
closest alternatives.

The evidence drawer header was later trimmed further so it keeps only the badge
and title, without extra explainer copy above the evidence content.

## Navigation changes

- `src/app/articles/page.tsx`
  Global Intelligence now lists ranked cases directly and routes them to the
  case viewer instead of article pages.
- `src/app/products/[productId]/page.tsx`
  Product-level candidate links now open the dedicated case viewer when a
  specific clustered case is available.

## Existing article viewer

The article viewer route still exists, but it is no longer the primary entry
point from Global Intelligence for reviewing surfaced cases.
