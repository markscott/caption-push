from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class CaptionLine:
    index: int
    text: str
    start_ms: int | None = None
    end_ms: int | None = None


def load(path: Path) -> list[CaptionLine]:
    """Load a .srt or plain-text caption script."""
    if path.suffix.lower() == ".srt":
        return _load_srt(path)
    return _load_plaintext(path)


def _load_srt(path: Path) -> list[CaptionLine]:
    text = path.read_text(encoding="utf-8")
    blocks = re.split(r"\n\n+", text.strip())
    lines: list[CaptionLine] = []
    for block in blocks:
        parts = block.strip().splitlines()
        if len(parts) < 3:
            continue
        try:
            idx = int(parts[0].strip())
        except ValueError:
            continue
        time_match = re.match(
            r"(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})",
            parts[1],
        )
        start_ms = _srt_to_ms(time_match.group(1)) if time_match else None
        end_ms = _srt_to_ms(time_match.group(2)) if time_match else None
        caption_text = " ".join(parts[2:]).strip()
        lines.append(
            CaptionLine(index=idx, text=caption_text, start_ms=start_ms, end_ms=end_ms)
        )
    return lines


def _load_plaintext(path: Path) -> list[CaptionLine]:
    lines = []
    for i, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if line:
            lines.append(CaptionLine(index=i, text=line))
    return lines


def _srt_to_ms(time_str: str) -> int:
    h, m, rest = time_str.split(":")
    s, ms = rest.split(",")
    return int(h) * 3_600_000 + int(m) * 60_000 + int(s) * 1_000 + int(ms)
