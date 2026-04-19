# Front Page Ranked Cases

## Decision

The landing route still resolves to `/articles`, but the page should now lead
with article-wide ranked cases instead of the global pattern layer.

## Why

- Team feedback was that the current front page felt like a global-only view.
- The first action most operators want is to open a concrete article case.
- Cross-article watchlists, noise, and anomalies still matter, but they work
  better as supporting context after a case has been selected.

## Implementation notes

- `src/app/articles/page.tsx` now renders the ranked case inventory before the
  global pattern cards.
- The existing case inventory read model is reused without changing any
  clustering or persistence logic.
- Global patterns remain on the same screen under the primary case inventory.
- The ranked case tile now follows a single scan path:
  article and case kind first, then severity/confidence, then title and
  summary, then compact scope facts, then supporting evidence, and finally the
  case-viewer CTA.
- The former right-hand "investigation entry" sub-card was collapsed into a
  footer row so the primary case content reads as one card instead of two
  competing panels.
- The landing list was later simplified again so it only carries overview-grade
  information:
  article identity, severity, confidence, the short case story, a compact fact
  row, and the open action.
- Supporting evidence chips and article-scope counts were removed from the list
  view because they made the inventory feel dense without helping operators pick
  the next case faster.
- Card borders and internal bands were then strengthened so each ranked case
  reads as a clearly separated panel instead of blending into the section as one
  long surface.
