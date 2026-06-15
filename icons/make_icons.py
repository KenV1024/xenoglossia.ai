# 純Python（標準ライブラリのみ）でアプリアイコンPNGを生成する
# デザイン: 藍→紫グラデの角丸スクエア + 白い吹き出し + 3つのドット
import struct, zlib, os

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def make_icon(n, path):
    c_top = (79, 70, 229)    # #4F46E5
    c_bot = (124, 58, 237)   # #7C3AED
    radius = 0.18 * n
    # 吹き出し
    bx, by = 0.5 * n, 0.44 * n
    brx, bry = 0.30 * n, 0.235 * n
    # 尻尾の三角形
    tri = [(0.40 * n, 0.60 * n), (0.335 * n, 0.78 * n), (0.55 * n, 0.655 * n)]
    # ドット
    dots = [(0.38 * n, by), (0.50 * n, by), (0.62 * n, by)]
    dot_r = 0.038 * n

    def in_rounded_rect(x, y):
        if x < 0 or y < 0 or x >= n or y >= n:
            return False
        cx = min(max(x, radius), n - radius)
        cy = min(max(y, radius), n - radius)
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 or \
               (radius <= x < n - radius) or (radius <= y < n - radius)

    def in_bubble(x, y):
        if ((x - bx) / brx) ** 2 + ((y - by) / bry) ** 2 <= 1:
            return True
        (x1, y1), (x2, y2), (x3, y3) = tri
        d1 = (x - x2) * (y1 - y2) - (x1 - x2) * (y - y2)
        d2 = (x - x3) * (y2 - y3) - (x2 - x3) * (y - y3)
        d3 = (x - x1) * (y3 - y1) - (x3 - x1) * (y - y1)
        neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
        pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
        return not (neg and pos)

    def in_dot(x, y):
        return any((x - dx) ** 2 + (y - dy) ** 2 <= dot_r ** 2 for dx, dy in dots)

    rows = []
    for y in range(n):
        row = bytearray([0])  # filter type 0
        grad = lerp(c_top, c_bot, y / n)
        for x in range(n):
            if not in_rounded_rect(x, y):
                row += bytes([0, 0, 0, 0])
            elif in_dot(x, y):
                row += bytes([*grad, 255])
            elif in_bubble(x, y):
                row += bytes([255, 255, 255, 255])
            else:
                row += bytes([*grad, 255])
        rows.append(bytes(row))

    raw = b''.join(rows)

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    print(f'wrote {path} ({n}x{n})')

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    make_icon(192, os.path.join(here, 'icon-192.png'))
    make_icon(512, os.path.join(here, 'icon-512.png'))
