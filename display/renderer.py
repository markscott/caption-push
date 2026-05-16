from __future__ import annotations

import os
import unicodedata
from dataclasses import dataclass, field, replace
from functools import lru_cache

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

_LIBERATION_BOLD  = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
_NOTO_EMOJI       = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"
_DEFAULT_FONT_PATH = os.environ.get("FONT_PATH", _LIBERATION_BOLD)

LINE_SPACING       = 4      # px between lines (kept for render_identify)
PADDING_X          = 4      # px horizontal padding
WORD_LIMIT         = 20     # words beyond this are dropped
MIN_FONT_RATIO     = 0.60
MIN_FONT_MARGIN_PX = 25



@dataclass
class RenderConfig:
    width: int = 128
    height: int = 64
    font_path: str = field(default_factory=lambda: _DEFAULT_FONT_PATH)
    font_size: int = 24
    color: tuple[int, int, int] = field(default_factory=lambda: (220, 220, 210))
    halign: str = "left"
    valign: str = "center"
    max_lines: int = 2  # kept for API compatibility


def _load_font(config: RenderConfig) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    import pathlib
    path = pathlib.Path(config.font_path)
    if path.exists():
        return ImageFont.truetype(str(path), config.font_size)
    try:
        return ImageFont.load_default(size=config.font_size)
    except TypeError:
        return ImageFont.load_default()


@lru_cache(maxsize=None)
def _covered_codepoints(font_path: str) -> frozenset[int]:
    if not os.path.exists(font_path):
        return frozenset()
    try:
        from fontTools.ttLib import TTFont
        cmap = TTFont(font_path, lazy=True).getBestCmap()
        return frozenset(cmap.keys() if cmap else [])
    except Exception:
        return frozenset(range(0x110000))


def _text_runs(text: str, primary_path: str) -> list[tuple[str, str]]:
    """Split text into (substring, font_path) runs based on glyph coverage.

    Combining marks and ZWJ/variation selectors are kept with their base char.
    """
    if not os.path.exists(_NOTO_EMOJI):
        return [(text, primary_path)]

    primary_cp = _covered_codepoints(primary_path)
    runs: list[tuple[str, str]] = []
    i = 0
    while i < len(text):
        j = i + 1
        while j < len(text):
            cp_j = ord(text[j])
            cat = unicodedata.category(text[j])
            if cat.startswith('M') or cat == 'Cf' or 0xFE00 <= cp_j <= 0xFE0F:
                j += 1
            else:
                break
        seq = text[i:j]
        fp = primary_path if ord(text[i]) in primary_cp else _NOTO_EMOJI
        if runs and runs[-1][1] == fp:
            runs[-1] = (runs[-1][0] + seq, fp)
        else:
            runs.append((seq, fp))
        i = j
    return runs


@lru_cache(maxsize=1)
def _emoji_strikes() -> tuple[int, ...]:
    """Return sorted CBDT bitmap strike ppem values from NotoColorEmoji."""
    if not os.path.exists(_NOTO_EMOJI):
        return (64,)
    try:
        from fontTools.ttLib import TTFont
        f = TTFont(_NOTO_EMOJI)
        sizes = sorted(s.bitmapSizeTable.ppemX for s in f['CBLC'].strikes)
        return tuple(sizes) if sizes else (64,)
    except Exception:
        return (64,)


def _snap_emoji_size(target: int) -> int:
    """Return the nearest available CBDT bitmap strike for the given target size."""
    strikes = _emoji_strikes()
    # Prefer largest strike <= target; if none, use smallest available
    best = strikes[0]
    for s in strikes:
        if s <= target:
            best = s
    return best


def _render_emoji_patch(seg: str, target_h: int) -> Image.Image:
    """Render an emoji sequence scaled to target_h pixels tall (RGBA)."""
    strike = _snap_emoji_size(target_h)
    font = ImageFont.truetype(_NOTO_EMOJI, strike)
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    bb = probe.textbbox((0, 0), seg, font=font, embedded_color=True)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    if w <= 0 or h <= 0:
        return Image.new("RGBA", (0, target_h))
    tmp = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(tmp).text((-bb[0], -bb[1]), seg, font=font, embedded_color=True)
    scale = target_h / h
    new_w = max(1, round(w * scale))
    return tmp.resize((new_w, target_h), Image.LANCZOS)


def render_text(text: str, config: RenderConfig) -> Image.Image:
    """Render text to an RGB image.

    Returns a wide image (width > config.width) when text doesn't fit;
    caller is responsible for scrolling. Emoji are rendered in color via
    NotoColorEmoji when the font is available.
    """
    if not text:
        return Image.new("RGB", (config.width, config.height), (0, 0, 0))

    _probe_img = Image.new("RGBA", (1, 1))
    _probe = ImageDraw.Draw(_probe_img)

    joined = " ".join(text.split()[:WORD_LIMIT])
    fixed_size = max(8, int(config.height * MIN_FONT_RATIO) - MIN_FONT_MARGIN_PX)

    runs = _text_runs(joined, config.font_path)

    primary_font = (
        ImageFont.truetype(config.font_path, fixed_size)
        if os.path.exists(config.font_path)
        else ImageFont.load_default()
    )

    # Measure total width and line height (drive layout from primary font metrics)
    ref_bb = _probe.textbbox((0, 0), "Ag", font=primary_font)
    line_h = ref_bb[3] - ref_bb[1]

    total_w = 0
    for seg, fp in runs:
        if fp == _NOTO_EMOJI:
            patch = _render_emoji_patch(seg, line_h)
            total_w += patch.width
        else:
            bb = _probe.textbbox((0, 0), seg, font=primary_font)
            total_w += bb[2] - bb[0]

    if total_w + PADDING_X * 2 > config.width:
        canvas_w = total_w + PADDING_X * 2
        render_config = replace(config, width=canvas_w, halign="left")
    else:
        canvas_w = config.width
        render_config = config

    # Vertical origin: top of line_h block, vertically centered/aligned
    if render_config.valign == "center":
        y_top = (config.height - line_h) // 2
    elif render_config.valign == "bottom":
        y_top = config.height - line_h - 2
    else:
        y_top = 2
    # PIL textbbox y offsets can be negative; adjust so text sits at y_top
    y_draw = y_top - ref_bb[1]

    # Starting X
    if render_config.halign == "center":
        x = max(0, (canvas_w - total_w) // 2)
    elif render_config.halign == "right":
        x = max(0, canvas_w - total_w - PADDING_X)
    else:
        x = PADDING_X

    shadow_offset = max(3, fixed_size // 36)
    shadow_blur   = max(2, fixed_size // 48)
    shadow_color  = tuple(max(40, c // 6) for c in config.color)

    canvas = Image.new("RGBA", (canvas_w, config.height), (0, 0, 0, 255))

    # Shadow pass (text-only runs)
    shadow_layer = Image.new("RGB", (canvas_w, config.height), (0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    sx = x
    for seg, fp in runs:
        if fp == _NOTO_EMOJI:
            patch = _render_emoji_patch(seg, line_h)
            sx += patch.width
        else:
            bb = _probe.textbbox((0, 0), seg, font=primary_font)
            sd.text((sx + shadow_offset, y_draw + shadow_offset), seg,
                    font=primary_font, fill=shadow_color)
            sx += bb[2] - bb[0]
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=shadow_blur))
    canvas = Image.alpha_composite(canvas, shadow_layer.convert("RGBA"))

    # Text + emoji pass
    cx = x
    for seg, fp in runs:
        if fp == _NOTO_EMOJI:
            patch = _render_emoji_patch(seg, line_h)
            # Composite color emoji patch at y_top
            canvas.paste(patch, (cx, y_top), patch)
            cx += patch.width
        else:
            bb = _probe.textbbox((0, 0), seg, font=primary_font)
            seg_w = bb[2] - bb[0]
            layer = Image.new("RGBA", (canvas_w, config.height), (0, 0, 0, 0))
            ImageDraw.Draw(layer).text((cx, y_draw), seg, font=primary_font,
                                       fill=(255, 255, 255, 255))
            canvas = Image.alpha_composite(canvas, layer)
            cx += seg_w

    return canvas.convert("RGB")


def render_blank(config: RenderConfig) -> Image.Image:
    return Image.new("RGB", (config.width, config.height), (0, 0, 0))


def render_identify(display_id: int, config: RenderConfig) -> Image.Image:
    """Amber flash showing the display number — used to physically locate a unit."""
    cfg = RenderConfig(
        width=config.width,
        height=config.height,
        font_path=config.font_path,
        font_size=config.font_size,
        color=(255, 160, 0),
        halign="center",
        valign="center",
    )
    return render_text(f"Display #{display_id}", cfg)
