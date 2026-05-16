from __future__ import annotations

import argparse
import io
import platform
import socket as _socket
import sys
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import zmq

# Allow running as both `python display/daemon.py` and `python -m display.daemon`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image as PILImage

from display.renderer import RenderConfig, render_blank, render_identify, render_text


SCROLL_SPEED_PX_S = 300.0  # pixels per second during scroll
SCROLL_DELAY_S    = 1.0    # pause before scrolling begins
AUTO_CLEAR_S      = 10.0   # seconds after content is fully shown before auto-clear


@dataclass
class _PreloadCache:
    text: str
    color: tuple[int, int, int]
    halign: str
    img: PILImage.Image


@dataclass
class _ScrollAnim:
    wide_img: PILImage.Image
    t_scroll_start: float   # monotonic time when scrolling begins
    offset: float = 0.0     # current scroll position in px


def _scroll_crop(wide: PILImage.Image, offset: int, w: int, h: int) -> PILImage.Image:
    left = max(0, min(offset, wide.width - w))
    return wide.crop((left, 0, left + w, h))


def _is_raspberry_pi() -> bool:
    return platform.machine() in ("armv7l", "aarch64", "armv6l")


# ---- MJPEG preview server (operator UI polls this for exact PIL output) ----

_preview_jpeg: bytes = b''
_preview_version: int = 0
_preview_lock = threading.Lock()


def _update_preview(img: PILImage.Image) -> None:
    global _preview_jpeg, _preview_version
    thumb = img.resize((img.width // 2, img.height // 2))
    buf = io.BytesIO()
    thumb.save(buf, format='JPEG', quality=80)
    with _preview_lock:
        _preview_jpeg = buf.getvalue()
        _preview_version += 1


class _MjpegHandler(BaseHTTPRequestHandler):
    # HTTP/1.1 so Node.js HTTP client streams data events immediately
    protocol_version = 'HTTP/1.1'

    def do_GET(self) -> None:
        # Disable Nagle on this connection for minimal frame latency
        self.connection.setsockopt(_socket.IPPROTO_TCP, _socket.TCP_NODELAY, 1)
        self.send_response(200)
        self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Transfer-Encoding', 'chunked')
        self.end_headers()
        last_ver = -1
        while True:
            with _preview_lock:
                ver, frame = _preview_version, _preview_jpeg
            if frame and ver != last_ver:
                last_ver = ver
                try:
                    part = (
                        b'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: '
                        + str(len(frame)).encode()
                        + b'\r\n\r\n'
                        + frame
                        + b'\r\n'
                    )
                    # Write as a single HTTP/1.1 chunk
                    chunk = hex(len(part)).encode() + b'\r\n' + part + b'\r\n'
                    self.wfile.write(chunk)
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    break
            else:
                time.sleep(0.01)

    def log_message(self, *_args: object) -> None:
        pass


def _start_preview_server(port: int) -> None:
    ThreadingHTTPServer(('0.0.0.0', port), _MjpegHandler).serve_forever()


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return (r, g, b)
    except (ValueError, IndexError):
        return (255, 255, 255)


def main() -> None:
    parser = argparse.ArgumentParser(description="Theater Caption Display Daemon")
    parser.add_argument(
        "--address",
        default="tcp://localhost:5555",
        help="ZeroMQ PUB address to connect to (controller's address)",
    )
    parser.add_argument("--id", type=int, default=1, dest="display_id",
                        help="Unique display ID (used for 'identify' command)")
    parser.add_argument("--width", type=int, default=128,
                        help="Total display width in pixels (panel_width * chain_length)")
    parser.add_argument("--height", type=int, default=32)
    parser.add_argument("--brightness", type=int, default=100)
    parser.add_argument("--font-size", type=int, default=20)
    parser.add_argument("--font-path", type=str, default="default")
    parser.add_argument("--max-lines", type=int, default=1,
                        help="Maximum lines of text to render (1 = single line, full height)")
    parser.add_argument("--sim", action="store_true",
                        help="Force simulation mode (auto-detected when not on Pi)")
    parser.add_argument("--pixel-size", type=int, default=8,
                        help="[sim] Screen pixels per LED dot")
    parser.add_argument("--pixel-gap", type=int, default=1,
                        help="[sim] Gap between LED dots in screen pixels")
    args = parser.parse_args()

    use_sim = args.sim or not _is_raspberry_pi()

    if use_sim:
        from display.matrix_sim import SimMatrix
        matrix = SimMatrix(
            width=args.width,
            height=args.height,
            brightness=args.brightness,
            pixel_size=args.pixel_size,
            pixel_gap=args.pixel_gap,
            display_id=args.display_id,
        )
    else:
        from display.matrix_real import RealMatrix
        matrix = RealMatrix(
            width=args.width,
            height=args.height,
            brightness=args.brightness,
            display_id=args.display_id,
        )

    base_config = RenderConfig(
        width=args.width,
        height=args.height,
        font_path=args.font_path,
        font_size=args.font_size,
        max_lines=args.max_lines,
    )

    # ZeroMQ subscriber — connects to the controller's PUB socket
    context = zmq.Context()
    socket = context.socket(zmq.SUB)
    socket.connect(args.address)
    socket.setsockopt_string(zmq.SUBSCRIBE, "")
    # 16ms receive timeout keeps the render loop near 60fps when idle
    socket.setsockopt(zmq.RCVTIMEO, 16)

    threading.Thread(target=_start_preview_server, args=(7777,), daemon=True).start()

    matrix.start()
    matrix.set_image(render_blank(base_config))

    tag = f"[display-{args.display_id}]"
    mode = "simulation" if use_sim else "hardware"
    print(f"{tag} Connected to {args.address}  mode={mode}  size={args.width}x{args.height}")

    current_text: str = ""
    current_config = base_config
    identify_until: float = 0.0   # monotonic timestamp; >0 means identify is active
    scroll_anim: _ScrollAnim | None = None
    t_clear: float | None = None  # monotonic time for auto-clear; None = no pending clear
    preload_cache: _PreloadCache | None = None
    current_brightness: int = args.brightness

    def show_img(img: PILImage.Image) -> None:
        matrix.set_image(img)
        _update_preview(img)

    try:
        while True:
            # ---- Receive messages (non-blocking via RCVTIMEO) ----
            try:
                msg: dict = socket.recv_json()
                cmd = msg.get("cmd", "")

                if cmd == "show":
                    current_text = msg.get("text", "")
                    color = _hex_to_rgb(msg.get("color", "#FFFFFF"))
                    halign = msg.get("align", "center")
                    current_config = RenderConfig(
                        width=base_config.width,
                        height=base_config.height,
                        font_path=base_config.font_path,
                        font_size=base_config.font_size,
                        max_lines=base_config.max_lines,
                        color=color,
                        halign=halign,
                    )
                    if identify_until == 0.0:
                        # Use preloaded image if it matches exactly
                        if (preload_cache is not None
                                and preload_cache.text == current_text
                                and preload_cache.color == color
                                and preload_cache.halign == halign):
                            img = preload_cache.img
                            print(f"{tag} show (cache hit): {current_text!r}")
                        else:
                            img = render_text(current_text, current_config)
                            print(f"{tag} show (rendered): {current_text!r}")
                        preload_cache = None
                        if img.width > base_config.width:
                            scroll_anim = _ScrollAnim(
                                wide_img=img,
                                t_scroll_start=time.monotonic() + SCROLL_DELAY_S,
                            )
                            t_clear = None
                            show_img(_scroll_crop(img, 0, base_config.width, base_config.height))
                        else:
                            scroll_anim = None
                            t_clear = time.monotonic() + AUTO_CLEAR_S
                            show_img(img)

                elif cmd == "preload":
                    text = msg.get("text", "")
                    color = _hex_to_rgb(msg.get("color", "#FFFFFF"))
                    halign = msg.get("align", "center")
                    if text:
                        cfg = RenderConfig(
                            width=base_config.width,
                            height=base_config.height,
                            font_path=base_config.font_path,
                            font_size=base_config.font_size,
                            max_lines=base_config.max_lines,
                            color=color,
                            halign=halign,
                        )
                        preload_cache = _PreloadCache(
                            text=text,
                            color=color,
                            halign=halign,
                            img=render_text(text, cfg),
                        )
                        print(f"{tag} preloaded: {text!r}")
                    else:
                        preload_cache = None

                elif cmd == "clear":
                    current_text = ""
                    scroll_anim = None
                    t_clear = None
                    preload_cache = None
                    identify_until = 0.0
                    show_img(render_blank(base_config))
                    print(f"{tag} clear")

                elif cmd == "brightness":
                    level = int(msg.get("level", 60))
                    current_brightness = level
                    matrix.set_brightness(level)  # hardware brightness for real LED matrices
                    print(f"{tag} brightness → {level}")

                elif cmd == "identify":
                    target = msg.get("id")
                    if target is None or target == args.display_id:
                        show_img(render_identify(args.display_id, base_config))
                        identify_until = time.monotonic() + 2.0
                        print(f"{tag} identify flash")

            except zmq.Again:
                pass  # No message this tick — fall through to render

            # ---- Expire identify flash ----
            if identify_until > 0.0 and time.monotonic() >= identify_until:
                identify_until = 0.0
                img = (
                    render_text(current_text, current_config)
                    if current_text
                    else render_blank(base_config)
                )
                if img.width > base_config.width:
                    scroll_anim = _ScrollAnim(
                        wide_img=img,
                        t_scroll_start=time.monotonic() + SCROLL_DELAY_S,
                    )
                    t_clear = None
                    show_img(_scroll_crop(img, 0, base_config.width, base_config.height))
                else:
                    scroll_anim = None
                    t_clear = time.monotonic() + AUTO_CLEAR_S
                    show_img(img)

            # ---- Advance scroll animation ----
            if scroll_anim is not None and identify_until == 0.0:
                now = time.monotonic()
                if now >= scroll_anim.t_scroll_start:
                    elapsed = now - scroll_anim.t_scroll_start
                    max_offset = scroll_anim.wide_img.width - base_config.width
                    new_offset = min(SCROLL_SPEED_PX_S * elapsed, max_offset)
                    scroll_anim.offset = new_offset
                    show_img(
                        _scroll_crop(scroll_anim.wide_img, int(new_offset),
                                     base_config.width, base_config.height)
                    )
                    if new_offset >= max_offset:
                        scroll_anim = None
                        t_clear = time.monotonic() + AUTO_CLEAR_S

            # ---- Auto-clear ----
            if t_clear is not None and time.monotonic() >= t_clear:
                t_clear = None
                current_text = ""
                scroll_anim = None
                show_img(render_blank(base_config))
                print(f"{tag} auto-clear")

            # ---- Render frame ----
            if not matrix.render_frame():
                print(f"{tag} window closed — exiting")
                break

    except KeyboardInterrupt:
        print(f"\n{tag} shutting down")
    finally:
        show_img(render_blank(base_config))
        matrix.stop()
        socket.close()
        context.term()




if __name__ == "__main__":
    main()
