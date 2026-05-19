import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CaptionLine, ClientMessage, ServerMessage } from './types'
import { parseScript } from './scriptParser'
import { SimDisplay } from './SimDisplay'

const SPEED_STOPS = [0.2, 0.4, 0.6, 0.8, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]
const DEFAULT_SPEED_IDX = 4  // 1.0×

const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:3001/ws'
  : `ws://${window.location.host}/ws`

export default function App() {
  const [lines, setLines] = useState<CaptionLine[]>([])
  const [currentIdx, setCurrentIdx] = useState<number>(-1)
  const [brightness, setBrightness] = useState<number>(100)
  const [speedIdx, setSpeedIdx] = useState<number>(DEFAULT_SPEED_IDX)
  const [manualText, setManualText] = useState<string>('')
  const [connected, setConnected] = useState<boolean>(false)
  const [statusMsg, setStatusMsg] = useState<string>('No script loaded')
  const [displayedText, setDisplayedText] = useState<string | null>(null)
  const [collapsedScenes, setCollapsedScenes] = useState<Set<number>>(new Set())

  const wsRef = useRef<WebSocket | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const manualRef = useRef<HTMLInputElement>(null)

  // ---- WebSocket ----
  useEffect(() => {
    let ws: WebSocket
    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        reconnectTimer = setTimeout(connect, 2000)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage
        if (msg.type === 'error') {
          setStatusMsg(`Error: ${msg.message}`)
        }
      }
    }

    connect()
    return () => {
      clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [])

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  // ---- Scene grouping ----
  const sceneGroups = useMemo(() => {
    const groups: { sceneId: number; entries: { line: CaptionLine; idx: number }[] }[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const last = groups[groups.length - 1]
      if (!last || last.sceneId !== line.sceneId) {
        groups.push({ sceneId: line.sceneId, entries: [{ line, idx: i }] })
      } else {
        last.entries.push({ line, idx: i })
      }
    }
    return groups
  }, [lines])

  const toggleScene = useCallback((sceneId: number) => {
    setCollapsedScenes((prev) => {
      const next = new Set(prev)
      if (next.has(sceneId)) next.delete(sceneId)
      else next.add(sceneId)
      return next
    })
  }, [])

  // ---- Script navigation ----
  const showLine = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= lines.length) return
      const line = lines[idx]
      if (!line.isMetadata) {
        send({ type: 'show', text: line.text })
        setDisplayedText(line.text)
        // Preload the next displayable line so the display can render it in the background
        let nextIdx = idx + 1
        while (nextIdx < lines.length && lines[nextIdx].isMetadata) nextIdx++
        if (nextIdx < lines.length) {
          send({ type: 'preload', text: lines[nextIdx].text })
        }
      }
      setCurrentIdx(idx)
      setStatusMsg(`Line ${idx + 1} of ${lines.length}`)
      // Always ensure the target scene is expanded
      setCollapsedScenes((prev) => {
        if (!prev.has(line.sceneId)) return prev
        const s = new Set(prev)
        s.delete(line.sceneId)
        return s
      })
    },
    [lines, send]
  )

  const advance = useCallback(() => {
    let next = currentIdx + 1
    while (next < lines.length && lines[next].isMetadata) next++
    if (next >= lines.length) return
    // Collapse the scene we're leaving (showLine will expand the new one)
    const fromScene = currentIdx >= 0 ? lines[currentIdx].sceneId : -1
    const toScene = lines[next].sceneId
    if (fromScene >= 0 && fromScene !== toScene) {
      setCollapsedScenes((prev) => {
        const s = new Set(prev)
        s.add(fromScene)
        return s
      })
    }
    showLine(next)
  }, [currentIdx, lines, showLine])

  const retreat = useCallback(() => {
    let prev = currentIdx - 1
    while (prev >= 0 && lines[prev].isMetadata) prev--
    if (prev < 0) return
    showLine(prev)
  }, [currentIdx, lines, showLine])

  const clearDisplay = useCallback(() => {
    send({ type: 'clear' })
    setDisplayedText(null)
    setStatusMsg('Display cleared')
  }, [send])

  // ---- Auto-scroll script list to current line ----
  useEffect(() => {
    if (currentIdx < 0 || !listRef.current) return
    const el = listRef.current.querySelector(`[data-line-idx="${currentIdx}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentIdx])

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept when typing in manual entry
      if (document.activeElement === manualRef.current) return

      switch (e.key) {
        case ' ':
        case 'ArrowDown':
          e.preventDefault()
          advance()
          break
        case 'ArrowUp':
          e.preventDefault()
          retreat()
          break
        case 'Escape':
          clearDisplay()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, retreat, clearDisplay])

  // ---- File loading ----
  function handleFileLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const parsed = parseScript(file.name, ev.target?.result as string)
      setLines(parsed)
      setCurrentIdx(-1)
      setCollapsedScenes(new Set(parsed.map((l) => l.sceneId).filter((id) => id > 0)))
      setStatusMsg(`Loaded "${file.name}" — ${parsed.length} lines. Space / ↓ to advance.`)
    }
    reader.readAsText(file)
    // Reset input so the same file can be reloaded
    e.target.value = ''
  }

  // ---- Brightness ----
  function handleBrightness(e: React.ChangeEvent<HTMLInputElement>) {
    const level = parseInt(e.target.value)
    setBrightness(level)
    send({ type: 'brightness', level })
  }

  // ---- Scroll speed ----
  function handleSpeed(e: React.ChangeEvent<HTMLInputElement>) {
    const idx = parseInt(e.target.value)
    setSpeedIdx(idx)
    send({ type: 'speed', multiplier: SPEED_STOPS[idx] })
  }

  // ---- Manual send ----
  function sendManual(hold = false) {
    const text = manualText.trim()
    if (!text) return
    send({ type: 'show', text, hold })
    setManualText('')
    setDisplayedText(text)
    setStatusMsg(hold ? `Hold: "${text}"` : `Manual: "${text}"`)
  }

  // ---- Display window launcher ----
  function openDisplay(id: number, mode: 'test' | 'fullscreen') {
    const port = 6079 + id
    const base = `http://${window.location.hostname}:${port}/`
    const url = mode === 'fullscreen' ? `${base}?fullscreen` : base
    const features = mode === 'test'
      ? 'width=960,height=180,resizable=yes,scrollbars=no'
      : `width=${screen.width},height=${screen.height},left=0,top=0`
    window.open(url, `display${id}_${mode}`, features)
  }

  // ---- Derived display values ----
  const currentLine = currentIdx >= 0 ? lines[currentIdx] : null
  const nextLine = (() => {
    let idx = currentIdx + 1
    while (idx < lines.length && lines[idx].isMetadata) idx++
    return idx < lines.length ? lines[idx] : null
  })()

  return (
    <div className="app">
      {/* ---- Toolbar ---- */}
      <div className="toolbar">
        <h1>Caption Push</h1>

        <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
          Load Script
          <input
            type="file"
            accept=".srt,.txt"
            onChange={handleFileLoad}
            style={{ display: 'none' }}
          />
        </label>

        <button className="btn btn-outline" onClick={() => send({ type: 'identify' })}>
          Identify All
        </button>

        <div className="brightness-control">
          <span>Brightness {brightness}%</span>
          <input
            type="range"
            min={10}
            max={100}
            value={brightness}
            onChange={handleBrightness}
          />
        </div>

        <div className="speed-control">
          <span>Speed {SPEED_STOPS[speedIdx].toFixed(1)}×</span>
          <input
            type="range"
            min={0}
            max={SPEED_STOPS.length - 1}
            step={1}
            value={speedIdx}
            onChange={handleSpeed}
            list="speed-stops"
          />
          <datalist id="speed-stops">
            {SPEED_STOPS.map((_, i) => <option key={i} value={i} />)}
          </datalist>
        </div>

        <div className={`conn-dot ${connected ? 'connected' : 'disconnected'}`}
             title={connected ? 'Bridge connected' : 'Bridge disconnected'} />
      </div>

      {/* ---- Script Panel ---- */}
      <div className="script-panel">
        <div className="script-panel-header">
          <span>Script — {lines.length} lines</span>
          {sceneGroups.some((g) => g.sceneId > 0) && (() => {
            const named = sceneGroups.filter((g) => g.sceneId > 0)
            const allCollapsed = named.every((g) => collapsedScenes.has(g.sceneId))
            return (
              <span className="scene-controls">
                <button onClick={() =>
                  allCollapsed
                    ? setCollapsedScenes(new Set())
                    : setCollapsedScenes(new Set(named.map((g) => g.sceneId)))
                }>
                  {allCollapsed ? '▶' : '▼'} All
                </button>
              </span>
            )
          })()}
        </div>
        <div className="script-list" ref={listRef}>
          {sceneGroups.map(({ sceneId, entries }) => {
            const hasHeader = sceneId > 0
            const headerEntry = hasHeader ? entries[0] : null
            const bodyEntries = hasHeader ? entries.slice(1) : entries
            const isCollapsed = collapsedScenes.has(sceneId)
            const sceneTitle = headerEntry?.line.text.replace(/^##SCENE[:\s]*/i, '').trim() ?? ''
            return (
              <div key={sceneId} className="scene-group">
                {hasHeader && (
                  <div
                    className={`scene-header ${isCollapsed ? 'collapsed' : ''}`}
                    onClick={() => toggleScene(sceneId)}
                  >
                    <span className="scene-chevron">{isCollapsed ? '▶' : '▼'}</span>
                    <span className="scene-title">{sceneTitle}</span>
                  </div>
                )}
                {!isCollapsed && bodyEntries.map(({ line, idx }) => (
                  <div
                    key={line.index}
                    data-line-idx={idx}
                    className={`script-line ${line.isMetadata ? 'metadata' : idx === currentIdx ? 'current' : idx < currentIdx ? 'past' : ''}`}
                    onClick={() => !line.isMetadata && showLine(idx)}
                  >
                    <span className="line-num">{line.index}</span>
                    <span>{line.text}</span>
                  </div>
                ))}
              </div>
            )
          })}
          {lines.length === 0 && (
            <div style={{ padding: '16px 12px', color: 'var(--dim)', fontSize: 13 }}>
              Load a .srt or .txt script to begin.
            </div>
          )}
        </div>
      </div>

      {/* ---- Main Area ---- */}
      <div className="main-area">
        <div className="now-showing">
          <div className="section-label">Now Showing</div>
          <SimDisplay text={displayedText} />
        </div>

        <div className="next-up">
          <div className="section-label">Next</div>
          <div className="next-text">
            {nextLine?.text ?? (lines.length > 0 ? '(end of script)' : '—')}
          </div>
        </div>

        <div className="manual-entry">
          <input
            ref={manualRef}
            type="text"
            placeholder="Type and press Enter to send…"
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.shiftKey ? sendManual(true) : sendManual()
              }
            }}
          />
          <button className="btn btn-primary" onClick={() => sendManual()}>
            Send
          </button>
          <button className="btn btn-primary" onClick={() => sendManual(true)}>
            Send+Hold
          </button>
          <button className="btn btn-secondary" onClick={clearDisplay}>
            Clear
          </button>
        </div>

        <div className="display-launchers">
          <div className="section-label">Display Windows</div>
          {[1, 2].map(id => (
            <div key={id} className="display-launcher-row">
              <span className="display-launcher-label">Display {id}</span>
              <button className="btn btn-outline" onClick={() => openDisplay(id, 'test')}>
                Test Window
              </button>
              <button className="btn btn-secondary" onClick={() => openDisplay(id, 'fullscreen')}>
                Fullscreen
              </button>
            </div>
          ))}
        </div>

        <div className="kbd-hints">
          <div className="kbd-hint"><kbd>Space</kbd><kbd>↓</kbd> advance</div>
          <div className="kbd-hint"><kbd>↑</kbd> back</div>
          <div className="kbd-hint"><kbd>Esc</kbd> clear</div>
          <div className="kbd-hint"><kbd>Enter</kbd> send manual</div>
          <div className="kbd-hint">click any line to jump</div>
        </div>
      </div>

      {/* ---- Status Bar ---- */}
      <div className="status-bar">
        <span>{statusMsg}</span>
        {lines.length > 0 && currentIdx >= 0 && (
          <span className="progress">
            {currentIdx + 1} / {lines.length}
          </span>
        )}
      </div>
    </div>
  )
}
