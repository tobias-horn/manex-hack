#!/usr/bin/env bash
# Start the shared nginx container serving assets/ on port 9000.
# Idempotent: recreates the container if already running.

source "$(dirname "$0")/_lib.sh"

require_cmd docker

log "starting shared assets container (nginx on :9000)"

docker compose \
  -f "$REPO_ROOT/docker-compose.assets.yml" \
  -p manex-assets \
  up -d --force-recreate

log "assets at http://$(hostname):9000/defect_images/"
