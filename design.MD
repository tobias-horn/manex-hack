# Design System Specification: The Forensic Lens

 

## 1. Overview & Creative North Star

This design system is built to transform complex manufacturing data into an environment of absolute certainty. We are moving away from the cluttered, "dashboard-heavy" tropes of industrial software toward a **Creative North Star** we call **"The Forensic Lens."**

 

The Forensic Lens treats every screen as a high-precision investigative workspace. It is characterized by high-contrast typographic scales, intentional asymmetry, and a rigorous commitment to tonal depth over structural lines. By utilizing balanced whitespace and shifting background values, we create an interface that feels like a physical laboratory—stable, quiet, and profoundly authoritative. We do not just show data; we present evidence.

 

## 2. Colors & Surface Logic

The palette is a sophisticated range of deep slates and cold grays, punctuated by a singular, confident blue. 

 

*   **Primary (#005C97):** Reserved for moments of absolute intent. Use this for primary actions and to anchor the eye in high-density data environments.

*   **Neutral Foundation:** We utilize `surface` (#F8F9FA) as our base canvas. It is clean, bright, and clinical.

*   **The "No-Line" Rule:** To achieve a premium industrial feel, **1px solid borders are prohibited for sectioning components.** Instead, define boundaries through background shifts. A side panel should not be separated by a line, but by transitioning from `surface` to `surface-container-low`.

*   **Surface Hierarchy & Nesting:** Think of the UI as a series of nested trays. 

    *   **Base:** `surface`

    *   **Level 1 (Sections):** `surface-container-low`

    *   **Level 2 (Active Workspaces):** `surface-container-highest`

    *   **Level 3 (Floating Overlays):** `surface-container-lowest` (pure white) to provide a "pop" of clarity.

*   **Signature Textures:** For high-level CTA buttons or critical AI insights, use a subtle linear gradient from `primary` (#005C97) to `primary_container`. This adds a "machined" quality that flat colors cannot replicate.

 

## 3. Typography

We use a dual-font strategy to balance industrial rigor with technical legibility.

 

*   **The Voice (Manrope):** Used for `display` and `headline` tiers. Manrope’s geometric yet slightly condensed structure gives our headers an "engineered" feel. Use `display-lg` (3.5rem) with tighter letter-spacing (-0.02em) to create a bold, professional impact in reports.

*   **The Engine (Inter):** Used for `title`, `body`, and `label` tiers. Inter is chosen for its exceptional readability in technical tables and data-dense logs. 

*   **Hierarchy as Authority:** Establish a clear gap between data and labels. Labels should always use `label-md` or `label-sm` in `on_surface_variant` to remain secondary to the data itself, which should be set in `title-md` or `body-lg` for maximum confidence.

 

## 4. Elevation & Depth

In this design system, depth is a tool for focus, not just decoration.

 

*   **The Layering Principle:** Avoid the "flat web" look. Stack surface tiers to create natural lift. For example, place a `surface-container-lowest` card on top of a `surface-container-low` background. This creates a soft, tangible "sheet" effect.

*   **Ambient Shadows:** For floating elements (Modals, Popovers), use extra-diffused shadows. 

    *   *Spec:* `Y: 8px, Blur: 32px, Color: rgba(25, 28, 29, 0.06)`. 

    *   The shadow must feel like ambient light hitting a surface, not a harsh drop shadow.

*   **The "Ghost Border" Fallback:** If a container requires a border for accessibility (e.g., an input field), use the `outline_variant` at **20% opacity**. It should be felt, not seen.

*   **Glassmorphism:** For global navigation or "AI Processing" overlays, use a backdrop-blur (12px to 20px) combined with a semi-transparent `surface` color. This keeps the industrial context visible while providing a premium, modern "lens" effect.

 

## 5. Components

 

### Buttons

*   **Primary:** Subtle rounded corners (Subtle, Level 1). Background: `primary` gradient. Text: `on_primary`. 

*   **Secondary:** No background. "Ghost Border" (20% `outline_variant`). Text: `primary`.

*   **Tertiary:** No border, no background. Use `label-md` uppercase with increased letter spacing for a "technical spec" look.

 

### Input Fields

*   **State:** Default state uses `surface-container-high` as a background instead of a white box. This makes the input feel "recessed" into the machine. 

*   **Focus:** Transition background to `surface-container-lowest` and add a 1px `primary` bottom-border only.

 

### Cards & Lists

*   **No Dividers:** Prohibit the use of horizontal rules (`

`). Separate list items using a standard 12px or 16px of vertical whitespace to maintain a clean but efficient layout. 



*   **Interaction:** On hover, a list item should shift from `surface` to `surface-container-low` with a subtle corner radius.

 

### Precision Tooltips

*   **Style:** `inverse_surface` background with `label-sm` typography. 

*   **Detail:** Add a small 2px mono-spaced coordinate or timestamp to the corner of tooltips to lean into the "investigative" personality.

 

### Industrial Progress Bars

*   **Style:** Use a thick `surface-container-highest` track. The "fill" should be a solid `primary` block. Avoid rounded ends; use a subtle or minimal radius to maintain the "sharp" industrial aesthetic.

 

## 6. Do's and Don'ts

 

### Do:

*   **Do** use asymmetrical layouts. For example, a wide column for data evidence and a narrow, offset column for AI insights.

*   **Do** use "Data Scaffolding." Use `outline_variant` at 10% opacity to create very subtle grid lines in the background of large charts, mimicking blueprint paper.

*   **Do** emphasize the "Active State." When a manufacturing line is selected, use a high-contrast `primary_fixed` highlight.

*   **Do** maintain standard information density. Whitespace should be purposeful and clean, facilitating rapid data scanning without feeling sparse.

 

### Don't:

*   **Don't** use "Consumer Blue." Avoid bright, saturated blues. Stick to the deep slate tones of `primary` and `secondary`.

*   **Don't** use large corner radii. Anything above subtle roundedness will make the system feel too "soft" and consumer-grade.

*   **Don't** use centered text for technical data. All data and labels must be left-aligned or tabular-right-aligned to maintain the feel of a rigorous ledger.

*   **Don't** use icons without labels in primary navigation. Precision requires clarity; every icon must be supported by a `label-sm` descriptor.