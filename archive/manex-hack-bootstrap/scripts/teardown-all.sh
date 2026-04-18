#!/usr/bin/env bash
# Tear down every team stack listed in teams.txt plus the assets container.
#
# Usage: ./scripts/teardown-all.sh [teams-file]

source "$(dirname "$0")/_lib.sh"

TEAMS_FILE="${1:-$REPO_ROOT/teams.txt}"
[[ -f "$TEAMS_FILE" ]] || die "teams file not found: $TEAMS_FILE"

log "tearing down all teams from $TEAMS_FILE"

while IFS= read -r slug || [[ -n "$slug" ]]; do
  slug="${slug#"${slug%%[![:space:]]*}"}"
  slug="${slug%"${slug##*[![:space:]]}"}"
  [[ -z "$slug" || "$slug" == \#* ]] && continue
  "$REPO_ROOT/scripts/teardown-team.sh" "$slug" || true
done < "$TEAMS_FILE"

log "stopping assets container"
docker compose \
  -f "$REPO_ROOT/docker-compose.assets.yml" \
  -p manex-assets \
  down -v --remove-orphans || true

log "teardown complete"
