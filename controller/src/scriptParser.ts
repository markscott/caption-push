import type { CaptionLine } from './types'

export function parseScript(filename: string, content: string): CaptionLine[] {
  if (filename.toLowerCase().endsWith('.srt')) {
    return parseSrt(content)
  }
  return parsePlaintext(content)
}

function parseSrt(content: string): CaptionLine[] {
  const blocks = content.trim().split(/\n\n+/)
  const lines: CaptionLine[] = []

  for (const block of blocks) {
    const parts = block.trim().split('\n')
    if (parts.length < 3) continue

    const index = parseInt(parts[0].trim(), 10)
    if (isNaN(index)) continue

    const timeMatch = parts[1].match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
    )
    const startMs = timeMatch ? srtToMs(timeMatch[1]) : undefined
    const endMs = timeMatch ? srtToMs(timeMatch[2]) : undefined
    const text = parts.slice(2).join(' ').trim()

    lines.push({ index, text, startMs, endMs })
  }

  return lines
}

function parsePlaintext(content: string): CaptionLine[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text, i) => ({ index: i + 1, text }))
}

function srtToMs(time: string): number {
  const [h, m, rest] = time.split(':')
  const [s, ms] = rest.split(',')
  return (
    parseInt(h) * 3_600_000 +
    parseInt(m) * 60_000 +
    parseInt(s) * 1_000 +
    parseInt(ms)
  )
}
