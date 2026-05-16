import { useEffect, useRef } from 'react'

const CW = 960
const CH = 180
const POLL_MS = 100  // ~10fps preview

interface Props {
  text: string | null
}

export function SimDisplay({ text: _text }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, CW, CH)

    let running = true
    let timer = 0

    async function poll() {
      if (!running) return
      try {
        const res = await fetch(`/preview/frame?t=${Date.now()}`)
        if (res.ok && res.status !== 204) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const img = new Image()
          img.onload = () => {
            if (running) ctx.drawImage(img, 0, 0, CW, CH)
            URL.revokeObjectURL(url)
          }
          img.src = url
        }
      } catch {
        // display unavailable — keep showing last frame
      }
      if (running) timer = window.setTimeout(poll, POLL_MS)
    }

    poll()
    return () => { running = false; clearTimeout(timer) }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={CW}
      height={CH}
      className="sim-display"
    />
  )
}
