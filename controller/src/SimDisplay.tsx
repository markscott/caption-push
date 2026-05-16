import { useEffect, useRef, useState } from 'react'

// ---- Mirror display renderer + daemon constants exactly ----
const PANEL_W          = 1920
const PANEL_H          = 360
const MIN_FONT_RATIO   = 0.60
const MIN_FONT_MARGIN  = 50          // px below ratio floor before scrolling
const PADDING_X        = 4           // panel px
const SCROLL_SPEED     = 300         // panel px / s
const SCROLL_DELAY_S   = 1.0
const AUTO_CLEAR_S     = 10.0
const WORD_LIMIT       = 20

// Intrinsic canvas resolution (half the real panel — crisp on retina via CSS scale)
const CW    = PANEL_W / 2            // 960
const CH    = PANEL_H / 2            // 180
const SCALE = CH / PANEL_H           // 0.5

// Derived canvas-space constants
const C_MIN_FONT = Math.max(4, Math.floor((PANEL_H * MIN_FONT_RATIO - MIN_FONT_MARGIN) * SCALE))
const C_MAX_FONT = Math.floor(PANEL_H * SCALE)
const C_PAD_X    = PADDING_X * SCALE
const C_MAX_TW   = CW - C_PAD_X * 2
const C_SPEED    = SCROLL_SPEED * SCALE   // canvas px / s

const FONT_FAMILY = 'CaptionFont'
const FONT_URL    = '/fonts/LiberationSans-Bold.ttf'

// Load the font once at module level; track readiness via a promise
let fontReady: Promise<void> | null = null

function ensureFontLoaded(): Promise<void> {
  if (fontReady) return fontReady
  fontReady = (async () => {
    try {
      const face = new FontFace(FONT_FAMILY, `url(${FONT_URL})`)
      await face.load()
      document.fonts.add(face)
    } catch {
      // Font unavailable (dev without bridge) — fall back to system-ui
    }
  })()
  return fontReady
}

interface Props {
  text: string | null
}

export function SimDisplay({ text }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const rafRef     = useRef<number>(0)
  const [fontLoaded, setFontLoaded] = useState(false)

  useEffect(() => {
    ensureFontLoaded().then(() => setFontLoaded(true))
  }, [])

  useEffect(() => {
    if (!fontLoaded) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    cancelAnimationFrame(rafRef.current)

    // Black when nothing is showing
    if (!text) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, CW, CH)
      return
    }

    const joined    = text.split(/\s+/).slice(0, WORD_LIMIT).join(' ')
    const startTime = performance.now()

    const fontStr = (sz: number) => `bold ${sz}px '${FONT_FAMILY}', system-ui, Arial, sans-serif`

    // ---- Binary search: largest font where text fits in width ----
    let lo = 4, hi = C_MAX_FONT, fittedSize = lo
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      ctx.font = fontStr(mid)
      if (ctx.measureText(joined).width <= C_MAX_TW) { fittedSize = mid; lo = mid + 1 }
      else hi = mid - 1
    }

    const needsScroll = fittedSize < C_MIN_FONT
    const fontSize    = needsScroll ? C_MIN_FONT : fittedSize
    ctx.font = fontStr(fontSize)

    const textW   = ctx.measureText(joined).width
    const m       = ctx.measureText(joined)
    const ascent  = m.actualBoundingBoxAscent  ?? fontSize * 0.8
    const descent = m.actualBoundingBoxDescent ?? fontSize * 0.2
    const baseY   = (CH - (ascent + descent)) / 2 + ascent
    const maxOff  = Math.max(0, textW + C_PAD_X * 2 - CW)

    let scrollStart: number | null = null
    let scrollEnd:   number | null = null

    function draw(now: number) {
      const elapsed = (now - startTime) / 1000

      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, CW, CH)

      // Auto-clear mirrors daemon timing
      if (!needsScroll && elapsed >= AUTO_CLEAR_S) return
      if (scrollEnd !== null && (now - scrollEnd) / 1000 >= AUTO_CLEAR_S) return

      ctx.font      = fontStr(fontSize)
      ctx.fillStyle = '#dcdcd2'

      if (!needsScroll || maxOff <= 0) {
        // Static — centered
        ctx.fillText(joined, (CW - textW) / 2, baseY)
      } else {
        // Scroll
        let offset = 0
        if (scrollStart === null) {
          if (elapsed >= SCROLL_DELAY_S) scrollStart = now
        } else {
          offset = Math.min(C_SPEED * (now - scrollStart) / 1000, maxOff)
          if (offset >= maxOff && scrollEnd === null) scrollEnd = now
        }
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, CW, CH)
        ctx.clip()
        ctx.fillText(joined, C_PAD_X - offset, baseY)
        ctx.restore()
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [text, fontLoaded])

  return (
    <canvas
      ref={canvasRef}
      width={CW}
      height={CH}
      className="sim-display"
    />
  )
}
