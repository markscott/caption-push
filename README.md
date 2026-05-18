# Caption Push

Real-time captioning for live theater. An operator pushes script lines to RGB LED panels mounted in the house — all displays update simultaneously in under 15 ms.

![Operator UI](docs/images/operator-ui.png)

---

## How it works

A browser-based operator console runs on any laptop. The operator advances through a pre-loaded script using the keyboard, and each line is broadcast over the local network to one or more display units. Each display unit is either a Raspberry Pi driving physical HUB75 LED matrix panels, or a simulated display running in Docker for testing.

```
Operator Browser → WebSocket → Node Bridge → ZeroMQ PUB → Display Pi(s)
```

---

## Quick Start (Docker Desktop)

Docker Desktop is the recommended way to run Caption Push for development, testing, and single-machine demos.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Mac or Windows)
- A modern browser (Chrome, Firefox, Safari)

### 1. Clone the repository

```bash
git clone https://github.com/markscott/caption-push.git
cd caption-push
```

### 2. Build and start

```bash
docker compose up --build -d
```

This builds three containers and starts them in the background:
- **bridge** — operator UI + WebSocket server + ZeroMQ publisher (port 4000)
- **display1** — simulated LED display #1 with noVNC viewer (port 6080)
- **display2** — simulated LED display #2 with noVNC viewer (port 6081)

The first build takes a few minutes. Subsequent starts are fast.

### 3. Open the operator console

```
http://localhost:4000
```

### 4. Open the simulated displays

Open these in separate browser tabs or windows — ideally on a second monitor:

- **Display 1:** http://localhost:6080
- **Display 2:** http://localhost:6081

Both pages auto-connect and scale to fill the browser window. Click "Fullscreen" or use the browser's fullscreen shortcut for a clean view.

### 5. Load a script and start pushing captions

1. Click **Load Script** in the toolbar
2. Select any `.srt` or `.txt` file (see [Script Format](#script-format) below)
3. Press **Space** or **↓** to send the first line to all displays
4. Keep pressing **Space** to advance through the script

### 6. Stop

```bash
docker compose down
```

---

## Operator UI Reference

### Toolbar

| Control | Action |
|---|---|
| **Load Script** | Open a `.srt` or `.txt` caption file |
| **Identify All** | Flash each display panel with its number for 2 seconds |
| **Brightness slider** | Adjust display brightness (10–100%) live |
| **Green/red dot** | WebSocket connection status (green = connected) |

### Script panel (left)

The script panel shows the full script organized by scene. The current line is highlighted. Past lines are dimmed.

- **Click any line** to jump to it and push it immediately
- **Scene headers** (e.g., `ONE`) are collapsible — click to expand/collapse
- `##CHARACTER` and `##STAGE` lines appear in the script but are never sent to displays

### Now Showing / Next

The **Now Showing** panel renders a live pixel-accurate preview of what is on the displays right now. **Next** shows the upcoming line so the operator can anticipate cue timing.

### Manual entry

Type any text and press **Enter** (or click **Send**) to push it immediately outside the script flow. Useful for unscripted announcements.

**Send+Hold** (`Shift+Enter` or the button) pushes text and suppresses the 10-second auto-clear, so it stays on screen until explicitly cleared.

### Display Windows

Opens a noVNC viewer for Display 1 or Display 2 in a new browser window. Use **Test Window** for a small monitoring view, **Fullscreen** for a window sized to the full screen.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` or `↓` | Advance to next script line |
| `↑` | Go back one line |
| `Esc` | Clear all displays |
| `Enter` | Send manual entry |
| `Shift+Enter` | Send manual entry with hold |

---

## Script Format

### Plain text (`.txt`) — recommended

One caption line per non-`##` line. Special `##` markers structure the script for the operator but are never sent to displays.

```
##SCENE ONE
##STAGE (Lights rise on the orphanage dormitory.)

##CHARACTER MOLLY SAYS:
Mama! Mama! Mommy!

##CHARACTER PEPPER SAYS:
Shut up!

##STAGE (PEPPER shoves MOLLY to the floor.)

##CHARACTER JULY SAYS:
She ain't doin' nuthin' to you.
```

**`##` marker types:**

| Marker | Appearance in UI | Sent to display? |
|---|---|---|
| `##SCENE <title>` | Bold scene header, collapsible | No |
| `##CHARACTER <name>` | Amber italic | No |
| `##STAGE <description>` | Red italic | No |
| Any other `##` line | Dimmed metadata | No |

### SRT (`.srt`)

Standard subtitle format. Timestamps are parsed and shown but the operator controls timing manually — Caption Push does not auto-advance.

```
1
00:00:01,000 --> 00:00:03,500
She ain't doin' nuthin' to you.

2
00:00:04,000 --> 00:00:06,000
No, you're keeping us awake.
```

---

## Raspberry Pi Deployment

For a real show, each display is a Raspberry Pi connected to HUB75 LED matrix panels. The operator laptop and all Pis must be on the same network.

### Hardware per display unit

| Part | Notes |
|---|---|
| Raspberry Pi Zero 2 W | ~$15; enough power for two chained 64×32 panels |
| HUB75 64×32 RGB panel × 2 | P4 pitch readable at 10 ft, P5 at 15 ft+ |
| Adafruit RGB Matrix Bonnet | Clean GPIO wiring for HUB75 |
| 5 V 4 A power supply per panel | Panels draw up to 3.5 A at full white |
| 16 GB microSD (A1 class) | Use read-only root for power-cut resilience |

### Network setup

- Dedicated 2.4 GHz or 5 GHz access point recommended
- Keep theater traffic on its own SSID away from public WiFi
- Wire the operator laptop if possible — Pi WiFi latency is 2–8 ms, fine for captions

### Provisioning a Pi

Run the setup script once per Pi. Set `CONTROLLER_IP` to the IP of the laptop running the bridge.

```bash
# On the Pi — run from the caption-push repo directory
CONTROLLER_IP=192.168.1.100 DISPLAY_ID=1 bash install/pi_setup.sh

sudo reboot
```

The script:
1. Disables onboard audio (it shares a PWM peripheral with the HUB75 driver)
2. Installs Python deps (`pyzmq`, `Pillow`, `numpy`)
3. Builds and installs `rpi-rgb-led-matrix`
4. Installs a systemd service that starts the display daemon on boot

### Starting the bridge (on the operator laptop)

In production you still run the bridge via Docker (or Node directly):

```bash
# Docker (recommended)
docker compose up bridge -d

# Or Node directly (requires npm install in controller/)
cd controller && node server.js
```

### Checking display status

```bash
# On Pi — watch live logs
sudo journalctl -fu caption-display.service

# Identify display #1 physically (flash its number for 2 seconds)
# Use the "Identify All" button in the operator UI
```

### Adjusting panel configuration

Edit `/opt/caption-push/display.env` on the Pi and restart the service:

```bash
CONTROLLER_IP=192.168.1.100
DISPLAY_ID=2
PANEL_WIDTH=128     # total pixel width (panel_width × chain_length)
PANEL_HEIGHT=32     # total pixel height
FONT_SIZE=24
```

---

## Troubleshooting

### Displays show nothing after sending a line

1. Check the bridge logs: `docker compose logs bridge`
2. Check display logs: `docker compose logs display1`
3. Confirm the green dot in the operator UI toolbar is lit — if not, the WebSocket is down
4. Click **Identify All** — if displays flash their numbers, ZeroMQ is working and only the `show` command failed

### Display panel goes blank mid-show

ZeroMQ PUB/SUB drops messages sent before a subscriber is connected (no buffering). If a display restarts, it will show blank until the next line is sent. Press `↑` then `↓` to re-send the current line.

### `docker compose up` fails to build

```bash
# Force a full rebuild (clears the Docker layer cache)
docker compose build --no-cache
docker compose up -d
```

### Fonts look wrong or text is clipped

The display daemon sizes the font to fill the panel height. If you change `PANEL_HEIGHT`, also adjust `FONT_SIZE` proportionally. The default configuration uses a 320 px font on a 360 px tall panel.

### noVNC page is blank or "Connecting…"

The display container may still be starting up. Wait 10–15 seconds and refresh. If it persists: `docker compose restart display1`

### Pi display daemon crashes at startup

Almost always an audio PWM conflict. Confirm `/boot/firmware/config.txt` contains `dtparam=audio=off` and reboot.

---

## Project Structure

```
caption-push/
├── controller/                 # Operator console
│   ├── server.ts               # Node.js: Express + WebSocket + ZeroMQ PUB
│   └── src/
│       ├── App.tsx             # React operator UI
│       ├── SimDisplay.tsx      # Live preview canvas in operator UI
│       ├── scriptParser.ts     # SRT + plaintext parser (browser-side)
│       └── types.ts            # Shared TypeScript types
├── display/                    # Display daemon (Python)
│   ├── daemon.py               # Main loop: ZMQ SUB → render → matrix
│   ├── renderer.py             # Text + emoji → PIL Image
│   ├── matrix_sim.py           # Pygame LED simulator (dev/Docker)
│   └── matrix_real.py          # rpi-rgb-led-matrix wrapper (Pi)
├── docker/
│   ├── Dockerfile.bridge       # Node bridge container
│   ├── Dockerfile.display      # Python display + Xvfb + VNC container
│   └── display-entrypoint.sh   # Container startup: Xvfb → VNC → daemon
├── install/
│   ├── pi_setup.sh             # One-shot Pi provisioning script
│   └── caption-display.service # systemd unit
├── scripts/                    # Example caption scripts
├── docs/
│   ├── DESIGN.md               # Architecture and design reference
│   └── images/
└── docker-compose.yml
```

---

## License

MIT
