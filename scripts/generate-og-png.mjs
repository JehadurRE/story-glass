/**
 * Generates assets/og-image.png (1200x630) social share card.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

function encodePng(width, height, rgbaBuffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = width * 4;
  const scanlines = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowBytes + 1);
    scanlines[rowOffset] = 0;
    rgbaBuffer.copy(scanlines, rowOffset + 1, y * rowBytes, (y + 1) * rowBytes);
  }

  const idatData = zlib.deflateSync(scanlines, { level: 6 });
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idatData),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const W = 1200;
const H = 630;
const buf = Buffer.alloc(W * H * 4);

function getIgGradient(t) {
  // #833AB4 (131,58,180) -> #E1306C (225,48,108) -> #FD1D1D (253,29,29) -> #FCAF45 (252,175,69)
  if (t < 0.33) {
    const u = t / 0.33;
    return [Math.round(131 + 94 * u), Math.round(58 - 10 * u), Math.round(180 - 72 * u)];
  } else if (t < 0.66) {
    const u = (t - 0.33) / 0.33;
    return [Math.round(225 + 28 * u), Math.round(48 - 19 * u), Math.round(108 - 79 * u)];
  } else {
    const u = (t - 0.66) / 0.34;
    return [Math.round(253 - 1 * u), Math.round(29 + 146 * u), Math.round(29 + 40 * u)];
  }
}

// Render rich dark gradient background
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = (y * W + x) * 4;

    // Dark slate background: #0A0D14
    let r = 10;
    let g = 13;
    let b = 20;

    // Ambient top-left violet glow
    const d1 = Math.hypot(x - 200, y - 150) / 450;
    if (d1 < 1) {
      const w1 = Math.pow(1 - d1, 2);
      r += Math.round(131 * 0.28 * w1);
      g += Math.round(58 * 0.28 * w1);
      b += Math.round(180 * 0.28 * w1);
    }

    // Ambient top-right magenta glow
    const d2 = Math.hypot(x - 950, y - 250) / 500;
    if (d2 < 1) {
      const w2 = Math.pow(1 - d2, 2);
      r += Math.round(225 * 0.25 * w2);
      g += Math.round(48 * 0.25 * w2);
      b += Math.round(108 * 0.25 * w2);
    }

    // Ambient bottom blue glow
    const d3 = Math.hypot(x - 600, y - 600) / 550;
    if (d3 < 1) {
      const w3 = Math.pow(1 - d3, 2);
      r += Math.round(24 * 0.3 * w3);
      g += Math.round(119 * 0.3 * w3);
      b += Math.round(242 * 0.3 * w3);
    }

    // Subtle grid lines every 70px
    if (x % 70 === 0 || y % 70 === 0) {
      r += 4;
      g += 5;
      b += 7;
    }

    // StoryGlass Icon in banner at (100, 100, size 110)
    const ix = x - 100;
    const iy = y - 100;
    const isize = 110;
    if (ix >= 0 && ix < isize && iy >= 0 && iy < isize) {
      const icx = isize / 2;
      const icy = isize / 2;
      const dx = Math.abs(ix - icx) / (isize * 0.48);
      const dy = Math.abs(iy - icy) / (isize * 0.48);
      const sDist = Math.pow(Math.pow(dx, 4) + Math.pow(dy, 4), 0.25);
      if (sDist <= 1.0) {
        const gradT = (ix + (isize - iy)) / (isize * 2);
        const [gr, gg, gb] = getIgGradient(Math.max(0, Math.min(1, gradT)));
        r = gr; g = gg; b = gb;

        if (iy < isize * 0.45) {
          const sheen = (1 - iy / (isize * 0.45)) * 0.32;
          r = Math.min(255, Math.round(r + (255 - r) * sheen));
          g = Math.min(255, Math.round(g + (255 - g) * sheen));
          b = Math.min(255, Math.round(b + (255 - b) * sheen));
        }

        const strokeW = Math.max(2.5, isize * 0.075);
        const camHalf = isize * 0.30;
        const camR = isize * 0.16;
        const cdx = Math.max(0, Math.abs(ix - icx) - (camHalf - camR));
        const cdy = Math.max(0, Math.abs(iy - icy) - (camHalf - camR));
        const camDist = Math.hypot(cdx, cdy);
        const isCamBorder = Math.abs(camDist - camR) < strokeW / 2;

        const distCenter = Math.hypot(ix - icx, iy - icy);
        const lensR = isize * 0.17;
        const isLensRing = Math.abs(distCenter - lensR) < strokeW / 2;

        const glintX = icx + isize * 0.20;
        const glintY = icy - isize * 0.19;
        const isGlint = Math.hypot(ix - glintX, iy - glintY) < Math.max(2, isize * 0.05);

        if (isCamBorder || isLensRing || isGlint) {
          r = 255; g = 255; b = 255;
        } else if (distCenter < lensR - strokeW / 2) {
          r = Math.round(r * 0.5 + 24 * 0.5);
          g = Math.round(g * 0.5 + 180 * 0.5);
          b = Math.round(b * 0.5 + 254 * 0.5);
        }
      }
    }

    // Mockup phone card on the right (x: 750 to 1100, y: 80 to 550)
    if (x >= 750 && x <= 1100 && y >= 80 && y <= 550) {
      const cxMock = 925;
      const cyMock = 315;
      const mdx = Math.abs(x - cxMock) / 175;
      const mdy = Math.abs(y - cyMock) / 235;
      const mDist = Math.pow(Math.pow(mdx, 4) + Math.pow(mdy, 4), 0.25);
      if (mDist <= 1.0) {
        if (mDist > 0.95) {
          // Card border
          r = 55; g = 65; b = 85;
        } else {
          // Card interior
          r = 16; g = 20; b = 30;

          // Story progress segments at top
          if (y >= 105 && y <= 110 && x >= 780 && x <= 1070) {
            const segW = 52;
            const gap = 8;
            const relX = x - 780;
            const segIdx = Math.floor(relX / (segW + gap));
            if (relX % (segW + gap) < segW) {
              if (segIdx <= 2) {
                r = 255; g = 255; b = 255;
              } else {
                r = 80; g = 85; b = 100;
              }
            }
          }

          // User story ring avatar
          const dAv = Math.hypot(x - 810, y - 145);
          if (dAv <= 18) {
            if (dAv >= 15) {
              const [gr, gg, gb] = getIgGradient(dAv / 18);
              r = gr; g = gg; b = gb;
            } else {
              r = 220; g = 225; b = 240;
            }
          }

          // Video placeholder stage (y: 180 to 470, x: 775 to 1075)
          if (x >= 775 && x <= 1075 && y >= 180 && y <= 470) {
            const vBorder = x === 775 || x === 1075 || y === 180 || y === 470;
            if (vBorder) {
              r = 40; g = 48; b = 65;
            } else {
              r = 24; g = 30; b = 45;
              // Radiant center art
              const dArt = Math.hypot(x - 925, y - 325);
              if (dArt <= 65) {
                const [gr, gg, gb] = getIgGradient(dArt / 65);
                r = Math.round(gr * 0.85);
                g = Math.round(gg * 0.85);
                b = Math.round(gb * 0.85);
              }
              // Play triangle button
              if (dArt <= 22) {
                r = 255; g = 255; b = 255;
              }
            }
          }
        }
      }
    }

    buf[idx] = Math.min(255, r);
    buf[idx + 1] = Math.min(255, g);
    buf[idx + 2] = Math.min(255, b);
    buf[idx + 3] = 255;
  }
}

const png = encodePng(W, H, buf);
fs.writeFileSync(path.join('assets', 'og-image.png'), png);
console.log(`Generated assets/og-image.png (${W}x${H}, ${png.length} bytes)`);
