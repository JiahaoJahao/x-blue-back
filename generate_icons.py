from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)

BLUE = (29, 155, 240, 255)
NAVY = (16, 20, 28, 255)
WHITE = (248, 250, 252, 255)
CLEAR = (0, 0, 0, 0)


def png(width: int, height: int, rgba_rows: list[bytes]) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + row for row in rgba_rows)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"".join([b"\x89PNG\r\n\x1a\n", chunk(b"IHDR", ihdr), chunk(b"IDAT", zlib.compress(raw, 9)), chunk(b"IEND", b"")])


def write_icon(size: int) -> None:
    px = [[CLEAR] * size for _ in range(size)]
    r = max(3, size // 6)
    for y in range(size):
        for x in range(size):
            dx = min(x, size - 1 - x)
            dy = min(y, size - 1 - y)
            inside = True
            if dx < r and dy < r and (r - dx) ** 2 + (r - dy) ** 2 > r * r:
                inside = False
            if inside:
                px[y][x] = NAVY
    cx = cy = size / 2
    rad = size * 0.28
    for y in range(size):
        for x in range(size):
            if (x - cx) ** 2 + (y - cy) ** 2 <= rad ** 2 and px[y][x][3]:
                px[y][x] = BLUE
    rows = [b"".join(bytes(p) for p in row) for row in px]
    (OUT / f"icon{size}.png").write_bytes(png(size, size, rows))


for s in (16, 32, 48, 128):
    write_icon(s)
print("ok")
