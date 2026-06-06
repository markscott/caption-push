#!/usr/bin/env bash
set -e

COMPOSE_FILE="$(dirname "$0")/docker-compose.prod.yml"

# Verify Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "Docker is not running. Please start Docker Desktop and try again."
  exit 1
fi

echo "Pulling latest images..."
docker compose -f "$COMPOSE_FILE" pull

echo "Starting caption-push..."
docker compose -f "$COMPOSE_FILE" up -d

echo "Waiting for services to be ready..."
sleep 5

echo ""
echo "caption-push is running."
echo ""
echo "  Operator UI  → http://localhost:4000"
echo "  Display 1    → http://localhost:6080/vnc.html?autoconnect=1&resize=scale"
echo "  Display 2    → http://localhost:6081/vnc.html?autoconnect=1&resize=scale"
echo ""

open "http://localhost:4000"
open "http://localhost:6080/vnc.html?autoconnect=1&resize=scale"
open "http://localhost:6081/vnc.html?autoconnect=1&resize=scale"
