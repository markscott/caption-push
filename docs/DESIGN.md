# Caption Push — System Design

**Version:** 2.0
**Last updated:** 2026-05-18

---

## 1. Overview

Caption Push is a low-latency, networked captioning system for live theater. An operator runs a browser-based console on any laptop. As the show progresses the operator advances through a pre-loaded script, and each caption line is broadcast in real time to one or more audience-facing displays.

**Primary display path:** Any HDMI monitor connected to a computer running Docker. The display daemon renders text into a framebuffer served over noVNC; the operator opens the output URL fullscreen in a browser on the monitor. No special hardware is required.

**Secondary display path:** HUB75 RGB LED matrix panels driven by a Raspberry Pi, for large-format or outdoor signage applications.

**Design goals:**
- ≤15 ms end-to-end latency (keypress → visible text on display)
- All displays receive the same frame simultaneously (no sequential unicast)
- Operator UI is keyboard-driven — no mouse required during a live show
- HDMI monitor path requires only Docker Desktop — no special hardware
- LED matrix path supported via rpi-rgb-led-matrix on Raspberry Pi

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     OPERATOR LAPTOP                     │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Browser (React + TypeScript)           │   │
│  │  Script panel │ Now Showing │ Manual entry       │   │
│  └────────────────────┬────────────────────────────┘   │
│                 WebSocket /ws                            │
│  ┌────────────────────▼────────────────────────────┐   │
│  │        Node.js Bridge  (server.ts)               │   │
│  │  Express HTTP + WebSocket server (port 3000)     │   │
│  │  ZeroMQ PUB socket bound on tcp:*:5555           │   │
│  └────────────────────┬────────────────────────────┘   │
└───────────────────────┼─────────────────────────────────┘
                        │  ZeroMQ PUB  (TCP broadcast)
            ┌───────────┼───────────┐
            │           │           │
            ▼           ▼           ▼
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │  Display 1   │  │  Display 2   │  │  Display N   │
   │  daemon.py   │  │  daemon.py   │  │  daemon.py   │
   │  ZMQ SUB     │  │  ZMQ SUB     │  │  ZMQ SUB     │
   │  Pygame →    │  │  Pygame →    │  │  Pygame →    │
   │  noVNC →     │  │  noVNC →     │  │  HUB75 LEDs  │
   │  HDMI monitor│  │  HDMI monitor│  │  (Pi only)   │
   └──────────────┘  └──────────────┘  └──────────────┘
```

**Primary (HDMI monitor):** The display daemon renders text into a Pygame window inside a Docker container. Xvfb provides a virtual framebuffer; x11vnc + noVNC serve the framebuffer as a browser-accessible URL. Opening that URL fullscreen on an HDMI monitor shows the captions.

**Secondary (LED matrix):** On a Raspberry Pi the daemon drives HUB75 panels directly via the rpi-rgb-led-matrix library, bypassing the Pygame/VNC stack entirely.

### Component summary

| Component | Language/Runtime | Role |
|---|---|---|
| `controller/src/App.tsx` | React + TypeScript | Operator UI |
| `controller/src/SimDisplay.tsx` | React + Canvas API | Live preview in operator UI |
| `controller/src/scriptParser.ts` | TypeScript | In-browser SRT/plaintext parser |
| `controller/server.ts` | Node.js + TypeScript | HTTP + WebSocket server + ZeroMQ PUB |
| `display/daemon.py` | Python | ZMQ SUB + render loop + state machine |
| `display/renderer.py` | Python + Pillow | Text/emoji → PIL Image |
| `display/matrix_sim.py` | Python + Pygame | Pygame renderer → Xvfb → noVNC → HDMI monitor |
| `display/matrix_real.py` | Python + rpi-rgb-led-matrix | Physical HUB75 panel driver (Pi only) |

---

## 3. Operator UI (`controller/src/`)

The UI is a single-page React app served by the Node bridge in production. In development it runs via Vite on port 5173.

### Layout

```
┌──────── Toolbar ──────────────────────────────────────────┐
│ CAPTION PUSH  [Load Script]  [Identify All]  Brightness ● │
├──────── Script Panel ──────────────┬─── Main Area ─────────┤
│  Script — 2099 lines          ▼ All│  NOW SHOWING           │
│  ▼ ONE                             │  ┌──────────────────┐  │
│    22 She's keepin' me awake…      │  │ me awake, ain't  │  │
│    23 No, you're keeping us awake  │  │      she?        │  │
│    ##CHARACTER MOLLY SAYS:         │  └──────────────────┘  │
│    24 Mama! Mama!                  │  NEXT                   │
│                                    │  No, you're keeping us  │
│                                    │                         │
│                                    │  [Manual entry field]   │
│                                    │  [Send] [Send+Hold] [X] │
│                                    │                         │
│                                    │  Display Windows        │
│                                    │  Display 1 [Test][Full] │
│                                    │  Display 2 [Test][Full] │
│                                    │                         │
│                                    │  ⌨ Space/↓  ↑  Esc     │
└────────────────────────────────────┴─────────────────────────┘
│ Status: Line 22 of 2099                         22 / 2099  │
└────────────────────────────────────────────────────────────┘
```

### Script navigation

`showLine(idx)` is the central action:
1. Sends `{ type: 'show', text }` over WebSocket to the bridge
2. Looks ahead to the next non-metadata line and sends `{ type: 'preload', text }` so the display daemon can render it in the background before it's needed
3. Scrolls the script panel to keep the current line visible
4. Expands the current scene if collapsed

`advance()` / `retreat()` skip `isMetadata` lines (those starting with `##`), which appear in the script panel but are never sent to displays.

Scene groups collapse automatically when navigating forward into a new scene, keeping the current scene visible without the operator needing to scroll.

### Live preview (SimDisplay)

`SimDisplay.tsx` renders the currently displayed text onto an HTML Canvas element using the same font (LiberationSans-Bold served at `/fonts/` by the bridge). It polls `/preview/frame` at ~10 fps to get a JPEG snapshot directly from the display daemon's renderer, providing a pixel-accurate view of what is on the actual LED panels.

The canvas rendering is a secondary approximation used for layout validation; the JPEG poll is the authoritative preview.

### Hold mode

`sendManual(hold=true)` (Shift+Enter or Send+Hold button) sets the `hold` flag on the `show` command. The display daemon suppresses the 10-second auto-clear when `hold=true`, so text stays on screen until an explicit `clear` command.

### WebSocket reconnection

The UI reconnects automatically with a 2-second delay if the bridge drops. Connection state is shown as a green/red dot in the toolbar.

---

## 4. Bridge Server (`controller/server.ts`)

The bridge is a Node.js process with three responsibilities:

### 4.1 WebSocket endpoint

`WebSocketServer` on path `/ws`. Accepts JSON messages from the operator browser and translates them to ZeroMQ commands. Echoes an `{ type: 'ack' }` back to all connected clients after each successful send.

Message mapping:

| Browser `type` | ZMQ `cmd` | Extra fields passed through |
|---|---|---|
| `show` | `show` | `text`, `color` (default `#DCDCD2`), `align` (default `left`), `hold` (default `false`) |
| `preload` | `preload` | `text`, `color`, `align` |
| `clear` | `clear` | — |
| `brightness` | `brightness` | `level` |
| `identify` | `identify` | `id` (optional) |

A monotonically increasing `seq` integer is appended to every ZMQ message for debug ordering.

### 4.2 ZeroMQ publisher

A single `Publisher` socket bound to `tcp://*:5555` (configurable via `ZMQ_ADDRESS` env var). All display daemons subscribe to this socket. Because ZMQ PUB is a broadcast, every subscriber receives every message with a single `pub.send()` call — there is no per-display loop.

**Why ZeroMQ PUB/SUB over HTTP or raw sockets:**
- One send reaches all displays with no per-display overhead
- ~1 ms local network latency
- SUB sockets reconnect automatically if the PUB restarts
- Fire-and-forget semantics match caption delivery perfectly — no ACK round-trips

### 4.3 Preview proxy

The bridge proxies JPEG frames from the display daemon's HTTP preview server at `display1:7777/frame`. The operator UI polls `/preview/frame` through the bridge instead of directly, keeping cross-origin concerns out of the browser.

### 4.4 Font serving

`/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf` is served at `/fonts/` so the SimDisplay canvas in the browser can load the same font face used by the display renderer, keeping the preview accurate.

---

## 5. Display Daemon (`display/daemon.py`)

The daemon is a Python process running on each Pi (or inside Docker). It is the core runtime loop for a single display unit.

### 5.1 Startup

```
parse args / read environment
detect Pi vs. simulator
create matrix (SimMatrix or RealMatrix)
connect ZMQ SUB socket to controller:5555
start MJPEG preview HTTP server (port 7777) in daemon thread
matrix.start()
show blank frame
enter main loop
```

Environment variables set by Docker or `display.env`:
- `CONTROLLER_ADDRESS` — ZMQ PUB address to connect to
- `DISPLAY_ID` — integer, used for identify flash and log tags
- `PANEL_WIDTH` / `PANEL_HEIGHT` — canvas dimensions in pixels
- `FONT_SIZE` — font height in pixels (set to near `PANEL_HEIGHT`)
- `FONT_PATH` — absolute path to TrueType font
- `PIXEL_SIZE` / `PIXEL_GAP` — simulator LED dot size in screen pixels

### 5.2 Main loop

The loop targets ~60 fps using ZeroMQ's `RCVTIMEO` to drive timing:

```python
socket.setsockopt(zmq.RCVTIMEO, 16)   # 16 ms ≈ 60 fps

while True:
    try:
        msg = socket.recv_json()       # blocks up to 16 ms
        handle_command(msg)
    except zmq.Again:
        pass                           # no message this tick

    expire_identify_if_due()
    advance_scroll_animation()
    check_auto_clear()
    matrix.render_frame()             # push to display hardware / simulator
```

No busy-waiting: the ZMQ receive call blocks until either a message arrives or the 16 ms timeout expires, then the loop immediately proceeds to animation and frame rendering.

### 5.3 State machine

The daemon maintains this mutable state across loop iterations:

| Variable | Type | Description |
|---|---|---|
| `current_text` | `str` | Text currently on display |
| `current_config` | `RenderConfig` | Font/color/align for current text |
| `current_hold` | `bool` | Suppress auto-clear when True |
| `scroll_anim` | `_ScrollAnim \| None` | Active scroll animation state |
| `t_clear` | `float \| None` | Monotonic time for scheduled auto-clear |
| `identify_until` | `float` | Monotonic time when identify flash ends; 0 = inactive |
| `preload_cache` | `_PreloadCache \| None` | Pre-rendered image for the next expected line |
| `current_brightness` | `int` | Current brightness level (10–100) |

### 5.4 Command handling

**`show`**
1. Extract `text`, `hold`, `color` (hex→RGB), `align`
2. Build `RenderConfig`
3. If identify flash is active, skip display update (flash takes visual priority)
4. Check preload cache: if `text`, `color`, and `align` match, use the cached PIL Image (saves ~2–5 ms render time)
5. Otherwise call `render_text(text, config)` → PIL Image
6. If image width > panel width: start scroll animation, show first crop
7. Otherwise: show image, schedule auto-clear in 10 s (or suppress if `hold=True`)

**`preload`**
Render the provided text+config to a PIL Image and store in `preload_cache`. Runs during the gap between the current line being shown and the next one being requested, hiding render latency.

**`clear`**
Reset all state, show blank frame.

**`brightness`**
Clamp to 10–100, update `current_brightness`, call `matrix.set_brightness(level)` (hardware PWM adjustment on real matrices).

**`identify`**
If `id` matches this display or is absent: render amber `Display #N` text, set `identify_until = now + 2.0`. When the timer expires, the loop restores the previous image.

### 5.5 Scroll animation

When rendered text is wider than the panel (text is too long to fit on one screen):

1. `_ScrollAnim` stores the full-width PIL Image and a `t_scroll_start` timestamp 1.25 s in the future (pause before scrolling begins)
2. Each loop tick computes `elapsed × SCROLL_SPEED_PX_S` (375 px/s) to get the current offset
3. `_scroll_crop(wide_img, offset, panel_w, panel_h)` slices the correct window
4. When offset reaches `wide_img.width - panel_width`, animation ends and auto-clear is scheduled

### 5.6 Auto-clear

By default, 10 seconds after content is fully visible (either shown immediately or after scrolling completes), the display blanks automatically. This prevents stale captions staying on screen between scenes.

`Send+Hold` / `hold=True` suppresses auto-clear for the current line. A `clear` command resets everything including hold state.

### 5.7 MJPEG preview server

A `ThreadingHTTPServer` runs on port 7777 in a background daemon thread. After every `matrix.set_image()` call, `_update_preview()` generates a JPEG and stores it in `_preview_jpeg` (protected by a `threading.Lock`). The HTTP server serves this snapshot at `/frame`.

The JPEG is generated at half resolution (thumbnail) to reduce bandwidth. If `brightness < 100`, the thumbnail pixels are scaled by `brightness/100` using NumPy before encoding, so the preview accurately represents the dimmed output.

---

## 6. Rendering Pipeline (`display/renderer.py`)

`render_text(text, config) → PIL.Image (RGB)`

The pipeline produces a single-line image sized to the panel canvas, or a wider image if the text overflows (scroll case).

### 6.1 Font sizing

Font size is fixed at `max(8, int(config.height × 0.60) - 25)`. For the default 360 px panel height: `int(360 × 0.60) - 25 = 191 px`. This leaves headroom for descenders and the shadow effect without clipping.

The font is loaded fresh each call via `_load_font()`. Pillow's `ImageFont.truetype()` is fast enough that caching is not needed and avoids stale state on config changes.

### 6.2 Text run splitting

Text is split into runs of `(substring, font_path)` pairs by `_text_runs(text, primary_path)`. The primary font covers ASCII and Latin characters; NotoColorEmoji covers emoji sequences.

```
"Hello 🎭 world" → [("Hello ", primary), ("🎭", noto_emoji), (" world", primary)]
```

Combining marks (Unicode category `M`), format characters (category `Cf`), and variation selectors (U+FE00–FE0F) are attached to their base character so multi-codepoint emoji sequences are never split.

Glyph coverage is determined via `_covered_codepoints(font_path)` which uses `fontTools.ttLib.TTFont.getBestCmap()` to build a `frozenset` of covered Unicode codepoints. The result is cached with `@lru_cache(maxsize=None)` so the font file is parsed only once per process lifetime.

**Edge case:** if the font path does not exist (e.g., the literal `"default"` string passed from argparse on a development machine), `_covered_codepoints` returns `frozenset(range(0x110000))` — treating the font as covering all codepoints. This routes all text through the primary font path and avoids silently falling through to the emoji font for every character.

### 6.3 Emoji rendering

NotoColorEmoji uses CBDT/CBLC bitmap strike format — it only contains glyphs at discrete sizes (Debian Bookworm ships only the 109×109 px strike). Requesting an arbitrary size from Pillow raises `"invalid pixel size"`.

`_emoji_strikes()` reads the actual available strike sizes from the font's `CBLC` table via fontTools. `_snap_emoji_size(target)` returns the largest available strike ≤ the target line height (or the smallest if none qualify).

`_render_emoji_patch(seg, target_h)`:
1. Load NotoColorEmoji at the snapped strike size
2. Measure the bounding box of `seg`
3. Render onto a transparent RGBA canvas
4. Scale with LANCZOS to `target_h` pixels tall, preserving aspect ratio

The resulting RGBA patch is composited directly onto the canvas at the correct x position using `canvas.paste(patch, (cx, y_top), patch)` (the third argument is the alpha mask).

### 6.4 Compositing pipeline

```
1. canvas = RGBA black (canvas_w × panel_h)

2. Shadow pass (text only, skip emoji):
   - Render all text segments in shadow_color at (x + shadow_offset, y + shadow_offset)
   - Gaussian blur the shadow layer
   - Alpha-composite onto canvas

3. Text pass (for each run):
   - Primary font segment:
       layer = transparent RGBA canvas
       draw white text at (cx, y_draw)
       alpha-composite layer onto canvas
   - Emoji segment:
       paste RGBA patch at (cx, y_top) with its own alpha mask

4. canvas.convert("RGB") → final output
```

Shadow parameters scale with font size: `shadow_offset = max(3, font_size // 36)`, `shadow_blur = max(2, font_size // 48)`. Shadow color is a dark tinted version of the text color: `max(40, c // 6)` per channel.

### 6.5 Width overflow and scrolling

After measuring the total rendered width of all runs, if `total_w + PADDING_X * 2 > config.width` the image is rendered at full width (`canvas_w = total_w + PADDING_X * 2`) and returned. The daemon detects `img.width > base_config.width` and initiates scroll animation. Horizontal alignment is forced to `left` for wide images since centering a scrolling line makes no sense.

### 6.6 Identify frame

`render_identify(display_id, config)` renders `Display #N` in amber (`#FFA000`) using the same pipeline with `halign="center"`.

### 6.7 Blank frame

`render_blank(config)` returns a solid black RGB image. Used on startup, after `clear`, and on auto-clear.

---

## 7. Matrix Backends

### 7.1 HDMI monitor backend (`display/matrix_sim.py`)

Used in Docker (the primary production path for HDMI monitors) and on macOS. Creates a Pygame window that renders the caption output. With `PIXEL_SIZE=1` and `PIXEL_GAP=0` (the Docker defaults) every pixel maps 1:1 to a screen pixel, producing a clean text-on-black display. With larger pixel/gap values the output mimics the dot-matrix look of an LED matrix — useful for visual testing.

**Pixel layout** (NumPy, no Python loops):
```python
cell = pixel_size + pixel_gap
H, W = panel_height, panel_width
frame = np.zeros((H * cell, W * cell, 3), dtype=np.uint8)
# Set LED squares
frame_4d = frame.reshape(H, cell, W, cell, 3)
frame_4d[:, :pixel_size, :, :pixel_size, :] = led_array[:, np.newaxis, :, np.newaxis, :]
surface = pygame.surfarray.make_surface(frame.transpose(1, 0, 2))
```

`render_frame()` calls `pygame.event.pump()` and returns `False` if `pygame.QUIT` is received, which causes the daemon to exit cleanly.

`set_image(img)` converts the PIL Image to a NumPy array and stores it; the next `render_frame()` call writes it to the Pygame surface.

### 7.2 Real hardware (`display/matrix_real.py`)

Wraps the C++ `rgbmatrix` Python bindings from `rpi-rgb-led-matrix`. The library:
- Uses hardware PWM for precise timing
- Bypasses the Linux framebuffer (requires root or `CAP_SYS_RAWIO`)
- Connects to HUB75 panels via GPIO

`set_image(img)` calls `matrix.SetImage(img.convert("RGB"))`. `set_brightness(level)` calls `matrix.brightness = level`.

GPIO conflict: the rpi-rgb-led-matrix PWM peripheral conflicts with the Pi's onboard audio PWM. `pi_setup.sh` adds `dtparam=audio=off` to `/boot/firmware/config.txt` to resolve this.

---

## 8. Network Protocol

### Transport

ZeroMQ 6 PUB/SUB over TCP. The bridge binds the PUB socket; each display connects a SUB socket. ZMQ handles framing, reconnection, and flow control.

Subscribe filter: empty string (`""`) — each display receives all messages.

### Message format

All messages are JSON. The bridge adds `seq` (monotonically increasing integer) for ordering diagnostics.

```json
{ "cmd": "<command>", "seq": 42, ...fields }
```

### Command reference

#### `show`
```json
{
  "cmd": "show",
  "text": "She ain't doin' nuthin' to you.",
  "color": "#DCDCD2",
  "align": "left",
  "hold": false,
  "seq": 7
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `text` | string | — | Caption text, max 20 words |
| `color` | hex string | `#DCDCD2` | Text RGB color |
| `align` | `"left"` \| `"center"` \| `"right"` | `"left"` | Horizontal alignment |
| `hold` | boolean | `false` | Suppress 10 s auto-clear |

#### `preload`
Same fields as `show` (minus `hold`). The daemon renders the image immediately and caches it; when the matching `show` arrives, render time is zero.

#### `clear`
```json
{ "cmd": "clear", "seq": 8 }
```

#### `brightness`
```json
{ "cmd": "brightness", "level": 60, "seq": 9 }
```
`level` is clamped to 10–100 by the daemon.

#### `identify`
```json
{ "cmd": "identify", "id": 2, "seq": 10 }
```
If `id` is omitted, all displays flash. Flash duration is 2 seconds.

---

## 9. Docker Architecture

Docker is the primary runtime for both development and live shows. Each display container produces a browser-accessible URL that the operator (or the person at the display location) opens fullscreen on an HDMI monitor.

### How the HDMI monitor path works

```
display container
  └── Xvfb :99  (virtual X11 framebuffer, 1920×360 px)
        └── Pygame window  (caption daemon writes frames here)
              └── x11vnc  (reads Xvfb, serves VNC on :5900)
                    └── websockify  (wraps VNC in WebSocket)
                          └── noVNC HTML5 client  (port 6080)
                                └── Browser on HDMI monitor  ← audience sees this
```

The browser's noVNC client connects to the WebSocket, receives VNC frames, and renders them on a `<canvas>` element. The noVNC `resize=scale` parameter makes the canvas fill the browser window — so opening the URL fullscreen on any monitor at any resolution produces a clean full-screen display, regardless of whether the container's virtual framebuffer resolution matches the monitor.

### Containers

```
docker-compose.yml
├── bridge    ← Dockerfile.bridge
│   port 4000:3000  (operator browser)
│   port 5555:5555  (ZMQ PUB — also reachable from LAN for Pi displays)
│   env: NODE_ENV=production, ZMQ_ADDRESS=tcp://*:5555
│
├── display1  ← Dockerfile.display
│   port 6080:6080  (noVNC → open fullscreen on HDMI monitor)
│   env: DISPLAY_ID=1, CONTROLLER_ADDRESS=tcp://bridge:5555
│        PANEL_WIDTH=1920, PANEL_HEIGHT=360, FONT_SIZE=320
│        PIXEL_SIZE=1, PIXEL_GAP=0   ← 1:1 pixel mapping (no LED dot effect)
│
└── display2  ← Dockerfile.display
    port 6081:6080
    env: DISPLAY_ID=2, ...
```

### Bridge container (`Dockerfile.bridge`)

Built from `node:20-slim`. Installs `zeromq` native bindings, compiles TypeScript, and runs `node server.js`. Exposes ports 3000 (HTTP/WS) and 5555 (ZMQ). Port 5555 is published to the host so Raspberry Pi displays on the LAN can also connect.

A healthcheck polls `http://localhost:3000` every 5 seconds. Display containers declare `depends_on: bridge: condition: service_healthy` and will not start until the bridge is ready, preventing ZMQ connection races.

### Display container (`Dockerfile.display`)

Built from `python:3.11-slim`. Installs:
- System: `xvfb`, `x11vnc`, `novnc`, `websockify`, SDL2 libraries, `fonts-liberation`, `fonts-noto-color-emoji`
- Python: `pyzmq`, `Pillow`, `pygame`, `numpy`, `fonttools`

`display-entrypoint.sh` starts four processes in sequence:
1. **Xvfb :99** — virtual X11 framebuffer, sized to `PANEL_WIDTH × (PIXEL_SIZE + PIXEL_GAP)` by `PANEL_HEIGHT × (PIXEL_SIZE + PIXEL_GAP)`
2. **x11vnc** — VNC server on port 5900, no password, reads Xvfb :99
3. **websockify** — WebSocket-to-TCP proxy serving noVNC HTML5 client on port 6080
4. **python3 -u -m display.daemon** — caption display daemon (exec, becomes PID 1)

The Xvfb dimensions are computed from pixel/gap settings: `W = PANEL_WIDTH × (PIXEL_SIZE + PIXEL_GAP)`, `H = PANEL_HEIGHT × (PIXEL_SIZE + PIXEL_GAP)`. This ensures the pygame window exactly fills the virtual framebuffer, which VNC then transmits.

`PYTHONUNBUFFERED=1` and `python3 -u` are both set to prevent Python's 8 KB stdout buffer from delaying log output when stdout is a pipe (non-TTY, as in Docker).

`restart: unless-stopped` is set on display containers so they recover automatically from crashes.

---

## 10. Latency Budget

| Stage | Typical |
|---|---|
| Operator keypress → React `advance()` | < 1 ms |
| React → WebSocket send | < 2 ms |
| WebSocket → Node bridge recv | < 1 ms (loopback) |
| Node → ZeroMQ `pub.send()` | < 1 ms |
| ZeroMQ → Display Pi (WiFi) | 2–8 ms |
| Python ZMQ recv | < 1 ms |
| PIL `render_text()` (cache miss) | 2–5 ms |
| PIL `render_text()` (cache hit via preload) | ~0 ms |
| `matrix.set_image()` + frame swap | < 1 ms |
| **Total (cache miss)** | **~10–18 ms** |
| **Total (preload cache hit)** | **~8–14 ms** |

The preload command is sent one line ahead so render time is hidden behind the time it takes the operator to advance. In practice, nearly every `show` command is a cache hit.

---

## 11. Known Limitations

### Slow joiner

ZeroMQ PUB/SUB has no message buffering — messages published before a subscriber connects are silently dropped. If a display restarts mid-show, it shows blank until the next `show` command.

**Workaround:** Press `↑` then `↓` to re-send the current line. A future enhancement could add a ZMQ REQ/REP "state request" socket so reconnecting displays can pull the current line.

### Single controller

The bridge is designed for one operator. Multiple browser tabs can all connect and send commands — there is no locking. In practice, one stage manager runs the show.

### No script synchronization across tabs

Each browser tab maintains its own position in the script. If a second operator tab is open, it has an independent cursor. State is not broadcast from the bridge.

### Caption word limit

`render_text()` silently truncates to the first 20 words (`WORD_LIMIT = 20`). Scripts with long stage directions exceeding 20 words will be clipped. This is a safeguard against accidentally pushing walls of text to displays with finite pixels.

### Emoji font availability

Color emoji rendering requires `fonts-noto-color-emoji` to be installed. Docker display containers include it. The Raspberry Pi `pi_setup.sh` script does not currently install it — add it manually for Pi deployments: `sudo apt-get install fonts-noto-color-emoji fonttools`.

---

## 12. Directory Structure

```
caption-push/
├── controller/
│   ├── server.ts               # Node.js bridge server
│   ├── src/
│   │   ├── App.tsx             # Operator UI
│   │   ├── SimDisplay.tsx      # Live preview canvas component
│   │   ├── scriptParser.ts     # SRT + plaintext parser (browser)
│   │   ├── types.ts            # Shared TypeScript types
│   │   ├── App.css             # UI styles
│   │   └── main.tsx            # React entry point
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── display/
│   ├── daemon.py               # ZMQ SUB → render → matrix
│   ├── renderer.py             # Text/emoji → PIL Image
│   ├── matrix_sim.py           # Pygame renderer → Xvfb → noVNC → HDMI monitor
│   ├── matrix_real.py          # rpi-rgb-led-matrix wrapper (Pi + HUB75 only)
│   └── __init__.py
├── docker/
│   ├── Dockerfile.bridge       # Node bridge image
│   ├── Dockerfile.display      # Python display + Xvfb + VNC image
│   └── display-entrypoint.sh  # Container startup sequence
├── install/
│   ├── pi_setup.sh             # Pi provisioning (run once per Pi)
│   └── caption-display.service # systemd unit for Pi
├── scripts/
│   └── example.srt             # Sample caption script
├── docs/
│   ├── DESIGN.md               # This document
│   └── images/
│       └── operator-ui.png     # Operator console screenshot
├── docker-compose.yml
├── README.md
└── .gitignore
```

---

## 13. Development Setup (without Docker)

### macOS simulation

```bash
# Python deps
python3 -m pip install pyzmq Pillow pygame numpy fonttools

# Node deps
cd controller && npm install && cd ..

# Terminal 1: bridge server (dev mode, port 3001)
cd controller && npx tsx watch server.ts

# Terminal 2: display daemon 1
python3 -m display.daemon --id 1 --width 1920 --height 360 --font-size 320

# Terminal 3: display daemon 2
python3 -m display.daemon --id 2 --width 1920 --height 360 --font-size 320

# Terminal 4: Vite dev server
cd controller && npm run dev
# Opens http://localhost:5173
```

### Raspberry Pi deployment

See `install/pi_setup.sh` and the [README](../README.md#raspberry-pi-deployment).

---

## 14. Future Enhancements

- **Last-value cache on reconnect** — bridge re-sends current line to newly connected ZMQ subscribers via a REQ/REP companion socket
- **Auto-advance mode** — follow SRT timestamps automatically in rehearsal mode
- **Multi-line layout** — render two or more caption lines simultaneously
- **Wireless HDMI support docs** — guide for using wireless HDMI senders to reach display positions without running cables
- **Tablet operator UI** — responsive layout for iPad as a roaming console
- **Color cues in script** — per-character color coding in the plaintext format (e.g., `##COLOR #FF6600`)
- **Script position broadcast** — bridge pushes current script position to all tabs so a second observer tab stays in sync
- **Emoji on Pi** — add `fonts-noto-color-emoji` and `fonttools` to `pi_setup.sh`
