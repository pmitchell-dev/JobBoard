const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Ensure extension/icons dir exists
const iconsDir = path.join(__dirname, 'extension', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Simple PNG generator in Node.js without third party libs
function createPNG(width, height, drawFn) {
  // RGBA buffer
  const buffer = Buffer.alloc(width * height * 4);
  drawFn(buffer, width, height);

  // Filter byte 0 per scanline
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    scanlines[y * (width * 4 + 1)] = 0; // Filter None
    buffer.copy(
      scanlines,
      y * (width * 4 + 1) + 1,
      y * width * 4,
      (y + 1) * width * 4
    );
  }

  const idat = zlib.deflateSync(scanlines);

  // PNG Header
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR Chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT Chunk
  const idatChunk = makeChunk('IDAT', idat);

  // IEND Chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(4 + 4 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const crc = crc32(buf.slice(4, 8 + len));
  buf.writeUInt32BE(crc, 8 + len);
  return buf;
}

// CRC32 implementation
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    let byte = buf[i];
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

// Drawing function for sleek JobBoard Icon (Briefcase + Dark Glass Gradient)
function drawBriefcase(buf, w, h) {
  const cx = w / 2;
  const cy = h / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;

      // Outer circle background with subtle gradient
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxR = w * 0.48;

      if (dist <= maxR) {
        // Deep indigo / violet gradient
        const t = (y / h);
        const r = Math.round(99 * (1 - t) + 79 * t);
        const g = Math.round(102 * (1 - t) + 70 * t);
        const b = Math.round(241 * (1 - t) + 229 * t);
        buf[idx]     = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = 255;
      } else {
        // Transparent
        buf[idx + 3] = 0;
        continue;
      }

      // Draw Briefcase Icon shape inside (white / light cyan)
      const nx = x / w;
      const ny = y / h;

      // Handle (top loop)
      const inHandle = (nx >= 0.40 && nx <= 0.60) && (ny >= 0.22 && ny <= 0.35) &&
                       !(nx >= 0.45 && nx <= 0.55 && ny >= 0.27 && ny <= 0.35);

      // Body
      const inBody = (nx >= 0.22 && nx <= 0.78) && (ny >= 0.35 && ny <= 0.76);

      // Clasp detail line
      const inLatch = (nx >= 0.44 && nx <= 0.56) && (ny >= 0.48 && ny <= 0.58);

      if (inHandle || (inBody && !inLatch)) {
        buf[idx]     = 255;
        buf[idx + 1] = 255;
        buf[idx + 2] = 255;
        buf[idx + 3] = 255;
      } else if (inLatch) {
        buf[idx]     = 99;
        buf[idx + 1] = 102;
        buf[idx + 2] = 241;
        buf[idx + 3] = 255;
      }
    }
  }
}

[16, 48, 128].forEach(size => {
  const pngData = createPNG(size, size, drawBriefcase);
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, pngData);
  console.log(`Generated ${filePath}`);
});
