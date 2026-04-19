## Confirmed Case Report Layout

Date: 2026-04-19

The confirmed-case workspace now presents the generated report as a flatter
written sheet instead of a decorative viewer or dashboard card stack.

### What changed

- the report spans the full content width available in the main column
- the typography is smaller and denser so the page reads like an internal report
- section headers, metadata, traceability, and timeline now use row-based layout
  instead of decorative tiles
- the distribution rail is reduced to a simple list with compact queue metadata
- prompt wording was tightened so regenerated reports stay terse and factual

### Why

The previous version was too stylized and too verbose. The report should feel
closer to a real quality document: compact, direct, and easy to scan.

### Main file

- `src/components/confirmed-case-workspace.tsx`
