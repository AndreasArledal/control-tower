// Generates the menu bar template icons (black + alpha) without any image library.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, alphaAt) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) { const a = Math.round(255 * alphaAt(x + 0.5, y + 0.5, size)); row[1 + x * 4 + 3] = a; }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
// a radar: two rings and a centre dot
const ring = (d, r, w) => Math.max(0, Math.min(1, 1 - (Math.abs(d - r) - w / 2) * 2));
const alphaAt = (x, y, s) => { const u = s / 18, d = Math.hypot(x - s / 2, y - s / 2) / u; return Math.max(ring(d, 7.2, 1.6), ring(d, 4, 1.4) * 0.75, d < 1.4 ? 1 : 0); };
writeFileSync(new URL('./iconTemplate.png', import.meta.url), png(18, alphaAt));
writeFileSync(new URL('./iconTemplate@2x.png', import.meta.url), png(36, alphaAt));
console.log('icons written');
