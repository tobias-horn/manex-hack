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
- `pipeline` in the query string via the existing clustering-mode helper

The loader can resolve the case by `caseId` alone, so `article` is no longer
required in the URL.

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

The drawer was then simplified again into a single timeline view:

- evidence spine and full timeline were collapsed into one chronological stream
- related products, image panels, and provenance note blocks were removed from
  the main drawer to keep the scan path focused
- each event now keeps only timestamp, product/context metadata, title, and the
  short proof text

## Navigation changes

- `src/app/articles/page.tsx`
  Global Intelligence now lists ranked cases directly and routes them to the
  case viewer instead of article pages.
  The ranked-case actions were later switched from `Button render={<Link />}`
  to direct styled `Link` elements after the classic live pipeline showed
  flaky click/navigation behavior while the polling runner was active.
- `src/app/products/[productId]/page.tsx`
  Product-level candidate links now open the dedicated case viewer when a
  specific clustered case is available.

## Existing article viewer

The article viewer route still exists, but it is no longer the primary entry
point from Global Intelligence for reviewing surfaced cases.

## Engine switcher placement

The engine switcher now belongs only to the Global Intelligence screen:

- `src/app/articles/page.tsx`

Detail views still show the active pipeline as context, but they no longer
offer a local engine switch. That keeps engine selection in one place and
prevents case, article, and product viewers from carrying a second copy of the
same global control.

## Visual refinement pass

The case viewer then got a targeted density and action-hierarchy cleanup:

- the duplicate hypothesis metadata badges inside the working explanation were
  reduced so the section no longer repeats case type, priority, and product ids
- the top case summary was compacted into a tighter three-stat strip plus two
  supporting detail cards, which keeps the first screen shorter on laptop
  layouts
- the former `Why not?` callout was restyled into a proper warning tile instead
  of a loose row of chips
- ranking controls (`Leading`, `Plausible`, `Weak`) were visually demoted into a
  lighter secondary action group, while approve/reject became the clear primary
  decision controls with green and red treatment

The first warning-tile attempt still read too airy and disconnected in the live
UI, so the section was tightened again:

- `Why not?` became a compact warning callout with one icon, one short heading,
  and direct text instead of helper copy plus a second nested card
- ranking and decision actions were pulled into one shared control tray so the
  footer reads as a single operator control surface rather than two floating
  islands with empty space between them

The nearby-cases panel was later removed from the dedicated case viewer. The
screen now stays single-threaded around one selected case, with alternatives
left to the higher-level article or global surfaces instead of competing for
space inside the detail view.

The top case-summary block was then redesigned again because the previous
version still looked like a flat row of generic cards:

- the title, summary, and thesis were merged into one composed hero panel so
  the viewer opens with a narrative read instead of disconnected fragments
- case type, priority, and affected products moved into a compact metric rail
  with stronger contrast and clearer hierarchy
- strongest-signal and scope details were kept, but restyled as quieter support
  cards below the hero instead of competing with it

After the dedicated case page gained its own outer “Case intelligence” header,
the lower case-viewer hero was simplified again to avoid repeated identity
information:

- the lower hero no longer repeats article badges or the exact case title
- it now focuses on the working read only: status, confidence, mechanism
  statement, and the short explanatory summary
- supporting cards were also trimmed so “scope” refers to “this article”
  instead of repeating the article id again

The outer page header was later simplified too:

- article id, article name, and pipeline-name chips were removed from the top
  header so the page opens with the case title and navigation only

Confirmed-case mode was then simplified further so the page does not stack two
hero surfaces on top of each other:

- once a case is `confirmed`, the standalone outer case-page hero is hidden
- the confirmed-case workspace becomes the single merged top hero and keeps the
  grid-backed treatment plus the navigation actions

The non-confirmed case viewer was then aligned to the same rule:

- the standalone outer case-page hero was removed for normal hypothesis review
  too
- the case viewer now owns the single top hero, including the grid shell,
  title, helper copy, and navigation actions

That merged hypothesis hero was then simplified again:

- the leading-status chip, confidence chip, and `Working read` label were
  removed from the very top of the hero so the thesis starts immediately
