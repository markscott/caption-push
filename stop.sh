#!/usr/bin/env bash
COMPOSE_FILE="$(dirname "$0")/docker-compose.prod.yml"
docker compose -f "$COMPOSE_FILE" down
echo "caption-push stopped."
