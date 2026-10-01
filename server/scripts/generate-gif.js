import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputFile = resolve(__dirname, '..', '..', 'docs', 'lab-05-dogfight.gif');

// 32-color palette (RGB triplets)
const PALETTE = [
  [16, 20, 20],     // 0: #101414 space background
  [27, 36, 36],     // 1: #1b2424 window container background
  [82, 102, 93],    // 2: #52665d window border
  [255, 255, 255],  // 3: #ffffff white ship 1 / bright text
  [94, 234, 212],   // 4: #5eead4 cyan ship 2
  [255, 213, 79],   // 5: #ffd54f yellow bullets
  [255, 112, 67],   // 6: #ff7043 orange thruster flame
  [167, 255, 131],  // 7: #a7ff83 netgraph green text
  [8, 14, 13],      // 8: #080e0d netgraph dark box
  [180, 216, 189],  // 9: #b4d8bd muted status text
  [232, 245, 233],  // 10: #e8f5e9 light text
  [40, 52, 48],     // 11: #283430 star / subtle grid
  [255, 82, 82],    // 12: #ff5252 red flash / damage
  [100, 116, 139],  // 13: #64748b gray
  [51, 65, 85],     // 14: #334155 dark gray
  [240, 253, 244],  // 15: #f0fdf4 soft white
  ...Array.from({ length: 16 }, () => [0, 0, 0]),
];

// Minimal 4x6 bitmap font for alphanumeric characters
const FONT = {
  '0': [0b0110, 0b1001, 0b1001, 0b1001, 0b1001, 0b0110],
  '1': [0b0010, 0b0110, 0b0010, 0b0010, 0b0010, 0b0111],
  '2': [0b0110, 0b1001, 0b0001, 0b0010, 0b0100, 0b1111],
  '3': [0b1110, 0b0001, 0b0110, 0b0001, 0b0001, 0b1110],
  '4': [0b1001, 0b1001, 0b1111, 0b0001, 0b0001, 0b0001],
  '5': [0b1111, 0b1000, 0b1110, 0b0001, 0b0001, 0b1110],
  '6': [0b0110, 0b1000, 0b1110, 0b1001, 0b1001, 0b0110],
  '7': [0b1111, 0b0001, 0b0010, 0b0100, 0b0100, 0b0100],
  '8': [0b0110, 0b1001, 0b0110, 0b1001, 0b1001, 0b0110],
  '9': [0b0110, 0b1001, 0b1001, 0b0111, 0b0001, 0b0110],
  'A': [0b0110, 0b1001, 0b1111, 0b1001, 0b1001, 0b1001],
  'B': [0b1110, 0b1001, 0b1110, 0b1001, 0b1001, 0b1110],
  'C': [0b0111, 0b1000, 0b1000, 0b1000, 0b1000, 0b0111],
  'D': [0b1110, 0b1001, 0b1001, 0b1001, 0b1001, 0b1110],
  'E': [0b1111, 0b1000, 0b1110, 0b1000, 0b1000, 0b1111],
  'F': [0b1111, 0b1000, 0b1110, 0b1000, 0b1000, 0b1000],
  'G': [0b0111, 0b1000, 0b1011, 0b1001, 0b1001, 0b0111],
  'H': [0b1001, 0b1001, 0b1111, 0b1001, 0b1001, 0b1001],
  'I': [0b0111, 0b0010, 0b0010, 0b0010, 0b0010, 0b0111],
  'J': [0b0001, 0b0001, 0b0001, 0b1001, 0b1001, 0b0110],
  'K': [0b1001, 0b1010, 0b1100, 0b1010, 0b1001, 0b1001],
  'L': [0b1000, 0b1000, 0b1000, 0b1000, 0b1000, 0b1111],
  'M': [0b1001, 0b1111, 0b1001, 0b1001, 0b1001, 0b1001],
  'N': [0b1001, 0b1101, 0b1011, 0b1001, 0b1001, 0b1001],
  'O': [0b0110, 0b1001, 0b1001, 0b1001, 0b1001, 0b0110],
  'P': [0b1110, 0b1001, 0b1110, 0b1000, 0b1000, 0b1000],
  'Q': [0b0110, 0b1001, 0b1001, 0b1001, 0b0110, 0b0001],
  'R': [0b1110, 0b1001, 0b1110, 0b1010, 0b1001, 0b1001],
  'S': [0b0111, 0b1000, 0b0110, 0b0001, 0b0001, 0b1110],
  'T': [0b1111, 0b0010, 0b0010, 0b0010, 0b0010, 0b0010],
  'U': [0b1001, 0b1001, 0b1001, 0b1001, 0b1001, 0b0110],
  'V': [0b1001, 0b1001, 0b1001, 0b1001, 0b0110, 0b0010],
  'W': [0b1001, 0b1001, 0b1001, 0b1001, 0b1111, 0b1001],
  'X': [0b1001, 0b1001, 0b0110, 0b0110, 0b1001, 0b1001],
  'Y': [0b1001, 0b1001, 0b0110, 0b0010, 0b0010, 0b0010],
  'Z': [0b1111, 0b0001, 0b0010, 0b0100, 0b1000, 0b1111],
  ':': [0b0000, 0b0110, 0b0110, 0b0000, 0b0110, 0b0110],
  '.': [0b0000, 0b0000, 0b0000, 0b0000, 0b0110, 0b0110],
  '/': [0b0001, 0b0010, 0b0100, 0b0100, 0b1000, 0b1000],
  '-': [0b0000, 0b0000, 0b1111, 0b0000, 0b0000, 0b0000],
  '|': [0b0010, 0b0010, 0b0010, 0b0010, 0b0010, 0b0010],
  '[': [0b0110, 0b0100, 0b0100, 0b0100, 0b0100, 0b0110],
  ']': [0b0110, 0b0010, 0b0010, 0b0010, 0b0010, 0b0110],
  ' ': [0b0000, 0b0000, 0b0000, 0b0000, 0b0000, 0b0000],
};

function drawPixel(buf, width, height, x, y, color) {
  if (x >= 0 && x < width && y >= 0 && y < height) {
    buf[y * width + x] = color;
  }
}

function fillRect(buf, width, height, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      drawPixel(buf, width, height, x + dx, y + dy, color);
    }
  }
}

function strokeRect(buf, width, height, x, y, w, h, color) {
  for (let dx = 0; dx < w; dx += 1) {
    drawPixel(buf, width, height, x + dx, y, color);
    drawPixel(buf, width, height, x + dx, y + h - 1, color);
  }
  for (let dy = 0; dy < h; dy += 1) {
    drawPixel(buf, width, height, x, y + dy, color);
    drawPixel(buf, width, height, x + w - 1, y + dy, color);
  }
}

function drawLine(buf, width, height, x0, y0, x1, y1, color) {
  x0 = Math.round(x0); y0 = Math.round(y0);
  x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    drawPixel(buf, width, height, x0, y0, color);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

function drawText(buf, width, height, str, startX, startY, color) {
  let curX = startX;
  const upper = str.toUpperCase();
  for (let i = 0; i < upper.length; i += 1) {
    const ch = upper[i];
    const bitmap = FONT[ch] || FONT[' '];
    for (let row = 0; row < 6; row += 1) {
      const bits = bitmap[row];
      for (let col = 0; col < 4; col += 1) {
        if (bits & (1 << (3 - col))) {
          drawPixel(buf, width, height, curX + col, startY + row, color);
        }
      }
    }
    curX += 5;
  }
}

function drawShip(buf, width, height, x, y, angle, color, thrust = false) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const p1x = x + cos * 14;
  const p1y = y + sin * 14;
  const p2x = x - cos * 9 - sin * 8;
  const p2y = y - sin * 9 + cos * 8;
  const p3x = x - cos * 9 + sin * 8;
  const p3y = y - sin * 9 - cos * 8;

  drawLine(buf, width, height, p1x, p1y, p2x, p2y, color);
  drawLine(buf, width, height, p2x, p2y, p3x, p3y, color);
  drawLine(buf, width, height, p3x, p3y, p1x, p1y, color);

  if (thrust) {
    const fx = x - cos * 15;
    const fy = y - sin * 15;
    drawLine(buf, width, height, p2x + cos * 2, p2y + sin * 2, fx, fy, 6);
    drawLine(buf, width, height, p3x + cos * 2, p3y + sin * 2, fx, fy, 6);
    drawPixel(buf, width, height, Math.round(fx), Math.round(fy), 5);
  }
}

function drawBullet(buf, width, height, x, y) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  drawPixel(buf, width, height, ix, iy, 5);
  drawPixel(buf, width, height, ix + 1, iy, 5);
  drawPixel(buf, width, height, ix, iy + 1, 5);
  drawPixel(buf, width, height, ix + 1, iy + 1, 5);
}

// LZW GIF encoder
function encodeGif({ width, height, frames, delay = 5, palette = PALETTE }) {
  const bytes = [];

  function writeWord(w) {
    bytes.push(w & 0xFF, (w >> 8) & 0xFF);
  }

  // 1. Header
  for (const c of 'GIF89a') bytes.push(c.charCodeAt(0));

  // 2. Logical Screen Descriptor
  writeWord(width);
  writeWord(height);
  // Packed: global color table flag (1), color res 4 (0100), sort (0), size 32 = 2^(4+1) -> 4
  bytes.push(0b11000100);
  bytes.push(0); // background color index
  bytes.push(0); // pixel aspect ratio

  // 3. Global Color Table (32 * 3 = 96 bytes)
  for (let i = 0; i < 32; i += 1) {
    const col = palette[i] || [0, 0, 0];
    bytes.push(col[0], col[1], col[2]);
  }

  // 4. Netscape 2.0 Loop Extension
  bytes.push(0x21, 0xFF, 0x0B);
  for (const c of 'NETSCAPE2.0') bytes.push(c.charCodeAt(0));
  bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

  // 5. Frames
  for (const frame of frames) {
    // Graphic Control Extension
    bytes.push(0x21, 0xF9, 0x04, 0x04); // disposal: restore to bg
    writeWord(delay); // delay time in 100ths of sec
    bytes.push(0, 0); // transparent index, block terminator

    // Image Descriptor
    bytes.push(0x2C);
    writeWord(0); // left
    writeWord(0); // top
    writeWord(width);
    writeWord(height);
    bytes.push(0); // no local color table

    // LZW Compression
    const minCodeSize = 5; // for 32 colors
    bytes.push(minCodeSize);

    const clearCode = 1 << minCodeSize; // 32
    const eoiCode = clearCode + 1;      // 33

    let codeSize = minCodeSize + 1;    // 6
    let nextCode = eoiCode + 1;        // 34

    let dict = new Map();
    function resetDict() {
      dict.clear();
      for (let i = 0; i < clearCode; i += 1) dict.set(String(i), i);
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
    }
    resetDict();

    const bitBuffer = [];
    let curBits = 0;
    let bitCount = 0;

    function emitCode(code) {
      curBits |= (code << bitCount);
      bitCount += codeSize;
      while (bitCount >= 8) {
        bitBuffer.push(curBits & 0xFF);
        curBits >>= 8;
        bitCount -= 8;
      }
    }

    emitCode(clearCode);

    let prefix = String(frame[0]);
    for (let i = 1; i < frame.length; i += 1) {
      const k = frame[i];
      const combined = `${prefix},${k}`;
      if (dict.has(combined)) {
        prefix = combined;
      } else {
        emitCode(dict.get(prefix));
        dict.set(combined, nextCode++);
        if (nextCode === (1 << codeSize) + 1 && codeSize < 12) {
          codeSize += 1;
        } else if (nextCode >= 4095) {
          emitCode(clearCode);
          resetDict();
        }
        prefix = String(k);
      }
    }
    emitCode(dict.get(prefix));
    emitCode(eoiCode);

    if (bitCount > 0) bitBuffer.push(curBits & 0xFF);

    // Write sub-blocks (max 254 bytes each)
    let offset = 0;
    while (offset < bitBuffer.length) {
      const chunkSize = Math.min(254, bitBuffer.length - offset);
      bytes.push(chunkSize);
      for (let i = 0; i < chunkSize; i += 1) {
        bytes.push(bitBuffer[offset + i]);
      }
      offset += chunkSize;
    }
    bytes.push(0); // Sub-block terminator
  }

  // 6. Trailer
  bytes.push(0x3B);
  return Buffer.from(bytes);
}

// Generate the 60-frame dogfight animation
const W = 720;
const H = 290;
const totalFrames = 60;
const frames = [];

// Simulation state
let ship1 = { x: 70, y: 150, vx: 50, vy: -20, angle: -0.3 };
let ship2 = { x: 260, y: 130, vx: -40, vy: 30, angle: 2.8 };
let bullets = [];

// Viewport layout:
// Window 1: x: 8..350, y: 8..282 (width: 342, height: 274)
// Window 2: x: 368..710, y: 8..282 (width: 342, height: 274)
const arenaW = 330;
const arenaH = 240;

for (let frameIdx = 0; frameIdx < totalFrames; frameIdx += 1) {
  const buf = new Uint8Array(W * H);
  fillRect(buf, W, H, 0, 0, W, H, 0); // space dark bg

  // Center separator
  for (let y = 0; y < H; y += 4) {
    drawPixel(buf, W, H, 359, y, 2);
  }

  // Update simulation
  const dt = 1 / 20;
  // Ship 1 maneuvers: turns and thrusts
  ship1.angle += 0.05;
  const thrust1 = frameIdx % 12 < 8;
  if (thrust1) {
    ship1.vx += Math.cos(ship1.angle) * 120 * dt;
    ship1.vy += Math.sin(ship1.angle) * 120 * dt;
  }
  ship1.vx *= 0.98;
  ship1.vy *= 0.98;
  ship1.x = ((ship1.x + ship1.vx * dt) % arenaW + arenaW) % arenaW;
  ship1.y = ((ship1.y + ship1.vy * dt) % arenaH + arenaH) % arenaH;

  // Ship 2 maneuvers: turns left, thrusts
  ship2.angle -= 0.06;
  const thrust2 = (frameIdx + 6) % 14 < 9;
  if (thrust2) {
    ship2.vx += Math.cos(ship2.angle) * 110 * dt;
    ship2.vy += Math.sin(ship2.angle) * 110 * dt;
  }
  ship2.vx *= 0.98;
  ship2.vy *= 0.98;
  ship2.x = ((ship2.x + ship2.vx * dt) % arenaW + arenaW) % arenaW;
  ship2.y = ((ship2.y + ship2.vy * dt) % arenaH + arenaH) % arenaH;

  // Firing logic
  if (frameIdx % 10 === 0) {
    bullets.push({
      x: ship1.x + Math.cos(ship1.angle) * 15,
      y: ship1.y + Math.sin(ship1.angle) * 15,
      vx: Math.cos(ship1.angle) * 220 + ship1.vx,
      vy: Math.sin(ship1.angle) * 220 + ship1.vy,
      ttl: 25,
    });
  }
  if ((frameIdx + 5) % 12 === 0) {
    bullets.push({
      x: ship2.x + Math.cos(ship2.angle) * 15,
      y: ship2.y + Math.sin(ship2.angle) * 15,
      vx: Math.cos(ship2.angle) * 220 + ship2.vx,
      vy: Math.sin(ship2.angle) * 220 + ship2.vy,
      ttl: 25,
    });
  }

  // Update bullets
  for (const b of bullets) {
    b.x = ((b.x + b.vx * dt) % arenaW + arenaW) % arenaW;
    b.y = ((b.y + b.vy * dt) % arenaH + arenaH) % arenaH;
    b.ttl -= 1;
  }
  bullets = bullets.filter((b) => b.ttl > 0);

  // Render both client windows
  const windows = [
    {
      ox: 10,
      oy: 10,
      title: 'CLIENT 1: PILOT ALPHA [PREDICTION + BINARY]',
      localShip: ship1,
      remoteShip: ship2,
      localColor: 3, // white
      remoteColor: 4, // cyan
      localThrust: thrust1,
      remoteThrust: thrust2,
      rtt: 102 + (frameIdx % 5) * 2,
      snapAge: 16 + (frameIdx % 4) * 5,
      correction: '0.08',
      pending: 2 + (frameIdx % 3),
    },
    {
      ox: 368,
      oy: 10,
      title: 'CLIENT 2: PILOT BRAVO [INTERPOLATION + BINARY]',
      localShip: ship2,
      remoteShip: ship1,
      localColor: 4, // cyan
      remoteColor: 3, // white
      localThrust: thrust2,
      remoteThrust: thrust1,
      rtt: 104 + (frameIdx % 4) * 2,
      snapAge: 20 + (frameIdx % 3) * 6,
      correction: '0.14',
      pending: 3 + (frameIdx % 2),
    },
  ];

  for (const win of windows) {
    const { ox, oy, title, localShip, remoteShip, localColor, remoteColor, localThrust, remoteThrust, rtt, snapAge, correction, pending } = win;

    // Window border
    strokeRect(buf, W, H, ox, oy, arenaW + 12, arenaH + 32, 2);
    // Title bar
    fillRect(buf, W, H, ox + 1, oy + 1, arenaW + 10, 14, 1);
    drawText(buf, W, H, title, ox + 6, oy + 4, 10);

    // Inner arena
    const ax = ox + 6;
    const ay = oy + 20;
    fillRect(buf, W, H, ax, ay, arenaW, arenaH, 0);

    // Subtle star field in arena
    const stars = [
      [30, 40], [120, 80], [210, 30], [290, 100],
      [60, 180], [170, 210], [260, 170], [140, 140],
    ];
    for (const [sx, sy] of stars) {
      drawPixel(buf, W, H, ax + sx, ay + sy, 11);
    }

    // Bullets
    for (const b of bullets) {
      drawBullet(buf, W, H, ax + b.x, ay + b.y);
    }

    // Ships
    drawShip(buf, W, H, ax + remoteShip.x, ay + remoteShip.y, remoteShip.angle, remoteColor, remoteThrust);
    drawShip(buf, W, H, ax + localShip.x, ay + localShip.y, localShip.angle, localColor, localThrust);

    // Netgraph overlay in top-left of arena
    const gx = ax + 6;
    const gy = ay + 6;
    fillRect(buf, W, H, gx, gy, 150, 72, 8);
    strokeRect(buf, W, H, gx, gy, 150, 72, 2);

    drawText(buf, W, H, `RTT: ${rtt} MS`, gx + 5, gy + 5, 7);
    drawText(buf, W, H, `SNAP AGE: ${snapAge} MS`, gx + 5, gy + 16, 7);
    drawText(buf, W, H, `TRAFFIC: 3.87/0.21 KB/S`, gx + 5, gy + 27, 7);
    drawText(buf, W, H, `PENDING INPUTS: ${pending}`, gx + 5, gy + 38, 7);
    drawText(buf, W, H, `CORRECTION: ${correction} PX`, gx + 5, gy + 49, 7);
    drawText(buf, W, H, `PREDICT | BIN | 30 FPS`, gx + 5, gy + 60, 7);
  }

  frames.push(buf);
}

const gifBuffer = encodeGif({ width: W, height: H, frames, delay: 5 });
writeFileSync(outputFile, gifBuffer);
console.log(`Generated GIF at ${outputFile} (${(gifBuffer.length / 1024).toFixed(1)} KB, ${totalFrames} frames)`);
