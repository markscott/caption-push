from __future__ import annotations

from PIL import Image

# rpi-rgb-led-matrix must be built from source on the Pi:
#   git clone https://github.com/hzeller/rpi-rgb-led-matrix
#   cd rpi-rgb-led-matrix
#   make build-python PYTHON=$(which python3)
#   sudo make install-python PYTHON=$(which python3)
try:
    from rgbmatrix import RGBMatrix, RGBMatrixOptions
except ImportError as exc:
    raise ImportError(
        "rpi-rgb-led-matrix Python bindings not installed.\n"
        "Build from: https://github.com/hzeller/rpi-rgb-led-matrix\n"
        "Or run with --sim for simulation mode."
    ) from exc


class RealMatrix:
    """
    Thin wrapper around rpi-rgb-led-matrix for HUB75 panels on Raspberry Pi.
    API is kept identical to SimMatrix so daemon.py can swap them transparently.
    """

    def __init__(
        self,
        width: int = 128,
        height: int = 32,
        brightness: int = 60,
        gpio_mapping: str = "adafruit-hat",
        chain_length: int = 2,
        parallel: int = 1,
        gpio_slowdown: int = 4,
        display_id: int = 1,
        title: str = "",  # unused — here for API compatibility
    ) -> None:
        self.width = width
        self.height = height
        self.brightness = brightness
        self._display_id = display_id

        options = RGBMatrixOptions()
        options.rows = height
        options.cols = width // chain_length
        options.chain_length = chain_length
        options.parallel = parallel
        options.hardware_mapping = gpio_mapping
        options.brightness = brightness
        options.gpio_slowdown = gpio_slowdown
        options.disable_hardware_pulsing = False

        self._matrix = RGBMatrix(options=options)
        self._canvas = self._matrix.CreateFrameCanvas()

    def start(self) -> None:
        pass  # Matrix is ready after __init__

    def set_image(self, image: Image.Image) -> None:
        img = image.resize((self.width, self.height), Image.NEAREST).convert("RGB")
        self._canvas.SetImage(img)
        self._canvas = self._matrix.SwapOnVSync(self._canvas)

    def set_brightness(self, level: int) -> None:
        self.brightness = max(0, min(100, level))
        self._matrix.brightness = self.brightness

    def render_frame(self) -> bool:
        # The rpi-rgb-led-matrix library drives the panel on its own internal
        # scan thread; nothing to do here from Python.
        return True

    def stop(self) -> None:
        self._matrix.Clear()
