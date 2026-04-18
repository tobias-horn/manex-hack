-- Convenience views exposed automatically via PostgREST.
-- Pre-join the most common query paths so teams don't have to master
-- PostgREST's embedding syntax for the typical cases.
--
-- Views:
--   v_defect_detail       — defects joined with product, article, sections, part, test
--   v_product_bom_parts   — installed parts per product with batch + supplier trail
--   v_field_claim_detail  — field claims with product, article, mapped defect, part
--   v_quality_summary     — weekly rollup per article for dashboard KPIs

BEGIN;

-- ============================================================
-- v_defect_detail
-- Single row per defect enriched with the typical FMEA context.
-- ============================================================
CREATE OR REPLACE VIEW v_defect_detail AS
SELECT
  d.defect_id,
  d.product_id,
  d.ts                            AS defect_ts,
  d.source_type,
  d.defect_code,
  d.severity,
  d.detected_section_id,
  d.occurrence_section_id,
  d.detected_test_result_id,
  d.reported_part_number,
  d.image_url,
  d.cost,
  d.notes,
  p.build_ts                      AS product_build_ts,
  p.article_id,
  a.name                          AS article_name,
  p.order_id,
  ds.name                         AS detected_section_name,
  os.name                         AS occurrence_section_name,
  pm.title                        AS reported_part_title,
  pm.commodity                    AS reported_part_commodity,
  tr.test_value                   AS detected_test_value,
  tr.overall_result               AS detected_test_overall,
  tr.unit                         AS detected_test_unit,
  t.title                         AS detected_test_name,
  t.test_type                     AS detected_test_type,
  t.lower_limit                   AS detected_test_lower,
  t.upper_limit                   AS detected_test_upper
FROM defect d
JOIN product p       ON d.product_id = p.product_id
JOIN article a       ON p.article_id = a.article_id
LEFT JOIN section ds ON d.detected_section_id = ds.section_id
LEFT JOIN section os ON d.occurrence_section_id = os.section_id
LEFT JOIN part_master pm  ON d.reported_part_number = pm.part_number
LEFT JOIN test_result tr  ON d.detected_test_result_id = tr.test_result_id
LEFT JOIN test t          ON tr.test_id = t.test_id;

-- ============================================================
-- v_product_bom_parts
-- All installed parts per product with BOM position + supplier + batch.
-- Core traceability view for part-level root-cause analysis.
-- ============================================================
CREATE OR REPLACE VIEW v_product_bom_parts AS
SELECT
  ppi.product_id,
  ppi.install_id,
  ppi.installed_ts,
  ppi.installed_section_id,
  ppi.position_code,
  ppi.user_id                     AS install_user_id,
  bn.bom_node_id,
  bn.find_number,
  bn.node_type,
  parent_bn.find_number           AS parent_find_number,
  parent_bn.node_type             AS parent_node_type,
  pm.part_number,
  pm.title                        AS part_title,
  pm.commodity,
  pm.drawing_number,
  p.part_id,
  p.serial_number,
  p.quality_status,
  p.manufacturer_name,
  sb.batch_id,
  sb.batch_number,
  sb.supplier_name,
  sb.supplier_id,
  sb.received_date                AS batch_received_date
FROM product_part_install ppi
JOIN part p          ON ppi.part_id = p.part_id
JOIN part_master pm  ON p.part_number = pm.part_number
JOIN bom_node bn     ON ppi.bom_node_id = bn.bom_node_id
LEFT JOIN bom_node parent_bn ON bn.parent_bom_node_id = parent_bn.bom_node_id
LEFT JOIN supplier_batch sb  ON p.batch_id = sb.batch_id;

-- ============================================================
-- v_field_claim_detail
-- Field claims enriched with product, article, mapped defect, part.
-- ============================================================
CREATE OR REPLACE VIEW v_field_claim_detail AS
SELECT
  fc.field_claim_id,
  fc.product_id,
  fc.claim_ts,
  fc.market,
  fc.complaint_text,
  fc.reported_part_number,
  fc.image_url,
  fc.cost,
  fc.detected_section_id,
  fc.mapped_defect_id,
  fc.notes,
  p.build_ts                      AS product_build_ts,
  p.article_id,
  a.name                          AS article_name,
  d.defect_code                   AS mapped_defect_code,
  d.severity                      AS mapped_defect_severity,
  pm.title                        AS reported_part_title,
  pm.commodity                    AS reported_part_commodity,
  s.name                          AS detected_section_name,
  (EXTRACT(EPOCH FROM (fc.claim_ts - p.build_ts)) / 86400)::int
                                  AS days_from_build
FROM field_claim fc
JOIN product p       ON fc.product_id = p.product_id
JOIN article a       ON p.article_id = a.article_id
LEFT JOIN defect d   ON fc.mapped_defect_id = d.defect_id
LEFT JOIN part_master pm ON fc.reported_part_number = pm.part_number
LEFT JOIN section s  ON fc.detected_section_id = s.section_id;

-- ============================================================
-- v_quality_summary
-- Weekly rollup per article: counts + top defect code. Dashboard fuel.
-- ============================================================
CREATE OR REPLACE VIEW v_quality_summary AS
WITH weekly AS (
  SELECT
    a.article_id,
    a.name                        AS article_name,
    date_trunc('week', p.build_ts)::date AS week_start,
    COUNT(DISTINCT p.product_id)  AS products_built,
    COUNT(DISTINCT d.defect_id)   AS defect_count,
    COUNT(DISTINCT fc.field_claim_id) AS claim_count,
    COUNT(DISTINCT r.rework_id)   AS rework_count,
    AVG(r.time_minutes)::numeric(10,2) AS avg_rework_minutes,
    SUM(d.cost)                   AS defect_cost_sum,
    SUM(fc.cost)                  AS claim_cost_sum
  FROM article a
  JOIN product p        ON a.article_id = p.article_id
  LEFT JOIN defect d    ON p.product_id = d.product_id
  LEFT JOIN field_claim fc ON p.product_id = fc.product_id
  LEFT JOIN rework r    ON d.defect_id = r.defect_id
  GROUP BY a.article_id, a.name, date_trunc('week', p.build_ts)
),
top_codes AS (
  SELECT
    p.article_id,
    date_trunc('week', p.build_ts)::date AS week_start,
    d.defect_code,
    COUNT(*) AS cnt,
    ROW_NUMBER() OVER (
      PARTITION BY p.article_id, date_trunc('week', p.build_ts)
      ORDER BY COUNT(*) DESC
    ) AS rn
  FROM defect d
  JOIN product p ON d.product_id = p.product_id
  WHERE d.defect_code IS NOT NULL
  GROUP BY p.article_id, date_trunc('week', p.build_ts), d.defect_code
)
SELECT
  w.article_id,
  w.article_name,
  w.week_start,
  w.products_built,
  w.defect_count,
  w.claim_count,
  w.rework_count,
  w.avg_rework_minutes,
  w.defect_cost_sum,
  w.claim_cost_sum,
  tc.defect_code                  AS top_defect_code,
  tc.cnt                          AS top_defect_code_count
FROM weekly w
LEFT JOIN top_codes tc
  ON w.article_id = tc.article_id
 AND w.week_start = tc.week_start
 AND tc.rn = 1;

-- ============================================================
-- Grants
-- ============================================================
GRANT SELECT ON v_defect_detail, v_product_bom_parts, v_field_claim_detail, v_quality_summary
  TO seed_readonly;

COMMIT;
