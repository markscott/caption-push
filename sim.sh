#!/usr/bin/env bash
# sim.sh — Launch the full Caption Push simulation on macOS
#
# Opens three Terminal windows:
#   1. Display #1 (pygame LED simulator)
#   2. Display #2 (pygame LED simulator)
#   3. Node.js bridge server (ZeroMQ PUB + WebSocket)
#
# Then opens the operator UI in your default browser.
#
# Prerequisites (run once):
#   python3 -m pip install pyzmq Pillow pygame numpy
#   cd controller && npm install

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- Verify dependencies ----
if ! python3 -c "import zmq, PIL, pygame, numpy" 2>/dev/null; then
  echo "Missing Python deps. Run:"
  echo "  python3 -m pip install pyzmq Pillow pygame numpy"
  exit 1
fi

if [ ! -d "$DIR/controller/node_modules" ]; then
  echo "Node modules not installed. Run:"
  echo "  cd controller && npm install"
  exit 1
fi

echo "Starting Caption Push simulation..."

# Open three Terminal windows via AppleScript
osascript <<EOF
tell application "Terminal"
  -- Display 1
  do script "cd '$DIR' && python3 -m display.daemon --sim --id 1 --address tcp://localhost:5555; exec zsh"
  -- Display 2
  do script "cd '$DIR' && python3 -m display.daemon --sim --id 2 --address tcp://localhost:5555; exec zsh"
  -- Bridge server + open browser
  do script "cd '$DIR/controller' && npm run dev; exec zsh"
end tell
EOF

# Give the bridge server 2 seconds to start, then open the UI
sleep 2
open "http://localhost:5173"

echo ""
echo "Simulation running:"
echo "  Display 1 & 2 — pygame windows (LED panel simulators)"
echo "  Operator UI   — http://localhost:5173"
echo ""
echo "Load scripts/example.srt in the browser to test."
