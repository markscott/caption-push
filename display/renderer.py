from __future__ import annotations

from dataclasses import dataclass, field

from PIL import Image, ImageDraw, ImageFont


@dataclass
class RenderConfig:
    width: int = 128
    height: int = 32
    font_path: str = "default"
    font_size: int = 20
    color: tuple[int, int, int] = field(default_factory=lambda: (255, 255, 255))
    halign: str = "center"
    valign: str = "center"


def _load_font(config: RenderConfig) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if config.font_path == "default":
        try:
            return ImageFont.load_default(size=config.font_size)
        except TypeError:
            # Pillow < 10: load_default() accepts no size argument
            return ImageFont.load_default()
    return ImageFont.truetype(config.font_path, config.font_size)


def render_text(text: str, config: RenderConfig) -> Image.Image:
    img = Image.new("RGB", (config.width, config.height), (0, 0, 0))
    if not text:
        return img

    draw = ImageDraw.Draw(img)
    font = _load_font(config)

    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # Horizontal position
    if config.halign == "center":
        x = max(0, (config.width - text_w) // 2)
    elif config.halign == "right":
        x = max(0, config.width - text_w - 2)
    else:
        x = 2

    # Vertical position (bbox[1] is the ascent offset, subtract it to avoid top-clip)
    if config.valign == "center":
        y = max(0, (config.height - text_h) // 2 - bbox[1])
    elif config.valign == "bottom":
        y = max(0, config.height - text_h - 2 - bbox[1])
    else:
        y = 2 - bbox[1]

    draw.text((x, y), text, font=font, fill=config.color)
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
        color=(255, 160, 0),  # amber
        halign="center",
        valign="center",
    )
    return render_text(f"Display #{display_id}", cfg)
