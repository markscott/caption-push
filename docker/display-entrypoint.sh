#!/usr/bin/env bash
set -e

DISPLAY_ID="${DISPLAY_ID:-1}"
CONTROLLER_ADDRESS="${CONTROLLER_ADDRESS:-tcp://bridge:5555}"
PIXEL_SIZE="${PIXEL_SIZE:-8}"
PIXEL_GAP="${PIXEL_GAP:-1}"
PANEL_WIDTH="${PANEL_WIDTH:-128}"
PANEL_HEIGHT="${PANEL_HEIGHT:-64}"
FONT_SIZE="${FONT_SIZE:-24}"

# ---- Virtual framebuffer — sized to fit the pygame window ----
CELL=$(( PIXEL_SIZE + PIXEL_GAP ))
XVFB_W=$(( (PANEL_WIDTH  + 4) * CELL ))
XVFB_H=$(( (PANEL_HEIGHT + 4) * CELL ))
Xvfb :99 -screen 0 ${XVFB_W}x${XVFB_H}x24 -ac &
XVFB_PID=$!
sleep 1

export DISPLAY=:99
export SDL_VIDEODRIVER=x11
export SDL_AUDIODRIVER=dummy

echo "[display-${DISPLAY_ID}] Xvfb started (PID $XVFB_PID)"

# ---- VNC server (no password, read-only is fine for a display) ----
x11vnc \
  -display :99 \
  -forever \
  -nopw \
  -rfbport 5900 \
  -quiet \
  -bg

echo "[display-${DISPLAY_ID}] x11vnc started on :5900"

# ---- noVNC websockify proxy ----
# Serves the HTML5 VNC client on port 6080
websockify \
  --web /usr/share/novnc \
  --log-file /tmp/websockify.log \
  6080 localhost:5900 &

echo "[display-${DISPLAY_ID}] noVNC available at http://localhost:6080/vnc.html"

# ---- Caption display daemon ----
exec python3 -m display.daemon \
  --sim \
  --id "${DISPLAY_ID}" \
  --address "${CONTROLLER_ADDRESS}" \
  --width "${PANEL_WIDTH}" \
  --height "${PANEL_HEIGHT}" \
  --font-size "${FONT_SIZE}" \
  --pixel-size "${PIXEL_SIZE}" \
  --pixel-gap "${PIXEL_GAP}"
