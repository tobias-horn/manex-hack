# Confirmed Case Report Workflow

Date: 2026-04-19

This note captures the next step after the article hypothesis screen:

1. An operator approves one hypothesis.
2. Competing hypotheses disappear from the screen.
3. The UI switches into a confirmed-case workspace.
4. A quality-control report is generated from the approved case.
5. The operator selects the teams to notify and queues the handoff.

## Why this exists

The hackathon brief is explicit that the target is not just clustering or root
cause ranking. The product should replace static 8D/FMEA-style documents with:

- intelligent report generation
- a strong investigation UI
- closed-loop workflow and ownership

The confirmed-case workspace is the bridge from “best hypothesis” to
“actionable quality report”.

## Screen behavior

The article hypothesis board and the dedicated case viewer now share the same
confirmed-case behavior:

- `confirmed` review status immediately collapses the visible alternatives
- the screen swaps from hypothesis comparison to a confirmed-case report view
- the left side becomes a structured quality report
- the right side becomes a team-selection and handoff panel
- the bottom of the screen still keeps the economic blast-radius section visible

Rejected hypotheses still remain reviewable in the normal comparison state. The
collapse only happens once one case is marked `confirmed`.

## Shared report shape

`src/lib/manex-confirmed-case-report-schema.ts` defines one report contract for
the whole feature:

- headline
- executive summary
- problem statement
- confirmed mechanism
- severity assessment
- scope and traceability
- evidence highlights
- containment actions
- corrective actions
- validation plan
- watchouts
- condensed timeline
- suggested notification teams

This keeps the client, server route, persistence layer, and future integrations
aligned on one durable payload.

## Report generation

`src/lib/manex-confirmed-case-report.ts` handles report creation.

Generation strategy:

1. Try OpenAI structured output when `OPENAI_API_KEY` is available.
2. Fall back to a deterministic report builder when AI is unavailable or fails.

The AI prompt lives in:

- `src/prompts/manex-confirmed-case-report.ts`

The fallback builder still produces a usable report and deterministic suggested
teams from the confirmed case evidence.

## Persistence

Confirmed reports are stored in the new app-owned table:

- `team_quality_case_report`

Managed by:

- `src/lib/manex-confirmed-case-report-state.ts`

Stored fields include:

- article / candidate / pipeline identity
- generated report payload
- runtime mode (`live_ai` or `template`)
- model name
- prompt version
- selected notification teams
- queued-notification timestamp and user

This makes the handoff state durable before real notification delivery exists.

## API

Route:

- `src/app/api/articles/[articleId]/hypotheses/[candidateId]/confirmed-report/route.ts`

Behavior:

- `POST`
  Loads or generates the confirmed-case report.
- `PATCH`
  Persists selected teams and queues the notification handoff marker.

`PATCH` does not send real notifications yet. It stores the operator decision so
delivery logic can be attached later without redesigning the UI or changing the
payload shape.

## Main UI file

- `src/components/confirmed-case-workspace.tsx`

This client component:

- requests the confirmed report
- renders the company quality-control template
- shows suggested teams with rationales
- lets the operator select teams
- queues the handoff selection
- keeps the shared economic blast-radius panel below the confirmed report

The report header was later cleaned up so the metadata block behaves more like a
document summary table:

- the top facts area now renders as a fixed 4-column matrix instead of a loose
  responsive card grid
- fact values are kept on one line, with horizontal overflow handled by the
  table container instead of wrapping inside cells
- this keeps the opening of the report denser and more legible on laptop widths

The hero area above that table was also trimmed so it does not repeat the same
identity metadata again:

- article id, article name, priority, and case-type badges were removed from
  the very top of the confirmed report screen

The confirmed report hero now also absorbs the page-level case header in
confirmed mode:

- the grid-backed “Case intelligence” shell and the confirmed report intro are
  rendered as one shared top surface instead of two stacked cards
- navigation actions live inside that merged hero so the top of the page reads
  as one composed entry point

## Related files

- `src/components/article-hypothesis-board.tsx`
- `src/components/case-viewer.tsx`
- `src/components/economic-blast-radius-section.tsx`
- `src/lib/article-hypothesis-view.ts`
- `src/lib/manex-case-viewer.ts`

These files now treat `confirmed` as a screen-level transition instead of just
another badge value.
