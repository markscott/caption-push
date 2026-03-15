from __future__ import annotations

import threading

import numpy as np
import pygame
import pygame.surfarray
from PIL import Image


class SimMatrix:
    """
    Pygame-based LED matrix simulator for development on macOS / Linux.

    Each instance opens its own window and renders the LED panel with
    realistic pixel gaps to approximate how HUB75 panels look.
    """

    def __init__(
        self,
        width: int = 128,
        height: int = 32,
        brightness: int = 60,
        pixel_size: int = 8,
        pixel_gap: int = 1,
        display_id: int = 1,
        title: str = "Caption Display",
    ) -> None:
        self.width = width
        self.height = height
        self.brightness = brightness
        self._ps = pixel_size          # pixels per LED dot
        self._cell = pixel_size + pixel_gap  # total cell size including gap
        self._display_id = display_id
        self._title = title

        self._win_w = width * self._cell
        self._win_h = height * self._cell

        self._lock = threading.Lock()
        self._pixels = np.zeros((height, width, 3), dtype=np.uint8)
        self._dirty = True

        self._screen: pygame.Surface | None = None
        self._clock: pygame.time.Clock | None = None

    # ------------------------------------------------------------------
    # Public API (mirrors RealMatrix)
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Initialize pygame and open the simulator window.
        Must be called from the main thread on macOS."""
        pygame.init()
        self._screen = pygame.display.set_mode((self._win_w, self._win_h))
        pygame.display.set_caption(f"{self._title} #{self._display_id}")
        self._clock = pygame.time.Clock()

    def set_image(self, image: Image.Image) -> None:
        arr = np.array(
            image.resize((self.width, self.height), Image.NEAREST), dtype=np.uint8
        )
        with self._lock:
            self._pixels = arr
            self._dirty = True

    def set_brightness(self, level: int) -> None:
        with self._lock:
            self.brightness = max(0, min(100, level))
            self._dirty = True

    def render_frame(self) -> bool:
        """Draw one frame and pump events. Returns False when window is closed."""
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return False

        if self._screen is None:
            return True

        with self._lock:
            if not self._dirty:
                if self._clock:
                    self._clock.tick(60)
                return True
            pixels = self._pixels.copy()
            scale = self.brightness / 100.0
            self._dirty = False

        # Scale brightness
        scaled = (pixels.astype(np.float32) * scale).clip(0, 255).astype(np.uint8)

        # Build the LED canvas using pure numpy (no Python pixel loops)
        #
        # Strategy: create a (H, cell, W, cell, 3) array, fill background,
        # then stamp each LED color into the [0:ps, 0:ps] sub-region, then
        # reshape to (H*cell, W*cell, 3).
        H, W = self.height, self.width
        ps = self._ps
        cell = self._cell

        canvas = np.full((H, cell, W, cell, 3), 8, dtype=np.uint8)

        # Dim inactive LEDs instead of pure black
        inactive = scaled.sum(axis=2) == 0  # (H, W) bool mask
        led_color = scaled.copy()
        led_color[inactive] = [18, 18, 18]

        # Broadcast into the LED pixel block (top-left ps×ps of each cell)
        canvas[:, :ps, :, :ps, :] = led_color[:, np.newaxis, :, np.newaxis, :]

        frame = canvas.reshape(H * cell, W * cell, 3)

        # pygame surfarray expects (W, H, 3) — transpose axes 0 and 1
        surface = pygame.surfarray.make_surface(frame.transpose(1, 0, 2))
        self._screen.blit(surface, (0, 0))
        pygame.display.flip()

        if self._clock:
            self._clock.tick(60)

        return True

    def stop(self) -> None:
        pygame.quit()
