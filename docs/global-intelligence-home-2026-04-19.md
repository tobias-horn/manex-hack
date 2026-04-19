# Global Intelligence Home

Date: 2026-04-19

This note captures the UI pass that turns Global Intelligence into the app's
default landing experience.

## Route model

- `/` now redirects to `/articles` with the current clustering-mode query.
- The previous symptom inbox moved to `/inbox`.

This keeps the ranked-case workspace as the main entry point while preserving
the inbox as a secondary intake surface.

## Main UI changes

- The investigation engine switcher is now collapsible instead of always taking
  a full row of space.
- The hero now carries the most important headline counts directly in a compact
  metric strip.
- The hero header uses slightly larger padding and vertical gaps so the title,
  description, and metric strip do not feel visually compressed.
- Ranked case cards were redesigned to read like investigation entry tiles
  rather than generic stacked metadata boxes.

## Tile direction

The case inventory cards now emphasize:

- article and case identity first
- the one-line story second
- a tight stat block for products, signals, and article-local case count
- a dedicated right rail for article context and the open action

The goal is to make scanning easier without hiding the supporting evidence
signals that help operators choose where to click next.

## Navigation copy

Because Global Intelligence is now the default home, shared route actions were
retitled from "Back to inbox" to "Back to home" where they return to `/`.

The inbox route still exists, and the Global Intelligence header now links to
it explicitly as `Open inbox`.
