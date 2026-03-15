from __future__ import annotations

import argparse
import platform
import sys
import time
from pathlib import Path

import zmq

# Allow running as both `python display/daemon.py` and `python -m display.daemon`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from display.renderer import RenderConfig, render_blank, render_identify, render_text


def _is_raspberry_pi() -> bool:
    return platform.machine() in ("armv7l", "aarch64", "armv6l")


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
    parser.add_argument("--brightness", type=int, default=60)
    parser.add_argument("--font-size", type=int, default=20)
    parser.add_argument("--font-path", type=str, default="default")
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
    )

    # ZeroMQ subscriber — connects to the controller's PUB socket
    context = zmq.Context()
    socket = context.socket(zmq.SUB)
    socket.connect(args.address)
    socket.setsockopt_string(zmq.SUBSCRIBE, "")
    # 16ms receive timeout keeps the render loop near 60fps when idle
    socket.setsockopt(zmq.RCVTIMEO, 16)

    matrix.start()
    matrix.set_image(render_blank(base_config))

    tag = f"[display-{args.display_id}]"
    mode = "simulation" if use_sim else "hardware"
    print(f"{tag} Connected to {args.address}  mode={mode}  size={args.width}x{args.height}")

    current_text: str = ""
    current_config = base_config
    identify_until: float = 0.0  # monotonic timestamp; >0 means identify is active

    try:
        while True:
            # ---- Receive messages (non-blocking via RCVTIMEO) ----
            try:
                msg: dict = socket.recv_json()
                cmd = msg.get("cmd", "")

                if cmd == "show":
                    current_text = msg.get("text", "")
                    color = _hex_to_rgb(msg.get("color", "#FFFFFF"))
                    current_config = RenderConfig(
                        width=base_config.width,
                        height=base_config.height,
                        font_path=base_config.font_path,
                        font_size=base_config.font_size,
                        color=color,
                        halign=msg.get("align", "center"),
                    )
                    if identify_until == 0.0:
                        matrix.set_image(render_text(current_text, current_config))
                    print(f"{tag} show: {current_text!r}")

                elif cmd == "clear":
                    current_text = ""
                    identify_until = 0.0
                    matrix.set_image(render_blank(base_config))
                    print(f"{tag} clear")

                elif cmd == "brightness":
                    level = int(msg.get("level", 60))
                    matrix.set_brightness(level)
                    print(f"{tag} brightness → {level}")

                elif cmd == "identify":
                    target = msg.get("id")
                    if target is None or target == args.display_id:
                        matrix.set_image(render_identify(args.display_id, base_config))
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
                matrix.set_image(img)

            # ---- Render frame ----
            if not matrix.render_frame():
                print(f"{tag} window closed — exiting")
                break

    except KeyboardInterrupt:
        print(f"\n{tag} shutting down")
    finally:
        matrix.set_image(render_blank(base_config))
        matrix.stop()
        socket.close()
        context.term()




if __name__ == "__main__":
    main()
