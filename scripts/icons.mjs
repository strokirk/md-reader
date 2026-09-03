// Generates the PWA icons without native image tooling: a rounded dark tile
// with a stylised "M" made of strokes, encoded as PNG by hand.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const BG = [0x1c, 0x1f, 0x26];
const FG = [0xf5, 0xc4, 0x51];
const FG2 = [0x7e, 0xc8, 0xe3];

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function makeIcon(size, { maskable }) {
  const pad = maskable ? size * 0.1 : 0;
  const radius = maskable ? 0 : size * 0.22;
  const inner = size - pad * 2;
  const strokeW = inner * 0.09;
  // Points for an "M" drawn as a polyline, in unit space.
  const pts = [
    [0.22, 0.74],
    [0.22, 0.28],
    [0.5, 0.6],
    [0.78, 0.28],
    [0.78, 0.74],
  ].map(([u, v]) => [pad + u * inner, pad + v * inner]);
  // Highlight bars behind the M (search-highlight motif).
  const bars = [
    [0.16, 0.34, 0.84, 0.44, FG2],
    [0.16, 0.58, 0.84, 0.68, FG],
  ].map(([x1, y1, x2, y2, c]) => [
    pad + x1 * inner,
    pad + y1 * inner,
    pad + x2 * inner,
    pad + y2 * inner,
    c,
  ]);
  return png(size, (x, y) => {
    // Rounded rect mask.
    const cx = Math.max(radius - x, 0, x - (size - 1 - radius));
    const cy = Math.max(radius - y, 0, y - (size - 1 - radius));
    if (!maskable && Math.hypot(cx, cy) > radius) return [0, 0, 0, 0];
    let col = BG;
    for (const [x1, y1, x2, y2, c] of bars) {
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2)
        col = [c[0] * 0.35 + BG[0] * 0.65, c[1] * 0.35 + BG[1] * 0.65, c[2] * 0.35 + BG[2] * 0.65];
    }
    let d = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      d = Math.min(
        d,
        distToSegment(x + 0.5, y + 0.5, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]),
      );
    }
    const edge = strokeW / 2;
    if (d < edge + 1) {
      const t = Math.max(0, Math.min(1, edge + 1 - d));
      const m = [0xf4, 0xf1, 0xe8];
      col = [
        col[0] + (m[0] - col[0]) * t,
        col[1] + (m[1] - col[1]) * t,
        col[2] + (m[2] - col[2]) * t,
      ];
    }
    return [Math.round(col[0]), Math.round(col[1]), Math.round(col[2]), 255];
  });
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", makeIcon(192, { maskable: false }));
writeFileSync("public/icons/icon-512.png", makeIcon(512, { maskable: false }));
writeFileSync("public/icons/icon-maskable-512.png", makeIcon(512, { maskable: true }));
writeFileSync("public/icons/apple-touch-icon.png", makeIcon(180, { maskable: true }));
console.log("icons written");
