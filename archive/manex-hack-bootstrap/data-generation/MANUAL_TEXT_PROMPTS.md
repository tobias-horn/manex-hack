# Manual English Text Generation (No API Integration)

Use this if you want to manually generate template texts in Gemini chat and avoid maintaining script/API integration.

## Output files expected by the seed generator

Place these files in `data-generation/templates/`:

- `claim_texts_en.json`
- `defect_notes_en.json`
- `rework_actions_en.json`

Each file must be a JSON array of objects with exactly this shape:

[
  {"tag": "story1_supplier", "text": "..."},
  {"tag": "background", "text": "..."}
]

## Prompt 1: claim_texts_en.json

Copy-paste this prompt into Gemini:

Generate ONLY valid JSON (no markdown), as an array of objects with keys "tag" and "text".

Task: create 40 realistic B2B customer complaint texts in English for industrial electronics.

Tag distribution:
- 12 entries with tag "story1_supplier"
- 15 entries with tag "story3_thermal"
- 13 entries with tag "background"

Context for story tags:
- story1_supplier: MC-200 units with capacitor C12 (100uF) from supplier ElektroParts have early failures after thermal cycling; symptoms include sudden outage after a few weeks.
- story3_thermal: MC-200 units show gradual degradation due to resistor R33 thermal drift after 8-12 weeks; symptoms include intermittent instability, heat-related behavior, reduced performance.
- background: mixed unrelated issues across motor controllers/sensor units (housing crack, wrong label, intermittent disconnect, etc.).

Style constraints:
- 2-8 sentences each
- professional field complaint tone
- varied specificity (some brief, some technical)
- all text in English
- avoid duplicates
- make some spelling mistakes and inconsistent writing (abbrevations, etc.). It should feel very realistic and therefore not perfect

Return exactly 40 objects in one JSON array.

## Prompt 2: defect_notes_en.json

Generate ONLY valid JSON (no markdown), as an array of objects with keys "tag" and "text".

Task: create 40 short shop-floor defect notes in English.

Tag distribution:
- 10 entries with tag "story1_supplier"
- 8 entries with tag "story2_calibration"
- 7 entries with tag "story4_operator"
- 15 entries with tag "background"

Context for story tags:
- story1_supplier: solder-related defects around capacitor C12 on control PCB.
- story2_calibration: vibration test failures linked to under-torqued screws at Assembly Line 1.
- story4_operator: cosmetic defects during packaging (scratches, misaligned labels, unreadable serial sticker).
- background: mixed generic manufacturing defects.

Style constraints:
- 1-2 sentences each
- realistic operator shorthand allowed
- concise QA/manufacturing wording
- all text in English
- avoid duplicates
- make some spelling mistakes and inconsistent writing (abbrevations, etc.). It should feel very realistic and therefore not perfect

Return exactly 40 objects in one JSON array.

## Prompt 3: rework_actions_en.json

Generate ONLY valid JSON (no markdown), as an array of objects with keys "tag" and "text".

Task: create 30 technical rework action texts in English.

Tag distribution:
- 8 entries with tag "story1_supplier"
- 7 entries with tag "story2_calibration"
- 15 entries with tag "background"

Context for story tags:
- story1_supplier: replace/re-solder C12 capacitor, re-test ESR and functional behavior.
- story2_calibration: re-torque screws, repeat vibration test, confirm pass.
- background: mixed rework actions (component replacement, re-soldering, label replacement, housing swap, firmware reflash).

Style constraints:
- 1-2 sentences each
- concrete and technical
- all text in English
- avoid duplicates
- make some spelling mistakes and inconsistent writing (abbrevations, etc.). It should feel very realistic and therefore not perfect

Return exactly 30 objects in one JSON array.

## Save and validate

1. Save Gemini outputs to the 3 files under `data-generation/templates/`.
2. Validate format and tags:

python data-generation/validate_templates.py --strict-english

3. Generate seed SQL:

cd data-generation
python generate.py
