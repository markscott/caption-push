import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptionLine, ClientMessage, ServerMessage } from './types'
import { parseScript } from './scriptParser'

const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:3001/ws'
  : `ws://${window.location.host}/ws`

export default function App() {
  const [lines, setLines] = useState<CaptionLine[]>([])
  const [currentIdx, setCurrentIdx] = useState<number>(-1)
  const [brightness, setBrightness] = useState<number>(60)
  const [manualText, setManualText] = useState<string>('')
  const [connected, setConnected] = useState<boolean>(false)
  const [statusMsg, setStatusMsg] = useState<string>('No script loaded')

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

  // ---- Script navigation ----
  const showLine = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= lines.length) return
      send({ type: 'show', text: lines[idx].text })
      setCurrentIdx(idx)
      setStatusMsg(`Line ${idx + 1} of ${lines.length}`)
    },
    [lines, send]
  )

  const advance = useCallback(() => {
    const next = Math.min(currentIdx + 1, lines.length - 1)
    if (next !== currentIdx || currentIdx === -1) showLine(next === -1 ? 0 : next)
  }, [currentIdx, lines.length, showLine])

  const retreat = useCallback(() => {
    if (currentIdx > 0) showLine(currentIdx - 1)
  }, [currentIdx, showLine])

  const clearDisplay = useCallback(() => {
    send({ type: 'clear' })
    setStatusMsg('Display cleared')
  }, [send])

  // ---- Auto-scroll script list to current line ----
  useEffect(() => {
    if (currentIdx < 0 || !listRef.current) return
    const el = listRef.current.children[currentIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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

  // ---- Manual send ----
  function sendManual() {
    const text = manualText.trim()
    if (!text) return
    send({ type: 'show', text })
    setManualText('')
    setStatusMsg(`Manual: "${text}"`)
  }

  // ---- Derived display values ----
  const currentLine = currentIdx >= 0 ? lines[currentIdx] : null
  const nextLine = currentIdx + 1 < lines.length ? lines[currentIdx + 1] : null

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

        <button className="btn btn-secondary" onClick={clearDisplay}>
          Clear Display
        </button>

        <button className="btn btn-outline" onClick={() => send({ type: 'identify' })}>
          Identify All
        </button>

        <div className="brightness-control">
          <span>Brightness {brightness}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={brightness}
            onChange={handleBrightness}
          />
        </div>

        <div className={`conn-dot ${connected ? 'connected' : 'disconnected'}`}
             title={connected ? 'Bridge connected' : 'Bridge disconnected'} />
      </div>

      {/* ---- Script Panel ---- */}
      <div className="script-panel">
        <div className="script-panel-header">
          Script — {lines.length} lines
        </div>
        <div className="script-list" ref={listRef}>
          {lines.map((line, idx) => (
            <div
              key={line.index}
              className={`script-line ${
                idx === currentIdx ? 'current' : idx < currentIdx ? 'past' : ''
              }`}
              onClick={() => showLine(idx)}
            >
              <span className="line-num">{line.index}</span>
              <span>{line.text}</span>
            </div>
          ))}
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
          <div className={`current-text ${!currentLine ? 'empty' : ''}`}>
            {currentLine?.text ?? '—'}
          </div>
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
            placeholder="Type and press Enter to send manually…"
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendManual()}
          />
          <button className="btn btn-primary" onClick={sendManual}>
            Send
          </button>
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
