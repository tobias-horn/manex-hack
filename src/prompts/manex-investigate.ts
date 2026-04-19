import { stringifyUnicodeSafe } from "@/lib/json-unicode";

export const MANEX_INVESTIGATE_PROMPT_VERSION = "2026-04-19.investigate.v1";

export const MANEX_INVESTIGATE_SYSTEM_PROMPT = "You are a senior quality engineer.";

const USER_PROMPT_TEMPLATE = `You have six generic data tables from a
manufacturing database. You have NOT been told how many root cause stories exist.
Find ALL of them purely from statistical anomalies. There may be 2, 3, 4 or more.

TABLE DESCRIPTIONS:

query1_defect_landscape
  Every defect aggregated by code × ISO week × occurrence section (where it happened)
  × detected section (just the gate that caught it) × severity × part × article.
  Look for: spikes in a specific code × week, codes confined to a narrow time window.
  CRITICAL: occurrence_section = root cause location. detected_section = just a gate.

query2_product_fingerprints
  One row per affected product: article, order_id, build_week, installed batch_ids,
  rework_operators, defect_codes, claim_count, complaint snippets, total cost.

  TWO CRITICAL CHECKS YOU MUST PERFORM:
  A) BATCH CHECK: For each batch_id that appears in the data, calculate what
     percentage of products containing that batch have defects. A batch appearing
     in 80%+ of defective products is a supplier signal — even if it also appears
     in some clean products.
  B) OPERATOR CHECK: Look at rework_operators grouped by order_id. If one specific
     user_id dominates rework on 2-3 specific order_ids but NOT on others, that
     operator may be CAUSING defects on those orders — not just fixing them.
     An operator who causes defects will appear in rework because their own
     faulty work gets sent back for correction. Do NOT dismiss this as noise.

query3_claims_with_context
  Every field claim with complaint_text (German), days_build_to_claim, claimed_part,
  factory_defect_count for that product.

  CRITICAL CHECK: Products with claim_count > 0 AND factory_defect_count = 0 mean
  the factory tests NEVER caught the problem. This is NOT noise or customer misuse —
  this is a DESIGN or LATENT DEFECT root cause. The product failed in the field
  after weeks of customer use because the factory test was too short to reveal it.
  You MUST investigate these as a separate root cause story:
  - Group them by article_name and claimed_part
  - Read the complaint_text for recurring German keywords (Temperatur, Drift,
    schleichender Ausfall, Ausfall nach Wochen)
  - Check days_build_to_claim — a long lag (50-100 days) confirms a latent issue
  - Cross-reference query6 to find which BOM position that part sits at

query4_test_results_by_week
  All tests grouped by test_key × result (PASS/MARGINAL/FAIL) × ISO week.
  Look for: FAIL or MARGINAL spikes on a specific test_key in a narrow week window.
  MARGINAL = near-miss early warning.

query5_rework_action_texts
  What operators wrote in German when doing rework, grouped by operator/week/
  section/order_id. action_texts contains the actual German free text.
  Look for:
  - Repeated technical phrases across many records (indicates systemic cause)
  - One user_id appearing heavily on specific order_ids with cosmetic defect
    action texts (scratches, labels, packaging) — that operator may be causing
    the cosmetic damage, not repairing someone else's work
  - The order_id column is critical here: cross-reference with query2 to see
    if the orders with high rework from one operator also have high defect rates

query6_bom_positions
  Parts from defects/claims mapped to BOM position (find_number like R33, C12)
  and assembly. CRITICAL: A part with high claim_count but low defect_count means
  the factory never catches it — check this against query3's zero-defect claims.
  The BOM find_number tells you exactly where on the board the weakness sits.

DATA:
[insert the JSON payload here]

MANDATORY ANALYSIS STEPS — complete all of these before writing your response:

STEP 1 — Defect code spikes: Which codes spike in a specific narrow time window?
STEP 2 — Batch analysis: Which batch_ids appear disproportionately in defective products?
STEP 3 — Zero-factory-defect claims: List all products in query3 where
          factory_defect_count=0. Group by article and claimed_part. Read the
          complaint texts. Calculate average days_build_to_claim. This group
          MUST become its own root cause story if there are 5+ such claims
          clustered on one article/part combination.
STEP 4 — Operator analysis: For each unique user_id in query5, list which
          order_ids they appear on most. If one user dominates 2-3 specific
          orders with cosmetic action texts, that is an operator root cause.
          Cross check: do those specific orders have elevated defect counts
          in query2? If yes, this IS a root cause story.
STEP 5 — Test spikes: Which test_key shows FAIL/MARGINAL concentration in
          a specific ISO week range?
STEP 6 — BOM position: Which parts have claim_count >> defect_count in query6?
          What BOM position (find_number) do they sit at?

Generate one story per distinct root cause. Do not merge separate causes.
Do not dismiss any finding as noise without explicitly showing the math.

Return ONLY valid JSON, no markdown, no text outside the JSON:

{
  "overall_summary": "2-3 sentence executive summary",
  "total_cost_impact": <number>,
  "stories": [
    {
      "title": "Short descriptive title",
      "category": "supplier|process|design|operator|unknown",
      "confidence": "high|medium|low",
      "affected_product_count": <number>,
      "key_evidence": [
        "Specific stat with numbers from the data",
        "Cross-reference between two tables",
        "Third evidence point"
      ],
      "total_cost": <number>,
      "root_cause": "One sentence root cause",
      "d1_team": "Teams to involve",
      "d2_problem": "5W2H problem description",
      "d3_containment": "Immediate containment actions",
      "d4_root_cause": "Root cause with data evidence",
      "d5_corrective_actions": "Permanent corrective actions"
    }
  ],
  "noise_and_distractors": [
    "Pattern + specific reason it is noise, not a root cause"
  ],
  "near_miss_warnings": [
    "Early warning signal + specific data reference"
  ]
}`;

export function buildManexInvestigateUserPrompt(payload: unknown) {
  return USER_PROMPT_TEMPLATE.replace(
    "[insert the JSON payload here]",
    stringifyUnicodeSafe(payload),
  );
}
