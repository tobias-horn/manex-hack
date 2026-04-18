#!/usr/bin/env bash
# Restore a team's DB to seed state without touching other teams.
# Keeps credentials + stack up; only truncates data + reloads seed.
#
# Usage: ./scripts/reset-team.sh <team-slug>

source "$(dirname "$0")/_lib.sh"

[[ $# -eq 1 ]] || die "usage: $0 <team-slug>"
SLUG="$1"
validate_slug "$SLUG"

[[ -f "$(team_env_file "$SLUG")" ]] \
  || die "no env file for team=$SLUG — run deploy-team.sh first"

SEED_FILE="$REPO_ROOT/supabase/seed.sql"
[[ -f "$SEED_FILE" ]] || die "no seed.sql at $SEED_FILE"

log "resetting team=$SLUG"

# Truncate only seed tables. Workflow tables (product_action, rework) +
# team-created tables are preserved so teams don't lose their work.
# If you want a hard reset, also TRUNCATE product_action, rework.
team_psql "$SLUG" <<'SQL'
TRUNCATE TABLE
  field_claim, rework, product_action, defect, test_result, test,
  product_part_install, product, production_order, part,
  supplier_batch, bom_node, bom, configuration, article,
  part_master, section, line, factory
RESTART IDENTITY CASCADE;
SQL

log "reloading seed.sql"
team_compose "$SLUG" exec -T db \
  psql -U postgres -d hackathon -v ON_ERROR_STOP=1 < "$SEED_FILE"

log "reset complete for team=$SLUG"
