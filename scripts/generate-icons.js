import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';

// Native geometric logo, rasterized with antialiasing. No external assets.
function inside(x, y, left, top, width, height, radius) {
  const dx = Math.max(left + radius - x, 0, x - left - width + radius);
  const dy = Math.max(top + radius - y, 0, y - top - height + radius);
  return x >= left && x <= left + width && y >= top && y <= top + height && dx * dx + dy * dy <= radius * radius;
}
function color(x, y) {
  if (!inside(x, y, 0, 0, 128, 128, 30)) return [0, 0, 0, 0];
  if (inside(x, y, 49, 29, 48, 57, 9)) return [139, 197, 166, 255];
  if (inside(x, y, 31, 43, 48, 57, 9)) {
    if (inside(x, y, 40, 56, 29, 5, 2)) return [32, 83, 63, 255];
    return [244, 248, 238, 255];
  }
  return [32, 83, 63, 255];
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
await mkdir(new URL('../icons/', import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const total = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const sample = color((x + (sx + 0.5) / 4) * 128 / size, (y + (sy + 0.5) / 4) * 128 / size);
        sample.forEach((v, c) => total[c] += v);
      }
      total.forEach((v, c) => pixels[y * (size * 4 + 1) + 1 + x * 4 + c] = Math.round(v / 16));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  await writeFile(new URL(`../icons/icon${size}.png`, import.meta.url), png);
}
