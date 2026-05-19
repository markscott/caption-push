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
        # Pre-allocated surface avoids a heap allocation on every dirty frame
        self._blit_surface = pygame.Surface((self._win_w, self._win_h))

    def set_image(self, image: Image.Image) -> None:
        if image.size != (self.width, self.height):
            image = image.resize((self.width, self.height), Image.NEAREST)
        arr = np.array(image, dtype=np.uint8)
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

        H, W = self.height, self.width
        ps = self._ps
        cell = self._cell

        if cell == 1:
            # No gap between LEDs — pixels map 1:1; skip the reshape entirely
            frame = scaled
        else:
            # Build the LED canvas: stamp each LED color into ps×ps of each cell
            canvas = np.zeros((H, cell, W, cell, 3), dtype=np.uint8)
            canvas[:, :ps, :, :ps, :] = scaled[:, np.newaxis, :, np.newaxis, :]
            frame = canvas.reshape(H * cell, W * cell, 3)

        # pygame pixelcopy expects (W, H, 3) — reuse pre-allocated surface
        pygame.pixelcopy.array_to_surface(self._blit_surface, np.ascontiguousarray(frame.transpose(1, 0, 2)))
        self._screen.blit(self._blit_surface, (0, 0))
        pygame.display.flip()

        if self._clock:
            self._clock.tick(60)

        return True

    def stop(self) -> None:
        pygame.quit()
