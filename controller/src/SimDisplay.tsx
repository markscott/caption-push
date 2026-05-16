import { useEffect, useRef, useState } from 'react'

// ---- Mirror display renderer + daemon constants exactly ----
const PANEL_W          = 1920
const PANEL_H          = 360
const FONT_SIZE        = 320           // matches FONT_SIZE in docker-compose.yml
const MIN_FONT_RATIO   = 0.60
const MIN_FONT_MARGIN  = 50            // px below ratio floor before scrolling
const PADDING_X        = 4             // panel px
const SCROLL_SPEED     = 300           // panel px / s
const SCROLL_DELAY_S   = 1.0
const AUTO_CLEAR_S     = 10.0
const WORD_LIMIT       = 20

// Intrinsic canvas resolution (half the real panel — crisp on retina via CSS scale)
const CW    = PANEL_W / 2              // 960
const CH    = PANEL_H / 2              // 180
const SCALE = CH / PANEL_H            // 0.5

// Derived canvas-space constants (all scaled to canvas px)
const C_MAX_FONT = Math.floor(FONT_SIZE * SCALE)              // 160
const C_MIN_FONT = Math.max(4, Math.floor((PANEL_H * MIN_FONT_RATIO - MIN_FONT_MARGIN) * SCALE))  // 83
const C_PAD_X    = PADDING_X * SCALE                          // 2
const C_MAX_TW   = CW - C_PAD_X * 2
const C_SPEED    = SCROLL_SPEED * SCALE                       // 150 canvas px / s

const FONT_FAMILY = 'CaptionFont'

// Inject @font-face CSS and return a promise that resolves when canvas can use the font.
// CSS injection is more reliable for canvas than the FontFace API on all browsers.
let fontReady: Promise<void> | null = null

function ensureFontLoaded(): Promise<void> {
  if (fontReady) return fontReady
  fontReady = (async () => {
    const style = document.createElement('style')
    style.textContent = `
      @font-face {
        font-family: '${FONT_FAMILY}';
        src: url('/fonts/LiberationSans-Bold.ttf') format('truetype');
        font-weight: bold;
        font-style: normal;
        font-display: block;
      }
    `
    document.head.appendChild(style)
    try {
      await document.fonts.load(`bold 100px '${FONT_FAMILY}'`)
      console.log('[SimDisplay] CaptionFont loaded')
    } catch (e) {
      console.warn('[SimDisplay] Font load failed, using fallback:', e)
    }
  })()
  return fontReady
}

interface Props {
  text: string | null
}

export function SimDisplay({ text }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number>(0)
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

    if (!text) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, CW, CH)
      return
    }

    const joined    = text.split(/\s+/).slice(0, WORD_LIMIT).join(' ')
    const startTime = performance.now()

    const fontStr = (sz: number) => `bold ${sz}px '${FONT_FAMILY}', Arial, sans-serif`

    // ---- Binary search: largest font where text fits in width (mirrors PIL _scale_to_fit_one) ----
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

    // Shadow params mirror PIL: shadow_offset=max(3,size//36), shadow_blur=max(2,size//48)
    const panelSize    = fontSize / SCALE
    const shadowOffset = Math.max(1.5, Math.floor(panelSize / 36) * SCALE)
    const shadowBlur   = Math.max(1,   Math.floor(panelSize / 48) * SCALE)

    let scrollStart: number | null = null
    let scrollEnd:   number | null = null

    function drawText(x: number, y: number) {
      ctx.save()
      ctx.shadowColor   = '#282828'
      ctx.shadowBlur    = shadowBlur * 2
      ctx.shadowOffsetX = shadowOffset
      ctx.shadowOffsetY = shadowOffset
      ctx.fillStyle = '#282828'
      ctx.fillText(joined, x, y)
      ctx.restore()
      ctx.fillStyle = '#ffffff'
      ctx.fillText(joined, x, y)
    }

    function draw(now: number) {
      const elapsed = (now - startTime) / 1000

      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, CW, CH)

      if (!needsScroll && elapsed >= AUTO_CLEAR_S) return
      if (scrollEnd !== null && (now - scrollEnd) / 1000 >= AUTO_CLEAR_S) return

      ctx.font = fontStr(fontSize)

      if (!needsScroll || maxOff <= 0) {
        drawText((CW - textW) / 2, baseY)
      } else {
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
        drawText(C_PAD_X - offset, baseY)
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
