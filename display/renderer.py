from __future__ import annotations

from dataclasses import dataclass, field, replace

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

LINE_SPACING = 4   # px between lines
PADDING_X = 4      # px horizontal padding
WORD_LIMIT = 20    # words beyond this are dropped
TWO_LINE_THRESHOLD = 9  # more than this many words → 2-line layout


@dataclass
class RenderConfig:
    width: int = 128
    height: int = 64
    font_path: str = "default"
    font_size: int = 24
    color: tuple[int, int, int] = field(default_factory=lambda: (255, 255, 255))
    halign: str = "center"
    valign: str = "center"
    max_lines: int = 2  # kept for API compatibility; layout is driven by word count


def _load_font(config: RenderConfig) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if config.font_path == "default":
        try:
            return ImageFont.load_default(size=config.font_size)
        except TypeError:
            return ImageFont.load_default()
    return ImageFont.truetype(config.font_path, config.font_size)


def _split_two_lines(words: list[str]) -> tuple[str, str]:
    """Split word list into two lines as equal in character length as possible."""
    best_split = max(1, len(words) // 2)
    best_diff = float('inf')
    for i in range(1, len(words)):
        diff = abs(len(" ".join(words[:i])) - len(" ".join(words[i:])))
        if diff < best_diff:
            best_diff = diff
            best_split = i
    return " ".join(words[:best_split]), " ".join(words[best_split:])


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


def _scale_to_fit_two(
    line1: str,
    line2: str,
    config: RenderConfig,
    draw: ImageDraw.ImageDraw,
) -> tuple[ImageFont.FreeTypeFont | ImageFont.ImageFont, int]:
    """Binary search for the largest font where both lines fit in width and height."""
    max_w = config.width - PADDING_X * 2
    lo, hi = 8, config.font_size
    best, best_size = _load_font(replace(config, font_size=lo)), lo
    while lo <= hi:
        mid = (lo + hi) // 2
        font = _load_font(replace(config, font_size=mid))
        bb1 = draw.textbbox((0, 0), line1, font=font)
        bb2 = draw.textbbox((0, 0), line2, font=font)
        fits_w = (bb1[2] - bb1[0]) <= max_w and (bb2[2] - bb2[0]) <= max_w
        total_h = (bb1[3] - bb1[1]) + (bb2[3] - bb2[1]) + LINE_SPACING
        if fits_w and total_h <= config.height:
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
    img = Image.new("RGB", (config.width, config.height), (0, 0, 0))
    if not text:
        return img

    draw = ImageDraw.Draw(img)
    words = text.split()[:WORD_LIMIT]

    if len(words) > TWO_LINE_THRESHOLD:
        line1, line2 = _split_two_lines(words)
        font, fitted_size = _scale_to_fit_two(line1, line2, config, draw)
        lines = [line1, line2]
    else:
        joined = " ".join(words)
        font, fitted_size = _scale_to_fit_one(joined, config, draw)
        lines = [joined]

    shadow_offset = max(3, fitted_size // 36)
    shadow_blur   = max(2, fitted_size // 48)

    bboxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
    positions = _text_positions(lines, bboxes, config)

    shadow_color = tuple(max(40, c // 6) for c in config.color)
    shadow_layer = Image.new("RGB", img.size, (0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    for line, x, y in positions:
        sd.text((x + shadow_offset, y + shadow_offset), line, font=font, fill=shadow_color)
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=shadow_blur))
    img = ImageChops.add(img, shadow_layer)

    draw = ImageDraw.Draw(img)
    for line, x, y in positions:
        draw.text((x, y), line, font=font, fill=config.color)

    return img


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
