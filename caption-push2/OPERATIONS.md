# Caption Push 2 — Installation & Operations Guide

## What you need

- A laptop running **Chrome**, **Edge**, or **Firefox** (Safari supported on `http://`, limited on `file://`)
- The file `caption-push2.html`
- One or more monitors/projectors connected to the laptop for display windows

---

## Quick Start (simplest setup)

1. Copy `caption-push2.html` to the laptop
2. Open it in Chrome → this is the **Operator window**
3. Click **Display 1** in the toolbar → a new window opens for the first display
4. Drag that window to the appropriate monitor and press **F** for fullscreen
5. Type a caption in the text box and press **Enter** (or click **Send**)

That's it. No internet, no install, no server needed.

---

## Recommended Setup (works on all browsers, best performance)

Run a local web server from the folder containing `caption-push2.html`:

```bash
python3 -m http.server 8080
```

Then open:
- **Operator**: `http://localhost:8080/caption-push2.html`
- **Display 1**: `http://localhost:8080/caption-push2.html?mode=display&id=1`
- **Display 2**: `http://localhost:8080/caption-push2.html?mode=display&id=2`

Display windows can be opened directly from the Operator toolbar instead of typing the URL manually.

---

## Opening Display Windows

Click **Display 1** or **Display 2** in the operator toolbar.  
- If the window is already open, it focuses it.  
- Click **Test Window** (small) or **Fullscreen** under *Display Windows* to choose size.  
- Press **F** inside any display window to toggle fullscreen.  
- Click **+ D** to add a third (or more) display.

---

## Sending Captions

### Manual entry
Type in the text box → press **Enter** or click **Send**.

### Script file
1. Click **Load Script** → select a `.srt` or `.txt` file
2. Press **Space** or **↓** to advance to the next line
3. Press **↑** to go back
4. Click any line in the script panel to jump directly to it
5. Scene headings (`##SCENE Act Two`) group lines and can be collapsed

### Presets
Click any preset chip to immediately send that caption to all displays.  
Click **+ Add** to save the current typed text as a new preset.  
Click **×** on a chip to delete it.  
Presets persist across sessions (stored in browser localStorage).

### Send + Hold
Locks the display. Future sends are ignored until **Clear** is pressed.  
A red **HOLD** badge appears on the display window.  
Use for important notices that must not be accidentally overwritten.

---

## Keyboard Shortcuts (Operator)

| Key | Action |
|---|---|
| `Space` / `↓` | Advance to next script line |
| `↑` | Go back one script line |
| `Esc` | Clear all displays |
| `Enter` | Send typed text |
| `Shift+Enter` | Send typed text and hold |
| `F` (in display window) | Toggle fullscreen |

---

## Style Controls

All style changes **immediately update the displays** while text is showing — no need to re-send.

| Control | Range | Default |
|---|---|---|
| Font size | 50–500 px | 300 px |
| Font | Arial, Impact, Times, etc. | Arial |
| Text color | Any color | White |
| Background | Any color | Black |
| Align | Left / Center / Right | Center |
| Mode | Static / Scroll / Fade | Static |
| Scroll speed | 100–3000 px/s | 800 px/s |

Use the **−** and **+** buttons next to the size slider to step by 10px.

The **Brightness** slider (toolbar, 10–100%) dims all displays — useful during scene changes.

The **Speed** slider (toolbar) scales the scroll speed (0.2× – 5.0×).

---

## NOW SHOWING Panel

The NOW SHOWING panel in the operator is a **pixel-accurate miniature** of what the audience sees:
- Same font, size, color, and background
- Scroll animation runs in real time, frame-locked with the actual display windows

Use it to verify appearance without looking away from the operator screen.

---

## Script File Formats

### SRT (`.srt`)
Standard subtitle format. Timecodes are ignored; lines are navigated manually.
```
1
00:00:01,000 --> 00:00:04,000
Welcome to the show

2
00:00:05,000 --> 00:00:08,000
Please silence your phones
```

### Plaintext (`.txt`)
One caption per line. Use `##SCENE` to create collapsible scene sections.
```
##SCENE Act One
Welcome to the show
Please silence your phones

##SCENE Act Two
The second act begins
Curtain call
```

Lines starting with `##` are shown to the operator but never sent to the display.

---

## Multi-Display Setup

Each display window is independent and can be targeted individually:
- **Push to All** — sends to every open display
- **→ D1**, **→ D2** — sends to a specific display only
- Green dot in toolbar = display is connected (heartbeat every 3 seconds)

To use more than 2 displays, click **+ D** in the toolbar.

---

## Troubleshooting

**Display not updating**  
- Check the dot next to the display button — grey means disconnected  
- Reload the display window; it will re-connect automatically  
- Make sure both windows are open in the same browser (not one in Chrome, one in Safari)

**Scroll too slow/fast**  
- Adjust the Speed slider in the toolbar (scales 0.2×–5.0×)  
- Or adjust the Scroll Speed slider directly in the Style section

**Captions not persisting between sessions**  
- Presets and style settings are stored in the browser's `localStorage`  
- Clearing browser data will reset them to defaults

**Safari on file://: display not updating**  
- Safari restricts `localStorage` events between `file://` tabs  
- Fix: serve via `python3 -m http.server 8080` and use `http://localhost:8080/caption-push2.html`

**Fullscreen not working on macOS**  
- Press `F` inside the display window (not the operator)  
- macOS may prompt to allow fullscreen for the browser — click Allow
