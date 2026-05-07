from __future__ import annotations

from dataclasses import dataclass, field, replace

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

LINE_SPACING = 4   # px between lines
PADDING_X = 4      # px horizontal padding


@dataclass
class RenderConfig:
    width: int = 128
    height: int = 64
    font_path: str = "default"
    font_size: int = 24
    color: tuple[int, int, int] = field(default_factory=lambda: (255, 255, 255))
    halign: str = "center"
    valign: str = "center"
    max_lines: int = 2


def _load_font(config: RenderConfig) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if config.font_path == "default":
        try:
            return ImageFont.load_default(size=config.font_size)
        except TypeError:
            # Pillow < 10
            return ImageFont.load_default()
    return ImageFont.truetype(config.font_path, config.font_size)


def _wrap(
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    draw: ImageDraw.ImageDraw,
    max_width: int,
    max_lines: int,
) -> list[str]:
    """Greedily wrap text into at most max_lines lines that each fit max_width px."""
    words = text.split()
    if not words:
        return [""]

    lines: list[str] = []

    while words:
        # Last allowed line — dump everything remaining onto it
        if len(lines) == max_lines - 1:
            lines.append(" ".join(words))
            break

        # Find the longest prefix of words that fits
        fit = 1
        while fit < len(words):
            candidate = " ".join(words[: fit + 1])
            bb = draw.textbbox((0, 0), candidate, font=font)
            if bb[2] - bb[0] > max_width:
                break
            fit += 1

        lines.append(" ".join(words[:fit]))
        words = words[fit:]

    return lines


def _scale_to_fit(
    text: str,
    config: RenderConfig,
    draw: ImageDraw.ImageDraw,
) -> tuple[ImageFont.FreeTypeFont | ImageFont.ImageFont, int]:
    """Binary search for the largest font size where text fits in one line."""
    max_w = config.width - PADDING_X * 2
    lo, hi = 8, config.font_size
    best = _load_font(replace(config, font_size=lo))
    best_size = lo
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
    img = Image.new("RGB", (config.width, config.height), (0, 0, 0))
    if not text:
        return img

    draw = ImageDraw.Draw(img)

    if config.max_lines == 1:
        font, fitted_size = _scale_to_fit(text, config, draw)
        lines = [text]
        shadow_offset = max(3, fitted_size // 36)
        shadow_blur   = max(2, fitted_size // 48)
    else:
        font = _load_font(config)
        lines = _wrap(text, font, draw, config.width - PADDING_X * 2, config.max_lines)
        shadow_offset = max(3, config.font_size // 36)
        shadow_blur   = max(2, config.font_size // 48)

    bboxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
    positions = _text_positions(lines, bboxes, config)

    # Blurred drop shadow: draw text at offset in a dim shade of the text
    # color, blur it, then add to the (black) base image so it's visible.
    shadow_color = tuple(max(40, c // 6) for c in config.color)
    shadow_layer = Image.new("RGB", img.size, (0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    for line, x, y in positions:
        sd.text((x + shadow_offset, y + shadow_offset), line, font=font, fill=shadow_color)
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=shadow_blur))
    img = ImageChops.add(img, shadow_layer)

    # Sharp main text on top
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
        max_lines=1,
    )
    return render_text(f"Display #{display_id}", cfg)
