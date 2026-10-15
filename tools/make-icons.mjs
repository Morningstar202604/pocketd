/**
 * 生成 PWA / iOS 所需的 PNG 图标。
 *
 * 为什么自绘而不装 sharp/resvg：这里只需要两个形状（圆角矩形 + 三笔画 Z），
 * PNG 容器用 node:zlib 就能编码，避免为一个构建期任务引入原生依赖。
 * iOS 的 apple-touch-icon 不支持 SVG，所以必须有 PNG。
 *
 * 用法: node tools/make-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "public");
const BRAND = { r: 0x4f, g: 0x8c, b: 0xff };
const WHITE = { r: 255, g: 255, b: 255 };
const SS = 4; // 超采样倍数，用于抗锯齿

/* ── PNG 编码 ── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array，长度 = w*h*4 */
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // 每行前置 filter byte 0
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y += 1) {
    const rowStart = y * (w * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * w * 4, (y + 1) * w * 4);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ── 几何（坐标系固定为 0..32，与 SVG viewBox 一致） ── */

function insideRoundedRect(x, y, size, radius) {
  const r = radius;
  if (x < 0 || y < 0 || x > size || y > size) return false;
  // 四个角分别在对应圆心内测距
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / len2));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 标记几何：小写 d —— 竖笔（字升部）+ 圆环（字腹），与 Brand.tsx 同参数。
 * maskable 版本按 factor 围绕中心 (16,16) 缩放，落在 80% 安全区内。
 */
function markShapes(scale) {
  const s = scale.factor;
  const c = 16;
  const px = (v) => c + (v - c) * s;
  return {
    stem: [px(21.3), px(9.5), px(21.3), px(22.5), (2.6 * s) / 2],
    bowl: [px(16.3), px(17.5), 5 * s, (2.6 * s) / 2],
  };
}

function insideMark(x, y, scale) {
  const { stem, bowl } = markShapes(scale);
  if (distToSegment(x, y, stem[0], stem[1], stem[2], stem[3]) <= stem[4]) return true;
  const [cx, cy, r, half] = bowl;
  const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  return Math.abs(d - r) <= half;
}

/* ── 渲染 ── */

function renderIcon(size, { cornerRadius = 8, fullBleed = true, glyphScale = 1 }) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 32;
  const scale = { factor: fullBleed ? 1 : glyphScale };

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          // 采样点落在像素中心
          const ux = (px + (sx + 0.5) / SS) / s;
          const uy = (py + (sy + 0.5) / SS) / s;
          const inTile = fullBleed
            ? insideRoundedRect(ux, uy, 32, cornerRadius)
            : ux >= 0 && uy >= 0 && ux <= 32 && uy <= 32;
          if (!inTile) continue;
          bgHits += 1;
          if (insideMark(ux, uy, scale)) fgHits += 1;
        }
      }
      const total = SS * SS;
      const bgA = bgHits / total;
      const fgA = fgHits / total;
      const i = (py * size + px) * 4;
      // 前景叠在背景上做 alpha 合成
      const mix = (bg, fg) => Math.round(bg * (1 - fgA) + fg * fgA);
      rgba[i] = mix(BRAND.r, WHITE.r);
      rgba[i + 1] = mix(BRAND.g, WHITE.g);
      rgba[i + 2] = mix(BRAND.b, WHITE.b);
      rgba[i + 3] = Math.round(bgA * 255);
    }
  }
  return encodePng(size, size, rgba);
}

/* ── 输出 ── */

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: "pocketd-192.png", size: 192, opts: { cornerRadius: 8 } },
  { file: "pocketd-512.png", size: 512, opts: { cornerRadius: 8 } },
  { file: "pocketd-maskable-512.png", size: 512, opts: { fullBleed: false, glyphScale: 0.8 } },
  { file: "pocketd-apple-touch-icon.png", size: 180, opts: { cornerRadius: 0 } },
];

for (const { file, size, opts } of targets) {
  const png = renderIcon(size, opts);
  writeFileSync(join(OUT_DIR, file), png);
  // 自检：PNG 头 + IHDR 里的宽高必须与请求一致
  const ok =
    png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    png.readUInt32BE(16) === size &&
    png.readUInt32BE(20) === size;
  if (!ok) throw new Error(`${file} 生成失败：PNG 头或尺寸校验不通过`);
  console.log(`${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB  校验通过`);
}
