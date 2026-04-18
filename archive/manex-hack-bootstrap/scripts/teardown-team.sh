#!/usr/bin/env bash
# Stop + remove a team's stack including volumes (destroys data).
#
# Usage: ./scripts/teardown-team.sh <team-slug>

source "$(dirname "$0")/_lib.sh"

[[ $# -eq 1 ]] || die "usage: $0 <team-slug>"
SLUG="$1"
validate_slug "$SLUG"

ENV_FILE="$(team_env_file "$SLUG")"
if [[ ! -f "$ENV_FILE" ]]; then
  warn "no env file for team=$SLUG — nothing to tear down"
  exit 0
fi

log "tearing down team=$SLUG (volumes included)"
team_compose "$SLUG" down -v --remove-orphans

rm -f "$ENV_FILE" "$REPO_ROOT/handouts/team-${SLUG}.txt"
log "removed env file + handout for team=$SLUG"
