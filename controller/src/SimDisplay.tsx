import { useEffect, useRef } from 'react'

interface Props {
  text: string | null
}

// Shows the actual PIL-rendered frame from the display daemon via MJPEG stream.
// Pixel-perfect: same font, same sizing, same animation timing as the real display.
export function SimDisplay({ text: _text }: Props) {
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const img = imgRef.current
    if (!img) return

    function connect() {
      if (imgRef.current) {
        imgRef.current.src = `/preview/stream?t=${Date.now()}`
      }
    }

    connect()

    // Reconnect if the stream drops (e.g. display container restarts)
    const onError = () => setTimeout(connect, 2000)
    img.addEventListener('error', onError)
    return () => {
      img.removeEventListener('error', onError)
      img.src = ''
    }
  }, [])

  return (
    <img
      ref={imgRef}
      className="sim-display"
      alt="display preview"
    />
  )
}
