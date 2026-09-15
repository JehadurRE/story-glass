/**
 * Generates standards-compliant PNG icons and ICO files for StoryGlass.
 * Renders a vibrant, high-luminosity gradient with bold white glass optics.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

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

  const idatData = zlib.deflateSync(scanlines, { level: 9 });

  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idatData),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(pngBuffers) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngBuffers.length, 4);

  let offset = 6 + pngBuffers.length * 16;
  const dirEntries = [];
  for (const { width, height, buffer } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry[0] = width >= 256 ? 0 : width;
    entry[1] = height >= 256 ? 0 : height;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffers.map((p) => p.buffer)]);
}

// Draw vibrant, light, highly visible StoryGlass icon
function renderStoryGlassIcon(size) {
  const buf = Buffer.alloc(size * size * 4);

  // Gradient stops:
  // 0.00: #7928CA (121, 40, 202) - Violet
  // 0.28: #C13584 (193, 53, 132) - Magenta
  // 0.55: #FF0080 (255, 0, 128) - Hot Pink
  // 0.80: #FF4B2B (255, 75, 43) - Coral Red
  // 1.00: #FFB800 (255, 184, 0) - Amber Yellow
  function getGradientColor(t) {
    if (t < 0.28) {
      const u = t / 0.28;
      return [Math.round(121 + (193 - 121) * u), Math.round(40 + (53 - 40) * u), Math.round(202 + (132 - 202) * u)];
    } else if (t < 0.55) {
      const u = (t - 0.28) / 0.27;
      return [Math.round(193 + (255 - 193) * u), Math.round(53 + (0 - 53) * u), Math.round(132 + (128 - 132) * u)];
    } else if (t < 0.80) {
      const u = (t - 0.55) / 0.25;
      return [255, Math.round(0 + (75 - 0) * u), Math.round(128 + (43 - 128) * u)];
    } else {
      const u = (t - 0.80) / 0.20;
      return [255, Math.round(75 + (184 - 75) * u), Math.round(43 + (0 - 43) * u)];
    }
  }

  const cx = size / 2;
  const cy = size / 2;
  const strokeW = Math.max(1.4, size * 0.075);
  const lensR = size * 0.17;
  const camHalf = size * 0.30;
  const camR = size * 0.16;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Squircle outer boundary (fills frame with sleek rounded corners)
      const dx = Math.abs(x - cx) / (size * 0.48);
      const dy = Math.abs(y - cy) / (size * 0.48);
      const squircleDist = Math.pow(Math.pow(dx, 4) + Math.pow(dy, 4), 0.25);

      if (squircleDist > 1.04) {
        // Transparent outside
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      // Base: Radiant sunset gradient
      const gradT = (x + (size - y)) / (size * 2);
      const [gr, gg, gb] = getGradientColor(Math.max(0, Math.min(1, gradT)));

      let r = gr;
      let g = gg;
      let b = gb;
      let a = 255;

      // Anti-aliased edge
      if (squircleDist > 0.94) {
        const edgeAlpha = Math.max(0, Math.min(1, (1.04 - squircleDist) / 0.10));
        a = Math.round(255 * edgeAlpha);
      }

      // Top glass highlight sheen (brightens the top 45%)
      if (y < size * 0.45) {
        const sheen = (1 - y / (size * 0.45)) * 0.32;
        r = Math.min(255, Math.round(r + (255 - r) * sheen));
        g = Math.min(255, Math.round(g + (255 - g) * sheen));
        b = Math.min(255, Math.round(b + (255 - b) * sheen));
      }

      // Camera Box Rounded Rect distance
      const cdx = Math.max(0, Math.abs(x - cx) - (camHalf - camR));
      const cdy = Math.max(0, Math.abs(y - cy) - (camHalf - camR));
      const camDist = Math.hypot(cdx, cdy);
      const isCamBorder = Math.abs(camDist - camR) < strokeW / 2;

      // Center Circle Lens distance
      const distFromCenter = Math.hypot(x - cx, y - cy);
      const isLensRing = Math.abs(distFromCenter - lensR) < strokeW / 2;

      // Active Story Glint / Flash Dot at top right
      const glintX = cx + size * 0.20;
      const glintY = cy - size * 0.19;
      const distGlint = Math.hypot(x - glintX, y - glintY);
      const glintR = Math.max(1.2, size * 0.05);

      if (isCamBorder || isLensRing || distGlint < glintR) {
        // Pure crisp, luminous white (#FFFFFF)
        r = 255;
        g = 255;
        b = 255;
      } else if (distFromCenter < lensR - strokeW / 2) {
        // Inner optical prism core (Facebook Cyan/Blue reflection)
        const tint = 0.45;
        r = Math.round(r * (1 - tint) + 24 * tint);
        g = Math.round(g * (1 - tint) + 180 * tint);
        b = Math.round(b * (1 - tint) + 254 * tint);

        // Crescent glass reflection highlight inside lens
        if (y < cy - size * 0.02 && x < cx + size * 0.06) {
          r = Math.min(255, r + 90);
          g = Math.min(255, g + 90);
          b = Math.min(255, b + 90);
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

  if (size === 16 || size === 32) {
    pngIconsForIco.push({ width: size, height: size, buffer: png });
  }
}

// Generate 48x48 for ICO
const rgba48 = renderStoryGlassIcon(48);
const png48 = encodePng(48, 48, rgba48);
pngIconsForIco.push({ width: 48, height: 48, buffer: png48 });

// Generate root favicon.ico containing 16x16, 32x32, 48x48
const ico = encodeIco(pngIconsForIco);
fs.writeFileSync('favicon.ico', ico);
console.log(`Generated favicon.ico (${ico.length} bytes)`);

// Save apple-touch-icon.png in root as well
fs.copyFileSync(path.join('assets', 'apple-touch-icon.png'), 'apple-touch-icon.png');
console.log('Copied apple-touch-icon.png to root');
