/**
 * Generates standards-compliant PNG icons and ICO files for StoryGlass.
 * Uses pure Node.js built-in modules (zlib, fs).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Table for CRC-32
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
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

  // IHDR: width(4), height(4), bitDepth(1)=8, colorType(1)=6(RGBA), comp(1)=0, filter(1)=0, interlace(1)=0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Scanlines with filter byte 0 (None)
  const rowBytes = width * 4;
  const scanlines = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowBytes + 1);
    scanlines[rowOffset] = 0;
    rgbaBuffer.copy(scanlines, rowOffset + 1, y * rowBytes, (y + 1) * rowBytes);
  }

  const idatData = zlib.deflateSync(scanlines, { level: 9 });

  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idatData),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(pngBuffers) {
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: 1 = icon
  header.writeUInt16LE(pngBuffers.length, 4); // Count

  let offset = 6 + pngBuffers.length * 16;
  const dirEntries = [];
  for (const { width, height, buffer } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry[0] = width >= 256 ? 0 : width;
    entry[1] = height >= 256 ? 0 : height;
    entry[2] = 0; // Colors
    entry[3] = 0; // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(buffer.length, 8); // Size
    entry.writeUInt32LE(offset, 12); // Offset
    dirEntries.push(entry);
    offset += buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffers.map((p) => p.buffer)]);
}

// Draw StoryGlass icon into an RGBA pixel buffer
function renderStoryGlassIcon(size) {
  const buf = Buffer.alloc(size * size * 4);

  // Gradient stops: #833AB4 (131,58,180) -> #E1306C (225,48,108) -> #FCAF45 (252,175,69)
  function getGradientColor(t) {
    if (t < 0.5) {
      const u = t / 0.5;
      return [
        Math.round(131 + (225 - 131) * u),
        Math.round(58 + (48 - 58) * u),
        Math.round(180 + (108 - 180) * u),
      ];
    } else {
      const u = (t - 0.5) / 0.5;
      return [
        Math.round(225 + (252 - 225) * u),
        Math.round(48 + (175 - 48) * u),
        Math.round(108 + (69 - 108) * u),
      ];
    }
  }

  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.44;
  const rInner = size * 0.38;
  const rAperture = size * 0.22;
  const apertureWidth = Math.max(1.5, size * 0.05);
  const rCore = size * 0.14;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Squircle distance approximation
      const dx = Math.abs(x - cx) / (size * 0.46);
      const dy = Math.abs(y - cy) / (size * 0.46);
      const squircleDist = Math.pow(Math.pow(dx, 4) + Math.pow(dy, 4), 0.25);

      if (squircleDist > 1.05) {
        // Transparent outside
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      // Base squircle dark glass body
      let r = 14;
      let g = 17;
      let b = 24;
      let a = 255;

      // Anti-aliased outer edge
      if (squircleDist > 0.96) {
        const edgeAlpha = Math.max(0, Math.min(1, (1.05 - squircleDist) / 0.09));
        a = Math.round(255 * edgeAlpha);
      }

      // Gradient story border
      if (squircleDist <= 0.98 && squircleDist >= 0.82) {
        const t = (x + y) / (size * 2);
        const [gr, gg, gb] = getGradientColor(t);
        r = gr;
        g = gg;
        b = gb;
      }

      // Radial distance from center
      const distFromCenter = Math.hypot(x - cx, y - cy);

      // Camera ring / Story aperture
      if (Math.abs(distFromCenter - rAperture) < apertureWidth) {
        const t = 1 - (x + (size - y)) / (size * 2);
        const [gr, gg, gb] = getGradientColor(Math.max(0, Math.min(1, t)));
        r = gr;
        g = gg;
        b = gb;
      } else if (distFromCenter < rCore) {
        // Inner optic lens (cyan/blue tint reflection)
        r = Math.round(18 + 10 * (x / size));
        g = Math.round(119 + 60 * (1 - y / size));
        b = Math.round(242);
      }

      // Active story indicator / glint at top right
      const glintX = cx + size * 0.24;
      const glintY = cy - size * 0.24;
      const distGlint = Math.hypot(x - glintX, y - glintY);
      const glintR = Math.max(1.5, size * 0.05);
      if (distGlint < glintR) {
        r = 252;
        g = 175;
        b = 69;
      } else if (distGlint < glintR * 1.5) {
        r = 255;
        g = 255;
        b = 255;
      }

      // Diagonal glass specular reflection sheen
      if (y > size * 0.15 && y < size * 0.38) {
        const sheenDist = Math.abs((x - y) - size * 0.05);
        if (sheenDist < size * 0.15) {
          r = Math.min(255, r + 40);
          g = Math.min(255, g + 40);
          b = Math.min(255, b + 45);
        }
      }

      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = a;
    }
  }
  return buf;
}

// Generate all sizes
const sizes = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

const pngIconsForIco = [];

for (const { name, size } of sizes) {
  const rgba = renderStoryGlassIcon(size);
  const png = encodePng(size, size, rgba);
  fs.writeFileSync(path.join('assets', name), png);
  console.log(`Generated assets/${name} (${size}x${size}, ${png.length} bytes)`);

  if (size === 16 || size === 32 || size === 48) {
    pngIconsForIco.push({ width: size, height: size, buffer: png });
  }
}

// Generate favicon-48x48 for ICO
const rgba48 = renderStoryGlassIcon(48);
const png48 = encodePng(48, 48, rgba48);
pngIconsForIco.push({ width: 48, height: 48, buffer: png48 });

// Generate root favicon.ico containing 16x16, 32x32, 48x48
const ico = encodeIco(pngIconsForIco);
fs.writeFileSync('favicon.ico', ico);
console.log(`Generated favicon.ico (${ico.length} bytes)`);

// Also save apple-touch-icon.png in root as well as assets/
fs.copyFileSync(path.join('assets', 'apple-touch-icon.png'), 'apple-touch-icon.png');
console.log('Copied apple-touch-icon.png to root');
