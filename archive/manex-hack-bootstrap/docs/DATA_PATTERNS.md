# Data Patterns — The Four Stories

The challenge is **not** a treasure hunt. You are not here to guess what's
in the data. You are here to design the best possible UX/UI, report
generation, and workflow for these problems — so we tell you exactly
what's in the dataset up front.

There are **four distinct root-cause stories** plus deliberate noise.
Your tool should help engineers and managers:

- Identify which story applies to a given symptom.
- Build an intuitive visual trail from symptom → cause.
- Draft a quality report (8D, FMEA, or something better) with minimal
  manual typing.
- Turn findings into actionable initiatives and track them to close-out.

## Story 1 — Supplier incident (material defect)

| |  |
|---|---|
| **Category**   | Material / incoming quality |
| **Signal**     | Spike in `SOLDER_COLD` defects, weeks 5-6/2026. Field claims cluster in March 2026. |
| **Root cause** | Supplier `ElektroParts GmbH` delivered a bad batch (`batch_id = SB-00007`) of 100µF capacitors (`part_master = PM-00008`). Received early February 2026. ESR values elevated → poor wetting during reflow soldering → cold joints → field failures under thermal cycling. |
| **Entities**   | `supplier_batch.batch_id = 'SB-00007'` → `part` (700+ instances flagged) → `product_part_install` → `product` → `defect` (code `SOLDER_COLD`, part `PM-00008`). Claims in `field_claim` reference `PM-00008`, `complaint_text` mentions "Totalausfall" / "Ausfall nach wenigen Wochen". |
| **Scope**      | ~30 affected products, ~25 defects, ~12 field claims. |
| **Discovery hint** | Join `product_part_install` → `part` → `supplier_batch` and group defect rates by `batch_id`. |

## Story 2 — Process drift (calibration)

| |  |
|---|---|
| **Category**   | Process / calibration |
| **Signal**     | `VIB_TEST` failures at `Section "Montage Linie 1"` during weeks 49-52/2025. Zero occurrences after KW 2/2026 — self-corrected. |
| **Root cause** | Torque wrench at that section drifted out of calibration. Screws under-torqued → housing vibration amplitude exceeded spec at end-of-line test. |
| **Entities**   | `defect.defect_code = 'VIB_FAIL'`, `occurrence_section_id` = Montage Linie 1 section, `ts` in Dec 2025. `test_result.test_key = 'VIB_TEST'` with `overall_result = 'FAIL'`. `rework.action_text` mentions "Schraubmoment nachgezogen". |
| **Scope**      | ~20 defects, all in weeks 49-52/2025. |
| **Discovery hint** | Group VIB_TEST failures by occurrence section + week. Contained time window is the signature. |

## Story 3 — Design weakness (thermal drift)

| |  |
|---|---|
| **Category**   | Design / latent defect |
| **Signal**     | Field claims on `article_id = ART-00001` (Motor Controller MC-200) after 8-12 weeks of customer operation. No in-factory defect record. |
| **Root cause** | Resistor `part_master = PM-00015` at BOM position `R33` on the "Steuerplatine" assembly runs hot under nominal load. Gradual drift → eventual failure. In-factory tests are short-duration and never catch it. |
| **Entities**   | `field_claim` joined with `product` where `article_id = ART-00001`; `reported_part_number = PM-00015`. `complaint_text` mentions "schleichender Ausfall", "Temperatur", "Drift". No matching `defect` row. `bom_node.find_number = 'R33'` flags the position. |
| **Scope**      | ~15 field claims over Jan-Mar 2026, zero in-factory defects. |
| **Discovery hint** | Look for field claims on products with *no* prior defect history — those are the design leaks. |

## Story 4 — Operator / shift handling

| |  |
|---|---|
| **Category**   | Operator / handling |
| **Signal**     | Cosmetic defects (VISUAL_SCRATCH, LABEL_MISALIGN) cluster on three specific production orders: `PO-00012`, `PO-00018`, `PO-00024`. Low severity, no functional impact. |
| **Root cause** | Packaging operator `user_id = 'user_042'` handled products roughly across those three orders. |
| **Entities**   | `product.order_id IN ('PO-00012','PO-00018','PO-00024')`. `rework.user_id = 'user_042'` dominates these products. `defect.defect_code IN ('VISUAL_SCRATCH','LABEL_MISALIGN')` at severity `low`. |
| **Scope**      | ~15 defects across 3 orders. |
| **Discovery hint** | Group defects by `product.order_id` and `rework.user_id`. Operator story only surfaces when you join through REWORK. |

## Noise and distractors

- **Section hotspot:** Section `"Pruefung Linie 2"` detects ~40% of all
  defects. **This is detection bias, not a root cause.** That station is
  the end-of-line gate; defects from every origin flow through it. A tool
  that treats "most defects detected here" as a root-cause signal is
  misleading.

- **False positives:** ~10 defects with `severity = 'low'` and `notes`
  containing "false positive" — rework confirmed the product was OK.
  Your LLM-generated report should recognize and discount these.

- **Near-miss test results:** ~50 `test_result` rows with values near
  (but within) the limit. Not failures, but early warnings. Bonus if
  your tool surfaces them as a leading indicator.

- **Seasonal dip:** Lower production volumes in weeks 51-52/2025.
  Not a quality signal — just the holiday break.

## Global distributions

- **Defect code Pareto:** 15 codes total. Top 3 (`SOLDER_COLD`,
  `VISUAL_CRACK`, `TEST_OOL`) account for ~70% of all defects.
- **Test result bands:** 85% PASS / 10% MARGINAL / 5% FAIL per test type.
  Story 1 products skew toward MARGINAL/FAIL on `ESR_TEST`.
  Story 2 products skew toward MARGINAL/FAIL on `VIB_TEST`.
- **Field claim lag:** 4-8 weeks from build (Story 1), 8-12 weeks (Story 3).

## Defect images

Rows with `severity IN ('high','critical')` have an `image_url` relative
path (for example, `/defect_images/defect_01_cold_solder.jpg`). Prepend
`http://<vm>:9000` from your handout to build a full image URL. 12
industrial inspection photographs covering solder joints, housing cracks,
burned components, lifted pads, etc. Use them in your UI to add visual
context to defects.

## Time range

Oct 2025 – Mar 2026 (6 months).
