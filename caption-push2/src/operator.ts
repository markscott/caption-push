import type { CaptionLine, CaptionStyle, ChannelMessage, HistoryEntry, Preset } from './types.js';
import { DEFAULT_PRESETS, DEFAULT_STYLE, SPEED_STOPS, DEFAULT_SPEED_IDX } from './types.js';
import { onMessage, sendMessage } from './channel.js';
import { parseScript } from './scriptParser.js';

const PRESETS_KEY = 'caption_push2_presets';
const HISTORY_KEY = 'caption_push2_history';
const STYLE_KEY   = 'caption_push2_style';
const MAX_HISTORY = 30;

export function initOperator(): void {
  document.title = 'Caption Push 2 — Operator';

  // ── Persistence ───────────────────────────────────────────────────────────

  function loadStyle(): CaptionStyle {
    try {
      const raw = localStorage.getItem(STYLE_KEY);
      return raw ? { ...DEFAULT_STYLE, ...(JSON.parse(raw) as Partial<CaptionStyle>) } : { ...DEFAULT_STYLE };
    } catch { return { ...DEFAULT_STYLE }; }
  }
  function saveStyle(s: CaptionStyle): void { localStorage.setItem(STYLE_KEY, JSON.stringify(s)); }

  function loadPresets(): Preset[] {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      return raw ? (JSON.parse(raw) as Preset[]) : [...DEFAULT_PRESETS];
    } catch { return [...DEFAULT_PRESETS]; }
  }
  function savePresets(p: Preset[]): void { localStorage.setItem(PRESETS_KEY, JSON.stringify(p)); }

  function loadHistory(): HistoryEntry[] {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    } catch { return []; }
  }
  function saveHistory(h: HistoryEntry[]): void {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, MAX_HISTORY)));
  }

  // ── State ─────────────────────────────────────────────────────────────────

  let captionStyle  = loadStyle();
  let presets       = loadPresets();
  let history       = loadHistory();
  let lines: CaptionLine[] = [];
  let currentIdx    = -1;
  let brightness    = 100;
  let speedIdx      = DEFAULT_SPEED_IDX;
  let numDisplays   = 2;
  let statusMsg     = 'No script loaded';
  let displayedText: string | null = null;
  let displayedHold = false;
  let collapsedScenes = new Set<number>();

  const connectedAt  = new Map<number, number>();
  const openWindows  = new Map<number, Window | null>();

  // ── CSS (matching original caption-push theme exactly) ────────────────────

  const css = document.createElement('style');
  css.textContent = `
    :root {
      --bg:      #0f0f17;
      --panel:   #16162a;
      --surface: #1e1e36;
      --accent:  #e94560;
      --accent2: #0f3460;
      --text:    #eaeaf8;
      --dim:     #7070a0;
      --current: #1a2a5e;
      --border:  #2a2a50;
      --green:   #2ecc71;
      --yellow:  #f39c12;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
    }

    /* ── App grid ── */
    .app {
      display: grid;
      grid-template-rows: auto 1fr auto;
      grid-template-columns: 320px 1fr;
      grid-template-areas: "toolbar toolbar" "script main" "status status";
      height: 100vh;
    }

    /* ── Toolbar ── */
    .toolbar {
      grid-area: toolbar;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
    }
    .toolbar h1 {
      font-size: 14px;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-right: 8px;
      white-space: nowrap;
    }
    .btn {
      padding: 6px 14px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: opacity 0.15s;
      white-space: nowrap;
    }
    .btn:hover { opacity: 0.85; }
    .btn:active { opacity: 0.65; }
    .btn-primary   { background: var(--accent);   color: #fff; }
    .btn-secondary { background: var(--surface);  color: var(--text); }
    .btn-outline   { background: transparent; color: var(--dim); border: 1px solid var(--border); }
    .btn-small     { padding: 4px 10px; font-size: 12px; }

    .slider-control {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--dim);
      font-size: 12px;
    }
    .slider-control input[type=range] {
      accent-color: var(--accent);
      cursor: pointer;
    }
    .brightness-control { margin-left: auto; }
    .brightness-control input { width: 90px; }
    .speed-control input { width: 130px; }

    .disp-dots {
      display: flex;
      gap: 5px;
      align-items: center;
      margin-left: 6px;
    }
    .disp-dot-wrap {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      color: var(--dim);
      cursor: pointer;
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #333;
      transition: background 0.3s;
    }
    .dot.on { background: var(--green); }
    .btn-add-disp {
      background: transparent;
      border: 1px dashed var(--border);
      border-radius: 4px;
      color: var(--dim);
      padding: 4px 9px;
      font-size: 11px;
      cursor: pointer;
    }
    .btn-add-disp:hover { color: var(--text); border-color: var(--dim); }

    /* ── Script panel ── */
    .script-panel {
      grid-area: script;
      background: var(--panel);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .script-panel-header {
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 700;
      color: var(--dim);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .scene-controls { display: flex; gap: 4px; }
    .scene-controls button {
      background: none;
      border: 1px solid var(--border);
      color: var(--dim);
      border-radius: 3px;
      padding: 1px 6px;
      font-size: 10px;
      cursor: pointer;
    }
    .scene-controls button:hover { color: var(--text); border-color: var(--dim); }

    .script-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }
    .script-list::-webkit-scrollbar { width: 4px; }
    .script-list::-webkit-scrollbar-track { background: transparent; }
    .script-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    .scene-group + .scene-group { border-top: 1px solid var(--border); }
    .scene-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--accent);
      cursor: pointer;
      user-select: none;
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 1;
    }
    .scene-header:hover { background: var(--surface); }
    .scene-header.collapsed { color: var(--dim); }
    .scene-chevron { font-size: 9px; flex-shrink: 0; }
    .scene-title   { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .script-line {
      display: flex;
      gap: 10px;
      padding: 7px 12px;
      cursor: pointer;
      border-left: 3px solid transparent;
      transition: background 0.08s;
      font-size: 13px;
      line-height: 1.4;
    }
    .script-line:hover { background: var(--surface); }
    .script-line.current { background: var(--current); border-left-color: var(--accent); }
    .script-line.past    { color: var(--dim); }
    .script-line.metadata {
      color: var(--yellow); font-size: 11px; font-style: italic;
      cursor: default; border-left-color: transparent !important; background: none !important;
    }
    .line-num {
      color: var(--dim); font-size: 11px; min-width: 26px;
      padding-top: 1px; font-variant-numeric: tabular-nums; flex-shrink: 0;
    }
    .script-line.current .line-num { color: var(--accent); }

    .script-empty {
      padding: 16px 12px;
      color: var(--dim);
      font-size: 13px;
    }

    /* ── Main area ── */
    .main-area {
      grid-area: main;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      overflow-x: hidden;
    }
    .main-area::-webkit-scrollbar { width: 4px; }
    .main-area::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    /* Now Showing */
    .now-showing {
      background: var(--current);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .section-label {
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--dim); margin-bottom: 8px;
    }
    .now-showing .section-label { padding: 8px 24px 4px; }
    /* Outer clip — height driven by JS to match scaled inner */
    #sim-display {
      width: 100%;
      overflow: hidden;
      position: relative;
      border-top: 1px solid #111;
    }
    /* 1920×360 reference surface — scaled down by JS transform */
    #sim-inner {
      width: 1920px;
      height: 360px;
      display: flex;
      align-items: center;
      justify-content: center;
      transform-origin: top left;
      background: #000;
      overflow: hidden;
      position: relative;
    }
    #sim-hold-badge {
      position: absolute;
      top: 12px;
      right: 12px;
      background: #e94560;
      color: #fff;
      font-size: 20px;
      font-family: monospace;
      padding: 4px 14px;
      border-radius: 4px;
      letter-spacing: 0.08em;
      display: none;
    }
    #sim-hold-badge.visible { display: block; }
    /* Wrapper for scroll — same as display.ts #caption-wrapper */
    #sim-wrapper {
      width: 100%;
      padding: 0 3rem;
      overflow: hidden;
    }
    /* Caption text — same defaults as display.ts #caption-text */
    #sim-caption {
      display: block;
      font-size: 2rem;
      text-align: center;
      font-family: Arial, sans-serif;
      color: #2a2a2a;
      line-height: 1.25;
      word-break: break-word;
      white-space: pre-wrap;
    }

    /* Next up */
    .next-up {
      background: var(--surface);
      padding: 12px 24px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .next-up .section-label { margin-bottom: 6px; }
    .next-text { font-size: 18px; color: var(--dim); line-height: 1.3; word-break: break-word; }

    /* Manual / caption entry */
    .caption-entry {
      padding: 12px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 8px;
      background: var(--panel);
      flex-shrink: 0;
    }
    .caption-entry input {
      flex: 1;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 15px;
      outline: none;
    }
    .caption-entry input:focus { border-color: var(--accent); }
    .caption-entry input::placeholder { color: var(--dim); }

    /* Style controls */
    .style-section {
      padding: 12px 24px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      flex-shrink: 0;
    }
    .style-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 20px;
      align-items: center;
    }
    .style-field {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .style-field label {
      font-size: 11px;
      color: var(--dim);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      white-space: nowrap;
    }
    .style-field input[type=range] {
      width: 80px;
      accent-color: var(--accent);
      cursor: pointer;
    }
    .style-field select {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      padding: 3px 6px;
      font-size: 12px;
      outline: none;
    }
    .style-field input[type=color] {
      width: 28px; height: 22px;
      border: 1px solid var(--border);
      border-radius: 3px;
      background: none;
      cursor: pointer;
      padding: 1px;
    }
    .style-val { font-size: 11px; color: var(--dim); font-family: monospace; min-width: 34px; }
    .btn-size-step {
      width: 22px; height: 22px;
      background: var(--surface); border: 1px solid var(--border); border-radius: 3px;
      color: var(--text); cursor: pointer; font-size: 14px; line-height: 1;
      flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      padding: 0;
    }
    .btn-size-step:hover { background: var(--current); border-color: var(--accent); }
    .align-grp { display: flex; gap: 2px; }
    .btn-align {
      padding: 2px 7px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 3px;
      color: var(--dim);
      cursor: pointer;
      font-size: 12px;
    }
    .btn-align.active { background: var(--accent); color: #fff; border-color: var(--accent); }

    /* Presets */
    .presets-section {
      padding: 10px 24px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      flex-shrink: 0;
    }
    .presets-hdr {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .preset-list { display: flex; flex-wrap: wrap; gap: 5px; }
    .preset-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .preset-chip:hover { background: var(--current); }
    .chip-del { color: var(--dim); cursor: pointer; padding: 0 2px; }
    .chip-del:hover { color: var(--accent); }

    /* Display launchers */
    .display-launchers {
      padding: 12px 24px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      flex-shrink: 0;
    }
    .launcher-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
    }
    .launcher-label { font-size: 13px; color: var(--text); min-width: 70px; }

    /* Keyboard hints */
    .kbd-hints {
      padding: 10px 24px;
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      background: var(--panel);
      flex-shrink: 0;
    }
    .kbd-hint {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--dim);
    }
    kbd {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 1px 6px;
      font-size: 11px;
      font-family: monospace;
      color: var(--text);
    }

    /* Status bar */
    .status-bar {
      grid-area: status;
      padding: 6px 14px;
      background: var(--panel);
      border-top: 1px solid var(--border);
      font-size: 12px;
      color: var(--dim);
      display: flex;
      justify-content: space-between;
    }
    .status-progress { color: var(--text); font-variant-numeric: tabular-nums; }

    /* Modal */
    .modal-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.75);
      display: flex; align-items: center; justify-content: center; z-index: 200;
    }
    .modal {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1.25rem; width: 300px;
      display: flex; flex-direction: column; gap: 0.65rem;
    }
    .modal h3 { font-size: 14px; color: var(--text); }
    .modal input[type=text] {
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      padding: 6px 10px; font-size: 13px; outline: none;
    }
    .modal input[type=text]:focus { border-color: var(--accent); }
    .modal-actions { display: flex; justify-content: flex-end; gap: 6px; }
    #speed-row-style { display: none; }
  `;
  document.head.appendChild(css);

  // ── DOM ───────────────────────────────────────────────────────────────────

  document.body.innerHTML = `
    <div class="app">
      <div class="toolbar">
        <h1>Caption Push 2</h1>

        <label class="btn btn-primary" style="cursor:pointer">
          Load Script
          <input type="file" id="file-input" accept=".srt,.txt" style="display:none">
        </label>

        <button class="btn btn-outline" id="btn-identify">Identify All</button>

        <div class="slider-control brightness-control">
          <span id="brightness-label">Brightness 100%</span>
          <input type="range" id="brightness" min="10" max="100" value="100">
        </div>

        <div class="slider-control speed-control">
          <span id="speed-label">Speed 1.0×</span>
          <input type="range" id="speed" min="0" max="${SPEED_STOPS.length - 1}" step="1" value="${DEFAULT_SPEED_IDX}">
        </div>

        <div class="disp-dots" id="disp-dots"></div>
        <button class="btn-add-disp" id="btn-add-disp">+ D</button>
      </div>

      <div class="script-panel">
        <div class="script-panel-header">
          <span id="script-count">Script — 0 lines</span>
          <span class="scene-controls" id="scene-controls" style="display:none">
            <button id="btn-collapse-all">▼ All</button>
          </span>
        </div>
        <div class="script-list" id="script-list">
          <div class="script-empty">Load a .srt or .txt script to begin.</div>
        </div>
      </div>

      <div class="main-area">
        <div class="now-showing">
          <div class="section-label">Now Showing</div>
          <div id="sim-display">
            <div id="sim-inner">
              <div id="sim-wrapper">
                <span id="sim-caption">—</span>
              </div>
              <div id="sim-hold-badge">HOLD</div>
            </div>
          </div>
        </div>

        <div class="next-up">
          <div class="section-label">Next</div>
          <div class="next-text" id="next-text">—</div>
        </div>

        <div class="caption-entry">
          <input type="text" id="manual-input" placeholder="Type and press Enter to send…">
          <button class="btn btn-primary" id="btn-send">Send</button>
          <button class="btn btn-primary" id="btn-send-hold">Send+Hold</button>
          <button class="btn btn-secondary" id="btn-clear">Clear</button>
        </div>

        <div class="style-section">
          <div class="section-label" style="margin-bottom:8px">Style</div>
          <div class="style-grid">
            <div class="style-field">
              <label>Size</label>
              <button class="btn-size-step" id="btn-font-dec" title="Decrease font size">−</button>
              <input type="range" id="font-size" min="50" max="500" value="300">
              <button class="btn-size-step" id="btn-font-inc" title="Increase font size">+</button>
              <span class="style-val" id="font-size-val">300px</span>
            </div>
            <div class="style-field">
              <label>Font</label>
              <select id="font-family">
                <option value="sans-serif">Sans-serif</option>
                <option value="serif">Serif</option>
                <option value="monospace">Monospace</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="Impact, sans-serif">Impact</option>
                <option value="'Times New Roman', serif">Times New Roman</option>
                <option value="'Georgia', serif">Georgia</option>
              </select>
            </div>
            <div class="style-field">
              <label>Text</label>
              <input type="color" id="text-color" value="#ffffff">
            </div>
            <div class="style-field">
              <label>BG</label>
              <input type="color" id="bg-color" value="#000000">
            </div>
            <div class="style-field">
              <label>Align</label>
              <div class="align-grp">
                <button class="btn-align" data-align="left">←</button>
                <button class="btn-align active" data-align="center">≡</button>
                <button class="btn-align" data-align="right">→</button>
              </div>
            </div>
            <div class="style-field">
              <label>Mode</label>
              <select id="display-mode">
                <option value="static">Static</option>
                <option value="scroll">Scroll</option>
                <option value="fade">Fade</option>
              </select>
            </div>
            <div class="style-field" id="speed-row-style">
              <label>Speed</label>
              <input type="range" id="scroll-speed" min="100" max="3000" value="800">
              <span class="style-val" id="scroll-speed-val">800</span>
            </div>
          </div>
        </div>

        <div class="presets-section">
          <div class="presets-hdr">
            <div class="section-label" style="margin:0">Presets</div>
            <button class="btn btn-outline btn-small" id="btn-add-preset">+ Add</button>
          </div>
          <div class="preset-list" id="preset-list"></div>
        </div>

        <div class="display-launchers">
          <div class="section-label">Display Windows</div>
          <div id="launcher-rows"></div>
        </div>

        <div class="kbd-hints">
          <div class="kbd-hint"><kbd>Space</kbd><kbd>↓</kbd> advance</div>
          <div class="kbd-hint"><kbd>↑</kbd> back</div>
          <div class="kbd-hint"><kbd>Esc</kbd> clear</div>
          <div class="kbd-hint"><kbd>Enter</kbd> send manual</div>
          <div class="kbd-hint"><kbd>Shift+Enter</kbd> send+hold</div>
          <div class="kbd-hint">click any line to jump</div>
        </div>
      </div>

      <div class="status-bar">
        <span id="status-msg">No script loaded</span>
        <span class="status-progress" id="status-progress"></span>
      </div>
    </div>
  `;

  // ── Element refs ──────────────────────────────────────────────────────────

  const fileInput      = document.getElementById('file-input') as HTMLInputElement;
  const scriptList     = document.getElementById('script-list')!;
  const scriptCount    = document.getElementById('script-count')!;
  const sceneControls  = document.getElementById('scene-controls') as HTMLElement;
  const btnCollapseAll = document.getElementById('btn-collapse-all')!;
  const simDisplay     = document.getElementById('sim-display')!;
  const simInner       = document.getElementById('sim-inner')!;
  const simWrapper     = document.getElementById('sim-wrapper')!;
  const simHoldBadge   = document.getElementById('sim-hold-badge')!;
  const simCaption     = document.getElementById('sim-caption')!;
  const nextTextEl     = document.getElementById('next-text')!;
  const manualInput    = document.getElementById('manual-input') as HTMLInputElement;
  const dispDots       = document.getElementById('disp-dots')!;
  const launcherRows   = document.getElementById('launcher-rows')!;
  const presetList     = document.getElementById('preset-list')!;
  const brightnessEl   = document.getElementById('brightness') as HTMLInputElement;
  const brightnessLabel = document.getElementById('brightness-label')!;
  const speedEl        = document.getElementById('speed') as HTMLInputElement;
  const speedLabel     = document.getElementById('speed-label')!;
  const fontSizeEl     = document.getElementById('font-size') as HTMLInputElement;
  const fontSizeVal    = document.getElementById('font-size-val')!;
  const fontFamilyEl   = document.getElementById('font-family') as HTMLSelectElement;
  const textColorEl    = document.getElementById('text-color') as HTMLInputElement;
  const bgColorEl      = document.getElementById('bg-color') as HTMLInputElement;
  const displayModeEl  = document.getElementById('display-mode') as HTMLSelectElement;
  const scrollSpeedEl  = document.getElementById('scroll-speed') as HTMLInputElement;
  const scrollSpeedVal = document.getElementById('scroll-speed-val')!;
  const speedRowStyle  = document.getElementById('speed-row-style')!;
  const statusMsgEl    = document.getElementById('status-msg')!;
  const statusProgress = document.getElementById('status-progress')!;

  // ── Script helpers ────────────────────────────────────────────────────────

  function sceneGroups(): { sceneId: number; entries: { line: CaptionLine; idx: number }[] }[] {
    const groups: { sceneId: number; entries: { line: CaptionLine; idx: number }[] }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const last = groups[groups.length - 1];
      if (!last || last.sceneId !== line.sceneId) {
        groups.push({ sceneId: line.sceneId, entries: [{ line, idx: i }] });
      } else {
        last.entries.push({ line, idx: i });
      }
    }
    return groups;
  }

  function nextDisplayable(): CaptionLine | null {
    let idx = currentIdx + 1;
    while (idx < lines.length && lines[idx]?.isMetadata) idx++;
    return idx < lines.length ? (lines[idx] ?? null) : null;
  }

  function setStatus(msg: string): void {
    statusMsg = msg;
    statusMsgEl.textContent = msg;
    if (lines.length > 0 && currentIdx >= 0) {
      statusProgress.textContent = `${currentIdx + 1} / ${lines.length}`;
    } else {
      statusProgress.textContent = '';
    }
  }

  function scrollToLine(idx: number): void {
    const el = scriptList.querySelector<HTMLElement>(`[data-line-idx="${idx}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ── Script rendering ──────────────────────────────────────────────────────

  function renderScript(): void {
    scriptList.innerHTML = '';
    scriptCount.textContent = `Script — ${lines.length} lines`;

    const groups = sceneGroups();
    const hasNamedScenes = groups.some(g => g.sceneId > 0);
    sceneControls.style.display = hasNamedScenes ? '' : 'none';

    if (lines.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'script-empty';
      empty.textContent = 'Load a .srt or .txt script to begin.';
      scriptList.appendChild(empty);
      return;
    }

    for (const { sceneId, entries } of groups) {
      const group = document.createElement('div');
      group.className = 'scene-group';

      if (sceneId > 0 && entries[0]) {
        const header = document.createElement('div');
        const isCollapsed = collapsedScenes.has(sceneId);
        header.className = `scene-header ${isCollapsed ? 'collapsed' : ''}`;
        const title = entries[0].line.text.replace(/^##SCENE[:\s]*/i, '').trim();
        header.innerHTML = `<span class="scene-chevron">${isCollapsed ? '▶' : '▼'}</span><span class="scene-title">${escHtml(title)}</span>`;
        header.addEventListener('click', () => {
          if (collapsedScenes.has(sceneId)) collapsedScenes.delete(sceneId);
          else collapsedScenes.add(sceneId);
          renderScript();
        });
        group.appendChild(header);
      }

      if (!collapsedScenes.has(sceneId)) {
        const bodyEntries = sceneId > 0 ? entries.slice(1) : entries;
        for (const { line, idx } of bodyEntries) {
          const div = document.createElement('div');
          const cls = line.isMetadata ? 'metadata' : idx === currentIdx ? 'current' : idx < currentIdx ? 'past' : '';
          div.className = `script-line ${cls}`;
          div.dataset['lineIdx'] = String(idx);
          div.innerHTML = `<span class="line-num">${line.index}</span><span>${escHtml(line.text)}</span>`;
          if (!line.isMetadata) {
            div.addEventListener('click', () => showLine(idx));
          }
          group.appendChild(div);
        }
      }

      scriptList.appendChild(group);
    }
  }

  function updateCollapseAllBtn(): void {
    const groups = sceneGroups().filter(g => g.sceneId > 0);
    const allCollapsed = groups.length > 0 && groups.every(g => collapsedScenes.has(g.sceneId));
    btnCollapseAll.textContent = allCollapsed ? '▶ All' : '▼ All';
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function showLine(idx: number): void {
    if (idx < 0 || idx >= lines.length) return;
    const line = lines[idx]!;
    if (!line.isMetadata) {
      sendCaption(line.text, 'all');
    }
    currentIdx = idx;
    // Expand the scene containing this line
    if (line.sceneId > 0) collapsedScenes.delete(line.sceneId);
    // Collapse the scene we left
    setStatus(`Line ${idx + 1} of ${lines.length}`);
    renderScript();
    updateNextUp();
    scrollToLine(idx);
  }

  function advance(): void {
    let next = currentIdx + 1;
    while (next < lines.length && lines[next]?.isMetadata) next++;
    if (next >= lines.length) return;
    const fromScene = currentIdx >= 0 ? (lines[currentIdx]?.sceneId ?? -1) : -1;
    const toScene   = lines[next]?.sceneId ?? 0;
    if (fromScene > 0 && fromScene !== toScene) collapsedScenes.add(fromScene);
    showLine(next);
  }

  function retreat(): void {
    let prev = currentIdx - 1;
    while (prev >= 0 && lines[prev]?.isMetadata) prev--;
    if (prev < 0) return;
    showLine(prev);
  }

  // ── Caption send ──────────────────────────────────────────────────────────

  let lastPushTime = 0;

  function sendCaption(text: string, targets: number[] | 'all', hold = false): void {
    lastPushTime = sendMessage({ type: 'PUSH_CAPTION', targets, text, style: captionStyle, hold });
    displayedText = text;
    displayedHold = hold;
    updateSimDisplay(lastPushTime);

    // History
    const entry: HistoryEntry = { text, timestamp: Date.now(), style: { ...captionStyle } };
    history = [entry, ...history.filter(h => h.text !== text)].slice(0, MAX_HISTORY);
    saveHistory(history);
  }

  function clearDisplay(): void {
    sendMessage({ type: 'CLEAR', targets: 'all' });
    displayedText = null;
    displayedHold = false;
    updateSimDisplay();
    setStatus('Display cleared');
  }

  function sendManual(hold = false): void {
    const text = manualInput.value.trim();
    if (!text) return;
    sendCaption(text, 'all', hold);
    manualInput.value = '';
    setStatus(hold ? `Hold: "${text}"` : `Manual: "${text}"`);
  }

  // ── Sim display — mirrors display.ts exactly, scaled to fit the panel ────

  const SIM_REF_W = 1920;
  const SIM_REF_H = 360;
  let simScrollRaf: number | null = null;
  let simAutoClearTimer: ReturnType<typeof setTimeout> | null = null;

  function simScaleToFit(): void {
    const scale = simDisplay.offsetWidth / SIM_REF_W;
    simInner.style.transform = `scale(${scale})`;
    simDisplay.style.height  = `${SIM_REF_H * scale}px`;
  }

  function simStopScroll(): void {
    if (simScrollRaf !== null) {
      cancelAnimationFrame(simScrollRaf);
      simScrollRaf = null;
    }
    if (simAutoClearTimer !== null) {
      clearTimeout(simAutoClearTimer);
      simAutoClearTimer = null;
    }
    simCaption.style.transform  = '';
    simCaption.style.whiteSpace = 'pre-wrap';
    simCaption.style.display    = 'block';
  }

  function updateSimDisplay(startTime = lastPushTime || Date.now()): void {
    simStopScroll();
    simHoldBadge.classList.toggle('visible', !!displayedText && displayedHold);

    if (!displayedText) {
      simInner.style.backgroundColor = '#000';
      simCaption.style.fontSize   = '2rem';
      simCaption.style.fontFamily = 'Arial, sans-serif';
      simCaption.style.color      = '#2a2a2a';
      simCaption.style.textAlign  = 'center';
      simCaption.style.opacity    = '1';
      simCaption.style.transition = '';
      simCaption.style.transform  = '';
      simCaption.style.whiteSpace = 'pre-wrap';
      simCaption.style.display    = 'block';
      simCaption.textContent      = '—';
      return;
    }

    const s = captionStyle;
    simInner.style.backgroundColor = s.backgroundColor;
    simCaption.style.fontSize   = `${s.fontSize}px`;
    simCaption.style.fontFamily = s.fontFamily;
    simCaption.style.color      = s.color;
    simCaption.style.textAlign  = s.textAlign;

    if (s.displayMode === 'fade') {
      simCaption.style.transition = 'opacity 0.15s ease';
      simCaption.style.opacity    = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        simCaption.textContent   = displayedText!;
        simCaption.style.opacity = '1';
      }));
      if (!displayedHold) simAutoClearTimer = setTimeout(() => { displayedText = null; displayedHold = false; updateSimDisplay(); }, 7000);
    } else if (s.displayMode === 'scroll') {
      simCaption.style.transition = '';
      simCaption.style.opacity    = '1';
      simCaption.textContent      = displayedText;
      simCaption.style.whiteSpace = 'nowrap';
      simCaption.style.display    = 'inline-block';
      simCaption.style.transform  = 'translateX(0)';

      // position:fixed probe — same fix as display.ts; Firefox constrains inline-block
      // offsetWidth to the nearest overflow:hidden BFC ancestor.
      const probe = document.createElement('span');
      probe.style.cssText = `position:fixed;top:-9999px;left:-9999px;white-space:nowrap;visibility:hidden;font-size:${s.fontSize}px;font-family:${s.fontFamily}`;
      probe.textContent = displayedText;
      document.body.appendChild(probe);
      const textW = probe.offsetWidth;
      document.body.removeChild(probe);

      // 0 3rem padding on a 1920px reference; hardcoded to match display.ts exactly
      const contentW = SIM_REF_W - 96;

      if (textW <= contentW) {
        // Text fits — static display
        simCaption.style.whiteSpace = 'pre-wrap';
        simCaption.style.display    = 'block';
        simCaption.style.transform  = '';
        if (!displayedHold) simAutoClearTimer = setTimeout(() => { displayedText = null; displayedHold = false; updateSimDisplay(); }, 7000);
      } else {
        // Same phase-based formula as display.ts — shared startTime keeps both frame-locked
        const overflowPx = textW - contentW + 40;
        const scrollDuration = overflowPx / s.scrollSpeed;
        const phaseDuration = 1.0 + scrollDuration + 5.0;

        function tick(): void {
          const elapsed = (Date.now() - startTime) / 1000;
          const phase = displayedHold ? elapsed % phaseDuration : elapsed;

          if (phase >= phaseDuration) {
            displayedText = null;
            displayedHold = false;
            updateSimDisplay();
            return;
          }
          if (phase < 1.0) {
            simCaption.style.transform = 'translateX(0)';
          } else if (phase < 1.0 + scrollDuration) {
            const scrolled = Math.min((phase - 1.0) * s.scrollSpeed, overflowPx);
            simCaption.style.transform = `translateX(${-scrolled}px)`;
          } else {
            simCaption.style.transform = `translateX(${-overflowPx}px)`;
          }
          simScrollRaf = requestAnimationFrame(tick);
        }
        simScrollRaf = requestAnimationFrame(tick);
      }
    } else {
      simCaption.style.transition = '';
      simCaption.style.opacity    = '1';
      simCaption.textContent      = displayedText;
      if (!displayedHold) simAutoClearTimer = setTimeout(() => { displayedText = null; displayedHold = false; updateSimDisplay(); }, 7000);
    }
  }

  function updateNextUp(): void {
    const next = nextDisplayable();
    nextTextEl.textContent = next?.text ?? (lines.length > 0 ? '(end of script)' : '—');
  }

  // ── Display buttons ───────────────────────────────────────────────────────

  function isConnected(id: number): boolean {
    const last = connectedAt.get(id);
    return last !== undefined && Date.now() - last < 7000;
  }

  function openDisplay(id: number, mode: 'test' | 'fullscreen'): void {
    const base = window.location.href.split('?')[0];
    const url  = `${base}?mode=display&id=${id}`;
    const existing = openWindows.get(id);
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    const features = mode === 'test'
      ? 'width=1920,height=360,menubar=no,toolbar=no,location=no,resizable=yes'
      : 'menubar=no,toolbar=no,location=no,resizable=yes';
    const win = window.open(url, `caption-display-${id}`, features);
    openWindows.set(id, win);
  }

  function renderDispDots(): void {
    dispDots.innerHTML = '';
    for (let i = 1; i <= numDisplays; i++) {
      const id = i;
      const wrap = document.createElement('div');
      wrap.className = 'disp-dot-wrap';
      wrap.title = `Click to open Display ${id}`;
      wrap.innerHTML = `<span class="dot ${isConnected(id) ? 'on' : ''}" id="dot-${id}"></span>D${id}`;
      wrap.addEventListener('click', () => openDisplay(id, 'test'));
      dispDots.appendChild(wrap);
    }
    renderLauncherRows();
  }

  function renderLauncherRows(): void {
    launcherRows.innerHTML = '';
    for (let i = 1; i <= numDisplays; i++) {
      const id = i;
      const row = document.createElement('div');
      row.className = 'launcher-row';
      row.innerHTML = `<span class="launcher-label">Display ${id}</span>`;
      const btnTest = document.createElement('button');
      btnTest.className = 'btn btn-outline btn-small';
      btnTest.textContent = 'Test Window';
      btnTest.addEventListener('click', () => openDisplay(id, 'test'));
      const btnFull = document.createElement('button');
      btnFull.className = 'btn btn-secondary btn-small';
      btnFull.textContent = 'Fullscreen';
      btnFull.addEventListener('click', () => openDisplay(id, 'fullscreen'));
      row.appendChild(btnTest);
      row.appendChild(btnFull);
      launcherRows.appendChild(row);
    }
  }

  function updateStatusDots(): void {
    for (let i = 1; i <= numDisplays; i++) {
      const dot = document.getElementById(`dot-${i}`);
      if (dot) dot.classList.toggle('on', isConnected(i));
    }
  }

  // ── Style controls ────────────────────────────────────────────────────────

  function readStyleFromUI(): void {
    const activeAlign = document.querySelector<HTMLElement>('.btn-align.active');
    captionStyle = {
      fontSize:        parseInt(fontSizeEl.value),
      fontFamily:      fontFamilyEl.value,
      color:           textColorEl.value,
      backgroundColor: bgColorEl.value,
      textAlign:       (activeAlign?.dataset['align'] ?? 'center') as CaptionStyle['textAlign'],
      displayMode:     displayModeEl.value as CaptionStyle['displayMode'],
      scrollSpeed:     parseInt(scrollSpeedEl.value),
    };
    saveStyle(captionStyle);
    // If something is currently showing, re-push it live so the display
    // windows immediately reflect the new style (font size, color, etc.).
    if (displayedText) {
      lastPushTime = sendMessage({ type: 'PUSH_CAPTION', targets: 'all', text: displayedText, style: captionStyle, hold: displayedHold });
    }
    updateSimDisplay(lastPushTime || Date.now());
  }

  function applyStyleToUI(): void {
    fontSizeEl.value = String(captionStyle.fontSize);
    fontSizeVal.textContent = `${captionStyle.fontSize}px`;
    fontFamilyEl.value = captionStyle.fontFamily;
    textColorEl.value = captionStyle.color;
    bgColorEl.value = captionStyle.backgroundColor;
    displayModeEl.value = captionStyle.displayMode;
    scrollSpeedEl.value = String(captionStyle.scrollSpeed);
    scrollSpeedVal.textContent = String(captionStyle.scrollSpeed);
    speedRowStyle.style.display = captionStyle.displayMode === 'scroll' ? '' : 'none';
    document.querySelectorAll<HTMLElement>('.btn-align').forEach(b => {
      b.classList.toggle('active', b.dataset['align'] === captionStyle.textAlign);
    });
  }

  // ── Presets ───────────────────────────────────────────────────────────────

  function renderPresets(): void {
    presetList.innerHTML = '';
    presets.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'preset-chip';
      chip.innerHTML = `<span>${escHtml(p.name)}</span><span class="chip-del" title="Delete">×</span>`;
      chip.querySelector('span:first-child')!.addEventListener('click', () => {
        sendCaption(p.text, 'all', true);
        setStatus(`Preset: "${p.name}"`);
      });
      chip.querySelector('.chip-del')!.addEventListener('click', e => {
        e.stopPropagation();
        presets = presets.filter(x => x.id !== p.id);
        savePresets(presets);
        renderPresets();
      });
      presetList.appendChild(chip);
    });
  }

  function showAddPresetModal(defaultText = ''): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>Add Preset</h3>
        <input type="text" id="modal-name" placeholder="Name">
        <input type="text" id="modal-text" placeholder="Caption text" value="${escAttr(defaultText)}">
        <div class="modal-actions">
          <button class="btn btn-outline" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const nameEl = overlay.querySelector<HTMLInputElement>('#modal-name')!;
    const textEl = overlay.querySelector<HTMLInputElement>('#modal-text')!;
    nameEl.focus();

    function save(): void {
      const name = nameEl.value.trim();
      const text = textEl.value.trim();
      if (!name || !text) return;
      presets = [...presets, { id: `p${Date.now()}`, name, text }];
      savePresets(presets);
      renderPresets();
      overlay.remove();
    }

    overlay.querySelector('#modal-save')!.addEventListener('click', save);
    overlay.querySelector('#modal-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') overlay.remove(); });
    textEl.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') overlay.remove(); });
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  fileInput.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseScript(file.name, ev.target?.result as string);
      lines = parsed;
      currentIdx = -1;
      collapsedScenes = new Set(parsed.map(l => l.sceneId).filter(id => id > 0));
      setStatus(`Loaded "${file.name}" — ${parsed.length} lines. Space / ↓ to advance.`);
      renderScript();
      updateNextUp();
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  document.getElementById('btn-identify')!.addEventListener('click', () => {
    sendMessage({ type: 'HEARTBEAT_REQ' });
    setStatus('Identifying displays…');
  });

  brightnessEl.addEventListener('input', () => {
    brightness = parseInt(brightnessEl.value);
    brightnessLabel.textContent = `Brightness ${brightness}%`;
    sendMessage({ type: 'BRIGHTNESS', targets: 'all', level: brightness });
  });

  speedEl.addEventListener('input', () => {
    speedIdx = parseInt(speedEl.value);
    const mult = SPEED_STOPS[speedIdx] ?? 1.0;
    speedLabel.textContent = `Speed ${mult.toFixed(1)}×`;
    // 1.0× = 800 px/s; 2.0× = 1600 px/s
    captionStyle = { ...captionStyle, scrollSpeed: Math.round(mult * 800) };
    saveStyle(captionStyle);
    scrollSpeedEl.value = String(captionStyle.scrollSpeed);
    scrollSpeedVal.textContent = String(captionStyle.scrollSpeed);
  });

  btnCollapseAll.addEventListener('click', () => {
    const named = sceneGroups().filter(g => g.sceneId > 0);
    const allCollapsed = named.every(g => collapsedScenes.has(g.sceneId));
    if (allCollapsed) {
      collapsedScenes.clear();
    } else {
      for (const g of named) collapsedScenes.add(g.sceneId);
    }
    renderScript();
    updateCollapseAllBtn();
  });

  document.getElementById('btn-send')!.addEventListener('click', () => sendManual(false));
  document.getElementById('btn-send-hold')!.addEventListener('click', () => sendManual(true));
  document.getElementById('btn-clear')!.addEventListener('click', clearDisplay);

  manualInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.shiftKey ? sendManual(true) : sendManual(); }
  });

  function stepFontSize(delta: number): void {
    const next = Math.min(500, Math.max(50, parseInt(fontSizeEl.value) + delta));
    fontSizeEl.value = String(next);
    fontSizeVal.textContent = `${next}px`;
    readStyleFromUI();
  }

  document.getElementById('btn-font-dec')!.addEventListener('click', () => stepFontSize(-10));
  document.getElementById('btn-font-inc')!.addEventListener('click', () => stepFontSize(10));
  fontSizeEl.addEventListener('input', () => { fontSizeVal.textContent = `${fontSizeEl.value}px`; readStyleFromUI(); });
  fontFamilyEl.addEventListener('change', readStyleFromUI);
  textColorEl.addEventListener('input', readStyleFromUI);
  bgColorEl.addEventListener('input', readStyleFromUI);
  displayModeEl.addEventListener('change', () => {
    speedRowStyle.style.display = displayModeEl.value === 'scroll' ? '' : 'none';
    readStyleFromUI();
  });
  scrollSpeedEl.addEventListener('input', () => { scrollSpeedVal.textContent = scrollSpeedEl.value; readStyleFromUI(); });
  document.querySelectorAll('.btn-align').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-align').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      readStyleFromUI();
    });
  });

  document.getElementById('btn-add-preset')!.addEventListener('click', () => {
    showAddPresetModal(manualInput.value.trim());
  });

  document.getElementById('btn-add-disp')!.addEventListener('click', () => {
    numDisplays++;
    renderDispDots();
  });

  // Global keyboard shortcuts (not captured when typing in manual input)
  window.addEventListener('keydown', e => {
    if (document.activeElement === manualInput) return;
    switch (e.key) {
      case ' ':
      case 'ArrowDown':
        e.preventDefault();
        advance();
        break;
      case 'ArrowUp':
        e.preventDefault();
        retreat();
        break;
      case 'Escape':
        clearDisplay();
        break;
    }
  });

  // ── Channel listener ──────────────────────────────────────────────────────

  onMessage((msg: ChannelMessage) => {
    if (msg.type === 'HEARTBEAT') {
      connectedAt.set(msg.displayId, msg.timestamp);
      updateStatusDots();
    }
  });

  setInterval(() => {
    sendMessage({ type: 'HEARTBEAT_REQ' });
    updateStatusDots();
  }, 3000);

  // ── Init ──────────────────────────────────────────────────────────────────

  applyStyleToUI();
  renderDispDots();
  renderPresets();
  setStatus(statusMsg);
  simScaleToFit();
  updateSimDisplay();
  updateNextUp();

  new ResizeObserver(simScaleToFit).observe(simDisplay);

  setTimeout(() => sendMessage({ type: 'HEARTBEAT_REQ' }), 500);
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
