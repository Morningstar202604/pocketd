/**
 * 极简 PNG 解码器：只为「读回像素做断言」这一用途，支持 8 位 RGB/RGBA + 全部 5 种行过滤器。
 * 不处理隔行扫描（interlace），遇到就直接报错而不是给出错误像素。
 *
 * 用法（作为模块）: import { decodePng } from './tools/png-read.mjs'
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];
  if (bitDepth !== 8) throw new Error(`只支持 8 位，实际 ${bitDepth}`);
  if (interlace !== 0) throw new Error('不支持隔行扫描 PNG');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels) throw new Error(`不支持的颜色类型 ${colorType}`);

  let off = 8;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));

  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * stride;
    const srcStart = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[srcStart + x];
      const left = x >= channels ? out[rowStart + x - channels] : 0;
      const up = y > 0 ? out[rowStart - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? out[rowStart - stride + x - channels] : 0;
      let value;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + left; break;
        case 2: value = rawByte + up; break;
        case 3: value = rawByte + ((left + up) >> 1); break;
        case 4: value = rawByte + paeth(left, up, upLeft); break;
        default: throw new Error(`未知过滤器 ${filter}`);
      }
      out[rowStart + x] = value & 0xff;
    }
  }

  return {
    width,
    height,
    channels,
    pixel(x, y) {
      const i = y * stride + x * channels;
      return {
        r: out[i],
        g: out[i + 1],
        b: out[i + 2],
        a: channels === 4 ? out[i + 3] : 255,
      };
    },
  };
}

export function hex({ r, g, b }) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
