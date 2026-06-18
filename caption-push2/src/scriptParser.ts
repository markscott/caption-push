import type { CaptionLine } from './types.js';

export function parseScript(filename: string, content: string): CaptionLine[] {
  if (filename.toLowerCase().endsWith('.srt')) {
    return parseSrt(content);
  }
  return parsePlaintext(content);
}

function parseSrt(content: string): CaptionLine[] {
  const blocks = content.trim().split(/\n\n+/);
  const lines: CaptionLine[] = [];

  for (const block of blocks) {
    const parts = block.trim().split('\n');
    if (parts.length < 3) continue;

    const index = parseInt(parts[0]?.trim() ?? '', 10);
    if (isNaN(index)) continue;

    const timeMatch = parts[1]?.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    const startMs = timeMatch ? srtToMs(timeMatch[1] ?? '') : undefined;
    const endMs   = timeMatch ? srtToMs(timeMatch[2] ?? '') : undefined;
    const text = parts.slice(2).join(' ').trim();

    lines.push({ index, text, startMs, endMs, sceneId: 0 });
  }

  return lines;
}

function parsePlaintext(content: string): CaptionLine[] {
  let sceneId = 0;
  let lineIndex = 0;
  return content
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(text => {
      const isMetadata = text.startsWith('##');
      if (/^##SCENE\b/i.test(text)) sceneId++;
      return { index: ++lineIndex, text, isMetadata, sceneId };
    });
}

function srtToMs(time: string): number {
  const [h = '0', m = '0', rest = '0,0'] = time.split(':');
  const [s = '0', ms = '0'] = rest.split(',');
  return (
    parseInt(h)  * 3_600_000 +
    parseInt(m)  *    60_000 +
    parseInt(s)  *     1_000 +
    parseInt(ms)
  );
}
