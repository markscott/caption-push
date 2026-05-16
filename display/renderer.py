from __future__ import annotations

import os
from dataclasses import dataclass, field, replace

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

_LIBERATION_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
_DEFAULT_FONT_PATH = os.environ.get("FONT_PATH", _LIBERATION_BOLD)

LINE_SPACING = 4   # px between lines (unused now, kept for render_identify)
PADDING_X = 4      # px horizontal padding
WORD_LIMIT = 20    # words beyond this are dropped
MIN_FONT_RATIO = 0.60   # font height floor as fraction of panel height
MIN_FONT_MARGIN_PX = 50  # allow font to shrink this many px below the ratio floor before scrolling


@dataclass
class RenderConfig:
    width: int = 128
    height: int = 64
    font_path: str = field(default_factory=lambda: _DEFAULT_FONT_PATH)
    font_size: int = 24
    color: tuple[int, int, int] = field(default_factory=lambda: (220, 220, 210))
    halign: str = "left"
    valign: str = "center"
    max_lines: int = 2  # kept for API compatibility; layout is driven by word count


def _load_font(config: RenderConfig) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    import pathlib
    path = pathlib.Path(config.font_path)
    if path.exists():
        return ImageFont.truetype(str(path), config.font_size)
    # Fallback: PIL built-in bitmap font (no size control)
    try:
        return ImageFont.load_default(size=config.font_size)
    except TypeError:
        return ImageFont.load_default()


def _scale_to_fit_one(
    text: str,
    config: RenderConfig,
    draw: ImageDraw.ImageDraw,
) -> tuple[ImageFont.FreeTypeFont | ImageFont.ImageFont, int]:
    """Binary search for the largest font size where text fits on one line."""
    max_w = config.width - PADDING_X * 2
    lo, hi = 8, config.font_size
    best, best_size = _load_font(replace(config, font_size=lo)), lo
    while lo <= hi:
        mid = (lo + hi) // 2
        font = _load_font(replace(config, font_size=mid))
        bb = draw.textbbox((0, 0), text, font=font)
        if bb[2] - bb[0] <= max_w:
            best, best_size = font, mid
            lo = mid + 1
        else:
            hi = mid - 1
    return best, best_size


def _text_positions(
    lines: list[str],
    bboxes: list[tuple[int, int, int, int]],
    config: RenderConfig,
) -> list[tuple[str, int, int]]:
    """Return (line, x, y) draw positions for all lines."""
    line_heights = [bb[3] - bb[1] for bb in bboxes]
    total_h = sum(line_heights) + LINE_SPACING * (len(lines) - 1)

    if config.valign == "center":
        block_top = (config.height - total_h) // 2
    elif config.valign == "bottom":
        block_top = config.height - total_h - 2
    else:
        block_top = 2

    positions: list[tuple[str, int, int]] = []
    current_y = block_top
    for line, bb, lh in zip(lines, bboxes, line_heights):
        text_w = bb[2] - bb[0]
        if config.halign == "center":
            x = max(0, (config.width - text_w) // 2)
        elif config.halign == "right":
            x = max(0, config.width - text_w - PADDING_X)
        else:
            x = PADDING_X
        positions.append((line, x, current_y - bb[1]))
        current_y += lh + LINE_SPACING

    return positions


def render_text(text: str, config: RenderConfig) -> Image.Image:
    """Render text to an image.

    When the text is too long to fit at the minimum acceptable font size
    (MIN_FONT_RATIO * config.height), returns a wide image whose width
    exceeds config.width.  The caller is responsible for scrolling through it.
    """
    if not text:
        return Image.new("RGB", (config.width, config.height), (0, 0, 0))

    # Tiny probe surface — textbbox measurements don't depend on canvas size.
    _probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    joined = " ".join(text.split()[:WORD_LIMIT])

    # Fixed font size — same for every line regardless of length.
    # Short text is centered at this size; long text scrolls.
    fixed_size = max(8, int(config.height * MIN_FONT_RATIO) - MIN_FONT_MARGIN_PX)
    fitted_size = fixed_size
    font = _load_font(replace(config, font_size=fixed_size))

    bb = _probe.textbbox((0, 0), joined, font=font)
    text_w = bb[2] - bb[0]
    if text_w + PADDING_X * 2 > config.width:
        canvas_w = text_w + PADDING_X * 2
        render_config = replace(config, width=canvas_w, halign="left")
    else:
        render_config = config
    lines = [joined]

    shadow_offset = max(3, fitted_size // 36)
    shadow_blur   = max(2, fitted_size // 48)

    canvas = Image.new("RGB", (render_config.width, config.height), (0, 0, 0))
    bboxes = [_probe.textbbox((0, 0), line, font=font) for line in lines]
    positions = _text_positions(lines, bboxes, render_config)

    shadow_color = tuple(max(40, c // 6) for c in config.color)
    shadow_layer = Image.new("RGB", canvas.size, (0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    for line, x, y in positions:
        sd.text((x + shadow_offset, y + shadow_offset), line, font=font, fill=shadow_color)
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=shadow_blur))
    canvas = ImageChops.add(canvas, shadow_layer)

    d = ImageDraw.Draw(canvas)
    for line, x, y in positions:
        d.text((x, y), line, font=font, fill=(255, 255, 255))

    return canvas  # width > config.width → caller must scroll


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
