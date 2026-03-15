# Caption Push — System Design

**Version:** 1.0
**Last updated:** 2026-03-14

---

## 1. Overview

Caption Push is a low-latency, networked captioning system for small community theaters.
An operator runs a browser-based console on any laptop; captions are pushed in real time
to HUB75 RGB LED matrix panels mounted at the front of the house, each driven by a
Raspberry Pi.

**Design goals:**
- ≤15 ms end-to-end latency (keypress → visible text on panel)
- All displays receive the same frame simultaneously (no sequential unicast)
- Operator UI is fast and keyboard-driven — no mouse required mid-show
- Hardware is cheap and replaceable (Pi Zero 2 W + commodity HUB75 panels)
- Simulation runs on macOS with no special hardware

---

## 2. Architecture

```
┌──────────────────────────────────────────┐
│           OPERATOR STATION               │
│  Browser (React)  ←WebSocket→            │
│  Node.js Bridge   ←ZeroMQ PUB→           │
│  port 5173 (dev) / 3000 (prod)           │
│  ZMQ PUB on tcp:5555                     │
└──────────────────┬───────────────────────┘
                   │  UDP/TCP  ZeroMQ PUB
                   │  broadcast to LAN
          ┌────────┴────────┐
          ▼                 ▼
  ┌──────────────┐  ┌──────────────┐
  │ Pi Display 1 │  │ Pi Display N │
  │ ZMQ SUB      │  │ ZMQ SUB      │
  │ Python daemon│  │ Python daemon│
  │ HUB75 panels │  │ HUB75 panels │
  └──────────────┘  └──────────────┘
```

### Component responsibilities

| Component | Language | Role |
|---|---|---|
| `controller/src/` | React + TypeScript | Operator UI (browser) |
| `controller/server.ts` | Node.js + TypeScript | WebSocket bridge + ZeroMQ PUB |
| `display/daemon.py` | Python | Subscribe + render to LED matrix |
| `display/renderer.py` | Python | Text → PIL Image |
| `display/matrix_sim.py` | Python | Pygame LED simulator (dev) |
| `display/matrix_real.py` | Python | rpi-rgb-led-matrix wrapper (Pi) |

---

## 3. Network Protocol

### Transport

ZeroMQ PUB/SUB over TCP. The controller's bridge server binds a PUB socket on port 5555.
Each display Pi connects a SUB socket to the controller's IP.

**Why ZeroMQ PUB/SUB:**
- All subscribers receive every message simultaneously — no per-display send loop
- ~1 ms local network latency
- Automatic reconnection on the subscriber side
- No ACK overhead; fire-and-forget semantics match caption delivery perfectly

### Message envelope

All messages are JSON strings. The `seq` field is a monotonically increasing integer
added by the bridge server for debugging and ordering.

```json
{ "cmd": "<command>", "seq": 42, ...fields }
```

### Commands

#### `show`
Display a line of text on all panels.

```json
{
  "cmd": "show",
  "text": "She never loved him.",
  "color": "#FFFFFF",
  "align": "center",
  "seq": 7
}
```

Fields:
| Field | Type | Default | Description |
|---|---|---|---|
| `text` | string | — | Caption text |
| `color` | hex string | `#FFFFFF` | Text color |
| `align` | `"center"` \| `"left"` \| `"right"` | `"center"` | Horizontal alignment |

#### `clear`
Blank all panels immediately.

```json
{ "cmd": "clear", "seq": 8 }
```

#### `brightness`
Set panel brightness (0–100). Takes effect on the next rendered frame.

```json
{ "cmd": "brightness", "level": 60, "seq": 9 }
```

#### `identify`
Flash amber text (`Display #N`) on panels to physically locate them.
If `id` is omitted, all displays flash. After 2 seconds the panel restores
its previous state automatically.

```json
{ "cmd": "identify", "id": 2, "seq": 10 }
```

---

## 4. Hardware

### Per display node

| Component | Recommendation | Notes |
|---|---|---|
| SBC | Raspberry Pi Zero 2 W | ~$15; 512 MB RAM, quad-core 1 GHz, built-in WiFi |
| LED panel | HUB75 64×32 RGB, P4 or P5 pitch | P4 readable at ~10 ft; P5 at 15 ft+ |
| HAT | Adafruit RGB Matrix Bonnet | Clean GPIO wiring; handles 2 chained panels |
| Power | 5 V 4 A PSU per panel | HUB75 panels can draw up to 3.5 A at full white |
| SD card | 16 GB A1 class | Use read-only rootfs to survive power cuts |

### Panel configuration

The default configuration chains **2 × 64×32 panels** for a total canvas of **128×32 px**,
giving one wide line of large text per display unit. For two lines of text, use
panels stacked vertically (64×64 total; chain via ribbon cable).

### GPIO conflict

The rpi-rgb-led-matrix library uses the Pi's hardware PWM for timing.
The onboard audio subsystem uses the same PWM peripheral.
**Disable onboard audio** by adding `dtparam=audio=off` to `/boot/firmware/config.txt`
before running the display daemon. The install script handles this automatically.

### Network

- Dedicated 2.4 GHz or 5 GHz access point recommended. Keep theater traffic on its
  own SSID/VLAN away from public WiFi.
- 5 GHz: lower latency, shorter range.
- 2.4 GHz: better wall penetration; adequate for most theater layouts.
- The operator station should be wired (or as close as possible) for reliability.

---

## 5. Software

### Operator UI (`controller/`)

React + TypeScript single-page app. Built with Vite.
Communicates with the bridge server via WebSocket (`/ws`).

**Key interactions:**
| Action | Result |
|---|---|
| `Space` / `↓` | Advance to next script line + push to displays |
| `↑` | Go back one line |
| `Esc` | Clear displays |
| Click any script line | Jump to that line |
| Manual entry `Enter` | Push arbitrary text immediately |
| Brightness slider | Live brightness adjustment |
| Load Script button | Load `.srt` or `.txt` from disk (parsed in-browser) |
| Identify All button | Flash all display panels to locate them |

**Script formats supported:**
- **SRT** (`.srt`) — standard subtitle format; timestamps are loaded but not auto-advanced
  (operator controls timing manually)
- **Plain text** (`.txt`) — one caption per line

### Bridge server (`controller/server.ts`)

Node.js with Express + `ws` (WebSocket) + `zeromq` v6.
Runs on port 3001 (dev) or 3000 (prod).
In production it also serves the Vite-built React bundle.

### Display daemon (`display/daemon.py`)

Python process running on each Pi (or Mac in sim mode).

Main loop (pseudocode):
```
connect ZMQ SUB socket to controller:5555
matrix.start()
loop:
    try:
        msg = socket.recv_json(timeout=16ms)   # 16ms → ~60fps poll rate
        handle(msg)                             # update matrix image
    except zmq.Again:
        pass                                    # no message this tick

    expire_identify_if_due()
    matrix.render_frame()                       # push frame to hardware/simulator
```

The 16 ms receive timeout doubles as the frame-render trigger, giving ~60 fps
display updates with no busy-waiting.

### Renderer (`display/renderer.py`)

Uses Pillow (`PIL`) to render text onto an `RGB` image sized to the panel canvas.
Font is loaded once per configuration change.
Returns a `PIL.Image.Image` which both `matrix_real.py` and `matrix_sim.py` accept.

**Font:** Pillow's built-in default (configurable via `--font-path`).
On Pi, BDF bitmap fonts from the rpi-rgb-led-matrix `fonts/` directory give
sharper rendering at small sizes and are recommended in production.

### Simulator (`display/matrix_sim.py`)

Pygame window that renders each LED pixel as a colored square with a gap,
replicating the look of a real HUB75 panel. Uses pure NumPy array operations
for efficient frame building — no Python pixel loops.

```
Numpy strategy:
  canvas (H, cell, W, cell, 3) = background fill
  canvas[:, :ps, :, :ps, :] = led_color[:, newaxis, :, newaxis, :]
  frame = canvas.reshape(H*cell, W*cell, 3)
  pygame.surfarray.make_surface(frame.T)
```

---

## 6. Latency Budget

| Stage | Typical |
|---|---|
| Operator keypress → WebSocket send | < 5 ms |
| WebSocket → Node bridge | < 2 ms (loopback) |
| Node → ZeroMQ PUB | < 1 ms |
| ZeroMQ → Display Pi (WiFi) | 2–8 ms |
| Python recv → PIL render | < 2 ms |
| Hardware frame swap (VSync) | < 1 ms |
| **Total** | **~10–15 ms** |

This is imperceptible to any audience member.

---

## 7. Known Limitations

### Slow joiner

ZeroMQ PUB/SUB drops messages sent before a subscriber connects (no buffering).
If a display Pi restarts mid-show, it will show a blank panel until the operator
advances to the next line or re-sends the current line.

**Workaround:** After a display restarts, the operator presses `↑` then `↓` to
re-send the current line. A future enhancement could add a REQ/REP "state
request" socket to handle this automatically.

### Single controller

Only one bridge server / operator console is designed for. A second browser tab
connecting to the same bridge will receive ACK echoes and can observe state,
but both tabs can send commands — there is no locking. Not a problem in practice
for a community theater with one stage manager.

### Font rendering at small sizes

Pillow's default proportional font may look rough at the 20 px size required to
fill a 32-row panel. For sharper text in production, use BDF bitmap fonts
from `/opt/rpi-rgb-led-matrix/fonts/` via `--font-path`.

---

## 8. Directory Structure

```
caption-push/
├── controller/                 # Operator console (Node.js + React)
│   ├── server.ts               # Express + WS bridge + ZeroMQ PUB
│   ├── src/
│   │   ├── App.tsx             # Main React component
│   │   ├── App.css             # Styles
│   │   ├── types.ts            # Shared TypeScript types
│   │   ├── scriptParser.ts     # SRT + plaintext parser (browser-side)
│   │   └── main.tsx            # React entry point
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── index.html
├── display/                    # Pi display daemon (Python)
│   ├── daemon.py               # Main loop: ZMQ SUB + render
│   ├── renderer.py             # Text → PIL Image
│   ├── matrix_sim.py           # Pygame simulator (macOS dev)
│   ├── matrix_real.py          # rpi-rgb-led-matrix wrapper (Pi)
│   └── __init__.py
├── install/
│   ├── pi_setup.sh             # One-shot Pi provisioning script
│   └── caption-display.service # systemd unit file
├── scripts/
│   └── example.srt             # Sample caption script (Hamlet)
├── config/
│   └── display.toml            # Default configuration reference
├── docs/
│   └── DESIGN.md               # This document
├── requirements.txt            # Python deps (Mac dev)
├── sim.sh                      # Launch full simulation on macOS
└── .gitignore
```

---

## 9. Development Setup

### macOS simulation

```bash
# 1. Install Python deps
python3 -m pip install pyzmq Pillow pygame numpy

# 2. Install Node deps
cd controller && npm install && cd ..

# 3. Run everything
bash sim.sh
```

This opens:
- Two pygame windows simulating Display #1 and #2
- The Node bridge server (port 3001)
- The Vite dev server (port 5173)
- Your browser at `http://localhost:5173`

Load `scripts/example.srt` in the browser and press Space to advance captions.

### Pi deployment

```bash
# On each Pi (set vars for your network):
CONTROLLER_IP=192.168.1.100 DISPLAY_ID=1 bash install/pi_setup.sh

# Reboot, then start:
sudo systemctl start caption-display.service
sudo journalctl -fu caption-display.service   # watch logs
```

---

## 10. Future Enhancements

- **Auto-advance mode**: follow SRT timestamps automatically (rehearsal mode)
- **Multi-line layout**: render two caption lines simultaneously (64×64 stacked panels)
- **Last-value cache**: bridge re-sends current line to reconnecting displays
- **BDF font support**: sharper rendering via rpi-rgb-led-matrix bitmap fonts
- **Color cues**: per-character or per-line color coding for different speakers
- **Tablet UI**: responsive layout for iPad as operator console
