import { useEffect, useState } from 'react';

/**
 * 是否处于窄屏（手机）布局。
 *
 * 断点必须与 index.css 里那组 `@media (max-width: 768px)` 规则一致：
 * 那边的 `[data-mobile-view]` 规则用 `display: none` 在两条视图之间切换，
 * 而 `display: none` 的元素量不到尺寸 —— Monaco 会因此在 5×5 上卡住。
 * 所以需要「现在是否被隐藏」在 JS 侧也可见。
 */
export const NARROW_QUERY = '(max-width: 768px)';

function read(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

export function useIsNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(read);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(NARROW_QUERY);
    const sync = () => setNarrow(mql.matches);
    /**
     * 三条路径缺一不可：
     *  - change：正常浏览器的断点跨越事件
     *  - resize：某些环境（无渲染帧的自动化、部分 WebView）不派发 change，
     *    这里兜底重读一次。漏掉它就会让窄屏判定卡在初始值上 ——
     *    表现为编辑器在宽屏下也一直不挂载（因为组件以为还在窄屏）。
     *  - 初始 sync：挂载时 matchMedia 与 useState 初值之间可能有窗口期
     */
    mql.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    sync();
    return () => {
      mql.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return narrow;
}
