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
  const rows = [], SS = 4; // 4x4 supersampling for clean edges at 18px
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let i = 0; i < SS; i++) for (let j = 0; j < SS; j++) sum += alphaAt(x + (i + 0.5) / SS, y + (j + 0.5) / SS, size);
      row[1 + x * 4 + 3] = Math.round(255 * sum / (SS * SS));
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
// a control tower: beacon, mast, cab, column, base (coordinates in an 18-unit grid).
// The beacon carries the fleet state: hollow when nothing runs, filled when sessions are alive, haloed when something needs you.
const tower = (state) => (x, y, s) => {
  const u = s / 18, px = x / u, py = y / u;
  const d = Math.hypot(px - 9, py - 2.6);
  const beacon = state === 'empty' ? (d < 1.7 && d >= 0.9 ? 1 : 0) : (d < 1.7 ? 1 : 0);
  const halo = state === 'needs' && d >= 2.5 && d < 3.2 ? 1 : 0;
  const mast = Math.abs(px - 9) < 0.6 && py >= 4 && py <= 5.8 ? 1 : 0;
  const cabHalf = 5.3 - (py - 5.8) * (1.4 / 3.9); // trapezoid from y 5.8 to 9.7
  const cab = py >= 5.8 && py <= 9.7 && Math.abs(px - 9) <= cabHalf ? 1 : 0;
  const column = py > 9.7 && py <= 15.5 && Math.abs(px - 9) <= 1.7 ? 0.75 : 0;
  const base = py > 15.5 && py <= 16.9 && Math.abs(px - 9) <= 3.7 ? 1 : 0;
  return Math.max(beacon, halo, mast, cab, column, base);
};
for (const [state, name] of [['empty', 'iconTemplate'], ['live', 'iconLiveTemplate'], ['needs', 'iconNeedsTemplate']]) {
  writeFileSync(new URL(`./${name}.png`, import.meta.url), png(18, tower(state)));
  writeFileSync(new URL(`./${name}@2x.png`, import.meta.url), png(36, tower(state)));
}
console.log('icons written');
