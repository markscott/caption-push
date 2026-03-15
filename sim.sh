#!/usr/bin/env bash
# sim.sh — Launch the full Caption Push simulation via Docker Desktop
#
# Services started:
#   bridge    — Node.js bridge server (React UI + ZeroMQ PUB)  → http://localhost:3000
#   display1  — LED panel simulator #1 (noVNC)                 → http://localhost:6080/vnc.html
#   display2  — LED panel simulator #2 (noVNC)                 → http://localhost:6081/vnc.html
#
# Prerequisites: Docker Desktop running

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# ---- Check Docker is running ----
if ! docker info &>/dev/null; then
  echo "Docker Desktop is not running. Please start it and try again."
  exit 1
fi

echo "Building and starting Caption Push..."
docker compose up --build -d

echo ""
echo "Waiting for services to be ready..."

# Wait for the bridge health check to pass
attempt=0
until docker compose ps bridge | grep -q "healthy" || [ $attempt -ge 30 ]; do
  sleep 2
  attempt=$((attempt + 1))
done

if [ $attempt -ge 30 ]; then
  echo "Bridge did not become healthy in time. Check logs:"
  echo "  docker compose logs bridge"
  exit 1
fi

echo ""
echo "=== Caption Push is running ==="
echo ""
echo "  Operator UI  → http://localhost:4000"
echo "  Display 1    → http://localhost:6080/vnc.html?autoconnect=1&resize=scale"
echo "  Display 2    → http://localhost:6081/vnc.html?autoconnect=1&resize=scale"
echo ""
echo "Load scripts/example.srt in the operator UI, then press Space to advance captions."
echo ""
echo "To stop:  docker compose down"
echo "To logs:  docker compose logs -f"
echo ""

# Open browser tabs
open "http://localhost:4000"
sleep 1
open "http://localhost:6080/vnc.html?autoconnect=1&resize=scale"
sleep 0.5
open "http://localhost:6081/vnc.html?autoconnect=1&resize=scale"
