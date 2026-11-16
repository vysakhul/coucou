// Writes app-icon.png (1024×1024), Notchy's placeholder icon: a dark tile with
// a notch at the top and an indigo dot. Run `npm run icons` to regenerate the
// Tauri icon set from it. No image library needed.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 1024;
const px = Buffer.alloc((S * 4 + 1) * S);

// Signed distance to a rounded rectangle centred at (cx, cy).
const roundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const cover = (d) => Math.max(0, Math.min(1, 0.5 - d));

for (let y = 0; y < S; y++) {
  const row = y * (S * 4 + 1);
  px[row] = 0;
  for (let x = 0; x < S; x++) {
    let [r, g, b, a] = [0, 0, 0, 0];
    const blend = (cr, cg, cb, k) => {
      r = r * (1 - k) + cr * k;
      g = g * (1 - k) + cg * k;
      b = b * (1 - k) + cb * k;
      a = a + (255 - a) * k;
    };
    blend(20, 21, 24, cover(roundRect(x, y, 512, 512, 480, 480, 200)));
    blend(0, 0, 0, cover(roundRect(x, y, 512, 160, 300, 128, 96)));
    blend(99, 102, 241, cover(Math.hypot(x - 512, y - 600) - 170));
    blend(255, 255, 255, cover(Math.hypot(x - 572, y - 540) - 46) * 0.85);
    const o = row + 1 + x * 4;
    px[o] = r;
    px[o + 1] = g;
    px[o + 2] = b;
    px[o + 3] = a;
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(px)),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("../app-icon.png", import.meta.url), png);
console.log("app-icon.png written");
