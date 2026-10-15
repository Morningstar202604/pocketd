/**
 * 品牌资产必须结构正确：PNG 头、尺寸、品牌色像素、几何形状、maskable 安全区。
 * 图标由 tools/make-icons.mjs 生成并入库，属静态资产——格式合法不等于语义合法，
 * 所以这里校验到像素，并与界面组件的几何定义交叉核对。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error png-read.mjs 是构建工具里的运行期模块，无类型声明
import { decodePng, hex } from "../tools/png-read.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "ui", "public");
const BRAND = { r: 0x4f, g: 0x8c, b: 0xff };

const PNG_TARGETS = [
  { file: "pocketd-192.png", size: 192 },
  { file: "pocketd-512.png", size: 512 },
  { file: "pocketd-maskable-512.png", size: 512 },
  { file: "pocketd-apple-touch-icon.png", size: 180 },
];

/** 标记几何（与 ui/src/components/Brand.tsx 的 MARK 同值，单位是 32×32 视口） */
const MARK = {
  stemX: 21.3,
  stemY1: 9.5,
  stemY2: 22.5,
  bowlCx: 16.3,
  bowlCy: 17.5,
  bowlR: 5,
  stroke: 2.6,
};

const isWhite = (p: { r: number; g: number; b: number; a: number }) =>
  p.a > 200 && p.r > 200 && p.g > 200 && p.b > 200;
const isBrand = (p: { r: number; g: number; b: number }) => hex(p) === hex(BRAND);

describe("品牌图标资产", () => {
  for (const { file, size } of PNG_TARGETS) {
    it(`${file} 存在且是 ${size}x${size} 的合法 PNG`, () => {
      const path = join(PUBLIC, file);
      assert.ok(existsSync(path), `${file} 缺失，跑 npm run icons 重新生成`);
      const png = decodePng(path);
      assert.equal(png.width, size);
      assert.equal(png.height, size);
      // 四角必须是品牌蓝（full-bleed 底色）
      assert.ok(isBrand(png.pixel(2, 2)), `${file} 左上角应为品牌色`);
    });
  }

  it("标记是小写 d：竖笔与圆环为白色，圆环内部是底色", () => {
    const png = decodePng(join(PUBLIC, "pocketd-512.png"));
    const s = png.width / 32;
    const at = (vx: number, vy: number) => png.pixel(Math.round(vx * s), Math.round(vy * s));

    // 竖笔中段
    assert.ok(isWhite(at(MARK.stemX, 16)), "竖笔应为白色");
    // 圆环的下沿（bowlCy + r）
    assert.ok(isWhite(at(MARK.bowlCx, MARK.bowlCy + MARK.bowlR)), "圆环下沿应为白色");
    // 圆环的左沿（bowlCx - r）
    assert.ok(isWhite(at(MARK.bowlCx - MARK.bowlR, MARK.bowlCy)), "圆环左沿应为白色");
    // 圆环内部必须是底色 —— 这一条区分「环」与「实心圆」
    assert.ok(
      isBrand(at(MARK.bowlCx, MARK.bowlCy)),
      "圆环内部应为底色（否则就成了实心圆，不是字母 d）",
    );
    // 竖笔与圆环相接处不能断开
    assert.ok(isWhite(at(MARK.bowlCx + MARK.bowlR, MARK.bowlCy)), "竖笔与圆环应相接");
  });

  it("maskable 图标把图形收在中心安全区内（外圈只有底色）", () => {
    const png = decodePng(join(PUBLIC, "pocketd-maskable-512.png"));
    const size = png.width;
    // 安全区外沿（6% 处，纵向中心）不该出现白色
    for (const frac of [0.06, 0.1, 0.94]) {
      const p = png.pixel(Math.floor(size * 1 * 0 + size * frac), Math.floor(size * 0.5));
      assert.ok(isBrand(p), `安全区外 (x=${frac}) 应为纯底色，实际 ${hex(p)}`);
    }
    // 但中心附近必须扫得到白色笔画，否则图形被裁没了
    let whiteSeen = false;
    const y = Math.floor(size * 0.55);
    for (let x = 0; x < size; x += 1) {
      if (isWhite(png.pixel(x, y))) {
        whiteSeen = true;
        break;
      }
    }
    assert.ok(whiteSeen, "maskable 图标中心区域应能扫到 d 笔画");
  });

  it("favicon SVG 与组件使用同一几何定义", () => {
    const svg = readFileSync(join(PUBLIC, "pocketd-icon.svg"), "utf8");
    const comp = readFileSync(join(HERE, "..", "ui", "src", "components", "Brand.tsx"), "utf8");

    // 竖笔：SVG 里是一条 M x y1 V y2
    const stem = new RegExp(`M${MARK.stemX} ${MARK.stemY1}V${MARK.stemY2}`);
    assert.ok(stem.test(svg), `SVG 竖笔几何与 MARK 不一致（期望 ${stem}）`);
    assert.match(comp, new RegExp(`x: ${MARK.stemX}, y1: ${MARK.stemY1}, y2: ${MARK.stemY2}`));
    // 圆环
    assert.match(svg, new RegExp(`cx="${MARK.bowlCx}" cy="${MARK.bowlCy}" r="${MARK.bowlR}"`));
    assert.match(comp, new RegExp(`cx: ${MARK.bowlCx}, cy: ${MARK.bowlCy}, r: ${MARK.bowlR}`));
    // 线宽
    assert.match(svg, new RegExp(`stroke-width="${MARK.stroke}"`));
    assert.match(comp, new RegExp(`stroke: ${MARK.stroke},`));
  });

  it("旧品牌的图标文件已清除（避免两套品牌并存）", () => {
    for (const stale of ["zcode-icon.svg", "zcode-maskable.svg", "icon-192.png", "apple-touch-icon.png"]) {
      assert.ok(!existsSync(join(PUBLIC, stale)), `旧图标 ${stale} 仍在，应删除`);
    }
  });

  it("manifest 引用的图标全部存在，且声明了 maskable", () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8"));
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3);
    for (const icon of manifest.icons) {
      const rel = icon.src.replace(/^\//, "");
      assert.ok(existsSync(join(PUBLIC, rel)), `manifest 引用了不存在的图标: ${icon.src}`);
      assert.ok(icon.sizes, `${icon.src} 缺少 sizes`);
    }
    assert.ok(
      manifest.icons.some((i) => i.sizes === "192x192" && i.type === "image/png"),
      "应提供 192x192 PNG（Android 安装所需）",
    );
    assert.ok(
      manifest.icons.some((i) => String(i.purpose).includes("maskable")),
      "应提供 maskable 图标",
    );
    // 改名时保持 id 不变，否则已安装的 PWA 会被系统当成另一个应用
    assert.equal(manifest.id, "/", "manifest.id 必须保持稳定，改名不应改变它");
  });

  it("service worker 的缓存名已换新（旧缓存里的图标需要清掉）", () => {
    const sw = readFileSync(join(PUBLIC, "sw.js"), "utf8");
    assert.doesNotMatch(sw, /zcode-shell/, "缓存名仍含旧品牌，旧图标会被继续命中");
    assert.match(sw, /pocketd-shell/);
    assert.doesNotMatch(sw, /zcode-icon\.svg/, "预缓存清单仍指向旧图标");
  });

  it("service worker 只对带内容哈希的产物用缓存优先", () => {
    // 这条规则是踩过坑才立的：非哈希资源（图标、manifest）若缓存优先，
    // 改了之后已安装到桌面的实例会一直显示旧的，现象是「我明明改了」。
    const sw = readFileSync(join(PUBLIC, "sw.js"), "utf8");
    assert.match(sw, /HASHED_ASSET/, "缺少哈希判定");
    assert.match(sw, /networkFirst/, "缺少网络优先路径");
    assert.match(sw, /req\.mode === 'navigate'/, "导航必须单独处理");
    assert.match(sw, /networkFirst\(req, '\/'\)/, "导航应网络优先并回退缓存外壳");
    // 预缓存清单不该钉住易变的单个图标
    const shellLine = /const SHELL = \[([^\]]*)\]/.exec(sw)?.[1] ?? "";
    assert.ok(shellLine.length > 0, "未解析到预缓存清单");
    assert.doesNotMatch(shellLine, /\.png/, "预缓存清单不该钉住 PNG 图标");
  });
});
