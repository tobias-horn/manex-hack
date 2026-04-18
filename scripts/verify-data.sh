#!/usr/bin/env bash
# Post-seed integrity + story verification.
# Runs a series of SQL checks against a team's database and prints
# PASS/FAIL for each. Exits non-zero on any failure.
#
# Usage: ./scripts/verify-data.sh <team-slug>

source "$(dirname "$0")/_lib.sh"

[[ $# -eq 1 ]] || die "usage: $0 <team-slug>"
SLUG="$1"
validate_slug "$SLUG"

FAIL=0
PASS=0

check() {
  local label="$1"
  local sql="$2"
  local expect="$3"   # expected result (string comparison)
  local actual
  actual="$(team_psql "$SLUG" -Atc "$sql" 2>/dev/null || echo ERROR)"
  if [[ "$actual" == "$expect" ]]; then
    printf '  \033[1;32m✓\033[0m %-60s (got %s)\n' "$label" "$actual"
    PASS=$((PASS + 1))
  else
    printf '  \033[1;31m✗\033[0m %-60s (got %s, want %s)\n' "$label" "$actual" "$expect"
    FAIL=$((FAIL + 1))
  fi
}

check_ge() {
  local label="$1"
  local sql="$2"
  local threshold="$3"
  local actual
  actual="$(team_psql "$SLUG" -Atc "$sql" 2>/dev/null || echo ERROR)"
  if [[ "$actual" =~ ^[0-9]+$ ]] && (( actual >= threshold )); then
    printf '  \033[1;32m✓\033[0m %-60s (got %s, >=%s)\n' "$label" "$actual" "$threshold"
    PASS=$((PASS + 1))
  else
    printf '  \033[1;31m✗\033[0m %-60s (got %s, want >=%s)\n' "$label" "$actual" "$threshold"
    FAIL=$((FAIL + 1))
  fi
}

log "verifying team=$SLUG"

# ----- Row counts --------------------------------------------------------
echo "== Row counts"
check_ge "factory rows"              "SELECT count(*) FROM factory"              "2"
check_ge "line rows"                 "SELECT count(*) FROM line"                 "4"
check_ge "section rows"              "SELECT count(*) FROM section"              "12"
check_ge "article rows"              "SELECT count(*) FROM article"              "5"
check_ge "bom_node rows"             "SELECT count(*) FROM bom_node"             "50"
check_ge "part rows"                 "SELECT count(*) FROM part"                 "500"
check_ge "product rows"              "SELECT count(*) FROM product"              "500"
check_ge "product_part_install rows" "SELECT count(*) FROM product_part_install" "2500"
check_ge "test_result rows"          "SELECT count(*) FROM test_result"          "1500"
check_ge "defect rows"               "SELECT count(*) FROM defect"               "140"
check_ge "field_claim rows"          "SELECT count(*) FROM field_claim"          "35"
check_ge "rework rows"               "SELECT count(*) FROM rework"               "100"
check_ge "product_action rows"       "SELECT count(*) FROM product_action"       "45"

# ----- FK integrity ------------------------------------------------------
echo "== FK integrity"
check "DEFECT.reported_part in PRODUCT_PART_INSTALL for same product" \
  "SELECT count(*) FROM defect d
     WHERE d.reported_part_number IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM product_part_install ppi
         JOIN part p ON ppi.part_id = p.part_id
         WHERE ppi.product_id = d.product_id
           AND p.part_number = d.reported_part_number
       )" "0"

check "FIELD_CLAIM.mapped_defect always references an existing defect" \
  "SELECT count(*) FROM field_claim fc
     WHERE fc.mapped_defect_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM defect d WHERE d.defect_id = fc.mapped_defect_id)" "0"

check "REWORK rows each attach to a real defect" \
  "SELECT count(*) FROM rework r
     WHERE NOT EXISTS (SELECT 1 FROM defect d WHERE d.defect_id = r.defect_id)" "0"

# ----- Story 1: supplier incident ---------------------------------------
echo "== Story 1 (SB-00007 supplier incident)"
check_ge "SB-00007 installed in >=25 products" \
  "SELECT count(DISTINCT ppi.product_id)
     FROM product_part_install ppi
     JOIN part p ON ppi.part_id = p.part_id
     WHERE p.batch_id = 'SB-00007'" "25"

check_ge "SOLDER_COLD defects on PM-00008 >= 20" \
  "SELECT count(*) FROM defect
     WHERE defect_code='SOLDER_COLD' AND reported_part_number='PM-00008'" "20"

check_ge "SB-00007 products have >=50% defect rate" \
  "WITH affected AS (
     SELECT DISTINCT ppi.product_id
     FROM product_part_install ppi
     JOIN part p ON ppi.part_id = p.part_id
     WHERE p.batch_id='SB-00007'
   )
   SELECT (100 * count(DISTINCT d.product_id) / NULLIF(count(DISTINCT a.product_id),0))::int
   FROM affected a LEFT JOIN defect d ON a.product_id = d.product_id
     AND d.defect_code='SOLDER_COLD'" "50"

# ----- Story 2: VIB_FAIL calibration drift -------------------------------
echo "== Story 2 (process drift at Montage Linie 1)"
check_ge "VIB_FAIL defects >= 15" \
  "SELECT count(*) FROM defect WHERE defect_code='VIB_FAIL'" "15"

check_ge "VIB_FAIL in weeks 49-52/2025 >= 15" \
  "SELECT count(*) FROM defect
     WHERE defect_code='VIB_FAIL'
       AND EXTRACT(ISOYEAR FROM ts)=2025
       AND EXTRACT(WEEK FROM ts) BETWEEN 49 AND 52" "15"

# ----- Story 3: thermal drift field claims -------------------------------
echo "== Story 3 (thermal drift on MC-200)"
check_ge "MC-200 field claims Jan-Mar 2026 >= 8" \
  "SELECT count(*) FROM field_claim fc
     JOIN product p ON fc.product_id = p.product_id
     WHERE p.article_id = 'ART-00001'
       AND fc.claim_ts >= '2026-01-01'
       AND fc.claim_ts <  '2026-04-01'" "8"

check_ge "MC-200 claims referencing PM-00015 >= 5" \
  "SELECT count(*) FROM field_claim
     WHERE reported_part_number='PM-00015'" "5"

# ----- Story 4: operator user_042 ----------------------------------------
echo "== Story 4 (operator user_042 on PO-00012/18/24)"
check_ge "defects on PO-00012/18/24 >= 10" \
  "SELECT count(*) FROM defect d
     JOIN product p ON d.product_id=p.product_id
     WHERE p.order_id IN ('PO-00012','PO-00018','PO-00024')" "10"

check_ge "rework rows with user_042 on story4 products >= 8" \
  "SELECT count(*) FROM rework r
     JOIN product p ON r.product_id=p.product_id
     WHERE r.user_id='user_042'
       AND p.order_id IN ('PO-00012','PO-00018','PO-00024')" "8"

# ----- Noise + distractors -----------------------------------------------
echo "== Noise + distractors"
check_ge "false-positive low-severity defects present >= 8" \
  "SELECT count(*) FROM defect
     WHERE severity='low' AND notes ILIKE '%false positive%'" "8"

check_ge "section hotspot detects >=30% of defects" \
  "SELECT (100 * count(*) FILTER (WHERE s.name ILIKE 'Pruefung%')
              / NULLIF(count(*),0))::int
     FROM defect d
     LEFT JOIN section s ON d.detected_section_id=s.section_id" "30"

# ----- Images ------------------------------------------------------------
echo "== Defect images"
check "All high/critical defects have image_url" \
  "SELECT count(*) FROM defect
     WHERE severity IN ('high','critical') AND image_url IS NULL" "0"

check_ge "Field claims with image_url >= 15" \
  "SELECT count(*) FROM field_claim WHERE image_url IS NOT NULL" "15"

# ----- Summary -----------------------------------------------------------
echo
if (( FAIL == 0 )); then
  printf '\033[1;32mall %d checks passed\033[0m\n' "$PASS"
else
  printf '\033[1;31m%d of %d checks FAILED\033[0m\n' "$FAIL" $((PASS + FAIL))
  exit 1
fi
