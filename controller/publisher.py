from __future__ import annotations

import zmq


class CaptionPublisher:
    """ZeroMQ PUB socket wrapper — binds and broadcasts to all display subscribers."""

    def __init__(self, address: str = "tcp://*:5555") -> None:
        self._context = zmq.Context()
        self._socket = self._context.socket(zmq.PUB)
        self._socket.bind(address)
        self._seq: int = 0

    def show(
        self,
        text: str,
        color: str = "#FFFFFF",
        align: str = "center",
        scroll: bool = False,
    ) -> None:
        self._send(
            {
                "cmd": "show",
                "text": text,
                "color": color,
                "align": align,
                "scroll": scroll,
            }
        )

    def clear(self) -> None:
        self._send({"cmd": "clear"})

    def brightness(self, level: int) -> None:
        self._send({"cmd": "brightness", "level": max(0, min(100, level))})

    def identify(self, display_id: int | None = None) -> None:
        msg: dict = {"cmd": "identify"}
        if display_id is not None:
            msg["id"] = display_id
        self._send(msg)

    def _send(self, payload: dict) -> None:
        payload["seq"] = self._seq
        self._seq += 1
        self._socket.send_json(payload)

    def close(self) -> None:
        self._socket.close()
        self._context.term()

    def __enter__(self) -> CaptionPublisher:
        return self

    def __exit__(self, *_) -> None:
        self.close()
