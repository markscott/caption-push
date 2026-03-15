from __future__ import annotations

from dataclasses import dataclass, field

from PIL import Image, ImageDraw, ImageFont

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


def render_text(text: str, config: RenderConfig) -> Image.Image:
    img = Image.new("RGB", (config.width, config.height), (0, 0, 0))
    if not text:
        return img

    draw = ImageDraw.Draw(img)
    font = _load_font(config)

    lines = _wrap(text, font, draw, config.width - PADDING_X * 2, config.max_lines)

    # Measure each line
    bboxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
    line_heights = [bb[3] - bb[1] for bb in bboxes]
    total_h = sum(line_heights) + LINE_SPACING * (len(lines) - 1)

    # Visual top of the text block
    if config.valign == "center":
        block_top = (config.height - total_h) // 2
    elif config.valign == "bottom":
        block_top = config.height - total_h - 2
    else:
        block_top = 2

    current_y = block_top
    for line, bb, lh in zip(lines, bboxes, line_heights):
        text_w = bb[2] - bb[0]

        if config.halign == "center":
            x = max(0, (config.width - text_w) // 2)
        elif config.halign == "right":
            x = max(0, config.width - text_w - PADDING_X)
        else:
            x = PADDING_X

        # bb[1] is the ascent offset — subtract so visual top lands at current_y
        draw.text((x, current_y - bb[1]), line, font=font, fill=config.color)
        current_y += lh + LINE_SPACING

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
