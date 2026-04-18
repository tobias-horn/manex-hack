#!/usr/bin/env bash
# Shared helpers for deploy / reset / teardown scripts.
# Source this file, don't execute it directly.

set -euo pipefail

# ---- paths ------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---- logging ----------------------------------------------------------
log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[ERR]\033[0m %s\n' "$*" >&2; exit 1; }

# ---- random / secrets -------------------------------------------------
# 32-byte URL-safe random string
rand_secret() {
  # openssl is on every modern Linux/macOS; LC_ALL=C keeps tr POSIX-safe.
  openssl rand -base64 48 | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 48
}

# Base64url without padding (for JWTs)
b64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

# Build a JWT signed HS256 with the given secret.
# Args: $1 = secret, $2 = role (e.g. "anon", "service_role")
# Expiry: 1 year from now (ample for hackathon lifecycle).
make_jwt() {
  local secret="$1"
  local role="$2"
  local now
  now=$(date +%s)
  local exp=$(( now + 365 * 86400 ))
  local header='{"alg":"HS256","typ":"JWT"}'
  local payload
  payload=$(printf '{"role":"%s","iss":"manex-hackathon","iat":%d,"exp":%d}' \
    "$role" "$now" "$exp")
  local header_b64 payload_b64
  header_b64=$(printf '%s' "$header"  | b64url)
  payload_b64=$(printf '%s' "$payload" | b64url)
  local signing_input="${header_b64}.${payload_b64}"
  local signature
  signature=$(printf '%s' "$signing_input" \
    | openssl dgst -sha256 -binary -hmac "$secret" \
    | b64url)
  printf '%s.%s' "$signing_input" "$signature"
}

# ---- validation -------------------------------------------------------
require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"
}

# Slug must be lowercase alphanumeric + hyphens, 2-30 chars.
validate_slug() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9-]{1,29}$ ]] \
    || die "invalid team slug '$1'. must match ^[a-z0-9][a-z0-9-]{1,29}\$"
}

# Team number 1..99 (three-digit-safe port math)
validate_team_number() {
  [[ "$1" =~ ^[0-9]+$ ]] || die "team number must be integer, got '$1'"
  (( $1 >= 1 && $1 <= 99 )) || die "team number $1 out of range [1,99]"
}

# ---- compose helpers --------------------------------------------------
team_project_name() { printf 'manex-%s' "$1"; }
team_env_file()     { printf '%s/.env.%s' "$REPO_ROOT" "$1"; }

# docker-compose wrapper pinned to team env + project
team_compose() {
  local slug="$1"; shift
  docker compose \
    --env-file "$(team_env_file "$slug")" \
    -p "$(team_project_name "$slug")" \
    -f "$REPO_ROOT/docker-compose.yml" \
    "$@"
}

# Run psql inside the team's db container as postgres superuser.
team_psql() {
  local slug="$1"; shift
  team_compose "$slug" exec -T db \
    psql -U postgres -d hackathon -v ON_ERROR_STOP=1 "$@"
}

# Wait for team's DB to be healthy (max ~60s)
wait_for_db() {
  local slug="$1"
  local attempts=30
  log "waiting for db (team=$slug)..."
  while (( attempts > 0 )); do
    if team_compose "$slug" exec -T db \
         pg_isready -U postgres -d hackathon >/dev/null 2>&1; then
      log "db ready (team=$slug)"
      return 0
    fi
    sleep 2
    attempts=$((attempts - 1))
  done
  die "db did not become ready for team=$slug"
}
