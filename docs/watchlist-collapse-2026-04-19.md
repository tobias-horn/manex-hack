# Watchlist Collapse On Global Intelligence

Date: 2026-04-19

The `/articles` landing page now keeps the ranked case inventory fully visible
while rendering the watchlists subsection as collapsed by default.

## Why

- Watchlists can get long and push the main investigation entry points below the
  fold.
- Ranked cases are the primary workflow on the front page, so they should stay
  visible without extra interaction.

## Implementation notes

- The watchlists block uses a native `<details>` disclosure so it works without
  client-side state.
- Cross-article anomalies, leading indicators, and noise sections stay
  unchanged.
- The collapsed summary shows the watchlist title, description, and item count
  so operators can decide whether to open it.
