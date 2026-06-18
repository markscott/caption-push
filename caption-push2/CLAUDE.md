# caption-push2

Server-free browser-based captioning system for community theater. All functionality is in a single self-contained HTML file — no server, no Docker, no install.

## Architecture

```
dist/caption-push2.html   ← single distributable file (zip and ship)
src/
  main.ts          URL param routing (?mode=operator | ?mode=display&id=N)
  operator.ts      Full operator UI — script nav, style controls, presets, history
  display.ts       Display window — full-screen caption renderer
  channel.ts       Dual-channel messaging: BroadcastChannel + localStorage fallback
  scriptParser.ts  Parses .srt and plaintext (##SCENE) scripts
  types.ts         Shared types and defaults
build.mjs          esbuild: TypeScript → single inlined HTML
template.html      HTML shell (bundle injected at <!-- BUNDLE -->)
```

## Communication

`channel.ts` uses two mechanisms simultaneously so it works everywhere:
1. **BroadcastChannel** — zero-latency, works on `http://` and on `file://` in Chrome/Edge/Firefox
2. **localStorage `storage` event** — fires in other tabs, universal file:// fallback (Safari)

Deduplication by timestamp prevents double-handling when both fire for the same message.

**Synchronization**: every `sendMessage()` returns the timestamp stamped on the message. Display windows and the operator's NOW SHOWING sim both use that same timestamp as the scroll animation origin, so scroll positions are frame-locked.

## Key behaviors

- **Live style updates**: changing any style control (font size, color, etc.) immediately re-pushes the current caption to all display windows — no need to re-send manually
- **Hold lock**: Send+Hold locks the display against future pushes until Clear is pressed; a red HOLD badge appears on the display
- **Font size range**: 50–500px; −/+ buttons step by 10px
- **Scroll speed**: 100–3000 px/s; default 800 px/s (1.0× on toolbar)
- **Brightness**: CSS `filter: brightness(N%)` applied to the display window's `<html>` element

## Defaults (can be overridden via saved localStorage)

| Setting | Default |
|---|---|
| Font | Arial, 300px |
| Colors | White on black |
| Align | Center |
| Mode | Static |
| Scroll speed | 800 px/s |

## Build

```bash
cd caption-push2
npm install
npm run build      # → dist/caption-push2.html
npm run dev        # watch mode (rebuilds on src/ changes)
```

## Distribution

```bash
zip caption-push2.zip dist/caption-push2.html
```

Recipient unzips and opens `caption-push2.html` in a browser.

## Cross-browser notes

| Browser | file:// | http:// |
|---|---|---|
| Chrome / Edge | ✅ full | ✅ full |
| Firefox | ✅ full | ✅ full |
| Safari | ⚠️ localStorage only (BroadcastChannel may not fire between file:// tabs) | ✅ full |

**Recommendation**: use `http://` for best compatibility. A one-liner from the `dist/` folder:
```bash
python3 -m http.server 8080
```
Then open `http://localhost:8080/caption-push2.html`.
