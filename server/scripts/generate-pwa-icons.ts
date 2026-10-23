import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const publicDir = resolve(rootDir, 'client', 'public');

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createShipIconPng(size: number, maskable: boolean): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const cx = size / 2;
  const cy = size / 2;
  const scale = maskable ? size * 0.30 : size * 0.36;

  // Ship triangle vertices pointing up-right
  const ax = cx;
  const ay = cy - scale;
  const bx = cx - scale * 0.75;
  const by = cy + scale * 0.8;
  const dx = cx + scale * 0.75;
  const dy = cy + scale * 0.8;

  function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  }

  const strokeWidth = Math.max(2, size * 0.028);
  const ringRadius = scale * 1.18;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // Filter type 0
    for (let x = 0; x < size; x++) {
      const idx = rowStart + 1 + x * 4;
      // Dark tactical space background (#101414)
      let r = 16;
      let g = 20;
      let b = 20;

      const distCenter = Math.hypot(x - cx, y - cy);
      // Outer radar ring (#52665d)
      if (Math.abs(distCenter - ringRadius) <= strokeWidth * 0.65) {
        r = 82;
        g = 102;
        b = 93;
      }

      // Ship wireframe (#a7ff83)
      const d1 = distToSegment(x, y, ax, ay, bx, by);
      const d2 = distToSegment(x, y, bx, by, dx, dy);
      const d3 = distToSegment(x, y, dx, dy, ax, ay);
      if (Math.min(d1, d2, d3) <= strokeWidth) {
        r = 167;
        g = 255;
        b = 131;
      }

      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = 255;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function generateIcons() {
  await Promise.all([
    writeFile(resolve(publicDir, 'pwa-192x192.png'), createShipIconPng(192, false)),
    writeFile(resolve(publicDir, 'pwa-512x512.png'), createShipIconPng(512, false)),
    writeFile(resolve(publicDir, 'pwa-maskable-512x512.png'), createShipIconPng(512, true)),
    writeFile(resolve(publicDir, 'apple-touch-icon.png'), createShipIconPng(180, false)),
  ]);
  console.log('Generated PWA PNG icons (180x180, 192x192, 512x512, maskable 512x512).');
}

generateIcons().catch((err) => {
  console.error('Failed to generate PWA icons:', err);
  process.exitCode = 1;
});
