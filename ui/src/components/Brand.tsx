import { memo } from 'react';
import { BRAND } from '../lib/brand';

/**
 * 品牌标记：圆角方块 + 小写 d（竖笔 + 圆环）。
 * 与 ui/public/pocketd-icon.svg 使用同一几何定义 —— 改一处必须同步另一处，
 * tests/brand-assets.test.ts 会断言两者一致。
 */
export const MARK = {
  /** 字升部（竖笔）：起止点 */
  stem: { x: 21.3, y1: 9.5, y2: 22.5 },
  /** 字腹（圆环） */
  bowl: { cx: 16.3, cy: 17.5, r: 5 },
  stroke: 2.6,
  radius: 8,
} as const;

export function MarkSvg({
  size = 32,
  tile = 'var(--accent)',
  glyph = 'var(--fg-on-accent)',
  title,
}: {
  size?: number;
  tile?: string;
  glyph?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect width="32" height="32" rx={MARK.radius} fill={tile} />
      <path
        d={`M${MARK.stem.x} ${MARK.stem.y1}V${MARK.stem.y2}`}
        fill="none"
        stroke={glyph}
        strokeWidth={MARK.stroke}
        strokeLinecap="round"
      />
      <circle
        cx={MARK.bowl.cx}
        cy={MARK.bowl.cy}
        r={MARK.bowl.r}
        fill="none"
        stroke={glyph}
        strokeWidth={MARK.stroke}
      />
    </svg>
  );
}

/**
 * 文字标记（wordmark）。全应用唯一实现，避免顶栏与引导页两套字距。
 * `size` 同时驱动字号与标记尺寸，保证两者比例恒定。
 */
export const Wordmark = memo(function Wordmark({
  size = 15,
  suffix,
  showMark = true,
}: {
  size?: number;
  suffix?: string;
  showMark?: boolean;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.4),
        fontSize: size,
        fontWeight: 700,
        letterSpacing: `${-size * 0.02}px`,
        lineHeight: 1.2,
        color: 'var(--fg)',
      }}
    >
      {showMark && <MarkSvg size={Math.round(size * 1.25)} />}
      <span>{BRAND.name}</span>
      {suffix && (
        <span
          style={{
            fontWeight: 400,
            fontSize: Math.round(size * 0.72),
            letterSpacing: 0,
            color: 'var(--fg-dim)',
          }}
        >
          {suffix}
        </span>
      )}
    </span>
  );
});
