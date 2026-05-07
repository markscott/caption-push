#!/usr/bin/env bash
set -e

DISPLAY_ID="${DISPLAY_ID:-1}"
CONTROLLER_ADDRESS="${CONTROLLER_ADDRESS:-tcp://bridge:5555}"
PIXEL_SIZE="${PIXEL_SIZE:-8}"
PIXEL_GAP="${PIXEL_GAP:-1}"
PANEL_WIDTH="${PANEL_WIDTH:-128}"
PANEL_HEIGHT="${PANEL_HEIGHT:-64}"
FONT_SIZE="${FONT_SIZE:-24}"
MAX_LINES="${MAX_LINES:-1}"

# ---- Virtual framebuffer — sized to exactly match the pygame window ----
CELL=$(( PIXEL_SIZE + PIXEL_GAP ))
XVFB_W=$(( PANEL_WIDTH  * CELL ))
XVFB_H=$(( PANEL_HEIGHT * CELL ))
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

# ---- noVNC index — auto-connects; fullscreen prompt + auto-hide control handle ----
# Timestamp-based cache buster so browsers always reload after a container restart
CACHE_BUST=$(date +%s)
cat > /usr/share/novnc/index.html <<HTMLEOF
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; width: 100vw; height: 100vh; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; display: block; }
    #fs-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.82);
      display: none; align-items: center; justify-content: center;
      cursor: pointer; z-index: 999;
      color: #fff; font: 600 20px system-ui; user-select: none;
    }
    #fs-overlay.visible { display: flex; }
  </style>
</head>
<body>
  <iframe src="vnc.html?autoconnect=1&resize=scale&v=${CACHE_BUST}" allowfullscreen></iframe>
  <div id="fs-overlay">Click to go fullscreen</div>
  <script>
    const iframe  = document.querySelector('iframe');
    const overlay = document.getElementById('fs-overlay');

    // ---- Fullscreen prompt ------------------------------------------------

    function goFullscreen() {
      document.documentElement.requestFullscreen().then(() => {
        overlay.classList.remove('visible');
      });
    }
    overlay.onclick = goFullscreen;

    if (new URLSearchParams(location.search).has('fullscreen')) {
      overlay.classList.add('visible');
    }

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && !isOnPrimary()) {
        overlay.classList.add('visible');
      }
    });

    function isOnPrimary() {
      const cx = window.screenX + window.outerWidth  / 2;
      const cy = window.screenY + window.outerHeight / 2;
      return cx >= 0 && cx < screen.width && cy >= 0 && cy < screen.height;
    }

    let prevOnPrimary = isOnPrimary();
    setInterval(() => {
      if (document.fullscreenElement) return;
      const onPrimary = isOnPrimary();
      if (prevOnPrimary && !onPrimary)  overlay.classList.add('visible');
      if (!prevOnPrimary && onPrimary)  overlay.classList.remove('visible');
      prevOnPrimary = onPrimary;
    }, 500);

    // ---- Control bar auto-hide in fullscreen ------------------------------

    let handleReady = false;
    let hideTimer   = null;
    let autoHide    = false;

    function setupHandleAutoHide() {
      if (handleReady) return;
      try {
        const iDoc   = iframe.contentDocument;
        const handle = iDoc && iDoc.getElementById('noVNC_control_bar_handle');
        if (!handle) return;
        handleReady = true;

        handle.style.transition = 'opacity 0.25s ease';

        function showHandle() {
          clearTimeout(hideTimer);
          handle.style.opacity      = '1';
          handle.style.pointerEvents = '';
        }

        function hideHandle() {
          handle.style.opacity      = '0';
          handle.style.pointerEvents = 'none';
        }

        function scheduleHide() {
          clearTimeout(hideTimer);
          hideTimer = setTimeout(hideHandle, 1500);
        }

        // Mouse near left edge → reveal; further right → schedule hide
        iDoc.addEventListener('mousemove', (e) => {
          if (!autoHide) return;
          if (e.clientX < 64) showHandle();
          else                 scheduleHide();
        });

        // Keep visible while cursor is on the handle itself
        handle.addEventListener('mouseenter', () => { if (autoHide) clearTimeout(hideTimer); });
        handle.addEventListener('mouseleave', () => { if (autoHide) scheduleHide(); });

        // Toggle auto-hide with fullscreen state
        function applyFullscreenState() {
          autoHide = !!document.fullscreenElement;
          autoHide ? hideHandle() : showHandle();
        }

        document.addEventListener('fullscreenchange', applyFullscreenState);
        applyFullscreenState();

      } catch (e) { /* not ready yet */ }
    }

    // Retry until noVNC has rendered its elements
    iframe.addEventListener('load', () => {
      const poll = setInterval(() => {
        setupHandleAutoHide();
        if (handleReady) clearInterval(poll);
      }, 200);
    });
  </script>
</body>
</html>
HTMLEOF

# ---- noVNC websockify proxy ----
# Serves the HTML5 VNC client on port 6080
websockify \
  --web /usr/share/novnc \
  --log-file /tmp/websockify.log \
  6080 localhost:5900 &

echo "[display-${DISPLAY_ID}] noVNC available at http://localhost:6080/ (auto-scales to browser window)"

# ---- Caption display daemon ----
exec python3 -m display.daemon \
  --sim \
  --id "${DISPLAY_ID}" \
  --address "${CONTROLLER_ADDRESS}" \
  --width "${PANEL_WIDTH}" \
  --height "${PANEL_HEIGHT}" \
  --font-size "${FONT_SIZE}" \
  --pixel-size "${PIXEL_SIZE}" \
  --pixel-gap "${PIXEL_GAP}" \
  --max-lines "${MAX_LINES}"
