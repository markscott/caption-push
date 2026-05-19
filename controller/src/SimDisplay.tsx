const CW = 960
const CH = 180

interface Props {
  text: string | null
}

export function SimDisplay({ text: _text }: Props) {
  return (
    <img
      src="/preview/stream"
      width={CW}
      height={CH}
      className="sim-display"
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
