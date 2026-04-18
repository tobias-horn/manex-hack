#!/usr/bin/env bash
# Deploy N team stacks from a teams.txt file. Also starts the shared
# assets container. Safe to rerun (deploy-team.sh is idempotent).
#
# Usage: ./scripts/deploy-all.sh [teams-file]
#   teams-file: defaults to teams.txt in repo root

source "$(dirname "$0")/_lib.sh"

TEAMS_FILE="${1:-$REPO_ROOT/teams.txt}"
[[ -f "$TEAMS_FILE" ]] || die "teams file not found: $TEAMS_FILE"

log "deploying teams from $TEAMS_FILE"

N=0
while IFS= read -r slug || [[ -n "$slug" ]]; do
  slug="${slug#"${slug%%[![:space:]]*}"}"  # ltrim
  slug="${slug%"${slug##*[![:space:]]}"}"   # rtrim
  [[ -z "$slug" || "$slug" == \#* ]] && continue
  N=$((N + 1))
  log "=== team #$N: $slug ==="
  # Protect the loop input file from child commands that may read stdin
  # (docker compose exec -T drains FD 0 otherwise, causing early EOF).
  "$REPO_ROOT/scripts/deploy-team.sh" "$slug" "$N" < /dev/null
done < "$TEAMS_FILE"

log "deployed $N team(s). starting shared assets container."
"$REPO_ROOT/scripts/deploy-assets.sh"

log "all teams deployed. handouts in $REPO_ROOT/handouts/"
